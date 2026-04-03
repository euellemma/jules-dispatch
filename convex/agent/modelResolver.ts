import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { internal } from "../_generated/api";

interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  sdkType: "openai" | "anthropic" | "google" | "openai-compatible";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveLanguageModel(ctx: any, threadId: string): Promise<LanguageModel> {
  const user = await ctx.runQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).users.db.getProviderConfigByThreadId,
    { threadId }
  ) as { providerConfig: ProviderConfig | null; julesApiKey?: string; exaApiKey?: string } | null;

  if (!user) {
    throw new Error(
      "User not found. Please send a message first to initialize your account."
    );
  }

  if (!user.providerConfig) {
    throw new Error(
      "AI provider not configured. Use /connect to set up your API key."
    );
  }

  const { endpoint, model, apiKey, sdkType } = user.providerConfig;

  if (sdkType === "anthropic") {
    const anthropic = createAnthropic({
      baseURL: endpoint,
      apiKey: apiKey,
    });
    return anthropic(model);
  } else if (sdkType === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: apiKey,
      baseURL: endpoint,
    });
    return google(model);
  } else if (sdkType === "openai") {
    const openai = createOpenAI({
      baseURL: endpoint,
      apiKey: apiKey,
    });
    return openai(model);
  } else {
    const provider = createOpenAICompatible({
      name: "custom",
      baseURL: endpoint,
      apiKey: apiKey,
    });
    return provider(model);
  }
}
