import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { internal } from "../_generated/api";

interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  sdkType: "openai" | "anthropic" | "google" | "openai-compatible";
}

function inferProvider(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic";
  if (lower.includes("gpt") || lower.includes("openai")) return "openai";
  if (lower.includes("gemini") || lower.includes("google")) return "google";
  return "unknown";
}

// Strip fields starting with $ (reserved by Convex)
const stripReserved = (obj: any): any => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripReserved);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => !k.startsWith("$"))
      .map(([k, v]) => [k, stripReserved(v)])
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveLanguageModel(ctx: any, threadId: string, userId: string): Promise<LanguageModel> {
  // Get from singleton bot config (saves 1 DB read vs per-user lookup)
  const config = await ctx.runQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).config.botConfig.getConfig,
    {}
  ) as { providerConfig: ProviderConfig | null } | null;

  if (!config || !config.providerConfig) {
    throw new Error(
      "LLM provider not configured. Please configure it in the /settings page."
    );
  }

  const { endpoint, model, apiKey, sdkType } = config.providerConfig;

  let baseModel: LanguageModel;
  if (sdkType === "anthropic") {
    const anthropic = createAnthropic({
      baseURL: endpoint,
      apiKey: apiKey,
    });
    baseModel = anthropic(model);
  } else if (sdkType === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: apiKey,
      baseURL: endpoint,
    });
    baseModel = google(model);
  } else if (sdkType === "openai") {
    const openai = createOpenAI({
      baseURL: endpoint,
      apiKey: apiKey,
    });
    baseModel = openai(model);
  } else {
    const provider = createOpenAICompatible({
      name: "custom",
      baseURL: endpoint,
      apiKey: apiKey,
    });
    baseModel = provider(model);
  }

  const provider = inferProvider(model);

  return wrapLanguageModel({
    model: baseModel,
    middleware: {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate, params }) => {
        const startMs = Date.now();
        try {
          const result = await doGenerate();
          const durationMs = Date.now() - startMs;

          const promptTokens = result.usage.inputTokens.total ?? 0;
          const completionTokens = result.usage.outputTokens.total ?? 0;

          // Asynchronously log the call
          ctx.runMutation(internal["llmCalls/actions"].insertLlmCall, {
            threadId: threadId ?? "unknown",
            userId: userId ?? threadId ?? "unknown",
            model: model,
            provider,
            requestBody: stripReserved(params.prompt),
            responseBody: stripReserved(result),
            finishReason: result.finishReason?.unified ?? result.finishReason?.raw ?? "unknown",
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
            },
            durationMs,
            status: "success",
          }).catch((e: any) => console.error("[resolveLanguageModel] mutation error:", e));

          return result;
        } catch (error: any) {
          const durationMs = Date.now() - startMs;
          ctx.runMutation(internal["llmCalls/actions"].insertLlmCall, {
            threadId: threadId ?? "unknown",
            userId: userId ?? threadId ?? "unknown",
            model: model,
            provider,
            requestBody: stripReserved(params.prompt),
            responseBody: { error: error?.message ?? String(error) },
            durationMs,
            status: "error",
          }).catch((e: any) => console.error("[resolveLanguageModel] mutation error:", e));
          throw error;
        }
      },
    },
  });
}
