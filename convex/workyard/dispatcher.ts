"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  planSessionPrompt,
  implementSessionPrompt,
  researchSessionPrompt,
  correctSessionPrompt,
} from "./promptBuilder";
import { validateOwnership, checkImplicitCoupling, mergeConflictingTasks } from "./ownershipValidator";

export const dispatchPlannerSession = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    repo: v.string(),
    branch: v.string(),
    input: v.string(),
    isGreenfield: v.boolean(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(internal.projects.db.getProjectByRepo, {
      repo: args.repo,
    });

    let memory = "";
    if (project && project.memoryEntries) {
      memory = project.memoryEntries
        .map((e) => `[${e.date} Iteration ${e.iteration}] ${e.type}: ${e.learning}`)
        .join("\n");
    }

    const plan = project?.plan || "";

    const prompt = planSessionPrompt({
      repo: args.repo,
      branch: args.branch,
      input: args.input,
      memory,
      plan,
      isGreenfield: args.isGreenfield,
    });

    const sessionRes = await ctx.runAction(internal.sessions.actions.createSession, {
      threadId: args.threadId,
      prompt,
      title: args.isGreenfield ? "Greenfield Planning" : "Iterative Planning",
      githubRepo: args.repo,
      baseBranch: args.branch,
      requireApproval: false,
      autoPr: true,
    });

    if (!sessionRes.success || !sessionRes.id) {
      throw new Error(`Failed to create planner session: ${sessionRes.error}`);
    }

    let projectId;
    if (!project) {
      projectId = await ctx.runMutation(internal.projects.db.initProject, {
        threadId: args.threadId,
        repo: args.repo,
      });
    } else {
      projectId = project._id;
    }

    await ctx.runMutation(internal.projects.db.updateSessionBudget, {
      projectId,
      delta: 1,
    });

    return { sessionId: sessionRes.id, projectId };
  },
});

export const dispatchImplementationSessions = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    repo: v.string(),
    branch: v.string(),
    tasks: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        files: v.array(v.string()),
        new_files: v.array(v.string()),
        test_files: v.array(v.string()),
        risk: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
        prompt: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let tasksToDispatch = args.tasks;

    const ownershipConflicts = validateOwnership(tasksToDispatch);
    if (ownershipConflicts.length > 0) {
      tasksToDispatch = mergeConflictingTasks(tasksToDispatch, ownershipConflicts);
    }

    const couplingConflicts = checkImplicitCoupling(tasksToDispatch);
    if (couplingConflicts.length > 0) {
      tasksToDispatch = mergeConflictingTasks(tasksToDispatch, couplingConflicts);
    }

    const project = await ctx.runQuery(internal.projects.db.getProjectByRepo, {
      repo: args.repo,
    });
    const maxParallel = project?.config?.max_parallel_sessions ?? 5;
    const requireApproval = project?.config?.require_plan_approval ?? false;

    let memory = "";
    if (project && project.memoryEntries) {
      memory = project.memoryEntries
        .map((e) => `[${e.date} Iteration ${e.iteration}] ${e.type}: ${e.learning}`)
        .join("\n");
    }

    const sessionIds: string[] = [];
    const dispatchLimit = Math.min(tasksToDispatch.length, maxParallel);

    for (let i = 0; i < dispatchLimit; i++) {
      const task = tasksToDispatch[i];
      const fileBoundary = [...task.files, ...task.new_files, ...task.test_files].join("\n");

      const prompt = implementSessionPrompt({
        repo: args.repo,
        task: task.prompt,
        memory,
        fileBoundary,
        acceptanceCriteria: "- Code compiles\n- Tests pass",
      });

      const sessionRes = await ctx.runAction(internal.sessions.actions.createSession, {
        threadId: args.threadId,
        prompt,
        title: task.title || `Task: ${task.id}`,
        githubRepo: args.repo,
        baseBranch: args.branch,
        requireApproval,
        autoPr: true,
      });

      if (sessionRes.success && sessionRes.id) {
        sessionIds.push(sessionRes.id);
      }
    }

    if (project && sessionIds.length > 0) {
      await ctx.runMutation(internal.projects.db.updateSessionBudget, {
        projectId: project._id,
        delta: sessionIds.length,
      });
    }

    return {
      sessionIds,
      conflicts: [...ownershipConflicts, ...couplingConflicts],
    };
  },
});

export const dispatchResearchSession = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    repo: v.string(),
    branch: v.string(),
    researchQuestion: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(internal.projects.db.getProjectByRepo, {
      repo: args.repo,
    });

    let memory = "";
    if (project && project.memoryEntries) {
      memory = project.memoryEntries
        .map((e) => `[${e.date} Iteration ${e.iteration}] ${e.type}: ${e.learning}`)
        .join("\n");
    }

    const prompt = researchSessionPrompt({
      repo: args.repo,
      researchQuestion: args.researchQuestion,
      memory,
    });

    const sessionRes = await ctx.runAction(internal.sessions.actions.createSession, {
      threadId: args.threadId,
      prompt,
      title: "Research Session",
      githubRepo: args.repo,
      baseBranch: args.branch,
      requireApproval: false,
      autoPr: false,
    });

    if (!sessionRes.success || !sessionRes.id) {
      throw new Error(`Failed to create research session: ${sessionRes.error}`);
    }

    if (project) {
      await ctx.runMutation(internal.projects.db.updateSessionBudget, {
        projectId: project._id,
        delta: 1,
      });
    }

    return { sessionId: sessionRes.id };
  },
});

export const dispatchCorrection = internalAction({
  args: {
    threadId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    type: v.union(
      v.literal("test_failure"),
      v.literal("course_correction"),
      v.literal("continuation"),
      v.literal("conflict_resolution"),
      v.literal("nudge")
    ),
    params: v.any(),
  },
  handler: async (ctx, args) => {
    const prompt = correctSessionPrompt({
      type: args.type,
      ...args.params,
    });

    const res = await ctx.runAction(internal.sessions.actions.sendMessage, {
      sessionId: args.sessionId,
      prompt,
    });

    if (!res.success) {
      throw new Error(`Failed to send correction message: ${res.error}`);
    }

    return { success: true };
  },
});
