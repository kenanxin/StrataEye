"""Four-observation models with group splits and validation-only selection."""

from itertools import combinations
from numbers import Integral, Real
import platform
import time

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, f1_score, precision_score
from sklearn.tree import DecisionTreeClassifier
from sklearn.utils.class_weight import compute_sample_weight
import xgboost
from xgboost import XGBClassifier

from .dataset import CLASS_NAMES, FEATURE_NAMES


SPLIT_NAMES = ('train', 'validation', 'test', 'ood')


def split_scenarios(rows, seed=2718):
    """Partition complete in-domain groups; every OOD group stays held out."""
    if isinstance(seed, (bool, np.bool_)) or not isinstance(seed, Integral) or seed < 0:
        raise ValueError('seed must be a nonnegative integer')
    domains = {}
    for row in rows:
        scenario_id, domain = row.get('scenario_id'), row.get('domain')
        if not isinstance(scenario_id, str) or not scenario_id.strip():
            raise ValueError('scenario_id must be a nonempty string')
        if domain not in ('in_domain', 'ood'):
            raise ValueError('domain must be in_domain or ood')
        if scenario_id in domains and domains[scenario_id] != domain:
            raise ValueError('a scenario cannot span multiple domains')
        domains[scenario_id] = domain
    in_ids = sorted(key for key, domain in domains.items() if domain == 'in_domain')
    if len(in_ids) < 10:
        raise ValueError('at least 10 in-domain scenario groups are required')
    shuffled = np.random.default_rng(int(seed)).permutation(in_ids).tolist()
    train_end, validation_end = int(.6 * len(in_ids)), int(.6 * len(in_ids)) + int(.2 * len(in_ids))
    assignment = {sid: 'train' for sid in shuffled[:train_end]}
    assignment.update({sid: 'validation' for sid in shuffled[train_end:validation_end]})
    assignment.update({sid: 'test' for sid in shuffled[validation_end:]})
    assignment.update({sid: 'ood' for sid, domain in domains.items() if domain == 'ood'})
    result = {name: [] for name in SPLIT_NAMES}
    for index, row in enumerate(rows):
        result[assignment[row['scenario_id']]].append(index)
    return result


def feature_matrix(rows):
    """Extract only the ordered four observation fields, never label proxies."""
    matrix = np.empty((len(rows), len(FEATURE_NAMES)), dtype=float)
    for index, row in enumerate(rows):
        for column, name in enumerate(FEATURE_NAMES):
            if name not in row:
                raise ValueError(f'missing feature {name} at row {index}')
            value = row[name]
            if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
                raise TypeError(f'{name} at row {index} must be a real number')
            if not np.isfinite(value):
                raise ValueError(f'{name} at row {index} must be finite')
            matrix[index, column] = value
    return matrix


def _labels(values, name):
    labels = []
    for value in values:
        if isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral) or value not in range(4):
            raise ValueError(f'{name} must contain integer classes 0, 1, 2, 3')
        labels.append(int(value))
    return np.asarray(labels, dtype=int)


def evaluate(y_true, y_pred):
    """Fixed four classes, including absent-class support and denominators."""
    truth, prediction = _labels(y_true, 'y_true'), _labels(y_pred, 'y_pred')
    if len(truth) != len(prediction):
        raise ValueError('truth and prediction lengths must match')
    cm = confusion_matrix(truth, prediction, labels=[0, 1, 2, 3])
    support = cm.sum(axis=1)
    high_count = int(np.count_nonzero((truth == 3) & (prediction < 3)))
    low_count = int(np.count_nonzero((truth == 0) & (prediction > 0)))
    def fraction(count, denominator):
        return dict(count=count, denominator=int(denominator),
                    fraction=float(count / denominator) if denominator else None)
    return dict(class_names=list(CLASS_NAMES), labels=[0, 1, 2, 3], row_count=len(truth),
                confusion_matrix=cm.tolist(), support=support.tolist(),
                precision=precision_score(truth, prediction, labels=[0, 1, 2, 3], average=None, zero_division=0).tolist() if len(truth) else [None] * 4,
                recall=[float(cm[i, i] / support[i]) if support[i] else None for i in range(4)],
                accuracy=float(np.mean(truth == prediction)) if len(truth) else None,
                macro_f1=float(f1_score(truth, prediction, labels=[0, 1, 2, 3], average='macro', zero_division=0)) if len(truth) else None,
                high_class_false_negative=fraction(high_count, support[3]),
                low_class_false_positive=fraction(low_count, support[0]))


def software_versions():
    return dict(python=platform.python_version(), numpy=np.__version__, sklearn=sklearn.__version__,
                xgboost=xgboost.__version__, joblib=joblib.__version__, platform=platform.platform())


def train_models(dataset):
    started = time.perf_counter()
    rows = dataset['rows']
    # Assign groups before any estimator, weighting or preprocessing is fitted.
    split = split_scenarios(rows)
    matrix = feature_matrix(rows)
    truth = _labels([row['target_class'] for row in rows], 'target_class')
    current = _labels([row['current_class'] for row in rows], 'current_class')
    train, validation = split['train'], split['validation']
    if set(truth[train].tolist()) != {0, 1, 2, 3}:
        raise ValueError('training labels must contain all four classes; no label remapping is allowed')
    rf = RandomForestClassifier(n_estimators=200, min_samples_leaf=3, class_weight='balanced',
                                n_jobs=2, random_state=42)
    xgb = XGBClassifier(n_estimators=350, max_depth=4, learning_rate=.05, subsample=.9,
                        colsample_bytree=1, objective='multi:softprob', num_class=4,
                        eval_metric='mlogloss', tree_method='hist', n_jobs=2,
                        random_state=42, early_stopping_rounds=25)
    tree = DecisionTreeClassifier(max_depth=3, class_weight='balanced', random_state=42)
    weights = compute_sample_weight('balanced', truth[train])
    rf.fit(matrix[train], truth[train])
    tree.fit(matrix[train], truth[train])
    xgb.fit(matrix[train], truth[train], sample_weight=weights,
            eval_set=[(matrix[validation], truth[validation])], verbose=False)
    models = dict(random_forest=rf, xgboost=xgb, shallow_tree=tree)
    # Persist the feature contract in locally generated model metadata as well.
    for model in models.values():
        model.mechanics_feature_names_ = list(FEATURE_NAMES)
    majority = int(np.bincount(truth[train], minlength=4).argmax())
    def score_split(name):
        indices = split[name]
        predictions = {key: model.predict(matrix[indices]) if indices else [] for key, model in models.items()}
        predictions.update(majority=np.full(len(indices), majority, dtype=int), current_class=current[indices])
        return {key: evaluate(truth[indices], prediction) for key, prediction in predictions.items()}
    validation_scores = score_split('validation')
    selected = 'random_forest' if validation_scores['random_forest']['macro_f1'] > validation_scores['xgboost']['macro_f1'] else 'xgboost'
    # Choice is frozen above; held-out scores below never enter selection.
    evaluation = dict(validation=validation_scores, test=score_split('test'), ood=score_split('ood'))
    ids = {name: sorted({rows[i]['scenario_id'] for i in indices}) for name, indices in split.items()}
    overlap = sum(len(set(ids[a]) & set(ids[b])) for a, b in combinations(SPLIT_NAMES, 2))
    if overlap:
        raise ValueError('scenario overlap in split')
    counts = {name: dict(rows=len(indices), scenarios=len(ids[name]),
                        class_distribution=np.bincount(truth[indices], minlength=4).tolist())
              for name, indices in split.items()}
    params = {key: model.get_params() for key, model in models.items()}
    # XGBoost's native missing-value sentinel is NaN even though inputs are finite.
    # Record its semantics explicitly rather than emitting invalid JSON or implying None.
    for options in params.values():
        for key, value in options.items():
            if isinstance(value, Real) and not np.isfinite(value):
                options[key] = 'NaN (native missing-value sentinel; input matrix rejects nonfinite values)'
    metrics = dict(feature_names=list(FEATURE_NAMES), class_names=list(CLASS_NAMES),
                   split_seed=2718, split_row_indices=split, split_scenario_ids=ids,
                   split_counts=counts, split_overlap_count=overlap,
                   selection=dict(split='validation', metric='macro_f1', tie_break='xgboost',
                                  selected_model=selected, frozen_before_test_and_ood=True),
                   evaluation=evaluation, hyperparameters=params, software_versions=software_versions(),
                   xgboost_weight_source='training labels only',
                   xgboost_training_class_weights={str(label): float(weights[truth[train] == label][0]) for label in range(4)},
                   xgboost_best_iteration=int(xgb.best_iteration),
                   xgboost_validation_history=xgb.evals_result(), majority_training_class=majority,
                   baseline_information=dict(majority='training labels only',
                                             shallow_tree='same four observations; training labels only',
                                             current_class='privileged physical-limit reference: current utilization uses scenario material strength, capacity and deflection limit'),
                   preprocessing='none: no scaler, smoothing or full-data transformations',
                   elapsed_training_seconds=float(time.perf_counter() - started))
    return metrics, models
