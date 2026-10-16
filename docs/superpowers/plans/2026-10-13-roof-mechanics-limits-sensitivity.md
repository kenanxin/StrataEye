# Frozen Limit-Error Sensitivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quantify one-at-a-time limit-estimation bias in fixed native XGBoost models, preserving original physics, outcomes and artifacts.

**Architecture:** One separate evaluation-only module, focused tests and Chinese evidence report. Consume the reviewed original study and reuse pure metrics/strict JSON helpers; no training, tuning or production integration.

**Tech Stack:** Existing Python3.10.10/NumPy1.26.4/scikit-learn1.7.2/XGBoost3.2.0, unittest, JSON/CSV. No installation.

## Global Constraints

- Work only in D:/矿业/worktrees/teacher-feedback-v1 on codex/teacher-feedback-v1. Preserve existing untracked release evidence and all original outputs.
- No production/runtime/deployment changes, remote push, cloud calls, package installations, reselection or threshold tuning. Formal evaluation never retrains or generates new physical scenarios; only the unit-test source fixture may call prior run_study(source,10,2,12) before the sensitivity no-fit guard.
- Formal source D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13 must match manifest SHA256031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537 and pass readback_study. Teacher CSV stays unchanged.
- Use original test/ood only and persisted raw4/known_limits4 XGBoost candidates. Record original validation selections. Do not deserialize RF/joblib.
- Keep true parameters, trajectories, raw4, future targets, first-crossing events and splits unchanged. Estimated-limit transformation affects features and current-limit reference only.
- Conditions fixed: exact=(None,0); each of deflection_limit_mm/capacity_n/bending_strength_mpa at relative_error(-.20,-.10,-.05,.05,.10,.20), one parameter at a time. 19 conditions,152 affected score cells plus4 raw4 reference scores,156 CSV rows.
- Source is mechanics_simulation; analysis is post_hoc_frozen_model_limit_error_stress. Error grid is hypothetical, not a measured field distribution or a new independent performance study.
- Formal output D:/矿业/outputs/roof-mechanics-limits-sensitivity/2026-10-13 must be new and nonoverlapping with source. Keep failed output evidence, never overwrite any study.
- Preserve all outcomes, predictions, row/event denominators and nulls. Compare exact predictions/scores with original study before accepting stress results.
- Use apply_patch for source/document edits and git -c maintenance.auto=false -c gc.auto=0 for every Git write. Stage only task-owned files.

---

### Task 1: Fixed-Matrix Bias, No-Fit Evaluation and Audited Run

**Files:**
- Create tools/roof_mechanics/limits_sensitivity.py
- Create tests/roof_mechanics/test_limits_sensitivity.py
- Modify tools/roof_mechanics/README.md (append independent sensitivity usage, no rewrite of previous results)
- Create docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-results.md
- Create docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-evidence.json

**Interfaces:**
- CASE_REGISTRY is an ordered tuple of dictionaries: case_id,parameter,relative_error. exact first; then parameter order as Global Constraints and errors ascending. Non-exact IDs use parameter+'_'+('minus'/'plus')+integer-percent, e.g. capacity_n_plus20.
- biased_feature_matrix(rows,scenarios,parameter,relative_error)->finite ndarray(N,4); unknown/missing/nonfinite/bool or relative_error<=-1 rejected. None requires zero. Reuses engineering_feature_matrix with shallow copied scene/parameter dictionaries; trajectories/rows never changed.
- evaluate_stress(source_dir)->(results,predictions), no persistence or fitting. Results contain all fixed cells, original selections and four raw4 references; predictions contain every corresponding class list. Source native candidates are fixed regardless of fixture validation choice.
- run_sensitivity(source_dir,output_dir,expected_manifest_sha256)->summary; expected digest required by Python interface. CLI python -m tools.roof_mechanics.limits_sensitivity with --source-dir default formal source, --output-dir required, --expected-manifest-sha256 default formal digest.
- readback_sensitivity(output_dir)->dict(passed,...); verifies own manifest, protocol registry/input hash, all baseline/stress predictions, scores, CSV coverage and current source hash integrity.
- Consume readback_study(source_dir), engineering_feature_matrix(rows,scenarios), supervised_rows(...), feature_matrix(rows), evaluate(y_true,y_pred), evaluate_events(rows,predictions,scenarios,alert_level), read_json/write_json/sha256/verify_manifest and software_versions. Do not alter them.

- [x] Write focused RED tests before code. Include exact four-column arithmetic, capacity N/kN conversion, both deflection columns changed together, input/true-label/trajectory immutability, forbidden/nonfinite errors, zero-error equality, complete registry, source hash/no-overwrite/overlap rejection and no-fit persistence smoke.

```python
raw = [2., .1, 100., 2.]
limits = dict(deflection_limit_mm=20., capacity_n=500000., bending_strength_mpa=5.)
# source scenes/rows use scenario_id='s' and exact raw field names.
np.testing.assert_allclose(biased_feature_matrix(rows,scenes,None,0),[[.1,.005,.2,.4]])
np.testing.assert_allclose(biased_feature_matrix(rows,scenes,'capacity_n',-.2),[[.1,.005,.25,.4]])
np.testing.assert_allclose(biased_feature_matrix(rows,scenes,'deflection_limit_mm',.1),[[2/22,.1/22,.2,.4]])
self.assertEqual(scenes, original_scenes)
self.assertEqual(rows, original_rows)
```

- [x] Run RED with existing Python and record actual failure. For smoke fixture only, generate a temporary small source via prior run_study(source,10,2,12) before patching fit. The sensitivity runner itself must never fit. Require real native model load/predict and active event metrics, not mocked predictions.

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_limits_sensitivity.py' -v
```

- [x] Build the immutable transform and fixed registry. Reject invalid real/bool/finiteness errors. Only new parameter dictionaries receive the selected value. Keep q_crit, true ratios, future targets and all other values intact; they never enter model features.

```python
estimated = [dict(scene, parameters=dict(scene['parameters'])) for scene in scenarios]
if parameter is not None:
    for scene in estimated:
        scene['parameters'][parameter] *= 1 + relative_error
return engineering_feature_matrix(rows, estimated)
```

- [x] Reconstruct original eligible supervised rows from persisted trajectories, compare with original audited CSV through readback_study; consume original split indices and metrics/predictions. Load both native XGBoost files once per replicate; validate four features/four classes. For test/ood, store raw4 score/prediction once, then known_limits4 and estimated current-limit reference for all19 cases. Use ORIGINAL scene/rows for event truth. exact case and raw4 must match original stored candidate/current-limit predictions and score dictionaries exactly.

```python
model = XGBClassifier()
model.load_model(directory/'models'/'known_limits4'/'xgboost.json')
matrix = biased_feature_matrix(rows,scenes,case['parameter'],case['relative_error'])
prediction = model.predict(matrix[idx]).astype(int).tolist()
reference = [classify_ratio(max(matrix[i,[0,2,3]])) for i in idx]
# row=evaluate(original_truth,prediction)
# event_alert2/3=evaluate_events(original_rows,prediction,original_scenes,2/3)
```

- [x] Implement fresh-output and expected-hash checks before writing. Reject source/output equal, ancestor or child overlap and malformed expected digest. Validate original manifest and readback before protocol creation. Freeze protocol before new stress scoring, with source paths/hash, cases, splits, model candidates/original selections, source hashes/versions and timestamp/command. Existence must reject before any evaluation.

```python
source=Path(source_dir).resolve(); output=Path(output_dir).resolve()
if output.exists(): raise FileExistsError(output)
if source==output or source in output.parents or output in source.parents:
    raise ValueError('source/output overlap')
if sha256(source/'manifest.json') != expected_manifest_sha256:
    raise ValueError('source manifest hash mismatch')
readback_study(source)
output.mkdir(parents=True, exist_ok=False)
write_json(output/'protocol.json', frozen_protocol)
```

- [x] Persist results, per-cell predictions and 156-row comparison.csv with identifiers, factor/sign, split counts, Macro-F1, class3 recall/underestimate counts, low-class false positives, alert2/3 timely and nonlimit burden counts/rates. Six non-manifest files are protocol.json/results.json/predictions.json/comparison.csv/source-check.json/readback.json. source-check contains original manifest/teacher hash before/after and equality checks. Manifest follows existing algorithm/excludes/files hash+bytes format; complete coverage excluding self.
- [x] Implement semantic readback separately from main transform: reconstruct estimated denominators directly from original raw feature order and three static parameters/selected factor, without calling biased_feature_matrix. Use native models to recompute predictions and shared row/events to recompute scores. Validate complete registry, split/case/model coverage, original baseline equality, 156 CSV rows/content, metadata counts and original source still unchanged. Internal content audit may run before writing readback.json/manifest; public readback checks final manifest and repeats content audit.
- [x] GREEN no-fit smoke must raise on any fitting/reselection reached inside sensitivity. Fixture construction is outside guarded scope. Test strict persistence and tamper rejection, null rates, source expected-digest mismatch and no-overwrite; no full formal experiment inside tests.

```python
with patch('xgboost.XGBClassifier.fit', side_effect=AssertionError('sensitivity must not fit')), \
     patch('sklearn.ensemble.RandomForestClassifier.fit', side_effect=AssertionError('sensitivity must not fit')):
    summary=run_sensitivity(source,new_output,sha256(source/'manifest.json'))
    self.assertTrue(summary['readback']['passed'])
    self.assertTrue(readback_sensitivity(new_output)['passed'])
```

- [x] Run focused GREEN, then complete Python suite once. No Node suite needed: no runtime edits. Run formal sensitivity exactly once in the named fresh folder, no fitting or changing fixed conditions after outcomes. Validate the original26file manifest and teacher CSV before/after.

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.limits_sensitivity --output-dir 'D:\矿业\outputs\roof-mechanics-limits-sensitivity\2026-10-13'
```

- [x] Use actual stored numeric values and hashes for Chinese results/evidence/README. Report fixed base and each parameter±20% conditions for BOTH replicates/test/ood, exact source/analysis status and all denominators. Preserve full156CSV grid. Do not call the error grid realistic, claim field robustness/new independent accuracy, or update original report scores. Cite checked native-model API and research-record source, human review pending.
- [x] Verify no original data/model/runtime changes, strict evidence JSON, git diff --check, self-review and commit only five task files. Keep formal outputs outside Git. Full report with RED/GREEN commands/output, formal readback and hashes in this plan's scratch; do not return a giant report in chat.

```powershell
git -c maintenance.auto=false -c gc.auto=0 add tools/roof_mechanics/limits_sensitivity.py tests/roof_mechanics/test_limits_sensitivity.py tools/roof_mechanics/README.md docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-results.md docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-evidence.json
git -c maintenance.auto=false -c gc.auto=0 commit -m 'feat: audit fixed roof-model sensitivity to limit estimation bias'
```

## Self-review

One task owns the evaluation-only deliverable, tests and evidence. Source teacher data/physics/model fitting stay outside it. Original future truth versus estimated limits, fixed XGBoost candidates versus prior selection, post hoc pressure analysis versus new independent evaluation, and single-factor assumptions are explicit. No placeholder, pending choice or conflict remains. User autonomy supersedes repeated approval prompts; isolated worktree and independent task/final reviews remain required.

## Dated review amendment — provenance-only reproduction

Added 2026-10-13 after the independent Task1 review, before executing the additional reproduction. The original once-only formal run and its immutable output remain preserved. Its missed pre-scoring evaluator-code capture stays explicitly unmet; the post-run snapshot is not backdated.

- [x] Fix round1: label future synthesized CLI text `reproducible_command`, record the actual verification invocation separately in evidence/report, and run only covering focused tests.
- [x] Freeze the seven current evaluator/test/dependency hashes in a new protocol before scoring. Run exactly one no-fit reproduction in the fresh nonoverlapping `D:/矿业/outputs/roof-mechanics-limits-sensitivity/2026-10-13-provenance-verification` directory. Source hash, 19 cases, true labels, splits, models and all metrics remain fixed.
- [x] Independently read back the new output and compare complete results/predictions/CSV content with the unchanged original output. Preserve both outcomes. Any mismatch blocks acceptance; no selective replacement or retuning.
- [x] Record the historical deviation, new pre-scoring hashes, actual command, complete equality result and both manifests separately in the Chinese QA report/evidence and implementation report. Stage only the five original task-owned files. No cloud writes or production changes.
- [x] Scoped independent re-review verifies the original Important provenance finding and Minor command-label finding against this fix and additional evidence. The new run is a technical reproduction of the same post hoc study, with human scientific review still pending.
