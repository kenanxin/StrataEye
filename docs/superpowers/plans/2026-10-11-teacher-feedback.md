# Teacher Feedback Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect six-agent reasoning with durable human approvals, feedback, evidence and reviewed case memory, reusing the existing DeepSeek advice service.

**Architecture:** Keep the synchronous six-node builder and the browser-pure demo reducer. Add an asynchronous collaboration service with server-authoritative identity, durable revisioned storage and structured advisory AI. Keep stable rendering and model artifacts intact.

**Tech Stack:** Node.js >=18, native fs/crypto/fetch, Supabase Postgres REST/RPC, existing JavaScript ESM UI and node:test.

## Global Constraints

- Work only in D:/矿业/worktrees/teacher-feedback-v1 on codex/teacher-feedback-v1; baseline f4270b7.
- Preserve all CSV values, XGBoost probabilities, geometry, camera behavior and existing chart content.
- Never commit passwords, cookies, access tokens, API keys or service-role secrets.
- Database and external advice failure must be visible; never silently call ephemeral state persistent or rule output DeepSeek.
- Read current server state for every mutation; do not trust client-supplied run, role, risk, revision replacement or approval result.
- Enterprise starts/confirms/submits; regulator verifies/rejects; expert archives/reviews memory; viewer reads; super_admin manages accounts and reads, not business signing.
- Browser-local photo metadata must be labeled browser-local; no cloud photo persistence claim without a tested storage implementation.
- Requests have idempotency command_id and expected_revision; conflicts return409, invalid input400, unauthorized403, missing run404.
- Treat generated advice as untrusted proposals with known evidence IDs; do not alter model risk or automate equipment control.
- Do not push, deploy or modify production accounts as part of implementation. Cloud migration remains a separately recorded operation.
- Target dates: 2026-10-15 core, 2026-10-16 tests/revision, 2026-10-17 stage delivery.

---

### Task 1: Revisioned durable workflow storage

**Files:**
- Create: server/workflow-store.js
- Create: supabase/migrations/202610110001_workflow_runs.sql
- Test: tests/workflow-store.test.mjs
- Modify: .gitignore and .env.example

**Interfaces:**
- `createFileWorkflowStore({directory})` and `createSupabaseWorkflowStore({url,serviceRoleKey,fetchImpl})` return async `create(run,{commandId})`, `get(runId)`, `list({limit=20,recordId}={})`, `save(run,{expectedRevision,commandId,event})`.
- A run has workflow_run_id, revision, created_at, updated_at, nodes, algorithm, phase, demo_state, plan_versions, feedback, case_memory and events. Store does not assign business roles or generate model output.
- `WorkflowStoreError` has code/statusCode. A save requires new revision equal expectedRevision+1. Reusing commandId for that run returns saved state without an extra revision or event; a different command with stale revision gives WORKFLOW_CONFLICT/409.
- Supabase RPC `mine_workflow_create` and `mine_workflow_save` atomically persist state and events; SELECT/FOR UPDATE and unique command IDs prevent competing writes. RPCs must be service-role only and check inputs; authenticated/anon users have no direct mutation privileges.

- [ ] **Step 1: Add RED storage tests** using native temporary directories and complete run fixtures. Test restart, concurrency and duplicate commands without relying on mocks for the file store.

```js
const run = { workflow_run_id:'WF-00000000-0000-4000-8000-000000000001', revision:0, created_at:'2026-10-11T00:00:00Z', updated_at:'2026-10-11T00:00:00Z', nodes:[], events:[], algorithm:{record_id:'REC-TEST'}, phase:'waiting_human', demo_state:{status:'alert_triggered'}, plan_versions:[], feedback:[], case_memory:[] };
await store.create(run,{commandId:'create-1'});
assert.deepEqual(await createFileWorkflowStore({directory}).get(run.workflow_run_id),run);
const next={...run,revision:1};
await store.save(next,{expectedRevision:0,commandId:'approve-1',event:{type:'ACKNOWLEDGE'}});
assert.equal((await store.save(next,{expectedRevision:0,commandId:'approve-1',event:{type:'ACKNOWLEDGE'}})).revision,1);
await assert.rejects(store.save(next,{expectedRevision:0,commandId:'approve-2',event:{type:'ACKNOWLEDGE'}}),e=>e.statusCode===409);
```

- [ ] **Step 2: Run** `node --test tests/workflow-store.test.mjs` and record missing module/behavior failures.
- [ ] **Step 3: Implement** atomic file replace, serialized critical section, strict run-ID/path/revision checks, command deduplication, bounded read/list and Supabase RPC transport. Local directory is .runtime/workflows; static serving will block it in Task2. Reject corrupt store data rather than overwriting it. Avoid new packages.
- [ ] **Step 4: Add and test** the RPC migration contract with a fake fetch which asserts method/body/authorization and provider errors. Keep SQL permissions least-privilege and migrations additive.
- [ ] **Step 5: Run** focused tests, then `node --test`, report results and commit only this task's files.

### Task 2: Authoritative collaboration, constrained AI and feedback

**Files:**
- Create: server/agent-collaboration-service.js
- Modify: server.js, server/expert-advice-service.js, server/auth-service.js, server/supabase-auth-service.js
- Modify if needed: js/warning-demo-state.mjs (pure shared helpers only)
- Test: tests/agent-collaboration-service.test.mjs, tests/agent-collaboration-api.test.mjs, tests/expert-advice-service.test.mjs

**Interfaces:**
- `createAgentCollaborationService({repository,store,adviceService,now})` returns async `start({recordId,resourceSnapshot,actor,commandId})`, `get(runId)`, `list(query)`, `act({runId,type,payload,actor,expectedRevision,commandId})`, `status()`.
- actor is taken exclusively from session and has subject/username, role, displayName; resolve identity as subject or username for local accounts.
- Existing `/api/multi-agent/run` POST becomes an awaited saved start; `/api/multi-agent/runs` GET lists; `/api/multi-agent/runs/:id` GET reads; `/api/multi-agent/runs/:id/actions` POST accepts type,payload,expected_revision,command_id. Legacy reflect validates an existing stored run and never trusts submitted nodes.
- Shared business actions: ACKNOWLEDGE, SUBMIT_DISPOSAL, REJECT, APPROVE, ARCHIVE; additional REPROCESS (enterprise, human confirmation), UPDATE_RESOURCES (enterprise), APPROVE_MEMORY (expert). Reject unknown actions and wrong phases before AI calls.
- Start attaches demo_state with alert_triggered and the real sourceRecordId; ACKNOWLEDGE confirms the plan. Submitted photo metadata includes storage_source:'browser-local' and cannot count as cloud bytes. REJECT returns changes_requested and keeps evidence history; APPROVE yields verified; ARCHIVE yields archived. APPROVE_MEMORY requires archived state and explicit reviewed conclusion. REPROCESS reads saved feedback and produces a new plan version, bounded to5 per run, retaining the same workflow_run_id and previous evidence.
- `generateWorkflowAdvice(input)` on existing advice service returns source, fallback_reason if any, summary, recommendations and evidence_ids. Input has authoritative risk, feature evidence with stable IDs, known similar record IDs and reviewed memory. Unknown citation IDs, invalid JSON or malformed recommendation arrays fall back; source metadata stays truthful. No model risk replacement or arbitrary numeric engineering thresholds.
- Store source selection uses WORKFLOW_STORE_PROVIDER=file for local; for supabase authentication default is supabase and missing service key/migration gives unavailable workflow, never file fallback in production.
- `status` exposes available, storage_provider, durable, advice_configured (not verified), human_approval_required, external_delivery:false, learning_mode:'reviewed_case_memory'. Error messages contain no secret/provider bodies.

- [ ] **Step 1: Add RED service/API tests** with real file store and existing fixture model repository. Cover four roles, fake actor fields ignored by HTTP API, fake run rejected, stale revision, duplicate action, pending feedback, resources/rejection/worsening branches, bounded reprocessing, restart, and reviewed-memory eligibility.

```js
await assert.rejects(service.act({runId:run.workflow_run_id,type:'APPROVE',payload:{opinion:'checked'},actor:{username:'enterprise',role:'enterprise'},expectedRevision:run.revision,commandId:'c1'}),e=>e.statusCode===403);
await assert.rejects(service.get('WF-00000000-0000-4000-8000-999999999999'),e=>e.statusCode===404);
const agreed=await service.act({runId:run.workflow_run_id,type:'ACKNOWLEDGE',payload:{},actor:{username:'enterprise',role:'enterprise',displayName:'Enterprise'},expectedRevision:run.revision,commandId:'c2'});
assert.equal(agreed.demo_state.status,'disposal_in_progress');
assert.equal(agreed.events.at(-1).actor.role,'enterprise');
```

- [ ] **Step 2: Run** `node --test tests/agent-collaboration-service.test.mjs tests/agent-collaboration-api.test.mjs` and preserve RED evidence.
- [ ] **Step 3: Implement** explicit action-role/phase rules, pure reducer reuse, persisted plan versions, authoritative reflection and memory retrieval; use one critical-version save per action. Keep synchronous node builder as a reusable calculation, not another authoritative workflow.
- [ ] **Step 4: Reuse DeepSeek** by adding structured workflow advice method and deterministic fallback. Test provider success, forged IDs, empty content, timeout, HTTP failure and immutable risk. Keep previous expert API outputs compatible.
- [ ] **Step 5: Wire server** async API handlers and errors, optional test injection, protected static prefixes (.runtime, .superpowers, .git, .env); unify expert archive permission. Catch session lookup failures within request error handling. Apply role checks at the server, not just buttons.
- [ ] **Step 6: Run** focused tests and full `node --test`; report exact evidence and commit this task.

### Task 3: Connect existing three-role UI to saved runs

**Files:**
- Modify: js/multi-agent-workflow-ui.mjs, js/warning-demo-ui.mjs, js/warning-demo-state.mjs, js/main.js (shared client initialization only)
- Create: js/workflow-client.mjs
- Modify: index.html and the existing workflow CSS section only
- Test: tests/workflow-client.test.mjs, tests/multi-agent-ui.test.mjs, tests/warning-demo-ui.test.mjs

**Interfaces:**
- `createWorkflowClient({authFetch})` exposes `start({recordId,resourceSnapshot})`, `list()`, `get(runId)`, `act({runId,type,payload,expectedRevision})`. It generates command IDs, retains an ID during a retry, consumes typed HTTP errors and returns authoritative run JSON.
- Preserve `setupMultiAgentWorkflow({authFetch,getCurrentPayload})`, add optional shared client/current-role hooks only. Existing rail IDs are multiAgentRail, multiAgentDetail, multiAgentSource, multiAgentBoundary and runMultiAgentWorkflow.
- Warning form uses the same selected saved run's demo_state; use async dispatch, authoritative render after success and bounded poll for updates. Browser local cache is only selected run ID, never authoritative approval state. Without backend storage show explicit offline/unavailable rather than claiming persistence.
- Show saved run ID/revision, responsibility, plan/feedback source, event history and reviewed case memory; permitted roles get relevant actions only. Stable scene is not reset by polling. Repeated setup removes old listeners/timers. Photo rendering uses existing IndexedDB and warns when original browser-local photo is unavailable.

- [ ] **Step 1: Add RED tests** for command envelope, revision, error handling, shared run selection, role visibility and successful form clearing. UI tests may use minimal DOM fixtures but must assert rendered state and sent payload, not source-string counts only.

```js
const run=await client.act({runId:'WF-00000000-0000-4000-8000-000000000001',type:'ACKNOWLEDGE',payload:{},expectedRevision:0});
assert.equal(sentBody.expected_revision,0);
assert.match(sentBody.command_id,/^[A-Za-z0-9_-]+$/);
assert.equal(run.demo_state.status,'disposal_in_progress');
```

- [ ] **Step 2: Run** focused UI/client tests and retain RED evidence.
- [ ] **Step 3: Implement** async client and adapt existing rail/forms. Keep existing dark dashboard, keyboard focus, escaped content, reduced-motion behavior, grid spacing and responsive stacking; no chart redesign or new motion. Use source names rule/DeepSeek and explicit fallback reasons.
- [ ] **Step 4: Run** focused and full tests, verify scene update code untouched; commit this task.

### Task 4: Integration acceptance and truthful handoff

**Files:**
- Modify: README.md, docs/api/multi-agent-workflow-api.md
- Create: docs/qa/2026-10-11-teacher-feedback-qa.md
- Optional reusable test harness: tools/capture-teacher-feedback-qa.cjs

**Interfaces:** All previously defined HTTP actions and run schemas, existing local seeded roles, and current user's four authorized production accounts used only in memory.

- [ ] **Step 1: Verify** storage restart and three sequential roles on one browser, then another browser reads same run when using shared backend. Enterprise confirms/submits; regulator rejects; enterprise resubmits; regulator approves; expert archives and explicitly reviews memory.
- [ ] **Step 2: Verify** saved feedback reprocesses same run with old/new plan versions and preserved history. Record whether AI source is actual DeepSeek or rule fallback. Never call similar CSV records actual accidents.
- [ ] **Step 3: Run** `node --test` and `node tools/submission-preflight.mjs --offline`; review responsiveness and stale-event behavior in Chrome when accessible.
- [ ] **Step 4: Document** actual cloud migration/account/API reachability separately from local tests, cite real logs without credentials, update model/source wording to teacher-provided data pending provenance, and report remaining dependencies.
- [ ] **Step 5: Commit** final docs and submit whole-branch review. No automatic push/deploy; preserve main until reviewed integration is explicitly authorized.
