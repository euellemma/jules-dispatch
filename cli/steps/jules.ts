import * as p from "@clack/prompts";
import { link } from "../ui.js";

export async function runStepJules(): Promise<string> {
  const apiKey = await p.password({
    message: `Enter your Jules API key ${link("https://jules.google.com/settings/api")}`,
    mask: "•",
    validate: (value) => {
      if (!value) return "Jules API key is required";
    },
  });

  if (p.isCancel(apiKey)) {
    process.exit(0);
  }

  return apiKey as string;
}
