import { internalAction } from "../_generated/server";
import { v } from "convex/values";

/**
 * Fetch file content from Convex storage by storage ID.
 * Needed because ctx.storage is only available in actions/mutations.
 */
export const fetchContent = internalAction({
  args: { storageId: v.id("_storage") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Could not generate URL for storage ID");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
    return await response.text();
  },
});
