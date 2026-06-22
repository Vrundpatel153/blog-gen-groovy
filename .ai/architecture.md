# Architecture

Last updated: 2026-06-22

## System Overview
1. Frontend editor (TipTap) manages blog content, selection scope, preview/apply/revert UX.
2. Backend chat/generation services orchestrate AI, validation, and action shaping.
3. Supabase persists blogs, sections, chat threads/messages, versions, and prompt logs.

## Frontend Layers
1. Blog workspace:
  - main editor content,
  - section/title selection tracking,
  - image controls,
  - preview + history modals.
2. AI assistant sidebar:
  - chat thread interaction,
  - diff cards,
  - replace/reject/revert actions,
  - ambiguity resolution UI,
  - token usage UI (live + per prompt).
3. Service clients:
  - `chatService` for chat routes,
  - `blogService` for blog CRUD, versions, publish, export.

## Backend Layers
1. Routes:
  - `/api/blogs/*`, `/api/chat/*`, `/api/sections/*`, `/api/health`.
2. Services:
  - `blogGenerator` for AI generation + normalization + integrity gates.
  - `chatAssistant` for prompt-context assembly + action inference + guardrails.
  - `sectionEditor` for route-level single-section edit flow.
  - persistence services for blogs/chats/versions.
3. AI provider abstraction:
  - OpenAI chat completions and Azure responses support.
  - unified return shape includes token usage metadata.

## Chat Context Management Flow
1. Frontend sends:
  - prompt text,
  - blog context (title/subtitle/tone/audience/sections),
  - scope (`selectedField`, `selectedText`, `activeSectionId`).
2. Backend sanitizes context and user message.
3. Backend builds prompt context plan:
  - `full` for global rewrite or complex broad requests,
  - `focused/targeted` for local edits.
4. Backend builds thread memory summary and packs recent turns.
5. AI response is sanitized, enriched, and passed through guardrails:
  - action shaping,
  - target mapping,
  - strict scope enforcement,
  - subtitle-only guard,
  - list intent guard.
6. Response metadata includes:
  - token usage (`prompt`, `completion`, `total`),
  - context plan details,
  - model and latency.
7. Metadata persists in `chat_messages.action_data.__meta`.

## Ambiguity Resolution Flow (Duplicate Matches)
1. Before AI call, backend detects multiple target matches for prompt snippet.
2. If ambiguous, backend returns clarification payload (`needsDisambiguation`) with options.
3. Frontend renders all candidate occurrences.
4. User clicks occurrence to preview:
  - editor scrolls to location,
  - blue highlight indicates exact target.
5. User clicks `Choose this`.
6. Frontend scopes selection to chosen target and replays original prompt.
7. Backend processes prompt in strict scoped mode.

## Data Model Summary
1. `blogs` + `blog_sections`: canonical document state.
2. `chat_threads` + `chat_messages`: conversational state + action payloads.
3. `section_versions`: structured rollback/apply history.
4. `prompt_logs`: AI call logs, model, status, latency, tokens.

## Reliability Strategy
1. Validation gates on generated content before persistence.
2. Apply/revert state snapshots in chat message metadata.
3. Version rows for section-level recovery.
4. Deterministic fallback action inference on model failure/weak output.
5. Context-mode fallback to full behavior for broad edits to protect quality.

