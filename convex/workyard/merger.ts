"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

const POLLING_INTERVAL_MS = 30 * 1000;
const DEFAULT_CI_TIMEOUT_MS = 10 * 60 * 1000;

async function waitForCI(
  ctx: any,
  threadId: string,
  owner: string,
  repoName: string,
  prNumber: number,
  maxWaitMs: number
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const code = `
      const toolsApi = await tools.discover({query: 'pull'});
      let getPrTool = null;
      let listCheckRunsTool = null;
      for (const t of toolsApi) {
        if (t.name.includes('get_pull_request') || (t.name.includes('pull') && t.name.includes('get'))) getPrTool = t.name;
        if (t.name.includes('check_runs') || t.name.includes('list_check_runs_for_commit')) listCheckRunsTool = t.name;
      }

      if (!listCheckRunsTool) {
        const checkToolsApi = await tools.discover({query: 'check'});
        for (const t of checkToolsApi) {
           if (t.name.includes('check_runs') || t.name.includes('list_check_runs')) listCheckRunsTool = t.name;
        }
      }

      if (!getPrTool || !listCheckRunsTool) {
        return { error: 'Required GitHub tools not found for CI polling' };
      }

      const pr = await tools[getPrTool]({owner: '${owner}', repo: '${repoName}', pull_number: ${prNumber}});
      if (!pr || !pr.head || !pr.head.sha) {
        return { error: 'Could not get PR head SHA' };
      }
      const headSha = pr.head.sha;

      const checks = await tools[listCheckRunsTool]({owner: '${owner}', repo: '${repoName}', ref: headSha});
      const check_runs = checks.check_runs || [];

      if (check_runs.length === 0) {
         return { complete: false, passed: false, waitingForCheckRunsToAppear: true };
      }

      const allComplete = check_runs.every((run: any) => run.status === "completed");
      const allPassed = check_runs.every((run: any) =>
        run.conclusion === "success" || run.conclusion === "skipped" || run.conclusion === "neutral"
      );

      return { complete: allComplete, passed: allPassed };
    `;

    const res = await ctx.runAction(internal.executor.action.execute, {
      userId: threadId,
      code,
    });

    if (res.result) {
      if (res.result.error) {
        console.error("Executor returned error during CI polling:", res.result.error);
        return false;
      }
      if (res.result.complete) {
        if (res.result.passed) {
          return true;
        } else {
          return false;
        }
      }
    } else if (res.error) {
      console.error("Executor execution error:", res.error);
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

    const project = await ctx.runQuery(internal.projects.db.getProjectByRepo, {
      repo: args.repo,
    });
    const maxWaitMs = project?.config?.ci_timeout_minutes
      ? project.config.ci_timeout_minutes * 60 * 1000
      : DEFAULT_CI_TIMEOUT_MS;

    const tasks = project?.tasks || [];

    const listPrsCode = `
      const toolsApi = await tools.discover({query: 'pull'});
      let listPrsTool = null;
      for (const t of toolsApi) {
        if (t.name.includes('list_pull_requests') || (t.name.includes('pull') && t.name.includes('list'))) {
           listPrsTool = t.name;
           break;
        }
      }
      if (!listPrsTool) {
        return { error: 'Required GitHub tool not found for listing PRs' };
      }

      const prs = await tools[listPrsTool]({owner: '${owner}', repo: '${repoName}', state: 'open'});
      return { prs: prs };
    `;

    const listPrsRes = await ctx.runAction(internal.executor.action.execute, {
      userId: args.threadId,
      code: listPrsCode,
    });

    if (listPrsRes.error) {
       return { success: false, error: listPrsRes.error };
    }
    if (listPrsRes.result?.error) {
       return { success: false, error: listPrsRes.result.error };
    }

    const allOpenPrs = listPrsRes.result?.prs || [];

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
    if (tasks.length > 0) {
      const riskOrder = { 'low': 1, 'medium': 2, 'high': 3 };
      const orderedSessionIds = args.sessionIds.slice().sort((a, b) => {
        const taskA = tasks.find((t: any) => t.id === a || t.sessionId === a);
        const taskB = tasks.find((t: any) => t.id === b || t.sessionId === b);
        const riskA = taskA ? (riskOrder[taskA.risk as keyof typeof riskOrder] || 2) : 2;
        const riskB = taskB ? (riskOrder[taskB.risk as keyof typeof riskOrder] || 2) : 2;
        return riskA - riskB;
      });
      for (const sessionId of orderedSessionIds) {
        if (prMap.has(sessionId)) {
           orderedPrs.push(prMap.get(sessionId));
        }
      }
    } else {
      for (const sessionId of args.sessionIds) {
        if (prMap.has(sessionId)) {
           orderedPrs.push(prMap.get(sessionId));
        }
      }
    }

    const mergedPrs: number[] = [];
    const conflicts: any[] = [];

    for (let i = 0; i < orderedPrs.length; i++) {
      const pr = orderedPrs[i];
      const prNumber = pr.number;

      if (i > 0) {
        const updateBranchCode = `
          const toolsApi = await tools.discover({query: 'pull'});
          let updateTool = null;
          for (const t of toolsApi) {
            if (t.name.includes('update_pull_request_branch') || (t.name.includes('update') && t.name.includes('branch'))) {
               updateTool = t.name;
               break;
            }
          }
          if (!updateTool) {
            return { error: 'Required GitHub tool not found for updating branch' };
          }

          try {
             const res = await tools[updateTool]({owner: '${owner}', repo: '${repoName}', pull_number: ${prNumber}, update_method: 'rebase'});
             return { success: true, res };
          } catch(e) {
             return { error: e.message || String(e), status: e.status };
          }
        `;

        const updateRes = await ctx.runAction(internal.executor.action.execute, {
          userId: args.threadId,
          code: updateBranchCode,
        });

        if (updateRes.result?.status === 422 || (updateRes.result?.error && updateRes.result.error.includes("422"))) {
           return { success: false, conflictPr: prNumber, conflictUrl: pr.html_url };
        } else if (updateRes.result?.error && !updateRes.result.error.includes("already up to date")) {
           return { success: false, error: `Branch update failed: ${updateRes.result.error}` };
        }

        await new Promise((r) => setTimeout(r, 5000));
      }

      const ciPassed = await waitForCI(ctx, args.threadId, owner, repoName, prNumber, maxWaitMs);
      if (!ciPassed) {
        return { success: false, error: `CI failed or timed out for PR #${prNumber}` };
      }

      const mergeCode = `
        const toolsApi = await tools.discover({query: 'pull'});
        let mergeTool = null;
        for (const t of toolsApi) {
          if (t.name.includes('merge_pull_request') || t.name === 'merge_pull') {
             mergeTool = t.name;
             break;
          }
        }
        if (!mergeTool) {
          return { error: 'Required GitHub tool not found for merging' };
        }

        try {
           const res = await tools[mergeTool]({owner: '${owner}', repo: '${repoName}', pull_number: ${prNumber}, merge_method: 'squash'});
           return { success: true, res };
        } catch(e) {
           return { error: e.message || String(e) };
        }
      `;

      const mergeRes = await ctx.runAction(internal.executor.action.execute, {
        userId: args.threadId,
        code: mergeCode,
      });

      if (mergeRes.result?.error) {
         return { success: false, error: `Failed to merge PR #${prNumber}: ${mergeRes.result.error}` };
      }

      mergedPrs.push(prNumber);
    }

    return { success: true, mergedPrs, conflicts };
  },
});
