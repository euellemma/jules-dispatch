"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

const POLLING_INTERVAL_MS = 30 * 1000;
const DEFAULT_CI_TIMEOUT_MS = 10 * 60 * 1000;

function getGitHubHeaders(): Record<string, string> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set in environment");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getGitHubHeaders(),
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function waitForCI(
  owner: string,
  repoName: string,
  prNumber: number,
  maxWaitMs: number
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const pr = await githubFetch(`/repos/${owner}/${repoName}/pulls/${prNumber}`);
      if (!pr || !pr.head || !pr.head.sha) {
        throw new Error('Could not get PR head SHA');
      }
      const headSha = pr.head.sha;

      const checks = await githubFetch(`/repos/${owner}/${repoName}/commits/${headSha}/check-runs`);
      const check_runs = checks.check_runs || [];

      if (check_runs.length === 0) {
        // Still waiting for check runs to appear
      } else {
        const allComplete = check_runs.every((run: any) => run.status === "completed");
        const allPassed = check_runs.every((run: any) =>
          run.conclusion === "success" || run.conclusion === "skipped" || run.conclusion === "neutral"
        );

        if (allComplete) {
          if (allPassed) {
            return true;
          } else {
            return false;
          }
        }
      }
    } catch (error) {
      console.error("Error during CI polling:", error);
      return false;
    }

    await new Promise((r) => setTimeout(r, POLLING_INTERVAL_MS));
  }

  return false;
}

export const sequentialMerge = internalAction({
  args: {
    threadId: v.string(),
    repo: v.string(),
    sessionIds: v.array(v.string()),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const parts = args.repo.split("/");
    if (parts.length !== 2) {
      return { success: false, error: "Invalid repo format. Expected owner/repo" };
    }
    const owner = parts[0];
    const repoName = parts[1];

    const maxWaitMs = DEFAULT_CI_TIMEOUT_MS;

    let allOpenPrs: any[] = [];
    try {
      allOpenPrs = await githubFetch(`/repos/${owner}/${repoName}/pulls?state=open&per_page=100`);
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }

    const prMap = new Map<string, any>();
    for (const sessionId of args.sessionIds) {
      const matchingPR = allOpenPrs.find((pr: any) =>
        (pr.head && pr.head.ref && pr.head.ref.includes(sessionId)) ||
        (pr.body && pr.body.includes(sessionId))
      );
      if (matchingPR) {
        prMap.set(sessionId, matchingPR);
      }
    }

    let orderedPrs: any[] = [];
    for (const sessionId of args.sessionIds) {
      if (prMap.has(sessionId)) {
          orderedPrs.push(prMap.get(sessionId));
      }
    }

    const mergedPrs: number[] = [];
    const conflicts: any[] = [];

    for (let i = 0; i < orderedPrs.length; i++) {
      const pr = orderedPrs[i];
      const prNumber = pr.number;

      if (i > 0) {
        try {
          await githubFetch(`/repos/${owner}/${repoName}/pulls/${prNumber}/update-branch`, {
            method: 'PUT',
            body: JSON.stringify({ update_method: 'merge' })
          });
        } catch (error: any) {
          if (error.message && error.message.includes("422")) {
            return { success: false, conflictPr: prNumber, conflictUrl: pr.html_url };
          } else if (error.message && !error.message.includes("already up to date")) {
            return { success: false, error: `Branch update failed: ${error.message}` };
          }
        }

        await new Promise((r) => setTimeout(r, 5000));
      }

      const ciPassed = await waitForCI(owner, repoName, prNumber, maxWaitMs);
      if (!ciPassed) {
        return { success: false, error: `CI failed or timed out for PR #${prNumber}` };
      }

      try {
        await githubFetch(`/repos/${owner}/${repoName}/pulls/${prNumber}/merge`, {
          method: 'PUT',
          body: JSON.stringify({ merge_method: 'squash' })
        });
      } catch (error: any) {
        return { success: false, error: `Failed to merge PR #${prNumber}: ${error.message || String(error)}` };
      }

      mergedPrs.push(prNumber);
    }

    return { success: true, mergedPrs, conflicts };
  },
});
