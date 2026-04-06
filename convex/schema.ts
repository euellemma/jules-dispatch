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

  observationalMemory: defineTable({
    threadId: v.string(),
    activeObservations: v.string(),
    lastObservedAt: v.number(),
    observationTokenCount: v.number(),
  }).index("by_threadId", ["threadId"]),

  authSessions: defineTable({
    token: v.string(), // UUID
    telegramChatId: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),
});
