# Correct/Resume Session Prompt Template

This is the prompt template for sending a follow-up message to an existing Jules session. Used when a session needs correction, continuation, or adjustment.

You do NOT create a new session. You call `sessions.sendMessage` on the existing session ID.

---

## When to Resume a Session

| Situation | Action | Template Section |
|-----------|--------|-----------------|
| CI failure on PR | Resume with test fix guidance | Test Failure |
| Session produced wrong approach | Resume with corrective direction | Course Correction |
| Session produced partial work | Resume with continuation instructions | Continuation |
| Merge conflict after rebase | Resume with conflict resolution strategy | Conflict Resolution |
| Session seems stuck | Resume with a nudge | Nudge |

---

## Template: Test Failure

```
The CI checks on your pull request are failing. Here are the failing tests:

{{CI_FAILURE_OUTPUT}}

Please fix these test failures. Focus on making the tests pass while keeping your implementation correct. If a test is testing outdated behavior, update the test — but only if the test is within your file boundary.

If tests outside your file boundary are failing, adjust your implementation to be backward-compatible rather than modifying those tests.
```

## Template: Course Correction

```
Your current approach isn't quite right. Here's the issue:

{{CORRECTION_DESCRIPTION}}

The correct approach should be:

{{CORRECT_APPROACH}}

Please adjust your implementation to follow this approach. You don't need to start over — modify what you have to align with the correct direction.
```

## Template: Continuation

```
Your session produced partial work. Here's what's been done so far:

{{COMPLETED_WORK_SUMMARY}}

What still needs to be done:

{{REMAINING_WORK}}

Please continue implementing from where you left off. Focus on the remaining items above.
```

## Template: Conflict Resolution

```
Your pull request has merge conflicts with the base branch {{BRANCH}}. This typically happens when another session's changes have been merged to base since you branched off.

Please rebase your changes onto the current base branch and resolve any conflicts. Strategy for conflict resolution:

{{CONFLICT_STRATEGY}}

Common resolution patterns:
- If both sides modified the same function: keep both changes if they're compatible, or integrate them if they overlap
- If one side added imports and the other modified the same file: keep all imports
- If conflicts are in generated files (package-lock.json, etc.): regenerate them

After resolving conflicts, ensure all tests still pass.
```

## Template: Nudge

```
Please continue working on the task. It appears the session may have stalled.

Current status: {{CURRENT_STATUS}}
Remaining work: {{REMAINING_ITEMS}}

Continue from where you left off.
```

---

## How to Resume

Use the Jules API:

```
POST /v1alpha/sessions/{SESSION_ID}:sendMessage
{
  "prompt": "<constructed from template above>"
}
```

The session will continue from where it left off. It has full context of what it already did (visible in its activity stream).

## Decision Tree for Corrections

```
Session produces PR
├── CI passes
│   ├── Auto-merge enabled → merge
│   └── Manual merge → notify user
└── CI fails
    ├── Test failure in session's boundary files
    │   └── Resume session with Template: Test Failure
    ├── Test failure outside boundary
    │   ├── Can make backward-compatible fix in boundary
    │   │   └── Resume session with: "Make your changes backward-compatible so test X passes"
    │   └── Cannot fix within boundary
    │       └── Escalate: merge boundary needed, involve user
    └── Build/lint failure
        └── Resume session with: "Fix build/error: {{error output}}"

Session produces unexpected approach
├── Minor drift (still achieves goal)
│   └── Let it proceed, note in memory.md
├── Moderate drift (goal partially met)
│   └── Resume with Template: Course Correction
└── Major drift (wrong direction)
    ├── Resume with Template: Course Correction
    │   If fails again →
    └── Abandon session, create new one with clearer prompt

Session seems stuck (no activity for extended time)
├── First attempt
│   └── Resume with Template: Nudge
├── Second attempt (still stuck)
│   └── Resume with more specific direction
└── Third attempt
    └── Escalate to user — may need manual intervention
```

## Escaping a Bad Session

If 2 resume attempts fail on the same issue:
1. Note in `jq/progress.md`: "Session {{SESSION_ID}} abandoned after 2 failed resume attempts. Issue: {{ISSUE}}"
2. Note in `jq/memory.md`: "Session {{SESSION_ID}} on task {{TASK}} failed. Root cause: {{ISSUE}}. Pattern: {{LEARNING}}"
3. Inform the user with a brief summary and link to `jq/progress.md` for details
4. Do NOT automatically create a new session for the same task — the user should decide whether to retry or take a different approach