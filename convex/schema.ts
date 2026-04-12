import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  julesSessions: defineTable({
    threadId: v.string(),
    julesSessionId: v.string(),
    shortName: v.optional(v.string()),
    lastProcessedActivityTime: v.number(),
    lastKnownState: v.optional(v.string()),
    origin: v.union(v.literal("agent"), v.literal("discovered")),
    acknowledged: v.boolean(),
    inDashboard: v.boolean(),
    prefs: v.optional(v.object({
      approval: v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict")),
      verbosity: v.union(v.literal("silent"), v.literal("milestones"), v.literal("full")),
    })),
    repo: v.optional(v.string()),
    outputCount: v.number(),
  })
    .index("by_julesSessionId", ["julesSessionId"])
    .index("by_threadId", ["threadId"])
    .index("by_acknowledged", ["acknowledged"])
    .index("by_inDashboard", ["inDashboard"]),

  users: defineTable({
    telegramChatId: v.string(),
    threadId: v.string(), // ID of the Convex thread for conversation
    lastSearchingSentAt: v.optional(v.number()), // For debouncing "Searching..." messages
    isAgentRunning: v.optional(v.boolean()), // Is LLM currently processing for this user
    pendingMessageText: v.optional(v.string()), // Queued messages (newline separated)
    julesApiKey: v.optional(v.string()),
    exaApiKey: v.optional(v.string()),
    updateNotificationsEnabled: v.optional(v.boolean()), // User opt-in for update notifications
    lastNotifiedVersion: v.optional(v.string()), // Last version user was notified about
    memoryNudgeCount: v.optional(v.number()), // Turns since last memory nudge (persisted)
    consecutiveFailures: v.optional(v.number()), // For exponential backoff on LLM errors
    providerConfig: v.optional(
      v.object({
        endpoint: v.string(),
        model: v.string(),
        apiKey: v.string(),
        sdkType: v.union(
          v.literal("openai"),
          v.literal("anthropic"),
          v.literal("google"),
          v.literal("openai-compatible"),
        ),
      }),
    ),
  })
    .index("by_telegramChatId", ["telegramChatId"])
    .index("by_threadId", ["threadId"]),

  tasks: defineTable({
    threadId: v.string(),
    key: v.string(),
    content: v.string(),
  })
    .index("byThreadAndKey", ["threadId", "key"])
    .index("by_thread", ["threadId"]),

  sessionOutputs: defineTable({
    julesSessionId: v.string(),
    type: v.string(),
    source: v.optional(v.string()),
    baseCommitId: v.optional(v.string()),
    extractedFiles: v.optional(
      v.array(
        v.object({
          path: v.string(),
          storageId: v.optional(v.id("_storage")),
        }),
      ),
    ),
    patchStorageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    baseRef: v.optional(v.string()),
    headRef: v.optional(v.string()),
    activityId: v.optional(v.string()),
    isIncremental: v.optional(v.boolean()),
  }).index("by_julesSessionId", ["julesSessionId"]),

  uploadedFiles: defineTable({
    threadId: v.string(),
    storageId: v.id("_storage"),
    originalName: v.string(),
    assignedName: v.optional(v.string()), // The kebab-case name assigned by the agent
    caption: v.optional(v.string()),
    status: v.string(), // "unregistered" | "registered"
    size: v.number(), // in bytes
  })
    .index("by_threadId", ["threadId"])
    .index("by_thread_and_status", ["threadId", "status"]),

  memoryEntries: defineTable({
    userId: v.string(),           // telegramChatId — per-user, not per-thread
    target: v.union(v.literal("memory"), v.literal("user"), v.literal("skills")),
    content: v.string(),          // single entry, can be multiline
    createdAt: v.number(),
  }).index("by_user_and_target", ["userId", "target"]),

  threadSummaries: defineTable({
    threadId: v.string(),
    summary: v.string(),           // LLM-generated summary of compacted messages
    summarizedUpToOrder: v.number(), // message order up to which we've summarized
    createdAt: v.number(),
  }).index("by_threadId", ["threadId"]),

  sessionActivities: defineTable({
    julesSessionId: v.string(),
    type: v.string(),
    createTime: v.number(),
    summary: v.string(),
    filesChanged: v.optional(v.array(v.string())),
  }).index("by_session", ["julesSessionId"]),

  authSessions: defineTable({
    token: v.string(), // UUID
    telegramChatId: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  executor_kv: defineTable({
    userId: v.string(),     // telegramChatId or unique user id
    namespace: v.string(),  // e.g., "tools", "defs", "secrets" (refs)
    key: v.string(),        // the unique identifier within the namespace
    value: v.string(),      // JSON stringified metadata/definition
  })
    .index("by_user_ns_key", ["userId", "namespace", "key"])
    .index("by_user_ns", ["userId", "namespace"]),

  executor_secrets: defineTable({
    userId: v.string(),
    secretId: v.string(),
    value: v.string(),      // The actual secret value (API key/token)
  })
    .index("by_user_secretId", ["userId", "secretId"]),

  executor_sessions: defineTable({
    userId: v.string(),
    sandboxId: v.string(),
    image: v.string(),
    ipcToken: v.string(),
    lastUsedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_ipcToken", ["ipcToken"]),

  provisionedBots: defineTable({
    ownerId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    githubRepo: v.string(),
    convexSiteUrl: v.optional(v.string()),
    status: v.string(),
    sourceType: v.string(),
    lastDeployStatus: v.optional(v.string()),
    lastDeployCheckAt: v.optional(v.number()),
    lastDeployWorkflowRunId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_githubRepo", ["githubRepo"]),

  llmCalls: defineTable({
    threadId: v.string(),
    userId: v.string(),
    timestamp: v.number(),
    model: v.string(),
    provider: v.string(),
    requestBody: v.any(),
    responseBody: v.any(),
    finishReason: v.optional(v.string()),
    usage: v.optional(v.object({
      promptTokens: v.number(),
      completionTokens: v.number(),
      totalTokens: v.number(),
    })),
    durationMs: v.number(),
    status: v.union(v.literal("success"), v.literal("error")),
  }).index("by_timestamp", ["timestamp"]),
});
