# Phase 5: Merge (`fleet-merge.ts`)

The **Merge** phase is the most operationally complex step. Because multiple PRs were spawned concurrently off the same `baseBranch` (e.g., `main`), merging them blindly could result in logical conflicts or broken tests. This phase enforces a **sequential, CI-gated rebasing** strategy.

## Code Execution Path

1. Executed via GitHub Actions (`fleet-merge.yml`) or locally.
2. It loads `sessions.json` and `issue_tasks.json` (which ordered the tasks by Risk: Low to High).
3. It fetches all open PRs via the GitHub API and matches them to the session IDs.
4. It iterates through the PRs sequentially:
   - Updates the PR branch from `main` (rebasing it).
   - Waits for CI Checks to pass.
   - Squash merges the PR.
5. If a merge conflict occurs, it triggers the **Re-dispatch loop**.

## Inputs
* `sessions.json` (Session IDs).
* `issue_tasks.json` (Risk ordering and original prompts).
* `GITHUB_TOKEN`.
* Open Pull Requests on GitHub.

## The Re-dispatch Loop (Context Sent to Jules)

If PR #1 merges, and PR #2 tries to update its branch from `main` but encounters a git merge conflict (GitHub API returns `422 Unprocessable Entity`), `fleet-merge.ts` realizes the local code cannot be cleanly rebased.

Instead of failing, it initiates a **Re-dispatch**.

```typescript
// scripts/fleet-merge.ts (Snippet inside redispatchTask)

// 1. Close the old conflicting PR
await fetch(`${API}/pulls/${oldPr.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });

// 2. Spawn a brand new Jules session
const session = await jules.createSession({
  prompt: task.prompt, // The EXACT SAME prompt from Phase 2
  source: {
    github: `${OWNER}/${REPO}`,
    baseBranch: BASE_BRANCH, // This branch now includes PR #1's code!
  },
});
```

### What Jules sees in Re-dispatch:
The newly spawned Jules agent receives the **exact same prompt** generated in Phase 2. However, the repository context (`baseBranch`) has changed—it now contains the merged code from previous tasks. Jules will re-read the prompt, re-analyze the *new* state of the code, and re-implement the fix, naturally resolving the conflict that defeated standard `git rebase`.

## CI Gating (`waitForCI`)

To prevent Jules from breaking `main`, the merge phase polls the GitHub Checks API.

```typescript
// scripts/fleet-merge.ts (Snippet inside waitForCI)
const allComplete = data.check_runs.every(run => run.status === "completed");
const allPassed = data.check_runs.every(run => run.conclusion === "success" || run.conclusion === "skipped");

if (allComplete && !allPassed) return false;
```

If CI fails, the script aborts (`process.exit(1)`). It relies on the File Boundary rule established in Phase 2: if a task breaks a test outside of its boundary, it is deemed a failure of backward-compatibility. Human intervention is required to review the PR.

## Outputs
* Closed Pull Requests (Squash merged into `main`).
* Closed Pull Requests (Abandoned due to conflict).
* Updated `sessions.json` (If a re-dispatch occurred).
* Pipeline Success / Failure exit codes.
