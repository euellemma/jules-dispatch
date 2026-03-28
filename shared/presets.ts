/**
 * AI Provider Presets - Single Source of Truth
 * Shared between CLI and web UI
 */

export interface AIPreset {
  id: string;
  name: string;
  endpoint: string;
  sdkType: "openai" | "anthropic" | "google" | "openai-compatible";
  model: string;
  recommended?: boolean;
  signUpUrl: string;
  description?: string;
}

export const AI_PROVIDER_PRESETS: AIPreset[] = [
  {
    id: "opencode",
    name: "OpenCode Zen",
    endpoint: "https://opencode.ai/zen/go/v1",
    sdkType: "openai-compatible",
    model: "mimo-v2-pro-free",
    recommended: true,
    signUpUrl: "https://opencode.ai/zen",
    description: "Free MiMo-V2-Pro Trial at opencode.ai/zen",
  },
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    sdkType: "openai",
    model: "gpt-4o",
    signUpUrl: "https://platform.openai.com/api-keys",
    description: "Industry standard with GPT-4 models",
  },
  {
    id: "google-studio",
    name: "Google AI Studio",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    sdkType: "google",
    model: "gemini-2.0-flash",
    signUpUrl: "https://aistudio.google.com/app/apikey",
    description: "Fast Gemini models with generous free tier",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    endpoint: "https://api.anthropic.com/v1",
    sdkType: "anthropic",
    model: "claude-3-5-sonnet-latest",
    signUpUrl: "https://console.anthropic.com/settings/keys",
    description: "Claude models with excellent reasoning",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    sdkType: "openai",
    model: "xiaomi/mimo-v2-pro",
    signUpUrl: "https://openrouter.ai/keys",
    description: "Universal API for many models",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    sdkType: "openai",
    model: "deepseek-chat",
    signUpUrl: "https://platform.deepseek.com/api_keys",
    description: "Cost-effective Chinese LLM",
  },
  {
    id: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    sdkType: "openai",
    model: "llama-3.3-70b-versatile",
    signUpUrl: "https://console.groq.com/keys",
    description: "Blazing fast inference on open models",
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    endpoint: "https://api.moonshot.cn/v1",
    sdkType: "openai-compatible",
    model: "moonshot-v1-8k",
    signUpUrl: "https://platform.moonshot.cn/console/api-keys",
    description: "Long context window specialist",
  },
  {
    id: "minimax",
    name: "MiniMax",
    endpoint: "https://api.minimax.chat/v1",
    sdkType: "openai-compatible",
    model: "abab6.5s-chat",
    signUpUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    description: "Chinese multimodal AI platform",
  },
  {
    id: "glm",
    name: "GLM (Zhipu AI)",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/",
    sdkType: "openai-compatible",
    model: "glm-4-flash",
    signUpUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    description: "Open-source Chinese LLM series",
  },
  {
    id: "custom",
    name: "Custom / Other",
    endpoint: "",
    sdkType: "openai-compatible",
    model: "",
    signUpUrl: "",
    description: "Configure your own provider manually",
  },
];

export function getPresetById(id: string): AIPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id);
}

export function getRecommendedPreset(): AIPreset {
  const preset = AI_PROVIDER_PRESETS.find((p) => p.recommended) ?? AI_PROVIDER_PRESETS[0]!;
  return preset;
}

export function getPresetChoices(): { value: string; label: string; hint?: string }[] {
  return AI_PROVIDER_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.recommended ? `★ ${preset.name}` : preset.name,
    hint: preset.description,
  }));
}

export function validateApiKeyFormat(key: string, providerId: string): boolean {
  if (!key || key.trim().length < 8) return false;

  // Basic pattern checks
  const patterns: Record<string, RegExp> = {
    openai: /^sk-[a-zA-Z0-9]{20,}$/,
    anthropic: /^sk-ant-[a-zA-Z0-9-_]{20,}$/,
    google: /^[A-Za-z0-9_-]{20,}$/,
  };

  const pattern = patterns[providerId];
  if (!pattern) return true; // No strict validation for other providers

  return pattern.test(key.trim());
}

export function validateTelegramToken(token: string): boolean {
  // Telegram bot token format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
  const pattern = /^\d+:[A-Za-z0-9_-]{35,}$/;
  return pattern.test(token.trim());
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
