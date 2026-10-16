"""Fresh-directory, offline mechanics dataset/training/evidence experiment."""

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time

import joblib
import numpy as np
from xgboost import XGBClassifier

from .dataset import CLASS_NAMES, FEATURE_NAMES, classify_ratio, generate_dataset
from .train import SPLIT_NAMES, feature_matrix, train_models


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, content):
    with Path(path).open('x', encoding='utf-8', newline='\n') as destination:
        json.dump(content, destination, ensure_ascii=False, allow_nan=False, indent=2)
        destination.write('\n')


def read_json(path):
    def reject(value):
        raise ValueError(f'nonfinite JSON token: {value}')
    def finite_float(value):
        number = float(value)
        if not np.isfinite(number):
            reject(value)
        return number
    with Path(path).open(encoding='utf-8') as source:
        return json.load(source, parse_constant=reject, parse_float=finite_float)


def readback(output, models):
    """Read persisted CSV/JSON and native XGBoost; never load a pickle."""
    output = Path(output)
    json_paths = sorted(output.rglob('*.json'))
    for path in json_paths:
        read_json(path)
    metadata, scenarios = read_json(output / 'metadata.json'), read_json(output / 'scenarios.json')
    split = read_json(output / 'splits.json')
    metrics = read_json(output / 'metrics.json')
    with (output / 'observations.csv').open(encoding='utf-8', newline='') as source:
        rows = list(csv.DictReader(source))
    scenario_map = {scenario['scenario_id']: scenario for scenario in scenarios}
    if len(scenario_map) != len(scenarios):
        raise ValueError('duplicate scenario ID')
    if len(rows) != metadata['row_count']:
        raise ValueError('persisted row count mismatch')
    if len(scenarios) != metadata['scenario_count']:
        raise ValueError('persisted scenario count mismatch')
    for scenario in scenarios:
        states = scenario['trajectory']
        if not states or [state['step'] for state in states] != list(range(len(states))):
            raise ValueError('empty or noncontiguous trajectory')
        if any(state['current_ratio'] >= 1 for state in states[:-1]):
            raise ValueError('post-limit trajectory states present')
        expected_stop = 'first_limit_crossing' if states[-1]['current_ratio'] >= 1 else 'completed_load_schedule'
        if scenario['stop_reason'] != expected_stop:
            raise ValueError('incorrect stop reason')
    ids = {name: set(value) for name, value in split['scenario_ids'].items()}
    sets = list(ids.values())
    overlap = sum(len(a & b) for index, a in enumerate(sets) for b in sets[index + 1:])
    if overlap or sorted(i for indices in split['row_indices'].values() for i in indices) != list(range(len(rows))):
        raise ValueError('split overlap or incomplete row coverage')
    for name in SPLIT_NAMES:
        observed_ids = {rows[index]['scenario_id'] for index in split['row_indices'][name]}
        if observed_ids != ids[name] or ids[name] != set(metrics['split_scenario_ids'][name]):
            raise ValueError('split scenario ID mismatch')
        for scenario_id in ids[name]:
            scenario = scenario_map[scenario_id]
            length = scenario['parameters']['length_m']
            if scenario['domain'] != ('ood' if name == 'ood' else 'in_domain'):
                raise ValueError('domain in wrong split')
            if not (12 < length <= 14 if name == 'ood' else 6 <= length <= 12):
                raise ValueError('span outside registered domain')
    if set.union(*sets) != set(scenario_map):
        raise ValueError('a generated scenario has no supervised observations')
    if len(ids['ood']) != metadata['ood_scenarios'] or sum(len(ids[name]) for name in ('train', 'validation', 'test')) != metadata['in_domain_scenarios']:
        raise ValueError('domain scenario count mismatch')
    converted = []
    for row in rows:
        state_index = int(row['step'])
        scenario = scenario_map[row['scenario_id']]
        states = scenario['trajectory']
        state = states[state_index]
        future = states[state_index + 1:state_index + 4]
        if state['current_ratio'] >= 1 or not future or not (len(future) == 3 or future[-1]['current_ratio'] >= 1):
            raise ValueError('future-window or threshold-feature violation')
        ratio = max(item['current_ratio'] for item in future)
        if float(row['target_future_ratio']) != ratio or int(row['target_class']) != classify_ratio(ratio):
            raise ValueError('future target mismatch')
        if row['domain'] != scenario['domain'] or row['source_kind'] != 'mechanics_simulation':
            raise ValueError('row provenance mismatch')
        if float(row['current_ratio']) != state['current_ratio'] or int(row['current_class']) != classify_ratio(state['current_ratio']):
            raise ValueError('current-state mismatch')
        feature_row = {name: float(row[name]) for name in FEATURE_NAMES}
        for name in FEATURE_NAMES:
            expected = (state['max_deflection_mm'] - states[state_index - 1]['max_deflection_mm'] if state_index else 0.) if name == 'deflection_increment_mm_per_step' else state[name]
            if feature_row[name] != expected:
                raise ValueError('noncausal or mismatched feature')
        converted.append(feature_row)
    matrix = feature_matrix(converted)
    if matrix.shape != (len(rows), 4) or metadata['feature_names'] != list(FEATURE_NAMES):
        raise ValueError('feature schema mismatch')
    xgb_json = read_json(output / 'models' / 'xgboost.json')
    feature_count = int(xgb_json['learner']['learner_model_param']['num_feature'])
    if feature_count != 4 or int(xgb_json['learner']['learner_model_param']['num_class']) != 4 or any(model.n_features_in_ != 4 for model in models.values()):
        raise ValueError('saved/model feature count mismatch')
    restored = XGBClassifier()
    restored.load_model(output / 'models' / 'xgboost.json')
    indices = split['row_indices']['test']
    np.testing.assert_array_equal(restored.predict(matrix[indices]), models['xgboost'].predict(matrix[indices]))
    verification = read_json(output / 'verification.json')
    if verification['passed'] is not True:
        raise ValueError('solver verification failed on readback')
    return dict(passed=True, row_count=len(rows), scenario_count=len(scenarios),
                split_overlap_count=overlap, ood_scenario_count=len(ids['ood']),
                future_target_checked_rows=len(rows), causal_feature_checked_rows=len(rows),
                finite_json_files_checked=len(json_paths), feature_count=feature_count,
                xgboost_json_prediction_roundtrip=True,
                joblib_policy='saved local-trained RF/tree; no pickle loaded',
                solver_verification_passed=True)


def verify_manifest(output):
    output = Path(output)
    manifest = read_json(output / 'manifest.json')
    actual_files = {path.relative_to(output).as_posix() for path in output.rglob('*')
                    if path.is_file() and path.name != 'manifest.json'}
    if actual_files != set(manifest['files']):
        raise ValueError('manifest file coverage mismatch')
    for relative, expected in manifest['files'].items():
        if sha256(output / relative) != expected['sha256'] or (output / relative).stat().st_size != expected['bytes']:
            raise ValueError(f'manifest mismatch: {relative}')
    return dict(passed=True, checked_files=len(actual_files), manifest_sha256=sha256(output / 'manifest.json'))


def run_experiment(output_dir, in_domain_scenarios=500, ood_scenarios=100, steps=32):
    output = Path(output_dir).resolve()
    # Fail before generation/fitting and create atomically; never overwrite an existing directory.
    if output.exists():
        raise FileExistsError(f'output directory already exists: {output}')
    output.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    root = Path(__file__).resolve().parents[2]
    teacher = root / 'data' / 'teacher_roof_monitoring.csv'
    teacher_before = sha256(teacher)
    created = datetime.now(timezone.utc).isoformat()
    print(f'Generating {in_domain_scenarios} in-domain + {ood_scenarios} OOD scenarios, {steps} requested steps', flush=True)
    dataset = generate_dataset(in_domain_scenarios, ood_scenarios, steps)
    print(f'Generated {len(dataset["rows"])} supervised rows; training fixed RF/XGB/tree protocol', flush=True)
    metrics, models = train_models(dataset)
    model_dir = output / 'models'
    model_dir.mkdir()
    with (output / 'observations.csv').open('x', encoding='utf-8', newline='') as destination:
        writer = csv.DictWriter(destination, fieldnames=list(dataset['rows'][0]))
        writer.writeheader()
        writer.writerows(dataset['rows'])
    metadata = dict(dataset['metadata'], created_utc=created, training_split_seed=2718,
                    class_definitions=[dict(label=index, name=name, lower_inclusive=lower, upper_exclusive=upper)
                                       for index, (name, lower, upper) in enumerate(zip(CLASS_NAMES, [0, .5, .8, 1.], [.5, .8, 1., None]))],
                    label_semantics='highest class among next 3 observed loading steps; incomplete window retained only for confirmed first crossing',
                    latent_scenario_parameters=['material bending strength', 'spring capacity', 'span-based deflection limit'],
                    distribution_semantics='constructed q_crit-relative ramp; not field incidence',
                    software_versions=metrics['software_versions'])
    write_json(output / 'metadata.json', metadata)
    write_json(output / 'scenarios.json', dataset['scenarios'])
    write_json(output / 'verification.json', dataset['verification'])
    write_json(output / 'splits.json', dict(seed=2718, scenario_ids=metrics['split_scenario_ids'],
                                           row_indices=metrics['split_row_indices'], counts=metrics['split_counts']))
    write_json(output / 'metrics.json', metrics)
    models['xgboost'].save_model(model_dir / 'xgboost.json')
    joblib.dump(models['random_forest'], model_dir / 'random_forest.joblib')
    joblib.dump(models['shallow_tree'], model_dir / 'shallow_tree.joblib')
    source_files = sorted((root / 'tools' / 'roof_mechanics').glob('*.py'))
    source_files += sorted((root / 'tests' / 'roof_mechanics').glob('test_*.py'))
    source_files += [root / 'docs' / 'superpowers' / 'specs' / '2026-10-12-roof-mechanics-design.md']
    write_json(output / 'source-manifest.json', dict(created_utc=created,
               files={path.relative_to(root).as_posix(): sha256(path) for path in source_files},
               teacher_csv=dict(path=str(teacher), before_sha256=teacher_before, after_sha256=sha256(teacher)),
               working_directory=str(root),
               reproducible_command=[sys.executable, '-B', '-m', 'tools.roof_mechanics.run_experiment',
                                     '--output-dir', str(output), '--in-domain-scenarios', str(in_domain_scenarios),
                                     '--ood-scenarios', str(ood_scenarios), '--steps', str(steps)],
               software_versions=metrics['software_versions']))
    evidence = readback(output, models)
    evidence['teacher_csv_unchanged'] = teacher_before == sha256(teacher)
    if not evidence['teacher_csv_unchanged']:
        raise ValueError('teacher CSV changed during experiment')
    evidence['elapsed_total_seconds'] = float(time.perf_counter() - started)
    write_json(output / 'readback.json', evidence)
    files = {path.relative_to(output).as_posix(): dict(sha256=sha256(path), bytes=path.stat().st_size)
             for path in sorted(output.rglob('*')) if path.is_file()}
    write_json(output / 'manifest.json', dict(algorithm='sha256', excludes=['manifest.json'], files=files))
    manifest_check = verify_manifest(output)
    summary = dict(output_dir=str(output), selected_model=metrics['selection']['selected_model'],
                   split_counts=metrics['split_counts'], readback=evidence, manifest_verification=manifest_check)
    print(json.dumps(summary, ensure_ascii=False, allow_nan=False), flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--in-domain-scenarios', type=int, default=500)
    parser.add_argument('--ood-scenarios', type=int, default=100)
    parser.add_argument('--steps', type=int, default=32)
    args = parser.parse_args()
    run_experiment(args.output_dir, args.in_domain_scenarios, args.ood_scenarios, args.steps)


if __name__ == '__main__':
    main()
