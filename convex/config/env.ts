"use node";
function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

function getEnvVarOrDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function getOptionalEnvVar(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  get telegramBotToken(): string {
    return getEnvVar("TELEGRAM_BOT_TOKEN");
  },

  get julesApiKey(): string {
    return getEnvVar("JULES_API_KEY");
  },

  get llmEndpoint(): string {
    return getEnvVar("LLM_ENDPOINT");
  },

  get llmModel(): string {
    return getEnvVar("LLM_MODEL");
  },

  get llmApiKey(): string {
    return getEnvVar("LLM_API_KEY");
  },

  get llmSdkType(): string {
    return getEnvVarOrDefault("LLM_SDK_TYPE", "openai-compatible");
  },

  get exaApiKey(): string | undefined {
    return getOptionalEnvVar("EXA_API_KEY");
  },

  get githubPat(): string {
    return getEnvVarOrDefault("GITHUB_PAT", "");
  },

  get convexSiteUrl(): string {
    return getEnvVar("CONVEX_SITE_URL");
  },

  get daytonaApiKey(): string {
    return getEnvVar("DAYTONA_API_KEY");
  },
};