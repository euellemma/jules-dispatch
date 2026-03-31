import { internalAction } from "../_generated/server";
import type { Release } from "./types";

// TODO: Revert to production URL before deploying
const UPDATES_URL = "http://localhost:3001/test-updates.json";

function isValidRelease(obj: unknown): obj is Release {
  if (!obj || typeof obj !== "object") return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r.version === "string" &&
    (r.type === "minor" || r.type === "major") &&
    typeof r.date === "string" &&
    typeof r.title === "string" &&
    typeof r.body === "string"
  );
}

export const fetchUpdates = internalAction({
  args: {},
  handler: async (_ctx) => {
    try {
      const response = await fetch(UPDATES_URL, {
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        console.error(`[updater] Failed to fetch updates: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json() as unknown;

      if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).releases)) {
        console.error("[updater] Invalid updates.json: missing or invalid 'releases' array");
        return null;
      }

      const releases = ((data as Record<string, unknown>).releases as unknown[]).filter(isValidRelease);

      if (releases.length === 0 && Array.isArray((data as Record<string, unknown>).releases)) {
        console.error("[updater] No valid releases found in updates.json");
        return null;
      }

      return releases;
    } catch (error) {
      console.error("[updater] Error fetching updates:", error);
      return null;
    }
  },
});
