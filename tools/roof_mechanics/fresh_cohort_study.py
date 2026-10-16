"""Frozen-model, fresh-seed same-simulator offline recheck and archive audit."""

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from numbers import Integral
from pathlib import Path
import re
import sys

import numpy as np

from .dataset import classify_ratio, generate_dataset, supervised_rows
from .known_limits import eligible_rows, engineering_feature_matrix
from .known_limits_study import REPLICATES, readback_study
from .limit_uncertainty import sample_limit_error_predictions
from .limits_sensitivity import FORMAL_SOURCE, FORMAL_SHA256, _source_replicate, _score
from .run_experiment import read_json, sha256, verify_manifest, write_json
from .train import software_versions
from .uncertainty_study import (
    ANALYSIS_CODE_FILES as PREVIOUS_CODE_FILES, BOUND, CASES, GRID, CANDIDATES,
    CSV_FIELDS, _models, _summary, _independent_sample, _csv_row,
)


COHORTS = (
    dict(name='fresh-replicate-a', model_replicate='replicate-a', in_domain_seed=51101, ood_seed=52101),
    dict(name='fresh-replicate-b', model_replicate='replicate-b', in_domain_seed=51102, ood_seed=52102),
)
DOMAINS = (('fresh_in_domain', 'in_domain'), ('fresh_ood', 'ood'))
SCOPE = 'fresh_seed_same_simulator_recheck'
ANALYSIS_CODE_FILES = (
    'tools/roof_mechanics/fresh_cohort_study.py',
    'tests/roof_mechanics/test_fresh_cohort_study.py',
    'tools/roof_mechanics/solver.py', *PREVIOUS_CODE_FILES,
)
OUTPUT_FILES = {
    'protocol.json', 'results.json', 'predictions.json', 'comparison.csv',
    'source-check.json', 'readback.json', 'disjointness.json',
    'cohorts/fresh-replicate-a/dataset.json', 'cohorts/fresh-replicate-b/dataset.json',
}


def scenario_fingerprint(scenario):
    """Identify full scenario parameters independently of IDs or key order."""
    canonical = json.dumps({key: scenario[key] for key in ('domain', 'family', 'parameters')},
                           sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def audit_disjointness(original_scenarios, cohorts):
    """Reject duplicated IDs globally and any repeated full parameter scenario."""
    ids, fingerprints, groups = set(), set(), {}
    for name, scenes in [('original', original_scenarios),
                         *((name, dataset['scenarios']) for name, dataset in cohorts.items())]:
        entries = []
        for scene in scenes:
            identity = scene['scenario_id']
            if not isinstance(identity, str) or not identity.strip():
                raise ValueError('scenario ID must be a nonempty string')
            fingerprint = scenario_fingerprint(scene)
            if identity in ids or fingerprint in fingerprints:
                raise ValueError('duplicate scenario ID or canonical parameter fingerprint')
            ids.add(identity)
            fingerprints.add(fingerprint)
            entries.append(dict(scenario_id=identity, sha256=fingerprint))
        groups[name] = entries
    return dict(passed=True, fingerprint_contract='canonical_json_domain_family_parameters_sha256',
                groups=groups, original_scenarios=len(original_scenarios),
                fresh_scenarios=sum(len(d['scenarios']) for d in cohorts.values()),
                unique_ids=len(ids), unique_fingerprints=len(fingerprints),
                old_new_duplicates=0, new_new_duplicates=0, duplicate_ids=0)


def _counts(in_count, out_count, steps):
    for name, value, minimum in [('in_domain_scenarios', in_count, 1),
                                 ('ood_scenarios', out_count, 1), ('steps', steps, 4)]:
        if isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral) or value < minimum:
            raise ValueError(f'{name} must be a non-bool integer >= {minimum}')
    return dict(in_domain_scenarios=int(in_count), ood_scenarios=int(out_count), steps=int(steps))


def _seed_contract(source_protocol):
    if source_protocol['replicates'] != list(REPLICATES):
        raise ValueError('original source seed contract mismatch')
    originals = {spec[key] for spec in source_protocol['replicates']
                 for key in ('in_domain_seed', 'ood_seed', 'split_seed')}
    expected = [('fresh-replicate-a', 'replicate-a', 51101, 52101),
                ('fresh-replicate-b', 'replicate-b', 51102, 52102)]
    observed = [(s['name'], s['model_replicate'], s['in_domain_seed'], s['ood_seed']) for s in COHORTS]
    seeds = [s[key] for s in COHORTS for key in ('in_domain_seed', 'ood_seed')]
    if (observed != expected or len(set(seeds)) != 4 or originals.intersection(seeds) or
            any(isinstance(s, bool) or not isinstance(s, Integral) or s < 0 for s in seeds)):
        raise ValueError('fresh seed contract mismatch or overlap with original seeds')


def _code_hashes():
    root = Path(__file__).resolve().parents[2]
    return {name: sha256(root / name) for name in ANALYSIS_CODE_FILES}


def _fixed_protocol():
    return dict(scope=SCOPE, frozen=True, cohorts=list(COHORTS),
                groups=[dict(split=split, domain=domain) for split, domain in DOMAINS],
                relative_error_bound=BOUND, grid=[list(x) for x in GRID], cases=list(CASES),
                candidates=list(CANDIDATES), cell_count=324, summary_count=108,
                prediction_lists=108, finite_sample_count=27, excluded_step=0,
                future_window_steps=3, class_thresholds=[.5, .8, 1.],
                evaluation_only=True, fitting=False, model_selection=False,
                hypothetical_width=True, continuous_domain_guarantee=False,
                confidence_bound=False, field_calibrated=False, live_integration=False,
                human_scientific_approval='pending', submission_ready=False,
                fingerprint_contract='canonical_json_domain_family_parameters_sha256')


def _command(source, output, digest, requested):
    command = [sys.executable, '-B', '-m', 'tools.roof_mechanics.fresh_cohort_study',
               '--source-dir', str(source), '--output-dir', str(output),
               '--expected-manifest-sha256', digest]
    for key in ('in_domain_scenarios', 'ood_scenarios', 'steps'):
        command.extend(['--' + key.replace('_', '-'), str(requested[key])])
    return command


def _source_state(source, digest):
    if sha256(source / 'manifest.json') != digest:
        raise ValueError('source manifest hash mismatch')
    verify_manifest(source)
    protocol = read_json(source / 'protocol.json')
    _seed_contract(protocol)
    teacher = dict(path=protocol['teacher_csv']['path'], sha256=protocol['teacher_csv']['before_sha256'])
    if sha256(teacher['path']) != teacher['sha256']:
        raise ValueError('teacher CSV hash mismatch')
    saved_models = {}
    selections = {}
    for spec in REPLICATES:
        name = spec['name']
        path = source / name / 'models' / 'known_limits4' / 'xgboost.json'
        saved_models[name] = dict(path=str(path), sha256=sha256(path), protocol='known_limits4',
                                 model='xgboost', selection='predeclared; original validation choice retained separately')
        selections[name] = read_json(source / name / 'metrics.json')['selection']
    return dict(source_file_hashes=read_json(source / 'manifest.json')['files'],
                source_software_versions=protocol['software_versions'],
                analysis_software_versions=software_versions(), teacher_csv=teacher,
                saved_models=saved_models, original_selections=selections)


def _source_check(protocol):
    source = Path(protocol['source_dir'])
    state = _source_state(source, protocol['source_manifest_sha256'])
    if any(protocol.get(key) != value for key, value in state.items()):
        raise ValueError('source/model/teacher metadata mismatch')
    return dict(source_manifest_before=protocol['source_manifest_sha256'],
                source_manifest_after=sha256(source / 'manifest.json'),
                source_files_before=protocol['source_file_hashes'], source_files_after=state['source_file_hashes'],
                models_before=protocol['saved_models'], models_after=state['saved_models'],
                teacher_before=protocol['teacher_csv']['sha256'], teacher_after=state['teacher_csv']['sha256'],
                equal=True)


def _prefix(dataset, name):
    for scene in dataset['scenarios']:
        scene['scenario_id'] = f'{name}-{scene["scenario_id"]}'
    for row in dataset['rows']:
        row['scenario_id'] = f'{name}-{row["scenario_id"]}'


def _generate(spec, requested):
    dataset = generate_dataset(**requested, in_domain_seed=spec['in_domain_seed'], ood_seed=spec['ood_seed'])
    _prefix(dataset, spec['name'])
    return dataset


def _calculate(models, cohorts, selections, independent=False):
    cells, predictions, summaries = [], [], []
    for spec in COHORTS:
        dataset = cohorts[spec['name']]
        scenes = dataset['scenarios']
        if independent:
            raw = [row for scene in scenes for row in supervised_rows(
                scene['trajectory'], scene['scenario_id'], scene['domain'], scene['family'])]
            if raw != dataset['rows']:
                raise ValueError('raw stored row reconstruction mismatch')
            rows = [row for row in raw if row['step'] >= 1]
        else:
            rows = eligible_rows(dataset)
        for split, domain in DOMAINS:
            indices = [i for i, row in enumerate(rows) if row['domain'] == domain]
            selected = [rows[i] for i in indices]
            exact = None if independent else engineering_feature_matrix(selected, scenes)
            if not independent:
                print(f'Scoring {spec["name"]}/{split}: {len(indices)} eligible rows, 27 conditions', flush=True)
            for case in CASES:
                if independent:
                    envelope, physical = _independent_sample(models[spec['model_replicate']], selected, scenes, case)
                else:
                    ed, ec, es = case['relative_errors']
                    center = exact / np.asarray([1+ed, 1+ed, 1+ec, 1+es])
                    envelope = sample_limit_error_predictions(models[spec['model_replicate']], center, BOUND)
                    physical = [classify_ratio(max(value[[0, 2, 3]])) for value in center]
                identity = dict(replicate=spec['name'], split=split, case_id=case['case_id'],
                                source_model_replicate=spec['model_replicate'])
                summary = dict(**identity, **_summary(selected, envelope))
                summaries.append(summary)
                predictions.append(dict(**identity, row_indices=indices, **envelope, estimated_current_limit=physical))
                for candidate, values in zip(CANDIDATES, (envelope['center'], envelope['upper'], physical)):
                    cells.append(dict(**identity, center_bias=case['center_bias'], candidate=candidate,
                                      rows=len(indices), scenarios=len({r['scenario_id'] for r in selected}),
                                      score=_score(rows, scenes, indices, values), review_summary=summary))
    return dict(cells=cells, summaries=summaries, selections=selections), predictions


def _metadata_audit(output):
    protocol = read_json(output / 'protocol.json')
    if any(protocol.get(key) != value for key, value in _fixed_protocol().items()):
        raise ValueError('protocol scope/cohorts/grid/cases mismatch')
    requested = _counts(protocol['in_domain_scenarios'], protocol['ood_scenarios'], protocol['steps'])
    if protocol['analysis_code_sha256'] != _code_hashes():
        raise ValueError('analysis code hash mismatch')
    source = Path(protocol['source_dir'])
    if source != source.resolve() or source == output or source in output.parents or output in source.parents:
        raise ValueError('source/output overlap or path mismatch')
    digest = protocol['source_manifest_sha256']
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('source manifest hash format mismatch')
    if (protocol['reproducible_command'] != _command(source, output, digest, requested) or
            protocol['source_kind'] != 'mechanics_simulation' or
            protocol['expected_files'] != sorted(OUTPUT_FILES | {'manifest.json'})):
        raise ValueError('protocol command/source kind/file metadata mismatch')
    try:
        created = datetime.fromisoformat(protocol['created_utc'])
        if created.utcoffset() != timezone.utc.utcoffset(created):
            raise ValueError('timestamp must use UTC')
    except (TypeError, ValueError) as exc:
        raise ValueError('protocol timestamp mismatch') from exc
    if read_json(output / 'source-check.json') != _source_check(protocol):
        raise ValueError('source check mismatch')
    return protocol, requested


def _content_audit(output):
    protocol, requested = _metadata_audit(output)
    source = Path(protocol['source_dir'])
    readback_study(source)
    models, metadata = _models(source)
    if metadata != protocol['saved_models']:
        raise ValueError('native model metadata mismatch')
    cohorts = {}
    for spec in COHORTS:
        name = spec['name']
        archived = read_json(output / 'cohorts' / name / 'dataset.json')
        replayed = _generate(spec, requested)
        # Compare JSON representations because generator dictionaries have integer spring-node keys.
        if archived != json.loads(json.dumps(replayed, allow_nan=False)):
            raise ValueError('dataset deterministic replay mismatch')
        cohorts[name] = archived
    old = [scene for spec in REPLICATES for scene in _source_replicate(source, spec['name'])[2]]
    if read_json(output / 'disjointness.json') != audit_disjointness(old, cohorts):
        raise ValueError('disjointness field mismatch')
    results, predictions = _calculate(models, cohorts, protocol['original_selections'], independent=True)
    if (read_json(output / 'results.json') != results or read_json(output / 'predictions.json') != predictions):
        raise ValueError('fresh cohort prediction or score mismatch')
    with (output / 'comparison.csv').open(encoding='utf-8', newline='') as stream:
        reader = csv.DictReader(stream)
        if tuple(reader.fieldnames or ()) != CSV_FIELDS:
            raise ValueError('comparison CSV header mismatch')
        observed = list(reader)
    expected = [{key: '' if value is None else str(value) for key, value in _csv_row(cell).items()}
                for cell in results['cells']]
    if observed != expected or len(observed) != 324:
        raise ValueError('comparison CSV content or coverage mismatch')
    return dict(passed=True, cells_checked=324, summaries_checked=108, predictions_checked=108,
                csv_rows_checked=324, datasets_checked=2,
                regenerated_scenarios=2*(requested['in_domain_scenarios']+requested['ood_scenarios']),
                reconstructed_raw_rows=sum(len(d['rows']) for d in cohorts.values()),
                eligible_rows_checked=sum(len(eligible_rows(d)) for d in cohorts.values()),
                deterministic_replay=True, replay_is_independent_source=False,
                disjointness_checked=True, source_readback_passed=True,
                source_manifest_unchanged=True, saved_models_unchanged=True, teacher_csv_unchanged=True,
                independent_denominator_reconstruction=True,
                analysis_code_provenance='pre_generation_code_hashes_verified')


def _verify_archive(output):
    verified = verify_manifest(output)
    manifest = read_json(output / 'manifest.json')
    actual = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
    if (manifest['algorithm'] != 'sha256' or manifest['excludes'] != ['manifest.json'] or
            set(manifest['files']) != OUTPUT_FILES or actual != OUTPUT_FILES | {'manifest.json'}):
        raise ValueError('manifest coverage or format mismatch')
    return verified


def readback_fresh_cohort(output_dir):
    """Verify hashes, regenerate both datasets and audit every archived score."""
    output = Path(output_dir).resolve()
    verified = _verify_archive(output)
    audit = _content_audit(output)
    if read_json(output / 'readback.json') != audit:
        raise ValueError('readback record mismatch')
    return dict(audit, manifest=verified)


def run_fresh_cohort_study(source_dir, output_dir, expected_manifest_sha256,
                           in_domain_scenarios=100, ood_scenarios=100, steps=32):
    """Create a new archive; all original models and selection metadata stay frozen."""
    source, output = Path(source_dir).resolve(), Path(output_dir).resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('source/output overlap')
    if output.exists():
        raise FileExistsError(output)
    requested = _counts(in_domain_scenarios, ood_scenarios, steps)
    if not isinstance(expected_manifest_sha256, str) or not re.fullmatch('[0-9a-f]{64}', expected_manifest_sha256):
        raise ValueError('expected manifest hash must be 64 lowercase hexadecimal digits')
    if sha256(source / 'manifest.json') != expected_manifest_sha256:
        raise ValueError('source manifest hash mismatch')
    readback_study(source)
    state = _source_state(source, expected_manifest_sha256)
    models, saved_models = _models(source)
    if saved_models != state['saved_models']:
        raise ValueError('native model metadata mismatch')
    code_hashes = _code_hashes()
    output.mkdir(parents=True, exist_ok=False)
    protocol = dict(**_fixed_protocol(), **requested, **state,
                    created_utc=datetime.now(timezone.utc).isoformat(), source_kind='mechanics_simulation',
                    source_dir=str(source), source_manifest_sha256=expected_manifest_sha256,
                    analysis_code_sha256=code_hashes, expected_files=sorted(OUTPUT_FILES | {'manifest.json'}),
                    reproducible_command=_command(source, output, expected_manifest_sha256, requested))
    write_json(output / 'protocol.json', protocol)
    cohorts = {}
    for spec in COHORTS:
        print(f'Generating {spec["name"]}: {in_domain_scenarios}+{ood_scenarios} scenarios', flush=True)
        dataset = _generate(spec, requested)
        location = output / 'cohorts' / spec['name']
        location.mkdir(parents=True)
        write_json(location / 'dataset.json', dataset)
        cohorts[spec['name']] = dataset
    old = [scene for spec in REPLICATES for scene in _source_replicate(source, spec['name'])[2]]
    write_json(output / 'disjointness.json', audit_disjointness(old, cohorts))
    results, predictions = _calculate(models, cohorts, state['original_selections'])
    write_json(output / 'results.json', results)
    write_json(output / 'predictions.json', predictions)
    with (output / 'comparison.csv').open('x', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(_csv_row(cell) for cell in results['cells'])
    write_json(output / 'source-check.json', _source_check(protocol))
    print('Auditing fresh datasets and all frozen-model predictions', flush=True)
    audit = _content_audit(output)  # Exactly one full audit before the manifest is frozen.
    write_json(output / 'readback.json', audit)
    files = {p.relative_to(output).as_posix(): dict(sha256=sha256(p), bytes=p.stat().st_size)
             for p in sorted(output.rglob('*')) if p.is_file()}
    write_json(output / 'manifest.json', dict(algorithm='sha256', excludes=['manifest.json'], files=files))
    verified = _verify_archive(output)
    _metadata_audit(output)  # Final metadata/hash check avoids another generation/prediction pass.
    return dict(output_dir=str(output), readback=dict(audit, manifest=verified),
                selections=state['original_selections'], source_manifest_sha256=expected_manifest_sha256)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=FORMAL_SOURCE)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--expected-manifest-sha256', default=FORMAL_SHA256)
    parser.add_argument('--in-domain-scenarios', type=int, default=100)
    parser.add_argument('--ood-scenarios', type=int, default=100)
    parser.add_argument('--steps', type=int, default=32)
    args = parser.parse_args()
    print(json.dumps(run_fresh_cohort_study(args.source_dir, args.output_dir,
        args.expected_manifest_sha256, args.in_domain_scenarios, args.ood_scenarios, args.steps),
        ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == '__main__':
    main()
