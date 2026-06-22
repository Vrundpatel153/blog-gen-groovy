# Current Sprint

Last updated: 2026-06-22

## Sprint Theme
High-precision chat editing with lower token usage and clearer operator UX.

## Objectives
1. Reduce chat input token overhead for local edits.
2. Preserve quality for global rewrites and complex prompts.
3. Improve duplicate-target handling with explicit user confirmation.
4. Add token transparency in UI for live and per-prompt usage.

## Completed in This Sprint
1. Adaptive prompt context planner implemented.
2. Token telemetry integrated:
  - provider -> backend response metadata -> persisted chat action metadata -> UI.
3. Ambiguity detection and resolution workflow implemented:
  - detect multi-match,
  - show options,
  - preview target in editor with blue highlight,
  - explicit `Choose this` confirmation,
  - replay prompt in scoped mode.
4. Focused-mode token trimming:
  - shorter thread memory budget,
  - shorter raw history window than full mode.

## In Progress
1. Measure token reduction under realistic prompt matrix and compare by context mode.
2. Tune ambiguity snippet extraction to reduce false positives.
3. Optimize chunk splitting and code-splitting warnings in frontend bundle.

## Risks / Watchpoints
1. Over-aggressive context trimming can reduce edit accuracy.
2. Ambiguity guard may trigger when user intended broad section-level update.
3. Long-running threads can still accumulate expensive context unless summarized further.

## Definition of Sprint Done
1. 30-prompt matrix passes with no regressions in apply/revert/history.
2. Duplicate-match workflows consistently edit only chosen occurrence.
3. Focused-edit prompts show materially lower input tokens than baseline.
4. No regressions in generation quality or layout.

