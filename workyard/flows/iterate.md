# Iterative Workflow

Apply changes to an existing codebase based on user input (issues, feedback, logs, ideas, docs — any markdown input).

## When to Use This Flow

- User provides markdown input describing what they want changed/added/fixed
- Repo already has code (may or may not have `jq/` directory)
- Can be a bug fix, feature addition, refactor, or any change to existing code

## Flow

```
USER: provides markdown input (issue, feedback, feature request, etc.)

YOU ──────────────────────────────────────────────────────────────
1.  Read jq/ context (memory.md, progress.md, plan.md if exists)
2.  Initialize jq/ if this is first contact
3.  Decide: single session or planner session?
    ├── Single task, low complexity → one Jules session
    │   └── Session implements directly
    └── Complex, multi-area change → planner session
        ├── Planner analyzes + produces jq/tasks.json
        ├── Planner may implement directly if simple enough
        └── If tasks.json has multiple tasks → parallel dispatch
4.  Create session(s) with appropriate prompts
5.  Monitor → approve/resume → update progress.md
6.  Merge (auto or manual per config)
7.  Update memory.md + progress.md
8.  Report to user
```

## Step-by-Step

### Step 1: Read Context

Read existing `jq/` files to understand current state:

```
jq/memory.md    → What's been done before, patterns, learnings
jq/progress.md  → What's happening right now
jq/plan.md      → Current plan (if mid-iteration)
jq/config.json  → Repo settings
```

If `jq/` doesn't exist, this is first contact → proceed to Step 2.
If `jq/` exists, use the context to inform your decisions. If something was attempted before and failed (from memory.md), avoid the same approach.

### Step 2: Initialize jq/ (If First Contact)

If no `jq/` directory exists:

1. Create `jq/config.json` with defaults (see `schemas/config-json.md`)
2. Create `jq/memory.md` with initial entry (see `templates/memory-template.md`)
3. Create `jq/progress.md` with "Awaiting first iteration" (see `templates/progress-template.md`)
4. Do NOT write `jq/plan.md` or `jq/tasks.json` yet — those come from the planning step

Write a brief analysis to `jq/progress.md`:
```markdown
# Progress

## Status: Initializing
- First workyard contact with {{REPO}}
- Input: {{SUMMARY_OF_USER_INPUT}}
- Analyzing...
```

Optionally, create a research session (see `flows/research-session.md`) to understand the codebase before planning. This is useful for brownfield repos where you need to understand architecture before making changes.

### Step 3: Decide Single vs Planner

Assess the user's input against these criteria:

| Signal | Single Session | Planner Session |
|--------|---------------|-----------------|
| Scope | 1-2 files, localized change | 3+ files, cross-cutting change |
| Complexity | Bug fix, small feature, config change | New module, refactor, multi-component feature |
| Clarity | User described exactly what to do | User described what they want, not how |
| Risk | Low (fixing, adding isolated code) | Medium-high (touching core, shared code) |
| Memory | No prior issues with similar changes | memory.md shows past patterns/conflicts |

**When in doubt, use a planner session.** The planner can always decide to implement directly if the work is simple enough — it's the safe default that doesn't waste sessions.

### Step 4a: Single Session Path

Create one Jules session using `flows/implement-session.md` template:

- `{{INPUT}}` = the user's markdown input
- `{{MEMORY}}` = contents of `jq/memory.md`
- `{{REPO}}` = target repo
- `{{BRANCH}}` = from config
- `{{FILE_BOUNDARY}}` = "No explicit boundary — use best judgment to keep changes minimal and focused."

Set:
```json
{
  "prompt": "<constructed from template>",
  "sourceContext": {
    "source": "sources/github/{{OWNER}}/{{REPO}}",
    "githubRepoContext": {
      "startingBranch": "{{BRANCH}}"
    }
  },
  "automationMode": "AUTO_CREATE_PR",
  "requirePlanApproval": false,
  "title": "{{SHORT_DESCRIPTION}}"
}
```

Update `jq/progress.md`:
```markdown
## Status: Building
- Single session: {{SESSION_ID}}
- Task: {{SHORT_DESCRIPTION}}
- Started: {{TIMESTAMP}}
```

Monitor the session. If it completes successfully → jump to Step 7 (Merge).

### Step 4b: Planner Session Path

Create a planner Jules session using `flows/plan-session.md` template:

- `{{INPUT}}` = the user's markdown input
- `{{MEMORY}}` = contents of `jq/memory.md`
- `{{REPO}}` = target repo
- `{{BRANCH}}` = from config

The planner session is instructed to:
1. Analyze the codebase and the input
2. Produce a plan in `jq/plan.md` (human-readable)
3. Produce `jq/tasks.json` (machine-readable)
4. **If the work is simple enough to do in this session**, implement it directly instead of writing tasks.json

Set `requirePlanApproval: true` for the planner — you want to see what it plans before it proceeds.

Update `jq/progress.md`:
```markdown
## Status: Planning
- Planner session: {{SESSION_ID}}
- Input: {{INPUT_SUMMARY}}
- Awaiting plan...
```

### Step 5: Assess Planner Output

After the planner session completes (or produces its plan), check what happened:

**Path A: Planner produced `jq/tasks.json` with 1 task**

The planner determined this is simple enough for one session, but didn't implement it directly. Read the single task, create one implementation session using `flows/implement-session.md`.

Use the task's `prompt` field as the core of `{{INPUT}}`, and the task's file lists for `{{FILE_BOUNDARY}}`.

**Path B: Planner produced `jq/tasks.json` with multiple tasks**

1. Read `jq/tasks.json`
2. Run ownership validation (see `references/ownership-validation.md`)
3. If any file ownership conflicts exist → merge conflicting tasks
4. For each task, create a parallel Jules session using `flows/implement-session.md`
5. Use `animationMode: AUTO_CREATE_PR` for each
6. Set `requirePlanApproval` based on task risk (low → false, high → true)

Update `jq/progress.md`:
```markdown
## Status: Parallel Build
- Dispatched {{N}} sessions from plan
- Tasks: {{task list}}

### Active Sessions
| Session | Task ID | Title | Risk | Status | PR |
|---------|---------|-------|------|--------|-----|
| {{ID}} | {{task-id}} | {{title}} | {{risk}} | Building | — |
```

**Path C: Planner implemented directly (no tasks.json produced)**

The planner decided the work was simple and did it all in one session. Check the PR output. If it looks good → jump to Step 7 (Merge).

### Step 6: Monitor and Correct

For each active session, poll `sessions.activities.list` periodically.

**Plan approval:**
- If `requirePlanApproval: true` and you see `planGenerated` → review the plan
- Approve if it aligns with the task description
- If the plan drifts → `sendMessage` with corrections OR let it proceed if the drift is reasonable

**Session stuck or going wrong:**
- Use `sendMessage` to correct course. See `flows/correct-session.md` for prompt templates.
- Always try resume first. Don't create a new session unless the current one is truly unrecoverable.
- After 2 failed resume attempts on the same issue → escalate to user

**Session completed:**
- Check for PR in the activities
- Update `jq/progress.md` with PR URL and status

### Step 7: Merge

Follow `flows/merge.md`. Key considerations for iterative workflow:

- Base branch should include any recently merged PRs (update between merges)
- Merge in risk order (lowest first)
- If auto_merge is true in config → proceed automatically
- If auto_merge is false → present PRs to user for review

### Step 8: Update Memory and Report

After all merges complete, append to `jq/memory.md`:
```markdown
## {{DATE}}
- Iteration {{N}} complete
- Tasks: {{list of tasks completed}}
- PRs merged: #{{PR_NUMBERS}}
- Files changed: {{key files}}
- Learning: {{any pattern observed, e.g., "changing shared/utils.ts requires single-session approach to avoid conflicts"}}
```

Refresh `jq/progress.md` to show completion state.

Report to the user with a brief summary in chat, pointing to `jq/progress.md` for details:
> Iteration complete. {{N}} changes merged to {{BRANCH}}. See jq/progress.md for details.

### Step 9: Ready for Next Input

The cycle is complete. The user can provide more input, and you start again from Step 1.

## Discussion (Implicit)

The user may want to discuss approach, architecture, or tradeoffs before building. This is implicit in the flow:

- If the user's input is a question or RFC rather than a build request → write your analysis to `jq/plan.md` and point the user there
- If the planner session's plan needs user buy-in → present the key decisions and point to `jq/plan.md` for full details
- If you need codebase research to answer a question → create a research session (see `flows/research-session.md`) and publish findings to `jq/plan.md`

The key principle: **long-form content goes to md files.** Chat is for brief summaries and pointers. md files are for the user's markdown viewer.

## Handling Brownfield First Contact

When you first encounter a repo that already has code but no `jq/` directory:

1. You don't need to map the entire codebase. Only understand what's relevant to the user's input.
2. Create `jq/` with initial files
3. If the user's input touches areas you don't understand → create a research session first
4. Write to `jq/memory.md`: "First contact with existing repo. Initial change: {{description}}."
5. The `progress.md` should note which areas of the codebase are being touched

Over time, `jq/memory.md` accumulates knowledge about what you've touched. It's NOT a full codebase map — it's a record of your work and the parts you've interacted with. This is the "implicit context guarding" — agents that follow can read memory.md and know what's been done.

## Resuming After Interruption

If you lose context between iterations (new conversation, context window reset, etc.):

1. Read `jq/memory.md` — this tells you everything that's been done
2. Read `jq/progress.md` — this tells you current state
3. Read `jq/plan.md` — this tells you what was planned (if mid-iteration)
4. Read `jq/tasks.json` — this tells you what tasks exist (if mid-dispatch)

All state is in the files. You can always recover. If files are missing or stale, that's information too — something may have gone wrong that needs investigating.