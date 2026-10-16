"""Frozen, offline two-replicate known-limit ablation with audited readback."""

import csv
from datetime import datetime, timezone
from itertools import combinations
import json
from pathlib import Path
import sys

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

from .dataset import CLASS_NAMES, FEATURE_NAMES, classify_ratio, generate_dataset, supervised_rows
from .known_limits import ENGINEERING_FEATURE_NAMES, eligible_rows, engineering_feature_matrix, evaluate_events
from .run_experiment import read_json, sha256, verify_manifest, write_json
from .train import SPLIT_NAMES, evaluate, feature_matrix, software_versions, split_scenarios


REPLICATES = (
    dict(name='replicate-a', in_domain_seed=41101, ood_seed=42101, split_seed=43101),
    dict(name='replicate-b', in_domain_seed=41102, ood_seed=42102, split_seed=43102),
)
PROTOCOLS = ('raw4', 'known_limits4')
MODELS = ('random_forest', 'xgboost')
SCORED_SPLITS = ('validation', 'test', 'ood')


def select_model(validation):
    """Apply the frozen eligibility/priority rule using validation row scores only."""
    def eligible(metric):
        return (metric['support'][3] > 0 and metric['macro_f1'] is not None
                and metric['macro_f1'] >= .50
                and metric['low_class_false_positive']['fraction'] is not None
                and metric['low_class_false_positive']['fraction'] <= .20)
    accepted = [name for name in MODELS if eligible(validation[name])]
    if accepted:
        selected = max(accepted, key=lambda name: (
            validation[name]['recall'][3], validation[name]['macro_f1'], name == 'xgboost'))
    else:
        selected = max(MODELS, key=lambda name: (
            validation[name]['macro_f1'] if validation[name]['macro_f1'] is not None else -1,
            name == 'xgboost'))
    return dict(split='validation', selected_model=selected, eligible=bool(accepted),
                eligible_candidates=accepted, minimum_macro_f1=.50,
                maximum_low_class_false_positive_fraction=.20,
                required_present_class=3, priority=['recall_class_3', 'macro_f1', 'xgboost_tie'],
                fallback=['macro_f1', 'xgboost_tie'], frozen_before_test_and_ood=True)


def _matrices(rows, scenarios):
    return dict(raw4=feature_matrix(rows),
                known_limits4=engineering_feature_matrix(rows, scenarios))


def _score(rows, truth, prediction, scenarios):
    return dict(row=evaluate(truth, prediction),
                event_alert2=evaluate_events(rows, prediction, scenarios, 2),
                event_alert3=evaluate_events(rows, prediction, scenarios, 3))


def _params(model):
    options = model.get_params()
    for key, value in options.items():
        if isinstance(value, (float, np.floating)) and not np.isfinite(value):
            options[key] = 'NaN (native missing-value sentinel; inputs reject nonfinite values)'
    return options


def train_ablation(dataset, split_seed):
    """Fit both four-column protocols; freeze choices before held-out scoring."""
    rows = eligible_rows(dataset)
    scenarios = dataset['scenarios']
    split = split_scenarios(rows, split_seed)
    matrices = _matrices(rows, scenarios)
    truth = np.asarray([row['target_class'] for row in rows], dtype=int)
    if any(isinstance(row['target_class'], bool) or row['target_class'] not in range(4) for row in rows):
        raise ValueError('target_class must contain integer classes 0..3')
    train, validation = split['train'], split['validation']
    if set(truth[train].tolist()) != {0, 1, 2, 3}:
        raise ValueError('training labels must contain all four classes')
    weights = compute_sample_weight('balanced', truth[train])
    majority = int(np.bincount(truth[train], minlength=4).argmax())
    reference = np.asarray([classify_ratio(max(matrices['known_limits4'][i, [0, 2, 3]]))
                            for i in range(len(rows))], dtype=int)
    fitted, choices, evaluations = {}, {}, {name: {} for name in SCORED_SPLITS}
    predictions = {name: {} for name in SCORED_SPLITS}
    params, iterations, histories = {}, {}, {}
    # The validation pass and choices finish before any test/OOD evaluation.
    for protocol in PROTOCOLS:
        matrix = matrices[protocol]
        rf = RandomForestClassifier(n_estimators=200, min_samples_leaf=3,
                                    class_weight='balanced', n_jobs=2, random_state=42)
        xgb = XGBClassifier(n_estimators=350, max_depth=4, learning_rate=.05,
                            subsample=.9, colsample_bytree=1, objective='multi:softprob',
                            num_class=4, eval_metric='mlogloss', tree_method='hist',
                            n_jobs=2, random_state=42, early_stopping_rounds=25)
        rf.fit(matrix[train], truth[train])
        xgb.fit(matrix[train], truth[train], sample_weight=weights,
                eval_set=[(matrix[validation], truth[validation])], verbose=False)
        fitted[protocol] = dict(random_forest=rf, xgboost=xgb)
        params[protocol] = {name: _params(model) for name, model in fitted[protocol].items()}
        iterations[protocol] = int(xgb.best_iteration)
        histories[protocol] = xgb.evals_result()
        idx = validation
        predicted = {name: model.predict(matrix[idx]).astype(int).tolist()
                     for name, model in fitted[protocol].items()}
        predicted.update(majority=[majority] * len(idx), current_limit=reference[idx].tolist())
        predictions['validation'][protocol] = predicted
        evaluations['validation'][protocol] = {
            name: _score([rows[i] for i in idx], truth[idx], values,
                         [scenario for scenario in scenarios if scenario['scenario_id'] in
                          {rows[i]['scenario_id'] for i in idx}])
            for name, values in predicted.items()}
        choices[protocol] = select_model({name: evaluations['validation'][protocol][name]['row']
                                          for name in MODELS})
    for split_name in ('test', 'ood'):
        idx = split[split_name]
        group_ids = {rows[i]['scenario_id'] for i in idx}
        group_scenarios = [scenario for scenario in scenarios if scenario['scenario_id'] in group_ids]
        for protocol in PROTOCOLS:
            predicted = {name: model.predict(matrices[protocol][idx]).astype(int).tolist()
                         for name, model in fitted[protocol].items()}
            predicted.update(majority=[majority] * len(idx), current_limit=reference[idx].tolist())
            predictions[split_name][protocol] = predicted
            evaluations[split_name][protocol] = {
                name: _score([rows[i] for i in idx], truth[idx], values, group_scenarios)
                for name, values in predicted.items()}
    ids = {name: sorted({rows[i]['scenario_id'] for i in idx}) for name, idx in split.items()}
    overlap = sum(len(set(ids[a]) & set(ids[b])) for a, b in combinations(SPLIT_NAMES, 2))
    if overlap:
        raise ValueError('scenario overlap')
    counts = {name: dict(rows=len(idx), scenarios=len(ids[name]),
                         class_distribution=np.bincount(truth[idx], minlength=4).tolist())
              for name, idx in split.items()}
    metrics = dict(source_kind='mechanics_simulation', split_seed=split_seed,
                   split_row_indices=split, split_scenario_ids=ids, split_counts=counts,
                   split_overlap_count=overlap, feature_names=dict(raw4=list(FEATURE_NAMES),
                   known_limits4=list(ENGINEERING_FEATURE_NAMES)), class_names=list(CLASS_NAMES),
                   limits_contract=dict(deflection='deflection_limit_mm',
                                        deflection_increment='deflection_limit_mm',
                                        support='capacity_n/1000', bending='bending_strength_mpa',
                                        provenance='known simulator parameters; hypothetical, uncalibrated'),
                   baseline_information=dict(majority='training labels only',
                                             current_limit='current raw4 plus known simulator deflection, support and bending limits'),
                   selection=choices, evaluation=evaluations, hyperparameters=params,
                   xgboost_best_iteration=iterations, xgboost_validation_history=histories,
                   xgboost_weight_source='training labels only',
                   xgboost_training_class_weights={str(label): float(weights[truth[train] == label][0])
                                                   for label in range(4)},
                   majority_training_class=majority, software_versions=software_versions(),
                   preprocessing='none; step 0 excluded identically in both protocols')
    json.dumps(metrics, allow_nan=False)
    return metrics, fitted, predictions


def _write_csv(path, rows, fields):
    with path.open('x', encoding='utf-8', newline='') as destination:
        writer = csv.DictWriter(destination, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _prefix(dataset, prefix):
    for scenario in dataset['scenarios']:
        scenario['scenario_id'] = f'{prefix}-{scenario["scenario_id"]}'
    for row in dataset['rows']:
        row['scenario_id'] = f'{prefix}-{row["scenario_id"]}'


def _source_hashes(root):
    paths = sorted((root / 'tools' / 'roof_mechanics').glob('*.py'))
    paths += sorted((root / 'tests' / 'roof_mechanics').glob('test_*.py'))
    return {path.relative_to(root).as_posix(): sha256(path) for path in paths}


def _save_replicate(directory, dataset, metrics, models, predictions):
    directory.mkdir()
    rows = eligible_rows(dataset)
    _write_csv(directory / 'observations.csv', rows, list(rows[0]))
    normalized = engineering_feature_matrix(rows, dataset['scenarios'])
    _write_csv(directory / 'normalized_observations.csv',
               [dict(scenario_id=row['scenario_id'], step=row['step'],
                     **dict(zip(ENGINEERING_FEATURE_NAMES, values)))
                for row, values in zip(rows, normalized)],
               ['scenario_id', 'step', *ENGINEERING_FEATURE_NAMES])
    write_json(directory / 'scenarios.json', dataset['scenarios'])
    write_json(directory / 'metadata.json', dataset['metadata'])
    write_json(directory / 'verification.json', dataset['verification'])
    write_json(directory / 'splits.json', dict(seed=metrics['split_seed'],
               row_indices=metrics['split_row_indices'], scenario_ids=metrics['split_scenario_ids'],
               counts=metrics['split_counts']))
    write_json(directory / 'metrics.json', metrics)
    write_json(directory / 'predictions.json', predictions)
    model_dir = directory / 'models'
    model_dir.mkdir()
    for protocol in PROTOCOLS:
        location = model_dir / protocol
        location.mkdir()
        models[protocol]['xgboost'].save_model(location / 'xgboost.json')
        joblib.dump(models[protocol]['random_forest'], location / 'random_forest.joblib')


def _readback_replicate(directory, spec, requested):
    scenarios = read_json(directory / 'scenarios.json')
    metadata = read_json(directory / 'metadata.json')
    metrics = read_json(directory / 'metrics.json')
    splits = read_json(directory / 'splits.json')
    predictions = read_json(directory / 'predictions.json')
    if metadata['seeds'] != dict(in_domain=spec['in_domain_seed'], ood=spec['ood_seed']):
        raise ValueError('generator seed mismatch')
    if splits['seed'] != spec['split_seed'] or metrics['split_seed'] != spec['split_seed']:
        raise ValueError('split seed mismatch')
    domain_counts = {domain: sum(s['domain'] == domain for s in scenarios)
                     for domain in ('in_domain', 'ood')}
    if (metadata['in_domain_scenarios'] != requested['in_domain_scenarios'] or
            metadata['ood_scenarios'] != requested['ood_scenarios'] or
            domain_counts != dict(in_domain=requested['in_domain_scenarios'],
                                  ood=requested['ood_scenarios']) or
            len(scenarios) != requested['in_domain_scenarios'] + requested['ood_scenarios'] or
            metadata['scenario_count'] != len(scenarios)):
        raise ValueError('scenario/domain count disagrees with frozen protocol')
    if metadata['steps'] != requested['steps'] or any(
            s['parameters']['requested_steps'] != requested['steps'] or
            len(s['trajectory']) > requested['steps'] or
            (s['stop_reason'] == 'completed_load_schedule' and
             len(s['trajectory']) != requested['steps']) for s in scenarios):
        raise ValueError('requested steps disagree with frozen protocol or trajectory')
    if len({s['scenario_id'] for s in scenarios}) != len(scenarios):
        raise ValueError('scenario count or ID mismatch')
    if not all(s['scenario_id'].startswith(spec['name'] + '-') for s in scenarios):
        raise ValueError('scenario prefix mismatch')
    expected = []
    for scenario in scenarios:
        if scenario['domain'] not in ('in_domain', 'ood'):
            raise ValueError('invalid scenario domain')
        expected.extend(supervised_rows(scenario['trajectory'], scenario['scenario_id'],
                                        scenario['domain'], scenario['family']))
    if len(expected) != metadata['row_count']:
        raise ValueError('unfiltered supervised row count mismatch')
    expected = [row for row in expected if row['step'] >= 1]
    with (directory / 'observations.csv').open(encoding='utf-8', newline='') as source:
        observed = list(csv.DictReader(source))
    if len(expected) != len(observed) or len(expected) != metrics['split_counts']['train']['rows'] + sum(
            metrics['split_counts'][name]['rows'] for name in SCORED_SPLITS):
        raise ValueError('filtered row coverage mismatch')
    for generated, stored in zip(expected, observed):
        if set(generated) != set(stored) or any(str(value) != stored[key] for key, value in generated.items()):
            raise ValueError('persisted row differs from trajectory-derived evidence')
    with (directory / 'normalized_observations.csv').open(encoding='utf-8', newline='') as source:
        normalized = list(csv.DictReader(source))
    matrix = engineering_feature_matrix(expected, scenarios)
    if len(normalized) != len(expected):
        raise ValueError('normalized row coverage mismatch')
    for index, (row, values) in enumerate(zip(normalized, matrix)):
        if row['scenario_id'] != expected[index]['scenario_id'] or int(row['step']) != expected[index]['step']:
            raise ValueError('normalized row ID mismatch')
        if any(float(row[name]) != value for name, value in zip(ENGINEERING_FEATURE_NAMES, values)):
            raise ValueError('normalized feature mismatch')
    if feature_matrix(expected).shape != matrix.shape or matrix.shape[1] != 4:
        raise ValueError('feature matrix shape mismatch')
    if splits['row_indices'] != split_scenarios(expected, spec['split_seed']):
        raise ValueError('split assignment mismatch')
    if splits['row_indices'] != metrics['split_row_indices'] or splits['scenario_ids'] != metrics['split_scenario_ids']:
        raise ValueError('metric/split mismatch')
    ids = {name: set(splits['scenario_ids'][name]) for name in SPLIT_NAMES}
    if any(ids[a] & ids[b] for a, b in combinations(SPLIT_NAMES, 2)):
        raise ValueError('split group overlap')
    if set.union(*ids.values()) != {s['scenario_id'] for s in scenarios}:
        raise ValueError('scenario coverage mismatch')
    for name in SPLIT_NAMES:
        idx = splits['row_indices'][name]
        if ({expected[i]['scenario_id'] for i in idx} != ids[name] or
                metrics['split_counts'][name] != dict(
                    rows=len(idx), scenarios=len(ids[name]),
                    class_distribution=np.bincount(
                        [expected[i]['target_class'] for i in idx], minlength=4).tolist())):
            raise ValueError('split counts or membership mismatch')
        if any((next(s for s in scenarios if s['scenario_id'] == sid)['domain'] !=
                ('ood' if name == 'ood' else 'in_domain')) for sid in ids[name]):
            raise ValueError('split domain mismatch')
    truth = [row['target_class'] for row in expected]
    majority = int(np.bincount([truth[i] for i in splits['row_indices']['train']], minlength=4).argmax())
    if metrics['majority_training_class'] != majority:
        raise ValueError('majority baseline mismatch')
    for split_name in SCORED_SPLITS:
        indices = splits['row_indices'][split_name]
        group_scenarios = [s for s in scenarios if s['scenario_id'] in ids[split_name]]
        for protocol in PROTOCOLS:
            supplied = predictions[split_name][protocol]
            if supplied['majority'] != [majority] * len(indices):
                raise ValueError('majority predictions mismatch')
            current = [classify_ratio(max(matrix[i, [0, 2, 3]])) for i in indices]
            if supplied['current_limit'] != current:
                raise ValueError('current-limit predictions mismatch')
            for name, values in predictions[split_name][protocol].items():
                if len(values) != len(indices):
                    raise ValueError('prediction count mismatch')
                score = _score([expected[i] for i in indices], [truth[i] for i in indices],
                               values, group_scenarios)
                if score != metrics['evaluation'][split_name][protocol][name]:
                    raise ValueError('row/event metric mismatch')
            if split_name == 'validation':
                selection = select_model({name: metrics['evaluation']['validation'][protocol][name]['row']
                                          for name in MODELS})
                if selection != metrics['selection'][protocol]:
                    raise ValueError('validation choice mismatch')
    for protocol in PROTOCOLS:
        if metrics['feature_names'][protocol] != list(FEATURE_NAMES if protocol == 'raw4' else ENGINEERING_FEATURE_NAMES):
            raise ValueError('feature names mismatch')
        model_path = directory / 'models' / protocol / 'xgboost.json'
        native = read_json(model_path)
        spec_data = native['learner']['learner_model_param']
        if int(spec_data['num_feature']) != 4 or int(spec_data['num_class']) != 4:
            raise ValueError('native model shape mismatch')
        restored = XGBClassifier()
        restored.load_model(model_path)
        matrix_for_protocol = feature_matrix(expected) if protocol == 'raw4' else matrix
        for split_name in SCORED_SPLITS:
            indices = splits['row_indices'][split_name]
            actual = restored.predict(matrix_for_protocol[indices]).astype(int).tolist()
            if actual != predictions[split_name][protocol]['xgboost']:
                raise ValueError('native XGBoost prediction mismatch')
    return dict(passed=True, rows=len(expected), scenarios=len(scenarios),
                future_target_checked_rows=len(expected), normalized_checked_rows=len(expected),
                event_scores_checked=True, validation_selection_checked=True,
                native_xgboost_reload_checked=True,
                joblib_policy='RF saved locally; no pickle loading')


def readback_study(output_dir):
    output = Path(output_dir)
    manifest = verify_manifest(output)
    for path in output.rglob('*.json'):
        read_json(path)
    protocol = read_json(output / 'protocol.json')
    if (protocol['replicates'] != list(REPLICATES) or protocol['class_thresholds'] != [.5, .8, 1.] or
            protocol['future_window_steps'] != 3 or protocol['excluded_step'] != 0):
        raise ValueError('frozen protocol mismatch')
    requested = {key: protocol[key] for key in ('in_domain_scenarios', 'ood_scenarios', 'steps')}
    checks = {spec['name']: _readback_replicate(output / spec['name'], spec, requested)
              for spec in protocol['replicates']}
    teacher = protocol['teacher_csv']
    check = read_json(output / 'teacher-csv-check.json')
    if (teacher['before_sha256'] != check['before_sha256'] or
            check['before_sha256'] != check['after_sha256'] or
            sha256(teacher['path']) != check['after_sha256']):
        raise ValueError('teacher CSV hash mismatch')
    return dict(passed=True, replicates=checks, manifest=manifest,
                teacher_csv_unchanged=True)


def run_study(output_dir, in_domain_scenarios=500, ood_scenarios=100, steps=32):
    """Create a fresh evidence folder and run the two fixed independent replicates."""
    output = Path(output_dir).resolve()
    if output.exists():
        raise FileExistsError(f'output directory already exists: {output}')
    output.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    teacher = root / 'data' / 'teacher_roof_monitoring.csv'
    before = sha256(teacher)
    protocol = dict(created_utc=datetime.now(timezone.utc).isoformat(),
                    source_kind='mechanics_simulation', frozen=True,
                    in_domain_scenarios=in_domain_scenarios, ood_scenarios=ood_scenarios,
                    steps=steps, replicates=list(REPLICATES),
                    split_fractions=[.6, .2, .2], excluded_step=0,
                    feature_names=dict(raw4=list(FEATURE_NAMES), known_limits4=list(ENGINEERING_FEATURE_NAMES)),
                    class_thresholds=[.5, .8, 1.], future_window_steps=3,
                    selection_rule=dict(min_macro_f1=.5, max_low_class_false_positive=.2,
                                        priority=['recall_class_3', 'macro_f1', 'xgboost_tie']),
                    model_parameters=dict(random_forest=dict(n_estimators=200, min_samples_leaf=3,
                        class_weight='balanced', n_jobs=2, random_state=42),
                        xgboost=dict(n_estimators=350, max_depth=4, learning_rate=.05,
                        subsample=.9, colsample_bytree=1, objective='multi:softprob', num_class=4,
                        eval_metric='mlogloss', tree_method='hist', n_jobs=2,
                        random_state=42, early_stopping_rounds=25)),
                    information_conditions=dict(raw4='four current physical observations',
                        known_limits4='four current observations plus exact known simulator limits',
                        current_limit='current observations plus exact known simulator limits'),
                    code_sha256=_source_hashes(root), software_versions=software_versions(),
                    teacher_csv=dict(path=str(teacher), before_sha256=before, after_sha256=None),
                    command=[sys.executable, '-B', '-m', 'tools.roof_mechanics.run_known_limits',
                             '--output-dir', str(output), '--in-domain-scenarios', str(in_domain_scenarios),
                             '--ood-scenarios', str(ood_scenarios), '--steps', str(steps)])
    # Protocol is committed before generation/training; final CSV hash is a separate record.
    write_json(output / 'protocol.json', protocol)
    for spec in REPLICATES:
        print(f'Generating {spec["name"]}: {in_domain_scenarios}+{ood_scenarios} scenarios', flush=True)
        dataset = generate_dataset(in_domain_scenarios, ood_scenarios, steps,
                                   in_domain_seed=spec['in_domain_seed'], ood_seed=spec['ood_seed'])
        _prefix(dataset, spec['name'])
        print(f'Training {spec["name"]}: {len(eligible_rows(dataset))} eligible rows', flush=True)
        metrics, models, predictions = train_ablation(dataset, spec['split_seed'])
        _save_replicate(output / spec['name'], dataset, metrics, models, predictions)
        # Check in-memory RF/native model contracts without loading a pickle.
        for protocol_name in PROTOCOLS:
            for model in models[protocol_name].values():
                if model.n_features_in_ != 4 or set(model.classes_.tolist()) != {0, 1, 2, 3}:
                    raise ValueError('fitted model feature/class contract mismatch')
    after = sha256(teacher)
    if after != before:
        raise ValueError('teacher CSV changed during study')
    write_json(output / 'teacher-csv-check.json', dict(before_sha256=before, after_sha256=after))
    files = {path.relative_to(output).as_posix(): dict(sha256=sha256(path), bytes=path.stat().st_size)
             for path in sorted(output.rglob('*')) if path.is_file()}
    write_json(output / 'manifest.json', dict(algorithm='sha256', excludes=['manifest.json'], files=files))
    result = readback_study(output)
    summary = dict(output_dir=str(output), readback=result,
                   selections={spec['name']: read_json(output / spec['name'] / 'metrics.json')['selection']
                               for spec in REPLICATES})
    print(json.dumps(summary, allow_nan=False, ensure_ascii=False), flush=True)
    return summary
