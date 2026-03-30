export interface InitialConfig {
  julesApiKey: string;
  exaApiKey?: string;
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  llmSdkType: "openai" | "anthropic" | "google" | "openai-compatible";
}

export const INITIAL_CONFIG: InitialConfig = {
  julesApiKey: "",
  exaApiKey: undefined,
  llmEndpoint: "",
  llmModel: "",
  llmApiKey: "",
  llmSdkType: "openai-compatible",
};

export function isConfigured(config: InitialConfig): boolean {
  return (
    config.julesApiKey.length > 0 &&
    config.llmEndpoint.length > 0 &&
    config.llmModel.length > 0 &&
    config.llmApiKey.length > 0
  );
}
