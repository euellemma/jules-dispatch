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
    id: "google-studio",
    name: "Google AI Studio",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    sdkType: "google",
    model: "gemini-3-flash-preview",
    recommended: true,
    signUpUrl: "https://aistudio.google.com/app/apikey",
    description: "Fast Gemini models with generous free tier",
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    endpoint: "https://opencode.ai/zen/v1",
    sdkType: "openai-compatible",
    recommended: true,
    model: "qwen3.6-plus-free",
    signUpUrl: "https://opencode.ai/zen",
    description: "Free Qwen 3.6 Plus Trial at opencode.ai/zen",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    endpoint: "https://opencode.ai/zen/go/v1",
    sdkType: "anthropic",
    recommended: true,
    model: "minimax-m2.7",
    signUpUrl: "https://opencode.ai/go",
    description: "Low cost coding models",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    sdkType: "openai-compatible",
    model: "qwen/qwen3.6-plus-preview:free",
    signUpUrl: "https://openrouter.ai/keys",
    description: "Universal API for many models",
  },
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    sdkType: "openai",
    model: "gpt-5.4-mini",
    signUpUrl: "https://platform.openai.com/api-keys",
    description: "Industry standard with GPT-5 models",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    endpoint: "https://api.anthropic.com/v1",
    sdkType: "anthropic",
    model: "claude-sonnet-4-6",
    signUpUrl: "https://console.anthropic.com/settings/keys",
    description: "Claude models with excellent reasoning",
  },
  {
    id: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    sdkType: "openai-compatible",
    model: "llama-3.3-70b-versatile",
    signUpUrl: "https://console.groq.com/keys",
    description: "Blazing fast inference on open models",
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
  const preset =
    AI_PROVIDER_PRESETS.find((p) => p.recommended) ?? AI_PROVIDER_PRESETS[0]!;
  return preset;
}

export function getPresetChoices(): {
  value: string;
  label: string;
  hint?: string;
}[] {
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
