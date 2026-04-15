# Case Study: E-Commerce App (Phase 4: Dispatch)

Validation passed. `fleet-dispatch.ts` now spawns parallel agents for the tasks.

## The Network Calls

```typescript
const sessions = await jules.all(tasks, task => ({
  prompt: task.prompt,
  source: {
    github: 'my-org/shop-app',
    baseBranch: 'main',
  }
}))
```

Two separate, parallel network requests are sent to the Jules API.

1. **Agent 1 (Session `sess_frontend`)**: Receives the codebase at `main` and the prompt to fix the UI button. It knows *nothing* about the checkout errors.
2. **Agent 2 (Session `sess_backend`)**: Receives the codebase at `main` and the prompt to fix the 500 error and the rate limits. It knows *nothing* about the UI bug.

## The Output: `sessions.json`

Once the API accepts the jobs, `fleet-dispatch.ts` writes the mapping to disk and exits.

```json
[
  {
    "taskId": "task-wishlist-ui",
    "sessionId": "sess_frontend"
  },
  {
    "taskId": "task-checkout-stability",
    "sessionId": "sess_backend"
  }
]
```

## The Asynchronous Magic

Behind the scenes, the Jules agents are writing code.
- `sess_frontend` creates a branch `jules/sess_frontend` and opens PR #501.
- `sess_backend` creates a branch `jules/sess_backend` and opens PR #502.

Both PRs target `main`.
*Because we validated file ownership in Phase 3, we know PR #501 and PR #502 do not modify the same files.*
