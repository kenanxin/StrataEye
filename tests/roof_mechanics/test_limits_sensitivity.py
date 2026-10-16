import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.roof_mechanics.known_limits_study import run_study
from tools.roof_mechanics.run_experiment import read_json, sha256
from tools.roof_mechanics.limits_sensitivity import (
    CASE_REGISTRY, biased_feature_matrix, readback_sensitivity, run_sensitivity,
)


class LimitsSensitivityTests(unittest.TestCase):
    def setUp(self):
        self.scenes = [dict(scenario_id='s', parameters=dict(
            deflection_limit_mm=20., capacity_n=500000., bending_strength_mpa=5.),
            trajectory=[dict(step=0)])]
        self.rows = [dict(scenario_id='s', max_deflection_mm=2.,
                          deflection_increment_mm_per_step=.1,
                          max_support_force_kn=100., max_bending_stress_mpa=2.,
                          target_class=2)]

    def test_arithmetic_and_immutability(self):
        scenes, rows = copy.deepcopy(self.scenes), copy.deepcopy(self.rows)
        np.testing.assert_allclose(biased_feature_matrix(self.rows, self.scenes, None, 0),
                                   [[.1, .005, .2, .4]])
        np.testing.assert_allclose(biased_feature_matrix(self.rows, self.scenes, 'capacity_n', -.2),
                                   [[.1, .005, .25, .4]])
        np.testing.assert_allclose(biased_feature_matrix(self.rows, self.scenes, 'deflection_limit_mm', .1),
                                   [[2/22, .1/22, .2, .4]])
        np.testing.assert_allclose(biased_feature_matrix(self.rows, self.scenes, 'bending_strength_mpa', .2),
                                   [[.1, .005, .2, 2/6]])
        np.testing.assert_array_equal(biased_feature_matrix(self.rows, self.scenes, 'capacity_n', 0),
                                      biased_feature_matrix(self.rows, self.scenes, None, 0))
        self.assertEqual((self.scenes, self.rows), (scenes, rows))

    def test_invalid_bias_and_registry(self):
        self.assertEqual(len(CASE_REGISTRY), 19)
        self.assertEqual(CASE_REGISTRY[0], dict(case_id='exact', parameter=None, relative_error=0))
        self.assertEqual(CASE_REGISTRY[-1]['case_id'], 'bending_strength_mpa_plus20')
        for parameter, error in ((None, .1), ('unknown', .1), ('capacity_n', True),
                                 ('capacity_n', float('nan')), ('capacity_n', -1),
                                 ('capacity_n', float('inf'))):
            with self.subTest(parameter=parameter, error=error), self.assertRaises((TypeError, ValueError)):
                biased_feature_matrix(self.rows, self.scenes, parameter, error)
        altered = copy.deepcopy(self.scenes)
        del altered[0]['parameters']['capacity_n']
        with self.assertRaises((KeyError, ValueError)):
            biased_feature_matrix(self.rows, altered, 'capacity_n', .1)
        altered = copy.deepcopy(self.scenes)
        altered[0]['parameters']['capacity_n'] = True
        with self.assertRaises((TypeError, ValueError)):
            biased_feature_matrix(self.rows, altered, 'capacity_n', .2)

    def test_no_fit_persistence_integrity_and_tamper(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'source', Path(temp) / 'out'
            run_study(source, 10, 2, 12)  # Fixture creation precedes the no-fit guard.
            digest = sha256(source / 'manifest.json')
            with self.assertRaisesRegex(ValueError, 'hash'):
                run_sensitivity(source, output, '0' * 64)
            self.assertFalse(output.exists())
            with self.assertRaisesRegex(ValueError, 'overlap'):
                run_sensitivity(source, source / 'child', digest)
            preflight_output = Path(temp) / 'preflight'
            def inspect_before_scoring(_):
                protocol = read_json(preflight_output / 'protocol.json')
                root = Path(__file__).resolve().parents[2]
                self.assertEqual(protocol['analysis_code_sha256'][
                    'tools/roof_mechanics/limits_sensitivity.py'],
                    sha256(root / 'tools/roof_mechanics/limits_sensitivity.py'))
                self.assertEqual(protocol['analysis_code_sha256'][
                    'tests/roof_mechanics/test_limits_sensitivity.py'], sha256(Path(__file__)))
                self.assertEqual(len(protocol['analysis_code_sha256']), 7)
                self.assertIn('reproducible_command', protocol)
                self.assertNotIn('command', protocol)
                raise RuntimeError('stopped before scoring')
            with patch('tools.roof_mechanics.limits_sensitivity._calculate', side_effect=inspect_before_scoring):
                with self.assertRaisesRegex(RuntimeError, 'stopped before scoring'):
                    run_sensitivity(source, preflight_output, digest)
            with patch('xgboost.XGBClassifier.fit', side_effect=AssertionError('sensitivity must not fit')), \
                 patch('sklearn.ensemble.RandomForestClassifier.fit', side_effect=AssertionError('sensitivity must not fit')):
                result = run_sensitivity(source, output, digest)
            self.assertTrue(result['readback']['passed'])
            self.assertEqual(read_json(output / 'protocol.json')['reproducible_command'][-2:],
                             ['--expected-manifest-sha256', digest])
            self.assertTrue(readback_sensitivity(output)['passed'])
            self.assertEqual(len(read_json(output / 'results.json')['cells']), 156)
            with self.assertRaises(FileExistsError):
                run_sensitivity(source, output, digest)
            csv_path = output / 'comparison.csv'
            with csv_path.open('a', encoding='utf-8') as target:
                target.write('tamper')
            with self.assertRaisesRegex(ValueError, 'manifest'):
                readback_sensitivity(output)


if __name__ == '__main__':
    unittest.main()
