import * as p from "@clack/prompts";
import { link } from "../ui.js";

export async function runStepTelegram(): Promise<string> {
  const token = await p.password({
    message:
      `Enter your Telegram bot token ${link("https://t.me/BotFather")}`,
    mask: "•",
    validate: (value) => {
      if (!value) return "Telegram bot token is required";
    },
  });

  if (p.isCancel(token)) {
    process.exit(0);
  }

  return token as string;
}
