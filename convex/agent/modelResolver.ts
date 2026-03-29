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

  let config: ProviderConfig | null = null;

  try {
    const telegramChatId = await ctx.runQuery(
      (internal as any).users.db.getChatIdForThread,
      {
        threadId: threadId,
      },
    );

    if (telegramChatId) {
      const res = (await ctx.runQuery(
        (internal as any).users.db.getProviderConfig,
        {
          telegramChatId,
        },
      )) as { config: ProviderConfig | null; julesApiKey?: string; exaApiKey?: string };

      if (res.config?.apiKey) {
        config = res.config;
      }
    }
  } catch (err) {
    console.log("[resolveLanguageModel] No user config found, falling back to env vars");
  }

  // Fall back to environment variables (for local/anonymous mode)
  if (!config) {
    const envEndpoint = process.env.LLM_ENDPOINT;
    const envModel = process.env.LLM_MODEL;
    const envApiKey = process.env.LLM_API_KEY;
    const envSdkType = process.env.LLM_SDK_TYPE as ProviderConfig["sdkType"] | undefined;

    if (envEndpoint && envModel && envApiKey && envSdkType) {
      console.log("[resolveLanguageModel] Using environment variable config");
      config = {
        endpoint: envEndpoint,
        model: envModel,
        apiKey: envApiKey,
        sdkType: envSdkType,
      };
    }
  }

  if (!config) {
    throw new Error(
      "Provider not configured. Please use /connect to setup your API key, " +
      "or set LLM_ENDPOINT, LLM_MODEL, LLM_API_KEY, and LLM_SDK_TYPE environment variables."
    );
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
}
