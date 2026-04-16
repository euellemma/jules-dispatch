import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";

export const dispatch_greenfield = createTool({
  description:
    "Start a greenfield project. Creates a planner session that will analyze the idea, produce a plan, and write tasks.json to the repo. Use this when the user wants to build something new from scratch.",
  inputSchema: z.object({
    repo: z.string().describe("GitHub repo in owner/repo format"),
    branch: z.string().default("main").describe("Base branch"),
    idea: z.string().describe("What the user wants to build"),
    autonomy: z
      .enum(["auto", "confirm", "strict"])
      .default("confirm")
      .describe("How much to ask before acting"),
  }),
  execute: async (ctx, args) => {
    if (!ctx.threadId) {
      throw new Error("Tool must be called within a thread context.");
    }
    if (!ctx.userId) {
      throw new Error("Tool must be called within a user context.");
    }

    try {
      const res = await ctx.runAction(internal.jules.dispatcher.dispatchPlannerSession, {
        threadId: ctx.threadId,
        userId: ctx.userId,
        repo: args.repo,
        branch: args.branch,
        input: args.idea,
        isGreenfield: true,
      });

      return `Successfully dispatched greenfield planner session.\nSession ID: ${res.sessionId}\nProject ID: ${res.projectId}`;
    } catch (error: any) {
      return `Failed to dispatch greenfield session: ${error.message || String(error)}`;
    }
  },
});

export const dispatch_iterative = createTool({
  description:
    "Dispatch work on an existing project. Can be a single task, a planning session for multiple tasks, or a research session. Use this for bug fixes, feature additions, or any changes to existing code.",
  inputSchema: z.object({
    repo: z.string().describe("GitHub repo in owner/repo format"),
    branch: z.string().default("main").describe("Base branch"),
    input: z.string().describe("What the user wants done"),
    mode: z
      .enum(["single", "planner", "research"])
      .default("single")
      .describe(
        "single: one implementation session, planner: plan first then dispatch multiple sessions, research: investigate codebase first"
      ),
    tasks: z
      .optional(
        z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            files: z.array(z.string()),
            new_files: z.array(z.string()),
            test_files: z.array(z.string()),
            risk: z.enum(["low", "medium", "high"]),
            prompt: z.string(),
          })
        )
      )
      .describe(
        "Pre-made tasks for parallel dispatch. Only use with planner mode after plan is ready."
      ),
    autonomy: z
      .enum(["auto", "confirm", "strict"])
      .default("confirm"),
  }),
  execute: async (ctx, args) => {
    if (!ctx.threadId) {
      throw new Error("Tool must be called within a thread context.");
    }
    if (!ctx.userId) {
      throw new Error("Tool must be called within a user context.");
    }

    try {
      if (args.mode === "single") {
        const res = await ctx.runAction(internal.jules.dispatcher.dispatchPlannerSession, {
          threadId: ctx.threadId,
          userId: ctx.userId,
          repo: args.repo,
          branch: args.branch,
          input: args.input,
          isGreenfield: false,
        });
        return `Successfully dispatched single implementation session.\nSession ID: ${res.sessionId}`;
      } else if (args.mode === "planner") {
        if (args.tasks && args.tasks.length > 0) {
          const res = await ctx.runAction(
            internal.jules.dispatcher.dispatchImplementationSessions,
            {
              threadId: ctx.threadId,
              userId: ctx.userId,
              repo: args.repo,
              branch: args.branch,
              tasks: args.tasks,
            }
          );
          return `Successfully dispatched implementation sessions.\nSession IDs: ${res.sessionIds.join(
            ", "
          )}\nConflicts (if any): ${JSON.stringify(res.conflicts)}`;
        } else {
          const res = await ctx.runAction(internal.jules.dispatcher.dispatchPlannerSession, {
            threadId: ctx.threadId,
            userId: ctx.userId,
            repo: args.repo,
            branch: args.branch,
            input: args.input,
            isGreenfield: false,
          });
          return `Successfully dispatched planner session.\nSession ID: ${res.sessionId}`;
        }
      } else if (args.mode === "research") {
        const res = await ctx.runAction(internal.jules.dispatcher.dispatchResearchSession, {
          threadId: ctx.threadId,
          userId: ctx.userId,
          repo: args.repo,
          branch: args.branch,
          researchQuestion: args.input,
        });
        return `Successfully dispatched research session.\nSession ID: ${res.sessionId}`;
      }

      return "Invalid mode selected.";
    } catch (error: any) {
      return `Failed to dispatch iterative session: ${error.message || String(error)}`;
    }
  },
});

export const merge_prs = createTool({
  description:
    "Sequentially merge open PRs from Jules sessions for a project. Updates branches from base, waits for CI, and squash-merges in risk order. Handles merge conflicts by reporting them.",
  inputSchema: z.object({
    repo: z.string().describe("GitHub repo in owner/repo format"),
    sessionIds: z.array(z.string()).describe("Jules session IDs whose PRs to merge"),
    branch: z.string().default("main").describe("Base branch to merge into"),
  }),
  execute: async (ctx, args) => {
    if (!ctx.threadId) {
      throw new Error("Tool must be called within a thread context.");
    }
    try {
      const res = await ctx.runAction(internal.jules.merger.sequentialMerge, {
        threadId: ctx.threadId,
        repo: args.repo,
        sessionIds: args.sessionIds,
        branch: args.branch,
      });

      if (!res.success) {
        if (res.conflictPr) {
          return `Merge conflict detected on PR #${res.conflictPr} (${res.conflictUrl}). Please resolve conflicts.`;
        }
        return `Merge process failed: ${res.error}`;
      }

      return `Successfully merged PRs: ${res.mergedPrs.join(", ")}\nConflicts: ${res.conflicts.length > 0 ? res.conflicts.join(", ") : "None"}`;
    } catch (error: any) {
      return `Failed to merge PRs: ${error.message || String(error)}`;
    }
  },
});
