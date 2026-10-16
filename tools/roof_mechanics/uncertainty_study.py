"""Frozen archive study of hypothetical limit errors on a finite sampling grid."""

import argparse
import csv
from datetime import datetime, timezone
import itertools
from pathlib import Path
import re
import sys

import numpy as np
from xgboost import XGBClassifier

from .dataset import FEATURE_NAMES, classify_ratio
from .known_limits import engineering_feature_matrix
from .known_limits_study import REPLICATES, readback_study
from .limit_uncertainty import limit_error_grid, sample_limit_error_predictions
from .limits_sensitivity import (CASE_REGISTRY, PARAMETERS, SPLITS, FORMAL_SOURCE,
                                 FORMAL_SHA256, _source_replicate, _score,
                                 _csv_row as _metric_csv, CSV_FIELDS as METRIC_FIELDS)
from .run_experiment import read_json, sha256, verify_manifest, write_json
from .train import software_versions


BOUND = .20
CANDIDATES = ('center', 'sampled_upper', 'estimated_current_limit')
SCOPE = 'post_hoc_same_source_finite_sampling'


def _cases():
    cases = []
    for original in CASE_REGISTRY:
        errors = [0., 0., 0.]
        if original['parameter'] is not None:
            errors[PARAMETERS.index(original['parameter'])] = original['relative_error']
        cases.append(dict(case_id=original['case_id'], relative_errors=errors,
                          center_bias=dict(zip(PARAMETERS, errors))))
    for errors in itertools.product((-.20, .20), repeat=3):
        name = 'joint_' + '_'.join('minus20' if error < 0 else 'plus20' for error in errors)
        cases.append(dict(case_id=name, relative_errors=list(errors),
                          center_bias=dict(zip(PARAMETERS, errors))))
    return tuple(cases)


CASES = _cases()
GRID = limit_error_grid(BOUND)
ANALYSIS_CODE_FILES = (
    'tools/roof_mechanics/uncertainty_study.py',
    'tests/roof_mechanics/test_uncertainty_study.py',
    'tools/roof_mechanics/limit_uncertainty.py',
    'tests/roof_mechanics/test_limit_uncertainty.py',
    'tools/roof_mechanics/limits_sensitivity.py',
    'tests/roof_mechanics/test_limits_sensitivity.py',
    'tools/roof_mechanics/known_limits_study.py',
    'tools/roof_mechanics/run_experiment.py',
    'tools/roof_mechanics/train.py',
    'tools/roof_mechanics/known_limits.py',
    'tools/roof_mechanics/dataset.py',
)
REVIEW_METRICS = ('disagreement_rows', 'disagreement_scenarios',
                  'marked_center_class3_underestimates', 'unmarked_class3_underestimates',
                  'center_underestimates_with_sampled_upper3',
                  'sampled_range_inclusion', 'sampled_class_set_inclusion')
CSV_FIELDS = ('replicate', 'split', 'case_id', *PARAMETERS, 'candidate',
              *METRIC_FIELDS[7:], 'total_true_class3',
              *(f'{metric}_{field}' for metric in REVIEW_METRICS
                for field in ('numerator', 'denominator', 'fraction')))
OUTPUT_FILES = {'protocol.json', 'results.json', 'predictions.json', 'comparison.csv',
                'source-check.json', 'readback.json'}


def _code_hashes():
    root = Path(__file__).resolve().parents[2]
    return {name: sha256(root / name) for name in ANALYSIS_CODE_FILES}


def _models(source):
    models, metadata = {}, {}
    for spec in REPLICATES:
        name = spec['name']
        path = source / name / 'models' / 'known_limits4' / 'xgboost.json'
        native = read_json(path)['learner']['learner_model_param']
        if (int(native['num_feature']), int(native['num_class'])) != (4, 4):
            raise ValueError('native model feature/class contract mismatch')
        model = XGBClassifier()
        model.load_model(path)
        if model.n_features_in_ != 4 or set(model.classes_.tolist()) != set(range(4)):
            raise ValueError('loaded model feature/class contract mismatch')
        models[name] = model
        metadata[name] = dict(path=str(path), sha256=sha256(path),
                              protocol='known_limits4', model='xgboost',
                              selection='predeclared; original validation choice retained separately')
    return models, metadata


def _fraction(numerator, denominator):
    return dict(numerator=int(numerator), denominator=int(denominator),
                fraction=float(numerator / denominator) if denominator else None)


def _summary(rows, envelope):
    truth = np.asarray([row['target_class'] for row in rows])
    center, upper = np.asarray(envelope['center']), np.asarray(envelope['upper'])
    marked = np.asarray(envelope['review_required'], dtype=bool)
    high = truth == 3
    underestimated = high & (center < 3)
    scene_ids = {row['scenario_id'] for row in rows}
    marked_ids = {row['scenario_id'] for row, flag in zip(rows, marked) if flag}
    return dict(total_true_class3=int(sum(high)),
                disagreement_rows=_fraction(sum(marked), len(rows)),
                disagreement_scenarios=_fraction(len(marked_ids), len(scene_ids)),
                marked_center_class3_underestimates=_fraction(sum(underestimated & marked), sum(high)),
                unmarked_class3_underestimates=_fraction(sum(underestimated & ~marked), sum(high)),
                center_underestimates_with_sampled_upper3=_fraction(
                    sum(underestimated & (upper == 3)), sum(underestimated)),
                sampled_range_inclusion=_fraction(sum(
                    lo <= target <= hi for lo, target, hi in
                    zip(envelope['lower'], truth, envelope['upper'])), len(rows)),
                sampled_class_set_inclusion=_fraction(sum(
                    target in classes for target, classes in
                    zip(truth, envelope['sampled_classes'])), len(rows)))


def _independent_sample(model, rows, scenes, case):
    """Reconstruct raw-value denominators; do not reuse production transforms."""
    by_id = {scene['scenario_id']: scene['parameters'] for scene in scenes}
    ed, ec, es = case['relative_errors']
    denominator = np.asarray([
        [by_id[row['scenario_id']]['deflection_limit_mm'] * (1 + ed),
         by_id[row['scenario_id']]['deflection_limit_mm'] * (1 + ed),
         by_id[row['scenario_id']]['capacity_n'] / 1000 * (1 + ec),
         by_id[row['scenario_id']]['bending_strength_mpa'] * (1 + es)]
        for row in rows], dtype=float).reshape(-1, 4)
    raw = np.asarray([[row[key] for key in FEATURE_NAMES] for row in rows],
                     dtype=float).reshape(-1, 4)
    samples, center = [], None
    for candidate_errors in GRID:
        cd, cc, cs = candidate_errors
        candidate_denominator = denominator / np.asarray([1 + cd, 1 + cd, 1 + cc, 1 + cs])
        matrix = raw / candidate_denominator
        values = model.predict(matrix).astype(int).tolist() if len(rows) else []
        samples.append(values)
        if candidate_errors == (0., 0., 0.):
            center = values
    classes = [sorted({values[index] for values in samples}) for index in range(len(rows))]
    lower, upper = [values[0] for values in classes], [values[-1] for values in classes]
    physical = [classify_ratio(max(values[[0, 2, 3]])) for values in raw / denominator]
    return dict(center=center, lower=lower, upper=upper,
                review_required=[lo != hi for lo, hi in zip(lower, upper)],
                possible_class3=[hi == 3 for hi in upper], sampled_classes=classes,
                sample_count=len(GRID)), physical


def _calculate(source, independent=False):
    cells, predictions, summaries, selections = [], [], [], {}
    models, _ = _models(source)
    for spec in REPLICATES:
        name = spec['name']
        _, rows, scenes, splits, metrics, original = _source_replicate(source, name)
        selections[name] = metrics['selection']
        for split in SPLITS:
            indices = splits['row_indices'][split]
            selected = [rows[i] for i in indices]
            exact = None if independent else engineering_feature_matrix(selected, scenes)
            for case in CASES:
                if independent:
                    envelope, physical = _independent_sample(models[name], selected, scenes, case)
                else:
                    ed, ec, es = case['relative_errors']
                    center = exact / np.asarray([1 + ed, 1 + ed, 1 + ec, 1 + es])
                    envelope = sample_limit_error_predictions(models[name], center, BOUND)
                    physical = [classify_ratio(max(value[[0, 2, 3]])) for value in center]
                identity = dict(replicate=name, split=split, case_id=case['case_id'])
                summary = dict(**identity, **_summary(selected, envelope))
                summaries.append(summary)
                predictions.append(dict(**identity, row_indices=indices, **envelope,
                                        estimated_current_limit=physical))
                for candidate, values in zip(CANDIDATES, (envelope['center'], envelope['upper'], physical)):
                    score = _score(rows, scenes, indices, values)
                    if case['case_id'] == 'exact' and candidate != 'sampled_upper':
                        original_name = 'xgboost' if candidate == 'center' else 'current_limit'
                        if (values != original[split]['known_limits4'][original_name] or
                                score != metrics['evaluation'][split]['known_limits4'][original_name]):
                            raise ValueError('exact original prediction or score mismatch')
                    cells.append(dict(**identity, center_bias=case['center_bias'], candidate=candidate,
                                      rows=len(indices), scenarios=len({r['scenario_id'] for r in selected}),
                                      score=score, review_summary=summary))
    return dict(cells=cells, summaries=summaries, selections=selections), predictions


def _csv_row(cell):
    legacy = dict(cell, parameter=None, relative_error=0., factor=1.)
    metric = _metric_csv(legacy)
    item = {key: cell[key] for key in ('replicate', 'split', 'case_id', 'candidate')}
    item.update(cell['center_bias'])
    item.update({key: metric[key] for key in METRIC_FIELDS[7:]})
    summary = cell['review_summary']
    item['total_true_class3'] = summary['total_true_class3']
    for name in REVIEW_METRICS:
        item.update({f'{name}_{field}': value for field, value in summary[name].items()})
    return item


def _fixed_protocol():
    return dict(scope=SCOPE, relative_error_bound=BOUND, grid=[list(x) for x in GRID],
                cases=list(CASES), splits=list(SPLITS),
                replicates=[spec['name'] for spec in REPLICATES],
                candidates=list(CANDIDATES), cell_count=324, summary_count=108,
                prediction_lists=108, finite_sample_count=27,
                hypothetical_width=True, continuous_domain_guarantee=False,
                confidence_bound=False, field_calibrated=False, live_integration=False,
                human_scientific_approval='pending')


def _source_check(source, teacher, digest, teacher_hash):
    after = sha256(source / 'manifest.json')
    teacher_after = sha256(teacher)
    passed = readback_study(source)['passed']
    if after != digest or teacher_after != teacher_hash or not passed:
        raise ValueError('source or teacher changed during evaluation')
    return dict(source_manifest_before=digest, source_manifest_after=after,
                teacher_before=teacher_hash, teacher_after=teacher_after,
                source_readback_passed=passed, equal=True)


def _content_audit(output):
    protocol = read_json(output / 'protocol.json')
    if any(protocol.get(key) != value for key, value in _fixed_protocol().items()):
        raise ValueError('protocol registry/grid or metadata mismatch')
    if protocol['analysis_code_sha256'] != _code_hashes():
        raise ValueError('analysis code hash mismatch')
    source = Path(protocol['source_dir'])
    digest = protocol['source_manifest_sha256']
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('source manifest hash format mismatch')
    expected_command = [sys.executable, '-B', '-m', 'tools.roof_mechanics.uncertainty_study',
                        '--source-dir', str(source), '--output-dir', str(output),
                        '--expected-manifest-sha256', digest]
    if protocol['reproducible_command'] != expected_command or protocol['source_kind'] != 'mechanics_simulation':
        raise ValueError('protocol command or source kind mismatch')
    try:
        created = datetime.fromisoformat(protocol['created_utc'])
        if created.utcoffset() != timezone.utc.utcoffset(created):
            raise ValueError('timestamp must use UTC')
    except (TypeError, ValueError) as exc:
        raise ValueError('protocol timestamp mismatch') from exc
    source_protocol = read_json(source / 'protocol.json')
    teacher = protocol['teacher_csv']
    if (teacher != dict(path=source_protocol['teacher_csv']['path'],
                        sha256=source_protocol['teacher_csv']['before_sha256']) or
            protocol['source_file_hashes'] != read_json(source / 'manifest.json')['files'] or
            protocol['source_software_versions'] != source_protocol['software_versions'] or
            protocol['analysis_software_versions'] != software_versions()):
        raise ValueError('source or software metadata mismatch')
    _, saved_models = _models(source)
    if protocol['saved_models'] != saved_models:
        raise ValueError('saved model metadata mismatch')
    check = _source_check(source, teacher['path'], digest, teacher['sha256'])
    if read_json(output / 'source-check.json') != check:
        raise ValueError('source check mismatch')
    expected, predictions = _calculate(source, independent=True)
    if (read_json(output / 'results.json') != expected or
            read_json(output / 'predictions.json') != predictions):
        raise ValueError('uncertainty prediction or score mismatch')
    if protocol['original_selections'] != expected['selections']:
        raise ValueError('original selections mismatch')
    with (output / 'comparison.csv').open(encoding='utf-8', newline='') as stream:
        reader = csv.DictReader(stream)
        if tuple(reader.fieldnames or ()) != CSV_FIELDS:
            raise ValueError('comparison CSV header mismatch')
        observed = list(reader)
    expected_csv = [{key: '' if value is None else str(value)
                     for key, value in _csv_row(cell).items()} for cell in expected['cells']]
    if observed != expected_csv or len(observed) != 324:
        raise ValueError('comparison CSV content or coverage mismatch')
    return dict(passed=True, cells_checked=324, summaries_checked=108,
                predictions_checked=108, csv_rows_checked=324,
                source_readback_passed=True, source_manifest_unchanged=True,
                teacher_csv_unchanged=True, independent_denominator_reconstruction=True,
                analysis_code_provenance='pre_scoring_code_hashes_verified')


def readback_uncertainty(output_dir):
    output = Path(output_dir).resolve()
    verified = verify_manifest(output)
    manifest = read_json(output / 'manifest.json')
    actual_files = {path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file()}
    if (manifest['algorithm'] != 'sha256' or manifest['excludes'] != ['manifest.json'] or
            set(manifest['files']) != OUTPUT_FILES or actual_files != OUTPUT_FILES | {'manifest.json'}):
        raise ValueError('manifest coverage or format mismatch')
    audit = _content_audit(output)
    if read_json(output / 'readback.json') != audit:
        raise ValueError('readback record mismatch')
    return dict(audit, manifest=verified)


def run_uncertainty_study(source_dir, output_dir, expected_manifest_sha256):
    source, output = Path(source_dir).resolve(), Path(output_dir).resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('source/output overlap')
    if output.exists():
        raise FileExistsError(output)
    if not isinstance(expected_manifest_sha256, str) or not re.fullmatch('[0-9a-f]{64}', expected_manifest_sha256):
        raise ValueError('expected manifest hash must be 64 lowercase hexadecimal digits')
    if sha256(source / 'manifest.json') != expected_manifest_sha256:
        raise ValueError('source manifest hash mismatch')
    readback_study(source)
    source_protocol = read_json(source / 'protocol.json')
    teacher = source_protocol['teacher_csv']
    teacher_hash = sha256(teacher['path'])
    _, saved_models = _models(source)  # Contract checked before analysis output or scoring.
    selections = {spec['name']: read_json(source / spec['name'] / 'metrics.json')['selection']
                  for spec in REPLICATES}
    output.mkdir(parents=True, exist_ok=False)
    protocol = dict(**_fixed_protocol(), created_utc=datetime.now(timezone.utc).isoformat(),
                    source_kind='mechanics_simulation', source_dir=str(source),
                    source_manifest_sha256=expected_manifest_sha256,
                    source_file_hashes=read_json(source / 'manifest.json')['files'],
                    analysis_code_sha256=_code_hashes(),
                    source_software_versions=source_protocol['software_versions'],
                    analysis_software_versions=software_versions(),
                    teacher_csv=dict(path=teacher['path'], sha256=teacher_hash),
                    saved_models=saved_models, original_selections=selections,
                    reproducible_command=[sys.executable, '-B', '-m',
                        'tools.roof_mechanics.uncertainty_study', '--source-dir', str(source),
                        '--output-dir', str(output), '--expected-manifest-sha256', expected_manifest_sha256])
    write_json(output / 'protocol.json', protocol)
    results, predictions = _calculate(source)
    write_json(output / 'results.json', results)
    write_json(output / 'predictions.json', predictions)
    with (output / 'comparison.csv').open('x', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(_csv_row(cell) for cell in results['cells'])
    write_json(output / 'source-check.json', _source_check(
        source, teacher['path'], expected_manifest_sha256, teacher_hash))
    write_json(output / 'readback.json', _content_audit(output))
    files = {path.relative_to(output).as_posix(): dict(sha256=sha256(path), bytes=path.stat().st_size)
             for path in sorted(output.rglob('*')) if path.is_file()}
    write_json(output / 'manifest.json', dict(algorithm='sha256', excludes=['manifest.json'], files=files))
    return dict(output_dir=str(output), readback=readback_uncertainty(output),
                selections=selections, source_manifest_sha256=expected_manifest_sha256)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=FORMAL_SOURCE)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--expected-manifest-sha256', default=FORMAL_SHA256)
    args = parser.parse_args()
    print(run_uncertainty_study(args.source_dir, args.output_dir, args.expected_manifest_sha256))


if __name__ == '__main__':
    main()
