# Project Context

Last updated: 2026-06-22

## Product Summary
AI Blog Studio is a production-focused blog generation and editing app with:
- structured blog generation,
- agentic chat-based edits,
- exact-position preview,
- one-click replace + reliable revert,
- version history,
- Dev.to publish,
- export (`.md`, `.html`, `.pdf`).

## Core Product Goals
1. High-quality blog generation with professional layout and structure.
2. Precise chat editing that applies exactly what user asks.
3. Safe, explainable apply/revert/history workflow.
4. No visible HTML/code leakage in user-facing content.
5. Stable manual editing in TipTap at all times.

## Non-Negotiable UX Rules
1. Preview must show exact in-document position of changes.
2. Original block: light red; suggested block: light green.
3. Replace must update the main editor, not only preview card.
4. Revert must restore exact previous state.
5. Selected-scope prompts must only affect selected scope.
6. Cream theme only for blog surfaces; dark neutral for shell/chat/sidebar.

## Tech Stack
- Frontend: React + Vite + TypeScript + TipTap
- Backend: Express + TypeScript
- Storage: Supabase Postgres
- AI Provider: OpenAI/Azure via backend abstraction

## Context and Memory Baseline
- Chat requests include document context plus scope metadata.
- Backend applies adaptive prompt context plan:
  - `full` for broad/global rewrite intent,
  - `focused`/`targeted` for local edits.
- Additional guardrails:
  - strict scope enforcement,
  - subtitle-only enforcement,
  - numbered-list intent enforcement,
  - duplicate-target ambiguity clarification flow.

## Key Source-of-Truth Docs
- Skills/context baseline:
  - [.ai/AGENT_SKILLS_CONTEXT.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/AGENT_SKILLS_CONTEXT.md)
- Feature baseline:
  - [.ai/FEATURE_BASELINE.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/FEATURE_BASELINE.md)
- Full test report:
  - [FULL_TEST_REPORT.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/FULL_TEST_REPORT.md)
- QA matrices:
  - [30 testcases.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/30 testcases.md)
  - [20 testcases.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/20 testcases.md)

## Current Status Snapshot
- Builds pass (frontend + backend).
- Agent context optimization and token telemetry are integrated.
- Duplicate-match clarification UX is integrated:
  - user previews each match in editor,
  - user confirms via `Choose this`,
  - prompt is replayed for selected match only.

