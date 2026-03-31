import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type WizardStep =
  | "location"
  | "telegram"
  | "jules"
  | "ai-provider"
  | "exa"
  | "convex"
  | "complete";

export interface WizardState {
  step: WizardStep;
  installPath?: string;
  telegramBotToken?: string;
  julesApiKey?: string;
  aiProviderId?: string;
  customEndpoint?: string;
  customModel?: string;
  customApiKey?: string;
  exaApiKey?: string;
  useExa?: boolean;
  deployKey?: string;
  lastUpdated: string;
}

const STATE_FILE = ".jules-dispatch-state.json";
const STATE_PATH = path.join(os.homedir(), STATE_FILE);

export function saveWizardState(state: Partial<WizardState>): void {
  const current = readWizardState();
  const merged: WizardState = {
    ...current,
    ...state,
    lastUpdated: new Date().toISOString(),
  };
  
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(merged, null, 2), "utf-8");
    fs.chmodSync(STATE_PATH, 0o600);
  } catch (error) {
    console.warn("[jules-dispatch] Warning: Failed to save wizard state:", error);
    // Continue - state is nice-to-have, not critical for operation
  }
}

export function readWizardState(): WizardState {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const content = fs.readFileSync(STATE_PATH, "utf-8");
      return JSON.parse(content) as WizardState;
    }
  } catch {
    // Ignore read errors
  }
  return { step: "location", lastUpdated: new Date().toISOString() };
}

export function clearWizardState(): void {
  try {
    if (fs.existsSync(STATE_PATH)) {
      fs.unlinkSync(STATE_PATH);
    }
  } catch (error) {
    console.warn("[jules-dispatch] Warning: Failed to clear wizard state:", error);
    // Continue - orphaned state file is harmless
  }
}

export function hasInterruptedSetup(): boolean {
  const state = readWizardState();
  // Consider interrupted if not complete and has some data
  return state.step !== "complete" && state.step !== "location" && !!state.installPath;
}

export function getWizardProgress(state: WizardState): { current: number; total: number } {
  const steps: WizardStep[] = ["location", "telegram", "jules", "ai-provider", "exa", "convex", "complete"];
  const current = steps.indexOf(state.step);
  return { current: current + 1, total: steps.length - 1 };
}
