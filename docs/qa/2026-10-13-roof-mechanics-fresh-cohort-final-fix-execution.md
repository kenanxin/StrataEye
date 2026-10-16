# Single final-review corrective wave — actual execution report

Status: complete for the authorized documentation/evidence corrective wave; separate scoped independent re-review and controller closure remain pending.

Base: `c107cc4bc6aa114212b7b85c04df2b74955a0448`.
Commit: `50360d81623157be6af1a362f1a980f02ef002d2`.
Commit subject: `docs: repair fresh-cohort review evidence bindings`.
Workspace: `D:/矿业/worktrees/teacher-feedback-v1` on `codex/teacher-feedback-v1`.

## Completed changes

- C105 tests.md line 41 now names the permanent `docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task2-execution.md` record. The original scratch input path remains unchanged in E12 `original_input_path`.
- E14 registers the existing Task2 independent review with actual SHA256 `0fb97256c660a323b5d7f5b1524bcfbe209fbd1c1fbe5dcd818f322bb3075d72`, 2373 actual bytes, permanent path, and physical locators line 3 / lines 5-15. Human verification remains pending.
- E15 registers the original initial whole-phase review with actual SHA256 `6982f8df1fb0862d59613cc0f9b390319bb5b11a9c6c4c79bb14b96f0ea20a02`, 2391 actual bytes, permanent path, and physical locators lines 3-10 / lines 12-18. Its initial Changes requested verdict and two Minor findings are preserved verbatim. Human verification remains pending.
- C106 binds E09/E12/E14/E15. Its normalized prose hash did not change because only evidence markers changed. Technical status names E14 as the Task2 approval source and E15 as the initial whole-phase review source.
- C104 tests.md line 39 expressly identifies pending Task2 review as the historical execution-record state. C114 review.md line 23 states that the independent Task2 review is completed and binds E14/E15; final scoped re-review and controller closure remain pending.
- Only changed prose hashes C104/C105/C114 were recomputed from the entire physical line after marker removal and whitespace collapse. All 115 claim IDs and existing physical line numbers remain unchanged.

## Actual read-only checks and exit codes

All task commands ran in the workspace above; skill files were read from their absolute local paths. Git staging, commit and validation checks used `-c maintenance.auto=false -c gc.auto=0`; the initial read-only `git rev-parse HEAD` used its plain form. No Python/Node suites, fitting, scoring, generation, inference, replay, cloud operations, push or deployment were run.

1. Brief, initial-review findings, archived Task2 constraints, scientific-writing skill and its evidence-workflow reference were opened locally. The subagent exclusion in using-superpowers was also read. Actual read commands exited 0. The scientific-writing normalization/evidence-binding rules informed this wave; the existing workflow-reference record and C115 were preserved.
2. Baseline `git -c maintenance.auto=false -c gc.auto=0 status --short` and `git rev-parse HEAD` confirmed the required base and only the initial-review file plus eleven legacy untracked paths. Exit 0.
3. `Get-FileHash -Algorithm SHA256 -LiteralPath` on Task2 review, initial final review and Task2 execution established the actual hashes/bytes before editing. Exit 0. Task2 execution baseline was `359caddb856023308874cb5c68095c6f82f7df0a4bdba84bd4ae25531b66c0f8`, 21738 bytes.
4. The inline covering PowerShell audit used `$ErrorActionPreference = 'Stop'`, `Get-Content -Raw | ConvertFrom-Json`, `[System.IO.File]::ReadAllLines`, regex claim/evidence extraction, SHA256 over normalized UTF-8, and `Get-FileHash` for actual sources. Literal normalization expressions were:

```powershell
$normalized = [regex]::Replace($line,'\[claim:C[^\]]+\]|\[evidence:E[^\]]+\]|\[@E[^\]]+\]','')
$normalized = [regex]::Replace($normalized,'\s+',' ').Trim()
$hash = [BitConverter]::ToString($hashAlgorithm.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalized))).Replace('-','').ToLowerInvariant()
```

The covering audit exited 0 and printed:

```text
PASS JSON parse; 115 unique physical claims/hash/line/marker/source bindings; 16 source IDs; 13 registered source actual hashes/available bytes; E14/E15 review locators checked against opened records; 3 original archived input hashes; Task2 execution SHA256/21738 bytes; 14 frozen before/after hashes; untouched numeric tables/results/protocol/dates/adverse findings/original_input_path; pending human/final gates.
```

The audit compared all existing top-level evidence fields against the parsed base except the three deliberately changed containers `technical_status`, `source_manifest_registry`, `claims_registry`; all other fields matched. It separately compared all fourteen original source records and every claim except the four affected C104/C105/C106/C114 against the base. Every claim/source human-verification value remained pending. Exactly 115 physical claim markers were found across the three claim-bearing Markdown files. All source IDs resolved; all thirteen registered local sources with embedded SHA256 matched actual bytes. E12 has the preserved historical `self_hash` metadata, so its actual archived bytes were separately checked against the pre-edit SHA256 and 21738-byte baseline. The three archived input-record hashes matched their original recorded hashes:

| Original input key | Recorded/actual SHA256 |
| --- | --- |
| task-1-report.md | dd4570dcf4d36f0c0f31d23fb352e48cee1248d7bad88c30686e86112bc146c3 |
| task-2-brief.md | f430b7920b59ea3a6bc97159edc92838688ad0cb769062de47ba35bb1633eafc |
| task-2-constraints.md | e344dfce27fe160f0fa80059703497a6952632a470abe4071f7092924ab81cd1 |

All fourteen `analysis_code_sha256_before` file hashes matched the actual code/test/helper files and the corresponding `analysis_code_sha256_after` values. No numerical report/table/result, protocol, timestamp, scientific boundary or adverse-finding data changed.

5. `git -c maintenance.auto=false -c gc.auto=0 diff --check` exited 0. Exact changed tracked-path membership was three owned QA paths. The following protected-path check exited 0 with no diff:

```powershell
git -c maintenance.auto=false -c gc.auto=0 diff --exit-code c107cc4bc6aa114212b7b85c04df2b74955a0448 -- tools tests README.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task1-execution.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task1-review.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task2-execution.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task2-requirements.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task2-constraints.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-task2-review.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-results.md
```

6. Exact staging used:

```powershell
git -c maintenance.auto=false -c gc.auto=0 add -- docs/qa/2026-10-13-roof-mechanics-fresh-cohort-evidence.json docs/qa/2026-10-13-roof-mechanics-fresh-cohort-review.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-tests.md docs/qa/2026-10-13-roof-mechanics-fresh-cohort-final-review.md
git -c maintenance.auto=false -c gc.auto=0 diff --cached --check
```

Both commands exited 0. The staged-path set was independently asserted to equal exactly those four paths, including the initially untracked final-review file. E14/E15 actual review hashes still matched after staging. No legacy untracked path was staged.

7. Actual commit command:

```powershell
git -c maintenance.auto=false -c gc.auto=0 commit -m 'docs: repair fresh-cohort review evidence bindings'
```

Exit 0; four files changed, 55 insertions and 9 deletions; initial-review file added. Git printed an MSYS `NtCreateDirectoryObject` helper diagnostic before reporting the successful commit. The commit object and parent were subsequently confirmed; this diagnostic did not prevent the commit.

8. Post-commit `rev-parse HEAD`, `rev-parse HEAD^`, `diff-tree --no-commit-id --name-only -r HEAD`, `diff --check`, `ls-files --others --exclude-standard`, `diff --name-only`, `diff --cached --name-only`, document JSON parse and actual E14/E15 hashes were checked. The combined read-only check exited 0 and printed:

```text
PASS commit=50360d81623157be6af1a362f1a980f02ef002d2 parent=c107cc4bc6aa114212b7b85c04df2b74955a0448; exact 4 QA commit paths; no tracked/staged changes; 11 legacy untracked paths preserved; postcommit diff check and review actual hashes exit=0.
```

## Remaining concerns and boundaries

The original initial review is retained as E15 and was added without editing its text or dates. This report is scratch execution evidence and is intentionally outside the four-path QA commit. The controller must produce the separate scoped re-review package and record its verdict before closing `final_whole_delta_review`. Human scientific approval and literature verification remain pending; `submission_ready=false`. Historical invocation/test statements continue to rely on the archived execution records. This wave provides document/byte consistency checks, with no fresh experimental or human verification.
