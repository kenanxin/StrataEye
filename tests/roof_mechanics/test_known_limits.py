import unittest

import numpy as np

from tools.roof_mechanics.known_limits import (
    ENGINEERING_FEATURE_NAMES, eligible_rows, engineering_feature_matrix, evaluate_events,
)


def scenario(sid='a', ratios=(.2, .4, .8, 1.1)):
    return {'scenario_id': sid, 'parameters': {'deflection_limit_mm': 20.,
            'capacity_n': 500000., 'bending_strength_mpa': 5.},
            'trajectory': [{'step': i, 'current_ratio': ratio} for i, ratio in enumerate(ratios)]}


def row(sid='a', step=1, target_class=3):
    return {'scenario_id': sid, 'step': step, 'target_class': target_class,
            'max_deflection_mm': 2., 'deflection_increment_mm_per_step': .1,
            'max_support_force_kn': 100., 'max_bending_stress_mpa': 2.}


class KnownLimitsTests(unittest.TestCase):
    def test_exact_units_names_and_current_only_fields(self):
        self.assertEqual(ENGINEERING_FEATURE_NAMES, ('deflection_utilization',
            'deflection_increment_utilization_per_step', 'support_utilization', 'bending_utilization'))
        original = row()
        scenarios = [scenario()]
        first = engineering_feature_matrix([original], scenarios)
        np.testing.assert_allclose(first, [[.1, .005, .2, .4]])
        altered = dict(original, target_class=0, target_future_ratio=999., current_ratio=999.,
                       q_crit_n_per_m=999., family='roof_softening')
        scenarios[0]['parameters'].update(q_crit_n_per_m=999., support_loss_fraction=999.)
        np.testing.assert_array_equal(first, engineering_feature_matrix([altered], scenarios))

    def test_feature_validation(self):
        valid = row()
        for parameters in ({'deflection_limit_mm': 0.}, {'capacity_n': float('nan')},
                           {'bending_strength_mpa': -1.}, {'capacity_n': None}):
            with self.subTest(parameters=parameters), self.assertRaises((ValueError, TypeError, KeyError)):
                broken = scenario()
                broken['parameters'].update(parameters)
                engineering_feature_matrix([valid], [broken])
        for broken in ([scenario(), scenario()], []):
            with self.assertRaises(ValueError):
                engineering_feature_matrix([valid], broken)
        bad = dict(valid, max_deflection_mm=float('inf'))
        with self.assertRaises(ValueError):
            engineering_feature_matrix([bad], [scenario()])

    def test_eligible_rows_excludes_zero_without_mutation(self):
        rows = [row(step=0), row(step=1), row(step=2)]
        data = {'rows': rows}
        self.assertEqual(eligible_rows(data), rows[1:])
        self.assertIs(eligible_rows(data)[0], rows[1])
        self.assertEqual(len(rows), 3)
        for step in (-1, 1.5, True):
            with self.assertRaises((ValueError, TypeError)):
                eligible_rows({'rows': [row(step=step)]})

    def test_events_count_once_earliest_lead_and_negative_burden(self):
        scenarios = [scenario(), scenario('b', (.2, .4, .7, .9, .95))]
        rows = [row(step=1), row(step=2), row('b', step=1, target_class=2)]
        result = evaluate_events(rows, [2, 3, 2], scenarios, 2)
        self.assertEqual(result['true_limit_events'], 1)
        self.assertEqual(result['timely_detected_events'], 1)
        self.assertEqual(result['timely_detection_fraction'], 1.)
        self.assertEqual(result['lead_steps'], [2])
        self.assertEqual(result['non_limit_scenarios'], 1)
        self.assertEqual(result['alerted_non_limit_scenarios'], 1)
        self.assertEqual(result['non_limit_alert_fraction'], 1.)
        self.assertIsNone(evaluate_events([], [], [], 3)['timely_detection_fraction'])
        self.assertIsNone(evaluate_events([], [], [], 3)['non_limit_alert_fraction'])

    def test_event_denominators_include_only_represented_scenarios(self):
        scenarios = [scenario(), scenario('b', (.2, .4, .7, .9, .95)),
                     scenario('unrepresented', (.2, .4, .8, 1.1))]
        result = evaluate_events([row('b', step=1, target_class=2)], [0], scenarios, 3)
        self.assertEqual(result['true_limit_events'], 0)
        self.assertEqual(result['non_limit_scenarios'], 1)
        self.assertEqual(result['alerted_non_limit_scenarios'], 0)
        self.assertIsNone(result['timely_detection_fraction'])
        self.assertEqual(result['non_limit_alert_fraction'], 0.)

    def test_events_reject_invalid_evidence(self):
        base = row(step=1)
        for rows, predictions, scenarios, level in (
            ([base], [], [scenario()], 2), ([base, base], [3, 3], [scenario()], 2),
            ([base], [4], [scenario()], 2), ([base], [3], [scenario()], 1),
            ([row(step=3)], [3], [scenario()], 2),
            ([row(target_class=2)], [3], [scenario()], 2),
            ([row('missing')], [3], [scenario()], 2),
            ([dict(base, step=True)], [3], [scenario()], 2),
            ([row(step=0)], [3], [scenario()], 2),
            ([dict(base, current_ratio=1.)], [3], [scenario()], 2),
        ):
            with self.subTest(rows=rows, predictions=predictions, level=level), self.assertRaises((ValueError, TypeError)):
                evaluate_events(rows, predictions, scenarios, level)


if __name__ == '__main__':
    unittest.main()
