# Implementation Playbook: Token Optimization Without Quality Loss

This document is the execution guide to rebuild, optimize, and QA the AI editing pipeline with premium output quality.

## Objective
- Reduce token usage significantly.
- Keep or improve agent precision and editing quality.
- Preserve all critical UX guarantees:
  - exact preview placement,
  - replace applies to main editor,
  - revert restores exact prior state,
  - no HTML/code leakage in user-visible content.

## Non-Negotiable Quality Gates
- Quality gate: pass rate must be `>=` current baseline across 30-prompt matrix.
- Deterministic gate: simple scoped edits must be 100% accurate.
- Regression gate: no breakage in preview/replace/revert/history.
- Token gate:
  - simple edits: near-zero or minimal LLM usage,
  - scoped rewrites: target 40-75% input reduction vs baseline.

## Phase 0: Baseline + Guardrails
### Deliverables
- Telemetry fields on each AI edit request:
  - `input_tokens`
  - `output_tokens`
  - `latency_ms`
  - `mode` (`fast_path` | `retrieval` | `full_context`)
  - `applied_success`
- Frozen gold test matrix (30 prompts):
  - simple formatting edits,
  - selected-field rewrites,
  - ambiguous multi-match prompts,
  - lists/tables/images,
  - global rewrite prompts.
- Baseline report saved as markdown with pass/fail and token stats.

### Implementation Steps
1. Add telemetry persistence in backend request pipeline.
2. Expose per-prompt token metrics in chat UI history row.
3. Capture and save 30 test prompts and expected outcomes.
4. Run full current suite and save baseline metrics.

### Acceptance
- Telemetry visible in DB and UI.
- Baseline report committed.
- 30-prompt matrix reproducible by any new agent.

## Phase 1: Deterministic Fast-Path
### Scope
Use no-LLM direct `editor_ops` for simple operations:
- exact replace,
- bold / italic / underline,
- color change,
- delete selected text,
- heading level change.

### Rules
- Must require explicit scope (selected text or disambiguated match).
- If multiple matches exist, block auto-apply and ask user to choose target.
- Never edit outside selected/disambiguated target.

### Implementation Steps
1. Add prompt intent classifier for deterministic edit intents.
2. Map deterministic intents to direct editor operations.
3. Add ambiguity detector for repeated phrase or similar targets.
4. Add match chooser flow:
  - list candidates,
  - click candidate scrolls/highlights location,
  - user confirms target,
  - then apply operation.

### Acceptance
- At least 12 deterministic prompts pass exactly.
- Very low token usage for deterministic prompts.
- No HTML/code in visible output blocks.

## Phase 2: Embedding + Chunk Retrieval
### Scope
Use embeddings for non-global edits to reduce input size safely.

### Retrieval Policy
- Store per-section/per-chunk embeddings in Supabase `pgvector`.
- On edit prompt:
  - retrieve top-k chunks (3-5),
  - include neighbor chunks (`-1`, `+1`),
  - always include selected chunk when selected scope exists,
  - include compact document skeleton (title + heading map).

### Safety
- Compute retrieval confidence score.
- If confidence low or prompt is global, fall back to full context.

### Implementation Steps
1. Define chunk schema (stable ids + offsets + metadata).
2. Backfill embeddings for existing blog versions.
3. Add retrieval service and confidence calculation.
4. Add router:
  - `fast_path` -> deterministic engine,
  - `retrieval` -> embedding context,
  - `full_context` -> fallback.

### Acceptance
- Focused edits show 40-75% input token drop vs baseline.
- Quality equal or better on 30-prompt matrix.
- Ambiguous prompts trigger disambiguation and only edit chosen target.

## Phase 3: Memory Compression + Prompt Compaction
### Scope
Shrink memory input without losing context quality.

### Policy
- Keep:
  - rolling structured summary,
  - last 4-8 raw turns,
  - latest applied diffs metadata.
- Compact system prompt wording; keep rules unchanged.
- Global/fallback path remains available.

### Implementation Steps
1. Add summary updater after each applied edit.
2. Trim old turns from model input while retaining DB history.
3. Replace verbose system prompt with compact equivalent.
4. Keep versioned prompt templates for rollback.

### Acceptance
- 20+ turn sessions retain quality.
- Additional 20-35% input token reduction.
- No regressions in preview/revert/history alignment.

## Phase 4: Safety, Rollout, Monitoring
### Feature Flags
- `FAST_PATH_ENABLED`
- `RETRIEVAL_ENABLED`
- `MEMORY_COMPRESSION_ENABLED`

### Rollout
- Canary: 10% -> 50% -> 100%.
- Auto-disable flag when:
  - apply failure spikes,
  - quality matrix drops below baseline,
  - preview/replace mismatch spikes.

### Acceptance
- Stable canary metrics for 24-48h.
- Manual QA pass for full user workflow:
  - generate -> edit -> preview -> replace -> revert -> history preview.

## 30-Prompt QA Matrix (Required Categories)
1. Exact phrase replace in selected field.
2. Bold selected sentence.
3. Make selected line italic.
4. Apply color to selected heading.
5. Delete selected paragraph.
6. Convert paragraph to numbered list.
7. Rewrite all numbered points while preserving list structure.
8. Rewrite selected text only, keep rest unchanged.
9. Ambiguous term appears multiple times; choose one.
10. Long scoped rewrite with strict tone.
11. Insert quote block in selected section.
12. Update CTA paragraph only.
13. Replace image URL for selected image block.
14. Add one image after selected heading.
15. Maintain table structure while rewriting entries.
16. Change heading level H2 -> H3 for selected block.
17. Global polish request (fallback full context).
18. SEO rewrite with preserved structure.
19. Revert latest applied change.
20. Revert older version from history.
21. Open history preview and verify full blog rendering.
22. Ensure history preview highlights edited area in-place.
23. Replace from preview and verify main editor update.
24. Select-text flow: click-only must not trigger selection context.
25. Selection flow must edit selected range only.
26. Confirm no HTML/code leakage in chat blocks.
27. Confirm no HTML/code leakage in previews.
28. Export `.md` and verify structure.
29. Export `.html`/`.pdf` and verify image rendering.
30. Publish flow sanity check (when API key available).

## DB/Telemetry Minimum Schema (Reference)
- `ai_edit_events`
  - `id`
  - `blog_id`
  - `chat_id`
  - `user_prompt`
  - `mode`
  - `input_tokens`
  - `output_tokens`
  - `latency_ms`
  - `applied_success`
  - `created_at`
- `blog_chunks`
  - `id`
  - `blog_id`
  - `version_id`
  - `chunk_index`
  - `content`
  - `embedding`
  - `start_offset`
  - `end_offset`
  - `metadata_json`

## One-Shot Master Prompt (Reusable)
Use this with a new agent/model to run full implementation + QA end-to-end:

```
You are implementing production-grade token optimization without reducing edit quality.

Read and follow these docs first:
1) .ai/project-context.md
2) .ai/architecture.md
3) .ai/decisions.md
4) .ai/current-sprint.md
5) .ai/handoff.md
6) .ai/AGENT_SKILLS_CONTEXT.md
7) .ai/FEATURE_BASELINE.md
8) .ai/implementation-playbook.md

Goals:
- Implement Phase 0 to Phase 4 from implementation-playbook.md.
- Preserve all existing working behavior and non-negotiable UX constraints.
- Add deterministic fast-path, embedding retrieval with confidence fallback, memory compression, and prompt compaction.
- Ensure selection-scoped edits only affect selected range.
- Ensure ambiguous matches require user selection before apply.
- Keep preview exact-position highlights and reliable replace/revert/history.
- Ensure no HTML/code leakage in any user-visible text blocks.

Execution requirements:
- Implement directly in code.
- Run full app and test 30-prompt matrix.
- Iterate until all tests pass and no regressions remain.
- Produce/update markdown reports with:
  - baseline metrics,
  - final metrics,
  - pass/fail details for all 30 tests,
  - token reduction summary by mode.

Done criteria:
- Quality gate met or exceeded baseline.
- Deterministic gate is 100%.
- Regression gate passes for preview/replace/revert/history.
- Token targets met for simple + focused prompts.
```

## Final Completion Checklist
- [ ] Baseline report generated and stored.
- [ ] Telemetry visible in UI and DB per prompt.
- [ ] Deterministic fast-path implemented and tested.
- [ ] Embedding retrieval + fallback implemented and tested.
- [ ] Memory compression + prompt compaction implemented.
- [ ] Feature flags and canary rollout logic implemented.
- [ ] 30/30 matrix executed with evidence.
- [ ] Final QA + metric report committed.
