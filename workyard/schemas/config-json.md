# config.json Schema

Per-repo configuration for workyard. Created on first contact with a repo. Can be edited manually by the user.

## File Location

`jq/config.json` — at the root of the target repository's `jq/` directory.

## Schema

```json
{
  "repo": "string — GitHub repo full name (owner/repo)",
  "base_branch": "string — default branch to target (default: 'main')",
  "auto_merge": "boolean — automatically merge PRs after CI passes (default: true)",
  "merge_method": "string — 'squash' | 'merge' | 'rebase' (default: 'squash')",
  "require_plan_approval": "boolean — require Jules plan approval before implementation (default: false)",
  "max_parallel_sessions": "number — maximum parallel Jules sessions per dispatch (default: 5)",
  "ci_timeout_minutes": "number — how long to wait for CI checks before timeout (default: 10)",
  "conflict_retries": "number — how many times to attempt conflict resolution before escalating (default: 2)",
  "session_economy": "string — 'conservative' | 'balanced' | 'aggressive' (default: 'balanced')",
  "created_at": "string — ISO 8601 timestamp when config was created",
  "updated_at": "string — ISO 8601 timestamp when config was last updated"
}
```

## Field Definitions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `repo` | string | — | GitHub repo full name. Used in Jules session source context. |
| `base_branch` | string | `"main"` | Branch that Jules sessions target and PRs merge into. |
| `auto_merge` | boolean | `true` | When true, PRs are merged automatically after CI passes. When false, orchestrator pauses for user approval before each merge. |
| `merge_method` | string | `"squash"` | GitHub merge method. `squash` recommended for clean history. |
| `require_plan_approval` | boolean | `false` | Global default for `requirePlanApproval` on Jules sessions. Individual sessions may override based on task risk. |
| `max_parallel_sessions` | number | `5` | Upper limit on parallel sessions per dispatch. Prevents consuming too many daily sessions. Practical: 3-10. Jules free tier: 15/day, Pro: 100/day, Ultra: 300/day. |
| `ci_timeout_minutes` | number | `10` | Minutes to wait for CI checks before considering them timed out. |
| `conflict_retries` | number | `2` | Number of times to attempt conflict resolution (resume session + rebase) before escalating to user. |
| `session_economy` | string | `"balanced"` | Controls how aggressively the orchestrator creates new sessions vs reusing existing ones. See below. |
| `created_at` | string | — | Timestamp of initial creation. |
| `updated_at` | string | — | Timestamp of last modification. |

## Session Economy Modes

| Mode | Behavior |
|------|----------|
| `conservative` | Prefer single sessions. Only parallelize when tasks are clearly independent and 3+ files apart. Always try to resume before creating new. Best for free-tier Jules (15 sessions/day). |
| `balanced` | Default. Parallelize when planner produces 2+ tasks with clear file boundaries. Resume for corrections, new session only when starting fresh. Good for Pro tier (100/day). |
| `aggressive` | Parallelize liberally. Even 2-file changes get their own session if they don't overlap. Best for Ultra tier (300/day) or when speed matters more than session count. |

## Example

```json
{
  "repo": "acme/my-saas-app",
  "base_branch": "main",
  "auto_merge": true,
  "merge_method": "squash",
  "require_plan_approval": false,
  "max_parallel_sessions": 5,
  "ci_timeout_minutes": 10,
  "conflict_retries": 2,
  "session_economy": "balanced",
  "created_at": "2026-04-15T10:00:00Z",
  "updated_at": "2026-04-15T10:00:00Z"
}
```

## User Override

The user can edit `jq/config.json` directly at any time. The orchestrator reads it at the start of each iteration. Changes take effect immediately — no restart needed.

Common overrides:
- Set `auto_merge: false` for a production repo where you want to review every PR
- Set `max_parallel_sessions: 2` to conserve Jules sessions on the free tier
- Set `require_plan_approval: true` for a critical repo where you want to review every Jules plan
- Set `session_economy: "conservative"` when running low on daily sessions