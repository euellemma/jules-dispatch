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

const DEFAULT_CONFIG_ID = "singleton";

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

/**
 * Initialize config from environment variables if empty.
 * Called once on startup/first request.
 */
export const initFromEnv = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ initialized: boolean }> => {
    // Check if config already exists
    const existing = await ctx.db
      .query("bot_config")
      .order("desc")
      .first();
    
    if (existing) {
      return { initialized: false };
    }
    
    // Initialize from env vars
    const julesKey = process.env.JULES_API_KEY;
    const exaKey = process.env.EXA_API_KEY;
    const llmEndpoint = process.env.LLM_ENDPOINT;
    const llmModel = process.env.LLM_MODEL;
    const llmApiKey = process.env.LLM_API_KEY;
    const llmSdkType = process.env.LLM_SDK_TYPE as "openai" | "anthropic" | "google" | "openai-compatible" | undefined;
    
    // Only create if we have at least something
    if (julesKey || exaKey || llmEndpoint) {
      await ctx.db.insert("bot_config", {
        julesApiKey: julesKey,
        exaApiKey: exaKey,
        providerConfig: llmEndpoint && llmModel && llmApiKey
          ? {
              endpoint: llmEndpoint,
              model: llmModel,
              apiKey: llmApiKey,
              sdkType: (llmSdkType as "openai" | "anthropic" | "google" | "openai-compatible") ?? "openai-compatible",
            }
          : undefined,
        updatedAt: Date.now(),
      });
      return { initialized: true };
    }
    
    return { initialized: false };
  },
});

/**
 * Get or initialize configuration.
 * Safe to call from any context - will auto-initialize from env on first call.
 */
export const getOrInitConfig = internalQuery({
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
