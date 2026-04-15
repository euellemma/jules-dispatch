# progress.md Template

Template for `jq/progress.md`. This is the orchestrator's dashboard — current status of active work, not a raw activity log.

---

```markdown
# Progress

## Status: {{Initializing|Planning|Building|Parallel Build|Merging|Complete|Blocked}}

{{Brief description of current state}}

## Active Sessions

| Session | Task | Status | PR | Started |
|---------|------|--------|-----|---------|
| {{session_id}} | {{task_title}} | {{Planning|Building|Awaiting Approval|CI|MERGED}} | {{PR URL or "—"}} | {{timestamp}} |

## Merged PRs

| PR | Task | Method | Merged At |
|----|------|--------|-----------|
| | | | |

## Blocked

{{List any blocked items with reason, or "None"}}

## Key Decisions

{{Orchestrator decisions made during this iteration, e.g., "Merged task-1 and task-2 due to shared file ownership"}}

## Next Steps

{{What happens next once current work completes}}
```

---

## Sections Guide

### Status
One of:
- **Initializing** — Setting up `jq/` directory
- **Planning** — Planner Jules session analyzing and producing plan
- **Building** — Single Jules session implementing
- **Parallel Build** — Multiple Jules sessions implementing in parallel
- **Merging** — PRs being merged sequentially
- **Complete** — All work merged, ready for next input
- **Blocked** — Something is stuck, needs user attention

### Active Sessions
Updated whenever session state changes. Removed when merged.

### Merged PRs
Accumulated during merge phase. Shows the final state.

### Blocked
Populated when something prevents progress:
- CI failing on a PR
- Merge conflict that couldn't be resolved
- Session stuck after 2 resume attempts
- User approval needed (when `auto_merge: false`)

### Key Decisions
Brief notes on orchestrator decisions that affect the outcome:
- Tasks merged due to file ownership conflicts
- Sessions that required correction
- Plan modifications made during execution

### Next Steps
What the orchestrator will do once current work completes. Gives the user visibility into what's coming.

## Lifecycle

- **Created:** On first contact or start of new iteration
- **Refreshed:** Updated whenever session state changes significantly
- **Replaced:** At the start of each new iteration (not appended — it's a dashboard, not history)
- **History:** Preserved in `jq/memory.md`
- **Read by:** Orchestrator (decide next steps), User (markdown viewer)