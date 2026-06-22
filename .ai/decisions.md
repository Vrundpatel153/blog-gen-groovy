# Decisions

Last updated: 2026-06-22

## ADR-001: Keep Supabase as Source of Truth
Status: Accepted
- Blogs, sections, chat messages, versions, and logs remain in Supabase.
- Reason: durability, queryability, and straightforward rollback/history.

## ADR-002: Structured Agent Actions over Free-form Text
Status: Accepted
- Use `editor_ops`, `edit_section`, `replace_all`, `none`.
- Reason: predictable apply/revert and safer UI integration.

## ADR-003: Strict Selection-Scoped Editing
Status: Accepted
- If selection exists, constrain edits to selected title/section span.
- Reason: precision and user trust.

## ADR-004: Adaptive Context Packing
Status: Accepted
- Introduce `full` vs `focused/targeted` context modes.
- Reason: reduce token load while keeping quality on global rewrites.

## ADR-005: Preserve Full-Quality Fallback Path
Status: Accepted
- Broad/global prompts still use full context.
- Reason: avoid quality regressions on complex transformations.

## ADR-006: Ambiguity Clarification for Duplicate Matches
Status: Accepted
- On multiple possible targets, ask user to choose occurrence first.
- Reason: prevent accidental edits on wrong repeated text.

## ADR-007: Persist Token and Context Metadata per Assistant Reply
Status: Accepted
- Store telemetry in `action_data.__meta`.
- Reason: transparent cost monitoring and future optimization analysis.

## ADR-008: Keep No-HTML/No-Code User-Facing Output Constraint
Status: Accepted
- Sanitize displayed content and action text fields.
- Reason: consistent UX and safety.

## Deferred Decisions
1. Embeddings + chunk retrieval for chat context:
  - deferred for next optimization phase after baseline stabilization.
2. Deterministic no-LLM fast path for trivial style/replace:
  - planned, not yet baseline.
3. Separate short/long system prompt templates:
  - planned prompt compaction step.

