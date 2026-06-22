# Full Test Report

Last updated: 2026-06-22 (final sync pass)

## Scope
- Runtime health
- Frontend/backend build checks
- API and route smoke checks
- Chat agent action quality and scope safety
- Preview/replace/revert parity
- Version history and rollback workflows
- Generation quality and layout checks

## Latest Verified Environment
- Frontend dev URL: `http://localhost:5173` (healthy in latest pass)
- Backend dev URL: `http://127.0.0.1:3001` (health route pass)
- Primary command used during regression cycles: `npm run dev:all`

## Build Verification
- `npm run build` (project root): PASS
- `npm.cmd run build --prefix server`: PASS

## Regression Suites (Latest State)
- `node scratch/chat_action_regression.mjs`: PASS
- `node scratch/chat_long_regression.mjs`: PASS
- `node scratch/chat_api_e2e_20.mjs`: PASS
- `node scratch/workflow_agentic_full_check.mjs`: PASS
- `node scratch/full_quality_matrix_30.mjs`: PASS
- `node scratch/selected_scope_matrix_30.mjs`: PASS

## Fresh 30-Case Matrix Snapshot (2026-06-22)
- Command: `server\node_modules\.bin\tsx.cmd tmp-qa-30-matrix.ts`
- Result: **30 passed / 0 failed**
- Generated blog id: `07d61a6e-4de3-4030-8146-9262ca0da0ed`
- Coverage in this run:
  - scoped section edits,
  - scoped title edits,
  - scoped image edits,
  - non-scoped full prompt edits,
  - version create/get/apply/rollback route flow.

## Browser/UI Workflow Validation
Validated live flow:
1. Generate blog.
2. Send scoped chat edit prompt.
3. Open preview and verify exact-position red/green highlight.
4. Replace and verify main editor update.
5. Revert and verify original structure returns.
6. Open history cards and history preview.

Result: PASS for this workflow path in the latest cycle.

## Current Behavioral Guarantees (Validated)
- No visible HTML/code leakage in user-facing chat diff blocks.
- Preview highlights show original (red) and updated (green) at the correct document position.
- Replace updates main blog content (not preview-only).
- Revert restores prior state from stored snapshots/version metadata.
- Selected-scope prompts remain constrained to the selected field/area.
- List rewrite prompts preserve list structure across:
  - chat diff blocks,
  - preview modal,
  - apply to editor,
  - revert,
  - history views.
- Generated blogs keep professional structure with title/subtitle hierarchy and stable spacing.

## Notable Hardening Included in Latest Pass
- Frontend (`src/components/BlogEditorView.tsx`):
  - strengthened list-aware diff rendering via `buildEditorOpsCardText`,
  - implicit ordered-list coercion via `coerceImplicitOrderedListText`.
- Backend (`server/src/services/chatAssistant.ts`):
  - stronger numbered-list intent enforcement via `enforceNumberedListIntent`,
  - rewrite-only list prompts constrained to dominant target section to prevent cross-section spillover.

## Lint Status
- Latest known lint run (`npm.cmd run lint`) remains not clean due pre-existing repo debt.
- This is tracked as technical debt and is not a blocker for current functional baseline.

## Evidence References
- [30 testcases.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/30 testcases.md)
- [20 testcases.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/20 testcases.md)
- UI regression screenshots in:
  - `ui-regression-09` through `ui-regression-21` sequence.
