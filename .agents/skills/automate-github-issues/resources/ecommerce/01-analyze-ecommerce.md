# Case Study: E-Commerce App (Phase 1: Analyze)

In this case study, we walk through a simulated e-commerce application (`my-org/shop-app`) experiencing a mix of frontend and backend issues.

## The Scenario: Open Issues

The GitHub Action cron job triggers at 6:00 AM UTC. `fleet-analyze.ts` queries the GitHub API. The ETag cache returns a 200 OK because three new issues were filed overnight.

### Issue Data Fetched (Raw JSON abstract)
1. **Issue #401**: "Cart checkout crashes with 500 when inventory is depleted during payment processing." (Label: `backend`, `p0`)
2. **Issue #402**: "API Gateway throws RateLimitExceeded on the `/checkout` route during flash sales." (Label: `backend`, `performance`)
3. **Issue #403**: "The 'Add to Wishlist' button disappears entirely on Mobile Safari." (Label: `frontend`, `ui`)

## The Output (Markdown formatting)

`fleet-analyze.ts` converts this JSON into the optimized markdown string:

```markdown
# Open Issues — my-org/shop-app

> 3 issues fetched on 2023-10-27T06:00:00.000Z

---
## #401: Cart checkout crashes with 500 when inventory is depleted
🔗 https://github.com/my-org/shop-app/issues/401

| Field | Value |
|-------|-------|
| **Author** | ops-team |
| **State** | open |
| **Labels** | `backend`, `p0` |

### Description
Stack trace shows `InventoryExhaustedError` bubbling up to the top level express handler in `src/cart.ts` because it's not caught during the `processPayment` flow.

---
## #402: API Gateway throws RateLimitExceeded on /checkout
🔗 https://github.com/my-org/shop-app/issues/402

| Field | Value |
|-------|-------|
| **Author** | ops-team |
| **State** | open |
| **Labels** | `backend`, `performance` |

### Description
During the flash sale, the checkout gateway in `src/gateway.ts` hits Redis too hard. The rate limiter is currently configured globally, it needs a specific bypass or higher threshold for the `/checkout` route defined in `src/api.ts`.

---
## #403: Add to Wishlist button disappears on Mobile Safari
🔗 https://github.com/my-org/shop-app/issues/403

| Field | Value |
|-------|-------|
| **Author** | qa-tester |
| **State** | open |
| **Labels** | `frontend`, `ui` |

### Description
The CSS media query in `components/WishlistButton.tsx` hides the element on viewports < 400px due to a `display: none` intended for a legacy layout.
---
```

This markdown string is captured and held in memory to be passed to Phase 2.
