import json
import unittest
from unittest.mock import patch

from tools.roof_mechanics.dataset import CLASS_NAMES, FEATURE_NAMES, classify_ratio, generate_dataset, supervised_rows


def trajectory(ratios):
    return [dict(step=i, current_ratio=r, current_class=classify_ratio(r), max_deflection_mm=10 * r,
                 max_support_force_kn=20 * r, max_bending_stress_mpa=2 * r) for i, r in enumerate(ratios)]


class DatasetTests(unittest.TestCase):
    def test_exact_thresholds(self):
        for ratio, expected in [(0, 0), (.499999, 0), (.5, 1), (.799999, 1), (.8, 2), (.999999, 2), (1, 3), (2, 3)]:
            self.assertEqual(classify_ratio(ratio), expected)
        for bad in (-1, float('nan'), float('inf'), True, '1'):
            with self.assertRaises((ValueError, TypeError)):
                classify_ratio(bad)
        self.assertEqual(len(FEATURE_NAMES), 4)
        self.assertEqual(len(CLASS_NAMES), 4)

    def test_future_excludes_current_and_incomplete_negative_tail(self):
        states = trajectory([.9, .1, .2, .3, .4])
        rows = supervised_rows(states, 's1', 'in_domain', 'load_ramp')
        self.assertEqual([row['step'] for row in rows], [0, 1])
        self.assertEqual(rows[0]['target_future_ratio'], .3)
        self.assertEqual(rows[0]['current_class'], 2)
        self.assertEqual(rows[0]['target_class'], 0)
        self.assertEqual(rows[0]['deflection_increment_mm_per_step'], 0)
        self.assertAlmostEqual(rows[1]['deflection_increment_mm_per_step'], -8)

    def test_short_confirmed_crossing_and_no_threshold_features(self):
        rows = supervised_rows(trajectory([.2, .4, .7, 1.05]), 's1', 'in_domain', 'load_ramp')
        self.assertEqual(len(rows), 3)
        self.assertEqual([row['target_class'] for row in rows], [3, 3, 3])
        self.assertTrue(all(row['current_ratio'] < 1 for row in rows))
        self.assertEqual(supervised_rows(trajectory([1.1]), 's1', 'in_domain', 'load_ramp'), [])

    def test_supervised_helper_rejects_post_crossing_evidence(self):
        with self.assertRaises(ValueError):
            supervised_rows(trajectory([.2, 1.1, 1.2]), 's1', 'in_domain', 'load_ramp')

    def test_determinism_domains_parameters_and_causal_rows(self):
        first = generate_dataset(6, 3, 8)
        second = generate_dataset(6, 3, 8)
        self.assertEqual(first, second)
        json.dumps(first, allow_nan=False)
        scenarios = {s['scenario_id']: s for s in first['scenarios']}
        self.assertEqual(len(scenarios), 9)
        self.assertEqual(set(s['family'] for s in scenarios.values()), {'load_ramp', 'support_softening', 'roof_softening'})
        for scenario in scenarios.values():
            parameters = scenario['parameters']
            length = parameters['length_m']
            self.assertTrue(6 <= length <= 12 if scenario['domain'] == 'in_domain' else 12 < length <= 14)
            self.assertGreaterEqual(length / parameters['thickness_m'], 10)
            self.assertEqual(parameters['width_m'], 1)
            self.assertTrue(.3 <= parameters['thickness_m'] <= .6)
            self.assertTrue(4e9 <= parameters['young_modulus_pa'] <= 20e9)
            self.assertTrue(all(2e6 <= k <= 20e6 for k in parameters['spring_stiffnesses_n_per_m']))
            self.assertTrue(.4e6 <= parameters['capacity_n'] <= 1.2e6)
            self.assertEqual(parameters['spring_capacities_n'], [parameters['capacity_n']] * 3)
            self.assertTrue(1 <= parameters['bending_strength_mpa'] <= 6)
            self.assertTrue(.10 <= parameters['start_load_fraction'] <= .35)
            self.assertTrue(.90 <= parameters['end_load_fraction'] <= 1.30)
            self.assertEqual(parameters['spring_positions_m'], [length * p for p in (.25, .5, .75)])
            states = scenario['trajectory']
            self.assertAlmostEqual(states[0]['current_ratio'], parameters['start_load_fraction'], places=8)
            for state in states:
                progress = state['progress']
                self.assertAlmostEqual(state['young_modulus_pa'] / parameters['young_modulus_pa'],
                                       1 - parameters['young_modulus_loss_fraction'] * progress**2)
                for node, stiffness in zip(parameters['spring_nodes'], parameters['spring_stiffnesses_n_per_m']):
                    self.assertAlmostEqual(state['spring_stiffnesses_n_per_m'][node] / stiffness,
                                           1 - parameters['support_loss_fraction'] * progress**2)
            self.assertTrue(all(state['current_ratio'] < 1 for state in states[:-1]))
            self.assertEqual(scenario['stop_reason'], 'first_limit_crossing' if states[-1]['current_ratio'] >= 1 else 'completed_load_schedule')
            self.assertEqual([state['step'] for state in states], list(range(len(states))))
        for row in first['rows']:
            scenario = scenarios[row['scenario_id']]
            states = scenario['trajectory']
            step = row['step']
            future = states[step + 1:step + 4]
            self.assertTrue(len(future) == 3 or future[-1]['current_ratio'] >= 1)
            self.assertEqual(row['target_future_ratio'], max(state['current_ratio'] for state in future))
            self.assertLess(row['current_ratio'], 1)
            self.assertEqual(row['source_kind'], 'mechanics_simulation')
            self.assertEqual(row['domain'], scenario['domain'])
            self.assertEqual([row[name] for name in FEATURE_NAMES if name != 'deflection_increment_mm_per_step'],
                             [states[step][name] for name in FEATURE_NAMES if name != 'deflection_increment_mm_per_step'])
            expected_increment = states[step]['max_deflection_mm'] - states[step - 1]['max_deflection_mm'] if step else 0
            self.assertEqual(row['deflection_increment_mm_per_step'], expected_increment)

    def test_invalid_counts_and_verification_gate(self):
        for args in ((-1, 1, 8), (1, True, 8), (1, 1, 1), (1.5, 1, 8)):
            with self.assertRaises((ValueError, TypeError)):
                generate_dataset(*args)
        with patch('tools.roof_mechanics.dataset.verify_solver', side_effect=ValueError('verification failed')):
            with self.assertRaisesRegex(ValueError, 'verification failed'):
                generate_dataset(1, 1, 8)
        with patch('tools.roof_mechanics.dataset.verify_solver', return_value={'passed': False}):
            with self.assertRaises(ValueError):
                generate_dataset(1, 1, 8)

    def test_domain_seed_streams_are_independent(self):
        together = generate_dataset(1, 1, 5)
        only_ood = generate_dataset(0, 1, 5)
        self.assertEqual(together['scenarios'][1], only_ood['scenarios'][0])

    def test_seed_contract(self):
        default = generate_dataset(1, 1, 5)
        explicit = generate_dataset(1, 1, 5, in_domain_seed=1729, ood_seed=3141)
        custom = generate_dataset(1, 1, 5, in_domain_seed=41101, ood_seed=42101)
        self.assertEqual(default, explicit)
        self.assertNotEqual(default['scenarios'], custom['scenarios'])
        self.assertEqual(custom['metadata']['seeds'], {'in_domain': 41101, 'ood': 42101})
        for seed in (-1, 1.5, True, '2'):
            with self.subTest(seed=seed), self.assertRaises((ValueError, TypeError)):
                generate_dataset(0, 0, 5, in_domain_seed=seed)


if __name__ == '__main__':
    unittest.main()
