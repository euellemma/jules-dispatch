import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

export const saveSessionOutputs = internalAction({
  args: {
    julesSessionId: v.string(),
    outputs: v.array(v.object({
      type: v.string(),
      source: v.optional(v.string()),
      baseCommitId: v.optional(v.string()),
      extractedFiles: v.optional(v.array(v.object({
        path: v.string(),
        content: v.string(),
      }))),
      patch: v.optional(v.string()),
      url: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      baseRef: v.optional(v.string()),
      headRef: v.optional(v.string()),
      activityId: v.optional(v.string()),
      isIncremental: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    for (const output of args.outputs) {
      const patchStorageId = output.patch
        ? await ctx.storage.store(
            new Blob([output.patch], { type: "text/plain" })
          )
        : undefined;

      const processedFiles = output.extractedFiles
        ? await Promise.all(
            output.extractedFiles.map(async (f) => ({
              path: f.path,
              storageId: f.content
                ? await ctx.storage.store(
                    new Blob([f.content], { type: "text/plain" })
                  )
                : undefined,
            }))
          )
        : undefined;

      await ctx.runMutation(internal.sessions.db.saveSessionOutputRecord, {
        julesSessionId: args.julesSessionId,
        output: {
          type: output.type,
          source: output.source,
          baseCommitId: output.baseCommitId,
          extractedFiles: processedFiles,
          patchStorageId,
          url: output.url,
          title: output.title,
          description: output.description,
          baseRef: output.baseRef,
          headRef: output.headRef,
          activityId: output.activityId,
          isIncremental: output.isIncremental,
        },
      });
    }
  },
});
