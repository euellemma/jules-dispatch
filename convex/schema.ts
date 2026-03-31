import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  julesSessions: defineTable({
    threadId: v.string(), // Links to the Agent thread
    julesSessionId: v.string(), // The remote Jules session ID
    shortName: v.optional(v.string()), // 5-word kebab-case generated name (set when acknowledged)
    lastProcessedActivityTime: v.number(), // timestamp/cursor for cron polling (legacy)
    lastKnownState: v.optional(v.string()), // The last session.info().state we saw
    isActive: v.optional(v.boolean()), // false when session reaches 'completed' or 'failed'
    origin: v.union(v.literal("agent"), v.literal("discovered")), // "agent" = created by bot, "discovered" = found via polling
    acknowledged: v.boolean(), // user/agent has seen and decided
    inDashboard: v.boolean(), // shown in dashboard
    prefs: v.optional(v.object({
      approval: v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict")),
      verbosity: v.union(v.literal("silent"), v.literal("milestones"), v.literal("full")),
    })), // Session interaction preferences toward the user
  })
    .index("by_julesSessionId", ["julesSessionId"])
    .index("by_threadId", ["threadId"])
    .index("by_isActive", ["isActive"])
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
    .index("by_thread_and_key", ["threadId", "key"])
    .index("by_thread", ["threadId"]),

  sessionOutputs: defineTable({
    julesSessionId: v.string(),
    type: v.string(), // "changeSet" | "pullRequest"
    source: v.optional(v.string()), // Git source for changeSet
    baseCommitId: v.optional(v.string()), // Base commit for changeSet
    extractedFiles: v.optional(
      v.array(
        v.object({
          path: v.string(),
          content: v.string(),
        }),
      ),
    ),
    patch: v.optional(v.string()), // Unified diff if available
    url: v.optional(v.string()), // PR URL for pullRequest
    title: v.optional(v.string()), // PR title
    description: v.optional(v.string()), // PR description
    baseRef: v.optional(v.string()), // PR base branch
    headRef: v.optional(v.string()), // PR head branch
    activityId: v.optional(v.string()), // ID of the activity that produced this output
    isIncremental: v.optional(v.boolean()), // true if from progressUpdated, false if from session.info().outputs
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

  observational_memory: defineTable({
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
