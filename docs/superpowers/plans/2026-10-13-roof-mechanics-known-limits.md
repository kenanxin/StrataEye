# Roof Mechanics Known-Limits Ablation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test whether known engineering limits improve future-limit prediction on fresh simulated scenarios, with independent mechanics validation and event-level evaluation.

**Architecture:** Preserve the V1 solver/data/trainer baseline. Extend seeded generation compatibly, add a pure known-limits feature/event module, then a separate fixed-protocol experiment runner and audited local artifacts. No website integration.

**Tech Stack:** Existing Python 3.10.10/NumPy1.26.4/scikit-learn1.7.2/XGBoost3.2.0/joblib1.6.0, unittest, JSON/CSV.

## Global Constraints

- Work only in D:/矿业/worktrees/teacher-feedback-v1 on its existing codex/teacher-feedback-v1 branch. Preserve untracked release reports.
- Do not modify teacher CSV, Agent delivery code, production runtime/models/assets or deployment configuration. No remote push/cloud calls/package installation.
- Keep V1 labels .5/.8/1, next-three-step maximum, first-crossing stop and incomplete-window rules. Default generator seeds remain1729/3141.
- New experiments use replicate-a seeds41101/42101/43101 and replicate-b41102/42102/43102, each500 in-domain/100 OOD/32steps. Complete groups60/20/20; OOD never fits/selects.
- Both protocols exclude step0 identically. known_limits4 uses only current raw4 divided by deflection_limit_mm, deflection_limit_mm, capacity_n/1000, bending_strength_mpa, in that order.
- No target/current_ratio/q_crit/future/ID/family/softening parameters enter feature matrices. No silent filling of missing/nonfinite/nonpositive static limits.
- Source is mechanics_simulation with uncalibrated assumptions; record stronger information conditions of known_limits4. Never claim field accuracy or real-time collapse.
- Validate/select on validation only, freeze before test/OOD, preserve all measured outcomes. No post-test tuning or label change.
- Output to a new D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13 directory; existence must fail before generation. Never overwrite V1.
- Every git write uses -c maintenance.auto=false -c gc.auto=0. Stage only task-owned files, never git add -A.

---

### Task 1: Independent Spring Check, Seed Contract and Pure Evaluation

**Files:**
- Modify tools/roof_mechanics/solver.py and dataset.py
- Create tools/roof_mechanics/known_limits.py
- Modify tests/roof_mechanics/test_solver.py and test_dataset.py
- Create tests/roof_mechanics/test_known_limits.py

**Interfaces:**
- generate_dataset(in_domain_scenarios=500, ood_scenarios=100, steps=32, *, in_domain_seed=1729, ood_seed=3141) retains the original physical scenarios, trajectories, supervised features and labels for default seeds; verification gains the required spring diagnostics.
- engineering_feature_matrix(rows, scenarios)->finite ndarray(N,4), scenarios is the generated list. Names tuple ENGINEERING_FEATURE_NAMES exactly ('deflection_utilization','deflection_increment_utilization_per_step','support_utilization','bending_utilization').
- eligible_rows(dataset)->list of original supervised rows with integer step>=1; no mutation.
- evaluate_events(rows, predictions, scenarios, alert_level)->dict with alert_level2 or3, true_limit_events, timely_detected_events, timely_detection_fraction, lead_steps list, non_limit_scenarios, alerted_non_limit_scenarios, non_limit_alert_fraction. Inputs must have matching lengths, valid classes/steps/IDs, no duplicates, and no current crossing row; do not silently ignore malformed data.

- [ ] Write RED tests before implementation. Analytic center spring, default/custom seeds, normalized units, missing limits, current-only allowlist, exclusion of step0, event counting/lead/no-event/null/invalid data.

```python
cfg = BeamConfig(8.,1.,.4,10e9,24)
I = cfg.width_m*cfg.thickness_m**3/12
w0 = 5*1e5*8**4/(384*10e9*I)
expected = w0/(1+4e6*8**3/(48*10e9*I))
res = solve_beam(cfg,1e5,{12:4e6})
self.assertLess(abs(res['displacement_m'][12]/expected-1),1e-4)
self.assertLess(abs(res['spring_forces_n'][12]/(4e6*expected)-1),1e-4)
# feature example raw [2,.1,100,2], limits [20,20,500,5]
np.testing.assert_allclose(matrix,[[.1,.005,.2,.4]])
# future/label/q_crit edits must not change the matrix.
```

- [ ] Run focused unittest RED; record relevant failure output. Reuse existing scientific Python, no installation.
- [ ] Add cross-center spring analytic errors to verify_solver output and its fail-closed checks, tolerance1e-4. This check compares center displacement, not max_deflection_mm. Do not change solve_beam's mechanics.
- [ ] Add validated optional nonnegative integer seeds with bool rejected, metadata records actual seeds. Default deterministic test uses small counts to avoid regenerating full baseline.
- [ ] Implement finite feature extraction from the exact four raw values and exact three static-limit parameters. Reject duplicate scenario IDs, unknown row IDs and invalid capacity/strength/limit. Raw input feature validation may reuse V1 feature_matrix.

```python
denominators = np.array([p['deflection_limit_mm'],p['deflection_limit_mm'],
                         p['capacity_n']/1000,p['bending_strength_mpa']])
normalized_row = raw_row/denominators
# current-only baseline: classify_ratio(max(normalized_row[[0,2,3]]))
```

- [ ] Implement event metrics independently of model features. For each represented scenario, crossing_step is first trajectory state current_ratio>=1. A timely alarm must have target_class==3, prediction>=alert_level, and crossing_step-step in1..3. Count each event once; lead is crossing_step minus earliest timely alarm step. Negative-event alert burden counts any alarm in represented noncrossing scenarios. Duplicate/invalid/mismatched target/crossing evidence fails clearly; never name alert burden field false_positive.
- [ ] Run complete Python suite once, self-review, write report with RED/GREEN commands/output, then commit only task files.

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
git -c maintenance.auto=false -c gc.auto=0 add tools/roof_mechanics/solver.py tools/roof_mechanics/dataset.py tools/roof_mechanics/known_limits.py tests/roof_mechanics/test_solver.py tests/roof_mechanics/test_dataset.py tests/roof_mechanics/test_known_limits.py
git -c maintenance.auto=false -c gc.auto=0 commit -m 'feat: validate spring reference and known-limit mechanics features'
```

### Task 2: Frozen Ablation Training and Audited Experiment

**Files:**
- Create tools/roof_mechanics/known_limits_study.py
- Create tools/roof_mechanics/run_known_limits.py
- Create tests/roof_mechanics/test_known_limits_study.py
- Modify tools/roof_mechanics/README.md
- Create docs/qa/2026-10-13-roof-mechanics-known-limits-results.md
- Create docs/qa/2026-10-13-roof-mechanics-known-limits-evidence.json

**Interfaces:**
- Consumes Task1 engineering_feature_matrix, eligible_rows, evaluate_events and seeded generator. Reuses V1 evaluate, split_scenarios(rows,seed), feature_matrix, software_versions and safe JSON/hash helpers, leaving train_models unchanged.
- train_ablation(dataset, split_seed)->(metrics, models, predictions). Models mapping raw4/known_limits4 each random_forest/xgboost. Predictions store per-row classes for every model plus majority/current-limit references. metrics contains frozen per-protocol selection, row/event evaluation for validation/test/ood, scenario IDs/indices/counts, features/limits contracts and params.
- run_study(output_dir, in_domain_scenarios=500, ood_scenarios=100, steps=32)->summary; CLI -m tools.roof_mechanics.run_known_limits with same count options and required --output-dir. Two fixed replicates; tests may pass small counts but never alter seeds/parameters/selection.

- [ ] Write failing tests for validation-only selection and early stopping, raw/norm matrices width4, future/held-out-label noninfluence, all four classes required in train, finite/null metrics, no-overwrite and persistence/native-model reload. Use tiny deterministic fixtures for training tests and one 10+2/12step smoke run. Don't rerun full experiments inside unit tests.
- [ ] Implement two-protocol fixed RF/XGB fit with these exact parameters; training weights from train labels only, validation-only eval_set.

```python
rf = RandomForestClassifier(n_estimators=200,min_samples_leaf=3,
    class_weight='balanced',n_jobs=2,random_state=42)
xgb = XGBClassifier(n_estimators=350,max_depth=4,learning_rate=.05,
    subsample=.9,colsample_bytree=1,objective='multi:softprob',num_class=4,
    eval_metric='mlogloss',tree_method='hist',n_jobs=2,random_state=42,
    early_stopping_rounds=25)
xgb.fit(X[train],y[train],sample_weight=compute_sample_weight('balanced',y[train]),
        eval_set=[(X[validation],y[validation])],verbose=False)
```

- [ ] Select separately for raw4 and known_limits4 from validation metrics: eligible iff Macro-F1>=.50 and low_class_false_positive.fraction<=.20 with present class3. Sort eligible candidates by recall[3], macro_f1, tie preference xgboost descending. If none eligible choose highest macro_f1/tie xgboost and eligible=false. Save choices before calculating test/OOD scores, no probability-threshold search. Store majority and current-limit persistence information contracts explicitly.
- [ ] Evaluate all models and baselines on validation/test/ood using V1 row metrics and Task1 event metrics at alert levels2/3. Retain counts and each event lead; report null when denominator0. Test no hidden test/OOD label effects on fitted models and choices.
- [ ] Implement fresh-output CLI. Generate each fixed replicate, prefix scenario IDs consistently, use same filtered rows/split across protocols. Write protocol.json before training with full fixed values, counts, code hashes, timestamp, original CSV hash. Persist scenarios, raw/normalized observation CSV, splits, metrics, predictions, RF joblib and XGB native JSON for each protocol. No pickle loading.
- [ ] Implement independent readback: strict finite JSON, recompute future targets and normalized features from persisted scenarios/current values, verify filtered row coverage, group intersections0, fresh seeds, all model feature/class counts4, XGB reload predictions equality, row/event metrics and selected choices correspond to validation policy. SHA256 manifest covers every persisted file except self. Fail on tampered artifacts or inconsistent counts. CSV before/after hashes must agree.
- [ ] Run focused GREEN and full Python suite once, then run default two-replicate study exactly once in the new named output directory. Keep protocol fixed after viewing outcomes; keep failed evidence folders if any. Do not install or update dependencies.

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.run_known_limits --output-dir 'D:\矿业\outputs\roof-mechanics-known-limits\2026-10-13'
```

- [ ] Create concise Chinese README, result/evidence records using actual stored values and hashes. Compare raw4 vs known_limits4 on the SAME new splits, retain V1 failure as historical context only. Report both replicate ranges descriptively, event alert burden and limits; never claim confidence intervals, real-world accuracy, noise robustness or production readiness. Cite new design's opened official references and record human scientific review pending.
- [ ] Verify runtime diff empty, run existing Node suite once and commit task files only, no output datasets/models or untracked release files.

```powershell
& 'C:\Users\欣\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
git -c maintenance.auto=false -c gc.auto=0 diff --quiet 8d73eba -- js css assets images index.html login.html admin.html vercel.json server.js server data
git -c maintenance.auto=false -c gc.auto=0 add tools/roof_mechanics/known_limits_study.py tools/roof_mechanics/run_known_limits.py tools/roof_mechanics/README.md tests/roof_mechanics/test_known_limits_study.py docs/qa/2026-10-13-roof-mechanics-known-limits-results.md docs/qa/2026-10-13-roof-mechanics-known-limits-evidence.json
git -c maintenance.auto=false -c gc.auto=0 commit -m 'feat: evaluate known-limit mechanics ablation on fresh scenarios'
```

## Self-review

Design physics/features/causal boundaries map to Task1; frozen training/storage/results map to Task2. Both use the same filtered new scenarios and untouched label protocol. Windows lacks the provided Bash executables, so task briefs/review packages will use a faithful local PowerShell helper. Existing offline branch and release files are retained. No conflicting requirement or pending choice remains within this research scope; field parameter confirmation and production integration stay outside it.
