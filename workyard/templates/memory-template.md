# memory.md Template

Template for `jq/memory.md`. This is the accumulated project history — appended to, never overwritten.

---

```markdown
# Workyard Memory

> Project history and learnings. Updated after each iteration. Never overwritten.

---

## {{DATE}}

- **Iteration:** 1
- **Type:** {{Greenfield|Iterative}}
- **Input:** {{Brief summary of what was requested}}
- **Sessions:** {{count}} sessions dispatched
- **PRs merged:** {{PR numbers or "pending"}}
- **Files changed:** {{key files}}
- **Learning:** {{One-line pattern or insight observed}}
```

---

## Entry Format

Each entry uses this compact format:

```
## YYYY-MM-DD
- **Iteration:** N
- **Type:** Greenfield or Iterative
- **Input:** What was requested (1-2 sentences)
- **Sessions:** Number of Jules sessions used
- **PRs merged:** PR numbers or "pending" / "failed"
- **Files changed:** Key files that were created or modified (not exhaustive — just the important ones)
- **Learning:** A pattern, insight, or gotcha observed. This is the most valuable field.
```

## What Goes in Learning

The **learning** field captures patterns that future orchestrator sessions (or you, in a new context) can use:

- "Auth module changes should always be single-session — shared auth utilities caused conflicts"
- "This repo uses pnpm, not npm — tell Jules to use pnpm in session prompts"
- "The test suite takes 3+ minutes — account for slower CI"
- "Modifications to `src/utils/` always ripple into unexpected places — prefer broader file boundaries for utils changes"
- "Jules sessions on this repo tend to underestimate the complexity of database migrations"

## What NOT to Put Here

- Raw activity logs (that's in Jules session activities, not here)
- Detailed code changes (that's in git history and PRs)
- Session IDs or PR URLs in detail (progress.md handles current state)
- Verbose descriptions (keep entries scannable)

## Size Management

If memory.md grows beyond ~200 lines, prune older entries. Keep:
- The last 10 entries in full
- Any entry with a significant learning (even if older)
- The very first entry (for context on the project's origin)

Delete entries that are purely routine with no learnings.

## Lifecycle

- **Created:** On first workyard contact with a repo
- **Appended to:** After each iteration completes (plan → build → merge)
- **Never overwritten:** New entries are added at the top (newest first)
- **Pruned:** When exceeding ~200 lines, following the rules above
- **Read by:** Orchestrator (injected into Jules prompts for context), User (markdown viewer)