from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.roof_mechanics.known_limits_study import run_study
from tools.roof_mechanics.run_experiment import read_json, sha256, write_json
from tools.roof_mechanics.uncertainty_study import (
    ANALYSIS_CODE_FILES, CASES, readback_uncertainty, run_uncertainty_study,
    _independent_sample, _summary,
)


class UncertaintyStudyTests(unittest.TestCase):
    def test_independent_denominators_and_summary_denominators(self):
        rows = [dict(scenario_id='s', max_deflection_mm=2., deflection_increment_mm_per_step=.1,
                     max_support_force_kn=100., max_bending_stress_mpa=2., target_class=3)]
        scenes = [dict(scenario_id='s', parameters=dict(deflection_limit_mm=20.,
                       capacity_n=500000., bending_strength_mpa=5.))]
        captured = []
        class Model:
            def predict(self, matrix):
                captured.append(matrix.copy())
                return np.asarray([2])
        _, physical = _independent_sample(Model(), rows, scenes, CASES[-1])
        np.testing.assert_allclose(captured[0], [[2/24*.8, .1/24*.8, 100/600*.8, 2/6*.8]])
        np.testing.assert_allclose(captured[13], [[2/24, .1/24, 100/600, 2/6]])
        self.assertEqual(physical, [0])
        summary = _summary([dict(scenario_id='s', target_class=3),
                            dict(scenario_id='s', target_class=1)],
                           dict(center=[2, 0], upper=[3, 2], lower=[2, 0],
                                review_required=[True, True], sampled_classes=[[2, 3], [0, 2]]))
        self.assertEqual(summary['disagreement_scenarios'],
                         dict(numerator=1, denominator=1, fraction=1.))
        self.assertEqual(summary['sampled_range_inclusion']['numerator'], 2)
        self.assertEqual(summary['sampled_class_set_inclusion']['numerator'], 1)
        self.assertEqual(summary['marked_center_class3_underestimates']['denominator'], 1)
        self.assertEqual(summary['center_underestimates_with_sampled_upper3']['numerator'], 1)
        empty = _summary([], dict(center=[], upper=[], lower=[], review_required=[], sampled_classes=[]))
        self.assertIsNone(empty['sampled_range_inclusion']['fraction'])

    def test_frozen_integration_and_independent_tamper_audit(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'source', Path(temp) / 'out'
            run_study(source, 10, 2, 12)  # Only fixture creation may fit.
            source_bytes = {str(p): p.read_bytes() for p in source.rglob('*') if p.is_file()}
            teacher = Path(read_json(source / 'protocol.json')['teacher_csv']['path'])
            teacher_bytes = teacher.read_bytes()
            digest = sha256(source / 'manifest.json')
            for invalid in ('0' * 64, digest.upper()):
                with self.assertRaisesRegex(ValueError, 'hash'):
                    run_uncertainty_study(source, output, invalid)
            self.assertFalse(output.exists())
            with self.assertRaisesRegex(ValueError, 'overlap'):
                run_uncertainty_study(source, source / 'child', digest)
            stopped = Path(temp) / 'stopped'
            def before_scoring(_):
                protocol = read_json(stopped / 'protocol.json')
                root = Path(__file__).resolve().parents[2]
                self.assertEqual(protocol['analysis_code_sha256'],
                                 {name: sha256(root / name) for name in ANALYSIS_CODE_FILES})
                self.assertEqual(len(CASES), 27)
                self.assertEqual(len({tuple(c['relative_errors']) for c in CASES}), 27)
                self.assertEqual(protocol['relative_error_bound'], .20)
                self.assertEqual(protocol['cell_count'], 324)
                self.assertEqual(protocol['summary_count'], 108)
                self.assertEqual(protocol['scope'], 'post_hoc_same_source_finite_sampling')
                raise RuntimeError('pre-scoring stop')
            with patch('tools.roof_mechanics.uncertainty_study._calculate', side_effect=before_scoring):
                with self.assertRaisesRegex(RuntimeError, 'pre-scoring stop'):
                    run_uncertainty_study(source, stopped, digest)
            with patch('xgboost.XGBClassifier.fit', side_effect=AssertionError('no fit')), \
                 patch('sklearn.ensemble.RandomForestClassifier.fit', side_effect=AssertionError('no fit')):
                result = run_uncertainty_study(source, output, digest)
                self.assertTrue(result['readback']['passed'])
                # Independent audit cannot use either production sampling or its center transform.
                with patch('tools.roof_mechanics.uncertainty_study.sample_limit_error_predictions',
                           side_effect=AssertionError('not independent')), \
                     patch('tools.roof_mechanics.uncertainty_study.engineering_feature_matrix',
                           side_effect=AssertionError('not independent')):
                    self.assertTrue(readback_uncertainty(output)['passed'])
            results = read_json(output / 'results.json')
            self.assertEqual(len(results['cells']), 324)
            self.assertEqual(len(results['summaries']), 108)
            predictions = read_json(output / 'predictions.json')
            for item in predictions:
                if item['case_id'] == 'exact':
                    original = read_json(source / item['replicate'] / 'predictions.json')
                    expected = original[item['split']]['known_limits4']
                    self.assertEqual(item['center'], expected['xgboost'])
                    self.assertEqual(item['estimated_current_limit'], expected['current_limit'])
            with self.assertRaises(FileExistsError):
                run_uncertainty_study(source, output, digest)
            csv_path = output / 'comparison.csv'
            csv_bytes = csv_path.read_bytes()
            with csv_path.open('a', encoding='utf-8') as stream:
                stream.write('tamper')
            with self.assertRaisesRegex(ValueError, 'manifest'):
                readback_uncertainty(output)
            csv_path.write_bytes(csv_bytes)
            predictions[0]['center'][0] = (predictions[0]['center'][0] + 1) % 4
            (output / 'predictions.json').unlink()
            write_json(output / 'predictions.json', predictions)
            manifest = read_json(output / 'manifest.json')
            manifest['files']['predictions.json'] = dict(sha256=sha256(output / 'predictions.json'),
                                                        bytes=(output / 'predictions.json').stat().st_size)
            (output / 'manifest.json').unlink()
            write_json(output / 'manifest.json', manifest)
            with self.assertRaisesRegex(ValueError, 'prediction or score'):
                readback_uncertainty(output)
            self.assertEqual({str(p): p.read_bytes() for p in source.rglob('*') if p.is_file()}, source_bytes)
            self.assertEqual(teacher.read_bytes(), teacher_bytes)


if __name__ == '__main__':
    unittest.main()
