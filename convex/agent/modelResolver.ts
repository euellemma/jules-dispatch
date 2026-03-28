import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { internal } from "../_generated/api";

interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  sdkType: "openai" | "anthropic" | "google" | "openai-compatible";
}

export async function resolveLanguageModel(
  ctx: any, 
  threadId: string, 
  _options: { provideFallback?: boolean } = { provideFallback: false }
) {
  console.log("[resolveLanguageModel] Starting resolution for threadId:", threadId);

  try {
    const telegramChatId = await ctx.runQuery(
      (internal as any).users.db.getChatIdForThread,
      {
        threadId: threadId,
      },
    );

    if (!telegramChatId) {
      throw new Error("No telegramChatId found for this thread.");
    }

    const res = (await ctx.runQuery(
      (internal as any).users.db.getProviderConfig,
      {
        telegramChatId,
      },
    )) as { config: ProviderConfig | null; julesApiKey?: string; exaApiKey?: string };

    const config = res.config;

    if (!config || !config.apiKey) {
      throw new Error("Provider not configured. Please use /connect to setup your API key.");
    }

    const { endpoint, model, apiKey, sdkType } = config;

    if (sdkType === "anthropic") {
      console.log("[resolveLanguageModel] Instantiating Anthropic SDK");
      const anthropic = createAnthropic({
        baseURL: endpoint,
        apiKey: apiKey,
      });
      return anthropic(model);
    } else if (sdkType === "google") {
      console.log("[resolveLanguageModel] Instantiating Google AI SDK");
      const google = createGoogleGenerativeAI({
        apiKey: apiKey,
        baseURL: endpoint,
      });
      return google(model);
    } else if (sdkType === "openai") {
      console.log("[resolveLanguageModel] Instantiating OpenAI SDK");
      const openai = createOpenAI({
        baseURL: endpoint,
        apiKey: apiKey,
      });
      return openai(model);
    } else {
      console.log("[resolveLanguageModel] Instantiating OpenAI-Compatible SDK");
      const provider = createOpenAICompatible({
        name: "custom",
        baseURL: endpoint,
        apiKey: apiKey,
      });
      return provider(model);
    }
  } catch (err: any) {
    console.error("[resolveLanguageModel] Error resolving dynamic model:", err);
    throw err; // Re-throw to inform the user via the agent loop
  }
}
