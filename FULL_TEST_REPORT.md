# Full Test Report

Last updated: 2026-06-19

## Scope
- Runtime health
- Build checks
- Lint checks
- API endpoint smoke tests
- Generation quality checks
- Chat agent regression suite
- Version/apply/rollback route checks

## Runtime Status
- Frontend dev server (`http://localhost:5177`): PASS (HTTP 200)
- Backend server (`http://localhost:3001/api/health`): PASS (HTTP 200)
- Active ports:
  - `5177` listening
  - `3001` listening

## Build Checks
- `npm run build` (frontend): PASS
- `npm run build` (server): PASS

## Lint Checks
- `npm.cmd run lint`: FAIL
- Result summary:
  - 101 problems (98 errors, 3 warnings)
  - Many are pre-existing strict lint issues across server + frontend.
  - Includes React hook lint rules and `any` type usage.

## Regression Scripts
- `node scratch/chat_action_regression.mjs`: PASS
  - 20/20 prompts actionable
  - 0 failures
  - No unsafe HTML/code markers
- `node scratch/chat_long_regression.mjs`: PASS
  - Multi-instruction prompts returned expected multi-op `editor_ops`
- `node scratch/chat_api_e2e_20.mjs`: PASS
  - 20 prompts completed
  - No failures
  - Message patch route works
  - Chat version creation route works
- `node scratch/workflow_agentic_full_check.mjs`: PASS
  - End-to-end lifecycle simulation across 12 prompts:
    - generate -> chat action -> apply metadata patch -> revert metadata patch -> blog persistence update
  - 0 failures in latest run
  - `operationOriginals` aligned with operation count
  - Patched applied/reverted metadata persisted for all assistant messages
- `node scratch/full_quality_matrix_30.mjs`: PASS
  - 30/30 prompts processed
  - 0 failures
  - apply/revert match checks passed
- `node scratch/selected_scope_matrix_30.mjs`: PASS
  - 30/30 scoped prompts processed
  - 0 failures
  - all scoped prompts returned constrained `editor_ops` updates

## API Smoke Tests

### Blog + Chat CRUD
- `POST /api/blogs/generate`: PASS
- `GET /api/blogs`: PASS
- `GET /api/blogs/:id`: PASS
- `PUT /api/blogs/:id`: PASS
- `DELETE /api/blogs/:id`: PASS
- `POST /api/chat/threads`: PASS
- `GET /api/chat/threads/:blogId`: PASS
- `POST /api/chat/threads/:threadId/messages`: PASS
- `GET /api/chat/threads/:threadId/messages`: PASS
- `PATCH /api/chat/messages/:messageId`: PASS

### Section + Version Routes
- `POST /api/sections/:id/edit?blogId=...`: PASS
- `GET /api/sections/versions/:blogId`: PASS
- `POST /api/sections/versions/chat`: PASS
- `POST /api/sections/:id/apply/:versionId`: PASS
- `POST /api/sections/:id/rollback/:versionId`: PASS

### Validation/Negative Cases
- Invalid generate payload: PASS (returns 400 validation)
- Invalid thread payload: PASS (returns 400 validation)
- Invalid chat message payload: PASS (returns 400 validation)
- Invalid section edit payload: PASS (returns 400 validation)

## Generation Quality Sweep (visual policy + structure)
- Multiple fresh generation calls succeeded with no JSON/schema failures.
- No HTML/code leakage in generated fields.
- Visual policy verification:
  - standard professional prompt produced `imageCount = 1` (minimal default visual density)
  - explicit visual-heavy prompt produced `imageCount = 4` (scaled visuals by intent/length)
- Structure verification:
  - subtitle generated and persisted
  - table of contents heading present
  - executive summary and closing summary/conclusion headings present
  - heading hierarchy normalized (no level-1 section heading inflation in stored API payload)
- Section integrity guard verified:
  - generated sections were non-empty and publication-length
  - no malformed `words=0` blog saves in this run

## Browser/UI Validation Status
- In-app browser automation completed against running frontend:
  - Opened editor view from sidebar blog list
  - Confirmed title + subtitle fields render in editor header area
  - Confirmed main editor renders long-form sections, lists, quotes, and image blocks
  - Confirmed preview document still uses exact-position red/green diff model and auto-scroll behavior
  - Confirmed history/version surfaces still load with preview + revert actions
- Browser validation result: PASS for editor hierarchy rendering + preview consistency + history visibility.

## Current Conclusion
- Backend APIs, generation, chat action inference, and persistence/version routes are working in this test cycle.
- Generation now has hard integrity gates and one retry path, preventing malformed empty-blog saves.
- Generation now follows stronger editorial structure normalization and subtitle-first publication hierarchy.
- Default image behavior stays minimal unless user explicitly asks for visual-heavy content.
- Section ID stability is improved by preserving/normalizing UUID section IDs during blog updates, reducing target-drift risk after autosave.
- Dev runtime is healthy and continuously running.
- Lint is not clean (existing strict-rule debt).
- Browser automation for preview/replace/revert is now runnable in this environment and passed the tested flow with exact apply/revert content fidelity.

## Incremental Update (Generation + Layout Upgrade)
Date: 2026-06-19

### Changes included in this incremental patch
- Added subtitle support end-to-end:
  - backend generation output
  - frontend model mapping
  - editor rendering
  - preview snapshot rendering
  - apply/revert snapshot persistence (`beforeState.subtitle` / `afterState.subtitle`)
- Upgraded editorial layout styling for production readability:
  - stronger title/subtitle/heading scale separation
  - justified body copy
  - improved list rhythm and marker emphasis
  - premium blockquote visuals
  - refined image framing
- Strengthened generation structure enforcement:
  - ensured executive summary near top
  - ensured heading-body rhythm
  - kept TOC + summary/conclusion guarantees
  - normalized callout quote output
  - kept default image count low unless explicit visual intent
- History enhancements:
  - inline image rendering support in applied-history and version preview cards when URL data is present
  - ordered-list `start` index preserved in editor parse round-trips

### Verification completed for this incremental patch
- `npm run build` (frontend): PASS
- `npm run build` (server): PASS
- `node scratch/chat_api_e2e_20.mjs`: PASS
- `node scratch/selected_scope_matrix_30.mjs`: PASS
- `node scratch/workflow_agentic_full_check.mjs`: PASS
- `node scratch/full_quality_matrix_30.mjs`: PASS
- Direct generation policy checks (default vs explicit visual prompts): PASS

## Historical Incremental Update (Theme + Image Render Hardening)
Date: 2026-06-19

### Changes included in this incremental patch
- App shell theming updated to neutral black/gray/white for:
  - home/dashboard shell
  - left sidebar
  - right AI chat sidebar
- Blog document surfaces intentionally remain cream for:
  - main editor paper area
  - preview document areas
- App favicon/logo updated to non-purple neutral branding.
- Image render path hardened:
  - frontend now normalizes image URLs and extracts markdown image tokens into image sections
  - editor serializer/parser now normalizes image URLs
  - backend section sanitizer now detects markdown image syntax and preserves image semantics.

### Verification completed for this incremental patch
- `npm run build` (frontend): PASS
- `npm run build --prefix server` (backend): PASS

### Status
- Incorporated into the current baseline and superseded by the later "Generation + Layout Upgrade" verification run above.
