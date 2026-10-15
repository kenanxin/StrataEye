# Support Deformation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visibly responsive single-support study overlay grounded in the existing solver, with evidence-linked cross-domain interpretation.

**Architecture:** Immutable shape export supplements original frame artifacts. A pure interpolation module feeds an isolated Three.js overlay; UI controls share the same selected frame as charts and server-side advice.

**Tech Stack:** Existing Python/NumPy solver, Three.js, vanilla JS, existing RAG/DeepSeek service, Node tests and Playwright visual QA.

## Global Constraints

- Preserve original solver,63 core frames,teacher data,model,device transforms and cloud business records.
- 25 FEM nodes; cubic Hermite reconstruction; mm downward positive.
- Display scales10/30/50,default30; units remain physical and fixed displacement color legend.
- No external provider calls until deterministic tests and UI checks pass; no publication in local implementation step.
- Execute inline without delegation; executing-plans unavailable.

### Task1: Verified shape artifact

- [x] Create `tools/export-support-deformation.py` and `data/support-deformation-v1.json`: recompute63 frames and reject mismatch with old scalar values.
- [x] Extend `server/support-simulation-service.js`: verify and merge profiles only for default trusted artifact; preserve custom-artifact test injection.
- [x] Add `tests/support-deformation.test.mjs`: endpoints zero,central displacement equals scalar,finite rotations and shared scale.

### Task2: Isolated visual overlay and controls

- [x] Create `js/support-deformation-model.mjs`: `sampleBeamProfile(frame,samplesPerElement)` and physical/display snapshots; test before implementation.
- [x] Create `js/scene/support-deformation.mjs`: overlay group,beam mesh,reference line,arrows,idealized support and dispose; no mutation of original equipment.
- [x] Integrate `js/scene.js`, `js/support-simulation-ui.mjs`, `index.html`, `css/support-simulation.css`: synchronized scene controls and local playback. Existing ECharts option is unchanged.
- [x] Verify low/high step and stiffness with actual Chrome and inspect screenshots; no forced camera motion on updates.

### Task3: RAG evidence and regression

- [x] Add selected/reference same-load evidence in support service and tests; retrieval query reflects the selected contrast.
- [x] Extend `js/knowledge-evidence.mjs` to expose actual retrieved versus cited domain coverage, safely escaped.
- [x] Run targeted then full regression, document boundaries and video shot invalidation. Keep unaffected footage; superseded sources removed only after verified replacement.

Final local regression: 291/291 passed. Actual Chrome: ten snapshots, zero page errors and failed responses. DeepSeek v5: live soft/stiff comparisons both cite structural mechanics, monitoring and mine safety; subsequent browser verification used the exact-evidence cache with zero extra generation calls. Cloud publication and final competition video remain separate pending steps.

Self-review: original risk and business state remain separate; scale never enters model inference; image/video effects derive from actual exported frames; no promise of hydraulic/field-calibrated physics.
