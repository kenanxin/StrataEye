# Final scoped re-review — teacher feedback v1

2026-10-12. Worktree `D:/矿业/worktrees/teacher-feedback-v1`, branch `codex/teacher-feedback-v1`.

FIX_BASE `5849b425ab8845a9e2c1885c43593e3748e87c8a`; reviewed HEAD `aaa6b882a585f19afa56501acaaf1ec0dfcd4b46`. Runtime/test fix commit `a89198a72140ad1b5d64e4e8cb64c9ff6685dcf5`; the subsequent commit records QA only.

## Verdict

**Approved — ready for local branch handoff; external acceptance remains pending.**

F1, F2, M1, M2, M4 and M5 are **ADDRESSED**. No new Critical or Important issue found in the fix diff. No second fix wave or further broad review is requested. M3 retains the original explicit deferral.

This is the single scoped re-review of the original final review. Read `final-fix-brief.md` and its binding Global Constraints first, then the complete `final-fix-report.md`, then all 17 changed-file diffs in bounded groups. Checked implementation, regression assertions, documentation and exact current line locations. No implementation/index/HEAD/branch modification, cloud/provider/browser call or suite rerun occurred. No unresolved concrete risk required an additional focused runtime check. The only write was this ignored report. `git status --porcelain` was empty and HEAD matched the requested commit.

## Finding-by-finding disposition

### F1 — ADDRESSED: Saved candidate is reviewable before enterprise approval

Evidence: `js/warning-demo-ui.mjs:102-120` builds the authoritative current plan using `createElement`/`textContent`, rendering version/approval state, source/fallback, summary, bounded complete recommendation list, actual citation IDs and separately labeled retrieved workflow context. `js/warning-demo-ui.mjs:421` renders the same selected-run plan into both surfaces. The shared readable card is at `index.html:73`; the enterprise plan area at `index.html:263` precedes its confirmation button.

The renderer clears previous contents first, displays an unavailable/empty state on load/error/selection mismatch, and uses the last saved plan. `js/warning-demo-ui.mjs:364` disables confirmation without a valid saved advice object and while loading/error/pending; `:464` applies the loading guard to the other signing controls. No current-monitoring or independent expert-advice output is substituted. Regulator and expert can read the same proposal in the public collaboration card without depending on the expert-only agent rail.

Coverage: `tests/warning-demo-ui.test.mjs:103` asserts distinctive server text is visible before signing, script-like content remains literal text, the new version replaces old recommendations, failed loads clear content/disable confirmation and selection does not leak the prior plan. `:140` checks all six recommendations and source/fallback are visible to regulator/expert while enterprise signing remains hidden. Existing provider validation bounds recommendations to six; current deterministic fallback produces fewer, so the UI cap does not omit a valid production proposal.

### F2 — ADDRESSED: Case retrieval provenance survives in each saved plan

Evidence: `server/agent-collaboration-service.js:45-62` deduplicates source runs, excludes unreviewed/unarchived cases and bounds the result to twenty. Each context item includes source workflow/CSV identity, review record sequence, actual review revision/time, available model identity and a case-specific evidence ID. `:71` attaches a separate clone to current A2 output; `:72` sends a separate clone to advice; `:78` persists another clone as the plan's `retrieved_context`. Existing plan versions survive reprocessing. `:204` records the actual successful next review revision. For older service-generated review records, event position recovers revision consistently with START at revision zero and one event per later mutation; missing evidence yields null rather than an invented revision.

`server/expert-advice-service.js:76-83` preserves the privacy whitelist, bounds case inputs and permits the new case IDs in the citation allowlist. IDs distinguish source workflows sharing a CSV and different stored review records/revisions. A CSV citation can still be valid for a CSV example; it does not identify a reviewed workflow. The prompt now makes that distinction explicit. The old standalone expert advice interface is untouched.

`js/warning-demo-ui.mjs:116-120` separates actual advice citations from retrieved context and displays source identifiers/review/model metadata. `js/multi-agent-workflow-ui.mjs:19-24` exposes the corresponding context in A2 with escaping and explicit separation from similar CSV examples. No free review conclusion, actor, organization, work order or photo is added to the provider prompt. Available model name/mode are retained without fabricating a model version.

Coverage: `tests/agent-collaboration-service.test.mjs:195` creates two real approved source runs for the same record, excludes an unreviewed archive, compares persisted A2/plan/context, verifies previous plan snapshots survive a new source plus reprocess, and reloads through a fresh store instance. `:251` covers the twenty-item bound and distinct stored review versions. `tests/expert-advice-service.test.mjs:102` accepts the two case-specific citations, rejects unknown review/ambiguous case-only CSV citations and checks private fields are absent. `tests/multi-agent-ui.test.mjs:45` checks A2 context labeling/escaping. Final HTTP harness assertions at `tools/capture-teacher-feedback-qa.cjs:197-203` verify retrieval metadata, A2 equality and independent-client GET after the genuine process restart.

### M1 — ADDRESSED: Unsupported directory environment variable removed

Evidence: `.env.example:7-9` now retains only the supported provider setting before the authentication settings; the unsupported directory entry is deleted. `README.md:178` and `docs/api/multi-agent-workflow-api.md:123` accurately describe default storage and explicit programmatic directory injection with no directory environment-variable entry point. The QA's obsolete unresolved-configuration note is removed. No new configurable/public storage path or production fallback was introduced.

### M2 — ADDRESSED: IPC evidence uses a bounded, correlated delivery barrier

Evidence: `tools/capture-teacher-feedback-qa.cjs:14-33` implements capture/wait keyed by invocation identity, a default ten-second timeout, waiter cleanup and a bounded capture map. `:53` sends the server-generated identity; `:85` waits for the expected saved run and plan version. The former timing assumptions are replaced by awaited exact captures at `:175` and `:196`. `server/agent-collaboration-service.js:72` constructs the identity from the authoritative run ID/version. It is not included by the real provider whitelist. `tools/capture-teacher-feedback-qa.cjs:248-251` also prevents importing the barrier test from running the entire acceptance program.

Coverage: `tests/teacher-feedback-qa.test.mjs:6` preloads an old run, then sends an old version of the current run, verifies neither satisfies the pending capture, delivers the matching delayed capture, checks repeated exact lookup and checks a missing-ID timeout. The final local harness uses actual child-process IPC with this barrier. Its intentionally sequential QA invocations make run/version a sufficient non-stale correlation key; no claim of a generic exactly-once provider-execution mechanism is needed.

### M4 — ADDRESSED: A4 reflects current human approval and closure

Evidence: `server/agent-collaboration-service.js:80-89` derives A4 state from the current plan approval and saved business status, preserves `dry_run` and `external_delivery:false`, and uses summaries that describe saved human workflow rather than real dispatch. `:134` applies it at start and `:228` after mutations. Resource infeasibility continues to leave the builder's skipped A4 output absent, preserving its gate. Approval invalidation/new plan causes waiting status; confirmation, regulator verification and archive project the corresponding current status.

Coverage: `tests/agent-collaboration-service.test.mjs:232` follows START → ACKNOWLEDGE → resource invalidation → re-confirmation → REPROCESS → re-confirmation → submission → verification → archive, checking status/dispatch and external-delivery constraints throughout.

### M5 — ADDRESSED: ARCHIVE text no longer claims case-memory admission

Evidence: `js/warning-demo-state.mjs:230` now says closure and event archiving only. The separate APPROVE_MEMORY gate and timeline remain in `server/agent-collaboration-service.js:201-206`. The end of the A4 regression checks ARCHIVE text excludes case/memory admission wording and confirms case_memory remains empty; the retrieval regression and HTTP before-memory assertion independently retain archive-only exclusion.

### M3 — DEFERRED, unchanged original ruling

The three reported MODULE_TYPELESS_PACKAGE_JSON warnings originate in unchanged scene modules. Final QA at `docs/qa/2026-10-11-teacher-feedback-qa.md:28` records them explicitly. No package-mode change was made. They are not a new fix-diff defect or a local handoff blocker; do not call the run warning-free.

## Verification evidence and fix-scope safety

Reviewed the exact implementer report and matching tracked QA. Evidence reported for the final runtime:

- Initial relevant regressions: 37 tests, 33 pass, 4 expected fail; same command after fixes 37/37 pass. IPC regression first fails for absent barrier, then 1/1 passes. The report candidly distinguishes the early import-triggered local harness from final acceptance.
- Final covering regressions: 54/54 pass. The last memory clone isolation adjustment is covered by the subsequent full suite.
- Complete final suite: 228 tests, 228 pass, zero failed/cancelled/skipped/todo, duration 6620.0402 ms, exit zero, three pre-existing warnings.
- Final real local HTTP harness: 2026-10-12T05:20:04.697Z–05:20:06.744Z, ok=true, two independent clients, two sequential Node processes, complete saved-snapshot equality, reviewed case context persistence/retrieval and correlated IPC evidence; external provider calls zero.
- Offline preflight: 20,000 rows, 11 columns, unchanged SHA-256 `86D4C2FB192721B2745F00076AEB00CF351C654ED936DDB098BFA6217E30AC6A`, passed.

These are recorded executed results, not a claim that I reran them. The test code exercises the original failure conditions and the source changes implement the claimed behavior. The fix diff does not touch CSV, model artifacts, geometry, camera, chart content, authentication/session authority, store/SQL transaction logic or deployment configuration. It introduces no operational credentials and no external-data publication path. Photo storage, human-feedback-versus-measurement semantics, current role checks, optimistic concurrency and five-plan bound remain intact.

## New findings, out-of-scope observations and remaining uncertainty

New Critical findings: none. New Important findings: none. New load-bearing residual issue from F1/F2: none. No additional out-of-scope findings were developed into another review batch.

Real browser responsiveness/visual layout, real role-switching/second-browser display, IndexedDB original/missing-photo behavior, actual Supabase migration/transactions/cloud restart and actual authorized DeepSeek generation remain unverified external acceptance items. DOM tests and local process/HTTP proof have the limits already recorded in the tracked QA. Source review cannot replace those checks.

The single final fix wave and this scoped review complete the local review gate. Root may proceed with the authorized local handoff and preserve M3/external dependencies in its adjudication. This approval does not authorize or certify push, merge, deploy, production account changes or external provider data transfer.
