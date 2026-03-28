import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  exposeUploadApi,
  exposeDeploymentQuery,
} from "@convex-dev/static-hosting";

// Get the component's internal functions
const selfHosting = components.selfHosting;

// Expose upload API (singular URL generator)
export const { generateUploadUrl, recordAsset, gcOldAssets, listAssets } =
  exposeUploadApi(selfHosting);

// Also expose the batch upload URL generator (for CLI compatibility)
export const generateUploadUrls = internalMutation({
  args: { count: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const urls: string[] = [];
    for (let i = 0; i < args.count; i++) {
      urls.push(await ctx.storage.generateUploadUrl());
    }
    return urls;
  },
});

// Also expose the batch record assets function (for CLI compatibility)
export const recordAssets = internalMutation({
  args: {
    assets: v.array(v.object({
      path: v.string(),
      storageId: v.string(),
      contentType: v.string(),
      deploymentId: v.string(),
    })),
  },
  returns: v.object({
    recorded: v.number(),
  }),
  handler: async (ctx, args) => {
    let recorded = 0;
    for (const asset of args.assets) {
      await ctx.runMutation(selfHosting.lib.recordAsset, {
        path: asset.path,
        storageId: asset.storageId,
        contentType: asset.contentType,
        deploymentId: asset.deploymentId,
      });
      recorded++;
    }
    return { recorded };
  },
});

// Public query for live reload notifications
export const { getCurrentDeployment } =
  exposeDeploymentQuery(selfHosting);
