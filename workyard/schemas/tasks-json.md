# tasks.json Schema

The machine-readable task definition file produced by planner sessions and consumed by the dispatch and merge workflows.

## File Location

`jq/tasks.json` — at the root of the target repository's `jq/` directory.

## Schema

```json
{
  "repo": "string — GitHub repo full name (owner/repo)",
  "created_at": "string — ISO 8601 timestamp when this file was created",
  "source": "string — description of what triggered this iteration (user input summary, issue numbers, etc.)",
  "tasks": [
    {
      "id": "string — kebab-case task identifier (e.g., 'task-auth-module', 'task-cart-retry')",
      "title": "string — human-readable task title",
      "description": "string — what this task accomplishes and why",
      "files": ["string — existing files this task modifies"],
      "new_files": ["string — new files this task creates"],
      "test_files": ["string — test files this task modifies"],
      "risk": "string — 'low' | 'medium' | 'high'",
      "prompt": "string — complete, self-contained prompt for a Jules implementation session"
    }
  ],
  "file_ownership": {
    "src/existing-file.ts": "task-id — maps each file to the task that owns it"
  }
}
```

## Field Definitions

### Top Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo` | string | yes | GitHub repository full name (e.g., `acme/my-app`) |
| `created_at` | string | yes | ISO 8601 timestamp of when this plan was created |
| `source` | string | yes | Brief description of what triggered this iteration |
| `tasks` | array | yes | List of task objects (can be empty if planner implemented directly) |
| `file_ownership` | object | yes | Map of file path → task ID. Every file in every task must appear here. No file may appear twice. |

### Task Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique kebab-case identifier. Used to match PRs to tasks and track progress. |
| `title` | string | yes | Short human-readable title describing what this task does |
| `description` | string | yes | 1-3 sentence explanation of what and why |
| `files` | string[] | yes | Existing files this task modifies. Must be exact paths from the repository. |
| `new_files` | string[] | yes | New files this task creates. Can be empty `[]`. |
| `test_files` | string[] | yes | Test files this task modifies. Can be empty `[]` if no tests. |
| `risk` | string | yes | One of: `low`, `medium`, `high`. Determines merge order and plan approval. |
| `prompt` | string | yes | Full, self-contained prompt for the Jules implementation session. Must include: task description, file boundary, code examples, integration points, test scenarios, acceptance criteria. |

## Rules

1. **Every file in `files`, `new_files`, and `test_files` must appear in `file_ownership`**. No orphan files.
2. **No file may appear in `file_ownership` more than once.** If two tasks need the same file, merge them into one task.
3. **Task IDs must be unique.** Used for tracking across sessions, PRs, and progress.md.
4. **Risk determines merge order.** Tasks are merged lowest-risk first: `low` → `medium` → `high`.
5. **`prompt` must be self-contained.** The implementing Jules session has no context about other tasks. Include everything the session needs: code examples, diffs, integration points, test scenarios, and the FILE BOUNDARY rule.
6. **Tasks may be empty.** If the planner implements directly, `tasks` can be `[]` with an empty `file_ownership`.

## Example

```json
{
  "repo": "acme/chat-app",
  "created_at": "2026-04-15T10:30:00Z",
  "source": "User requested: Add user authentication with email/password and session management",
  "tasks": [
    {
      "id": "task-auth-core",
      "title": "Implement auth core module",
      "description": "Create the authentication module with email/password signup, login, logout, and session management using JWT tokens.",
      "files": ["src/middleware/auth.ts"],
      "new_files": ["src/auth/signup.ts", "src/auth/login.ts", "src/auth/session.ts", "src/auth/index.ts"],
      "test_files": ["tests/auth/signup.test.ts", "tests/auth/login.test.ts", "tests/auth/session.test.ts"],
      "risk": "high",
      "prompt": "Implement authentication core module for the chat app..."
    },
    {
      "id": "task-auth-ui",
      "title": "Build login/signup UI components",
      "description": "Create the login and signup page components with form validation and error handling.",
      "files": ["src/components/Header.tsx"],
      "new_files": ["src/pages/Login.tsx", "src/pages/Signup.tsx"],
      "test_files": ["tests/components/Login.test.tsx", "tests/components/Signup.test.tsx"],
      "risk": "low",
      "prompt": "Create login and signup UI components..."
    }
  ],
  "file_ownership": {
    "src/middleware/auth.ts": "task-auth-core",
    "src/auth/signup.ts": "task-auth-core",
    "src/auth/login.ts": "task-auth-core",
    "src/auth/session.ts": "task-auth-core",
    "src/auth/index.ts": "task-auth-core",
    "tests/auth/signup.test.ts": "task-auth-core",
    "tests/auth/login.test.ts": "task-auth-core",
    "tests/auth/session.test.ts": "task-auth-core",
    "src/components/Header.tsx": "task-auth-ui",
    "src/pages/Login.tsx": "task-auth-ui",
    "src/pages/Signup.tsx": "task-auth-ui",
    "tests/components/Login.test.tsx": "task-auth-ui",
    "tests/components/Signup.test.tsx": "task-auth-ui"
  }
}
```