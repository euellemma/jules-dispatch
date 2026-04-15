# Session Economy Patterns

How to conserve and efficiently use Jules sessions. 

## Session Limits by Plan

| Plan | Daily Sessions | Max Concurrent | Cost Optimization |
|------|----------------|----------------|-------------------|
| Free | 15 | 3 | Very conservative — single sessions preferred |
| Pro | 100 | 15 | Balanced — parallelize when beneficial |
| Ultra | 300 | 60 | Aggressive — parallelize freely |

Resuming a completed session via `sendMessage` does **NOT** count as a new session. This is the primary mechanism for session economy.

## Core Principles

### 1. Resume, Don't Recreate

When a session needs corrections or continuation:
- **Always** try `sendMessage` on the existing session first
- A resumed session has full context of what it already did
- Creating a new session costs a new daily session AND loses context
- Only create a new session if the existing one is truly unrecoverable (2+ failed resume attempts)

### 2. Planner Can Implement

If the planner session determines the work is simple enough for one session:
- Let it implement directly in the same session
- Skip creating `jq/tasks.json` and dispatching additional sessions
- This saves 1-N sessions (the planner session counts, but the N implementation sessions don't need to exist)

Judgment call: if the total scope is < 5 files and < 2 modules, let the planner implement directly.

### 3. Foundation Writes tasks.json

For greenfield projects:
- The foundation session builds the skeleton AND writes `jq/tasks.json`
- This saves a separate planning session
- The foundation session counts as 1 session, not 1 (foundation) + 1 (planner)

### 4. Minimize Plan Approval Overhead

Each `requirePlanApproval: true` session costs a round-trip:
1. Session creates plan
2. Orchestrator polls until plan appears
3. Orchestrator calls approvePlan
4. Session proceeds to implementation

For low-risk tasks, set `requirePlanApproval: false` to skip this round-trip. The session proceeds from planning to implementation in one go.

Decision matrix:

| Task | Risk | `requirePlanApproval` |
|------|------|----------------------|
| New isolated module | Low | `false` |
| Bug fix | Low | `false` |
| UI component | Low | `false` |
| Auth changes | High | `true` |
| Data migration | High | `true` |
| Shared utility changes | Medium | `true` |
| First session on new repo | N/A | `true` |
| Config specified | Override | Per `jq/config.json` |

### 5. Batch Related Small Changes

If the user requests 3 small bug fixes that each touch 1 file:
- Combine them into one session with a prompt that describes all 3 fixes
- Each fix becomes a section in the prompt with its own file boundary note
- This costs 1 session instead of 3

### 6. Research Sessions Are Expensive

A research session costs as much as an implementation session. Only create one when:
- You're working with an unfamiliar repo and need to understand its structure before planning
- The user explicitly asks "how does X work?" or "what approach should we take?"
- The change spans 3+ modules and you need to map dependencies

If you've worked on the repo before (check `jq/memory.md`), you already have context. Don't research again.

## Session Budget Tracking

The orchestrator should track session usage per iteration and cumulative:

```
jq/config.json (extended):
{
  ...
  "session_budget": {
    "plan": "pro",
    "daily_limit": 100,
    "sessions_used_today": 7,
    "sessions_remaining_today": 93,
    "last_reset": "2026-04-15T00:00:00Z"
  }
}
```

The orchestrator updates `sessions_remaining_today` after each session creation. This helps decide whether to parallelize:

- Remaining > 50: Parallelize freely
- Remaining 20-50: Standard dispatch
- Remaining 10-20: Prefer single sessions
- Remaining < 10: Single sessions only, unless explicitly asked

## Resuming vs New Sessions: Decision Tree

```
Need to modify work from a completed session
├── Can the existing session handle it?
│   ├── Yes (small fix, clarification, CI failure)
│   │   └── Resume via sendMessage (0 new sessions)
│   └── No (scope changed significantly, wrong direction)
│       ├── Can the existing session's PR be discarded?
│       │   └── Yes → Close PR, create new session (1 new session)
│       └── No (partial good work in PR)
│           └── Resume with "keep X, redo Y" via sendMessage (0 new sessions)
└── Session already failed 2+ resume attempts
    └── Create new session with clearer prompt (1 new session)
```

## Greenfield Session Budget

```
Foundation session:     1 session
+ Planning (if separate): 0 sessions (foundation includes planning)
= Minimum greenfield:   1 session

If parallel dispatch needed:
+ N implementation sessions (controlled by max_parallel_sessions)
= 1 + N sessions total

Typical greenfield: 4-6 sessions
  1 foundation + 3-5 features
```

## Iterative Session Budget

```
Planning session:      1 session (or 0 if single-task decided by orchestrator)
+ Implementation:      1 session (single) or N sessions (parallel)
= Typical iterative:   1-3 sessions

Most iterations:        1-2 sessions
Complex iterations:     3-5 sessions
```

## Anti-Patterns

### Creating a New Session for Every Change
Each `sessions.create` counts against the daily limit. Always try `sendMessage` first.

### Using a Research Session When Memory Suffices
If `jq/memory.md` has context from previous iterations, read it first. Don't spend a session researching what you already know.

### Approving Plans for Low-Risk Changes
Every `requirePlanApproval: true` costs a polling cycle. For simple changes, let Jules proceed automatically.

### Over-Parallelizing
Three concurrent sessions is often optimal. More sessions means more merge sequencing, more potential conflicts, more monitoring overhead. Only parallelize when tasks are truly independent with clear file boundaries.