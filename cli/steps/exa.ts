import * as p from "@clack/prompts";
import { link } from "../ui.js";

export async function runStepExa(): Promise<{ useExa: boolean; apiKey?: string }> {
  const message = `Exa gives your agent web search superpowers (1k free searches/mo)\n  Without it, your agent is limited to training data knowledge only.`;

  const choice = await p.confirm({
    message,
    initialValue: true,
  });

  if (p.isCancel(choice)) {
    process.exit(0);
  }

  if (!choice) {
    return { useExa: false };
  }

  const apiKey = await p.text({
    message: `Enter Exa API key ${link("https://dashboard.exa.ai")}`,
    validate: (v) => {
      if (!v || v.trim().length < 10) return "Please enter a valid API key";
    },
  });

  if (p.isCancel(apiKey)) {
    process.exit(0);
  }

  return { useExa: true, apiKey: (apiKey as string).trim() };
}
