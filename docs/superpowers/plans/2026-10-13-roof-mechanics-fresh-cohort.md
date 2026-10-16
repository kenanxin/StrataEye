# Fresh Simulation Cohort Recheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recheck the frozen model/uncertainty tradeoff on newly seeded, nonduplicated simulated cohorts without fitting or selecting anything from the new outcomes.

**Architecture:** One offline runner generates and archives two evaluation-only cohorts, reuses reviewed scoring and independent-denominator helpers, and verifies deterministic replay. After its review gate, a separate task executes the formal study and writes evidence-bound QA.

**Tech Stack:** Existing Python/NumPy/XGBoost/unittest, native JSON models, JSON/CSV/SHA-256; no dependency additions.

## Global Constraints

- Work in D:/矿业/worktrees/teacher-feedback-v1 on codex/teacher-feedback-v1; phase base 7d261e5. Preserve unrelated untracked files and prior experiments.
- Source D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13; manifest SHA-256 031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537.
- Original replicate-a/b known_limits4 XGBoost models remain unchanged; each evaluates its corresponding new cohort. No fit, new model selection, threshold/width tuning, teacher mutation, web/server change, cloud action, push or deployment.
- New cohort fresh-replicate-a seeds 51101/52101; fresh-replicate-b seeds 51102/52102. Formal 100 in-domain and 100 ood per cohort, steps32, total400 scenarios. Smaller positive non-bool counts and integer steps>=4 allowed only through explicit recorded configuration, primarily tests.
- New groups fresh_in_domain/fresh_ood use all generated eligible rows solely for evaluation. No train/validation groups. Same quasi-static generator, future-three-loading-step label and step0 exclusion.
- Reuse all27 existing CASES, bound .20 and GRID27, CANDIDATES center/sampled_upper/estimated_current_limit, existing row/event alert2/alert3 metrics and _summary. 324 cells,108 summaries/prediction records,324 CSV rows, no performance acceptance threshold.
- Scope fresh_seed_same_simulator_recheck. Finite samples, hypothetical errors, no continuous/confidence guarantee, no field calibration/live integration. Human scientific approval pending, submission_ready=false.
- Full ten-file archive; source/model/teacher hashes before/after and pre-generation code/test hashes. Native model only, no external pickle.
- Fingerprint canonical JSON {domain,family,parameters} sorted keys, compact separators, allow_nan=False; check old/new and new/new duplication, global ID uniqueness, new seeds distinct from original source seeds.
- apply_patch edits; Git maintenance.auto=false and gc.auto=0, stage exact owned paths; no destructive Git operation.
- Python D:/矿业/smart-mine-v2-balanced/.venv-data/Scripts/python.exe with -B. Formal output D:/矿业/outputs/roof-mechanics-fresh-cohort/2026-10-13 must not exist.

---

### Task 1: Fresh-cohort offline runner, audits and tests

**Files:** Create tools/roof_mechanics/fresh_cohort_study.py and tests/roof_mechanics/test_fresh_cohort_study.py; prepend usage/boundary section in tools/roof_mechanics/README.md.

**Interfaces:**
- Consume generate_dataset(in_domain_scenarios,ood_scenarios,steps,*,in_domain_seed,ood_seed), eligible_rows(dataset), engineering_feature_matrix(rows,scenarios), supervised_rows, _models(source), _source_replicate(source,name), _score(rows,scenarios,indices,values), _summary(rows,envelope), _independent_sample(model,rows,scenes,case), _csv_row(cell), CSV_FIELDS, CASES, GRID, CANDIDATES from existing modules. Inspect the exact signatures before coding.
- Produce run_fresh_cohort_study(source_dir,output_dir,expected_manifest_sha256,in_domain_scenarios=100,ood_scenarios=100,steps=32)->dict, readback_fresh_cohort(output_dir)->dict, scenario_fingerprint(scenario)->str, audit_disjointness(original_scenarios,cohorts)->dict. Module CLI exposes source/output/expected hash/count/steps flags. cohorts is a dict from fresh cohort name to generated dataset.

- [x] **Step 1: Write meaningful failing tests.** Include pure fingerprint order insensitivity, duplicate old/new parameters despite different IDs, duplicate new/new and duplicate IDs, malformed counts/steps and seed contract, plus an actual integration using run_study(temp_source,10,2,12) as original model fixture. Fit only during original fixture creation. New runner configuration2/2/12 produces two fresh cohorts and all324 cells/108 records. The integration asserts canonical fingerprint check, all group row indices refer solely to correct new domain, source/model/teacher bytes unchanged, every output file covered, and exact new predictions equal direct saved-model inference on the new normalization (not old predictions).

```python
from tools.roof_mechanics.fresh_cohort_study import (
    run_fresh_cohort_study, readback_fresh_cohort,
    scenario_fingerprint, audit_disjointness,
)
scene = {'scenario_id':'old', 'domain':'in_domain', 'family':'load_ramp',
         'parameters':{'length_m':8.0,'capacity_n':500000.0}}
same = dict(scene, scenario_id='new', parameters={'capacity_n':500000.0,'length_m':8.0})
self.assertEqual(scenario_fingerprint(scene), scenario_fingerprint(same))
with self.assertRaisesRegex(ValueError, 'duplicate'):
    audit_disjointness([scene], {'fresh':{'scenarios':[same]}})
```

- [x] **Step 2: Run focused RED.** `python -B -m unittest discover -s tests/roof_mechanics -p test_fresh_cohort_study.py -v`; capture actual missing-module failure.

- [x] **Step 3: Implement the frozen runner.** Keep existing files unchanged except README. Resolve path overlap/overwrite/hash/numeric errors before creating output. Run old source readback, load native frozen models, check fresh seeds against original protocol. Before first generate_dataset call, write full protocol and code/test/helper hashes including solver.py. New constants mapping:

```python
COHORTS = (
    dict(name='fresh-replicate-a', model_replicate='replicate-a', in_domain_seed=51101, ood_seed=52101),
    dict(name='fresh-replicate-b', model_replicate='replicate-b', in_domain_seed=51102, ood_seed=52102),
)
DOMAINS = (('fresh_in_domain','in_domain'), ('fresh_ood','ood'))
for spec in COHORTS:
    dataset = generate_dataset(in_count, out_count, steps,
        in_domain_seed=spec['in_domain_seed'], ood_seed=spec['ood_seed'])
    # Prefix all scene and row IDs with spec['name']; archive the full dataset.
    # Eligible rows retain their indices after excluding step0; partition by domain.
```

Use records replicate=spec['name'], split=new group name, source_model_replicate explicit metadata. For each new domain/case:

```python
indices = [i for i,row in enumerate(rows) if row['domain'] == domain]
selected = [rows[i] for i in indices]
exact = engineering_feature_matrix(selected, scenes)
ed, ec, es = case['relative_errors']
center = exact / np.asarray([1+ed,1+ed,1+ec,1+es])
envelope = sample_limit_error_predictions(models[spec['model_replicate']], center, .20)
physical = [classify_ratio(max(value[[0,2,3]])) for value in center]
summary = _summary(selected,envelope)
# Preserve all envelope fields and indices, score all CANDIDATES via _score;
# cell shape matches existing _csv_row and all metrics/denominators stay unchanged.
```

Ten-file archive: protocol.json,results.json,predictions.json,comparison.csv,source-check.json,readback.json,manifest.json,disjointness.json and cohorts/{fresh-replicate-a,fresh-replicate-b}/dataset.json. Archive original-selection metadata and native hashes. Full raw data/parameters/trajectories, verification and metadata saved; manifest excludes only itself. No fit, pickle load or output overwrite. Reject nonfinite JSON. Progress prints at generation/scoring boundaries, not full datasets.

Independent content audit checks frozen scope/COHORTS/seeds/counts/grid/cases/rows, code/model/source/teacher metadata equality and exact expected file coverage. Replay new dataset generation from protocol and compare complete archived datasets (this verifies determinism, not a second source); rebuild eligible rows via supervised_rows and compare raw stored rows. Reuse _independent_sample for independent raw denominators, not production sample_limit_error_predictions or engineering_feature_matrix, then shared score/summary/CSV functions. Compare every prediction/cell/summary/disjointness field and all CSV row values. Run audit once after scoring, write readback, freeze manifest; final verification checks manifest and metadata without another heavy prediction/generation pass. readback_fresh_cohort separately performs full content audit on demand. Correctly distinguish manifest check count, datasets and regenerated scenarios.

- [x] **Step 4: Finish tamper/no-fit tests and GREEN.** Guard XGBClassifier.fit and RandomForestClassifier.fit in all new runner/replay code paths; assert protocol/code hashes exist before first generator call. In readback patch production sampling and production engineering_feature_matrix to raise and verify audit succeeds. A CSV edit fails manifest; an altered dataset then recomputed manifest fails deterministic replay; an altered prediction then recomputed manifest fails semantic audit; restore only test temporary fixture bytes for each test, never real artifacts. Existing output/overlap/wrong hash rejected; source/teacher unchanged. Focused command plus full `python -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v` once before final task commit. No Node suite since no web/server change. Document usage and simulation/source limitations in README. Use fresh destinations for stopped/failed test archives.

- [x] **Step 5: Self-review, commit and task report.** Stage only new runner/test/README. Report actual RED/GREEN/full commands, output footers, exit codes, source preservation, files and concerns at controller-provided scratch task report. Stop before formal study; controller task reviewer gate follows.

### Task 2: Single formal run and evidence-bound report

**Files:** Create docs/qa/2026-10-13-roof-mechanics-fresh-cohort-results.md, -evidence.json, -tests.md, -review.md. After approval, controller archives task execution reports here and cleans only this plan scratch.

**Interfaces:** Consume approved run_fresh_cohort_study CLI and ten formal files; produce readable honest results and execution evidence, no implementation changes.

- [x] **Step 1: Confirm immutable code/tests and absent formal output; execute once.** Task1 already approved. Resolve all concrete review gaps before dispatch. Freeze code/test/hash baseline throughout formal scoring. Actual call:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.fresh_cohort_study --output-dir 'D:\矿业\outputs\roof-mechanics-fresh-cohort\2026-10-13'
```

Capture actual command, exit code, JSON UTC timestamp raw (avoid PowerShell date roundtrip), versions, source/teacher/model before/after hashes, complete manifests and archive audit totals. No full suite/repeated scoring/training. Any failure archive remains; diagnose without overwriting or changing seeds to improve outcomes.

- [x] **Step 2: Write actual complete QA.** Source protocol/results/predictions/CSV/readback/datasets/disjointness bind evidence IDs. Show exact and strength+20% for four groups, center/upper class3 underestimates with denominator, low-class false positives with denominator, Macro-F1, review row/scenario ratios and event alert2/alert3 denominators. Include all eight joint-condition adverse maxima with complete ties and link all324 CSV rows. Compare old/new exact/strength descriptive counts/fractions only with named different populations; no significance, causal improvement, pooling or field reliability claim. Keep all negative findings, residual underestimates and audit boundaries. Interpret review flag separately from human correction; no performance acceptance threshold.

Evidence stores formal code baseline, analysis intent=same_simulator_new_seed_descriptive_recheck, formal_invocation_count=1, technical statuses task1 approved/final whole-delta pending, human_scientific_approval=pending,submission_ready=false, no_live_integration. Include original source hash and new nonduplication definition. Scientific-writing flow reference is workflow-only, metadata checked by root on 2026-10-13; accessible at https://arxiv.org/abs/2609.00065. Authors Timothy Kassis, Vinayak Agarwal, Yuhuan He, Darshil Patel, Aubrey M. Brueckner; doi10.48550/arXiv.2609.00065. Reference human verification pending.

- [x] **Step 3: Self-review and commit named QA.** Validate JSON syntax, readback totals and manually compare every main-table value to CSV. Detailed task report contains literal command/result and files; return concise status/commit/counts/concerns. Only docs change at this stage; task reviewer gate and broad current-phase final review follow before handoff. Controller sends verified conclusion to authorized defense chat, closes ledger/plan and preserves execution evidence; no cloud writes.

## Completion — 2026-10-14

Tasks1/2 and whole-current-phase technical review completed. Initial range7d261e5..c107cc4 met implementation/numeric requirements with2Minor documentation findings; single correctionc107cc4..50360d8 passed independent scoped re-review with both ADDRESSED and no new findings. Frozen implementation085dfa9 and formal output remain unchanged. Permanent QA contains execution/requirements/review records and controller phase ledger; final evidence records E14/E15/E16 and115claim mappings. Only offline technical handoff approved; human scientific/literature approval pending,submission_ready=false,no_live_integration=true. No push/deployment. Final controller metadata/hash/cleanup checks preserve original data and existing unrelated files.
