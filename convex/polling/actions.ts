"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { julesAgent, resolveLanguageModel } from "../agent/instance";
import { getJulesClient } from "../tools/nodeActions";
import type { ProcessedOutput, JulesApiSession } from "../types";
import { isActiveState, normalizeState } from "../types";
import type { GenericActionCtx } from "convex/server";

// Type for action context passed to helper functions
type ActionCtx = GenericActionCtx<any>;

interface WakerEvent {
  type: "resumed" | "state_change" | "message";
  sessionId: string;
  shortName: string;
  threadId: string;
  details: string;
}

export const pollJulesActivities = internalAction({
  args: {},
  handler: async (ctx) => {
    const cronStartMs = Date.now();
    const wakerEvents: WakerEvent[] = [];
    
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

    for (const sessionDoc of sessions) {
      try {
        const julesSession = sessionMap.get(sessionDoc.julesSessionId);
        if (!julesSession) {
          console.warn(`[pollJulesActivities] Tracked session ${sessionDoc.julesSessionId} not found on Jules side — skipping`);
          continue;
        }

        const currentState = julesSession.state || "unknown";
        const normalizedCurrentState = normalizeState(currentState);
        const outputs = julesSession.outputs || [];
        const lastKnownState = sessionDoc.lastKnownState;

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
          const actTime = new Date(act.createTime).getTime();
          return actTime > (sessionDoc.lastProcessedActivityTime || 0) && act.originator !== 'user';
        });

        // 1. Handle Activities When State Has Not Changed
        if (currentState === lastKnownState && newActivities.length > 0) {
           let agentMessage = null;

           for (const act of newActivities) {
              const actTime = new Date(act.createTime).getTime();
              if (actTime > maxTime) maxTime = actTime;

              if (act.type === 'progressUpdated') {
                if (act.artifacts && act.artifacts.length > 0) {
                  await processOutputs(ctx, sessionDoc.julesSessionId, act.artifacts, true, act.id);
                }
              } else if (act.type === 'agentMessaged') {
                agentMessage = act;
              }
           }

           if (agentMessage) {
              console.log(`[pollJulesActivities] Waking agent for message in ${sessionDoc.shortName}`);
              
              wakerEvents.push({
                type: "message",
                sessionId: sessionDoc.julesSessionId,
                shortName: sessionDoc.shortName || sessionDoc.julesSessionId.slice(0, 8),
                threadId: sessionDoc.threadId,
                details: agentMessage.message,
              });
           }

            // State update after processing activities
            await ctx.runMutation(internal.sessions.db.updateSessionState, {
              sessionId: sessionDoc._id,
              lastKnownState: currentState,
              lastProcessedActivityTime: maxTime
            });
        }

        // 2. Handle Major State Changes
        if (currentState !== lastKnownState) {
          console.log(`[pollJulesActivities] Session ${sessionDoc.shortName}: ${lastKnownState || 'unknown'} -> ${currentState}`);
          
          // Check for resume (COMPLETED/FAILED -> active state)
          const lastUpper = (lastKnownState || "").toUpperCase();
          const currentUpper = normalizedCurrentState === "UNKNOWN"
            ? (currentState || "").toUpperCase()
            : normalizedCurrentState;
          const wasTerminal = lastUpper === "COMPLETED" || lastUpper === "FAILED";
          const isNowActive = isActiveState(currentUpper);
          const isResumed = wasTerminal && isNowActive;
          
          if (isResumed) {
            wakerEvents.push({
              type: "resumed",
              sessionId: sessionDoc.julesSessionId,
              shortName: sessionDoc.shortName || sessionDoc.julesSessionId.slice(0, 8),
              threadId: sessionDoc.threadId,
              details: `Session resumed from ${lastKnownState} to ${currentState}`,
            });
          } else {
            wakerEvents.push({
              type: "state_change",
              sessionId: sessionDoc.julesSessionId,
              shortName: sessionDoc.shortName || sessionDoc.julesSessionId.slice(0, 8),
              threadId: sessionDoc.threadId,
              details: `${lastKnownState || 'unknown'} -> ${currentState}`,
            });
          }
          
          let updatesText = `[SYSTEM: State Change - ${sessionDoc.shortName} -> ${currentState}]\n\n`;

          if (newActivities.length > 0) {
            updatesText += `Recent background activities:\n`;
            for (const act of newActivities) {
              const actTime = new Date(act.createTime).getTime();
              if (actTime > maxTime) maxTime = actTime;

              if (act.type === 'progressUpdated') {
                updatesText += `- Progress: ${act.title}${act.description ? ': ' + act.description : ''}\n`;
                if (act.artifacts && act.artifacts.length > 0) {
                  const processed = await processOutputs(ctx, sessionDoc.julesSessionId, act.artifacts, true, act.id);
                  if (processed) {
                    for (const out of processed) {
                      if (out.type === 'changeSet' && out.extractedFiles) {
                        updatesText += `  (Files updated: ${out.extractedFiles.map((f) => f.path).join(', ')})\n`;
                      }
                    }
                  }
                }
              } else if (act.type === 'planGenerated' && act.plan) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const plan = act.plan as any;
                updatesText += `- Plan: "${plan.title ?? 'Untitled'}"\n`;
                plan.steps?.forEach((step: { index: number; title?: string }) => {
                  updatesText += `    ${step.index}. ${step.title ?? 'Untitled'}\n`;
                });
              } else if (act.type === 'agentMessaged') {
                updatesText += `- Jules: ${act.message}\n`;
              } else if (act.type === 'sessionCompleted') {
                updatesText += `- Status: Completed.\n`;
              } else if (act.type === 'sessionFailed') {
                updatesText += `- Status: Failed.\n`;
              }
            }
          }
          
          const { messageId } = await julesAgent.saveMessage(ctx, {
            threadId: sessionDoc.threadId,
            message: { role: "user", content: updatesText }
          });

          // Step 12: Use cached model
          const model = modelCache.get(sessionDoc.threadId);
          if (!model) {
            console.error(`[pollJulesActivities] No cached model for thread ${sessionDoc.threadId} — skipping agent wake`);
          } else {
            await julesAgent.generateText(ctx, { threadId: sessionDoc.threadId }, {
              model,
              promptMessageId: messageId,
            });
          }

          // State update after state change
          await ctx.runMutation(internal.sessions.db.updateSessionState, {
            sessionId: sessionDoc._id,
            lastKnownState: currentState,
            lastProcessedActivityTime: maxTime
          });

          if (currentUpper === "COMPLETED") {
            // IMPORTANT: session.outputs is empty in list responses.
            // Must fetch full session details to get actual outputs.
            let finalOutputs = outputs;
            try {
              const sessionClient = await jules.session(sessionDoc.julesSessionId);
              const fullSession = await sessionClient.info();
              // Outputs may be in outcome.outputs or directly in outputs
              finalOutputs = fullSession.outcome?.outputs || fullSession.outputs || [];
            } catch (fetchError) {
              console.error(`[pollJulesActivities] Failed to fetch session details for outputs: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
              // Continue with empty outputs from list response
            }
            
            const processed = await processOutputs(ctx, sessionDoc.julesSessionId, finalOutputs, false);
            
            if (processed && processed.length > 0) {
              let jitMessage = `[SYSTEM: Session ${sessionDoc.shortName} Completed]\nFinal results:\n`;
              for (const out of processed) {
                if (out.type === 'changeSet' && out.extractedFiles) {
                  jitMessage += `- ${out.extractedFiles.length} file(s) changed\n`;
                } else if (out.type === 'pullRequest') {
                  jitMessage += `- PR: ${out.url}\n`;
                }
              }
              jitMessage += `\nUse 'get_session_files' to retrieve the code or 'get_session_activities' for chronological logs.`;
              
              const { messageId } = await julesAgent.saveMessage(ctx, {
                threadId: sessionDoc.threadId,
                message: { role: "user", content: jitMessage }
              });

              const model2 = modelCache.get(sessionDoc.threadId);
              if (!model2) {
                console.error(`[pollJulesActivities] No cached model for thread ${sessionDoc.threadId} — skipping completion notification`);
              } else {
                await julesAgent.generateText(ctx, { threadId: sessionDoc.threadId }, {
                  model: model2,
                  promptMessageId: messageId,
                });
              }
            }
          }
        }
      } catch (error) {
        console.error(`[pollJulesActivities] Failed to process session ${sessionDoc.julesSessionId}:`, error);
      }
    }
    
    // 3. Send aggregated waker events to main agent
    if (wakerEvents.length > 0) {
      await sendWakerEvents(ctx, wakerEvents);
      console.log(`[pollJulesActivities] Processed ${wakerEvents.length} event(s) in ${Date.now() - cronStartMs}ms`);
    }
  }
});

async function sendWakerEvents(ctx: ActionCtx, events: WakerEvent[]) {
  console.log(`[sendWakerEvents] Sending ${events.length} aggregated events`);
  
  // Group events by threadId
  const byThread = new Map<string, WakerEvent[]>();
  for (const event of events) {
    if (!event.threadId) continue;
    const existing = byThread.get(event.threadId) || [];
    existing.push(event);
    byThread.set(event.threadId, existing);
  }
  
  for (const [threadId, threadEvents] of byThread) {
    let message = `[SESSION EVENTS] ${threadEvents.length} event(s):\n\n`;
    
    for (const event of threadEvents) {
      switch (event.type) {
        case "resumed":
          message += `[RESUMED] ${event.shortName}\n   ${event.details}\n\n`;
          break;
        case "state_change":
          message += `[STATE CHANGE] ${event.shortName}\n   ${event.details}\n\n`;
          break;
        case "message":
          message += `[NEW MESSAGE] ${event.shortName}\n   ${event.details}\n\n`;
          break;
      }
    }
    
    try {
      const { messageId } = await julesAgent.saveMessage(ctx, {
        threadId,
        message: { role: "user", content: message }
      });
      
      const model = await resolveLanguageModel(ctx, threadId);
      await julesAgent.generateText(ctx, { threadId }, {
        model,
        promptMessageId: messageId,
      });
      
      console.log(`[sendWakerEvents] Sent ${threadEvents.length} events to thread ${threadId}`);
    } catch (error) {
      console.error(`[sendWakerEvents] Error sending events to thread ${threadId}:`, error);
    }
  }
}

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
