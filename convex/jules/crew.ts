"use node";

import { internal } from "../_generated/api";
import { JulesSignal, readSignalFile, listFiles, getFileContent } from "./github";

function getGitHubHeaders(): Record<string, string> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
import { validateOwnership, checkImplicitCoupling, mergeConflictingTasks, Task } from "./ownershipValidator";

// @ts-ignore
import { plannerPrompt } from "./roles/planner";
// @ts-ignore
import { builderPrompt } from "./roles/builder";
// @ts-ignore
import { debuggerPrompt } from "./roles/debugger";
// @ts-ignore
import { mergerPrompt } from "./roles/merger";

export interface DetermineNextRoleParams {
  repoOwner: string;
  repoName: string;
  branch: string;
  userMessage?: string;
}

export interface RoleDecision {
  role: "planner" | "builder" | "debugger" | "merger";
  scope: "greenfield" | "iterative-new" | "iterative-small" | "iterative-complex" | "iterative" | string;
  reason: string;
  signalData?: JulesSignal;
  tasksData?: any;
  planData?: string;
}

/**
 * Determines the next role to activate based on repo state.
 * @param params The parameters for role determination.
 * @returns The next role decision.
 */
export async function determineNextRole(params: DetermineNextRoleParams): Promise<RoleDecision> {
  const { repoOwner, repoName, branch, userMessage } = params;

  const files = await listFiles(repoOwner, repoName, ".jules-dispatch", branch);
  if (files.length === 0) {
    return { role: "planner", scope: "greenfield", reason: "No existing project state" };
  }

  const signal = await readSignalFile(repoOwner, repoName, branch);

  let tasksData: any = undefined;
  const tasksFile = await getFileContent(repoOwner, repoName, ".jules-dispatch/tasks.json", branch);
  if (tasksFile) {
      try {
          tasksData = JSON.parse(tasksFile.content);
      } catch (e) {
              }
  }

  let planData: string | undefined = undefined;
  const planFile = await getFileContent(repoOwner, repoName, ".jules-dispatch/plan.md", branch);
  if (planFile) {
      planData = planFile.content;
  }

  if (!userMessage && signal && signal.nextRole) {
      const validRoles = ["planner", "builder", "debugger", "merger"];
      if (validRoles.includes(signal.nextRole)) {
          return {
              role: signal.nextRole as any,
              scope: "iterative-new",
              reason: "Signal indicated next role",
              signalData: signal,
              tasksData,
              planData,
          };
      }
  }

  if (tasksData && Array.isArray(tasksData) && tasksData.length > 0) {
      return {
          role: "builder",
          scope: "iterative",
          reason: "Tasks exist",
          signalData: signal || undefined,
          tasksData,
          planData,
      };
  }

  try {
      const allOpenPrsResp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls?state=open&per_page=100`, {
        headers: {
          ...getGitHubHeaders(),
          "Content-Type": "application/json",
        },
      });
      let allOpenPrs: any = null;
      if (allOpenPrsResp.ok && allOpenPrsResp.status !== 204) {
        allOpenPrs = await allOpenPrsResp.json();
      }
      if (allOpenPrs && allOpenPrs.length > 0) {
          return {
              role: "merger",
              scope: "iterative",
              reason: "Open PRs exist and no pending tasks",
              signalData: signal || undefined,
              tasksData,
              planData,
          };
      }
  } catch (error) {
      }

  return { role: "planner", scope: "iterative-new", reason: "Default role" };
}

export interface BuildSessionPromptParams {
  role: "planner" | "builder" | "debugger" | "merger";
  scope: string;
  reason: string;
  userMessage?: string;
  repo: string;
  branch: string;
  taskIndex?: number;
  signalData?: JulesSignal;
  tasksData?: any;
  planData?: string;
  memoryData?: string;
}

/**
 * Builds the complete prompt for a Jules session based on the role decision.
 * @param params The parameters for prompt building.
 * @returns The constructed prompt string.
 */
export function buildSessionPrompt(params: BuildSessionPromptParams): string {
  const { role } = params;

  if (role === "planner") {
    return typeof plannerPrompt !== 'undefined' ? plannerPrompt(params) : "Fallback planner prompt";
  } else if (role === "builder") {
    return typeof builderPrompt !== 'undefined' ? builderPrompt(params) : "Fallback builder prompt";
  } else if (role === "debugger") {
    return typeof debuggerPrompt !== 'undefined' ? debuggerPrompt(params) : "Fallback debugger prompt";
  } else if (role === "merger") {
    return typeof mergerPrompt !== 'undefined' ? mergerPrompt(params) : "Fallback merger prompt";
  }

  return "Fallback prompt";
}

export interface OrchestrateJulesParams {
  ctx: any;
  threadId: string;
  userId: string;
  repo: string;
  branch: string;
  input: string;
  signalOverride?: JulesSignal;
}

export interface OrchestrateResult {
  sessionId: string;
  role: string;
  scope: string;
  reason: string;
}

/**
 * The main entry point to orchestrate a Jules session.
 * @param params The parameters for orchestration.
 * @returns The orchestration result including session ID and role info.
 */
export async function orchestrateJules(params: OrchestrateJulesParams): Promise<OrchestrateResult> {
  const { ctx, threadId, userId, repo, branch, input, signalOverride } = params;

  const parts = repo.split("/");
  if (parts.length !== 2) {
      throw new Error("Invalid repo format. Expected owner/repo");
  }
  const [repoOwner, repoName] = parts;

  const roleDecision = await determineNextRole({
      repoOwner,
      repoName,
      branch,
      userMessage: input,
  });

  const prompt = buildSessionPrompt({
      role: roleDecision.role,
      scope: roleDecision.scope,
      reason: roleDecision.reason,
      userMessage: input,
      repo,
      branch,
      signalData: signalOverride || roleDecision.signalData,
      tasksData: roleDecision.tasksData,
      planData: roleDecision.planData,
  });

  const sessionRes = await ctx.runAction(internal.sessions.actions.createSession, {
      threadId,
      prompt,
      title: `${roleDecision.role} Session`,
      githubRepo: repo,
      baseBranch: branch,
      requireApproval: false,
      autoPr: true,
  });

  if (!sessionRes.success || !sessionRes.id) {
      throw new Error(`Failed to create session: ${sessionRes.error}`);
  }

  const anyCtx = ctx as any;
  await anyCtx.runMutation(internal.sessions.db?.incrementSessionBudget ?? "placeholder", { threadId }).catch(() => {});


  return {
      sessionId: sessionRes.id,
      role: roleDecision.role,
      scope: roleDecision.scope,
      reason: roleDecision.reason
  };
}

export interface ValidateParallelParams {
    tasks: Task[];
}

export interface ValidationResult {
    tasks: Task[];
    conflicts: any[];
}

/**
 * Runs ownership validation before dispatching parallel builder sessions.
 * @param params The parameters containing tasks to validate.
 * @returns The validated and potentially merged tasks along with any conflicts.
 */
export function validateParallelDispatch(params: ValidateParallelParams): ValidationResult {
  const ownershipConflicts = validateOwnership(params.tasks);
  let tasks = params.tasks;
  if (ownershipConflicts.length > 0) {
    tasks = mergeConflictingTasks(tasks, ownershipConflicts);
  }

  const couplingConflicts = checkImplicitCoupling(tasks);
  if (couplingConflicts.length > 0) {
    tasks = mergeConflictingTasks(tasks, couplingConflicts);
  }
  return { tasks, conflicts: [...ownershipConflicts, ...couplingConflicts] };
}

export interface OrchestrateMergeParams {
    threadId: string;
    repo: string;
    sessionIds: string[];
    branch: string;
    ctx: any;
}

export interface MergeResult {
    success: boolean;
    mergedPrs?: number[];
    conflicts?: any[];
    error?: string;
    conflictPr?: number;
    conflictUrl?: string;
}

/**
 * Wrap the existing merger.ts sequentialMerge as an orchestrate_jules flow step.
 * @param params The parameters for merging.
 * @returns The result of the sequential merge operation.
 */
export async function orchestrateMerge(params: OrchestrateMergeParams): Promise<MergeResult> {
  const res = await params.ctx.runAction(internal.jules.merger.sequentialMerge, {
    threadId: params.threadId,
    repo: params.repo,
    sessionIds: params.sessionIds,
    branch: params.branch,
  });
  return res;
}
