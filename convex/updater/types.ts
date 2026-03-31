import { v } from "convex/values";

export const releaseType = v.union(
  v.literal("minor"),
  v.literal("major"),
);

export const releaseSchema = v.object({
  version: v.string(),
  type: releaseType,
  date: v.string(),
  title: v.string(),
  body: v.string(),
  url: v.optional(v.string()),
});

export const updatesJsonSchema = v.object({
  releases: v.array(releaseSchema),
});

export type Release = {
  version: string;
  type: "minor" | "major";
  date: string;
  title: string;
  body: string;
  url?: string;
};

export type UpdatesJson = {
  releases: Release[];
};
