/**
 * Central Type Definitions for Jules Dispatch
 * 
 * This file contains all shared TypeScript interfaces and types used across the codebase.
 * Import types from here instead of using 'as any' casts.
 */

import { v } from "convex/values";
import type { Infer } from "convex/values";

// ============================================================================
// Database Document Types (from schema.ts)
// ============================================================================

/**
 * Session preferences configuration
 */
export const SessionPrefsValidator = v.object({
  approval: v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict")),
  verbosity: v.union(v.literal("silent"), v.literal("milestones"), v.literal("full")),
});

export type SessionPrefs = Infer<typeof SessionPrefsValidator>;

/**
 * Jules Session database document
 */
export interface JulesSessionDoc {
  _id: string;
  _creationTime: number;
  threadId: string;
  julesSessionId: string;
  shortName?: string;
  lastProcessedActivityTime: number;
  lastKnownState?: string;
  origin: "agent" | "discovered";
  acknowledged: boolean;
  inDashboard: boolean;
  prefs?: SessionPrefs;
  repo?: string;
}

/**
 * Provider configuration for LLM providers
 */
export const ProviderConfigValidator = v.object({
  endpoint: v.string(),
  model: v.string(),
  apiKey: v.string(),
  sdkType: v.union(
    v.literal("openai"),
    v.literal("anthropic"),
    v.literal("google"),
    v.literal("openai-compatible")
  ),
});

export type ProviderConfig = Infer<typeof ProviderConfigValidator>;

/**
 * User database document
 */
export interface UserDoc {
  _id: string;
  _creationTime: number;
  telegramChatId: string;
  threadId: string;
  lastSearchingSentAt?: number;
  isAgentRunning?: boolean;
  pendingMessageText?: string;
  julesApiKey?: string;
  exaApiKey?: string;
  providerConfig?: ProviderConfig;
}

/**
 * Task database document
 */
export interface TaskDoc {
  _id: string;
  _creationTime: number;
  threadId: string;
  key: string;
  content: string;
}

/**
 * Session output file extraction (database record)
 */
export interface ExtractedFile {
  path: string;
  storageId?: string;
}

/**
 * Session output database document
 */
export interface SessionOutputDoc {
  _id: string;
  _creationTime: number;
  julesSessionId: string;
  type: "changeSet" | "pullRequest" | string;
  source?: string;
  baseCommitId?: string;
  extractedFiles?: ExtractedFile[];
  patchStorageId?: string;
  url?: string;
  title?: string;
  description?: string;
  baseRef?: string;
  headRef?: string;
  activityId?: string;
  isIncremental?: boolean;
}

/**
 * Uploaded file database document
 */
export interface UploadedFileDoc {
  _id: string;
  _creationTime: number;
  threadId: string;
  storageId: string;
  originalName: string;
  assignedName?: string;
  caption?: string;
  status: "unregistered" | "registered";
  size: number;
}

/**
 * Observational memory database document
 */
export interface ObservationalMemoryDoc {
  _id: string;
  _creationTime: number;
  threadId: string;
  activeObservations: string;
  lastObservedAt: number;
  observationTokenCount: number;
}

/**
 * Auth session database document
 */
export interface AuthSessionDoc {
  _id: string;
  _creationTime: number;
  token: string;
  telegramChatId: string;
  expiresAt: number;
}

// ============================================================================
// Jules API Types (from Jules SDK)
// ============================================================================

/**
 * Jules API Session response
 * 
 * IMPORTANT: Based on actual Jules API responses from list endpoint:
 * - source field is NOT present in list responses
 * - Repo info comes via sourceContext.source (e.g., "sources/github/owner/repo")
 * - source.githubRepo only populated in single session fetch (session.info())
 * - outputs are discriminated by presence of changeSet/pullRequest, NOT by type field
 */
export interface JulesApiSession {
  id: string;
  title?: string;
  state?: JulesSessionState | string;
  sourceContext?: {
    source?: string;
    githubRepoContext?: {
      startingBranch?: string;
    };
    environmentVariablesEnabled?: boolean;
    [key: string]: unknown;
  };
  outputs?: JulesSessionOutput[];
  createTime?: string;
  updateTime?: string;
}

/**
 * Session output from Jules API
 * Discriminated by presence of changeSet or pullRequest, NOT by type field
 */
export interface JulesSessionOutput {
  changeSet?: {
    source?: string;
    gitPatch?: {
      unidiffPatch: string;
      baseCommitId?: string;
    };
  };
  pullRequest?: {
    url: string;
    title: string;
    description?: string;
    baseRef: string;
    headRef: string;
  };
}

/**
 * Jules API Activity types
 */
export type ActivityType = 
  | "progressUpdated"
  | "agentMessaged"
  | "planGenerated"
  | "planApproved"
  | "sessionCompleted"
  | "sessionFailed"
  | "userMessaged"
  | string;

/**
 * Plan step in a generated plan
 */
export interface PlanStep {
  index: number;
  title: string;
  description?: string;
}

/**
 * Plan generated by Jules
 */
export interface GeneratedPlan {
  title: string;
  steps: PlanStep[];
}

/**
 * Artifact from activity (e.g., changeSet, pullRequest)
 * 
 * NOTE: Raw API outputs don't have a `type` discriminator.
 * They are discriminated by the presence of `changeSet` or `pullRequest` fields.
 * The type field is added by SDK mapping.
 */
export interface ActivityArtifact {
  type?: "changeSet" | "pullRequest" | string;
  changeSet?: {
    gitPatch?: {
      unidiffPatch: string;
      baseCommitId?: string;
    };
    source?: string;
  };
  pullRequest?: {
    url: string;
    title: string;
    description?: string;
    baseRef: string;
    headRef: string;
  };
}

/**
 * Jules API Activity response
 */
export interface JulesActivity {
  id: string;
  type: ActivityType;
  createTime: string;
  originator?: "user" | "agent" | string;
  title?: string;
  description?: string;
  message?: string;
  plan?: GeneratedPlan;
  reason?: string;
  artifacts?: ActivityArtifact[];
}

/**
 * Jules session info response
 */
export interface JulesSessionInfo {
  id: string;
  state: string;
  title?: string;
  outputs: ActivityArtifact[];
  source?: {
    github?: string;
    [key: string]: unknown;
  };
  createTime?: string;
  updateTime?: string;
}

// ============================================================================
// Application Types
// ============================================================================

/**
 * Session information for display/management
 */
export interface SessionInfo {
  julesSessionId: string;
  title?: string;
  state?: string;
  repo?: string;
  shortName?: string;
  origin: "agent" | "discovered";
  acknowledged: boolean;
  inDashboard: boolean;
  prefs?: SessionPrefs;
  lastActivity?: string;
  createTimeMs?: number;
  prMetadata?: Array<{
    title?: string;
    description?: string;
  }>;
}

/**
 * Result from session query operations
 */
export type SessionQueryResult =
  | { success: true; sessions: SessionInfo[] }
  | { success: false; error: string };

/**
 * Waker event for polling notifications
 */
export interface WakerEvent {
  type: "discovered" | "resumed" | "state_change" | "message";
  sessionId: string;
  shortName: string;
  threadId: string;
  details: string;
}

/**
 * File registration input
 */
export interface FileRegistration {
  fileId: string;
  assignedName: string;
  action: "register" | "delete";
}

/**
 * File registration result
 */
export interface FileRegistrationResult {
  id: string;
  success: boolean;
  action?: string;
  name?: string;
  error?: string;
}

/**
 * Provider configuration response for frontend
 */
export interface ProviderConfigResponse {
  telegramChatId: string;
  config: ProviderConfig | null;
  julesApiKey?: string;
  exaApiKey?: string;
}

/**
 * Test connection result
 */
export interface TestConnectionResult {
  success: boolean;
  message?: string;
  error?: string;
}

// ============================================================================
// Telegram Types
// ============================================================================

/**
 * Telegram update payload
 */
export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Telegram message
 */
export interface TelegramMessage {
  message_id: number;
  chat: {
    id: number;
    type?: string;
  };
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  from?: {
    id: number;
    first_name?: string;
    username?: string;
  };
  date?: number;
}

/**
 * Telegram document attachment
 */
export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}

/**
 * Telegram callback query (from inline buttons)
 */
export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
  };
  message?: {
    message_id: number;
    chat: {
      id: number;
    };
  };
  data: string;
}

/**
 * Internal bot message payload (for local development)
 */
export interface InternalBotPayload {
  chatId?: string;
  text?: string;
  document?: {
    fileId: string;
    fileName: string;
    fileSize: number;
    caption?: string;
  };
  callbackQuery?: {
    queryId: string;
    data: string;
    chatId: string;
    messageId: number;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Generic result type for operations that can fail
 */
export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Nullable type helper
 */
export type Nullable<T> = T | null | undefined;

/**
 * Deep partial type for updates
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Jules Session States (from official API)
 * 
 * STATE_UNSPECIFIED - State is unspecified
 * QUEUED - Session is waiting to be processed
 * PLANNING - Jules is creating a plan
 * AWAITING_PLAN_APPROVAL - Plan is ready for user approval
 * AWAITING_USER_FEEDBACK - Jules needs user input
 * IN_PROGRESS - Jules is actively working
 * PAUSED - Session is paused
 * FAILED - Session failed
 * COMPLETED - Session completed successfully
 * 
 * Note: Sessions are RESUMABLE - sending a message to a COMPLETED/FAILED session
 * will transition it back to IN_PROGRESS or QUEUED.
 */
export type JulesSessionState = 
  | "STATE_UNSPECIFIED"
  | "QUEUED"
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "AWAITING_USER_FEEDBACK"
  | "IN_PROGRESS"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED";

/**
 * Check if a session state is "active" (not terminal)
 * Active states: QUEUED, PLANNING, AWAITING_PLAN_APPROVAL, AWAITING_USER_FEEDBACK, IN_PROGRESS
 * Terminal states: COMPLETED, FAILED
 * Paused state: PAUSED (can be resumed)
 */
export function isActiveState(state: string | undefined): boolean {
  if (!state) return false;
  const terminalStates = ["COMPLETED", "FAILED"];
  return !terminalStates.includes(state.toUpperCase());
}

/**
 * Check if a session needs user action
 * Needs action: AWAITING_PLAN_APPROVAL, AWAITING_USER_FEEDBACK, PAUSED
 */
export function needsUserAction(state: string | undefined): boolean {
  if (!state) return false;
  const actionStates = ["AWAITING_PLAN_APPROVAL", "AWAITING_USER_FEEDBACK", "PAUSED"];
  return actionStates.includes(state.toUpperCase());
}

/**
 * Get normalized state for display (handles lowercase/uppercase variants)
 */
export function normalizeState(state: string | undefined): JulesSessionState | "UNKNOWN" {
  if (!state) return "UNKNOWN";
  const upper = state.toUpperCase();
  const validStates: JulesSessionState[] = [
    "STATE_UNSPECIFIED", "QUEUED", "PLANNING", "AWAITING_PLAN_APPROVAL",
    "AWAITING_USER_FEEDBACK", "IN_PROGRESS", "PAUSED", "FAILED", "COMPLETED"
  ];
  if (validStates.includes(upper as JulesSessionState)) {
    return upper as JulesSessionState;
  }
  return "UNKNOWN";
}

/**
 * Session origin type
 */
export type SessionOrigin = "agent" | "discovered";

/**
 * File status type
 */
export type FileStatus = "unregistered" | "registered";

/**
 * Session update patch (for bulk updates)
 */
export interface SessionUpdatePatch {
  acknowledged?: boolean;
  inDashboard?: boolean;
  prefs?: Partial<SessionPrefs>;
}

/**
 * Processed output from session activities (before storage)
 */
export interface ProcessedOutput {
  type: string;
  source?: string;
  baseCommitId?: string;
  extractedFiles?: { path: string; content: string }[];
  patch?: string;
  url?: string;
  title?: string;
  description?: string;
  baseRef?: string;
  headRef?: string;
  activityId?: string;
  isIncremental?: boolean;
}

/**
 * Convex action context (simplified)
 */
export interface ActionContext {
  runQuery: <T, Args extends Record<string, unknown>>(
    query: { _handler: (ctx: unknown, args: Args) => Promise<T> },
    args: Args
  ) => Promise<T>;
  runMutation: <T, Args extends Record<string, unknown>>(
    mutation: { _handler: (ctx: unknown, args: Args) => Promise<T> },
    args: Args
  ) => Promise<T>;
  runAction: <T, Args extends Record<string, unknown>>(
    action: { _handler: (ctx: unknown, args: Args) => Promise<T> },
    args: Args
  ) => Promise<T>;
  scheduler: {
    runAfter: (delayMs: number, action: unknown, args: unknown) => Promise<unknown>;
  };
}

/**
 * HTTP request body types for settings API
 */
export interface SaveProviderConfigBody {
  token: string;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  sdkType?: string;
}

export interface SaveApiKeyBody {
  token: string;
  apiKey: string;
}

export interface TestConnectionBody {
  token: string;
  endpoint: string;
  model: string;
  apiKey: string;
  sdkType: string;
}

export interface GetConfigQuery {
  token: string;
}

// ============================================================================
// Re-export Convex types for convenience
// ============================================================================

export type { Infer } from "convex/values";
