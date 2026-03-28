import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { observerInstructions } from "./instructions";
import { v } from "convex/values";
import { resolveLanguageModel } from "../agent/instance";
import { generateText } from "ai";

const BUFFER_THRESHOLD = 15_000;
const OBSERVATION_MAX = 18_000;
const STRICT_TOKEN_LIMIT = 100_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateObservations(observations: string, maxTokens: number): string {
  const lines = observations.split("\n");
  let currentTokens = estimateTokens(observations);
  
  if (currentTokens <= maxTokens) return observations;
  
  const targetTokens = Math.floor(maxTokens * 0.75);
  const truncated: string[] = [];
  
  for (const line of lines.reverse()) {
    if (currentTokens <= targetTokens) break;
    currentTokens -= estimateTokens(line);
    truncated.unshift(line);
  }
  
  if (truncated.length === 0) return observations;
  
  return `[=== Earlier context truncated (${truncated.length} entries) ===]\n\n` + truncated.join("\n");
}

export const scheduleObservation = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, (internal as any).memory.processor.runObservation, {
      threadId: args.threadId,
    });
  },
});

export const runObservation = internalAction({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const memory = await ctx.runQuery((internal as any).memory.db.getMemory, {
      threadId: args.threadId,
    });
    
    if (!memory) return;
    
    const lastObservedAt = memory.lastObservedAt;
    const messages = await ctx.runQuery(
      (internal as any).components.agent.messages.listMessagesByThreadId,
      {
        threadId: args.threadId,
        order: "asc",
        statuses: ["success"],
      }
    );
    
    const unobservedMessages = messages.filter(
      (m: any) => m._creationTime > lastObservedAt
    );
    
    if (unobservedMessages.length === 0) return;
    
    const messageTexts = unobservedMessages
      .map((m: any) => {
        const role = m.message?.role || "unknown";
        const content = extractTextContent(m.message);
        return `[${role}]: ${content}`;
      })
      .join("\n\n");
    
    const unobservedTokens = estimateTokens(messageTexts);
    
    if (unobservedTokens >= STRICT_TOKEN_LIMIT) {
      await ctx.scheduler.runAfter(0, (internal as any).memory.processor.compactMemory, {
        threadId: args.threadId,
      });
      return;
    }
    
    if (unobservedTokens < BUFFER_THRESHOLD) return;
    
    const existingObservations = memory.activeObservations || "";
    
    const observationPrompt = `Existing observations (for context, do not repeat):
${existingObservations}

Recent conversation to extract facts from:
${messageTexts}`;
    
    const model = await resolveLanguageModel(ctx, args.threadId);
    
    const result = await generateText({
      model,
      system: observerInstructions,
      prompt: observationPrompt,
    });
    
    const newObservations = result.text.trim();
    
    if (newObservations.includes("No significant facts")) return;
    
    let combinedObservations = existingObservations
      ? existingObservations + "\n\n" + newObservations
      : newObservations;
    
    let tokenCount = estimateTokens(combinedObservations);
    if (tokenCount > OBSERVATION_MAX) {
      combinedObservations = truncateObservations(combinedObservations, OBSERVATION_MAX);
      tokenCount = estimateTokens(combinedObservations);
    }
    
    const lastMessageTime = unobservedMessages[unobservedMessages.length - 1]._creationTime;
    
    await ctx.runMutation((internal as any).memory.db.upsertMemory, {
      threadId: args.threadId,
      activeObservations: combinedObservations,
      lastObservedAt: lastMessageTime,
      observationTokenCount: tokenCount,
    });
  },
});

export const compactMemory = internalAction({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const memory = await ctx.runQuery((internal as any).memory.db.getMemory, {
      threadId: args.threadId,
    });

    const messages = await ctx.runQuery(
      (internal as any).components.agent.messages.listMessagesByThreadId,
      {
        threadId: args.threadId,
        order: "asc",
        statuses: ["success"],
      }
    );

    const HEAD_PROTECT = 7;
    const TAIL_PROTECT = 5;

    const tail = messages.slice(-TAIL_PROTECT);
    const middle = messages.slice(HEAD_PROTECT, -TAIL_PROTECT);

    if (middle.length === 0) {
      return { preservedTokens: 0, summaryTokens: 0 };
    }

    const middleText = middle
      .map((m: any) => `[${m.message?.role || "unknown"}]: ${extractTextContent(m.message)}`)
      .join("\n\n");

    const existingObservations = memory?.activeObservations || "";

    const tailText = tail
      .map((m: any) => `<message role="${m.message?.role || "unknown"}">${extractTextContent(m.message)}</message>`)
      .join("\n");

    const prompt = `## Old Observations (these will be REPLACED by your summary below - extract their key essence)
${existingObservations}

## Recent Conversation (compress into key facts)
${middleText}

## Recent Exchanges (preserve verbatim as structured context)
${tailText}

Output your summary of the OLD OBSERVATIONS and RECENT CONVERSATION in the standard observation format.`;

    const model = await resolveLanguageModel(ctx, args.threadId);

    const result = await generateText({
      model,
      system: observerInstructions,
      prompt,
    });

    const summary = result.text.trim();
    const middleTokens = estimateTokens(middleText);
    const summaryTokens = estimateTokens(summary);

    const compactedObservations = `### Context Summary\n${summary}\n\n### Recent Exchanges\n${tailText}`;

    await ctx.runMutation((internal as any).memory.db.upsertMemory, {
      threadId: args.threadId,
      activeObservations: compactedObservations,
      lastObservedAt: messages[messages.length - 1]._creationTime,
      observationTokenCount: summaryTokens,
    });

    return { preservedTokens: middleTokens, summaryTokens };
  },
});

function extractTextContent(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}
