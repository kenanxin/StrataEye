"""Finite grid sensitivity for a fixed four-feature classifier.

Bounds describe only the observed grid labels, without a continuous-domain or
probabilistic guarantee. No labels, trajectories, or fitting are required.
"""

import itertools
import numbers

import numpy as np


def _real_array(values, name):
    """Check original values before conversion can hide bool/string inputs."""
    try:
        original = np.asarray(values, dtype=object)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{name} must be a rectangular real array') from exc
    if any(isinstance(value, (bool, np.bool_)) or
           not isinstance(value, numbers.Real) for value in original.flat):
        raise TypeError(f'{name} must contain real numbers, excluding booleans')
    try:
        result = np.asarray(original, dtype=float)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f'{name} cannot be represented as finite floats') from exc
    if not np.all(np.isfinite(result)):
        raise ValueError(f'{name} must contain finite numbers')
    return result


def limit_error_grid(relative_error_bound=0.20):
    """Return (deflection, capacity, strength) relative error samples."""
    if isinstance(relative_error_bound, (bool, np.bool_)) or not isinstance(
            relative_error_bound, numbers.Real):
        raise TypeError('relative_error_bound must be a real number')
    try:
        bound = float(relative_error_bound)
    except (ValueError, OverflowError) as exc:
        raise ValueError('relative_error_bound must be finite and in [0, 1)') from exc
    if not np.isfinite(bound) or not 0 <= bound < 1:
        raise ValueError('relative_error_bound must be finite and in [0, 1)')
    return (tuple(itertools.product((-bound, 0.0, bound), repeat=3))
            if bound else ((0.0, 0.0, 0.0),))


def sample_limit_error_predictions(model, center_features, relative_error_bound=0.20):
    """Predict actual sampled classes using a fixed model's predict(matrix).

    The two deflection features share a factor. Support and bending features
    vary independently. ``review_required`` marks differing sampled labels;
    ``possible_class3`` records whether class 3 occurred on the sampled grid.
    """
    grid = limit_error_grid(relative_error_bound)
    centers = _real_array(center_features, 'center_features')
    if centers.ndim != 2 or centers.shape[1] != 4:
        raise ValueError('center_features must have shape (n, 4)')
    row_count = centers.shape[0]
    if not row_count:
        return dict(center=[], lower=[], upper=[], review_required=[],
                    possible_class3=[], sampled_classes=[], sample_count=len(grid))

    predictions = []
    center_labels = None
    for ed, ec, es in grid:
        try:
            with np.errstate(over='raise', invalid='raise'):
                features = centers * np.array([1 + ed, 1 + ed, 1 + ec, 1 + es])
        except FloatingPointError as exc:
            raise ValueError('sampled features overflowed') from exc
        values = _real_array(model.predict(features), 'predictions')
        if values.shape != (row_count,):
            raise ValueError('predictions must have shape (n,)')
        if np.any(values != np.floor(values)) or np.any((values < 0) | (values > 3)):
            raise ValueError('predictions must be integer class labels in 0..3')
        labels = values.astype(int)
        predictions.append(labels)
        if (ed, ec, es) == (0.0, 0.0, 0.0):
            center_labels = labels

    sampled = np.stack(predictions)
    lower = np.min(sampled, axis=0)
    upper = np.max(sampled, axis=0)
    return dict(center=center_labels.tolist(), lower=lower.tolist(), upper=upper.tolist(),
                review_required=(lower != upper).tolist(),
                possible_class3=(upper == 3).tolist(),
                sampled_classes=[np.unique(sampled[:, row]).tolist()
                                 for row in range(row_count)],
                sample_count=len(grid))
