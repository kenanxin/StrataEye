import unittest

import numpy as np

from tools.roof_mechanics.limit_uncertainty import (
    limit_error_grid,
    sample_limit_error_predictions,
)


class RecordingPredictor:
    def __init__(self):
        self.calls = []

    def predict(self, features):
        self.calls.append(features.copy())
        return np.clip(np.floor(features[:, 3] * 3), 0, 3)


class LimitUncertaintyTests(unittest.TestCase):
    def test_grid_arithmetic_and_no_mutation(self):
        features = np.array([[.1, .005, .2, .9]])
        original = features.copy()
        model = RecordingPredictor()
        result = sample_limit_error_predictions(model, features)
        self.assertEqual(result, dict(center=[2], lower=[2], upper=[3],
            review_required=[True], possible_class3=[True],
            sampled_classes=[[2, 3]], sample_count=27))
        candidates = np.concatenate(model.calls)
        factors = candidates / original
        for column in range(4):
            np.testing.assert_allclose(np.unique(factors[:, column]), [.8, 1, 1.2])
        np.testing.assert_allclose(factors[:, 0], factors[:, 1])
        self.assertTrue(np.any(np.all(candidates == original, axis=1)))
        np.testing.assert_array_equal(features, original)
        self.assertEqual(len(limit_error_grid()), 27)

    def test_zero_width(self):
        model = RecordingPredictor()
        self.assertEqual(limit_error_grid(0), ((0., 0., 0.),))
        result = sample_limit_error_predictions(model, [[.1, .005, .2, .9]], 0)
        self.assertEqual(result['sample_count'], 1)
        self.assertEqual(result['center'], result['lower'])
        self.assertEqual(result['center'], result['upper'])
        self.assertEqual(result['review_required'], [False])

    def test_actual_nonmonotone_classes_and_center(self):
        class Nonmonotone:
            def predict(self, x):
                return np.where(np.isclose(x[:, 3], .9), 3, 0)
        result = sample_limit_error_predictions(Nonmonotone(), [[.1, .005, .2, .9]])
        self.assertEqual(result['center'], [3])
        self.assertEqual(result['sampled_classes'], [[0, 3]])
        self.assertEqual(result['lower'], [0])
        self.assertEqual(result['upper'], [3])

    def test_empty_without_call(self):
        for bound, count in [(0, 1), (.2, 27)]:
            model = RecordingPredictor()
            result = sample_limit_error_predictions(model, np.empty((0, 4)), bound)
            self.assertEqual(result['sample_count'], count)
            self.assertTrue(all(value == [] for key, value in result.items() if key != 'sample_count'))
            self.assertEqual(model.calls, [])

    def test_invalid_features(self):
        invalid = [True, [1, 2, 3, 4], np.zeros((2, 3)), np.zeros((1, 4, 1)),
            [[True, 0, 0, 0]], [[1j, 0, 0, 0]], [['1', 0, 0, 0]],
            [[None, 0, 0, 0]], [[np.nan, 0, 0, 0]], [[np.inf, 0, 0, 0]]]
        for features in invalid:
            with self.subTest(features=repr(features)), self.assertRaises((TypeError, ValueError)):
                sample_limit_error_predictions(RecordingPredictor(), features)

    def test_invalid_bound(self):
        for bound in [True, '0.2', .2j, None, np.nan, np.inf, -.1, 1, 2]:
            with self.subTest(bound=bound), self.assertRaises((TypeError, ValueError)):
                limit_error_grid(bound)

    def test_invalid_predictions(self):
        for values in [0, [[0]], [], [4], [-1], [.5], [np.nan], [np.inf],
                       [True], ['1'], [1j], [None]]:
            class BadPredictor:
                def predict(self, features):
                    return values
            with self.subTest(values=values), self.assertRaises((TypeError, ValueError)):
                sample_limit_error_predictions(BadPredictor(), [[.1, .005, .2, .9]])

    def test_overflow_fails_explicitly(self):
        model = RecordingPredictor()
        with self.assertRaises(ValueError):
            sample_limit_error_predictions(model, [[np.finfo(float).max, 0, 0, 0]])

    def test_predictor_cannot_mutate_center_input(self):
        class MutatingPredictor:
            def predict(self, features):
                features[:] = 0
                return np.zeros(len(features))
        features = np.array([[.1, .005, .2, .9]])
        original = features.copy()
        sample_limit_error_predictions(MutatingPredictor(), features)
        np.testing.assert_array_equal(features, original)

    def test_multiple_rows(self):
        result = sample_limit_error_predictions(RecordingPredictor(),
            [[.1, .005, .2, .9], [.1, .005, .2, .1]])
        self.assertEqual(result['center'], [2, 0])
        self.assertEqual(result['sampled_classes'], [[2, 3], [0]])
        self.assertEqual(result['review_required'], [True, False])
        self.assertEqual(result['possible_class3'], [True, False])


if __name__ == '__main__':
    unittest.main()
