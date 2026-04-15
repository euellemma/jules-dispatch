# Greenfield Workflow

Build a product from an idea on an empty (or near-empty) GitHub repository.

## When to Use This Flow

- User provides an idea for a new project
- Target repo exists on GitHub but is empty or has only a README
- No `jq/` directory exists yet (first interaction with this repo)

## Flow

```
USER: "Build me a real-time chat app with rooms, auth, and message history"

YOU ─────────────────────────────────────────────────────────────────
1.  Initialize jq/
2.  Craft foundation session prompt
3.  Create Jules session (foundation)
4.  Monitor → approve plan → wait for completion
5.  Read output: has it produced jq/tasks.json?
    ├── YES → validation + parallel dispatch
    └── NO  → assess output, may need resume
6.  If parallel: validate ownership → dispatch
7.  Monitor parallel sessions
8.  Merge (auto or manual per config)
9.  Update jq/progress.md + jq/memory.md
10. Report back to user
```

## Step-by-Step

### Step 1: Initialize jq/

If `jq/` doesn't exist in the target repo, create it:

```
jq/
  config.json     ← Set defaults (see schemas/config-json.md)
  memory.md       ← Initial entry (see templates/memory-template.md)
  progress.md     ← "Awaiting foundation session" (see templates/progress-template.md)
```

Write `jq/memory.md` with:
```markdown
# Workyard Memory

## 2026-04-15
- Initialized workyard for {{REPO}}
- Idea: {{USER_IDEA}}
- Status: Foundation session pending
```

Write `jq/config.json` with defaults (auto_merge: true, max_parallel_sessions: 5, etc.).

Write `jq/progress.md`:
```markdown
# Progress

## Status: Initializing
- Awaiting foundation session for {{REPO}}
- Idea: {{USER_IDEA_SUMMARY}}
```

### Step 2: Prepare Foundation Prompt

The foundation session is a Jules session that:
1. Builds the project skeleton (core architecture, dependencies, folder structure)
2. Writes `jq/tasks.json` describing what should be built in parallel next
3. Creates initial working code that parallel sessions can build upon

Construct the prompt using `flows/plan-session.md` template with:

- `{{REPO}}` = the GitHub repo (e.g., `user/chatapp`)
- `{{BRANCH}}` = `main` (or from config)
- `{{INPUT}}` = the user's idea description
- `{{MEMORY}}` = contents of `jq/memory.md` (just the initialization entry)
- `{{PLAN}}` = "This is a greenfield project. Build the foundation skeleton and produce tasks.json for parallel feature build-out."
- `{{GREENFIELD}}` = `true` (special flag in the template)

Set in the API call:
```json
{
  "prompt": "<constructed prompt>",
  "sourceContext": {
    "source": "sources/github/{{OWNER}}/{{REPO}}",
    "githubRepoContext": {
      "startingBranch": "main"
    }
  },
  "automationMode": "AUTO_CREATE_PR",
  "requirePlanApproval": true,
  "title": "Foundation: {{PROJECT_NAME}}"
}
```

**Why `requirePlanApproval: true` for greenfield?** The foundation sets the architecture for everything that follows. You want to see what Jules plans before it builds.

### Step 3: Create and Monitor Foundation Session

Call `sessions.create` with the constructed prompt.

Poll `sessions.activities.list` periodically. Watch for:
- `planGenerated` → Review the plan. If it makes sense, call `sessions.approvePlan`.
- `progressUpdated` → Update `jq/progress.md` with what's happening.
- `sessionCompleted` → Foundation session is done. Check for change sets and PR.

Update `jq/progress.md`:
```markdown
# Progress

## Status: Foundation Building
- Session: {{SESSION_ID}}
- Plan approved: 2026-04-15T10:30:00Z
- Building foundation...

### Active Sessions
| Session | Task | Status | PR |
|---------|------|--------|-----|
| {{SESSION_ID}} | Foundation | Building | — |
```

### Step 4: Assess Foundation Output

Once the foundation session completes, check if it created `jq/tasks.json`.

**If `jq/tasks.json` exists:**

Read it. Validate:
- Are there multiple tasks with non-overlapping file ownership?
- Is the foundation code actually working (PR has changes, CI if configured)?
- Do the tasks make sense for the idea described?

If everything looks good → proceed to Step 5 (parallel dispatch).

**If `jq/tasks.json` doesn't exist:**

This means the foundation session decided it could complete the entire project in one go (simple project), OR it didn't follow instructions.

- Check the PR. If the project is complete and working → done. Update memory and report to user.
- If the project is partially built → resume the session with `sendMessage`: "Please also write jq/tasks.json describing the remaining work that should be built in parallel."
- If the project is barely started → this is a problem. Resume with clearer instructions about building foundation + tasks.json.

### Step 5: Validate and Dispatch Parallel Sessions

Read `jq/tasks.json`. Run ownership validation (see `references/ownership-validation.md`).

For each task in tasks.json, construct a prompt using `flows/implement-session.md` template:

- `{{TASK}}` = the specific task definition from tasks.json
- `{{REPO}}` = repo name
- `{{BRANCH}}` = base branch (this MUST be the branch with the foundation already merged)
- `{{MEMORY}}` = contents of `jq/memory.md`
- `{{FILE_BOUNDARY}}` = explicit list of files this session may modify

**Important:** The base branch for parallel sessions should include the merged foundation code. If the foundation PR hasn't been merged yet, merge it first before dispatching parallel sessions.

Dispatch all sessions via `sessions.create`. Use `automationMode: AUTO_CREATE_PR` for each.

For `requirePlanApproval`:
- Low-risk tasks (UI components, new modules): `false`
- High-risk tasks (core logic, data layer, auth): `true`
- Default: follow `config.json` if set, otherwise `false`

Update `jq/progress.md`:
```markdown
## Status: Parallel Build
- Foundation: merged (PR #{{PR_NUMBER}})
- Dispatched {{N}} parallel sessions

### Active Sessions
| Session | Task | Status | PR |
|---------|------|--------|-----|
| {{SESSION_ID_1}} | {{task-1-title}} | Building | — |
| {{SESSION_ID_2}} | {{task-2-title}} | Building | — |
| {{SESSION_ID_3}} | {{task-3-title}} | Building | — |
```

### Step 6: Monitor Parallel Sessions

Poll each session's activities. For each session:
- If `planGenerated` and `requirePlanApproval: true`: review and approve
- If `progressUpdated`: note progress, update progress.md if significant
- If `sessionCompleted`: check for PR, mark session as complete in progress.md
- If session appears stuck (no activity for extended time): resume with `sendMessage` to unstick

### Step 7: Merge

Follow `flows/merge.md` for the full merge workflow.

Sequence:
1. Merge foundation PR first (if not already merged)
2. Merge parallel task PRs in risk order (lowest risk first)
3. For each PR: update from base branch, wait for CI, merge
4. If conflict: resume the session that created the PR with "rebase onto base and resolve conflicts"
5. Update `jq/progress.md` after each merge

### Step 8: Update Memory and Report

After all merges complete, update `jq/memory.md`:
```markdown
## 2026-04-15
- Greenfield build complete for {{REPO}}
- Foundation: {{X}} files, session {{SESSION_ID}}, PR #{{N}}
- Parallel features: {{N}} tasks dispatched, {{M}} PRs merged
- Modules built: {{list modules}}
- Learning: {{any patterns observed, e.g., "auth module was complex — prefer single session for auth changes"}}
```

Write final `jq/progress.md`:
```markdown
# Progress

## Status: Complete
- All {{N}} tasks merged
- Foundation: merged
- Parallel features: all merged

### Completed Sessions
| Session | Task | PR | Status |
|---------|------|-----|--------|
| ... | ... | ... | Merged |
```

Report to the user:
> Greenfield build complete. {{N}} modules built across {{M}} sessions. All PRs merged to main. See jq/memory.md for the full history and jq/plan.md for the architecture overview. Ready for next iteration.
```

### Step 9: Ready for Next Iteration

The repo now has:
- Working foundation code (merged)
- Feature code (merged)
- `jq/` directory with full history (memory.md) and current state (progress.md, config.json)

The user can now provide feedback, add features, fix issues → this transitions to the **iterate flow** (see `flows/iterate.md`).

## Handling Foundation Failures

### Foundation session produces unclear architecture

Resume with `sendMessage`:
```
The foundation you built doesn't clearly separate modules for parallel development.
Please update the project structure to have clear module boundaries and write
jq/tasks.json with tasks that each own distinct, non-overlapping file sets.
```

### Foundation session doesn't write tasks.json

Resume with `sendMessage`:
```
You were also asked to write jq/tasks.json describing the remaining work for parallel
development. Please create this file now, following the schema with id, title,
files, new_files, test_files, risk, prompt, and file_ownership fields.
```

### Foundation session's PR fails CI

Resume with `sendMessage`:
```
The CI checks on your PR are failing:
- {{CI_FAILURE_OUTPUT}}
Please fix these issues in your current session.
```

### User wants to change the foundation architecture

If the user reviews the foundation and wants changes before parallel dispatch:
1. Resume the foundation session with corrective directions
2. OR create a new session scoped to just the architectural changes
3. Then proceed to parallel dispatch once foundation is approved

## Single-Session Greenfield

Not all greenfield projects need parallel sessions. If:
- The idea is simple (a CLI tool, a single-page app, a small utility)
- Estimated scope is < 10 files
- No natural parallelization exists

Then create a single Jules session with everything in one prompt. Skip tasks.json, skip parallel dispatch. The session builds the whole thing. Use the `flows/implement-session.md` template directly with the full idea.

The foundation → parallel pattern is for projects where:
- Multiple independent modules can be built simultaneously
- The idea is complex enough to benefit from decomposition
- Session economy allows 3-10 parallel sessions (within daily limits)