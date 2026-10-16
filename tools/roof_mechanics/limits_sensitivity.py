"""Post hoc, frozen XGBoost sensitivity to hypothetical static-limit errors."""

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from numbers import Real
from pathlib import Path
import re
import sys

import numpy as np
from xgboost import XGBClassifier

from .dataset import FEATURE_NAMES, classify_ratio, supervised_rows
from .known_limits import engineering_feature_matrix, evaluate_events
from .known_limits_study import REPLICATES, readback_study
from .run_experiment import read_json, sha256, verify_manifest, write_json
from .train import evaluate, feature_matrix, software_versions


FORMAL_SOURCE = Path('D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13')
FORMAL_SHA256 = '031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537'
PARAMETERS = ('deflection_limit_mm', 'capacity_n', 'bending_strength_mpa')
ERRORS = (-.20, -.10, -.05, .05, .10, .20)
CASE_REGISTRY = (dict(case_id='exact', parameter=None, relative_error=0),) + tuple(
    dict(case_id=f'{parameter}_{"minus" if error < 0 else "plus"}{round(abs(error)*100)}',
         parameter=parameter, relative_error=error)
    for parameter in PARAMETERS for error in ERRORS
)
SPLITS = ('test', 'ood')
ANALYSIS_CODE_FILES = (
    'tools/roof_mechanics/limits_sensitivity.py',
    'tests/roof_mechanics/test_limits_sensitivity.py',
    'tools/roof_mechanics/dataset.py',
    'tools/roof_mechanics/known_limits.py',
    'tools/roof_mechanics/train.py',
    'tools/roof_mechanics/run_experiment.py',
    'tools/roof_mechanics/known_limits_study.py',
)
CSV_FIELDS = ('replicate', 'split', 'case_id', 'parameter', 'relative_error', 'factor',
              'candidate', 'rows', 'scenarios', 'macro_f1', 'class3_support',
              'class3_recall', 'class3_underestimate_count', 'class3_underestimate_denominator',
              'class3_underestimate_fraction', 'low_false_positive_count',
              'low_false_positive_denominator', 'low_false_positive_fraction',
              'alert2_true_limit_events', 'alert2_timely_detected_events',
              'alert2_timely_detection_fraction', 'alert2_non_limit_scenarios',
              'alert2_alerted_non_limit_scenarios', 'alert2_non_limit_alert_fraction',
              'alert3_true_limit_events', 'alert3_timely_detected_events',
              'alert3_timely_detection_fraction', 'alert3_non_limit_scenarios',
              'alert3_alerted_non_limit_scenarios', 'alert3_non_limit_alert_fraction')


def _case_hash():
    return hashlib.sha256(json.dumps(CASE_REGISTRY, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode('utf-8')).hexdigest()


def _analysis_code_hashes():
    root = Path(__file__).resolve().parents[2]
    return {name: sha256(root / name) for name in ANALYSIS_CODE_FILES}


def _validate_bias(parameter, relative_error):
    if parameter is not None and parameter not in PARAMETERS:
        raise ValueError('unknown limit parameter')
    if isinstance(relative_error, (bool, np.bool_)) or not isinstance(relative_error, Real):
        raise TypeError('relative_error must be a real non-bool number')
    error = float(relative_error)
    if not np.isfinite(error) or error <= -1:
        raise ValueError('relative_error must be finite and greater than -1')
    if parameter is None and error != 0:
        raise ValueError('exact case requires zero relative_error')
    return error


def biased_feature_matrix(rows, scenarios, parameter, relative_error):
    """Apply one estimated denominator without changing rows or true scenarios."""
    error = _validate_bias(parameter, relative_error)
    estimated = [dict(scene, parameters=dict(scene['parameters'])) for scene in scenarios]
    if parameter is not None:
        for scene in estimated:
            if parameter not in scene['parameters']:
                raise ValueError(f'missing static limit {parameter}')
            original = scene['parameters'][parameter]
            if (isinstance(original, (bool, np.bool_)) or not isinstance(original, Real)):
                raise TypeError(f'{parameter} must be a real non-bool limit')
            if not np.isfinite(float(original)) or original <= 0:
                raise ValueError(f'{parameter} must be finite and positive')
            scene['parameters'][parameter] *= 1 + error
    return engineering_feature_matrix(rows, estimated)


def _independent_matrix(rows, scenarios, case):
    """Readback arithmetic independent of the production transform."""
    parameter, factor = case['parameter'], 1 + case['relative_error']
    limits = {}
    for scene in scenarios:
        p = scene['parameters']
        denominator = [p['deflection_limit_mm'], p['deflection_limit_mm'],
                       p['capacity_n'] / 1000, p['bending_strength_mpa']]
        if parameter == 'deflection_limit_mm':
            denominator[0] *= factor
            denominator[1] *= factor
        elif parameter == 'capacity_n':
            denominator[2] *= factor
        elif parameter == 'bending_strength_mpa':
            denominator[3] *= factor
        limits[scene['scenario_id']] = denominator
    matrix = np.asarray([[row[name] / limits[row['scenario_id']][column]
                          for column, name in enumerate(FEATURE_NAMES)] for row in rows], dtype=float)
    if matrix.shape != (len(rows), 4) or not np.all(np.isfinite(matrix)):
        raise ValueError('invalid readback feature matrix')
    return matrix


def _source_replicate(source, name):
    directory = source / name
    scenarios = read_json(directory / 'scenarios.json')
    rows = [row for scene in scenarios for row in supervised_rows(
        scene['trajectory'], scene['scenario_id'], scene['domain'], scene['family']) if row['step'] >= 1]
    split = read_json(directory / 'splits.json')
    metrics = read_json(directory / 'metrics.json')
    original = read_json(directory / 'predictions.json')
    return directory, rows, scenarios, split, metrics, original


def _score(rows, scenarios, indices, values):
    selected = [rows[i] for i in indices]
    ids = {row['scenario_id'] for row in selected}
    scenes = [scene for scene in scenarios if scene['scenario_id'] in ids]
    truth = [row['target_class'] for row in selected]
    return dict(row=evaluate(truth, values),
                event_alert2=evaluate_events(selected, values, scenes, 2),
                event_alert3=evaluate_events(selected, values, scenes, 3))


def _cell(name, split_name, case, candidate, indices, score, values, scenarios):
    return dict(replicate=name, split=split_name, case_id=case['case_id'],
                parameter=case['parameter'], relative_error=case['relative_error'],
                factor=1 + case['relative_error'], candidate=candidate,
                rows=len(indices), scenarios=len({scenarios[i] for i in indices}), score=score)


def _calculate(source, independent=False):
    cells, predictions, selections = [], [], {}
    for spec in REPLICATES:
        name = spec['name']
        directory, rows, scenes, split, metrics, original = _source_replicate(source, name)
        selections[name] = metrics['selection']
        models = {}
        for protocol in ('raw4', 'known_limits4'):
            model_path = directory / 'models' / protocol / 'xgboost.json'
            shape = read_json(model_path)['learner']['learner_model_param']
            if (int(shape['num_feature']), int(shape['num_class'])) != (4, 4):
                raise ValueError('native model feature/class contract mismatch')
            model = XGBClassifier()
            model.load_model(model_path)
            if model.n_features_in_ != 4 or set(model.classes_.tolist()) != set(range(4)):
                raise ValueError('loaded model feature/class contract mismatch')
            models[protocol] = model
        raw_matrix = feature_matrix(rows)
        for split_name in SPLITS:
            indices = split['row_indices'][split_name]
            row_scenarios = [row['scenario_id'] for row in rows]
            raw_values = models['raw4'].predict(raw_matrix[indices]).astype(int).tolist()
            if raw_values != original[split_name]['raw4']['xgboost']:
                raise ValueError('raw4 original prediction mismatch')
            raw_score = _score(rows, scenes, indices, raw_values)
            if raw_score != metrics['evaluation'][split_name]['raw4']['xgboost']:
                raise ValueError('raw4 original score mismatch')
            case = CASE_REGISTRY[0]
            cells.append(_cell(name, split_name, case, 'raw4_xgboost', indices,
                               raw_score, raw_values, row_scenarios))
            predictions.append(raw_values)
            for case in CASE_REGISTRY:
                matrix = (_independent_matrix(rows, scenes, case) if independent else
                          biased_feature_matrix(rows, scenes, case['parameter'], case['relative_error']))
                candidate_values = models['known_limits4'].predict(matrix[indices]).astype(int).tolist()
                reference_values = [classify_ratio(max(matrix[i, [0, 2, 3]])) for i in indices]
                for candidate, values, original_name in (
                        ('known_limits4_xgboost', candidate_values, 'xgboost'),
                        ('estimated_current_limit', reference_values, 'current_limit')):
                    score = _score(rows, scenes, indices, values)
                    if case['case_id'] == 'exact':
                        if values != original[split_name]['known_limits4'][original_name]:
                            raise ValueError('exact original prediction mismatch')
                        if score != metrics['evaluation'][split_name]['known_limits4'][original_name]:
                            raise ValueError('exact original score mismatch')
                    cells.append(_cell(name, split_name, case, candidate, indices,
                                       score, values, row_scenarios))
                    predictions.append(values)
    return dict(cells=cells, selections=selections), predictions


def evaluate_stress(source_dir):
    """Evaluate all fixed cells in memory; no writes, fitting, or model choice."""
    source = Path(source_dir).resolve()
    readback_study(source)
    return _calculate(source)


def _csv_row(cell):
    row, alert2, alert3 = (cell['score'][key] for key in ('row', 'event_alert2', 'event_alert3'))
    high = row['high_class_false_negative']
    low = row['low_class_false_positive']
    item = {key: cell[key] for key in ('replicate', 'split', 'case_id', 'parameter',
                                      'relative_error', 'factor', 'candidate', 'rows', 'scenarios')}
    item.update(macro_f1=row['macro_f1'], class3_support=row['support'][3],
                class3_recall=row['recall'][3],
                class3_underestimate_count=high['count'],
                class3_underestimate_denominator=high['denominator'],
                class3_underestimate_fraction=high['fraction'],
                low_false_positive_count=low['count'],
                low_false_positive_denominator=low['denominator'],
                low_false_positive_fraction=low['fraction'])
    for prefix, event in (('alert2', alert2), ('alert3', alert3)):
        for key in ('true_limit_events', 'timely_detected_events', 'timely_detection_fraction',
                    'non_limit_scenarios', 'alerted_non_limit_scenarios', 'non_limit_alert_fraction'):
            item[f'{prefix}_{key}'] = event[key]
    return item


def _csv_value(value):
    return '' if value is None else str(value)


def _content_audit(output):
    protocol = read_json(output / 'protocol.json')
    if protocol['cases'] != list(CASE_REGISTRY) or protocol['case_registry_sha256'] != _case_hash():
        raise ValueError('protocol case registry mismatch')
    if protocol['splits'] != list(SPLITS) or protocol['replicates'] != [s['name'] for s in REPLICATES]:
        raise ValueError('protocol split or replicate mismatch')
    if protocol['model_candidates'] != ['raw4_xgboost', 'known_limits4_xgboost']:
        raise ValueError('protocol model candidates mismatch')
    source = Path(protocol['source_dir'])
    if sha256(source / 'manifest.json') != protocol['source_manifest_sha256']:
        raise ValueError('source manifest hash changed')
    source_readback = readback_study(source)
    if not source_readback['passed']:
        raise ValueError('source readback failed')
    source_protocol = read_json(source / 'protocol.json')
    if (protocol['source_file_hashes'] != read_json(source / 'manifest.json')['files'] or
            protocol['source_software_versions'] != source_protocol['software_versions']):
        raise ValueError('source protocol inputs mismatch')
    recorded_code = protocol.get('analysis_code_sha256')
    if recorded_code is None:
        code_provenance = 'legacy_protocol_missing_pre_scoring_code_hashes'
    elif recorded_code != _analysis_code_hashes():
        raise ValueError('analysis code hash mismatch')
    else:
        code_provenance = 'pre_scoring_code_hashes_verified'
    teacher = protocol['teacher_csv']
    if sha256(teacher['path']) != teacher['sha256']:
        raise ValueError('teacher CSV hash changed')
    check = read_json(output / 'source-check.json')
    if check != dict(source_manifest_before=protocol['source_manifest_sha256'],
                     source_manifest_after=sha256(source / 'manifest.json'),
                     teacher_before=teacher['sha256'], teacher_after=sha256(teacher['path']),
                     source_readback_passed=True, equal=True):
        raise ValueError('source check mismatch')
    expected, expected_predictions = _calculate(source, independent=True)
    actual = read_json(output / 'results.json')
    predictions = read_json(output / 'predictions.json')
    if actual != expected or predictions != expected_predictions:
        raise ValueError('stress prediction or score mismatch')
    if protocol['original_selections'] != expected['selections']:
        raise ValueError('original selections mismatch')
    with (output / 'comparison.csv').open(encoding='utf-8', newline='') as stream:
        reader = csv.DictReader(stream)
        if tuple(reader.fieldnames or ()) != CSV_FIELDS:
            raise ValueError('comparison CSV header mismatch')
        observed = list(reader)
    expected_csv = [{key: _csv_value(value) for key, value in _csv_row(cell).items()}
                    for cell in expected['cells']]
    if observed != expected_csv or len(observed) != 156:
        raise ValueError('comparison CSV content or coverage mismatch')
    if protocol['cell_count'] != 156 or protocol['prediction_lists'] != 156:
        raise ValueError('protocol metadata count mismatch')
    return dict(passed=True, cells_checked=156, predictions_checked=156,
                csv_rows_checked=156, source_readback_passed=True,
                source_manifest_unchanged=True, teacher_csv_unchanged=True,
                independent_denominator_reconstruction=True,
                analysis_code_provenance=code_provenance)


def readback_sensitivity(output_dir):
    output = Path(output_dir).resolve()
    manifest = verify_manifest(output)
    if (read_json(output / 'manifest.json')['algorithm'] != 'sha256' or
            read_json(output / 'manifest.json')['excludes'] != ['manifest.json']):
        raise ValueError('manifest format mismatch')
    expected_files = {'protocol.json', 'results.json', 'predictions.json',
                      'comparison.csv', 'source-check.json', 'readback.json'}
    if set(read_json(output / 'manifest.json')['files']) != expected_files:
        raise ValueError('manifest coverage mismatch')
    result = _content_audit(output)
    stored_readback = read_json(output / 'readback.json')
    legacy = 'analysis_code_sha256' not in read_json(output / 'protocol.json')
    comparison = dict(result)
    if legacy:
        comparison.pop('analysis_code_provenance')
    if stored_readback != comparison:
        raise ValueError('readback record mismatch')
    return dict(result, manifest=manifest)


def run_sensitivity(source_dir, output_dir, expected_manifest_sha256):
    source, output = Path(source_dir).resolve(), Path(output_dir).resolve()
    if output.exists():
        raise FileExistsError(output)
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('source/output overlap')
    if not isinstance(expected_manifest_sha256, str) or not re.fullmatch('[0-9a-f]{64}', expected_manifest_sha256):
        raise ValueError('expected manifest hash must be 64 lowercase hexadecimal digits')
    if sha256(source / 'manifest.json') != expected_manifest_sha256:
        raise ValueError('source manifest hash mismatch')
    source_readback = readback_study(source)
    teacher = read_json(source / 'protocol.json')['teacher_csv']
    teacher_before = sha256(teacher['path'])
    output.mkdir(parents=True, exist_ok=False)
    source_manifest = read_json(source / 'manifest.json')
    selections = {spec['name']: read_json(source / spec['name'] / 'metrics.json')['selection']
                  for spec in REPLICATES}
    protocol = dict(created_utc=datetime.now(timezone.utc).isoformat(),
                    analysis_kind='post_hoc_frozen_model_limit_error_stress',
                    source_kind='mechanics_simulation', source_dir=str(source),
                    source_manifest_sha256=expected_manifest_sha256,
                    source_file_hashes=source_manifest['files'],
                    analysis_code_sha256=_analysis_code_hashes(),
                    source_software_versions=read_json(source / 'protocol.json')['software_versions'],
                    analysis_software_versions=software_versions(),
                    teacher_csv=dict(path=teacher['path'], sha256=teacher_before),
                    cases=list(CASE_REGISTRY), case_registry_sha256=_case_hash(),
                    splits=list(SPLITS), replicates=[spec['name'] for spec in REPLICATES],
                    model_candidates=['raw4_xgboost', 'known_limits4_xgboost'],
                    original_selections=selections, cell_count=156, prediction_lists=156,
                    hypothetical_error_grid=True,
                    reproducible_command=[sys.executable, '-B', '-m', 'tools.roof_mechanics.limits_sensitivity',
                                          '--source-dir', str(source), '--output-dir', str(output),
                                          '--expected-manifest-sha256', expected_manifest_sha256])
    write_json(output / 'protocol.json', protocol)
    results, predictions = _calculate(source)
    write_json(output / 'results.json', results)
    write_json(output / 'predictions.json', predictions)
    with (output / 'comparison.csv').open('x', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(_csv_row(cell) for cell in results['cells'])
    teacher_after, manifest_after = sha256(teacher['path']), sha256(source / 'manifest.json')
    if teacher_after != teacher_before or manifest_after != expected_manifest_sha256:
        raise ValueError('source or teacher changed during stress evaluation')
    write_json(output / 'source-check.json',
               dict(source_manifest_before=expected_manifest_sha256, source_manifest_after=manifest_after,
                    teacher_before=teacher_before, teacher_after=teacher_after,
                    source_readback_passed=source_readback['passed'], equal=True))
    audit = _content_audit(output)
    write_json(output / 'readback.json', audit)
    files = {path.relative_to(output).as_posix(): dict(sha256=sha256(path), bytes=path.stat().st_size)
             for path in sorted(output.rglob('*')) if path.is_file()}
    write_json(output / 'manifest.json', dict(algorithm='sha256', excludes=['manifest.json'], files=files))
    summary = dict(output_dir=str(output), readback=readback_sensitivity(output),
                   selections=selections, source_manifest_sha256=expected_manifest_sha256)
    print(json.dumps(summary, ensure_ascii=False, allow_nan=False), flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=FORMAL_SOURCE)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--expected-manifest-sha256', default=FORMAL_SHA256)
    args = parser.parse_args()
    run_sensitivity(args.source_dir, args.output_dir, args.expected_manifest_sha256)


if __name__ == '__main__':
    main()
