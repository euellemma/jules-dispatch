# Case Study: E-Commerce App (Phase 3: Validate)

`fleet-dispatch.ts` begins. Before talking to the network to spawn agents, it runs the `validateOwnership()` function against the `issue_tasks.json` generated in Phase 2.

## The Execution

The script iterates through the tasks and builds the `claimed` Map:

1. **Processing `task-wishlist-ui`:**
   - Claims `components/WishlistButton.tsx`
   - Claims `tests/components/WishlistButton.test.tsx`
2. **Processing `task-checkout-stability`:**
   - Claims `src/api.ts`
   - Claims `src/cart.ts`
   - Claims `src/gateway.ts`
   - Claims `tests/cart.test.ts`
   - Claims `tests/api.test.ts`

## The Result

The script checks if any file was claimed twice. Because Jules successfully applied the coupling rule in Phase 2, the sets of files are mutually exclusive.

Validation passes.

```
✅ Ownership validated: 2 tasks, no conflicts.
```

*(If Jules had created separate tasks for #401 and #402, both would have claimed `src/api.ts`, and this script would have thrown a hard Error, aborting the pipeline before any expensive agents were spawned).*
