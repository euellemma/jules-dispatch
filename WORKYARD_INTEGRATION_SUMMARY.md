# Workyard Integration: Phase Summary

Four Jules sessions were dispatched against `feat/workyard-integration` on `euellemma/jules-dispatch`, each building on the previous. The result upgrades jules-dispatch from a bare-bones Jules session manager to a structured developer agent orchestrator.

---

## Phase 1: Schema + Project State + Prompt Builder + Ownership Validator

**Jules Session:** `3211927627421298667`
**PR:** #3 (branch `workyard-phase-1-3211927627421298667`)

### Files Created/Modified

| File | Lines | Purpose |
|------|-------|---------|
| `convex/schema.ts` | +29 | Added `projects` table |
| `convex/projects/db.ts` | +159 | CRUD for per-repo project state |
| `convex/workyard/promptBuilder.ts` | +464 | 4 server-side prompt construction functions |
| `convex/workyard/ownershipValidator.ts` | +171 | File ownership conflict detection |

### What It Does

**Schema** — The `projects` table stores per-repo orchestration state: config (base branch, merge method, CI timeout, parallel session limits, session economy), current plan (markdown), progress dashboard, tasks (parsed JSON from tasks.json), memory entries (iteration history with learnings), and session budget tracking (plan tier, daily limit, usage count, last reset).

**Project CRUD** — `convex/projects/db.ts` follows the same pattern as `convex/memory/db.ts`. Four mutations:
- `initProject` — creates a project with defaults (base_branch: "main", auto_merge: true, squash merge, max 5 parallel sessions, 10min CI timeout, 2 conflict retries)
- `updateProject` — partial update of any field
- `appendProjectMemory` — appends a memory entry to the project's history
- `updateSessionBudget` — increments usage counter, auto-resets daily

Two queries:
- `getProjectByRepo` — lookup by "owner/repo"
- `getProjectByThread` — all projects for a Telegram thread

**Prompt Builder** — This is the core of the workyard integration. Four pure TypeScript functions that take typed inputs and return prompt strings. No LLM interpretation needed. The workyard flow templates from `workyard/flows/*.md` are faithfully reproduced as code:

- `planSessionPrompt({ repo, branch, input, memory, plan, isGreenfield })` — Constructs the planner prompt. When `isGreenfield` is true, includes the greenfield context section (blank slate instructions, scaffolding guidance).
- `implementSessionPrompt({ repo, task, memory, fileBoundary, acceptanceCriteria })` — Constructs the implementer prompt with file boundary constraints and acceptance criteria.
- `correctSessionPrompt({ type, ...params })` — Constructs correction prompts for 5 scenarios: test_failure, course_correction, continuation, conflict_resolution, nudge.
- `researchSessionPrompt({ repo, researchQuestion, memory })` — Constructs the research/investigation prompt.

**Ownership Validator** — Ported from the fleet skill's `validateOwnership()` plus the workyard reference spec. Three functions:
- `validateOwnership(tasks)` — Returns conflicts if any file appears in more than one task
- `mergeConflictingTasks(tasks, conflicts)` — Auto-merges tasks that share files
- `checkImplicitCoupling(tasks, barrelExports?)` — Detects barrel exports (index.ts) and shared config files (package.json, tsconfig.json) claimed across multiple tasks

---

## Phase 2: Dispatcher Engine + Dispatch Tools

**Jules Session:** `8143588370522073475`
**PR:** #4 (branch `workyard-phase-2-8143588370522073475`)

### Files Created/Modified

| File | Lines | Purpose |
|------|-------|---------|
| `convex/workyard/dispatcher.ts` | +248 | 4 dispatch actions |
| `convex/tools/workyardTools.ts` | +150 | 3 new agent tools |
| `convex/tools/index.ts` | +2 | Wired tool exports |

### What It Does

**Dispatcher** — `convex/workyard/dispatcher.ts` is a `"use node"` internalAction file (needs Node runtime for Jules SDK calls). Four actions:

- `dispatchPlannerSession` — Reads project state, constructs prompt via `planSessionPrompt()`, creates a Jules session via `sessions.actions.createSession`, initializes project if new, updates session budget. Returns `{ sessionId, projectId }`.
- `dispatchImplementationSessions` — Takes an array of Task objects, runs `validateOwnership` and `checkImplicitCoupling` (auto-merges conflicts), then dispatches up to `max_parallel_sessions` implementation sessions using `implementSessionPrompt()`. Returns `{ sessionIds, conflicts }`.
- `dispatchResearchSession` — Constructs research prompt, creates single Jules session. Returns `{ sessionId }`.
- `dispatchCorrection` — Constructs correction prompt by type, sends message to existing session. Returns `{ success }`.

**Three New Tools** — `convex/tools/workyardTools.ts` uses `createTool()` from `@convex-dev/agent` with zod schemas, matching the existing tool patterns:

- `dispatch_greenfield` — Input: repo, branch, idea, autonomy. Calls `dispatchPlannerSession` with `isGreenfield: true`.
- `dispatch_iterative` — Input: repo, branch, input, mode (single/planner/research), optional tasks, autonomy. Routes to the appropriate dispatcher action based on mode. When mode is "planner" and tasks are provided, calls `dispatchImplementationSessions` directly.
- `merge_prs` — Input: repo, sessionIds, branch. Calls the merger (stub at this phase, implemented in Phase 3).

**Tool Registry** — Added `export { dispatch_greenfield, dispatch_iterative, merge_prs } from "./workyardTools"` to `convex/tools/index.ts`.

---

## Phase 3: Merge Workflow with GitHub API via Executor

**Jules Session:** `10117043197570060736`
**PR:** #5 (branch `feature/workyard-merger-10117043197570060736`)

### Files Created/Modified

| File | Lines | Purpose |
|------|-------|---------|
| `convex/workyard/merger.ts` | +262 | Sequential PR merge workflow |
| `convex/tools/workyardTools.ts` | +25 | merge_prs tool now calls real merger |

### What It Does

**Merger** — `convex/workyard/merger.ts` is a `"use node"` internalAction that performs sequential PR merging through the Daytona sandbox executor. It does NOT hardcode GitHub API paths. Instead, it discovers available tools dynamically:

```
const toolsApi = await tools.discover({query: 'pull'});
```

Then uses the actual tool names returned. The algorithm follows the fleet-merge.ts pattern:

1. **List PRs** — Discovers the "list pull requests" tool, fetches open PRs for the repo
2. **Match PRs to sessions** — Matches PRs to sessionIds by checking branch names and PR bodies
3. **Risk ordering** — Sorts PRs by task risk (low first) using project task data
4. **Sequential merge loop**:
   - For each PR (except the first): update branch from base via discovered "update branch" tool
   - Detect 422 conflict responses → return `{ conflictPr, conflictUrl }` for human intervention
   - Poll CI via discovered "check runs" tool (30s intervals, configurable timeout from project config)
   - If CI passes, squash-merge via discovered "merge" tool
5. **Return** `{ success, mergedPrs, conflicts }`

**Helper function** `waitForCI` — Polls GitHub check runs through the executor. Discovers both the "get PR" tool (to get head SHA) and the "list check runs" tool. Returns true if all checks pass/skip/neutral, false if any fail or timeout.

**Tool wiring** — `merge_prs` in workyardTools.ts now calls `internal.workyard.merger.sequentialMerge` instead of returning a stub message.

---

## Phase 4: Agent Instructions + Wiring Verification

**Jules Session:** `18240160976147243534`
**PR:** #6 (branch `workyard-phase-4-18240160976147243534` — empty diff, Jules pushed to base branch directly)

The agent instructions update was done manually after discovering Session 4 produced an empty PR.

### Files Modified

| File | Lines Changed | Purpose |
|------|--------------|---------|
| `convex/agent/instructions.ts` | +62 | Workyard Orchestration section |

### What It Does

Added a "Workyard Orchestration" section to the LLM system prompt covering:

- **Flow selection** — When to use greenfield vs iterative (single/planner/research) vs raw create_session
- **Orchestration flow** — The 5-step lifecycle: describe work → dispatch → monitor → merge → report
- **When to use workyard tools vs raw sessions** — Structured development tasks use workyard; non-standard tasks use raw
- **Session economy** — Minimum sessions needed, budget awareness, natural reporting ("This will take about 3 sessions")
- **Autonomy levels** — auto/confirm/strict matching user approval preferences, default to confirm
- **After dispatch** — What to tell the user (sessions dispatched, repo/branch, what to expect, conflict resolution)

---

## Final State

**PR:** [#7](https://github.com/euellemma/jules-dispatch/pull/7) — `feat/workyard-integration` → `main`
**Total:** 1,578 additions across 13 files

```
convex/
  agent/instructions.ts          +62   (workyard orchestration section)
  projects/db.ts                +159  (project CRUD)
  schema.ts                     +29   (projects table)
  tools/
    index.ts                    +2    (tool exports)
    workyardTools.ts            +171  (3 new tools)
  workyard/
    dispatcher.ts               +248  (4 dispatch actions)
    merger.ts                   +262  (sequential PR merge)
    ownershipValidator.ts       +171  (conflict detection)
    promptBuilder.ts            +464  (prompt templates as code)
```

### Architecture Diagram

```
User (Telegram)
  |
  v
LLM Agent (instructions.ts)
  |
  +-- dispatch_greenfield  ----+
  +-- dispatch_iterative   ----+--> workyard/dispatcher.ts
  +-- merge_prs            ----+       |
  |                              +-- promptBuilder.ts (pure functions)
  |                              +-- ownershipValidator.ts (pure functions)
  |                              +-- projects/db.ts (Convex state)
  |                              +-- sessions/actions.ts (Jules SDK)
  |                              +-- workyard/merger.ts (executor + GitHub API)
  v
Jules Sessions (coding agents on target repos)
  |
  v
PRs (auto-created by Jules)
  |
  v
merger.ts (sequential merge with CI gating)
```
