# Merge Workflow

How to merge PRs from Jules sessions. Configurable per-repo via `jq/config.json`.

## Configuration

```json
{
  "auto_merge": true,
  "merge_method": "squash",
  "ci_timeout_minutes": 10,
  "conflict_retries": 2
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `auto_merge` | `true` | Automatically merge PRs after CI passes. If `false`, pause and notify user. |
| `merge_method` | `"squash"` | GitHub merge method: `squash`, `merge`, or `rebase` |
| `ci_timeout_minutes` | `10` | How long to wait for CI before timing out |
| `conflict_retries` | `2` | How many times to attempt re-dispatch on merge conflicts |

## Flow

```
All sessions complete → PRs exist on GitHub
        │
        ▼
  Read jq/tasks.json for risk ordering
  (lowest risk first)
        │
        ▼
  For each PR in order:
        │
        ├── Is this the first PR?
        │   └── YES → Skip branch update
        │   └── NO  → Update branch from base
        │              │
        │              ├── Update succeeds
        │              │   └── Continue
        │              └── Update fails (merge conflict)
        │                  │
        │                  ├── Retries remaining?
        │                  │   └── YES → Resume session with conflict resolution
        │                  │             Wait for new commit/PR
        │                  └── NO  → Escalate to user
        │
        ├── Wait for CI
        │   ├── CI passes
        │   │   └── Continue
        │   ├── CI fails
        │   │   └── Resume session with: "Fix failing CI: {{details}}"
        │   └── CI timeout
        │       └── Resume session with: "CI timed out, check: {{details}}"
        │
        ├── Merge PR
        │   │
        │   ├── auto_merge = true
        │   │   └── Squash merge automatically
        │   │
        │   └── auto_merge = false
        │       └── Notify user, wait for approval
        │
        └── Next PR
```

## Sequential Merge Strategy

PRs are merged **sequentially in risk order** (lowest risk first). This ensures:
1. Simple changes land first, establishing a clean base
2. Complex changes rebase onto already-merged code
3. If a conflict occurs, it's in the complex change, which is easier to reason about

Risk levels come from `jq/tasks.json`:
- `low` risk → merge first
- `medium` risk → merge second
- `high` risk → merge last

## Branch Update and Conflict Handling

Before merging each PR (after the first), update its branch from the base branch. This is done via the GitHub API:

```
PUT /repos/{owner}/{repo}/pulls/{pr_number}/update-branch
```

If the update fails with a 422 (merge conflict):

1. **Resume the Jules session** that created the PR with the conflict resolution prompt (see `flows/correct-session.md` Template: Conflict Resolution)
2. The session will rebase its changes onto the current base and resolve conflicts
3. Wait for the session to push new commits
4. Re-attempt the branch update and merge

If 2 resume attempts fail to resolve the conflict:

- Close the conflicting PR
- Note in `jq/progress.md` and `jq/memory.md`
- Escalate to user: "Task {{task-id}} has persistent merge conflicts that automated resolution couldn't fix. See jq/progress.md for details."

## CI Gating

After updating the branch, wait for CI checks to pass before merging.

### Polling Strategy

```
1. Get the head SHA from the PR
2. Poll GET /repos/{owner}/{repo}/commits/{sha}/check-runs every 30 seconds
3. If all check_runs have status "completed":
   a. If all conclusions are "success" or "skipped" → CI passed, proceed to merge
   b. If any conclusion is "failure" → CI failed, resume session
4. If timeout reached (config.ci_timeout_minutes) → CI timeout, resume session
```

### No CI Configured

If the repo has no CI checks configured:
- The GitHub Checks API returns an empty `check_runs` array
- Consider this as "passed" and proceed with merge
- Note in `jq/progress.md`: "No CI configured, proceeding without validation"

### CI Failure

If CI fails:
1. Read the failure details from the check runs
2. Resume the Jules session with the failure details
3. After the session pushes a fix, re-run CI
4. If CI fails 3 times on the same task → escalate to user

## Auto Merge vs Manual Merge

### Auto Merge (`auto_merge: true`)

1. Merge PRs automatically after CI passes
2. Use the task title as the squash commit message
3. Update `jq/progress.md` after each merge
4. Notify user when all merges complete

### Manual Merge (`auto_merge: false`)

1. After CI passes, pause and notify the user:
   > PR #{{NUMBER}} is ready to merge: {{PR_URL}}
   > Task: {{task_title}}
   > CI: Passed
   > 
   > Options: merge / hold / request changes
   
2. Wait for user response before proceeding
3. If user says "merge" → proceed with squash merge
4. If user says "hold" → skip this PR, move to next, revisit later
5. If user says "request changes" → resume session with user's feedback

## Merge Method

| Method | Command | Result |
|--------|---------|--------|
| `squash` (default) | `PUT /repos/{owner}/{repo}/pulls/{pr_number}/merge` with `merge_method: "squash"` | Single commit, clean history |
| `merge` | Same with `merge_method: "merge"` | Preserve commit history |
| `rebase` | Same with `merge_method: "rebase"` | Rebase commits onto base |

Squash is recommended because:
- Keeps the main branch history clean
- Each squashed commit represents one completed task
- Easier to revert if needed

## Progress Tracking

After each successful merge, update `jq/progress.md`:

```markdown
### Merged PRs
| PR | Task | Method | Merged At |
|----|------|--------|-----------|
| #5 | task-auth | squash | 2026-04-15T14:30:00Z |
| #6 | task-cart | squash | 2026-04-15T14:32:00Z |
```

After all merges complete, append to `jq/memory.md`:

```markdown
## 2026-04-15
- Iteration {{N}} complete: all {{M}} PRs merged
- Tasks: {{task_list}}
- Merge method: squash
- Learning: {{any patterns observed during merge, e.g., "cart module had CI timeout — increase timeout for data-heavy modules"}}
```