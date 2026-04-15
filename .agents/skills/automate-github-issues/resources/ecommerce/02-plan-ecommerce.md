# Case Study: E-Commerce App (Phase 2: Plan)

`fleet-plan.ts` starts. The Jules Staff Engineer agent is invoked with the massive `analyzeIssuesPrompt`, injecting the markdown from Phase 1.

Jules reads the issues and cross-references them against the codebase at `main`.

## The Coupling Analysis (The "Aha!" Moment)

Jules realizes:
1. Issue #401 modifies `src/cart.ts` and `src/api.ts` (where the cart route is registered).
2. Issue #402 modifies `src/gateway.ts` and `src/api.ts` (where the rate limiter middleware is applied to the checkout route).
3. Issue #403 modifies `components/WishlistButton.tsx`.

If Jules created 3 tasks, Task 1 and Task 2 would both modify `src/api.ts`. This violates the strict **Merge conflict avoidance rule** in the prompt.

Jules correctly applies the coupling rule and merges Issues 401 and 402 into a single task.

## The Output: `issue_tasks.json`

Jules writes this JSON file to disk. Notice the `file_ownership` matrix ensuring no overlaps.

```json
{
  "repo": "my-org/shop-app",
  "analyzed_at": "2023-10-27T06:05:00Z",
  "root_causes": [
    {
      "id": "rc-checkout-stability",
      "title": "Checkout route crashes and rate limits",
      "severity": "critical",
      "issues": [401, 402],
      "files": ["src/api.ts", "src/cart.ts", "src/gateway.ts"],
      "description": "Uncaught inventory errors and aggressive global rate limiting on the checkout path.",
      "solution_summary": "Catch InventoryExhaustedError and return 409. Apply custom rate limit config in api.ts for the checkout route."
    },
    {
      "id": "rc-wishlist-mobile",
      "title": "Wishlist hidden on small viewports",
      "severity": "low",
      "issues": [403],
      "files": ["components/WishlistButton.tsx"],
      "description": "Legacy CSS media query hides the button on mobile.",
      "solution_summary": "Remove `display: none` for <400px and replace with icon-only responsive variant."
    }
  ],
  "tasks": [
    {
      "id": "task-wishlist-ui",
      "title": "Fix mobile wishlist visibility",
      "root_cause": "rc-wishlist-mobile",
      "issues": [403],
      "files": ["components/WishlistButton.tsx"],
      "new_files": [],
      "test_files": ["tests/components/WishlistButton.test.tsx"],
      "risk": "low",
      "prompt": "Task: Fix mobile wishlist visibility...\n[Full detailed prompt for the UI agent]"
    },
    {
      "id": "task-checkout-stability",
      "title": "Harden checkout API routes",
      "root_cause": "rc-checkout-stability",
      "issues": [401, 402],
      "files": ["src/api.ts", "src/cart.ts", "src/gateway.ts"],
      "new_files": [],
      "test_files": ["tests/cart.test.ts", "tests/api.test.ts"],
      "risk": "high",
      "prompt": "Task: Harden checkout API routes...\n[Full detailed prompt for the Backend agent including 409 implementation and rate limit bypass code]"
    }
  ],
  "unaddressable": [],
  "file_ownership": {
    "components/WishlistButton.tsx": "task-wishlist-ui",
    "tests/components/WishlistButton.test.tsx": "task-wishlist-ui",
    "src/api.ts": "task-checkout-stability",
    "src/cart.ts": "task-checkout-stability",
    "src/gateway.ts": "task-checkout-stability",
    "tests/cart.test.ts": "task-checkout-stability",
    "tests/api.test.ts": "task-checkout-stability"
  }
}
```
Notice the tasks are ordered by risk: `task-wishlist-ui` (low) is first, `task-checkout-stability` (high) is second.
