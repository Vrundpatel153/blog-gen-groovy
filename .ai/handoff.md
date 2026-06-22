# Handoff

Last updated: 2026-06-22

## Purpose
Fast, reliable handoff file for new chats/models/agents so work continues without context loss.

## First 5 Minutes Checklist
1. Read [.ai/project-context.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/project-context.md).
2. Read [.ai/architecture.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/architecture.md).
3. Read [.ai/decisions.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/decisions.md).
4. Read [.ai/AGENT_SKILLS_CONTEXT.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/AGENT_SKILLS_CONTEXT.md).
5. Read [.ai/FEATURE_BASELINE.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/FEATURE_BASELINE.md).

## Local Run Commands
1. Full stack:
```bash
npm run dev:all
```
2. Frontend:
```bash
npm run dev
```
3. Backend:
```bash
npm run dev --prefix server
```

## Build / Safety Gates
1. Frontend build:
```bash
npm run build
```
2. Backend build:
```bash
npm run build --prefix server
```
3. Regression scripts in `scratch/`:
- `chat_action_regression.mjs`
- `chat_long_regression.mjs`
- `chat_api_e2e_20.mjs`
- `workflow_agentic_full_check.mjs`
- `full_quality_matrix_30.mjs`
- `selected_scope_matrix_30.mjs`

## Current Critical Behaviors to Preserve
1. Replace applies to main editor content.
2. Revert restores exact previous state.
3. Preview uses exact-position red/green highlighting.
4. No HTML/code leakage in visible chat/editor/preview text.
5. Selected-scope prompts cannot spill to unrelated sections.
6. Duplicate-match prompt must require explicit user choice before apply.
7. Token telemetry visible:
  - live in chat header,
  - per prompt in history.

## Known Quality-Safe Optimization Direction
1. Keep global rewrite prompts in full context mode.
2. Reduce focused-mode context further only with confidence checks.
3. Introduce embeddings retrieval only with fallback-to-full guard.
4. Add deterministic fast path for trivial edits to reduce token spend.

## Do Not Do
1. Do not remove scope enforcement.
2. Do not remove ambiguity user confirmation flow.
3. Do not flatten list semantics in diff/preview/history rendering.
4. Do not bypass apply/revert metadata persistence.

