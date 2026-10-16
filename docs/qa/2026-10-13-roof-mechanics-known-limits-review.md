# 已知限值消融：独立审查记录

日期：2026-10-13。适用范围为离线模拟研究交付，现场适用性仍待指导教师复核；原始审查意见与后续修订按顺序保留。测试执行记录见同目录 `2026-10-13-roof-mechanics-known-limits-tests.md`。

任务一由独立审查者批准，未发现 Critical/Important/Minor；控制器进一步以 V1 存档验证了默认种子的物理输出兼容性。任务二首次审查发现两项 Important，专项复审确认均已解决。整批审查批准离线交付并提出一项非阻断的元数据行数核验建议，对应的最终修订另行记录。

## 任务二：首次独立审查

### Spec Compliance

- ❌ Issues found: The independent readback does not enforce the protocol's requested in-domain/OOD scenario counts or step count. It checks `metadata['scenario_count']` against the scenario list, but never compares `metadata['in_domain_scenarios']`, `metadata['ood_scenarios']`, or `metadata['steps']` and the per-domain scenario counts with `protocol.json` (`tools/roof_mechanics/known_limits_study.py:216`, `tools/roof_mechanics/known_limits_study.py:322`). Thus a self-consistent artifact with fewer or differently allocated scenarios can pass the stated inconsistent-count audit. The mandated held-out-label noninfluence test compares model selection and feature dimensions, but not fitted model behavior or parameters (`tests/roof_mechanics/test_known_limits_study.py:61-65`).
- ⚠️ Cannot verify from this task diff: The precise no-future-feature, first-crossing, incomplete-window, and no-static-limit-filling contracts are implemented in Task 1 helpers consumed at `tools/roof_mechanics/known_limits_study.py:48-49` and `tools/roof_mechanics/known_limits_study.py:226`; the controller should use Task 1's review for those contracts. The reported formal output's existence, hashes, exact scores, single-run history, and runtime-diff gate are external evidence claims, not established by this code diff (`docs/qa/2026-10-13-roof-mechanics-known-limits-evidence.json:1`). RF persistence is hash-checked and its live instance is checked at `tools/roof_mechanics/known_limits_study.py:381-383`, but the saved joblib object cannot be independently inspected under the specified no-pickle-loading policy.

### Strengths

- The two protocols use the same eligible rows and split, with four-column matrices; the fixed RF/XGBoost settings and training-label-only weights are explicit (`tools/roof_mechanics/known_limits_study.py:63-96`). Selection is completed from validation metrics before test/OOD evaluation (`tools/roof_mechanics/known_limits_study.py:101-121`).
- Predictions and row/level-2/level-3 event scores are retained for both models and both baselines across all scored splits (`tools/roof_mechanics/known_limits_study.py:105-133`). The readback rebuilds rows from trajectories, recomputes normalized features and metrics, reloads native XGBoost, and checks the file manifest without deserializing joblib (`tools/roof_mechanics/known_limits_study.py:220-313`).
- The fresh-output guard precedes generation, and the protocol is written before training (`tools/roof_mechanics/known_limits_study.py:340-369`). The Chinese results report identifies the exact simulator-limit information advantage, high level-2 alert burden, and limited OOD shift (`docs/qa/2026-10-13-roof-mechanics-known-limits-results.md:15-29`).

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- `tools/roof_mechanics/known_limits_study.py:216,322-326`: Readback trusts the metadata's total scenario count and the protocol's requested counts independently; it never reconciles total, domain counts, or requested steps. Compare the persisted per-domain scenario counts and metadata counts/steps with `protocol.json`, and reject disagreement. This closes the brief's explicit inconsistent-count verification requirement.
- `tests/roof_mechanics/test_known_limits_study.py:61-65`: The held-out-label perturbation test proves only that selection is unchanged. Checking `n_features_in_ == 4` on both runs cannot detect fitted-model changes. Compare train/validation predictions or stable native model parameters for each fitted RF and XGBoost before and after perturbation, alongside selection. This is a plan-mandated test requirement.

#### Minor (Nice to Have)

- `task-2-report.md:42`: The reported Node suite passed but emitted a `MODULE_TYPELESS_PACKAGE_JSON` warning. It appears pre-existing, yet the required test-output cleanliness is not met; track or remove that warning in the owning Node configuration when convenient.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The experiment path and scientific presentation are largely coherent, but the independent count audit and one mandated noninfluence test are incomplete. The reported full Python, Node, and formal runs were already completed, so I did not rerun them. The review package output was truncated inside required functions; I read the affected implementation and test files once to finish the review. Focused unchanged-code checks: `run_experiment.py:34-43,138-148` confirms strict finite JSON parsing and complete manifest file coverage; `dataset.py:120-143` confirms the generator stores count and step metadata that readback could compare.

## 任务二：第一轮修订复审

### Finding Verdicts

- **Independent readback did not reconcile scenario/domain counts and requested steps with the frozen protocol** — ADDRESSED. `tools/roof_mechanics/known_limits_study.py:215-230` checks metadata, persisted per-domain counts, total count, each scenario's requested steps, and trajectory length against the values passed from `protocol.json` at `:340-342`. The generator's completed schedule produces exactly the requested number of states (`tools/roof_mechanics/dataset.py:99-115`), so the added length check matches the generation contract. The smoke test exercises changed requested and persisted metadata values (`tests/roof_mechanics/test_known_limits_study.py:96-113`).
- **Held-out-label perturbation test checked selection and feature width, but not fitted behavior** — ADDRESSED. `tests/roof_mechanics/test_known_limits_study.py:55-78` perturbs test/OOD targets and compares train/validation predictions for every fitted RF and XGBoost under both protocols, in addition to selection and four-feature checks.

### New Breakage in the Fix Diff

- None identified.

### Out-of-Scope Observations

- None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. The appended fix report records focused GREEN output (`Ran 4 tests`, `OK`) and a read-only formal archive audit; those claims are consistent with the amended code and diff. No tests were rerun for this scoped review.

## 整批代码与报告的独立审查

# Independent whole-branch review

Reviewed range: `8d73eba400841f80890e6d87bb556adb4dee6279..152e40710ecb116b72aaa77cdb4f9af5dabac4a3`.

Verdict: **Ready for offline handoff**, with one nonblocking audit-hardening finding. Counts: Critical 0, Important 0, Minor 1. Human scientific review remains pending; this verdict does not cover production deployment or field validity.

## Findings

### Critical

None.

### Important

None.

### Minor

1. **The original unfiltered metadata row count is not reconciled.** `D:/矿业/worktrees/teacher-feedback-v1/tools/roof_mechanics/known_limits_study.py:235` rebuilds all supervised rows, then discards step zero at line 241 without comparing the original length with `metadata['row_count']`. Subsequent checks correctly reconcile eligible CSV rows, split metrics, scenario counts and requested steps. Consequently an internally inconsistent metadata row count could pass semantic readback if accompanied by a matching manifest, even though the actual evaluated rows remain protected. Preserve the pre-filter length and compare it with this metadata field; add a focused metadata-only mismatch assertion when next hardening the auditor. This is nonblocking for the retained run: stored metadata counts 15,697/15,886 equal eligible counts 15,097/15,286 plus the 600 initial rows in each replicate. Do not change the original formal archive or protocol to address this.

## Architecture and correctness

- The branch remains an additive offline experiment. The supplied whole-branch package changes 15 documentation, mechanics and test files; it contains no production/runtime/deployment modifications. The numerical `solve_beam` implementation is untouched. The new single-center-spring displacement and force check implements the independent compliance solution and applies the specified 1e-4 tolerance, while preserving existing conservation gates.
- Default generator seeds and physical construction remain unchanged. Optional seeds are validated before generation. The retained default-output comparison records exact persisted-format equality for 12 scenarios and 322 rows; its initial numeric-key/string-key discrepancy is explained transparently.
- Feature extraction has an explicit four-field allowlist. Known-limit quotients consume only the current four observations and three finite positive static parameters, with capacity converted to kN. Target, ratio, future trajectory, ID, family and degradation parameters are excluded from the matrix. IDs serve only lookup and grouping. Both protocols exclude step zero and share the same split indices.
- Training weights depend on training labels. Both fits use the frozen hyperparameters. XGBoost early stopping uses only validation data. Both protocol choices finish before test/OOD scoring. The shared split helper keeps complete scenario groups isolated and all OOD groups held out. Validation eligibility, recall/F1/tie priority and fallback match the specification.
- Event accounting uses represented scenarios, validates trajectory/row/target consistency, counts each crossing once, restricts timely alarms to the 1–3 loading-step positive window, and records earliest timely lead. Noncrossing alert burden and zero-denominator nulls are correctly distinguished from row-level classification errors.
- Fresh-directory creation precedes generation and uses an atomic exclusive create. JSON writing rejects nonfinite values, shared parsing rejects both explicit nonfinite tokens and overflowing floats, and the manifest enforces persisted file coverage, sizes and hashes. Readback rebuilds observations/targets, checks normalized values and group membership, recomputes metrics/selection, and reloads native XGBoost predictions. RF persistence is live-instance checked and hash protected, with no claim of serialized RF behavioral validation.
- The first review's two Important findings are addressed: protocol/domain/step reconciliation is explicit, and held-out-label perturbation now compares fitted RF/XGBoost predictions for both protocols in addition to choice invariance. The focused tests are substantive; mocking event evaluation is restricted to intentionally inconsistent-label fitting tests, while smoke/formal paths retain event validation.

## Scientific interpretation and retained evidence

The report correctly presents known_limits4 as a stronger information condition with exact hypothetical simulator limits. It does not attribute the gain solely to generic normalization. Future class prediction, crossing-event detection, and non-limit alarm burden are separate. The current-limit reference already detects every test crossing at alert level 2 and is explicitly discussed, avoiding an unsupported ML detection advantage. Two replicate ranges are descriptive, and the span-only OOD shift, loading-step units, hypothetical limits, lack of field/noise/dynamic-collapse validation and pending human review are clearly stated.

For the named risk of summary transcription and privileged-baseline interpretation, I directly read the retained metrics and metadata. Test Macro-F1 agrees with the report: raw4 0.547191297432032/0.5397029119290978 and known_limits4 0.9436696803561108/0.9365104357231915. The current-limit level-2 reference has timely counts 66/66 and 75/75, with non-limit alarm counts 24/34 and 20/25. Direct protocol and manifest hashes match the evidence JSON: `034573c052d48b0b118df9c78ce505d214c7c16b19d35dc7d92ee63766899d7d` and `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`.

Original training hashes and outcomes remain preserved. The later auditor/test changes are separately identified in both results and evidence; the retained training protocol has not been retroactively relabeled with current source hashes. The recorded pre/post frozen-field comparison, one formal run, 26-file manifest checks and CSV preservation are consistent across the ledger and archived test report. These execution-history assertions rely on retained controller/implementer evidence; this review did not repeat them or claim to independently observe historical execution.

## Deferred Node warning

The retained record reports 228/228 passing Node tests and a pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning for the ECharts module. The supplied package does not change the owning JavaScript or package configuration, and this Python-only offline study does not execute that module. The warning is a separate repository-maintenance item, not an offline scientific/result correctness defect or a handoff blocker. No Node configuration change or suite rerun is warranted for this scope. It is not counted as a new branch finding.

## Review scope and limits

Read the complete brief, design, plan, ledger, task reports, initial review, fix re-review, retained QA documentation and supplied whole-branch package (with pagination). Focused unchanged-code inspection was limited to `train.py` for feature allowlisting/group isolation/metric denominators and `run_experiment.py` for finite JSON and manifest guarantees. No full Python/Node suite, training, simulation regeneration, package installation, joblib load, Git mutation or network/cloud request was performed. Only this review report was written. Formal score/hash spot checks were read-only and targeted the numerical/evidence concerns described above.


## 最终审查意见修订的专项复审

### Finding Verdicts

- **The original unfiltered metadata row count is not reconciled** — ADDRESSED. `tools/roof_mechanics/known_limits_study.py:235-243` now rebuilds every supervised row, compares its pre-filter length with `metadata['row_count']` at line 241, then removes step-zero rows. This matches the generator's `row_count=len(rows)` assignment in `tools/roof_mechanics/dataset.py:143`. `tests/roof_mechanics/test_known_limits_study.py:101-109` adds a metadata-only `row_count=999` mismatch to the smoke readback rejection cases; the reported RED failure and GREEN pass cover the new assertion.

### New Breakage in the Fix Diff

None. The new comparison precedes filtering and leaves the eligible-row, split and manifest checks in place. The QA additions distinguish final readback code hashes from the original training protocol and manifest.

### Out-of-Scope Observations

None.

### Checks

- Read the task brief, original finding, appended fix report and supplied `152e407..47ad050` package; inspected only the source context needed to confirm `metadata.row_count` semantics. No git commands, test suites, training, joblib loads or formal-output writes were run.
- The implementer report names `test_known_limits_study.py` and records RED `Ran 4 tests ... FAILED (failures=1)` with `ValueError not raised`, then GREEN `Ran 4 tests ... OK`. Its read-only retained-output audit reports 15,697/15,886 unfiltered rows and 15,097/15,286 eligible rows over 600 scenarios per replicate, with the original 26-file manifest still matching. These execution claims were not independently rerun.

### Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** Open findings: none.

## 控制器交付核验

代码与验收修订提交为 `47ad050a7625a027b7fbb6354d6700c587d5885a`。最终核验源码和测试 SHA-256 与 `post_final_readback` 记录一致，原训练协议与 26 文件清单未改动。两项 Important 和一项 Minor 均已修订并独立复审。预先完成的 Python 全套为 39/39、Node 为 228/228；两轮回读修订均重新执行相关 4 项测试并通过，全套和正式训练未重跑。原 Node 模块类型警告已由整体审查归为与离线实验无关的维护项。

最终交付范围为可复现的离线模拟研究链路，未推送或部署模型。教师 CSV、原 V1 存档、原算法交付、网站运行代码和已有未跟踪发布记录保持原样。人类科学审阅及现场参数验证仍待完成。
