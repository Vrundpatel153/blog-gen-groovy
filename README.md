# AI Blog Studio

Production-focused AI blog generation and editing studio with:
- high-quality structured generation,
- selection-scoped chat editing,
- exact-position preview diffs,
- one-click replace + reliable revert,
- version history,
- Dev.to publishing,
- `.md` / `.html` / `.pdf` export.

## Current Documentation Baseline
- Agent bootstrap pack:
  - [.ai/project-context.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/project-context.md)
  - [.ai/architecture.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/architecture.md)
  - [.ai/decisions.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/decisions.md)
  - [.ai/current-sprint.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/current-sprint.md)
  - [.ai/handoff.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/handoff.md)
- Skills + context source of truth:
  - [.ai/AGENT_SKILLS_CONTEXT.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/AGENT_SKILLS_CONTEXT.md)
- Feature baseline (do-not-break behavior):
  - [.ai/FEATURE_BASELINE.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/.ai/FEATURE_BASELINE.md)
- Full testing summary:
  - [FULL_TEST_REPORT.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/FULL_TEST_REPORT.md)
- QA matrix artifacts:
  - [30 testcases.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/30 testcases.md)
  - [20 testcases.md](/C:/Users/vrund/OneDrive/Desktop/blog generation/project/20 testcases.md)

## Stack
- Frontend: React + Vite + TypeScript + TipTap
- Backend: Express + TypeScript
- DB: Supabase
- AI: Azure OpenAI / OpenAI provider via server config

## Run Commands
- Full stack:
```bash
npm run dev:all
```
- Frontend only:
```bash
npm run dev
```
- Backend only:
```bash
npm run dev --prefix server
```

## Build Commands
- Frontend build:
```bash
npm run build
```
- Backend build:
```bash
npm run build --prefix server
```

## Environment Notes
Required keys are validated in `server/src/config.ts`.
Typical required variables:
- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_ANON_KEY`
- one of:
  - `OPENAI_API_KEY`, or
  - Azure set (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`)
- optional:
  - `DEVTO_API_KEY` for publishing.

## Important UX Constraints
- No HTML/code leakage in user-visible chat/editor/preview text.
- Preview must show exact in-document changes:
  - original in light red,
  - suggested in light green.
- Replace must affect main editor content.
- Revert must restore exact previous state.
- Selection-scoped prompts must only edit selected area.
- Theme split:
  - cream for blog document surfaces,
  - dark neutral shell/chat/sidebar.
