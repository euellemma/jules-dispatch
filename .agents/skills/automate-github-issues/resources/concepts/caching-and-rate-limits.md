# Concept: Caching & GitHub API Rate Limits

When automating interactions with GitHub, API rate limits are a critical bottleneck. Standard GitHub tokens typically allow 1,000 to 5,000 requests per hour. For a repository with many issues, polling the API repeatedly can quickly exhaust this quota.

## The ETag Solution

GitHub supports conditional requests via the `ETag` and `If-None-Match` headers. When you request a resource (like a list of issues), GitHub returns an `ETag` header (a hash of the resource's state). On subsequent requests, you send this `ETag` back in the `If-None-Match` header.

If the issues haven't changed, GitHub returns a `304 Not Modified` response with an empty body.

**Crucially, `304 Not Modified` responses do not count against your API rate limit.**

## Implementation in Fleet

Fleet implements this using an Octokit plugin (`scripts/github/cache-plugin.ts` and `scripts/github/issues.ts`).

```typescript
// scripts/github/issues.ts
import { Octokit } from "octokit";
import { cachePlugin } from "./cache-plugin.js";

// We create a specialized Octokit client that intercepts requests
export const CachedOctokit = Octokit.plugin(cachePlugin) as typeof Octokit;

export async function getIssues() {
  const octokit = new CachedOctokit({ auth: process.env.GITHUB_TOKEN });
  // This call goes through the cache plugin
  const { data } = await octokit.rest.issues.listForRepo({ ... });
  return data;
}
```

### How the Cache Plugin Works

While the exact implementation of `cache-plugin.ts` varies, the pattern is:

1. **Intercept Request:** Before making the HTTP call to `api.github.com/repos/.../issues`, check a local cache directory for an existing ETag for this URL.
2. **Inject Header:** If found, add `If-None-Match: "W/...""` to the request headers.
3. **Handle Response:**
   * If GitHub returns `200 OK`: The issues changed. Read the body, save the new body and the new `ETag` to the local cache directory, and return the data.
   * If GitHub returns `304 Not Modified`: The issues are identical. Read the saved body from the local cache directory and return it as if GitHub had sent it.

### Impact on the Pipeline

In `fleet-analyze.ts` (Phase 1), which might run on a scheduled cron job (e.g., every hour), 95% of the time no new issues have been opened. The ETag cache ensures that 95% of these cron runs cost exactly **0 API requests** against the rate limit, making the Fleet pipeline highly resilient and sustainable in production environments.
