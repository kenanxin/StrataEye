"""Known-limit normalized observations and scenario-level event accounting.

Limits are simulator parameters available under a stronger information
condition than the four raw observations. They are hypothetical and uncalibrated.
"""

from numbers import Integral, Real

import numpy as np

from .dataset import FEATURE_NAMES, classify_ratio


ENGINEERING_FEATURE_NAMES = (
    'deflection_utilization', 'deflection_increment_utilization_per_step',
    'support_utilization', 'bending_utilization',
)
_LIMIT_NAMES = ('deflection_limit_mm', 'capacity_n', 'bending_strength_mpa')


def _id(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('scenario_id must be a nonempty string')
    return value


def _step(value):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral) or value < 0:
        raise ValueError('step must be a nonnegative integer')
    return int(value)


def _class(value, name):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral) or value not in range(4):
        raise ValueError(f'{name} must be an integer class in 0..3')
    return int(value)


def _finite(value, name, *, positive=False):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise TypeError(f'{name} must be a real number')
    number = float(value)
    if not np.isfinite(number) or (positive and number <= 0):
        raise ValueError(f'{name} must be finite' + (' and positive' if positive else ''))
    return number


def _scenario_map(scenarios):
    indexed = {}
    for scenario in scenarios:
        sid = _id(scenario['scenario_id'])
        if sid in indexed:
            raise ValueError(f'duplicate scenario_id {sid}')
        indexed[sid] = scenario
    return indexed


def engineering_feature_matrix(rows, scenarios):
    """Normalize exactly four current observations by three static limits."""
    indexed = _scenario_map(scenarios)
    limits = {}
    for sid, scenario in indexed.items():
        parameters = scenario['parameters']
        try:
            deflection, capacity, strength = (_finite(parameters[name], name, positive=True)
                                              for name in _LIMIT_NAMES)
        except KeyError as error:
            raise ValueError(f'missing static limit {error.args[0]} in {sid}') from error
        limits[sid] = np.array([deflection, deflection, capacity / 1000, strength], dtype=float)
        if not np.all(np.isfinite(limits[sid])) or np.any(limits[sid] <= 0):
            raise ValueError(f'nonfinite or nonpositive normalized denominator in {sid}')
    matrix = np.empty((len(rows), 4), dtype=float)
    for index, row in enumerate(rows):
        sid = _id(row['scenario_id'])
        if sid not in limits:
            raise ValueError(f'unknown scenario_id {sid} at row {index}')
        try:
            raw = np.array([_finite(row[name], name) for name in FEATURE_NAMES], dtype=float)
        except KeyError as error:
            raise ValueError(f'missing raw feature {error.args[0]} at row {index}') from error
        with np.errstate(over='raise', invalid='raise', divide='raise'):
            try:
                normalized = raw / limits[sid]
            except FloatingPointError as error:
                raise ValueError(f'nonfinite normalized feature at row {index}') from error
        if not np.all(np.isfinite(normalized)):
            raise ValueError(f'nonfinite normalized feature at row {index}')
        matrix[index] = normalized
    return matrix


def eligible_rows(dataset):
    """Return original supervised rows after the initial observation."""
    rows = []
    for row in dataset['rows']:
        if _step(row['step']) >= 1:
            rows.append(row)
    return rows


def _crossing(scenario):
    states = scenario['trajectory']
    if not states:
        raise ValueError('scenario trajectory must not be empty')
    crossing = None
    ratios = []
    for index, state in enumerate(states):
        if _step(state['step']) != index:
            raise ValueError('trajectory steps must be contiguous from zero')
        ratio = _finite(state['current_ratio'], 'current_ratio')
        if ratio < 0:
            raise ValueError('current_ratio must be nonnegative')
        if crossing is not None:
            raise ValueError('trajectory contains states after first crossing')
        ratios.append(ratio)
        if ratio >= 1:
            crossing = index
    return ratios, crossing


def evaluate_events(rows, predictions, scenarios, alert_level):
    """Count first-crossing detection and alert burden by represented scenario."""
    if isinstance(alert_level, (bool, np.bool_)) or not isinstance(alert_level, Integral) or alert_level not in (2, 3):
        raise ValueError('alert_level must be integer 2 or 3')
    if len(rows) != len(predictions):
        raise ValueError('rows and predictions lengths must match')
    indexed = _scenario_map(scenarios)
    histories = {sid: _crossing(scenario) for sid, scenario in indexed.items()}
    represented = {}
    seen = set()
    for row, prediction in zip(rows, predictions):
        sid = _id(row['scenario_id'])
        if sid not in histories:
            raise ValueError(f'unknown scenario_id {sid}')
        step = _step(row['step'])
        if step < 1:
            raise ValueError('event rows must exclude step zero')
        key = (sid, step)
        if key in seen:
            raise ValueError(f'duplicate row for {sid} step {step}')
        seen.add(key)
        ratios, crossing = histories[sid]
        if step >= len(ratios) or (crossing is not None and step >= crossing):
            raise ValueError(f'row at current crossing or outside trajectory: {sid} step {step}')
        if 'current_ratio' in row and not np.isclose(
                _finite(row['current_ratio'], 'row current_ratio'), ratios[step], rtol=1e-10, atol=1e-12):
            raise ValueError(f'row current_ratio disagrees with trajectory for {sid} step {step}')
        if 'current_class' in row and _class(row['current_class'], 'current_class') != classify_ratio(ratios[step]):
            raise ValueError(f'row current_class disagrees with trajectory for {sid} step {step}')
        future = ratios[step + 1:step + 4]
        if not future or (len(future) < 3 and future[-1] < 1):
            raise ValueError(f'incomplete future evidence for {sid} step {step}')
        expected = classify_ratio(max(future))
        if _class(row['target_class'], 'target_class') != expected:
            raise ValueError(f'target_class disagrees with trajectory for {sid} step {step}')
        if 'target_future_ratio' in row and not np.isclose(
                _finite(row['target_future_ratio'], 'target_future_ratio'), max(future), rtol=1e-10, atol=1e-12):
            raise ValueError(f'target_future_ratio disagrees with trajectory for {sid} step {step}')
        predicted = _class(prediction, 'prediction')
        represented.setdefault(sid, []).append((step, expected, predicted))
    true_events = timely = negative = alerted_negative = 0
    leads = []
    for sid, evidence in represented.items():
        crossing = histories[sid][1]
        if crossing is None:
            negative += 1
            alerted_negative += any(predicted >= alert_level for _, _, predicted in evidence)
            continue
        true_events += 1
        timely_steps = [step for step, target, predicted in evidence
                        if target == 3 and predicted >= alert_level and 1 <= crossing - step <= 3]
        if timely_steps:
            timely += 1
            leads.append(crossing - min(timely_steps))
    return dict(alert_level=int(alert_level), true_limit_events=true_events,
                timely_detected_events=timely,
                timely_detection_fraction=timely / true_events if true_events else None,
                lead_steps=leads, non_limit_scenarios=negative,
                alerted_non_limit_scenarios=alerted_negative,
                non_limit_alert_fraction=alerted_negative / negative if negative else None)
