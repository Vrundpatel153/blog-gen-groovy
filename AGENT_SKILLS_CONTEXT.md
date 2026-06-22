# AI Agent Skills + Context

Last updated: 2026-06-22

## Project Intent
- Build a production-grade AI blog editor where generation and chat edits are precise, traceable, and safe.
- Users must be able to:
  - generate a professional blog with structure, spacing, images, and clear layout,
  - get clear title/subtitle hierarchy for publication-ready readability,
  - request edits in chat using natural language,
  - see exact-position preview diffs (original in light red, new in light green),
  - click Replace once to apply exact changes,
  - revert any applied change reliably,
  - publish selected blogs to Dev.to,
  - export selected blogs as `.md`, `.html`, and `.pdf` while preserving layout and media.

## Non-Negotiable UX Rules
- No HTML tags or code snippets visible in user-facing chat/editor preview text.
- Preview diff must appear at the exact edited location in the document.
- Replace must update the main editor content, not only the preview card.
- Revert must restore prior state from `beforeState` or persisted version rows.
- Theme boundary must remain strict:
  - cream for blog document/editor/preview surfaces only
  - black/gray/white for app shell, sidebars, and chat UI.
- Chat action buttons:
  - `Replace` becomes `Replaced` after successful apply,
  - `Replaced` is disabled and cannot be clicked again.
- Manual editor typing/selecting must remain stable at all times.

## Core Agent Skills Required

### 1. Prompt Understanding
- Read the entire user request, not just the first clause.
- Extract all requested edits from long prompts.
- Never silently ignore instructions.

### 2. Precise Target Mapping
- Resolve target by:
  - selected section (`activeSectionId`),
  - explicit section ID,
  - quoted snippet,
  - phrase/contains hint,
  - ordinal location (first/second/last paragraph/image).
- Keep `operationOriginals` aligned with final deduped operations.
- Use snapshot text fallback when section IDs drift.

### 3. Safe Structured Actions
- Prefer `editor_ops` for formatting + structural updates.
- Use `replace_all` only for whole-document rewrites.
- Return plain-text-safe action payloads.
- Preserve list semantics across action payloads (ordered/bullet content must remain structured, not flattened).

### 4. Reliable Apply / Revert
- Apply and preview must use the same operation resolution path.
- Persist `appliedAt`, `revertedAt`, `beforeState`, `afterState`, and `chatVersions`.
- Persist and restore `beforeState.editorHtml` / `afterState.editorHtml` so revert keeps exact structural fidelity.
- Revert path:
  - restore `beforeState` when present,
  - fallback to DB rollback via stored version IDs.

### 5. Diff and Preview Fidelity
- Chat diff card must render list-like content as real list UI blocks.
- Preview must keep original/new changes at exact on-page position with red/green highlights.
- Diff cards must show full original/suggested content with scrollable containers (no ellipsis clipping).
- Instruction lead-ins in replacement prompts (for example: "exactly this numbered list only") must not be echoed into final replacement text.

### 6. Selection-Scoped Editing
- Live editor selection must be visible above chat as the current selected scope.
- Selected title/section text must be passed to backend chat context each prompt.
- When selected scope exists, assistant must strictly edit that selected area only.
- Scoped title selection allows only title operations (`rename_title`, `style_title`).
- Scoped section selection allows only selected-section operations and blocks unrelated title/global changes.

### 7. Generation Quality
- Generate professional, actionable content with structured flow.
- Always produce a strong subtitle supporting the title.
- Keep paragraph spacing and list readability.
- Include meaningful image sections with captions and URLs.
- Keep image count minimal by default; increase image count only when user explicitly requests visual-heavy output.
- Convert markdown image syntax into real image sections when present.
- Normalize malformed image URLs and fallback to deterministic image URLs so editor and preview both render media.
- Ensure publication structure: executive summary, table of contents, key insight callout, and closing summary/conclusion.
- Ensure heading-to-body rhythm (avoid long runs of heading-only structure).
- Keep title-to-heading visual hierarchy balanced (title always dominant).
- Avoid filler text and generic statements.
- Enforce professional composition rhythm:
  - Hero: strong title + subtitle (+ optional cover image near top),
  - Opening: clear hook + problem framing,
  - Main body: mixed blocks (framework steps, checklist, example, comparison),
  - Ending: conclusion + explicit next-step CTA.
- Select and apply a generation mode per request:
  - `thought-leadership`
  - `practical-how-to`
  - `seo-pillar`
  - `case-study`
- Mode-aware sections must be visible in final output, not only in prompt intent.

### 8. Publishing and Export Reliability
- Dev.to publishing must use backend-only `DEVTO_API_KEY` (never expose key in frontend).
- Publishing must be tied to the selected/current blog in editor view.
- Published metadata (`devtoArticleId`, `devtoUrl`, `devtoPublishedAt`) must persist on the blog row.
- If publish columns are temporarily missing in Supabase, agent must use the built-in publish-log fallback path so publish and published-list UX still work until migration is applied.
- Export fidelity baseline:
  - `.md` keeps heading/list/callout/image structure readable for re-editing and publishing,
  - `.html` keeps professional blog layout and image placement,
  - `.pdf` preserves core visual hierarchy with title/subtitle/sections/callouts/images.
- Sidebar must surface published blogs separately with:
  - quick preview entry point,
  - direct open-link to published URL.

## Current Architecture Map
- Frontend critical file:
  - `src/components/BlogEditorView.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/CreateBlogView.tsx`
  - `src/components/PublishedBlogsView.tsx`
  - `src/App.tsx`
- Backend chat logic:
  - `server/src/services/chatAssistant.ts`
  - `server/src/prompts/chatAssistant.ts`
- Backend generation logic:
  - `server/src/services/blogGenerator.ts`
  - `server/src/prompts/blogGeneration.ts`
- Backend blog routes:
  - `server/src/routes/blogs.ts`
- Backend publish/export services:
  - `server/src/services/devtoPublisher.ts`
  - `server/src/services/blogExport.ts`
- Persistence routes/services:
  - `server/src/routes/chat.ts`
  - `server/src/routes/sections.ts`
  - `src/services/chatService.ts`
  - `src/services/blogService.ts`
  - `server/src/utils/plainText.ts`
  - `server/migrations/002_publish_export_upgrade.sql`
  - `index.html`
  - `public/favicon.svg`

## Known Risk Areas
- Section ID drift between AI operation output and current editor document.
- Preview logic diverging from apply logic.
- Selection/focus side effects from programmatic style reapply.
- Parent-child sync loops resetting TipTap content while user types.
- AI partial compliance on long multi-change prompts.

## Stability Rules for Future Changes
- If you modify apply logic, update preview logic in the same change.
- If you modify operation dedupe, verify `operationOriginals` index alignment.
- Do not add continuous effects that call `setContent` while user is actively typing.
- If style persistence logic changes, test manual editing + chat apply + revert in one run.

## Required Regression Suite
Run all before merging:
- `npm run build`
- `npm run build` (inside `server`)
- `node scratch/chat_action_regression.mjs`
- `node scratch/chat_long_regression.mjs`
- `node scratch/chat_api_e2e_20.mjs`
- `node scratch/workflow_agentic_full_check.mjs`
- `node scratch/full_quality_matrix_30.mjs`
- `node scratch/selected_scope_matrix_30.mjs`
- generation mode sanity:
  - thought-leadership prompt
  - practical how-to prompt
  - case-study prompt
  - verify each includes framework list + checklist + next-step CTA

## Manual Smoke Checklist
1. Generate a new blog with images.
2. Send a long multi-instruction chat prompt.
3. Include at least one list rewrite prompt and verify list formatting is preserved in chat diff + preview.
4. Verify preview shows exact-position red/green diffs.
5. Click Replace and verify main editor updates at exact location.
6. Verify list edits apply as true list structure (not paragraph flattening).
7. Click Revert and verify old content returns with original structure.
8. Confirm manual typing/selecting remains stable throughout.
9. Confirm image renders in editor (not only preview).
10. Confirm history cards/version previews render inline images when URL data is present.
11. Confirm subtitle is visible and persisted in editor + preview.
12. Confirm shell/blog theme split (neutral shell, cream document).
13. Publish the selected blog to Dev.to and confirm:
  - publish success response,
  - persisted published link on reload,
  - entry appears in sidebar Published Blogs list.
14. Export selected blog as `.md`, `.html`, `.pdf` and verify:
  - headings/lists/callouts maintain structure,
  - image links render in HTML/PDF outputs,
  - title/subtitle hierarchy remains intact.

## Live Run Commands
- Full stack:
  - `npm run dev:all`
- Frontend only:
  - `npm run dev`
- Backend only:
  - `npm run dev --prefix server`

## Definition of Done
- Generation quality is professional and specific to user prompt.
- Chat agent accurately applies all requested edits, including long prompts.
- Preview/apply/revert are consistent and reliable.
- No HTML/code leakage in user-facing text.
- Manual editing remains smooth and uninterrupted.
- Images render consistently in both editor and preview.
- Theme boundaries remain intact (cream blog document vs neutral shell/chat/sidebar).
- Publish/export flows are reliable and scoped to the selected blog.
- Published blog list remains visible in sidebar with preview + external link.

## Latest Verified State (2026-06-22)
- Full runtime health rechecked:
  - frontend reachable on local dev URL,
  - backend health endpoint returns success.
- Full 30-prompt QA matrix re-run with pass result:
  - total: 30,
  - pass: 30,
  - fail: 0.
- Live browser QA re-run for the critical user path:
  - generate blog,
  - scoped chat edit,
  - preview,
  - replace,
  - revert,
  - history preview and history cards.
- Scoped diff fidelity hardening is now part of baseline:
  - chat diff cards keep scoped original/suggested content (no full-document flattening after apply/revert),
  - history cards and history preview retain structure for list-like edits.
- List formatting reliability is now part of baseline:
  - multiline list-like content in chat/history/preview is rendered as proper list UI,
  - numbered-list prompts are reinforced in backend to preserve numbered output shape.
- Generation quality hardening validated:
  - three live generation smoke tests (thought leadership, how-to, case-study) passed,
  - outputs included numbered framework, bullet checklist, and explicit closing next-step CTA.

## Current Quality Guarantees
- Replace/preview/revert path parity:
  - preview and apply use consistent target mapping behavior for the same suggestion.
- List-sensitive change safety:
  - list rewrites remain list-formatted through chat diff, preview, apply, and revert.
- Scope integrity:
  - selected-field workflows remain strict and do not leak edits to unrelated sections.
