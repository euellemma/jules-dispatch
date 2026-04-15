# Case Study: E-Commerce App (Phase 5: Merge)

A human developer sees PR #501 and PR #502, briefly reviews them, and clicks "Run Workflow" on the `fleet-merge.yml` action to safely merge them.

## The Sequential Merge Process

`fleet-merge.ts` loads the PRs and processes them in risk-order: `task-wishlist-ui` (Low risk) first, then `task-checkout-stability` (High risk).

### Step 1: Processing `task-wishlist-ui` (PR #501)
1. **Update Branch:** Skipped (it's the first task, `main` hasn't changed).
2. **Wait for CI:** Polling GitHub checks... tests pass.
3. **Merge:** GitHub API call to squash merge PR #501 into `main`.
4. **Result:** Success.

### Step 2: Processing `task-checkout-stability` (PR #502)
1. **Update Branch:** The script calls the GitHub API to update PR #502 from `main`. (This is necessary because `main` now contains the Wishlist UI code. While they don't share files, rebasing ensures a clean git history). The API returns 200 OK.
2. **Wait for CI:** Polling GitHub checks...

---

## The Edge Case: A CI Failure

While PR #502 is running CI, a test fails.

**The test that failed:** `tests/inventory-sync.test.ts`
**Why it failed:** Jules Agent 2 changed the signature of `InventoryExhaustedError` in `src/cart.ts` to include a `productId` property. However, `tests/inventory-sync.test.ts` asserts the old shape of the error.

### Why didn't Agent 2 fix the test?
Because of the **File Boundary Rule** enforced in Phase 2! `tests/inventory-sync.test.ts` was *not* in Agent 2's `test_files` list in the JSON. The prompt explicitly forbade the agent from modifying it:
> "If a test file outside your boundary fails, you must make your source changes backward-compatible... Do NOT modify files outside your boundary."

Agent 2 failed to make the change backward compatible.

## The Abort

`fleet-merge.ts` detects the failed CI check:

```
  🧪 Waiting for CI checks...
  ❌ CI failed for PR #502. Skipping.
```

The script exits with code 1.

### Why this is the correct behavior

This is the system working exactly as designed. The Fleet pipeline is heavily defensive. It assumes LLMs make mistakes. By enforcing strict file boundaries, we prevented Agent 2 from "hallucinating" a fix to a test it didn't understand. By gating the merge on CI, we prevented Agent 2 from breaking `main`.

A human developer is now alerted to look at PR #502, fix the backward compatibility of the error signature, and merge it manually.
