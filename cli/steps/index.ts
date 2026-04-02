import * as p from "@clack/prompts";
import { runStepLocation } from "./location.js";
import { runStepTelegram } from "./telegram.js";
import { runStepJules } from "./jules.js";
import { runStepAIProvider } from "./aiProvider.js";
import { runStepExa } from "./exa.js";
import { runStepConvex } from "./convex.js";
import { handleError, type WizardStep } from "../errors.js";
import { printStep } from "../ui.js";

export {
  runStepLocation,
  runStepTelegram,
  runStepJules,
  runStepAIProvider,
  runStepExa,
  runStepConvex,
};

export interface StepContext {
  installPath: string;
  telegramToken: string;
  julesApiKey: string;
  aiProvider: {
    endpoint: string;
    model: string;
    sdkType: string;
  };
  customApiKey: string;
  exaApiKey?: string;
  useExa: boolean;
  deployKey?: string;
}

interface Step {
  id: WizardStep;
  label: string;
  run: (ctx: Partial<StepContext>) => Promise<void>;
}

export async function runSteps(
  steps: Step[],
  context: Partial<StepContext>,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    printStep(step.label);

    try {
      await step.run(context);
    } catch (error) {
      handleError(error, step.id);

      const retry = await p.confirm({
        message: "Try again?",
        initialValue: true,
      });

      if (p.isCancel(retry) || !retry) {
        process.exit(1);
      } else {
        i--; // Retry current step
        continue;
      }
    }
  }
}
