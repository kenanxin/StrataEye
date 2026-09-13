# Remove Surface Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the user-facing and Mine V2 runtime surface scene so the final product and recording guide present only the underground digital twin.

**Architecture:** Keep the vanilla HTML and ES-module structure, but narrow the public view contract to underground-only behavior. Mine V2 will build geology, roadway, focused longwall, monitoring and risk-field roots without constructing terrain or the surface campus; legacy `view=surface` URLs normalize to `underground`.

**Tech Stack:** HTML, CSS, JavaScript ES modules, Three.js, Node test runner, python-docx

## Global Constraints

- Preserve the teacher CSV, XGBoost outputs, three-role workflow, six-agent workflow and DeepSeek integration.
- Do not delete HDR, rock, metal, conveyor or CCTV assets that may be shared by the underground scene.
- Keep historical design documents as development records; update only final product documentation and `D:\矿业\图片.docx`.
- The production UI must not expose or construct a surface scene.

---

### Task 1: Lock the underground-only public contract

**Files:**
- Modify: `tests/mine-v2-config.test.mjs`
- Modify: `tests/auth-frontend.test.mjs`
- Modify: `tests/scene-resilience.test.mjs`

**Interfaces:**
- Consumes: `index.html`, `js/main.js`, `js/scene.js`, `CAMERA_PRESETS`, `CONTROL_LIMITS`
- Produces: failing tests that reject the surface button, surface camera preset and surface URL routing

- [ ] **Step 1: Replace the existing surface assertions with underground-only assertions**

Assert that `index.html` has no `data-view="surface"`, camera keys are `overview`, `underground`, `exit`, and `main.js` does not import or call `switchToSurface`.

- [ ] **Step 2: Add the legacy URL fallback assertion**

Assert that scene initialization always selects `underground` for Mine V2, including when the query contains `view=surface`.

- [ ] **Step 3: Run the focused tests and verify failure**

Run the Node test runner against the three changed test files. Expected: failures identify the remaining surface UI, camera and route code.

### Task 2: Remove surface UI and routing

**Files:**
- Modify: `index.html`
- Modify: `js/main.js`
- Modify: `js/scene.js`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: existing view controls and camera switching functions
- Produces: one underground entry mode; `view=surface` cannot activate a surface camera

- [ ] **Step 1: Remove the view toggle markup**

Delete the surface/underground toggle container because a one-option switch has no useful interaction.

- [ ] **Step 2: Remove surface imports and event branches**

Remove `switchToSurface` from `main.js`, simplify view initialization to underground, and delete the surface export and focus branch from `scene.js`.

- [ ] **Step 3: Remove unused toggle styling**

Delete CSS selectors that exist only for the removed view toggle while preserving unrelated scene controls.

- [ ] **Step 4: Run the Task 1 tests**

Expected: UI and routing assertions pass; Mine V2 construction assertions still fail until Task 3.

### Task 3: Remove Mine V2 surface construction

**Files:**
- Modify: `js/scene/mine-v2/mine-v2.js`
- Modify: `js/scene/mine-v2/camera-presets.mjs`
- Modify: `js/scene/mine-v2/config.mjs`
- Modify: `js/scene/mine-v2/labels.js`
- Delete: `js/scene/mine-v2/surface-campus.js`
- Delete: `js/scene/mine-v2/terrain.js`
- Delete: `js/scene/mine-v2/terrain-profile.mjs`
- Modify: `tests/mine-v2-config.test.mjs`

**Interfaces:**
- Consumes: underground geology, roadway, focused-longwall and simulator builders
- Produces: `buildMineV2()` without `surfaceRoot`, plus underground-only camera and label modes

- [ ] **Step 1: Delete surface imports, roots and build calls**

Keep `geologyRoot`, `undergroundRoot` and `focusedRoot`; make `setViewMode` normalize every unsupported mode to `underground` or `overview`.

- [ ] **Step 2: Replace the overview camera**

Use an underground atlas overview that frames the roadway network without relying on surface height or campus geometry.

- [ ] **Step 3: Simplify labels and configuration**

Initialize labels in underground mode and remove the obsolete surface composition field.

- [ ] **Step 4: Delete surface-only modules and tests**

Remove the three modules after confirming no remaining imports; delete terrain and surface-route assertions.

- [ ] **Step 5: Run Mine V2 and scene tests**

Expected: camera, topology, scene resilience, equipment focus and roof-field tests pass.

### Task 4: Align final documentation and recording guide

**Files:**
- Modify: `README.md`
- Modify: `D:\矿业\图片.docx`

**Interfaces:**
- Consumes: final underground-only product behavior
- Produces: final-use documentation with no instruction to enter or demonstrate a surface scene

- [ ] **Step 1: Update the README**

Describe the Three.js capability as an underground roadway and 1206 working-face digital twin. Remove final-use statements that advertise surface switching.

- [ ] **Step 2: Update the Word guide**

Remove surface-scene recording references while preserving the corrected real-record values, nine-shot flow, screenshots and voice-over structure.

- [ ] **Step 3: Verify DOCX structure and render**

Confirm the DOCX opens, retains 27 embedded images and contains no final recording instruction to show a surface scene. Run the packaged renderer and inspect page PNGs; if the bundled LibreOffice executable is unavailable, report that exact limitation and complete structural verification.

### Task 5: Full regression and production release

**Files:**
- Modify: `docs/qa/2026-09-13-underground-only-release-qa.md`

**Interfaces:**
- Consumes: all code and documentation changes
- Produces: tested Git commits on `main` and `deploy/mine-v2-balanced`

- [ ] **Step 1: Run complete tests and offline preflight**

Run bundled Node with `--test`, then `tools/submission-preflight.mjs --offline`. Expected: all tests pass and the CSV remains 20,000 rows with the recorded SHA-256.

- [ ] **Step 2: Verify no active surface contract remains**

Search runtime files and final documentation for `data-view="surface"`, `switchToSurface`, surface camera keys and surface module imports. Historical specification files are excluded from this release check.

- [ ] **Step 3: Commit the implementation**

Commit code, tests, README, QA report and the Word guide as separate appropriate deliverables; the external Word file remains outside Git unless already tracked elsewhere.

- [ ] **Step 4: Push and verify production**

Push `main`, fast-forward `deploy/mine-v2-balanced`, wait for Render and Vercel, then verify Chrome loads the underground view and rejects the old surface route by falling back to underground.
