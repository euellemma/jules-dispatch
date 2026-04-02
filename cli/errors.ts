import * as p from "@clack/prompts";
import c from "picocolors";

export type WizardStep =
  | "location"
  | "telegram"
  | "jules"
  | "ai-provider"
  | "exa"
  | "convex"
  | "complete";

export class WizardError extends Error {
  constructor(
    message: string,
    public readonly step: WizardStep,
    public readonly recoverable: boolean = true,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "WizardError";
  }
}

export function handleError(error: unknown, _currentStep: WizardStep): void {
  if (error instanceof WizardError) {
    p.log.error(c.red(error.message));
    if (error.suggestion) {
      p.log.info(c.dim(`💡 ${error.suggestion}`));
    }
    if (error.recoverable) {
      p.log.info(c.dim("You can go back and try again, or cancel with Ctrl+C"));
    }
  } else if (error instanceof Error) {
    p.log.error(c.red(`Unexpected error: ${error.message}`));
    p.log.info(
      c.dim(
        "If this persists, please check your connection or try again later.",
      ),
    );
  } else {
    p.log.error(c.red("An unknown error occurred"));
  }
}
