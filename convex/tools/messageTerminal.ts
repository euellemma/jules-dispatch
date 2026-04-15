import { createTool } from "@convex-dev/agent";
import { internal } from "../_generated/api";
import { z } from "zod";

export const message_terminal = createTool({
  description:
    "Send an instruction back to a waiting terminal agent. Use this when a terminal agent has sent you context via pause-and-wait and you have an instruction for it. " +
    "The terminal agent will receive your response and continue working locally. " +
    "You MUST use this tool when you see a [TERMINAL AGENT] message to respond — don't just reply in chat, as the terminal agent won't see chat messages.",
  inputSchema: z.object({
    sessionLabel: z
      .string()
      .describe("The session label from the terminal agent's pause-and-wait request (e.g., 'opencode-fix-auth')."),
    instruction: z
      .string()
      .describe("The instruction to send back to the terminal agent. Be specific and actionable."),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      if (!ctx.threadId) throw new Error("Tool must be called within a thread.");

      const interaction = await ctx.runQuery(internal.terminal.db.getLatestWaitingBySessionLabel, {
        sessionLabel: args.sessionLabel,
      });

      if (!interaction) {
        return `No waiting terminal agent found for session label "${args.sessionLabel}". It may have already been responded to or timed out.`;
      }

      await ctx.runMutation(internal.terminal.db.writeResponse, {
        interactionId: interaction.interactionId,
        response: args.instruction,
      });

      return `Instruction sent to terminal agent "${args.sessionLabel}".`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[message_terminal] Error:`, msg);
      return `Error sending instruction to terminal agent: ${msg}`;
    }
  },
});