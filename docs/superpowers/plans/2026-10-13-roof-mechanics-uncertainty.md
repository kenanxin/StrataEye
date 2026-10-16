# Roof Mechanics Sampled Uncertainty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a reproducible offline sampled parameter-error envelope and honest accounting of its risk-underestimation and review-burden tradeoff.

**Architecture:** A pure predictor samples the current four normalized observations under hypothetical static-limit estimation errors. A separate archive runner uses unchanged saved XGBoost models, rows and splits to score a frozen 27-condition exploratory analysis with independent readback.

**Tech Stack:** Existing Python scientific environment, NumPy, native XGBoost JSON, unittest, SHA-256 JSON/CSV archives; no new dependency.

**Completion (2026-10-13):** Tasks 1–2 and all technical review gates completed. Final independent review approved `2e66721..e25d150` for offline handoff, with no Critical/Important/definite Minor findings. Focused tests 10/10 and 2/2, full suite 54/54; one formal invocation exited 0 and independently read back 324 scoring cells and 108 summaries. Final evidence, execution reports and review are archived in `docs/qa/2026-10-13-roof-mechanics-uncertainty-*`; the separate defense chat received verified results. Human scientific approval remains pending. No deployment, push or production-model replacement.

## Global Constraints

- Work in D:/矿业/worktrees/teacher-feedback-v1 on codex/teacher-feedback-v1; base 2e66721. Preserve unrelated untracked QA files.
- Source D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13; manifest SHA-256 031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537.
- No fitting, model selection, new splits/labels/physical data, deployment, seven-dimensional production change or teacher CSV mutation.
- Two saved known_limits4 XGBoost models, original test/ood, 27 pressure cases, 27 sample points at width 0.20, 324 scoring cells and 108 uncertainty summaries.
- Estimation error e is relative to true limit: L_hat=L_true*(1+e); candidate features equal center features*[1+e_d,1+e_d,1+e_c,1+e_s].
- Outputs are exploratory mechanics_simulation; sampled range is not a confidence interval or continuous-domain guarantee. Review flags are not human corrections.
- Null denominators remain null/blank; preserve all adverse results and future-three-loading-step semantics.
- Apply_patch for source/doc edits; git -c maintenance.auto=false -c gc.auto=0 for commits, stage only exact owned paths, no GC/reset/push.
- Python executable D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe; use -B.

---

### Task 1: Pure sampled predictor

**Files:** Create tools/roof_mechanics/limit_uncertainty.py and tests/roof_mechanics/test_limit_uncertainty.py.

**Interfaces:** Consumes a model exposing predict(matrix) and an (n,4) finite real center normalized matrix. Produces sample_limit_error_predictions(model, center_features, relative_error_bound=0.20) -> dict with center/lower/upper/review_required/possible_class3 Python lists, sampled_classes (sorted unique classes per row), and sample_count int. Expose limit_error_grid(relative_error_bound=0.20) -> tuple of three-error tuples. No source archive or target labels needed.

- [x] **Step 1: Add focused failing tests.** Arithmetic test uses a recording deterministic predictor whose class is np.clip(np.floor(X[:,3]*3),0,3). For center [[.1,.005,.2,.9]], width .20, assert sample_count==27, center==[2], lower==[2], upper==[3], review_required==[True]. Assert observed feature candidates contain center and factors .8/1/1.2, deflection and increment factors identical; center input unchanged. Zero width gives exactly one point and identical bounds. Reject bool, complex, strings, NaN, infinity, wrong matrix shapes, width<0 or >=1, invalid returned shape/classes or noninteger classes. Test empty n=0 deterministically without model call.
- [x] **Step 2: Run RED.** Execute `python -B -m unittest discover -s tests/roof_mechanics -p test_limit_uncertainty.py -v`; record missing implementation failure.
- [x] **Step 3: Implement pure inference with this exact arithmetic.**

```python
grid = tuple(itertools.product((-bound, 0.0, bound), repeat=3)) if bound else ((0.0,0.0,0.0),)
for ed, ec, es in grid:
    features = center_features * np.array([1+ed, 1+ed, 1+ec, 1+es])
    values = model.predict(features)
    # Validate shape (n,), finite integer labels in 0..3 before reduction.
lower = np.min(predictions, axis=0)
upper = np.max(predictions, axis=0)
```

Center must be the actual (0,0,0) sample, no monotonicity assumption. sampled_classes records actual observed categories, not the full integer interval; possible_class3 equals upper==3. Validate matrix numerics before float coercion; reject bool/string/complex. Return empty lists with deterministic grid count for empty input; do not call predict. Overflow and invalid predictions fail explicitly. Include a nonmonotone predictor test that returns only classes 0 and 3 and assert sampled_classes==[[0,3]].
- [x] **Step 4: Run GREEN and self-review.** Record the same focused command, verify no label/trajectory dependency, no mutation and every documented invalid input is checked.
- [x] **Step 5: Commit the two new files and detailed task report.** Report contains RED/GREEN commands and output, files, self-review and concerns; stage only the two source paths. Controller performs task review before Task 2.

### Task 2: Frozen archive evaluation, independent readback and research report

**Files:** Create tools/roof_mechanics/uncertainty_study.py and tests/roof_mechanics/test_uncertainty_study.py; modify tools/roof_mechanics/README.md. After task review, create docs/qa/2026-10-13-roof-mechanics-uncertainty-results.md, -evidence.json, -tests.md and -review.md from actual results.

**Interfaces:** Consumes sample_limit_error_predictions and limit_error_grid from Task 1, existing readback_study/supervised_rows/engineering_feature_matrix/evaluate/evaluate_events/read_json/write_json/sha256/verify_manifest/software_versions. Produces run_uncertainty_study(source_dir,output_dir,expected_manifest_sha256) -> summary dict; readback_uncertainty(output_dir) -> passed audit dict; CLI python -B -m tools.roof_mechanics.uncertainty_study --output-dir PATH [--source-dir PATH --expected-manifest-sha256 HASH].

- [x] **Step 1: Add failing integration tests using existing run_study(temporary_source,10,2,12) as a source fixture before no-fit guards.** Check wrong source hash/overlap/overwrite fails. Patch XGBClassifier.fit and RandomForestClassifier.fit to raise during the new runner. Assert protocol already exists with every analysis source/test hash before scoring; distinct pressure registry count 27; 324 cells/108 summaries; original exact center/physical reference matches; known scope and width fixed. Mutate CSV and ensure readback rejects manifest; mutate prediction and rehash manifest and ensure semantic audit rejects; verify source/teacher bytes unchanged. In unit fixtures, a different original chosen model is allowed because XGBoost remains predeclared.
- [x] **Step 2: Run focused RED.** `python -B -m unittest discover -s tests/roof_mechanics -p test_uncertainty_study.py -v`.
- [x] **Step 3: Implement the runner.** Retain original 19 cases by importing CASE_REGISTRY read-only, map each to a triple center bias, and append 8 jointly nonzero ±.20 triples named joint_minus20_plus20_minus20 etc. Store each bias explicitly with parameter names. The ordinary feature mapping is:

```python
exact = engineering_feature_matrix(rows, scenes)
ed, ec, es = case['relative_errors']
center = exact / np.array([1+ed,1+ed,1+ec,1+es])
envelope = sample_limit_error_predictions(model, center, 0.20)
physical = [classify_ratio(max(value[[0,2,3]])) for value in center]
```

Score center, sampled_upper and estimated_current_limit on same rows/true scenes using evaluate/evaluate_events at levels 2 and 3. Summary tracks disagreement rows/scenarios, marked center class3 underestimates, unmarked class3 underestimates and total true class3, center underestimates with sampled_upper==3, and both sampled-range and actual sampled-class-set inclusion of true future grade; include numerator/denominator/null fraction. Store all Task 1 prediction fields aligned to original split indices and case IDs. Preserve all cells in JSON and flat CSV; a fixed CSV header contains row/event metrics plus review summaries.

Preflight checks path overlap, lowercase SHA256, source hash and readback, teacher hash and native model four-feature/four-class contract. Write protocol before scoring containing code SHA-256 for both new modules, both new tests and every directly used analysis/helper module (including limits_sensitivity, known_limits_study, run_experiment, train, known_limits and dataset), source file hashes, selected saved models, software versions, width/grid/cases, timing and reproducible command. Archive full protocol/results/predictions/CSV/source-check/readback and manifest. No overwrites, no pickle load, no NaN JSON. Fail if source or teacher changes.

Independent readback rebuilds each denominator directly from raw feature values and original parameters multiplied by center bias, then divides candidate denominators by (1+candidate error), reloads native XGBoost, predicts, reduces and checks every result. It does not call production sample_limit_error_predictions or production central-matrix transform. Shared scoring helpers are reused to avoid accidental new metric semantics. Audit complete expected file set, code/source hash equality, registry/grid and metadata, exact source comparison, all predictions/cells/CSV and source checks.
- [x] **Step 4: Run GREEN, full Python suite once and self-review; document usage.** Record focused command plus `python -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v`. No need Node suite since web/server files unchanged. Commit runner/tests/README only and task report; controller reviews before full source scoring.
- [x] **Step 5: Following task approval, run exactly one full-source analysis in new D:/矿业/outputs/roof-mechanics-uncertainty/2026-10-13.** Store actual invocation, protocol/manifest/output hashes and source preservation evidence. If scoring fails, retain failure artifacts and diagnose; never silently overwrite or present incomplete output.
- [x] **Step 6: Write evidence-bound results from outputs.** Show exact case and strength +20% across four splits, and worst joint cases under fixed descriptive summaries. Report both severe underestimates and false positives/review burden, no success-only selection. Keep all 324 CSV rows accessible. Mark post hoc same-source, hypothetical width, no continuous guarantee/no field calibration/no live integration; human scientific approval pending. Commit named QA docs only.
- [x] **Step 7: Whole-delta independent review, close ledger and retain reusable evidence.** Review base 2e66721 through final task commit; resolve load-bearing findings before delivery. Archive task evidence to named QA docs, remove only current plan scratch after review, preserve prior user/source/QA files. Send verified concise results to the user-authorized answer-preparation chat; no production edits.
