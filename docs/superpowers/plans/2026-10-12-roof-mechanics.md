# Roof Mechanics Offline Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify a beam–spring solver, generate traceable synthetic observations, and train/evaluate a separate four-feature RF/XGBoost experiment.

**Architecture:** A pure NumPy solver feeds a scenario/dataset module. A separate training CLI accepts only the four-feature allowlist, splits scenario groups, and stores local artifacts. Production website modules remain unchanged.

**Tech Stack:** Python 3.10+; NumPy; existing local scikit-learn 1.7.2 and XGBoost 3.2.0; unittest; JSON/CSV.

## Global Constraints

- Do not modify teacher CSV, production model/assets, Agent delivery code, application runtime or deployment configuration.
- This is mechanics_simulation, not field measurements. All parameter ranges and label thresholds are uncalibrated experiment assumptions.
- Four features: max_deflection_mm, deflection_increment_mm_per_step, max_support_force_kn, max_bending_stress_mpa, in this exact order. No future/label/capacity/ID columns enter model features.
- Future target: maximum extreme-limit class over the next 3 loading steps; never train on current frames at/above r=1.
- Stop each simulation at the first r>=1. Incomplete future windows are excluded unless a limit crossing is observed in that shorter window.
- Split complete in-domain scenarios 60/20/20 with seed=2718. OOD scenarios are never used for training, early stopping or selection.
- Preserve untracked first-release files. Git writes use -c maintenance.auto=false -c gc.auto=0. No remote push or cloud mutation for this experiment.
- New outputs must not overwrite existing files. No execution/deserialization of unreviewed delivered scripts/pickles.

---

### Task 1: Verified Mechanics Solver and Dataset Generator

**Files:**
- Create `tools/roof_mechanics/__init__.py`
- Create `tools/roof_mechanics/solver.py`
- Create `tools/roof_mechanics/dataset.py`
- Create `tests/roof_mechanics/test_solver.py`
- Create `tests/roof_mechanics/test_dataset.py`

**Interfaces:**
- `BeamConfig(length_m, width_m, thickness_m, young_modulus_pa, elements=24, boundary='simply_supported')` frozen dataclass.
- `solve_beam(config, load_n_per_m, springs)` accepts `springs: dict[int,float]` internal node->N/m; returns dict with max_deflection_mm, max_support_force_kn, max_bending_stress_mpa, displacement_m, rotation_rad, spring_forces_n, boundary_reactions_n, strain_energy_j, equilibrium_relative_error, residual_relative_error, work_n_m.
- `classify_ratio(ratio:float)->int`; r boundaries .5/.8/1.
- `generate_dataset(in_domain_scenarios=500, ood_scenarios=100, steps=32)->dict` returns `rows`, `scenarios`, `verification`, `metadata` serializable with allow_nan=False. Each scenario has unique ID/domain/family/parameters/full valid trajectory/stop_reason. Each row has all four features plus scenario_id/domain/family/step/current_ratio/current_class/target_future_ratio/target_class/source_kind/dataset_version.
- `FEATURE_NAMES` tuple shared with trainer; `CLASS_NAMES` four Chinese extreme-limit class names.

- [ ] Write RED tests and run focused unittest before implementation. Test analytic simply supported and cantilever displacements, both moment/stress convergence and units, symmetry, linear response, springs, residual/energy and invalid inputs.

```python
cfg = BeamConfig(8., 1., .4, 10e9, elements=48)
res = solve_beam(cfg, 1e5, {})
I = cfg.width_m * cfg.thickness_m**3 / 12
expected_mm = 5*1e5*8**4/(384*10e9*I)*1000
self.assertAlmostEqual(res['max_deflection_mm']/expected_mm, 1., places=4)
self.assertLess(res['equilibrium_relative_error'], 1e-8)
self.assertLess(res['residual_relative_error'], 1e-8)
self.assertAlmostEqual(2*res['strain_energy_j']/res['work_n_m'], 1., places=7)
```

- [ ] Implement validated SI-unit solver. Use this stiffness and consistent uniform load vector, assemble spring diagonals, eliminate prescribed zero DOFs, solve via np.linalg.solve, and recover Hermite fields from local DOFs. Reject invalid numeric/types/boundaries/nodes.

```python
ke = EI / le**3 * np.array([
 [12,6*le,-12,6*le], [6*le,4*le**2,-6*le,2*le**2],
 [-12,-6*le,12,-6*le], [6*le,2*le**2,-6*le,4*le**2]])
fe = q * le / 2 * np.array([1, le/6, 1, -le/6])
# Hermite displacement at t=x/le:
N = [1-3*t*t+2*t**3, le*(t-2*t*t+t**3),
     3*t*t-2*t**3, le*(-t*t+t**3)]
B = [(-6+12*t)/le**2, (-4+6*t)/le,
     (6-12*t)/le**2, (-2+6*t)/le]
# sample >=5 equally spaced points/element, M=EI*(B@ue)
# sigma=abs(M)*h/(2I); stored energy=.5*u.T@K_total@u
```

- [ ] Provide `verify_solver()->dict` with measured analytic errors, grid 12/24/48 convergence, energy, equilibrium. Fail closed by raising ValueError if analytic deflection relative error >=1e-4, refined-grid stress error >=.005 or residual/force/energy checks >=1e-7 for representative cases. Generator calls it first.

- [ ] Implement independent scenarios with seed1729 in-domain / seed3141 OOD. Use all exact ranges from design: L6–12 (OOD12–14 open lower bound), b1, h.30–.60, E4–20GPa, three quarter-span spring positions k2–20MN/m, capacity.4–1.2MN each, strength1–6MPa, deflection limit L/250. No noise in V1.

```python
r = max(w_mm/(L/250*1000), stress_mpa/strength_mpa,
        max_force_kn/(capacity_n/1000))
# reference q=100000 N/m, q_crit=q_reference/reference_ratio
# ramp .10–.35 to .90–1.30 fractions of q_crit
# families cycle load_ramp/support_softening/roof_softening
# support loss .20–.80; E loss .10–.45; loss factor uses progress**2
```

- [ ] Stop at first r>=1. Store first crossing only as target evidence; no above-limit observation features. For each earlier step, future=next min(3, available) steps; use if 3 exist OR first crossing is within the available future, otherwise exclude. Features only current observation, increment=current minus previous max deflection, first step increment=0. No physical timestamp or mm/day.

- [ ] Add exact threshold tests, determinism and no scenario/feature-target leakage tests. Verify target includes only future (not current), no incomplete-negative windows, early crossing allows shorter-positive window, no post-threshold states. Prefer testing a small internal pure `supervised_rows` helper with hand-written trajectories to avoid probabilistic tests.

- [ ] Run all new tests with bundled NumPy Python (solver/data use no sklearn), record clean output and self-review, then commit only task files. Do not stage release artifacts.

Run:
```powershell
& 'C:\Users\欣\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
git -c maintenance.auto=false -c gc.auto=0 add tools/roof_mechanics tests/roof_mechanics
git -c maintenance.auto=false -c gc.auto=0 commit -m 'feat: add verified beam spring synthetic experiment'
```

### Task 2: Leakage-Safe Training, CLI and Experiment Evidence

**Files:**
- Create `tools/roof_mechanics/train.py`
- Create `tools/roof_mechanics/run_experiment.py`
- Create `tools/roof_mechanics/README.md`
- Create `tests/roof_mechanics/test_training.py`
- Create `docs/qa/2026-10-12-roof-mechanics-results.md`
- Create `docs/qa/2026-10-12-roof-mechanics-evidence.json` (small summary only)

**Interfaces:**
- Consumes Task1 `generate_dataset`, `FEATURE_NAMES`, `CLASS_NAMES`.
- `split_scenarios(rows, seed=2718)->dict[str,list[int]]` train/validation/test/ood row-index lists; complete domain groups, 60/20/20 rounded as train=int(.6*n), validation=int(.2*n), test=remainder; require >=10 domain groups.
- `feature_matrix(rows)->np.ndarray`: exact four-field allowlist, finite values only.
- `evaluate(y_true, y_pred)->dict`: fixed4 class metrics, recall null for zero support, high-class FN fraction and low-class FP fraction with denominator or null.
- `train_models(dataset)->(metrics, models)`; `metrics` contains split IDs/counts/class distributions, overlap count=0, val selection protocol/choice, val+test+ood model/baseline metrics, hyperparameters and versions. `models` includes local RF/XGB/shallow_tree models.
- `python -m tools.roof_mechanics.run_experiment --output-dir <newdir> [--in-domain-scenarios 500 --ood-scenarios 100 --steps 32]` verifies/generates/trains and writes CSV, metadata/scenarios/splits/metrics/models, with JSON allow_nan=False and a SHA256 manifest.

- [ ] Write RED unit tests for scenario isolation, OOD isolation, exact feature extraction even when target-like columns present, class-support null behavior, invalid rows/groups and non-overwrite CLI behavior. Tests use small deterministic datasets.

```python
split = split_scenarios(rows)
ids = {name:{rows[i]['scenario_id'] for i in idx} for name,idx in split.items()}
self.assertFalse(ids['train'] & ids['test'])
self.assertFalse(ids['train'] & ids['validation'])
self.assertFalse(ids['ood'] & (ids['train'] | ids['test'] | ids['validation']))
row = dict(zip(FEATURE_NAMES, [1.,2.,3.,4.]), target_class=999)
np.testing.assert_array_equal(feature_matrix([row]), [[1.,2.,3.,4.]])
```

- [ ] Implement group-only splits before model fitting. No scaler or smoothing. Require training labels contain all four classes; missing class reports fail clearly, never remap labels silently. Use sample weights from training labels only for XGBoost.

```python
rf = RandomForestClassifier(n_estimators=200, min_samples_leaf=3,
    class_weight='balanced', n_jobs=2, random_state=42)
xgb = XGBClassifier(n_estimators=350,max_depth=4,learning_rate=.05,
    subsample=.9,colsample_bytree=1,objective='multi:softprob',num_class=4,
    eval_metric='mlogloss',tree_method='hist',n_jobs=2,random_state=42,
    early_stopping_rounds=25)
xgb.fit(X_train,y_train,sample_weight=weights_train,
        eval_set=[(X_validation,y_validation)],verbose=False)
tree = DecisionTreeClassifier(max_depth=3, class_weight='balanced',random_state=42)
# selection uses validation macro_f1; ties choose XGBoost explicitly.
```

- [ ] Evaluate majority and shallow tree (train-only), plus current_class persistence baseline (privileged physical-limit reference, label this in metrics/README). Freeze RF/XGB choice by validation Macro-F1; test and OOD never alter it. Record both RF/XGB results, all baseline results and fixed four classes.

```python
cm = confusion_matrix(y_true,y_pred,labels=[0,1,2,3])
support=cm.sum(axis=1)
recall=[float(cm[i,i]/support[i]) if support[i] else None for i in range(4)]
f1=f1_score(y_true,y_pred,labels=[0,1,2,3],average='macro',zero_division=0)
# high limit FN = count(true==3 & predicted<3)/count(true==3)
# low FP = count(true==0 & predicted>0)/count(true==0)
```

- [ ] Implement local CLI, fresh-output guards before writing, no extra network or secrets. Use csv.DictWriter for machine-readable intermediate observations and JSON metadata. Save XGBoost as JSON and local-trained RF/tree joblib only. Manifest hashes exact files excluding self. Save complete split scenario IDs and label definitions. Store code hashes/software versions/creation time for reproducibility.

- [ ] Run training tests/smoke with the existing scientific environment because bundled Python lacks sklearn; do not install packages or alter environments. Then run the default experiment once to the fresh explicit directory below. If occupied, select a new suffix and report it; never overwrite. Keep all failed result directories identifiable for review, clean only current-task scratch after successful final deliverables.

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.run_experiment --output-dir 'D:\矿业\outputs\roof-mechanics-v1\2026-10-12'
```

- [ ] Read back generated artifacts; check hashes, exact feature count4/model JSON schema, split intersections0, OOD counts and domains, future target compliance, all finite JSON, unchanged teacher hash. Report measured metrics/verification honestly including negative results; do not tune after test/OOD inspection.

- [ ] Write concise Chinese README, result report and small evidence JSON with actual commands/output paths/hashes/counts/metrics/limit checks. Use the design's official references for mechanics and group evaluation. State no sensor noise validation, field parameter calibration, dynamic collapse or production connection. Note original20,000CSV/RF/XGB provenance and pre-processing limitations from delivered audit, with exact local source locators.

- [ ] Run targeted Python suite once and existing Node full suite once for regression before finishing; preserve pristine runtime files. Commit task files only, no large generated dataset/model, no remote push/cloud deploy. Write report with TDD commands, result summary, files and caveats.

```powershell
node --test
git -c maintenance.auto=false -c gc.auto=0 add tools/roof_mechanics tests/roof_mechanics docs/qa/2026-10-12-roof-mechanics-results.md docs/qa/2026-10-12-roof-mechanics-evidence.json
git -c maintenance.auto=false -c gc.auto=0 commit -m 'feat: train and audit independent mechanics warning model'
```

## Final Self-Review

Every design section maps to Task1 (physics/data) or Task2 (training/evidence). Schema names and four-feature order match. No unknown source provenance is filled in. Independent reviewer must review each task and then the whole experiment. New application behavior and cloud publication are outside this plan.
