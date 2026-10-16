import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from tools.roof_mechanics.dataset import generate_dataset
from tools.roof_mechanics.known_limits_study import (
    select_model, train_ablation, run_study, readback_study, _readback_replicate,
)
from tools.roof_mechanics.known_limits import eligible_rows, engineering_feature_matrix
from tools.roof_mechanics.run_experiment import read_json, verify_manifest
from tools.roof_mechanics.train import feature_matrix, split_scenarios


class KnownLimitsStudyTests(unittest.TestCase):
    def test_validation_policy_and_tie(self):
        def score(f1, recall, low, support=4):
            return dict(macro_f1=f1, recall=[0, 0, 0, recall], support=[4, 4, 4, support],
                        low_class_false_positive=dict(fraction=low))
        self.assertEqual(select_model({'random_forest': score(.6, .8, .1),
                                       'xgboost': score(.7, .7, .1)})['selected_model'], 'random_forest')
        self.assertEqual(select_model({'random_forest': score(.6, .8, .1),
                                       'xgboost': score(.6, .8, .1)})['selected_model'], 'xgboost')
        choice = select_model({'random_forest': score(.4, .9, .1),
                               'xgboost': score(.3, .9, .1)})
        self.assertEqual((choice['selected_model'], choice['eligible']), ('random_forest', False))
        self.assertFalse(select_model({'random_forest': score(.9, .9, .1, 0),
                                       'xgboost': score(.9, .9, .3)})['eligible'])

    def test_training_contract_and_heldout_noninfluence(self):
        dataset = generate_dataset(10, 2, 12, in_domain_seed=41101, ood_seed=42101)
        from xgboost import XGBClassifier
        original = XGBClassifier.fit
        with patch('tools.roof_mechanics.known_limits_study.XGBClassifier.fit', autospec=True) as fit:
            # Observe the real fit through a side effect so eval_set stays active.
            fit.side_effect = lambda self, *args, **kwargs: original(self, *args, **kwargs)
            first, models, predictions = train_ablation(dataset, 43101)
        self.assertEqual(set(models), {'raw4', 'known_limits4'})
        self.assertEqual(first['split_overlap_count'], 0)
        self.assertEqual(first['feature_names']['raw4'].__len__(), 4)
        self.assertEqual(first['feature_names']['known_limits4'].__len__(), 4)
        split = first['split_row_indices']
        self.assertEqual(len(fit.call_args_list), 2)
        for call in fit.call_args_list:
            args, kwargs = call
            self.assertEqual(args[1].shape[1], 4)
            self.assertEqual(len(args[2]), len(split['train']))
            self.assertEqual(len(kwargs['eval_set']), 1)
            self.assertEqual(len(kwargs['eval_set'][0][1]), len(split['validation']))
            self.assertEqual(len(kwargs['sample_weight']), len(split['train']))
        changed = copy.deepcopy(dataset)
        for index in split['test'] + split['ood']:
            row = [r for r in changed['rows'] if r['step'] >= 1][index]
            row['target_class'] = (row['target_class'] + 1) % 4
        # Event integrity is tested in actual runs; isolate fitting/selection here.
        with patch('tools.roof_mechanics.known_limits_study.evaluate_events', return_value={}):
            second, second_models, _ = train_ablation(changed, 43101)
        self.assertEqual(first['selection'], second['selection'])
        rows = eligible_rows(dataset)
        indices = split['train'] + split['validation']
        matrices = dict(raw4=feature_matrix(rows),
                        known_limits4=engineering_feature_matrix(rows, dataset['scenarios']))
        for protocol in models:
            for name in models[protocol]:
                self.assertEqual(models[protocol][name].n_features_in_, 4)
                self.assertEqual(second_models[protocol][name].n_features_in_, 4)
                np.testing.assert_array_equal(
                    models[protocol][name].predict(matrices[protocol][indices]),
                    second_models[protocol][name].predict(matrices[protocol][indices]),
                    err_msg=f'{protocol}/{name} fitted behavior changed after held-out labels changed')
        json.dumps(first, allow_nan=False)
        self.assertEqual(set(predictions), {'validation', 'test', 'ood'})

    def test_missing_class_rejected(self):
        dataset = generate_dataset(10, 2, 12, in_domain_seed=41101, ood_seed=42101)
        for row in dataset['rows']:
            if row['target_class'] == 3:
                row['target_class'] = 2
        with self.assertRaisesRegex(ValueError, 'all four classes'):
            train_ablation(dataset, 43101)

    def test_smoke_persistence_readback_manifest_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'study'
            summary = run_study(output, 10, 2, 12)
            self.assertTrue(summary['readback']['passed'])
            self.assertTrue(verify_manifest(output)['passed'])
            self.assertTrue(readback_study(output)['passed'])
            self.assertTrue((output / 'replicate-a' / 'models' / 'known_limits4' / 'xgboost.json').is_file())
            self.assertEqual(read_json(output / 'protocol.json')['replicates'][0]['split_seed'], 43101)
            directory = output / 'replicate-a'
            spec = read_json(output / 'protocol.json')['replicates'][0]
            requested = dict(in_domain_scenarios=10, ood_scenarios=2, steps=12)
            self.assertTrue(_readback_replicate(directory, spec, requested)['passed'])
            for altered in (dict(in_domain_scenarios=9), dict(ood_scenarios=3), dict(steps=13)):
                with self.subTest(altered=altered), self.assertRaisesRegex(ValueError, 'count|steps'):
                    _readback_replicate(directory, spec, dict(requested, **altered))
            metadata_path = directory / 'metadata.json'
            original_metadata = metadata_path.read_bytes()
            try:
                for altered in (dict(in_domain_scenarios=9), dict(ood_scenarios=3),
                                dict(steps=13), dict(row_count=999)):
                    metadata = read_json(metadata_path)
                    metadata.update(altered)
                    metadata_path.write_text(json.dumps(metadata), encoding='utf-8')
                    with self.subTest(altered=altered), self.assertRaisesRegex(ValueError, 'count|steps'):
                        _readback_replicate(directory, spec, requested)
                    metadata_path.write_bytes(original_metadata)
            finally:
                metadata_path.write_bytes(original_metadata)
            with patch('tools.roof_mechanics.known_limits_study.generate_dataset') as generate:
                with self.assertRaises(FileExistsError):
                    run_study(output, 10, 2, 12)
                generate.assert_not_called()
            with (output / 'replicate-a' / 'metrics.json').open('a', encoding='utf-8') as target:
                target.write(' ')
            with self.assertRaisesRegex(ValueError, 'manifest mismatch'):
                readback_study(output)


if __name__ == '__main__':
    unittest.main()
