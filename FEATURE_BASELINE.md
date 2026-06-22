# AI Blog Studio Feature Baseline

Last updated: 2026-06-19

## Purpose
This document is the current "do-not-break" baseline for blog generation, chat editing, preview, apply/replace, persistence, and revert flows.

Future development should preserve all behaviors listed here.

## Runtime and Build Baseline
- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Database/Persistence: Supabase
- AI provider: Azure OpenAI (chat/edit/generation models configured in server config)

### Required startup commands
- Frontend + backend together: `npm.cmd run dev:all`
- Frontend only: `npm run dev`
- Backend only: `npm.cmd run dev --prefix server`

### Required build commands
- Backend build: `npm run build` (inside `server`)
- Frontend build: `npm run build` (project root)

## Implemented and Working Features

### 1. Blog generation agent
- Generates full blog via `POST /api/blogs/generate`.
- Runs integrity checks before persistence (minimum textual sections + minimum word thresholds by requested length).
- Retries once automatically when AI returns incomplete/invalid JSON content.
- Rejects malformed generation payloads instead of saving broken one-line/empty blogs.
- Enforces plain text output fields (no HTML/code in generated content fields).
- Produces structured sections: `heading`, `paragraph`, `callout`, `image`.
- Enforces professional layout normalization:
  - paragraph spacing
  - bullets/numbered lines separated properly
  - caption cleanup
- Always returns and persists a dedicated `subtitle` field.
- Enforces editorial structure quality:
  - heading hierarchy is normalized for readable title/heading scale
  - executive summary section is ensured near the top
  - table of contents section is ensured with numbered lines
  - heading-to-body rhythm is normalized (major headings are followed by explanatory body copy)
  - summary/conclusion section is ensured when missing
  - callout/key-insight section is ensured when missing
- Image policy is enforced:
  - default generation keeps image volume minimal (target 1 image unless visual-heavy prompt is explicit)
  - explicit visual prompts can scale to multiple image sections by requested depth/length
- Ensures image sections are present and assigns usable image URLs when missing.

### 2. Chat editing agent
- Chat route: `POST /api/chat/threads/:threadId/messages`
- Supported action types:
  - `editor_ops`
  - `edit_section`
  - `replace_all`
  - `none`
- Multi-instruction prompts are supported in one response (especially via `editor_ops`).
- Supported editor operations:
  - `style_title`
  - `rename_title`
  - `style_section`
  - `replace_section_text`
  - `delete_section`
  - `replace_image`
  - `insert_image_after`
- Selection-scoped chat context:
  - Live selected editor text/field is sent in chat context (`selectedField`, `selectedText`).
  - If selection scope is section, assistant operations are constrained to that selected section.
  - If selection scope is title, assistant operations are constrained to title operations.
  - `replace_all` is blocked while strict selection scope is active.

### 3. Target location understanding (critical)
- Target resolution supports:
  - selected section (`activeSectionId`)
  - explicit section IDs
  - ordinal references (`first`, `second`, `last`)
  - phrase hints (`introduction`, `conclusion`, etc.)
  - quoted snippet matching / "contains" matching
- Fallback target resolution is applied both on server response shaping and client apply flow.
- For `editor_ops`, operation index snapshots (`operationOriginals`) must stay aligned with deduped operations and are used to resolve target positions when IDs drift.

### 4. Plain-text safety guarantees
- Chat message text and action payload text are sanitized to plain text.
- No HTML tags, code fences, or inline code should appear in visible chat suggestion text fields.
- Layout normalization is applied to list formatting and paragraph breaks.
- HTML list payloads (`<ol>`, `<ul>`, `<li>`) are converted into plain list lines before sanitization so list semantics are preserved instead of flattened.
- Ordered list start indexes are preserved through editor HTML parse/serialize cycles (`<ol start="N">` round-trips).
- Editor serialization/parsing keeps content in text-safe form and escapes unsafe characters before rendering.

### 5. Diff card and preview behavior
- Chat diff cards show:
  - original text
  - suggested edit
  - explanation
- Original text fidelity is stabilized using persisted snapshots:
  - `operationOriginals` for `editor_ops`
  - `originalText` for `edit_section`
- Diff card rendering is list-aware:
  - ordered and bullet content renders as real list UI instead of paragraph fallback
  - original/suggested blocks show full content in fixed-height scrollable panes (no ellipsis clipping)
- Preview modal renders in-document position diffs with highlights:
  - old/original: light red
  - new/suggested: light green
- Preview auto-scrolls to the first changed area.
- Preview snapshot model includes `subtitle` so title/subtitle comparisons stay faithful in apply/revert history previews.

### 6. Blog visual hierarchy and layout
- Main editor and preview use shared cream paper + serif editorial typography.
- Document title scale remains visually above section headings.
- Subtitle is rendered directly under title in editor + preview and is autosaved.
- Heading levels (`h1/h2/h3`) are size-balanced for publication readability.
- Paragraph, list, quote, and image spacing are tuned for professional scanning.
- Body copy is fully justified for publication-style reading rhythm.

### 7. Apply/replace behavior
- Replace from chat card applies exact AI suggestion to main blog.
- Replace from preview modal applies exact AI suggestion to main blog.
- Style-only updates (for example: whole paragraph bold + green) must immediately appear in the main editor after Replace.
- Applied section style state is tracked per section and restored from latest applied chat snapshot on reload.
- Replace action is one-time:
  - once applied, button becomes `Replaced`
  - button remains disabled after reload/history
- Programmatic apply/revert uses a guarded editor update path so TipTap `setContent` does not re-parse and mutate section text unexpectedly.
- If no exact target can be matched, change must not be marked as applied and user should get a clear retry instruction.
- Preview and apply use the same resolved operation target mapping path (including snapshot-text fallback) so the edited position in preview matches the applied edit location.
- Section IDs are stabilized as UUIDs in editor save/apply paths to reduce target drift across autosaves.

### 8. Revert and versioning behavior
- Per-message revert:
  - restores `beforeState` snapshot when present
  - restores exact editor content/state without incidental line-break/structure drift
  - restores from `beforeState.editorHtml` when available to preserve exact structural formatting (including lists)
  - restores subtitle from `beforeState.subtitle` when available
  - if `beforeState` missing, falls back to DB rollbacks using persisted `chatVersions`
- Section version history panel:
  - fetches versions
  - supports rollback per version
- Chat metadata persistence route:
  - `PATCH /api/chat/messages/:messageId`
- Chat-created version rows route:
  - `POST /api/sections/versions/chat`
- History cards and version previews attempt inline image rendering when image URLs are present in stored diff text.

### 9. Chat history and persistence
- Chat threads and messages are stored in DB.
- Assistant messages persist:
  - `actionType`
  - `actionData`
  - `showDiffCard`
- Action state lifecycle fields are persisted:
  - `appliedAt`
  - `revertedAt`
  - `beforeState`
  - `afterState`
  - `chatVersions`
  - `operationOriginals` (for accurate original text display)

### 10. Persistence safety rails
- Blog section replacement in persistence now fails fast on DB delete/insert errors (no silent section-loss writes).
- Blog `PUT /api/blogs/:id` rejects section updates when all incoming sections are empty text blocks.
- Word count recomputation includes image caption/text context and plain-text normalization.

### 11. Long-prompt replacement fidelity
- For replacement actions, directive lead-ins like "replace with exactly this numbered list only:" are stripped from stored suggested text when list content follows.
- Replacement payload normalization preserves intended list-only edits and avoids instruction echo duplication in chat diff cards.

### 12. Theme and color boundary baseline
- Theme split is intentional and must be preserved:
  - Blog-only surfaces stay cream/editorial:
    - main blog paper in editor
    - full preview document canvas
    - version preview document canvas
  - Non-blog shell stays ChatGPT-like neutral:
    - home/dashboard shell
    - left sidebar
    - right AI chat sidebar
    - general app chrome/buttons not part of blog document rendering
- Preview diff semantics must not change:
  - original blocks remain light red
  - updated blocks remain light green
- App identity/logo is now neutral (non-purple) and favicon is file-based (`/favicon.svg`).

### 13. Image rendering hardening (editor + preview consistency)
- Frontend blog mapping now normalizes image sources before rendering:
  - accepts absolute/relative/data image URLs
  - converts markdown image tokens (`![alt](url)`) into real `image` sections
  - applies deterministic fallback image URL when AI returns malformed/empty URL
- Editor serialization/parsing now normalizes image URLs to prevent "preview-only image" behavior.
- Backend section sanitizer now detects markdown image content and preserves image url/caption semantics in normalized section shape.
- Resulting expectation:
  - generated image should appear in main TipTap editor and preview
  - image operations from chat (`replace_image`, `insert_image_after`) should remain visible after apply/reload.

## API Surface Baseline

### Health
- `GET /api/health`

### Blogs
- `POST /api/blogs/generate`
- `GET /api/blogs`
- `GET /api/blogs/:id`
- `PUT /api/blogs/:id`
- `DELETE /api/blogs/:id`

### Sections and versions
- `POST /api/sections/:id/edit`
- `POST /api/sections/versions/chat`
- `GET /api/sections/versions/:blogId`
- `POST /api/sections/:id/rollback/:versionId`
- `POST /api/sections/:id/apply/:versionId`

### Chat
- `POST /api/chat/threads`
- `GET /api/chat/threads/:blogId`
- `POST /api/chat/threads/:threadId/messages`
- `GET /api/chat/threads/:threadId/messages`
- `PATCH /api/chat/messages/:messageId`

## Required Regression Scripts (Do Not Remove)
Located in `scratch/`:
- `chat_action_regression.mjs`
- `chat_long_regression.mjs`
- `chat_api_e2e_20.mjs`
- `workflow_agentic_full_check.mjs`
- `full_quality_matrix_30.mjs`
- `selected_scope_matrix_30.mjs`

### Expected outcomes
- 20 action regression:
  - all prompts actionable
  - no unsafe HTML/code markers in output fields
- Long prompt regression:
  - multi-op prompts include all intended operations
- E2E 20 prompts:
  - generation works
  - chat actions returned
  - message patch persistence works
  - chat version creation works
- Full workflow checks:
  - apply/revert metadata lifecycle persists correctly
  - no unsafe HTML/code markers in action-visible fields
  - long multi-op prompts remain actionable
- Selected-scope matrix:
  - strict selection-scoped updates remain constrained to selected text/field
  - no unintended full-document replacements under scoped mode.

## Pre-merge Non-Break Checklist
Before merging any feature touching chat/editor/generation:
1. Run backend and frontend builds.
2. Run all regression scripts in `scratch/`.
3. Validate one manual flow:
   - generate blog
   - send multi-instruction chat prompt (include at least one style-only request and one list rewrite request)
   - open preview and verify red/green exact-position diff
   - click Replace and confirm main editor content changed (including bold/italic/color style if requested)
   - refresh and confirm `Replaced` stays locked
   - click Revert and confirm content restored with original structure (including list formatting)
4. Confirm no HTML/code tags appear in chat diff text content.
5. Confirm theme boundary:
   - blog paper areas are cream
   - shell/chat/sidebar/home are black/gray/white
6. Confirm generated images render in both:
   - main editor document
   - preview document.
7. Confirm default generation does not output bulk images unless the prompt explicitly asks for image-heavy content.
8. Confirm subtitle appears and persists in:
   - main editor header area
   - preview modal (including snapshot-based history previews).

## Key Files Owning This Baseline
- Backend:
  - `server/src/services/chatAssistant.ts`
  - `server/src/prompts/chatAssistant.ts`
  - `server/src/services/blogGenerator.ts`
  - `server/src/prompts/blogGeneration.ts`
  - `server/src/utils/plainText.ts`
  - `server/src/routes/chat.ts`
  - `server/src/routes/blogs.ts`
  - `server/src/routes/sections.ts`
  - `server/src/services/chatPersistence.ts`
- Frontend:
  - `src/components/BlogEditorView.tsx`
  - `src/services/chatService.ts`
  - `src/services/blogService.ts`
  - `src/components/Sidebar.tsx`
  - `src/components/CreateBlogView.tsx`
  - `src/App.tsx`
  - `src/index.css`
  - `index.html`
  - `public/favicon.svg`

## Change Policy
If a new feature requires changing baseline behavior, update this file in the same PR with:
- what changed
- why it changed
- which regression expectations changed
- how to validate the new behavior
