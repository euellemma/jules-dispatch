# plan.md Template

Initial template for `jq/plan.md`. Replaced each iteration with the current plan.

---

```markdown
# Plan: {{TITLE}}

> Generated {{DATE}} | Source: {{SOURCE_DESCRIPTION}}

## Executive Summary

{{2-3 sentences: what we're building/changing and why}}

## Investigation Findings

{{Key findings from codebase analysis: relevant files, current architecture, patterns}}

## Proposed Changes

### Change 1: {{Title}}
**Files:** {{file list}}
**Risk:** {{low|medium|high}}
**Description:** {{What changes and why, with code examples and diffs}}

{{Additional changes as needed}}

## Task Summary

| # | Task ID | Title | Files | Risk | Status |
|---|---------|-------|-------|------|--------|
| 1 | {{task-id}} | {{title}} | {{file count}} | {{risk}} | Pending |

## File Ownership Matrix

| File | Task | Change Type |
|------|------|-------------|
| {{path}} | {{task-id}} | {{Modify|Create}} |

## Notes

{{Any caveats, assumptions, or areas that need attention. Removed from final plan if empty.}}
```

---

## Lifecycle

- **Created:** By planner session or orchestrator at the start of each iteration
- **Replaced:** Each new iteration replaces the previous plan.md entirely
- **History:** Preserved in `jq/memory.md` as brief entries
- **Read by:** Orchestrator (injected into Jules prompts), User (markdown viewer)