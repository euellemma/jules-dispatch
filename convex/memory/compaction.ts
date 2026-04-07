import { internalAction } from "../_generated/server";
import { internal, components } from "../_generated/api";
import { v } from "convex/values";
import { julesAgent } from "../agent/instance";
import { resolveLanguageModel } from "../agent/modelResolver";
import { memory } from "./tool";

const HEAD_PROTECT = 3;   // protect system + first exchange
const TAIL_PROTECT = 10;  // protect recent context

function extractText(message: any): string {
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

// Shared compaction logic — called by both memoryFlush and compactMemory
async function runCompaction(ctx: any, threadId: string) {
  const msgResult = await ctx.runQuery(
    (components as any).agent.messages.listMessagesByThreadId,
    {
      threadId,
      order: "desc",
      statuses: ["success"],
      paginationOpts: { numItems: 1000, cursor: null },
    },
  );
  const messages = msgResult.page.reverse();

  if (messages.length <= HEAD_PROTECT + TAIL_PROTECT) {
    console.log("[compactMemory] Not enough messages to compact");
    return;
  }

  const middle = messages.slice(HEAD_PROTECT, messages.length - TAIL_PROTECT);

  if (middle.length === 0) {
    console.log("[compactMemory] No middle messages to compact");
    return;
  }

  const lastMiddleOrder = middle[middle.length - 1]?.order ?? 0;

  const middleText = middle
    .map((m: any) => `[${m.message?.role || "unknown"}]: ${extractText(m.message)}`)
    .join("\n\n");

  const existingSummary = await ctx.runQuery(internal.memory.db.getThreadSummary, {
    threadId,
  });

  const model = await resolveLanguageModel(ctx, threadId);

  const summaryPrompt = existingSummary
    ? `Update this existing conversation summary with new information. Preserve existing facts, add new progress, move "In Progress" items to "Done" if completed.
EXISTING SUMMARY:
${existingSummary.summary}
NEW CONVERSATION TO INCORPORATE:
${middleText}
Output an updated structured summary with sections:
- Goal: what we're working toward
- Progress: what's been completed (Done) and what's in progress
- Key Decisions: important choices made
- Relevant Files: files that were discussed/modified
- Next Steps: what should happen next
- Critical Context: anything the agent MUST remember`
    : `Summarize this conversation into a structured summary:
${middleText}
Output a structured summary with sections:
- Goal: what we're working toward
- Progress: what's been completed (Done) and what's in progress
- Key Decisions: important choices made
- Relevant Files: files that were discussed/modified
- Next Steps: what should happen next
- Critical Context: anything the agent MUST remember`;

  const result = await julesAgent.generateText(
    ctx,
    { threadId },
    {
      model,
      prompt: summaryPrompt,
    },
    { storageOptions: { saveMessages: "none" } },
  );

  const summary = result.text.trim();

  await ctx.runMutation(internal.memory.db.upsertThreadSummary, {
    threadId,
    summary,
    summarizedUpToOrder: lastMiddleOrder,
  });

  console.log(`[compactMemory] Compacted ${middle.length} messages into summary`);
}

// Pre-compaction flush: ask the LLM to save important facts before compressing,
// then run compaction sequentially to guarantee facts are saved first.
export const memoryFlush = internalAction({
  args: {
    threadId: v.string(),
    telegramChatId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const model = await resolveLanguageModel(ctx, args.threadId);

      const msgResult = await ctx.runQuery(
        (components as any).agent.messages.listMessagesByThreadId,
        {
          threadId: args.threadId,
          order: "desc",
          statuses: ["success"],
          paginationOpts: { numItems: 50, cursor: null },
        },
      );
      const messages = msgResult.page.reverse();
      const conversationText = messages
        .map((m: any) => `[${m.message?.role || "unknown"}]: ${extractText(m.message)}`)
        .join("\n\n");

      const existingMemory = await ctx.runQuery(internal.memory.db.getEntries, {
        userId: args.telegramChatId,
        target: "memory",
      });
      const existingUser = await ctx.runQuery(internal.memory.db.getEntries, {
        userId: args.telegramChatId,
        target: "user",
      });
      const existingText = [
        ...existingMemory.map((e: any) => e.content),
        ...existingUser.map((e: any) => e.content),
      ].join("\n");

      const flushPrompt = `You are about to compress the conversation history. Before that, save any important facts to memory that should persist.
Existing memory (don't repeat these):
${existingText || "(empty)"}
Recent conversation:
${conversationText}
Instructions:
- If there are facts worth remembering (user preferences, corrections, decisions, environment facts), call the memory tool to save them.
- If nothing is worth saving, just say "Nothing to save."
- Focus on: user preferences, corrections, decisions, project conventions, lessons learned.
- Do NOT save: task progress, session outcomes, temporary state, things already in existing memory.`;

      await julesAgent.generateText(
        ctx,
        { threadId: args.threadId, userId: args.telegramChatId },
        {
          model,
          prompt: flushPrompt,
          tools: { memory },
        },
        { storageOptions: { saveMessages: "none" } },
      );

      console.log(`[memoryFlush] Completed for thread ${args.threadId}`);

      // Run compaction sequentially after flush completes
      await runCompaction(ctx, args.threadId);
    } catch (err) {
      console.error("[memoryFlush] Failed (non-fatal):", err);
    }
  },
});

// Standalone compaction (e.g., run from /compact or manually)
export const compactMemory = internalAction({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    await runCompaction(ctx, args.threadId);
  },
});
