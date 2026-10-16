import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.roof_mechanics.dataset import FEATURE_NAMES
from tools.roof_mechanics.train import evaluate, feature_matrix, split_scenarios, train_models
from tools.roof_mechanics.run_experiment import read_json, run_experiment, sha256, verify_manifest


def small_dataset():
    rows = []
    for domain, count in [('in_domain', 10), ('ood', 2)]:
        for group in range(count):
            for label in range(4):
                rows.append(dict(zip(FEATURE_NAMES, [float(label + 1)] * 4),
                                 scenario_id=f'{domain}-{group}', domain=domain,
                                 target_class=label, current_class=min(label, 2)))
    return dict(rows=rows)


class TrainingTests(unittest.TestCase):
    def test_group_isolation_counts_determinism_and_ood(self):
        rows = small_dataset()['rows']
        split = split_scenarios(rows)
        self.assertEqual(split, split_scenarios(rows))
        ids = {name: {rows[i]['scenario_id'] for i in idx} for name, idx in split.items()}
        self.assertEqual({name: len(value) for name, value in ids.items()},
                         dict(train=6, validation=2, test=2, ood=2))
        for name, group_ids in ids.items():
            for other, other_ids in ids.items():
                if name != other:
                    self.assertFalse(group_ids & other_ids)
        self.assertEqual(sorted(i for indices in split.values() for i in indices), list(range(len(rows))))
        rows += [dict(rows[0], scenario_id='in_domain-extra')]
        extra = split_scenarios(rows)
        self.assertEqual([len({rows[i]['scenario_id'] for i in extra[name]})
                          for name in ('train', 'validation', 'test')], [6, 2, 3])

    def test_exact_allowlist_and_invalid_values(self):
        row = dict(zip(FEATURE_NAMES, [1., 2., 3., 4.]), target_class=999,
                   current_ratio=999, target_future_ratio=999, material_strength=999)
        np.testing.assert_array_equal(feature_matrix([row]), [[1., 2., 3., 4.]])
        self.assertEqual(feature_matrix([]).shape, (0, 4))
        for bad in (float('nan'), float('inf'), True, '2'):
            with self.subTest(bad=bad), self.assertRaises((ValueError, TypeError)):
                feature_matrix([dict(row, max_deflection_mm=bad)])
        del row[FEATURE_NAMES[0]]
        with self.assertRaises(ValueError):
            feature_matrix([row])

    def test_missing_support_fixed_classes_and_fractions(self):
        metric = evaluate([0, 0, 3, 3], [0, 1, 2, 3])
        self.assertEqual(metric['support'], [2, 0, 0, 2])
        self.assertEqual(metric['recall'], [.5, None, None, .5])
        self.assertEqual(metric['high_class_false_negative'], dict(count=1, denominator=2, fraction=.5))
        self.assertEqual(metric['low_class_false_positive'], dict(count=1, denominator=2, fraction=.5))
        self.assertEqual(np.asarray(metric['confusion_matrix']).shape, (4, 4))
        self.assertIsNone(evaluate([1], [1])['high_class_false_negative']['fraction'])
        self.assertIsNone(evaluate([], [])['macro_f1'])
        json.dumps(metric, allow_nan=False)
        for truth, pred in [([4], [0]), ([0], []), ([True], [0]), ([1.5], [0])]:
            with self.assertRaises((ValueError, TypeError)):
                evaluate(truth, pred)

    def test_invalid_domain_group_and_insufficient_groups(self):
        with self.assertRaisesRegex(ValueError, '10'):
            split_scenarios(small_dataset()['rows'][:20])
        for changes in ({'domain': 'unknown'}, {'domain': 'ood', 'scenario_id': 'in_domain-1'},
                        {'scenario_id': ''}, {'scenario_id': 1}):
            rows = small_dataset()['rows']
            rows[0] = dict(rows[0], **changes)
            with self.subTest(changes=changes), self.assertRaises((ValueError, TypeError)):
                split_scenarios(rows)

    def test_training_missing_class_rejected_before_fit(self):
        dataset = small_dataset()
        dataset['rows'] = [row for row in dataset['rows'] if row['target_class'] != 3]
        with self.assertRaisesRegex(ValueError, 'all four classes'):
            train_models(dataset)

    def test_training_protocol_and_models(self):
        metrics, models = train_models(small_dataset())
        self.assertEqual(set(models), {'random_forest', 'xgboost', 'shallow_tree'})
        self.assertEqual(metrics['split_overlap_count'], 0)
        self.assertEqual(metrics['feature_names'], list(FEATURE_NAMES))
        self.assertEqual(metrics['selection']['split'], 'validation')
        self.assertEqual(metrics['selection']['tie_break'], 'xgboost')
        self.assertEqual(metrics['selection']['selected_model'], 'xgboost')
        for model in models.values():
            self.assertEqual(model.n_features_in_, 4)
        self.assertEqual(models['random_forest'].n_estimators, 200)
        self.assertEqual(models['shallow_tree'].max_depth, 3)
        self.assertEqual(models['xgboost'].early_stopping_rounds, 25)
        self.assertEqual(metrics['xgboost_weight_source'], 'training labels only')
        for name in ('validation', 'test', 'ood'):
            self.assertEqual(set(metrics['evaluation'][name]),
                             {'random_forest', 'xgboost', 'shallow_tree', 'majority', 'current_class'})
        json.dumps(metrics, allow_nan=False)

    def test_validation_only_early_stopping_and_held_out_labels_do_not_select(self):
        from tools.roof_mechanics.train import XGBClassifier
        dataset = small_dataset()
        split = split_scenarios(dataset['rows'])
        matrix = feature_matrix(dataset['rows'])
        original_fit = XGBClassifier.fit
        calls = []
        def inspected_fit(model, x, y, **kwargs):
            calls.append((x.copy(), y.copy(), kwargs))
            return original_fit(model, x, y, **kwargs)
        with patch.object(XGBClassifier, 'fit', inspected_fit):
            first, first_models = train_models(dataset)
            for index in split['test'] + split['ood']:
                dataset['rows'][index]['target_class'] = (dataset['rows'][index]['target_class'] + 1) % 4
            second, second_models = train_models(dataset)
        self.assertEqual(first['selection'], second['selection'])
        for name in first_models:
            np.testing.assert_array_equal(first_models[name].predict(matrix), second_models[name].predict(matrix))
        for x, y, kwargs in calls:
            np.testing.assert_array_equal(x, matrix[split['train']])
            self.assertEqual(len(kwargs['eval_set']), 1)
            np.testing.assert_array_equal(kwargs['eval_set'][0][0], matrix[split['validation']])
            self.assertEqual(len(kwargs['sample_weight']), len(split['train']))

    def test_small_experiment_persisted_artifacts_and_hash_tamper(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'experiment'
            summary = run_experiment(output, 10, 2, 12)
            self.assertTrue(summary['readback']['passed'])
            self.assertTrue(summary['manifest_verification']['passed'])
            metadata = read_json(output / 'metadata.json')
            self.assertEqual(metadata['feature_names'], list(FEATURE_NAMES))
            self.assertEqual(metadata['future_window_steps'], 3)
            self.assertEqual(read_json(output / 'source-manifest.json')['teacher_csv']['before_sha256'],
                             read_json(output / 'source-manifest.json')['teacher_csv']['after_sha256'])
            self.assertEqual(summary['manifest_verification']['manifest_sha256'], sha256(output / 'manifest.json'))
            self.assertTrue((output / 'models' / 'random_forest.joblib').is_file())
            with (output / 'metadata.json').open('a', encoding='utf-8') as target:
                target.write(' ')
            with self.assertRaisesRegex(ValueError, 'manifest mismatch'):
                verify_manifest(output)

    def test_json_readback_rejects_nonfinite_and_overflow(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'bad.json'
            for content in ('{"value": NaN}', '{"value": Infinity}', '{"value": 1e999}'):
                path.write_text(content, encoding='utf-8')
                with self.subTest(content=content), self.assertRaises(ValueError):
                    read_json(path)

    def test_output_existing_directory_rejected_before_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'existing'
            output.mkdir()
            sentinel = output / 'keep.txt'
            sentinel.write_text('original', encoding='utf-8')
            with patch('tools.roof_mechanics.run_experiment.generate_dataset') as generate:
                with self.assertRaises(FileExistsError):
                    run_experiment(output)
                generate.assert_not_called()
            self.assertEqual(sentinel.read_text(encoding='utf-8'), 'original')


if __name__ == '__main__':
    unittest.main()
