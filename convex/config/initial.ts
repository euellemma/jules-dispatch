export interface InitialConfig {
  telegramBotToken: string;
  julesApiKey: string;
  exaApiKey?: string;
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  llmSdkType: "openai" | "anthropic" | "google" | "openai-compatible";
}

export const INITIAL_CONFIG: InitialConfig = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  julesApiKey: process.env.JULES_API_KEY || "",
  exaApiKey: process.env.EXA_API_KEY || undefined,
  llmEndpoint: process.env.LLM_ENDPOINT || "",
  llmModel: process.env.LLM_MODEL || "",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmSdkType:
    (process.env.LLM_SDK_TYPE as InitialConfig["llmSdkType"]) ||
    "openai-compatible",
};

export function isConfigured(config: InitialConfig): boolean {
  return (
    config.telegramBotToken.length > 0 &&
    config.julesApiKey.length > 0 &&
    config.llmEndpoint.length > 0 &&
    config.llmModel.length > 0 &&
    config.llmApiKey.length > 0
  );
}
