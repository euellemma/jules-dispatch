"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getJulesClient } from "../tools/nodeActions";
import { extractFilesFromDiff } from "./extractors";
import type { ProcessedOutput, JulesApiSession } from "../types";
import type { GenericActionCtx } from "convex/server";

type ActionCtx = GenericActionCtx<any>;

// ============================================================================
// Activity summarization helpers
// ============================================================================

function summarizeActivity(act: any): string {
  if (act.type === "agentMessaged") return act.message || "";
  if (act.type === "planGenerated") {
    const plan = act.plan;
    let text = `Plan: "${plan?.title || "Untitled"}"`;
    plan?.steps?.forEach((s: any) => {
      text += `\n  ${s.index}. ${s.title}`;
    });
    return text;
  }
  if (act.type === "sessionCompleted") return "Session completed.";
  if (act.type === "sessionFailed") return "Session failed.";
  if (act.type === "planApproved") return "Plan approved.";
  if (act.type === "progressUpdated")
    return act.title || act.description || "progress update";
  return `${act.type}: ${act.title || act.description || ""}`;
}

function extractFilePathsFromActivity(artifacts: any[]): string[] {
  const paths: string[] = [];
  for (const art of artifacts) {
    if (art.changeSet?.gitPatch?.unidiffPatch) {
      paths.push(...extractFilesFromDiff(art.changeSet.gitPatch.unidiffPatch).map((f) => f.path));
    }
  }
  return paths;
}

// ============================================================================
// Main poll action
// ============================================================================

export const pollJulesActivities = internalAction({
  args: {},
  handler: async (ctx) => {
    const cronStartMs = Date.now();

    const sessions = await ctx.runQuery(
      internal.sessions.db.getDashboardSessions,
      {},
    );
    if (sessions.length === 0) return;

    let sessionMap: Map<string, JulesApiSession>;
    let jules: any;
    try {
      const telegramChatId = await ctx.runQuery(internal.users.db.getChatIdForThread, {
        threadId: sessions[0]!.threadId
      });
      jules = await getJulesClient(ctx);
      const allSessions = await jules.sessions({}).all();
      sessionMap = new Map(
        allSessions.map((s: JulesApiSession) => [s.id, s]),
      );
    } catch (error) {
      console.error(
        `[pollJulesActivities] sessions().all() failed — skipping this poll cycle:`,
        error,
      );
      return;
    }

    // Collect events that need handler spawning (per session)
    const sessionEvents = new Map<
      string,
      { triggeringActivities: any[]; currentState: string }
    >();

    for (const sessionDoc of sessions) {
      try {
        const julesSession = sessionMap.get(sessionDoc.julesSessionId);
        if (!julesSession) {
          console.warn(
            `[pollJulesActivities] Tracked session ${sessionDoc.julesSessionId} not found on Jules side — skipping`,
          );
          continue;
        }

        const currentState = julesSession.state || "unknown";

        let activitiesResult: Array<any> = [];
        try {
          const session = await jules.session(sessionDoc.julesSessionId);
          const cutoffTime = new Date(
            sessionDoc.lastProcessedActivityTime || 0,
          ).toISOString();
          const { activities } = await session.activities.list({
            filter: `create_time>"${cutoffTime}"`,
          });
          activitiesResult = activities;
        } catch (error) {
          console.error(
            `[pollJulesActivities] Activity fetch failed for ${sessionDoc.julesSessionId} — proceeding without new activities:`,
            error,
          );
        }

        let maxTime = sessionDoc.lastProcessedActivityTime || 0;
        const newActivities = activitiesResult.filter((act: any) => {
          return act.originator !== "user" || act.type === "planApproved";
        });

        const triggeringActivities: any[] = [];

        for (const act of newActivities) {
          const actTime = new Date(act.createTime).getTime();
          if (actTime > maxTime) maxTime = actTime;

          // Store ALL activities (including progressUpdated)
          const filesChanged =
            act.type === "progressUpdated" && act.artifacts
              ? extractFilePathsFromActivity(act.artifacts)
              : undefined;

          await ctx.runMutation(
            internal.sessions.activityStorage.storeActivity,
            {
              julesSessionId: sessionDoc.julesSessionId,
              type: act.type,
              createTime: actTime,
              summary: summarizeActivity(act),
              filesChanged,
            },
          );

          // Only non-progress events trigger the handler
          if (act.type !== "progressUpdated") {
            triggeringActivities.push(act);
          }

          // Existing output processing (unchanged)
          if (
            act.type === "progressUpdated" &&
            act.artifacts &&
            act.artifacts.length > 0
          ) {
            await processOutputs(
              ctx,
              sessionDoc.julesSessionId,
              act.artifacts,
              true,
              act.id,
            );
          } else if (act.type === "sessionCompleted") {
            let finalOutputs: any[] = [];
            try {
              const sessionClient = jules.session(
                sessionDoc.julesSessionId,
              );
              const fullSession = await sessionClient.info();
              finalOutputs =
                fullSession.outcome?.outputs || fullSession.outputs || [];
            } catch (fetchError) {
              console.error(
                `[pollJulesActivities] Failed to fetch session details for outputs: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
              );
            }

            await processOutputs(
              ctx,
              sessionDoc.julesSessionId,
              finalOutputs,
              false,
            );
          }
        }

        // Track triggering events for handler spawning
        if (triggeringActivities.length > 0) {
          sessionEvents.set(sessionDoc.julesSessionId, {
            triggeringActivities,
            currentState,
          });
        }

        // Update session state (for dashboard display, not for wake logic)
        await ctx.runMutation(internal.sessions.db.updateSessionState, {
          sessionId: sessionDoc._id,
          lastKnownState: currentState,
          lastProcessedActivityTime: maxTime,
        });
      } catch (error) {
        console.error(
          `[pollJulesActivities] Failed to process session ${sessionDoc.julesSessionId}:`,
          error,
        );
      }
    }

    // Spawn session event handlers for sessions with triggering activities
    for (const sessionDoc of sessions) {
      const event = sessionEvents.get(sessionDoc.julesSessionId);
      if (!event) continue;

      try {
        // Fetch ALL stored activities for this session
        const allActivities = await ctx.runQuery(
          internal.sessions.activityStorage.getActivitiesForSession,
          { julesSessionId: sessionDoc.julesSessionId },
        );

        // Fetch tasks from main thread
        const tasks = await ctx.runQuery(
          internal.tasks.listTasksForThread,
          { threadId: sessionDoc.threadId },
        );

        // Ensure task list exists for this session (lazy creation safety net)
        const sessionTaskKey = `session:${sessionDoc.julesSessionId}:tasks`;
        const hasTaskList = tasks.some((t: any) => t.key === sessionTaskKey);
        if (!hasTaskList && sessionDoc.threadId) {
          await ctx.runMutation(internal.tasks.upsertTasks, {
            threadId: sessionDoc.threadId,
            key: sessionTaskKey,
            content: "(auto-created — use update_task_list to set a plan)",
          });
        }

        await ctx.runAction(
          internal.sessions.sessionEventHandlerAgent.spawnHandler,
          {
            mainThreadId: sessionDoc.threadId,
            julesSessionId: sessionDoc.julesSessionId,
            shortName:
              sessionDoc.shortName ||
              sessionDoc.julesSessionId.slice(0, 8),
            repo: sessionDoc.repo,
            currentState: event.currentState,
            previousState: sessionDoc.lastKnownState,
            triggeringActivities: event.triggeringActivities,
            allActivities,
            tasks,
          },
        );
      } catch (error) {
        console.error(
          `[pollJulesActivities] Failed to spawn handler for ${sessionDoc.julesSessionId}:`,
          error,
        );
      }
    }


  },
});

// ============================================================================
// Output processing (unchanged from original)
// ============================================================================

async function processOutputs(
  ctx: ActionCtx,
  julesSessionId: string,
  outputs: Array<{
    type?: string;
    changeSet?: {
      source?: string;
      gitPatch?: {
        unidiffPatch: string;
        baseCommitId?: string;
      };
    };
    pullRequest?: {
      url: string;
      title: string;
      description?: string;
      baseRef?: string;
      headRef?: string;
    };
  }>,
  isIncremental: boolean,
  activityId?: string,
) {
  const processedOutputs: ProcessedOutput[] = [];

  for (const output of outputs) {
    if (output.changeSet) {
      const patch = output.changeSet.gitPatch?.unidiffPatch;
      const extractedFiles = patch
        ? extractFilesFromDiff(patch)
        : undefined;
      processedOutputs.push({
        type: "changeSet",
        source: output.changeSet.source,
        baseCommitId: output.changeSet.gitPatch?.baseCommitId,
        patch,
        extractedFiles,
        isIncremental,
        activityId,
      });
    } else if (output.pullRequest) {
      processedOutputs.push({
        type: "pullRequest",
        url: output.pullRequest.url,
        title: output.pullRequest.title,
        description: output.pullRequest.description,
        baseRef: output.pullRequest.baseRef,
        headRef: output.pullRequest.headRef,
        isIncremental,
        activityId,
      });
    } else {
      processedOutputs.push({
        type: "unknown",
        isIncremental,
        activityId,
      });
    }
  }

  if (processedOutputs.length > 0) {
    await ctx.runAction(
      internal.sessions.storageActions.saveSessionOutputs,
      {
        julesSessionId,
        outputs: processedOutputs,
      },
    );
  }
  return processedOutputs;
}
