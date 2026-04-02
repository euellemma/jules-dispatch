import * as p from "@clack/prompts";
import { WizardError } from "../errors.js";
import {
  getPresetById,
  getPresetChoices,
  validateUrl,
  type AIPreset,
} from "../../shared/presets.js";

export async function runStepAIProvider(): Promise<{
  preset: AIPreset;
  apiKey: string;
}> {
  const choices = getPresetChoices();
  const selection = await p.select({
    message: "Select your AI provider",
    options: choices,
    initialValue: "opencode-zen",
  });

  if (p.isCancel(selection)) {
    process.exit(0);
  }

  const preset = getPresetById(selection as string);
  if (!preset) {
    throw new WizardError("Failed to get preset", "ai-provider", false);
  }

  // If custom, prompt for endpoint and model
  if (preset.id === "custom") {
    const endpoint = await p.text({
      message: "Enter API endpoint URL",
      placeholder: "https://api.example.com/v1",
      validate: (value) => {
        if (!value) return "Endpoint is required";
        if (!validateUrl(value)) return "Invalid URL format";
      },
    });

    if (p.isCancel(endpoint)) {
      process.exit(0);
    }

    const model = await p.text({
      message: "Enter model name",
      placeholder: "gpt-4-turbo",
      validate: (value) => {
        if (!value) return "Model name is required";
      },
    });

    if (p.isCancel(model)) {
      process.exit(0);
    }

    preset.endpoint = endpoint as string;
    preset.model = model as string;
  }

  // Prompt for API key
  const apiKey = await p.password({
    message: `Enter your ${preset.name} API key`,
    mask: "•",
    validate: (value) => {
      if (!value) return "API key is required";
    },
  });

  if (p.isCancel(apiKey)) {
    process.exit(0);
  }

  return { preset, apiKey: apiKey as string };
}
