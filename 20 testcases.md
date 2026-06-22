# 20 Testcases - Blog Chat + Generation Agent

## Test Environment
- Frontend: `http://localhost:5178`
- Backend API: `http://localhost:3001`
- Mode: Live UI testing through in-app browser
- Date: 2026-06-19

## Summary
- Total testcases: **20**
- Passed: **17**
- Failed: **3**
- Critical regressions found during this run:
  - `08`: selected replace formatting collapse (historical failure evidence)
  - `17`: subtitle-only prompt mapped incorrectly (historical failure evidence)
  - `19`: list-format intent not strictly preserved in suggestion output

## Fixes Applied During This Run
1. Selected-scope replace stability fix (already present, revalidated):
   - `src/components/BlogEditorView.tsx`
   - `replaceSelectedTextInText` update prevents full-content normalization before replace.
2. Subtitle-only intent scoping fix (implemented this run):
   - `server/src/services/chatAssistant.ts`
   - Added subtitle-only request detection/enforcement.
   - Added subtitle edit derivation fallback.
   - Added word-limit handling in rewrite fallback logic.
3. Numbered-list intent guard (implemented this run):
   - `server/src/services/chatAssistant.ts`
   - Added operation post-processing for explicit numbered checklist prompts to normalize list output and strip heading-noise lines.

## Detailed Testcases

| ID | Scenario | Prompt / Action | Expected | Actual | Status | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Blog generation baseline | Generate blog from creation flow | Blog renders in editor with content and images | Generated and loaded in editor | PASS | [01-generation-baseline](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/01-generation-baseline.png) |
| 02 | Chat rewrite preview card | Rewrite request from chat | Diff card shown with original/suggested | Diff card rendered with action buttons | PASS | [02-chat-rewrite-summary-previewcard](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/02-chat-rewrite-summary-previewcard.png) |
| 03 | Replace applies in main editor | Click `Replace` on suggestion | Main editor content updates | Updated content applied in editor | PASS | [03-replace-applies-main-editor](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/03-replace-applies-main-editor.png) |
| 04 | Revert restores original | Click `Revert` after apply | Prior content restored | Revert succeeded | PASS | [04-revert-restores-original](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/04-revert-restores-original.png) |
| 05 | Preview overlay positioning | Open preview from diff card | Preview opens at edited area with positioned context | Preview opened with contextual placement | PASS | [05-preview-overlay-positioned-diff](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/05-preview-overlay-positioned-diff.png) |
| 06 | Selected field detection | Select text in editor | Selected text appears in chat scope bar | Scope indicator updated correctly | PASS | [06-selected-field-detected-in-chat](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/06-selected-field-detected-in-chat.png) |
| 07 | Selected-scope suggestion | Prompt while selected text is active | Suggestion scoped to selected text | Scoped suggestion generated | PASS | [07-selected-field-chat-suggestion](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/07-selected-field-chat-suggestion.png) |
| 08 | Selected replace regression (historical) | Replace selected text (old behavior) | Only selected span should change | Formatting collapsed (failure) | FAIL | [08-selected-replace-formatting-regression](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/08-selected-replace-formatting-regression.png) |
| 09 | Recovery via revert after regression | Revert from failed applied state | Original state restored | Revert restored editor content | PASS | [09-revert-restores-after-selected-replace-failure](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/09-revert-restores-after-selected-replace-failure.png) |
| 10 | Post-fix scoped rewrite | Selected sentence rewrite test | Clean scoped suggestion produced | Suggestion generated without global collapse | PASS | [10-selected-sentence-rewrite-suggestion-postfix](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/10-selected-sentence-rewrite-suggestion-postfix.png) |
| 11 | Post-fix replace | Apply post-fix selected suggestion | Only selected span changes | Replace worked and preserved surrounding format | PASS | [11-selected-replace-postfix-no-global-collapse](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/11-selected-replace-postfix-no-global-collapse.png) |
| 12 | Post-fix revert | Revert post-fix selected change | Revert returns exact prior state | Revert worked as expected | PASS | [12-selected-revert-postfix](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/12-selected-revert-postfix.png) |
| 13 | Post-fix preview | Open preview for post-fix edit | Preview shows change placement correctly | Preview rendered correctly | PASS | [13-preview-overlay-postfix](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/13-preview-overlay-postfix.png) |
| 14 | Version history modal | Open version history | Applied update history visible | History modal loaded with update cards | PASS | [14-version-history-modal](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/14-version-history-modal.png) |
| 15 | Style apply (selected scope) | Prompt: bold + `#0f766e` for selected sentence, then Replace | Style applies only to selected sentence | Applied and rendered in editor | PASS | [15-selected-style-replace-applied](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/15-selected-style-replace-applied.png) |
| 16 | Style revert | Revert previous style apply | Selected sentence style restored | Revert succeeded | PASS | [16-selected-style-revert-restored](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/16-selected-style-revert-restored.png) |
| 17 | Subtitle-only regression (historical) | Prompt: rewrite subtitle only | Only subtitle diff should appear | Diff included unrelated lines (failure) | FAIL | [17-subtitle-only-edit-regression](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/17-subtitle-only-edit-regression.png) |
| 18 | Subtitle-only after fix | Repeat subtitle-only prompt after patch | Subtitle scoped correctly, no body/title impact | Original/suggested now subtitle-scoped | PASS | [18-subtitle-only-fixed-scope](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/18-subtitle-only-fixed-scope.png) |
| 19 | Numbered-list rewrite fidelity | Prompt: rewrite 4 checklist points as numbered 1-4 | Suggestion should preserve strict numbered list format | Suggestion rewrote points but format/noise not fully strict | FAIL | [19-checklist-rewrite-suggestion](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/19-checklist-rewrite-suggestion.png) |
| 20 | Preview overlay on latest suggestion | Open preview for testcase 19 | Preview should open and anchor at changed area | Preview opened with full contextual section rendering | PASS | [20-preview-overlay-positioned-checklist-edit](C:/Users/vrund/OneDrive/Desktop/blog%20generation/project/test-artifacts/20-testcases/20-preview-overlay-positioned-checklist-edit.png) |

## Notes for Next Iteration
1. Re-run testcase `19` after the numbered-list intent guard patch to validate strict format compliance end-to-end.
2. Improve subtitle rewrite quality when hard word limits are requested (avoid clipped ending terms).
3. Keep regression screenshots (`08`, `17`) as permanent guards for future validation.
