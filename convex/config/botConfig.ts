import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export interface BotConfig {
  julesApiKey: string | null;
  exaApiKey: string | null;
  providerConfig: {
    endpoint: string;
    model: string;
    apiKey: string;
    sdkType: "openai" | "anthropic" | "google" | "openai-compatible";
  } | null;
  updatedAt: number;
}

/**
 * Get bot configuration (singleton pattern).
 * Always returns the first (and only) config document.
 */
export const getConfig = internalQuery({
  args: {},
  handler: async (ctx): Promise<BotConfig | null> => {
    const config = await ctx.db
      .query("bot_config")
      .order("desc")
      .first();
    
    if (!config) return null;
    
    return {
      julesApiKey: config.julesApiKey ?? null,
      exaApiKey: config.exaApiKey ?? null,
      providerConfig: config.providerConfig ?? null,
      updatedAt: config.updatedAt,
    };
  },
});

/**
 * Update or create the singleton bot configuration.
 */
export const updateConfig = internalMutation({
  args: {
    julesApiKey: v.optional(v.string()),
    exaApiKey: v.optional(v.string()),
    providerConfig: v.optional(
      v.object({
        endpoint: v.string(),
        model: v.string(),
        apiKey: v.string(),
        sdkType: v.union(
          v.literal("openai"),
          v.literal("anthropic"),
          v.literal("google"),
          v.literal("openai-compatible"),
        ),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const now = Date.now();
    
    // Try to find existing config
    const existing = await ctx.db
      .query("bot_config")
      .order("desc")
      .first();
    
    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        ...(args.julesApiKey !== undefined && { julesApiKey: args.julesApiKey }),
        ...(args.exaApiKey !== undefined && { exaApiKey: args.exaApiKey }),
        ...(args.providerConfig !== undefined && { providerConfig: args.providerConfig }),
        updatedAt: now,
      });
    } else {
      // Create new
      await ctx.db.insert("bot_config", {
        julesApiKey: args.julesApiKey,
        exaApiKey: args.exaApiKey,
        providerConfig: args.providerConfig,
        updatedAt: now,
      });
    }
    
    return { success: true };
  },
});
