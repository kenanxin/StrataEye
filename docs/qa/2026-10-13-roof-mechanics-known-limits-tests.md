# 已知限值消融：测试与独立核验记录

日期：2026-10-13。该记录保留本轮实现者的 RED/GREEN 命令、测试输出摘要及单次正式运行证据；独立审查结论另外记录。离线研究分支为 `codex/teacher-feedback-v1`，没有远程推送或替换线上模型。

## 控制器独立检查

- 原 V1 存档清单 11 个文件的尺寸和 SHA-256 均匹配。
- 默认种子生成的 12 个工况和 322 行有监督数据与 V1 存档在持久化 JSON 格式下逐项相同。首次严格 Python 字典比较仅因数字弹簧节点键在 JSON 中变为字符串而失败；统一持久化表示后通过。新增解析校验字段不在物理输出等价范围内。
- 新存档清单的 26 个文件尺寸和 SHA-256 均匹配。清单自身 SHA-256 为 `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`。
- 正式运行前后冻结协议的 18 项字段序列化哈希相同，均为 `79dbd4ee554ae84144729ac493c62dfa08f002249b98c97803b9cb6f39646aa0`。字段顺序为 created_utc、source_kind、frozen、in_domain_scenarios、ood_scenarios、steps、replicates、split_fractions、excluded_step、feature_names、class_thresholds、future_window_steps、selection_rule、model_parameters、information_conditions、code_sha256、software_versions、command。采用按序 PowerShell 对象、`ConvertTo-Json -Depth 30 -Compress`、UTF-8 SHA-256；该值是冻结字段哈希，与协议文件整体哈希不同。
- 教师 CSV 的完成核验位于 `teacher-csv-check.json`，运行前后均为 `86d4c2fb192721b2745f00076aeb00cf351c654ed936ddb098bfa6217e30ac6a`。事前协议保留 after=null，完成结果单独存档。
- 控制器从持久化指标读取的测试 Macro-F1、类 3 召回及事件分母与结果报告一致。较低告警等级下，已知限值当前类别参照同样及时检出全部越界工况；报告保留了这一比较。

## 实现者原始记录：任务一

# Task 1 implementation report

Status: DONE.

## Implemented

- Added a single center spring analytic displacement and force comparison to `verify_solver`, with a 1e-4 fail-closed tolerance. The beam solver mechanics were not altered.
- Added keyword-only validated generation seeds; defaults remain 1729 and 3141 and metadata records the actual seeds.
- Added `known_limits.py` with the exact four normalized current observations, first-step exclusion, and scenario-level first-crossing event metrics. Static limits must be finite and positive. Event evaluation validates represented scenario IDs, unique rows, steps, class evidence, trajectories and prediction classes.
- Added tests for analytic spring behavior, seed determinism/customization, exact units/current-only feature allowlist, invalid static limits, step-zero exclusion, event denominators, earliest timely lead and malformed evidence.

## TDD evidence

RED command:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest tests.roof_mechanics.test_solver tests.roof_mechanics.test_dataset tests.roof_mechanics.test_known_limits -v`

Result: 19 tests, 3 expected errors: `KeyError: 'center_deflection_relative_error'`, `TypeError: generate_dataset() got an unexpected keyword argument 'in_domain_seed'`, and `ModuleNotFoundError: No module named 'tools.roof_mechanics.known_limits'`. The direct spring analytic test already passed.

GREEN focused command: same command after implementation. Result: 25 tests, OK.

Full suite command:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v`

Result: 35 tests, OK. The suite's existing small-experiment test printed its expected training/readback summary; no failures or warnings from Python.

## Self-review

`git diff --check` found no whitespace errors. The four raw fields and three static-limit parameters are the only normalized matrix inputs. Both event fractions use represented scenarios as denominators and return `None` for zero denominators. Existing untracked release reports remain untouched. Git emitted only line-ending conversion notices during diff inspection.

Files changed: `tools/roof_mechanics/solver.py`, `tools/roof_mechanics/dataset.py`, `tools/roof_mechanics/known_limits.py`, `tests/roof_mechanics/test_solver.py`, `tests/roof_mechanics/test_dataset.py`, `tests/roof_mechanics/test_known_limits.py`.

Concerns: none within Task 1 scope. These are simulation-derived, uncalibrated mechanics quantities; event metrics represent discrete loading steps rather than physical time or field collapse outcomes.

## 实现者原始记录：任务二

# Task 2 implementer report

Status: DONE_WITH_CONCERNS. Fixed two-protocol/two-replicate offline ablation completed. The only concern is scientific generalization: `known_limits4` receives exact simulator limits unavailable in raw4, and no field calibration or noise trial exists. No architecture blocker or protocol deviation occurred.

BASE `56a79dff48b581f3938fdc231b9f454c7554bb9a`; initial Task2 HEAD `6db6072e8b842a24b7d7fbf14857c60468033328`. A second documentation-only commit records the verified current-limit baseline interpretation below; final HEAD is listed at the end of this report.

## Implemented

- `tools/roof_mechanics/known_limits_study.py`: two fixed RF/XGBoost fits per replicate, validation-only early stopping/selection, row and event evaluation of all candidates and two baselines, safe persistence, trajectory/feature/metric/native-model readback and SHA-256 manifest verification.
- `tools/roof_mechanics/run_known_limits.py`: required fresh-output CLI and fixed replicate seeds.
- `tests/roof_mechanics/test_known_limits_study.py`: policy/eligibility, four-column training/early stopping, isolated held-out-label noninfluence, missing-class rejection, two-replicate smoke persistence, no-overwrite and manifest tamper tests.
- `tools/roof_mechanics/README.md` and two `docs/qa/2026-10-13-roof-mechanics-known-limits-*` records: actual stored scores/hashes, assumptions, event burden, citations and review state.

Only the six brief-owned files were changed for the implementation. Formal output remains under `D:/矿业/outputs/roof-mechanics-known-limits/2026-10-13` and is not staged. Existing untracked release reports were preserved.

## TDD evidence

RED command:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_known_limits_study.py' -v
```

Before the implementation, import failed as expected: `ModuleNotFoundError: No module named 'tools.roof_mechanics.known_limits_study'`; `Ran 1 test`, `FAILED (errors=1)`.

GREEN same command after implementation and readback tightening: `Ran 4 tests in 7.211s`, `OK`. Smoke generated 94 and 98 eligible rows with 10+2 scenarios, 12 steps for each replicate; readback and native XGBoost reload passed and 26 files matched the manifest. Its temporary directory was removed by `TemporaryDirectory`. In the held-out-label test, event integrity was isolated with a scoped mock only during deliberately invalid label mutation; actual smoke and formal experiments used active event checks.

Full Python command:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
```

Output: `Ran 39 tests in 11.416s`, `OK`. This ran once after focused GREEN.

Existing Node command:

```powershell
& 'C:\Users\欣\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test
```

Output: `tests 228`, `pass 228`, `fail 0`, duration `7633.5502 ms`. Node emitted its pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning for the ECharts scene module; no failing test.

## Formal experiment

The named output path was checked absent (`Test-Path` returned `False`) before this single run:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.run_known_limits --output-dir 'D:\矿业\outputs\roof-mechanics-known-limits\2026-10-13'
```

Exit code 0. Replicate a/b generated 15,097/15,286 eligible rows from 500 in-domain + 100 OOD scenarios each. All four validation choices were XGBoost and eligible under the frozen rule. Test Macro-F1: raw4 a/b `0.547191297432032 / 0.539702911929098`; known_limits4 `0.943669680356111 / 0.936510435723191`. Test class-3 recall raw4 `0.373737373737374 / 0.333333333333333`; known_limits4 `0.96969696969697 / 0.942222222222222`. The test event-alert counts and all other results are preserved in both `metrics.json` and the QA records. In particular level-2 non-limit alert burden remains high even with known limits.

Formal readback output: `passed=true`, both replicates' future targets and normalized rows checked (15,097 and 15,286), event metrics and validation choices recomputed, native XGBoost predictions matched, all 26 manifest files verified, teacher CSV unchanged. `manifest.json` SHA-256 `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`. Output `protocol.json` source hashes were compared to current Python sources after the run with no mismatches. RF joblib was written from local training and never deserialized.

The current-limit reference also detects all test crossings at alert level ≥2 (a 66/66, b 75/75), with non-limit alert burden 24/34 and 20/25. Thus full level-2 detection is not an advantage over that privileged physical reference; the known-limit model's gains are in future-class grading, level-3 detection and different alert burden. This was verified from stored metrics and added to the Chinese results record without changing code, models, protocol or output artifacts.

`git -c maintenance.auto=false -c gc.auto=0 diff --quiet 8d73eba -- js css assets images index.html login.html admin.html vercel.json server.js server data` reported runtime diff empty. `git diff --check` passed; Git noted an existing LF/CRLF normalization warning for the edited README. Evidence JSON parsed successfully. No dependencies were installed or updated, no cloud calls or remote push were made.

## Self-review and limits

The two protocols share filtered rows and split indices. Only four current raw features or their four known-limit quotients enter model matrices; no IDs, current ratios, targets, future values or softening parameters enter. Validation choices are fixed before test/OOD scoring. JSON is finite/null, zero-denominator rates remain null, individual event lead steps are retained. Readback does not unpickle RF; feature/class counts of all live models were checked before completion, and native XGBoost counts were checked from persisted JSON. The exact-limit advantage is a simulator information condition, not measured field availability. Two fixed replicates support descriptive ranges only, not uncertainty intervals or production claims. Human scientific review remains pending.

Final HEAD: `65293a1` (`docs: qualify known-limit event comparison against current reference`).

## 回读修订与补充测试记录

## Fix round 1: count readback and held-out fitted behavior

Review base `65293a1a3f800e3ccf67c1382825592b3962bf1a`. The review identified missing metadata/protocol scenario and requested-step reconciliation, plus a held-out-label test that checked only selection and feature width. I added explicit per-domain counts, total counts and requested steps reconciliation to independent `_readback_replicate`; it also checks each scenario's requested steps and completed-schedule length. The held-out-label regression now compares train+validation predictions for RF and XGBoost under both protocols before/after perturbing test/OOD labels, alongside frozen selection. No training or selection rule changed.

RED focused command:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_known_limits_study.py' -v
```

Before code fix: `test_smoke_persistence_readback_manifest_and_no_overwrite ... ERROR`; `TypeError: _readback_replicate() takes 2 positional arguments but 3 were given`; `Ran 4 tests in 7.413s`, `FAILED (errors=1)`. This is the new protocol-count regression invoking the not-yet-extended readback interface. The new fitted-behavior assertion already passed.

GREEN same command after fix: `Ran 4 tests in 8.115s`, `OK`. The smoke test now checks valid 10+2/12 values and rejects changed requested in-domain/OOD/step values and changed persisted metadata values. It retains the no-overwrite, native-model reload and tamper checks. As directed, the full Python and Node suites were not rerun.

Read-only formal audit command:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -c "from tools.roof_mechanics.known_limits_study import readback_study; import json; print(json.dumps(readback_study(r'D:\矿业\outputs\roof-mechanics-known-limits\2026-10-13'), ensure_ascii=False, allow_nan=False))"
```

Exit 0, `passed=true`: a/b checked 15,097/15,286 rows and 600/600 scenarios, all 26 original manifest files passed, original manifest SHA-256 remains `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`, teacher CSV unchanged. The formal output was not regenerated or modified. Original protocol source hashes describe the pre-fix training/readback code; the post-fix auditor SHA-256 is `7ed15d34563aec7db5e7e3dd2e3420b9afb365b344dde7482216747c2c74f5d6` and the amended test SHA-256 is `b4ea5f64ccb3e628ae27aa47a6d4874618264cdcd5f1ac42afabf96263ca2708`. The QA result/evidence records explicitly retain that provenance distinction. The unrelated Node module-type warning remains deferred to its owner; no Node configuration was changed.

Fix commit: `577a070` (`fix: audit frozen mechanics counts and held-out fit invariance`). Fix base `65293a1`; final HEAD `577a070`.

## Final whole-branch review wave: unfiltered row count

Review base `152e40710ecb116b72aaa77cdb4f9af5dabac4a3`; the whole-branch review found 0 Critical, 0 Important and one Minor audit hardening gap. I added the sole requested assertion: before filtering step zero, reconstructed supervised row count must equal `metadata.row_count`. A metadata-only mismatch is now covered in the existing focused smoke test. No model, label, seed, feature, selection, training, production file or formal output changed.

RED focused command:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_known_limits_study.py' -v
```

Before code fix, the new subtest `altered={'row_count': 999}` failed as expected: `AssertionError: ValueError not raised`; `Ran 4 tests in 8.210s`, `FAILED (failures=1)`.

GREEN same command after one assertion: `Ran 4 tests in 7.677s`, `OK`. This includes valid metadata, the mismatched unfiltered metadata count, prior count/steps mismatches, fitted-behavior noninfluence, model roundtrip and manifest tamper. Full Python/Node suites and formal training were not rerun.

Read-only audit of retained output used the same `python -B -c "...readback_study(...)..."` command shown in Fix round 1. Exit 0, `passed=true`; both replicates checked 600 scenarios, 15,097/15,286 eligible rows, reconstructed unfiltered counts 15,697/15,886 matched stored metadata, and all 26 manifest files matched. The original manifest SHA-256 remains `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`. Original protocol source hashes remain a record of training-time code, while this final auditor/test SHA-256 is `23800e8c40b837748ec55c27d48916cfc9ceb117c89b66bf8a6b3c2eb7bfaf52` / `d5210b057fc1a8008b171c2d2b9045e266cc3097c80a302d05c55bd93be28d28`. The evidence JSON retains the earlier `post_fix_readback` record and adds a distinct `post_final_readback` record.

Final-wave commit: `47ad050` (`fix: reconcile unfiltered mechanics row count in audit`), based on `152e407`. Only the four Task2 code/test/QA files were staged; unrelated untracked reports remain untouched.

