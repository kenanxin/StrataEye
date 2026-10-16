# 限值误差评估：独立审查记录

日期：2026-10-13。任务审查提出的一项 Important 与一项 Minor 已由专项复审确认处理，整批审查亦已通过，无未解决意见。原运行记录缺项仍保留，新复核提供独立保存的代码来源记录；它使用相同数据与模型，不增加独立样本。人工科学审阅状态仍为 pending。

## 设计审查

# Design audit — fixed limit-estimation sensitivity

Date: 2026-10-13. Scope: pre-implementation review of the frozen design and plan; read-only inspection of existing interfaces and formal source metadata. No training, evaluation run, or source change.

## Verdict

No blocking scientific or interface contradiction found. The plan is implementable as an offline, post hoc descriptive pressure test. The formal source manifest SHA-256 is `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`; both protocols in both formal replicates record `xgboost` as the original validation choice. The design still fixes the native XGBoost candidate when a small test fixture selects differently, so there is no reselection from stress outcomes.

The true simulator parameters, trajectory-derived future labels and first-crossing events remain anchored to the source. Estimated limits affect only the four normalized input columns and the current-limit reference. The existing `engineering_feature_matrix` divides deflection and increment by `deflection_limit_mm`, support force in kN by `capacity_n/1000`, and stress by `bending_strength_mpa`; `classify_ratio(max(matrix[i,[0,2,3]]))` matches the original current-limit reference. The existing event scorer checks the original trajectory and target rows, so using original scenes and rows preserves event truth.

The arithmetic is consistent: 1 exact case plus 3 parameters × 6 errors = 19; 2 replicates × 2 splits × 19 cases × 2 affected predictors = 152 score cells, plus 4 fixed raw4 scores = 156 comparison rows. Test and OOD split indices and source predictions are persisted. Exact and raw4 predictions and full row/event score dictionaries can therefore be compared directly with the original archive. Recomputing biased matrices in readback from raw observations and static limits, without calling the production transform, gives a materially independent content check; the manifest and source-hash checks cover file integrity.

## Implementation points to retain

- Keep the 10/2/12 `run_study` fixture outside the sensitivity no-fit guard, as the plan states. That fixture is test setup; formal evaluation consumes the 26-file source archive only.
- Check every CSV row's identity and values against the structured results, not merely its count of 156. Preserve `null` for rates with zero denominators and retain event lead-step lists in the structured results.
- Treat the ±5/10/20% grid as hypothetical. The original high Macro-F1 applies to exact simulator limits; this analysis estimates sensitivity to specified input bias, not a field error distribution or independent accuracy.



## 任务首次审查

### Spec Compliance

- ✅ The diff implements the fixed 19-case registry, immutable denominator transform, original test/ood frozen XGBoost scoring, 156 cells and CSV rows, source preflight, fresh output, and independent semantic readback (`tools/roof_mechanics/limits_sensitivity.py:26-379`). The focused tests exercise arithmetic, invalid inputs, pre-scoring protocol creation, no-fit model prediction, persistence, and tamper rejection (`tests/roof_mechanics/test_limits_sensitivity.py:22-94`).
- ⚠️ Cannot verify from diff: the once-only formal output's actual six files, 26-file source manifest digest, teacher CSV digest, readback success, and reported numerical cells live outside this diff. The controller should compare the preserved output and source to the report's recorded hashes without rerunning scoring. The reported Git command history and pre/post filesystem state likewise are not established by this diff.
- ⚠️ The brief requires source hashes, versions, and a frozen protocol before scoring. The code now records those and seven analysis-code hashes before `_calculate` (`tools/roof_mechanics/limits_sensitivity.py:319-338`), but the preserved formal protocol predates that addition. The brief does not explicitly demand evaluator/test code hashes, so I do not mark this historical omission as a literal spec failure. The provenance consequence is an Important quality finding below.

### Strengths

- Source `readback_study` compares trajectory-derived rows to `observations.csv`, checks splits, scores, selection, and native XGBoost predictions; its readback path does not deserialize RF/joblib (`tools/roof_mechanics/known_limits_study.py:239-251, 268-330`). This focused check addressed the named risk that the new `_source_replicate` rebuilds rows without a local CSV comparison.
- `engineering_feature_matrix` validates four-column shape and finite normalized values (`tools/roof_mechanics/known_limits.py:58-89`). This focused check addressed the named risk that `biased_feature_matrix` delegates its final validation.
- New readback reconstructs denominators independently and compares complete predictions, scores, CSV fields, and manifest contents (`tools/roof_mechanics/limits_sensitivity.py:96-124, 229-308`). The evidence text plainly discloses the historical code-provenance gap (`docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-results.md:50`).

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- `docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-evidence.json:42-61`: the preserved formal protocol lacks a pre-scoring commitment to the evaluator and test bytes, as the evidence itself states. The later snapshot and future-run code change cannot establish the exact code that produced this formal result. For an audited scientific result this limits independent provenance verification. Keep the original output intact; acceptance needs an explicit ruling on the disclosed limitation, or a separately authorized and dated new formal evaluation with pre-scoring hashes.

#### Minor (Nice to Have)

- `tools/roof_mechanics/limits_sensitivity.py:337-339`: the `command` field always synthesizes a fully explicit CLI command, even when the formal CLI used defaults or the Python API called `run_sensitivity`. Label it a reproducible command or capture the actual invocation to avoid implying it is a verbatim execution log.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The implementation is coherent and the reported tests cover its main risks. The historical formal output cannot gain a pre-scoring code commitment through the later compatibility fix, so the provenance limitation remains material to acceptance as an audited result. I did not rerun reported tests or the formal experiment.



## 第一轮修订复审

### Finding Verdicts

- **Formal code provenance** — ADDRESSED for acceptance by a separately dated technical reproduction, not by repairing the original protocol. The original omission remains expressly disclosed (`docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-results.md:50`); the new evidence records a distinct protocol with seven pre-scoring code hashes, independent readback, and complete equality of both results/predictions JSON and the CSV (`docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-evidence.json:58-92`). The dated plan/spec amendments freeze this route before the extra run (`docs/superpowers/plans/2026-10-13-roof-mechanics-limits-sensitivity.md:128-137`; `docs/superpowers/specs/2026-10-13-roof-mechanics-limits-sensitivity-design.md:39-47`). My focused read-only artifact check found old/new `results.json`, `predictions.json`, and `comparison.csv` SHA-256 values equal; the two protocol and manifest hashes match the distinct reported values, and all seven hashes in the new protocol match current files. This supports reproducibility of the same saved-model simulation result while leaving the first run's historical gap visible. It adds no independent sample or field evidence, as the QA text states (`docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-results.md:61`).
- **Synthesized command labeled as actual invocation** — ADDRESSED. The generated protocol field is now `reproducible_command` (`tools/roof_mechanics/limits_sensitivity.py:338-340`), with the actual verification invocation separately recorded (`docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-evidence.json:62`; `docs/qa/2026-10-13-roof-mechanics-limits-sensitivity-results.md:54-58`). Focused tests assert the new field and absence of `command` (`tests/roof_mechanics/test_limits_sensitivity.py:78-79, 88-89`).

### New Breakage in the Fix Diff

- None. The fix changes the protocol label, tests, and provenance documents; it does not alter the scoring path. The report names the covering `test_limits_sensitivity.py` command and its `Ran 3 tests in 10.175s / OK` output. I did not rerun tests or scoring.

### Out-of-Scope Observations

- None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. The first formal protocol remains historically incomplete; the new distinct, content-identical technical reproduction supplies the prospective code commitment and is accurately limited to the same source and models.



## 本计划执行台账（整批审查前）

# SDD ledger — plan: D:/矿业/worktrees/teacher-feedback-v1/docs/superpowers/plans/2026-10-13-roof-mechanics-limits-sensitivity.md

Original baseline1daff1e3201f068448423a7bf365b14e6fd27790. Branch codex/teacher-feedback-v1, isolated offline continuation. Earlier plan completed and its scratch removed; permanent QA records retained.
User continue authorizes further offline evaluation of teacher second suggestion; scope explicitly no deployment/training/model change. Design and plan self-reviewed; unit-fixture exception clarified before execution. Fixed protocol commitd4e0cf0. One Task owns no-fit native-model stress evaluation, tests, stored outcome/evidence.
Windows no Bash; reviewed native PowerShell adaptation creates briefs/review packages mechanically. Previous final-code-reviewer/finishing templates unavailable, explicit independent final review fallback remains applicable.
Formal original source manifest031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537 and26files preserved. New formal sensitivity directory must not exist. Human scientific review pending.
New study is post-hoc descriptive single-factor sensitivity, not a new independent performance evaluation or a field-calibrated noise distribution. All original true labels/trajectories/physics/selection preserved.
Task1 BASEd4e0cf0d3416a1421a56f2523f04698f67fde85e, dispatched to /root/limits_sensitivity_impl after controller preflight clean. Independent read-only /root/limits_sensitivity_design_audit runs concurrently; no parallel implementer. One formal evaluation run only; fresh output absent before dispatch.
Design audit clean: no scientific/interface contradiction, formal manifest and both prior selections confirmed. Three checks forwarded to implementer: fixture outside no-fit guard, CSV content-by-row semantic check, hypothetical error-grid interpretation. Original-selection recomputation inside source readback is an integrity audit, not forbidden pressure-based reselection. CSV null metrics remain empty cells rather than zero. No case/parameter values changed.
Shared parent .superpowers/sdd/.gitignore is absent, but existing repository .gitignore line4 ignores .superpowers/ and git check-ignore confirms this plan scratch is ignored; do not rewrite user ignore configuration.
Controller inspected formal protocol before inspecting pressure scores: fullSHA23c0a6b35f12b52aff1d5d72d04f4b4aad00b5df27fea7f16a59cd08d2ccaf72. Cases/source/versions frozen, but new evaluator/test/current dependency code hashes were omitted. Implementer confirmed no pre-run capture elsewhere; original formal archive remains unchanged. This is a provenance deviation, not to be backfilled.
Controller captured original evaluator/test/dependency hashes AFTER the run and BEFORE provenance fixes, explicitly named formal-evaluator-post-run-snapshot.json. Do not claim it pre-run. Preserve and later archive it in permanent QA. Formal run stays single; future protocol must capture evaluator code hashes before stress scoring. Reporting/amended acceptance must expose missing pre-run source capture to independent reviewers.
Implementer reports focused3/3 and fullPython42/42, once-only formal and separate156-cell native semantic readback passed. Current task files remain uncommitted. Controller directed future-run pre-scoring source/test/dependency capture plus a targeted ordering test, keeping the original formal archive immutable. Original study record still lacks that pre-run code capture; independent reviewers receive the discrepancy without a pre-judged severity or acceptance.
Controller first inspected the actual pressure results after original protocol/hash inspection and post-run snapshot. Antibending-strength bias creates marked underestimation/false-positive changes; no conditions changed in response. Forwarded one prose denominator mismatch (A/ood class0=641 vs printed range upper622) to implementer before initial review.
Task1 implementation handoff HEAD6a9689240c70553179b517afdfb0d6aa89b9b744, DONE_WITH_CONCERNS. Five task files committed. Future-run code capture and ordering assertion added; focused3/3 passed after fix, original42/42 suite refers to pre-provenance-fix evaluator and is dated separately. Original formal protocol requirement remains historically unmet and explicitly reported. Task-scoped independent review follows; no Task1 completion declared yet.
Task1 first review: diff-verifiable spec approved; quality Needs fixes, Important1 historical pre-scoring evaluator provenance, Minor1 synthesized command mislabeled as invocation. External32file hash/byte check completed independently at05:21:10.0629581Z, teacher unchanged. Original protocol23c0...af72 remains immutable.
Under the user's explicit autonomous-design/implementation instruction, controller dated a visible amendment before any new scoring: retain original once-only run, execute one separately dated code-provenance reproduction in a fresh distinct directory using the SAME input/model/cases/metrics; compare complete outputs, stop on mismatch. This is a response to the review finding, not silent retrospective acceptance or an independent new experiment. Human scientific approval stays pending. Original Important/Minor findings are carried into fix round1 and scoped re-review.
Controller independently inspected the new reproduction after it existed: protocol raw created_utc05:31:41.165792+00:00, SHA1a826f836c01dee4aaecc1d4c8bdb3d22f560f135fbdaed6b24e58bad23a75cf; manifest2ac52ca42730ae8223d4bed8fbeffd07ed34f738fa96b11e38eb1f47b7be8eba, all6files hash/bytes verified, all7pre-scoring code hashes match current files. Original/new results.json, predictions.json and comparison.csv are BYTE IDENTICAL, stronger than complete-object equality. Protocol created_utc raw string retained; PowerShell JSON deserializer displayed local offset for the same instant, not a protocol mutation. This file/code check resolves external-evidence items without rerunning scoring.
Task1 fix round1 implementer handoff HEADc9ed4a6b7325164f082016ea3e5bf7b0decb3647: focused3/3 passed, new one-time reproduction/native readback passed, complete objects/CSV equal. Five task files committed separately from prior controller amendment11f4591. Re-review package spans original reviewer HEAD6a96892 throughc9ed4a6, preserving review amendment and fix together. Historical omission remains disclosed; task completion waits for scoped verdict.
Task1 fix round1/5: both findings ADDRESSED,0open; scoped reviewer independently read hashes, confirmed three files identical and seven new protocol code hashes current; new Critical/Important/Minor0. Original historical capture gap remains disclosed, acceptance uses the new dated technical reproduction. External-evidence items resolved by controller32+6file/bytes checks and independent reviewer hash check, not a repeated scoring run.
Task1: complete (commitsd4e0cf0..c9ed4a6, review clean after fix round1). No deferred Minor or parked finding. Preserve historical protocol deviation and separate reproduction in permanent records. Whole-branch review from plan baseline1daff1e follows; no cloud or runtime change authorized.


## 整批最终独立审查

# Independent whole-plan final review

Reviewed baseline `1daff1e3201f068448423a7bf365b14e6fd27790` through `9cfc176cdecea2cacf129d1e3979999517f0b3b6` on 2026-10-13. Assessment: **ready for offline handoff**. Open findings: **Critical 0 / Important 0 / Minor 0**.

## Scope and method

The required final-review template was unavailable, so this is an explicit broad correctness, specification, scope, evidence, maintainability and testing assessment. I read the entire current-plan change through the supplied diff package and direct file reads where tool output was truncated, the frozen design and its dated amendment, implementation plan, scratch ledger, archived execution record and both task reviews. This covers all ten changed files and the entire evaluation implementation, not just the final provenance fix.

Focused unchanged-code inspection addressed two concrete dependency risks: whether delegated engineering normalization rejects invalid limits/observations, and whether source readback really compares reconstructed observations with stored CSV/splits and reloads native XGBoost without RF deserialization. No unrelated earlier implementation or production code was re-reviewed. No tests, model fitting, scoring or semantic readback were rerun. The only write was this report.

## Findings

Critical: none. Important: none. Minor: none.

The first formal protocol's missing pre-scoring evaluator capture is still a historical limitation, explicitly retained in results line 50 and evidence JSON. The dated amendment and separate reproduction address acceptance through prospective provenance for the reproduced result; they do not establish the original evaluator bytes retroactively. This distinction is consistently stated and is not an open implementation finding.

## Correctness and specification

- `tools/roof_mechanics/limits_sensitivity.py:26` fixes exactly 19 conditions: exact and six signed errors for each of three parameters. The loop at line 146 produces four raw references and 152 affected cells, using only saved native XGBoost candidates. It validates four features/classes and compares exact predictions and full scores with original candidate and current-limit results.
- `limits_sensitivity.py:78` copies scenario/parameter dictionaries before perturbation. Both deflection columns share the modified limit; capacity retains its N-to-kN conversion. `_score` at line 129 receives original rows and scenarios, keeping future truth and event crossings independent of estimated denominators. The unchanged normalizer validates all static limits and raw inputs, including bool/nonfinite rejection; selected-limit validation also occurs before multiplication.
- `_independent_matrix` at line 95 explicitly reconstructs all four denominators without the main transform. `_content_audit` at line 229 compares full results and prediction lists, original selections, every CSV field and row, source identity, case registry and counts. Manifest coverage and stored readback consistency are checked at line 288. This is useful independent transformation verification, although metrics and orchestration are intentionally shared rather than a second independently implemented science pipeline.
- `run_sensitivity` at line 309 rejects existing/overlapping output and incorrect expected source digest before creating results. The new protocol and seven code hashes precede pressure scoring. Source and teacher hashes are checked again, and failed directories are preserved. CSV conversion at line 225 retains missing rates as empty fields; structured results retain nulls and full event details.
- The diff adds only the separate evaluator, tests and documentation. It does not alter simulation, teacher data, model fitting, old models, thresholds, runtime or deployment. Original validation-selection recomputation belongs to the integrity readback and does not select on sensitivity outcomes.

## Evidence checked independently

Read-only hash/byte checks found no mismatches in all 26 source-manifest entries and all six entries in each output manifest. Source manifest remains `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`; original/new output manifests remain `ee78b6e789f7344461e58c9e6e94bcdd93a92cff5f281622b09677a1e29c35bf` / `2ac52ca42730ae8223d4bed8fbeffd07ed34f738fa96b11e38eb1f47b7be8eba`. Original/new protocol hashes match their evidence records. Teacher CSV matches both protocols. All seven new-protocol code hashes match current files. SHA-256 equality confirms complete original/new results JSON, predictions JSON and comparison CSV identity, consistent with the previously recorded full-content comparison.

I compared all 28 published exact/±20% known-limits rows with the stored CSV: rounding, class-3 recall, underestimate counts, low-class false positives, level-3 timely counts and level-2 non-event burden agree. The stated level-2 timely counts equal the original event denominators for those rows. The adverse bending-strength outcomes are conspicuous and accurately reported: positive 20% bias misses class 3 in 198/198, 199/207, 223/225 and 201/207 rows; negative 20% bias causes 313/601, 306/641, 290/621 and 320/622 low-class false positives.

Reports identify mechanics_simulation, post hoc fixed-model analysis, hypothetical error magnitudes, unchanged samples, single-factor coverage and human scientific review pending. They do not convert technical reproduction into independent validation or a field tolerance claim. The source/code commitment and actual invocation versus reproducible command distinction are preserved in the permanent evidence.

## Tests and maintainability

The archived gate is 42/42 before provenance changes, followed by focused 3/3 after each provenance/command fix; the chronology is disclosed rather than implying the full suite ran on the last revision. The focused suite covers arithmetic, immutability, invalid input, a real native-model/no-fit persistence path, pre-scoring protocol ordering, hash/overlap/no-overwrite guards and manifest tampering. Fixture generation occurs before the no-fit guard. No concrete correctness doubt found in this review warrants repeating those runs or scoring.

The evaluator is a cohesive offline module, reusing previously reviewed metric and serialization helpers without altering them. Positional prediction lists remain deterministic and are checked in full against cell order; the full result cells preserve their identities. The code-hash equality check deliberately binds readback to the recorded implementation, so future code revisions require checking out the matching version for this archive. This is consistent with the stated audited offline scope.

## Handoff limits

Ready means ready to hand off the offline implementation, results and audit evidence for human scientific review. The first run's historical capture gap remains visible; the accepted reproducibility evidence is the separately dated same-source reproduction. No field validity, joint/random-error behavior, additional independent sample, production readiness or deployment approval is established. No open or deferred finding remains in this whole-plan review.

## 关闭说明

整批审查范围为计划基线 1daff1e 至归档提交 9cfc176。审查后只补充最终审查记录与计划完成标记，评分代码及七个固定代码哈希保持不变。研究分支留在本地，没有合并、推送或部署。历史首轮记录缺项继续保留，数值接受依据为单独的同源技术复核。人工科学审阅与现场适用性验证仍待完成。
