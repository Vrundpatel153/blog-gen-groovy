# 30 Prompt QA Matrix Report

Run Date: 2026-06-22 (Asia/Calcutta)

## Scope Covered
- Frontend + backend runtime health
- Blog generation flow
- Chat assistant actions for:
  - selected section prompts
  - selected heading prompts
  - selected image prompts
  - selected title prompts
  - normal (non-selected) prompts
- Version history endpoints:
  - create chat versions
  - fetch versions
  - apply version
  - rollback version
- History/preview data connectivity validation via persisted message action payloads and version records

## Environment Snapshot
- Frontend: `http://localhost:5173` (running)
- Backend: `http://127.0.0.1:3001` (running)
- Health endpoint: pass
- Generated test blog ID: `9a93d5f3-26b3-4a10-adcb-024d565b47cc`
- Generated thread ID: QA matrix thread (60 messages created during matrix)

## Overall Result
- Total prompts: **30**
- Passed: **30**
- Failed: **0**
- End-to-end workflow checks: **pass**

## Prompt Matrix
| ID | Prompt | Expected Behavior | Result |
|---|---|---|---|
| S01 | Make selected text bold. | editor_ops scoped to selected section | Pass |
| S02 | Make selected text italic and green. | editor_ops scoped to selected section | Pass |
| S03 | Rewrite only selected text in concise executive tone. | replace_section_text scoped to selected section | Pass |
| S04 | Replace selected text with exact provided sentence. | replace_section_text scoped to selected section | Pass |
| S05 | Remove selected text only. | delete/replace scoped to selected section only | Pass |
| S06 | Shorten selected text to under 20 words. | scoped rewrite | Pass |
| S07 | Improve grammar in selected text only. | scoped rewrite | Pass |
| S08 | Change selected text to blue and unbold. | scoped style op | Pass |
| S09 | Rewrite selected text more formal and concise. | scoped rewrite | Pass |
| S10 | Paraphrase selected text with stronger clarity. | scoped rewrite | Pass |
| H11 | Rewrite selected heading to be more compelling. | scoped heading edit | Pass |
| H12 | Make selected heading bold and dark blue. | scoped style op on heading | Pass |
| I13 | Update selected image caption to specified text. | replace_image scoped to selected image | Pass |
| I14 | Change selected image URL + caption. | replace_image scoped to selected image | Pass |
| T15 | Make selected title text bold. | title-only op(s) | Pass |
| T16 | Make selected title text italic and #2563eb. | title-only op(s) | Pass |
| T17 | Replace selected title text with exact phrase. | rename_title scoped to title | Pass |
| T18 | Rewrite selected title text in premium tone. | title-only rewrite | Pass |
| N19 | Improve second paragraph and keep concise. | valid non-scoped action | Pass |
| N20 | Update image caption to sound professional. | valid non-scoped action | Pass |
| N21 | Make blog title more punchy. | valid non-scoped action | Pass |
| N22 | Create numbered checklist from conclusion. | valid non-scoped action | Pass |
| N23 | Rewrite entire blog in more strategic tone. | replace_all/editor_ops valid | Pass |
| N24 | Add one image after first paragraph with caption. | image insert op valid | Pass |
| N25 | Q&A only: what is core argument? | none (or safe response) | Pass |
| S26 | Do not edit outside selected area; rewrite for CTO audience. | strict scoped section edit | Pass |
| S27 | Convert selected text into two bullet points only. | strict scoped section edit | Pass |
| S28 | Make selected text black and remove italic. | strict scoped style | Pass |
| T29 | Do not touch body; rewrite selected title words. | strict title-only edit | Pass |
| I30 | Only selected image: refresh caption. | strict image scope | Pass |

## Workflow Integrity Checks
- Blog generation: pass (professional structure with headings/paragraphs/images present)
- Chat thread creation and message persistence: pass
- Message action payloads for preview/history (`actionType`, `actionData`, `operationOriginals`): persisted and retrievable
- Version endpoints:
  - create versions: pass
  - get versions: pass
  - apply version: pass
  - rollback version: pass

## Notes
- This run validated backend-functional sync for preview/history data contracts and scoped agent behavior.
- UI rendering consistency relies on frontend renderers now using structured block rendering for original/edited and history modal/cards.

---

## Update: Regression Pass (2026-06-22, 00:30-01:00 IST)

### What Was Re-validated
- Runtime health with `npm run dev:all`
- `npm run build` (frontend compile/build)
- Full CLI matrix again (`server/tmp-qa-30-matrix.ts`)
- Live UI workflow via browser subagent:
  - scoped edit -> preview -> replace -> revert
  - history card rendering
  - history preview modal rendering
  - list rewrite + replace + revert structure preservation

### Latest Results
- CLI matrix total: **30**
- CLI matrix pass: **30**
- CLI matrix fail: **0**
- Generated blog ID for latest matrix: `c243ddbe-c596-4902-af70-d4cf816f07e3`
- Workflow checks (create/get/apply/rollback versions): **pass**
- Live UI scoped workflow checks: **pass**

### Fixes Applied During This Pass
1. `src/components/BlogEditorView.tsx`
- Fixed diff-card regression where applied messages could show flattened full-document text in ORIGINAL/SUGGESTED blocks.
- Added implicit ordered-list rendering fallback (`coerceImplicitOrderedListText`) so multiline list-like content in chat/history/preview remains properly formatted as lists.

2. `server/src/services/chatAssistant.ts`
- Strengthened numbered-list intent enforcement for both `editor_ops` and `edit_section`.
- Added explicit count parsing (`3 points`, `three points`) and list reconstruction fallback to keep numbered list structure even when model output is weakly formatted.

### UI Evidence Screenshots (Latest)
- `ui-regression-09-pre-scope-workflow.png`
- `ui-regression-10-scoped-preview-modal-current.png`
- `ui-regression-11-after-revert-current.png`
- `ui-regression-12-history-cards-current.png`
- `ui-regression-13-history-preview-modal-current.png`
- `ui-regression-14-numbered-list-preview-before-apply.png`
- `ui-regression-15-numbered-list-after-replace.png`
- `ui-regression-16-numbered-list-after-revert.png`
- `ui-regression-17-history-preview-list-change.png`
- `ui-regression-18-history-cards-with-list-change.png`
- `ui-regression-19-editor-final-list-restored.png`
- `ui-regression-20-history-preview-list-format-fixed.png`
- `ui-regression-21-chat-diff-list-format-fixed.png`
