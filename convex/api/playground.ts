import { definePlaygroundAPI } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { julesAgent } from "../agent/instance";

/**
 * Expose the playground API for local/hosted UI.
 * Connect using an API key generated via:
 * npx convex run --component agent apiKeys:issue '{name:"euel"}'
 * 
 * Module Path: api/playground
 */
export const {
  isApiKeyValid,
  listAgents,
  listUsers,
  listThreads,
  listMessages,
  createThread,
  generateText,
  fetchPromptContext,
} = definePlaygroundAPI(components.agent, {
  agents: [julesAgent],
});
