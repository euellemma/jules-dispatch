# Phase 1: Analyze (`fleet-analyze.ts`)

The **Analyze** phase serves as the data collection layer for the Fleet pipeline. It fetches the current state of the repository's open issues directly from GitHub and transforms them into a structured Markdown document. This Markdown string acts as the raw material for the Jules planner agent in Phase 2.

## Code Execution Path

1. The phase is typically triggered by a scheduled GitHub Action or run locally via `bun run scripts/fleet/fleet-analyze.ts`.
2. `fleet-analyze.ts` imports and calls `getIssuesAsMarkdown()` from `github/markdown.ts`.
3. `getIssuesAsMarkdown()` delegates the raw data fetching to `getIssues()` in `github/issues.ts`.

### The Fetching Logic (`github/issues.ts`)

To prevent API rate limiting, `getIssues` uses a cached Octokit instance:

```typescript
// scripts/github/issues.ts
export const CachedOctokit = Octokit.plugin(cachePlugin) as typeof Octokit;

export async function getIssues(options?: { perPage?: number; state?: "open" | "closed" | "all" }) {
  const repoInfo = await getGitRepoInfo();
  const octokit = new CachedOctokit({ auth: process.env.GITHUB_TOKEN });

  const { data } = await octokit.rest.issues.listForRepo({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    state: options?.state ?? "open",
    per_page: options?.perPage ?? 30,
  });

  // Exclude PRs - we only want actionable user/system issues
  return data.filter((issue) => !issue.pull_request);
}
```

### The Formatting Logic (`github/markdown.ts`)

Once the raw JSON issues are retrieved, they are transformed into a dense, token-efficient Markdown format designed specifically for LLM consumption.

```typescript
// scripts/github/markdown.ts (Snippet)
function toIssueMarkdown(issue: Issue): string {
  const lines = [
    `## #${issue.number}: ${issue.title}`,
    ``,
    `🔗 ${issue.html_url}`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Author** | ${issue.user?.login ?? "unknown"} |`,
    `| **State** | ${issue.state} |`,
    `| **Created** | ${issue.created_at} |`,
  ];

  // Optional fields are appended conditionally to save tokens
  if (labels.length) lines.push(`| **Labels** | ${labels.map(l => `\`${l}\``).join(", ")} |`);
  if (issue.body) lines.push(`### Description`, ``, issue.body.trim(), ``);

  return lines.join("\n");
}
```

## Inputs
* **GitHub Repository State:** The live set of open issues for the configured repository.
* **Environment Variables:** `GITHUB_TOKEN` (provided automatically by Actions).

## Outputs
* **`issuesMarkdown` (String):** A massive string containing the structured markdown of all actionable issues.

**Example Output:**
```markdown
# Open Issues — my-org/my-repo

> 12 issues fetched on 2023-10-27T10:00:00.000Z

---
## #101: Cart crashes on checkout
🔗 https://github.com/my-org/my-repo/issues/101

| Field | Value |
|-------|-------|
| **Author** | user123 |
| **State** | open |
| **Labels** | `bug`, `p1` |

### Description
When an item goes out of stock exactly as I click checkout, the app throws a 500.
---
```

## Context Sent to Jules
In this phase, Jules is **not directly invoked**. This phase operates purely on standard Node/Bun HTTP APIs. The output of this script is injected into Jules in Phase 2.
