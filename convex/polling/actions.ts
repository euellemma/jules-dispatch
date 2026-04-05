"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { julesAgent, resolveLanguageModel } from "../agent/instance";
import { getJulesClient } from "../tools/nodeActions";
import type { ProcessedOutput, JulesApiSession } from "../types";
import type { GenericActionCtx } from "convex/server";

type ActionCtx = GenericActionCtx<any>;

export const pollJulesActivities = internalAction({
  args: {},
  handler: async (ctx) => {
    const cronStartMs = Date.now();

    const sessions = await ctx.runQuery(internal.sessions.db.getDashboardSessions, {});
    if (sessions.length === 0) return;

    let sessionMap: Map<string, JulesApiSession>;
    let jules: any;
    try {
      jules = await getJulesClient(ctx, sessions[0]!.threadId);
      const allSessions = await jules.sessions({}).all();
      sessionMap = new Map(allSessions.map((s: JulesApiSession) => [s.id, s]));
    } catch (error) {
      console.error(`[pollJulesActivities] sessions().all() failed — skipping this poll cycle:`, error);
      return;
    }

    const threadIds = [...new Set(sessions.map(s => s.threadId))];
    const modelCache = new Map<string, any>();
    for (const tid of threadIds) {
      try {
        modelCache.set(tid, await resolveLanguageModel(ctx, tid));
      } catch (error) {
        console.error(`[pollJulesActivities] Model resolution failed for thread ${tid} — will skip agent wake for this thread:`, error);
      }
    }

    // Accumulate poll messages per thread
    const pollMessages = new Map<string, string[]>();
    const needsWake = new Set<string>();

    for (const sessionDoc of sessions) {
      try {
        const julesSession = sessionMap.get(sessionDoc.julesSessionId);
        if (!julesSession) {
          console.warn(`[pollJulesActivities] Tracked session ${sessionDoc.julesSessionId} not found on Jules side — skipping`);
          continue;
        }

        const currentState = julesSession.state || "unknown";
        const shortName = sessionDoc.shortName || sessionDoc.julesSessionId.slice(0, 8);

        let activitiesResult: Array<any> = [];
        try {
          const session = await jules.session(sessionDoc.julesSessionId);
          const cutoffTime = new Date(sessionDoc.lastProcessedActivityTime || 0).toISOString();
          const { activities } = await session.activities.list({
            filter: `create_time>"${cutoffTime}"`,
          });
          activitiesResult = activities;
        } catch (error) {
          console.error(`[pollJulesActivities] Activity fetch failed for ${sessionDoc.julesSessionId} — proceeding without new activities:`, error);
        }

        let maxTime = sessionDoc.lastProcessedActivityTime || 0;
        const newActivities = activitiesResult.filter((act: any) => {
          return act.originator !== 'user' || act.type === 'planApproved';
        });

        const sessionParts: string[] = [];

        for (const act of newActivities) {
          const actTime = new Date(act.createTime).getTime();
          if (actTime > maxTime) maxTime = actTime;

          if (act.type === 'progressUpdated') {
            // Silent — only process files, no message text
            if (act.artifacts && act.artifacts.length > 0) {
              await processOutputs(ctx, sessionDoc.julesSessionId, act.artifacts, true, act.id);
            }
          } else if (act.type === 'agentMessaged') {
            sessionParts.push(`Jules: ${act.message}`);
            needsWake.add(sessionDoc.threadId);
          } else if (act.type === 'planGenerated' && act.plan) {
            const plan = act.plan as any;
            let planText = `Plan: "${plan.title ?? 'Untitled'}"`;
            if (plan.description) {
              planText += `\n   ${plan.description}`;
            }
            plan.steps?.forEach((step: { index: number; title?: string }) => {
              planText += `\n   ${step.index}. ${step.title ?? 'Untitled'}`;
            });
            sessionParts.push(planText);
            needsWake.add(sessionDoc.threadId);
          } else if (act.type === 'sessionCompleted') {
            // Fetch full session outputs
            let finalOutputs: any[] = [];
            try {
              const sessionClient = await jules.session(sessionDoc.julesSessionId);
              const fullSession = await sessionClient.info();
              finalOutputs = fullSession.outcome?.outputs || fullSession.outputs || [];
            } catch (fetchError) {
              console.error(`[pollJulesActivities] Failed to fetch session details for outputs: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
            }

            const processed = await processOutputs(ctx, sessionDoc.julesSessionId, finalOutputs, false);

            let completionText = `Completed.`;
            if (processed && processed.length > 0) {
              for (const out of processed) {
                if (out.type === 'changeSet' && out.extractedFiles) {
                  completionText += ` ${out.extractedFiles.length} file(s) changed.`;
                } else if (out.type === 'pullRequest') {
                  completionText += ` PR: ${out.url}`;
                }
              }
            }
            sessionParts.push(completionText);
            needsWake.add(sessionDoc.threadId);
          } else if (act.type === 'sessionFailed') {
            sessionParts.push(`Failed.`);
            needsWake.add(sessionDoc.threadId);
          }
        }

        // Build session block for this session's activities
        if (sessionParts.length > 0) {
          const block = `[${shortName}]\n${sessionParts.map(p => `  ${p}`).join('\n')}`;
          const threadMsgs = pollMessages.get(sessionDoc.threadId) || [];
          threadMsgs.push(block);
          pollMessages.set(sessionDoc.threadId, threadMsgs);
        }

        // Update state tracking (for dashboard display, not for wake logic)
        await ctx.runMutation(internal.sessions.db.updateSessionState, {
          sessionId: sessionDoc._id,
          lastKnownState: currentState,
          lastProcessedActivityTime: maxTime,
        });
      } catch (error) {
        console.error(`[pollJulesActivities] Failed to process session ${sessionDoc.julesSessionId}:`, error);
      }
    }

    // Wake agent per thread — single message, single generateText
    for (const threadId of needsWake) {
      const parts = pollMessages.get(threadId);
      if (!parts || parts.length === 0) continue;

      const pollMessage = `[ACTIVITY UPDATE]\n\n${parts.join('\n\n')}`;
      const model = modelCache.get(threadId);

      if (!model) {
        console.error(`[pollJulesActivities] No cached model for thread ${threadId} — skipping agent wake`);
        continue;
      }

      const isRunning = await ctx.runQuery(internal.users.db.isAgentRunning, { threadId });

      if (isRunning) {
        // Queue — agent is busy
        await ctx.runMutation(internal.users.db.appendPendingMessage, {
          threadId,
          text: pollMessage,
        });
        console.log(`[pollJulesActivities] Queued activity message for thread ${threadId} (agent running)`);
      } else {
        // Wake agent directly
        await ctx.runMutation(internal.users.db.setAgentRunning, { threadId, isRunning: true });
        try {
          const { messageId } = await julesAgent.saveMessage(ctx, {
            threadId,
            message: { role: "user", content: pollMessage },
          });
          await julesAgent.generateText(ctx, { threadId }, {
            model,
            promptMessageId: messageId,
          });
        } finally {
          await ctx.runMutation(internal.users.db.setAgentRunning, { threadId, isRunning: false });
          // Drain any pending messages that arrived during generateText
          const pending = await ctx.runQuery(internal.users.db.getPendingMessages, { threadId });
          if (pending && pending.trim() !== "") {
            await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
              threadId,
              telegramChatId: await ctx.runQuery(internal.users.db.getChatIdForThread, { threadId }) ?? "",
            });
          }
        }
        console.log(`[pollJulesActivities] Woke agent for thread ${threadId}`);
      }
    }

    console.log(`[pollJulesActivities] Poll cycle completed in ${Date.now() - cronStartMs}ms`);
  }
});

function extractFilesFromDiff(unidiff: string): Array<{ path: string, content: string }> {
  const fileBlocks = unidiff.split(/(?=^diff --git)/m).filter(Boolean);
  const files: Array<{ path: string, content: string }> = [];

  for (const block of fileBlocks) {
    const pathMatch = block.match(/^\+\+\+ b\/(.+)$/m);
    if (!pathMatch) continue;

    const filePath = pathMatch[1]!;
    const lines = block.split('\n');
    const contentLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('@@')) continue;
      if (line.startsWith('diff --git')) continue;
      if (line.startsWith('index ')) continue;
      if (line.startsWith('new file')) continue;

      if (line.startsWith('+')) {
        contentLines.push(line.slice(1));
      }
    }

    if (contentLines.length > 0) {
      files.push({ path: filePath, content: contentLines.join('\n') });
    }
  }

  return files;
}

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
  activityId?: string
) {
  const processedOutputs: ProcessedOutput[] = [];

  for (const output of outputs) {
    if (output.changeSet) {
      const patch = output.changeSet.gitPatch?.unidiffPatch;
      const extractedFiles = patch ? extractFilesFromDiff(patch) : undefined;
      processedOutputs.push({
        type: 'changeSet',
        source: output.changeSet.source,
        baseCommitId: output.changeSet.gitPatch?.baseCommitId,
        patch,
        extractedFiles,
        isIncremental,
        activityId,
      });
    } else if (output.pullRequest) {
      processedOutputs.push({
        type: 'pullRequest',
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
        type: 'unknown',
        isIncremental,
        activityId,
      });
    }
  }

  if (processedOutputs.length > 0) {
    await ctx.runAction(internal.sessions.storageActions.saveSessionOutputs, {
      julesSessionId,
      outputs: processedOutputs,
    });
  }
  return processedOutputs;
}
