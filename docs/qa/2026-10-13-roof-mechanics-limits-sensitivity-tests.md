# 限值误差评估：测试与执行记录

日期：2026-10-13。以下按实际执行顺序保留实施者报告。全量 Python 42/42 对应首次实现；来源记录修订与命令字段修订分别通过针对性 3/3 测试。正式原结果及单独的代码来源技术复核均保留，未重训。数值适用性待人工科学审阅。

# Task 1 implementation report

Status at implementation handoff: DONE_WITH_CONCERNS (frozen protocol provenance omission described below).

## Scope and implementation

Created `tools/roof_mechanics/limits_sensitivity.py` and `tests/roof_mechanics/test_limits_sensitivity.py`; appended independent usage to `tools/roof_mechanics/README.md`; created the Chinese results and strict JSON evidence files in `docs/qa`. No original study, production runtime, fit routine, thresholds, splits, or teacher CSV was edited. The sensitivity runner reads persisted trajectory-derived rows, original split indices and both raw/normalized native XGBoost candidates only. It computes the fixed 19 cases for `known_limits4` and estimated current-limit reference plus four raw4 reference cells, preserving 156 full score/prediction cells and a 156-row comparison CSV. It calls the original readback before output creation and compares exact cells to the original predictions and scores. Its own readback reconstructs denominators independently, reloads native models, recomputes predictions and row/event metrics, and compares CSV content field by field. No RF/joblib load occurs.

## TDD evidence

RED command:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_limits_sensitivity.py' -v`

Before implementation: `ModuleNotFoundError: No module named 'tools.roof_mechanics.limits_sensitivity'`; `Ran 1 test ... FAILED (errors=1)`.

GREEN focused command: same command after implementation and selected-limit bool regression. Output: `Ran 3 tests in 9.740s` / `OK`. The smoke fixture called original `run_study(source,10,2,12)` before installing no-fit guards; within the guarded sensitivity run, XGBoost and RF `fit` methods raised if reached. Native model load/predict and event scoring were real. The test checked source digest mismatch, overlap, fresh output, strict persistence, 156 cells, readback, no overwrite and tamper failure.

Full Python suite, once:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v`

Output: `Ran 42 tests in 22.319s` / `OK`. No Node suite or package installation.

## Formal once-only run and readback

Preflight before run: source manifest SHA-256 `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`; teacher CSV SHA-256 `86d4c2fb192721b2745f00076aeb00cf351c654ed936ddb098bfa6217e30ac6a`; target output did not exist.

Formal command, executed once:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.limits_sensitivity --output-dir 'D:\矿业\outputs\roof-mechanics-limits-sensitivity\2026-10-13'`

Exit code 0. Reported readback `passed=true`, 156 cells/prediction lists/CSV rows checked, source readback passed, independent denominator reconstruction passed, source and teacher unchanged, new manifest 6 files. Frozen original validation choices: both replicates selected XGBoost for raw4 and known_limits4. No stress-based reselection.

Separate readback command:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -c "from tools.roof_mechanics.limits_sensitivity import readback_sensitivity; ...; print(...)"`

Exit code 0; `passed=True`, `cells_checked=156`, `predictions_checked=156`, `csv_rows_checked=156`, source/teacher unchanged. Source manifest stayed `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`; teacher stayed `86d4c2fb192721b2745f00076aeb00cf351c654ed936ddb098bfa6217e30ac6a`. Formal protocol SHA-256 `23c0a6b35f12b52aff1d5d72d04f4b4aad00b5df27fea7f16a59cd08d2ccaf72`; formal manifest SHA-256 `ee78b6e789f7344461e58c9e6e94bcdd93a92cff5f281622b09677a1e29c35bf`; comparison CSV SHA-256 `b49a1afa22463fcd4a5b2656babf3739ac0292655197531e5eb75248549940bf`.

Actual denominators for A/test, A/ood, B/test, B/ood respectively: rows 2533/2530/2514/2555; scenarios 100 each; true class 3 rows 198/207/225/207; true class 0 rows 601/641/621/622; true limit events 66/69/75/69; nonlimit scenarios 34/31/25/31. Exact known-limit XGBoost Macro-F1 .94367/.94547/.93651/.94767. Antibending strength −20% Macro-F1 .39987/.42947/.42295/.40394, class-0 false positives 313/306/290/320. +20% Macro-F1 .42258/.44008/.42598/.43251, class-3 underestimates 198/199/223/201. Full ±20% table and all 19-condition exact values are in the results Markdown and CSV. These are simulator sensitivity observations, not a measured field error distribution.

## Self-review and concern

Confirmed the selected original static limit is validated before multiplication, including bool rejection. `git diff --check` produced no whitespace errors (only a Windows LF/CRLF notice for README). Evidence JSON parses with strict `read_json`. The original formal protocol was frozen before scoring but omitted pre-scoring hashes of the new evaluator/test code. It contains source artifact hashes and software versions. A later code hash snapshot cannot establish which exact evaluator bytes were present before scoring. The immutable formal output was preserved; results/evidence disclose this provenance deviation. I informed the controller before making any further code changes and await direction about future-run code-hash capture or a separately dated audit snapshot. Human scientific review remains pending.

Controller direction after the formal run: preserve the formal output and original protocol, add future-run capture and old-protocol compatibility. A separate post-run snapshot was captured at `2026-10-13T05:06:49.0702950Z` before this fix. Its old evaluator SHA-256 is `54b56065ee983f5157245234708e337fa06a28fd94ccc3b1482283b71676d6a1`, old test SHA-256 `ce0c4eccdc2982e5929b7038984467aa4d96e0d11660e022e9c52bf6611b3a67`; the full seven-file map is in the evidence JSON. The fixed evaluator SHA-256 is `fe88ba691ce8681170ada011a6faddcd4d9f9b2e436e438badcbce20dcf04274`, fixed test SHA-256 `d780ea0b7de3d2712a405be8e60bebc49f3a84c05c7250b827702d86bf4ded85`. These are separate from the formal protocol and do not claim pre-run capture. The original design requirement for that formal-run provenance was **not met**; independent review must adjudicate it.

The future-run fix writes `analysis_code_sha256` for evaluator, test and five dependency files into the protocol before `_calculate` begins. New-protocol readback validates the seven current hashes; old-protocol readback reports `legacy_protocol_missing_pre_scoring_code_hashes` and compares the old saved readback record without backfilling it. Focused test after fix (same focused command above): `Ran 3 tests in 10.597s` / `OK`. A new assertion intercepts `_calculate`, reads the already-written protocol and verifies its evaluator/test hashes before allowing scoring. The formal sensitivity was **not rerun** and its files were **not rewritten**. The earlier 42-test full-suite gate preceded this minimal provenance fix and was not repeated per controller instruction.

Text correction before commit: the Chinese narrative now states the four class-0 false-positive counts/denominators individually (313/601, 306/641, 290/621, 320/622). The previous compressed denominator range ended at 622 and omitted the A/ood denominator 641. Stored numerical outputs were unchanged.

Final checks after the minimal fix: AST syntax parse passed for evaluator and test; strict JSON evidence parsed with 156 rows; `git diff --cached --check` was clean. Only the five task-owned files were staged and committed as `6a9689240c70553179b517afdfb0d6aa89b9b744` (`feat: audit fixed roof-model sensitivity to limit estimation bias`). The pre-existing unrelated untracked release files remain untouched. Post-commit hashes match evidence: evaluator `fe88ba691ce8681170ada011a6faddcd4d9f9b2e436e438badcbce20dcf04274`, test `d780ea0b7de3d2712a405be8e60bebc49f3a84c05c7250b827702d86bf4ded85`. Formal source manifest, protocol and output manifest hashes remain `031e...4537`, `23c0...af72`, and `ee78...35bf` respectively.

## Task 1 fix round 1 — dated provenance reproduction

Reviewed `task-1-review.md` and the dated amendment. The original Important finding was the historical absence of a pre-scoring evaluator/test code commitment in the preserved formal protocol. The original Minor finding was that synthesized CLI text was labeled `command`, implying a verbatim invocation. The controller authorized one separately dated same-source technical reproduction; no original output was modified or rerun.

The code change labels the synthesized explicit command `reproducible_command`. The actual invocation is recorded separately below and in QA evidence. Focused regression assertions check the new protocol field and exclude the old `command` field. The seven-code-file pre-scoring capture already existed from the earlier future-run fix. No model, case, split, label, threshold or selection code changed.

Covering focused test command:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_limits_sensitivity.py' -v`

Actual output: `Ran 3 tests in 10.175s` / `OK`. This is the only test suite run for the fix round; the full 42-test suite was not repeated. The test's temporary source fixture alone calls the original `run_study` before no-fit guards; guarded sensitivity evaluation loads native models and does not fit.

Preflight: fresh verification directory did not exist; original source manifest hash `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`; teacher CSV hash `86d4c2fb192721b2745f00076aeb00cf351c654ed936ddb098bfa6217e30ac6a`; original protocol hash `23c0a6b35f12b52aff1d5d72d04f4b4aad00b5df27fea7f16a59cd08d2ccaf72`; original manifest hash `ee78b6e789f7344461e58c9e6e94bcdd93a92cff5f281622b09677a1e29c35bf`.

Actual verification invocation, executed once and without fitting:

`& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.limits_sensitivity --output-dir 'D:\矿业\outputs\roof-mechanics-limits-sensitivity\2026-10-13-provenance-verification'`

Exit code 0. Summary reported `passed=true`, 156 cells/prediction lists/CSV rows checked, `pre_scoring_code_hashes_verified`, source and teacher unchanged. The new protocol was written before scoring and has SHA-256 `1a826f836c01dee4aaecc1d4c8bdb3d22f560f135fbdaed6b24e58bad23a75cf`; new manifest SHA-256 `2ac52ca42730ae8223d4bed8fbeffd07ed34f738fa96b11e38eb1f47b7be8eba` covers six files. The source has 26 files, and the original source manifest and teacher hashes remain those above.

Seven SHA-256 values frozen in the new protocol before scoring, and independently matched to current files after scoring:

| File | SHA-256 |
|---|---|
| `tools/roof_mechanics/limits_sensitivity.py` | `e7b88d314d767cb71abd68cee64944e65892bf71d7afecd7ba57e066e3aeb4e8` |
| `tests/roof_mechanics/test_limits_sensitivity.py` | `cfbefb10e45942ea875d250b101674b15c20fac35f77dd2eeeb8790a13a494bc` |
| `tools/roof_mechanics/dataset.py` | `d95e520123f3b0a5c878c46b7652387017e512a27c124836d768776c3d3800ab` |
| `tools/roof_mechanics/known_limits.py` | `166101176c19ef997d4ce4fa9f9e65265c20cc8ee0dafe3d8c19f3a321d6885e` |
| `tools/roof_mechanics/train.py` | `5fb54c0e8a65521e30f69408d6cb89e63ec1197bd2aba283de708d9eb25c94cf` |
| `tools/roof_mechanics/run_experiment.py` | `386302114a84941b5c0b73a88b9c1a4b1bc0aa1a56386612a68b69aea7437f67` |
| `tools/roof_mechanics/known_limits_study.py` | `23800e8c40b837748ec55c27d48916cfc9ceb117c89b66bf8a6b3c2eb7bfaf52` |

Separate readback and full comparison used a `python -B -c` read-only command that invoked `readback_sensitivity(new)`, loaded old/new `results.json` and `predictions.json` as complete JSON objects, compared `comparison.csv` as complete byte strings, checked the pre-scoring protocol code map against current file hashes, and asserted all checks true. Exit code 0. The readback again checked 156 cells and reported the seven code hashes verified. Both `results.json` hashes are `d912406dcc7e2f1f0abfd60d3373b47a8b4bae1eaa2a0c0f100a1d9fd3f9a81e`; both `predictions.json` hashes are `91993399030beaf352368509ea1bb78b939aedb3e845fb929c27186e6910f3d4`; both CSV hashes are `b49a1afa22463fcd4a5b2656babf3739ac0292655197531e5eb75248549940bf`. Full-object/byte equality was true for all three, with no changed scores, predictions, denominators or conditions. The controller independently checked original 26 and each output's six file hashes/bytes and teacher CSV; all matched manifests and records.

The old formal protocol remains historically incomplete. The original post-run snapshot recorded old evaluator/test hashes `54b56065...`/`ce0c4ecc...` at 05:06:49 UTC; the new pre-scoring hashes above belong solely to the new verification run. This is a technical reproduction using identical simulated rows and persisted models, not a new independent sample or field validation. Human scientific review is pending. QA results/evidence separate both rounds and retain this limitation for independent scoped re-review.

Final fix-round checks: strict evidence JSON parsed; `git diff --cached --check` was clean; staged paths were exactly the five task-owned files. Committed as `c9ed4a6b7325164f082016ea3e5bf7b0decb3647` (`docs: verify roof sensitivity provenance reproduction`). Post-commit new-protocol code hashes still match the seven current files. Original protocol/manifest hashes remain `23c0a6b35f12b52aff1d5d72d04f4b4aad00b5df27fea7f16a59cd08d2ccaf72` / `ee78b6e789f7344461e58c9e6e94bcdd93a92cff5f281622b09677a1e29c35bf`; new protocol/manifest hashes remain `1a826f836c01dee4aaecc1d4c8bdb3d22f560f135fbdaed6b24e58bad23a75cf` / `2ac52ca42730ae8223d4bed8fbeffd07ed34f738fa96b11e38eb1f47b7be8eba`. Existing unrelated untracked release evidence remains untouched. No other known implementation issue remains; historical first-run provenance omission stays explicitly disclosed for the scoped independent review.
