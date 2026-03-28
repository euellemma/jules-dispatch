"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { julesAgent, resolveLanguageModel } from "../agent/instance";
import { getJulesClient } from "../tools/nodeActions";
import type { ProcessedOutput } from "../types";
import type { GenericActionCtx } from "convex/server";

const POLL_LOG_ENABLED = true;

// Type for action context passed to helper functions
type ActionCtx = GenericActionCtx<any>;

interface WakerEvent {
  type: "discovered" | "resumed" | "state_change" | "message";
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
    
    if (POLL_LOG_ENABLED) console.log(`[pollJulesActivities] [0ms] Cron triggered`);
    
    // 1. Discover new sessions from Jules SDK
    await discoverNewSessions(ctx, wakerEvents);
    
    // 2. Poll existing tracked sessions for updates
    const sessions = await ctx.runQuery(internal.sessions.db.getDashboardSessions, {});
    if (POLL_LOG_ENABLED) console.log(`[pollJulesActivities] Found ${sessions.length} dashboard session(s)`);

    for (const sessionDoc of sessions) {
      try {
        const jules = await getJulesClient(ctx, sessionDoc.threadId);
        const session = await jules.session(sessionDoc.julesSessionId);
        
        const info = await session.info();
        const currentState = info.state;
        const lastKnownState = sessionDoc.lastKnownState;

        const { activities: activitiesResult } = await session.activities.list({});
        
        let maxTime = sessionDoc.lastProcessedActivityTime || 0;
        const newActivities = activitiesResult.filter((act) => {
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
              if (POLL_LOG_ENABLED) console.log(`[pollJulesActivities] Waking agent for message in ${sessionDoc.shortName}`);
              
              wakerEvents.push({
                type: "message",
                sessionId: sessionDoc.julesSessionId,
                shortName: sessionDoc.shortName || sessionDoc.julesSessionId.slice(0, 8),
                threadId: sessionDoc.threadId,
                details: agentMessage.message,
              });
           }

           await ctx.runMutation(internal.sessions.db.updateSessionState, {
              sessionId: sessionDoc._id,
              lastKnownState: currentState,
              isActive: true,
              lastProcessedActivityTime: maxTime
           });
        }

        // 2. Handle Major State Changes
        if (currentState !== lastKnownState) {
          console.log(`[pollJulesActivities] Session ${sessionDoc.shortName}: ${lastKnownState || 'unknown'} -> ${currentState}`);
          
          // Check for resume (completed/failed -> running)
          const wasCompleted = lastKnownState === 'completed' || lastKnownState === 'failed';
          const isResumed = wasCompleted && (currentState as string) === 'running';
          
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
          const isActive = (currentState !== 'completed' && currentState !== 'failed');

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

          const model = await resolveLanguageModel(ctx, sessionDoc.threadId);
          await julesAgent.generateText(ctx, { threadId: sessionDoc.threadId }, {
            model,
            promptMessageId: messageId,
          });

          await ctx.runMutation(internal.sessions.db.updateSessionState, {
            sessionId: sessionDoc._id,
            lastKnownState: currentState,
            isActive: isActive,
            lastProcessedActivityTime: maxTime
          });

          if (currentState === 'completed') {
            const processed = await processOutputs(ctx, sessionDoc.julesSessionId, info.outputs, false);
            
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

              const model = await resolveLanguageModel(ctx, sessionDoc.threadId);
              await julesAgent.generateText(ctx, { threadId: sessionDoc.threadId }, {
                model,
                promptMessageId: messageId,
              });
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
    }
    
    if (POLL_LOG_ENABLED) console.log(`[pollJulesActivities] Finished in ${Date.now() - cronStartMs}ms`);
  }
});

async function discoverNewSessions(ctx: ActionCtx, wakerEvents: WakerEvent[]) {
  if (POLL_LOG_ENABLED) console.log(`[discoverNewSessions] Checking for new sessions...`);
  
  try {
    const jules = await getJulesClient(ctx);
    const sessionsList = await jules.sessions({}).all();
    
    if (POLL_LOG_ENABLED) console.log(`[discoverNewSessions] Found ${sessionsList.length} sessions in Jules`);
    
    const allDbSessions = await ctx.runQuery(internal.sessions.db.getAllSessions, {});
    const dbSessionMap = new Map(allDbSessions.map((s: { julesSessionId: string }) => [s.julesSessionId, s]));
    
    const discovered: Array<{ id: string; info: { title?: string; state?: string } }> = [];
    
    for (const js of sessionsList) {
      if (!dbSessionMap.has(js.id)) {
        try {
          // New session discovered!
          const session = await jules.session(js.id);
          const info = await session.info();
          
          await ctx.runMutation(internal.sessions.db.upsertDiscoveredSession, {
            julesSessionId: js.id,
            lastKnownState: info.state,
          });
          
          discovered.push({ id: js.id, info });
          
          if (POLL_LOG_ENABLED) console.log(`[discoverNewSessions] Discovered new session: ${js.id} (${info.state})`);
        } catch (err) {
          console.error(`[discoverNewSessions] Failed to discover session ${js.id}:`, err);
          // Fallback: upsert with state from list if possible, or skip
          await ctx.runMutation(internal.sessions.db.upsertDiscoveredSession, {
            julesSessionId: js.id,
            lastKnownState: js.state || "unknown",
          });
        }
      }
    }
    
    // Add discovered events to waker
    for (const d of discovered) {
      const shortName = (d.info.title || d.id.slice(0, 8))
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 5)
        .join('-');
        
      wakerEvents.push({
        type: "discovered",
        sessionId: d.id,
        shortName: shortName,
        threadId: "", // Will be filled when user acknowledges
        details: `New session discovered: ${d.info.title || 'Untitled'} - State: ${d.info.state}`,
      });
    }
    
    if (POLL_LOG_ENABLED && discovered.length > 0) {
      console.log(`[discoverNewSessions] Added ${discovered.length} discovered sessions to waker`);
    }
  } catch (error) {
    console.error(`[discoverNewSessions] Error discovering sessions:`, error);
  }
}

async function sendWakerEvents(ctx: ActionCtx, events: WakerEvent[]) {
  if (POLL_LOG_ENABLED) console.log(`[sendWakerEvents] Sending ${events.length} aggregated events`);
  
  // Group events by threadId
  const byThread = new Map<string, WakerEvent[]>();
  for (const event of events) {
    if (!event.threadId) continue; // Skip events without threadId
    const existing = byThread.get(event.threadId) || [];
    existing.push(event);
    byThread.set(event.threadId, existing);
  }
  
  for (const [threadId, threadEvents] of byThread) {
    let message = `[SESSION EVENTS] ${threadEvents.length} event(s):\n\n`;
    
    for (const event of threadEvents) {
      switch (event.type) {
        case "discovered":
          message += `[DISCOVERED] ${event.shortName}\n   ${event.details}\n   Session ID: ${event.sessionId}\n\n`;
          break;
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
    
    message += `Use query_sessions tool to manage these sessions.`;
    
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
      
      if (POLL_LOG_ENABLED) console.log(`[sendWakerEvents] Sent ${threadEvents.length} events to thread ${threadId}`);
    } catch (error) {
      console.error(`[sendWakerEvents] Error sending events to thread ${threadId}:`, error);
    }
  }
  
  // Handle discovered sessions without threadId (new sessions)
  const unthreaded = events.filter(e => e.type === "discovered" && !e.threadId);
  if (unthreaded.length > 0) {
    if (POLL_LOG_ENABLED) console.log(`[sendWakerEvents] ${unthreaded.length} discovered sessions need user acknowledgement`);
    // These will be picked up when user interacts - the session manager will see them
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
    if (output.type === 'changeSet' && output.changeSet) {
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
    } else if (output.type === 'pullRequest' && output.pullRequest) {
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
        type: output.type || 'unknown',
        isIncremental,
        activityId,
      });
    }
  }

  if (processedOutputs.length > 0) {
    await ctx.runMutation(internal.sessions.db.saveSessionOutputs, {
      julesSessionId,
      outputs: processedOutputs,
    });
  }
  return processedOutputs;
}