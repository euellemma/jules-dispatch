export interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  sdkType: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
}

export interface SettingsData {
  telegramChatId: string;
  config: ProviderConfig | null;
  julesApiKey?: string;
  exaApiKey?: string;
  updateNotificationsEnabled?: boolean;
}

export interface Preset {
  id: string;
  name: string;
  endpoint: string;
  sdkType: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
  model: string;
  recommended?: boolean;
}
