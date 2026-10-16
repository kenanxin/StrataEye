# Task 2 implementation report — Steps 1–4 only

Worktree: `D:/矿业/worktrees/teacher-feedback-v1`. Base dependency: Task 1 commit `1075048`.

## Delivered files

- `tools/roof_mechanics/uncertainty_study.py`: frozen archive runner, registry, complete results and native-model independent readback.
- `tests/roof_mechanics/test_uncertainty_study.py`: integration/no-fit/hash/tamper/preservation checks, arithmetic and review-summary denominator checks.
- `tools/roof_mechanics/README.md`: method, fixed counts, denominator definitions, CLI and review gate. No empirical effects are claimed.
- This report. No web, server, deployed site, source archive, teacher data, labels, model or split changes.

## TDD and actual command outputs

All Python commands used the existing interpreter, with working directory above:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p test_uncertainty_study.py -v
```

Initial RED before the runner existed:

```text
test_uncertainty_study (unittest.loader._FailedTest) ... ERROR
ModuleNotFoundError: No module named 'tools.roof_mechanics.uncertainty_study'
Ran 1 test in 0.000s
FAILED (errors=1)
```

First implementation run reached the final semantic-tamper fixture and failed because the shared `write_json` intentionally uses exclusive creation. The temporary test fixture was corrected to unlink its own temporary JSON before replacing it. Actual footer: `Ran 1 test in 19.489s`, `FAILED (errors=1)`, `FileExistsError` at test `write_json(output / 'predictions.json', predictions)`.

First GREEN after that fixture correction:

```text
test_frozen_integration_and_independent_tamper_audit ... ok
Ran 1 test in 26.053s
OK
```

Then a hand arithmetic/coverage test was added. While its focused run was executing, I edited protocol command/timestamp validation; the pre-scoring code-hash audit rejected the resulting running-code change. This was an execution sequencing mistake, not a disabled provenance check. Actual footer: `Ran 2 tests in 42.630s`, `FAILED (errors=1)`, `ValueError: analysis code hash mismatch` in independent readback. No persistent archive was involved: all source/output fixtures were temporary directories.

After code was frozen, final focused GREEN:

```text
test_frozen_integration_and_independent_tamper_audit (test_uncertainty_study.UncertaintyStudyTests) ... ok
test_independent_denominators_and_summary_denominators (test_uncertainty_study.UncertaintyStudyTests) ... ok
Ran 2 tests in 36.042s
OK
```

Full roof-mechanics Python suite was run exactly once at the end:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m unittest discover -s tests/roof_mechanics -p 'test_*.py' -v
```

Actual footer:

```text
test_frozen_integration_and_independent_tamper_audit (test_uncertainty_study.UncertaintyStudyTests) ... ok
test_independent_denominators_and_summary_denominators (test_uncertainty_study.UncertaintyStudyTests) ... ok
Ran 54 tests in 68.216s
OK
```

Fixture creation reports `Generating replicate-a: 10+2 scenarios`, `Training replicate-a: 94 eligible rows`, `Generating replicate-b: 10+2 scenarios`, `Training replicate-b: 98 eligible rows`. The final focused fixture source manifest was `5e4ca34da54314e2430e70267b9c8c8223c7e790cc4bd695977cb22b26de13a9`; the full-suite uncertainty fixture source manifest was `3aec634ac0b3c0928a0cd20eb5fdeff75ae2de9b718bd330b1acf7e2e931632b`. These hashes identify disposable test fixtures, not the formal source.

`git diff --check` exited 0; Git printed only the README LF-to-CRLF normalization warning. No Node test run because no Node/web/server change.

## Self-review and evidence

Registry retains all 19 original case IDs and explicitly stores parameter-named center bias triples; eight jointly nonzero ±20% corners yield 27 distinct triples. Fixed sampling width is .20 and grid has 27 correlated-deflection/independent-capacity/strength samples. Original test/ood indices are selected before new center construction and candidate inference. There is no new train/validation inference in the analysis calculation. Source readback retains its complete original archive audit.

Preflight verifies lowercase digest, fresh disjoint output path, source readback, teacher hash, native/loaded four-feature and four-class contract. `protocol.json` exists before `_calculate`; tests check all 11 directly used code/test hashes at that point. Protocol records source hashes, original validation selections separately from the predeclared XGBoost paths/hashes, versions, registry/grid, UTC start timestamp, fixed scope flags and executable command. Model fitting guards cover the new runner; only source fixture creation occurs before them.

324 result cells (2 replicates × 2 splits × 27 centers × 3 candidates), 108 review summaries and 108 aligned envelope records are persisted with all Task 1 fields and original row indices. Row metrics and both event alert levels reuse established scoring helpers. CSV has a fixed header, all row/event metrics, explicit center bias parameters and flattened review-summary fractions. Zero denominators are null in JSON and empty in CSV.

Independent readback reconstructs each denominator from raw observations and original static parameters times center bias; candidate denominators are divided by candidate-error factors before native XGBoost predictions. The test patches production sampling and the runner's engineering transform to raise while independent readback still passes. Hand calculations assert the first and exact-center matrices for a joint +20% bias. Coverage fixtures distinguish actual sampled class set from inclusive numeric range, verify true-class3 and center-underestimate denominators, scenario de-duplication and empty fractions.

Exact center and estimated physical reference values and scores must equal original XGBoost/current-limit archive entries. A fixture whose original validation choice is RF is accepted because analysis XGBoost is predeclared. CSV mutation fails the manifest; prediction mutation followed by manifest rehash fails semantic reconstruction. Test compares every original source file byte and teacher CSV bytes after all analyses/tamper tests. Output audit checks exact actual file coverage, registry/grid/counts/scope, analysis hashes, source/model/software metadata, source checks, predictions/results and all CSV rows.

## Concerns and stopping point

No formal source run occurred. Steps 5–7, formal output and named QA results remain for the controller after independent review. Timing provenance currently records the pre-scoring UTC start timestamp; test durations are above. Readback deliberately checks exact local code and software version equality, so audit requires the frozen code/environment used for creation. It performs repeat native predictions for independent validation, which has a runtime cost on the full source. Width .20 is hypothetical, sampling is exploratory, and no confidence or continuous-domain guarantee is claimed. Human scientific approval remains pending.

Existing unrelated untracked QA files and plan files were preserved. Temporary fixtures are scoped to `TemporaryDirectory` and removed by its normal lifecycle; no broad cleanup or source overwrite was used.

## Steps 5–6 continuation after independent approval

Task2 Steps1–4 was independently approved by `/root/uncertainty_study_review` over `1075048..9d8f89f`, with no Critical/Important/definite Minor. Controller explicitly authorized the single formal source run. Analysis source/tests/environment remained frozen throughout. The one actual invocation from this worktree was:

```powershell
& 'D:\矿业\smart-mine-v2-balanced\.venv-data\Scripts\python.exe' -B -m tools.roof_mechanics.uncertainty_study --output-dir 'D:\矿业\outputs\roof-mechanics-uncertainty\2026-10-13'
```

Actual exit 0; stdout summary reported readback passed,324 cells,108 summaries,108 aligned prediction records,324 CSV rows,source_readback_passed/source_manifest_unchanged/teacher_csv_unchanged/independent_denominator_reconstruction True; analysis_code_provenance pre_scoring_code_hashes_verified; manifest checked_files6 and SHA256 `f377f7c385ef2e26926818f76b797baf9b31c494a0b9ccf9c6b3f0744a7fef46`. Original known_limits4 validation selections remained XGBoost/eligible True for both replicates. Tool terminal garbled Chinese paths in stdout; source JSON text/bytes were not modified. Raw UTC start is `2026-10-13T12:19:47.243483+00:00`; total exact elapsed seconds was not separately collected.

Protocol SHA256 `8bccaf140a58818362d1da776a5b81604b9ae376543431818effeed8a10897d3`; results `e4933d519417117301a3372a52283c4e163d7c7804428de7b669bd9042ea50ca`; predictions `658113cd8101bb5279898da7835b4649fb7b67ef73b3168d49375adee86ddaa7`; CSV `22fa5bd6e66e8f0d30a0f2e39d65088fbecd4e700939a4608093f196249ca649`; readback `a7c0e9bdb60e163f8fcaa2cad93d29ea1894eda9e1152710e9608f342f0c4870`; source-check `cc57f64bfa6e815469bd2fdc1610c5dac16281c551a47bb72604d318526cef45`. Complete file hashes/lengths and all11 code hashes are in the four QA evidence record. Source manifest before/after stays `031e0801d980caf09893eecbf15139ce0b3d0bd541d76289a2139df73e7d4537`; teacher CSV before/after stays `86d4c2fb192721b2745f00076aeb00cf351c654ed936ddb098bfa6217e30ac6a`.

Only read-only JSON/CSV extraction and file hashing followed; no second formal calculation/readback, training fixture or suite rerun. Four named QA documents preserve exact and strength+20% results across all four splits, original physical reference, alert2/3 events, severe underestimates, low-class false positives, review burden and independently maximized joint adverse metrics with all ties. All324 CSV rows remain linked. README gained a verified result link only. No frozen source/test code edit occurred.

Adverse effects are material: exact sampled_upper low-class false-positive counts are278/601,271/641,255/621,278/622, with2049/2533,1992/2530,2012/2514,2075/2555 review rows and100/100 review scenarios per group. Strength+20% upper severe underestimates remain2/198,1/207,2/225,6/207. Joint worst upper underestimate counts are3/198,6/207,8/225,6/207; joint worst upper low false-positive counts459/601,469/641,444/621,486/622. These describe finite same-source exploration; hypothetical width/no confidence/no continuous guarantee/no field calibration/no live integration/human approval pending are retained. Final whole-delta review remains for the controller.

Final read-only document consistency command used the existing interpreter with `-B -c` and an inline in-memory validator (no saved script). Actual exit0/output: `Document crosscheck passed: 7 output hashes, 11 frozen code hashes, 24 report table rows, all joint extrema/ties, 324 CSV rows, 6 absolute file links; no prediction rerun.` It verified all table values against stored results, event metrics, maxima and all ties, original frozen code hashes, evidence output bytes/hashes, source checks/readback and clickable absolute archive links. Report additionally spells out the future-three-step assumed-limit labels and `Lhat=Ltrue*(1+e)` asymmetric true-limit interval. The Scientific Agent Skills paper metadata was actually opened at https://arxiv.org/abs/2609.00065 and matches current v2 authors/title; this is only a writing-process citation with human verification pending.
