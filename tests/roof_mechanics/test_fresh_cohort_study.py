from copy import deepcopy
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.roof_mechanics.dataset import generate_dataset
from tools.roof_mechanics.known_limits import eligible_rows, engineering_feature_matrix
from tools.roof_mechanics.known_limits_study import run_study
from tools.roof_mechanics.run_experiment import read_json, sha256
from tools.roof_mechanics.uncertainty_study import _models
from tools.roof_mechanics.fresh_cohort_study import (
    ANALYSIS_CODE_FILES, COHORTS, run_fresh_cohort_study, readback_fresh_cohort,
    scenario_fingerprint, audit_disjointness,
)


class FreshCohortTests(unittest.TestCase):
    def test_canonical_fingerprint_and_duplicate_detection(self):
        scene = dict(scenario_id='old', domain='in_domain', family='load_ramp',
                     parameters=dict(length_m=8., capacity_n=500000.))
        same = dict(scene, scenario_id='new',
                    parameters=dict(capacity_n=500000., length_m=8.))
        canonical = json.dumps({key: scene[key] for key in ('domain', 'family', 'parameters')},
                               sort_keys=True, separators=(',', ':'), allow_nan=False)
        self.assertEqual(scenario_fingerprint(scene), hashlib.sha256(canonical.encode()).hexdigest())
        self.assertEqual(scenario_fingerprint(scene), scenario_fingerprint(same))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            audit_disjointness([scene], {'fresh': dict(scenarios=[same])})
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            audit_disjointness([], {'a': dict(scenarios=[scene]), 'b': dict(scenarios=[same])})
        changed = dict(scene, parameters=dict(length_m=9.))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            audit_disjointness([], {'a': dict(scenarios=[scene, changed])})
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            audit_disjointness([scene], {'a': dict(scenarios=[changed])})
        with self.assertRaises(ValueError):
            scenario_fingerprint(dict(scene, parameters=dict(length_m=float('nan'))))

    def test_frozen_integration_and_independent_audit(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'source', Path(temp) / 'out'
            run_study(source, 10, 2, 12)  # The sole fitting operation is the original fixture.
            source_bytes = {str(p): p.read_bytes() for p in source.rglob('*') if p.is_file()}
            teacher = Path(read_json(source / 'protocol.json')['teacher_csv']['path'])
            teacher_bytes = teacher.read_bytes()
            digest = sha256(source / 'manifest.json')
            guards = ExitStack()
            self.addCleanup(guards.close)
            guards.enter_context(patch('xgboost.XGBClassifier.fit', side_effect=AssertionError('no fit')))
            guards.enter_context(patch('sklearn.ensemble.RandomForestClassifier.fit', side_effect=AssertionError('no fit')))
            for kwargs in (dict(in_domain_scenarios=True), dict(ood_scenarios=-1),
                           dict(in_domain_scenarios=0), dict(ood_scenarios=False),
                           dict(in_domain_scenarios=1.5), dict(steps=3), dict(steps='12'),
                           dict(steps=float('inf')), dict(steps=True)):
                with self.assertRaises((ValueError, TypeError)):
                    run_fresh_cohort_study(source, output, digest, **kwargs)
            for invalid in ('0' * 64, digest.upper(), 'x'):
                with self.assertRaisesRegex(ValueError, 'hash'):
                    run_fresh_cohort_study(source, output, invalid, 2, 2, 12)
            self.assertFalse(output.exists())
            with self.assertRaisesRegex(ValueError, 'overlap'):
                run_fresh_cohort_study(source, source / 'child', digest, 2, 2, 12)
            invalid_cohorts = deepcopy(COHORTS)
            invalid_cohorts[0]['in_domain_seed'] = 41101
            with patch('tools.roof_mechanics.fresh_cohort_study.COHORTS', invalid_cohorts):
                with self.assertRaisesRegex(ValueError, 'seed'):
                    run_fresh_cohort_study(source, output, digest, 2, 2, 12)
            self.assertFalse(output.exists())
            calls = []
            def before_generate(*args, **kwargs):
                protocol = read_json(output / 'protocol.json')
                root = Path(__file__).resolve().parents[2]
                self.assertEqual(protocol['analysis_code_sha256'],
                                 {name: sha256(root / name) for name in ANALYSIS_CODE_FILES})
                self.assertIn('tools/roof_mechanics/solver.py', ANALYSIS_CODE_FILES)
                self.assertEqual(protocol['cohorts'], list(COHORTS))
                calls.append(kwargs)
                return generate_dataset(*args, **kwargs)
            with patch('xgboost.XGBClassifier.fit', side_effect=AssertionError('no fit')), \
                 patch('sklearn.ensemble.RandomForestClassifier.fit', side_effect=AssertionError('no fit')), \
                 patch('tools.roof_mechanics.fresh_cohort_study.generate_dataset', side_effect=before_generate):
                result = run_fresh_cohort_study(source, output, digest, 2, 2, 12)
                self.assertTrue(result['readback']['passed'])
                self.assertEqual(len(calls), 4)  # Two generation calls and two deterministic replays.
                with patch('tools.roof_mechanics.fresh_cohort_study.sample_limit_error_predictions',
                           side_effect=AssertionError('production sampling')), \
                     patch('tools.roof_mechanics.fresh_cohort_study.engineering_feature_matrix',
                           side_effect=AssertionError('production transform')):
                    audit = readback_fresh_cohort(output)
                    self.assertTrue(audit['passed'])
            self.assertEqual(audit['datasets_checked'], 2)
            self.assertEqual(audit['regenerated_scenarios'], 8)
            self.assertEqual(audit['manifest']['checked_files'], 9)
            records = read_json(output / 'predictions.json')
            results = read_json(output / 'results.json')
            self.assertEqual(len(records), 108)
            self.assertEqual(len(results['cells']), 324)
            self.assertEqual(len(results['summaries']), 108)
            models, _ = _models(source)
            for spec in COHORTS:
                dataset = read_json(output / 'cohorts' / spec['name'] / 'dataset.json')
                rows = eligible_rows(dataset)
                for record in [r for r in records if r['replicate'] == spec['name']]:
                    domain = 'in_domain' if record['split'] == 'fresh_in_domain' else 'ood'
                    indices = [i for i, row in enumerate(rows) if row['domain'] == domain]
                    self.assertEqual(record['row_indices'], indices)
                    self.assertEqual(record['source_model_replicate'], spec['model_replicate'])
                    self.assertTrue(all(rows[i]['scenario_id'].startswith(spec['name']) for i in indices))
                    if record['case_id'] == 'exact':
                        matrix = engineering_feature_matrix([rows[i] for i in indices], dataset['scenarios'])
                        expected = models[spec['model_replicate']].predict(matrix).astype(int).tolist()
                        self.assertEqual(record['center'], expected)
            manifest = read_json(output / 'manifest.json')
            files = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
            self.assertEqual(set(manifest['files']) | {'manifest.json'}, files)
            self.assertEqual(len(files), 10)
            with self.assertRaises(FileExistsError):
                run_fresh_cohort_study(source, output, digest, 2, 2, 12)
            original = {str(p): p.read_bytes() for p in output.rglob('*') if p.is_file()}
            def edit_json(relative, mutate):
                path = output / relative
                content = read_json(path)
                mutate(content)
                path.write_text(json.dumps(content, allow_nan=False), encoding='utf-8')
                altered = read_json(output / 'manifest.json')
                altered['files'][relative] = dict(sha256=sha256(path), bytes=path.stat().st_size)
                (output / 'manifest.json').write_text(json.dumps(altered), encoding='utf-8')
            def restore():
                for name, data in original.items():
                    Path(name).write_bytes(data)  # Only temporary fixture bytes are restored.
            csv_path = output / 'comparison.csv'
            csv_path.write_bytes(csv_path.read_bytes() + b'tamper')
            with self.assertRaisesRegex(ValueError, 'manifest'):
                readback_fresh_cohort(output)
            restore()
            edit_json('cohorts/fresh-replicate-a/dataset.json',
                      lambda d: d['scenarios'][0]['parameters'].update(length_m=9.))
            with self.assertRaisesRegex(ValueError, 'deterministic replay'):
                readback_fresh_cohort(output)
            restore()
            edit_json('predictions.json', lambda p: p[0]['center'].__setitem__(0, (p[0]['center'][0]+1)%4))
            with self.assertRaisesRegex(ValueError, 'prediction or score'):
                readback_fresh_cohort(output)
            restore()
            self.assertEqual({str(p): p.read_bytes() for p in source.rglob('*') if p.is_file()}, source_bytes)
            self.assertEqual(teacher.read_bytes(), teacher_bytes)


if __name__ == '__main__':
    unittest.main()
