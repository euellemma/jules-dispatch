import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Release } from "./types";

function _parseVersion(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
  };
}

function shouldNotify(
  release: Release,
  currentVersion: string | null,
): boolean {
  if (!currentVersion) return true;

  const releaseParsed = _parseVersion(release.version);
  const currentParsed = _parseVersion(currentVersion);

  if (!releaseParsed || !currentParsed) return false;

  if (releaseParsed.major > currentParsed.major) return true;
  if (releaseParsed.minor > currentParsed.minor) return true;

  return false;
}

function formatNotification(release: Release): string {
  const badge = release.type === "major" ? "🔴 MAJOR" : "🟡 MINOR";
  let message = `${badge} Update Available: v${release.version}\n\n`;
  message += `📦 ${release.title}\n`;
  message += release.body;

  if (release.url) {
    message += `\n\n🔗 ${release.url}`;
  }

  message += "\n\nRun `npx jules-dispatch update` to update.";

  return message;
}

export const checkForUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    const releases = await ctx.runAction(internal.updater.fetch.fetchUpdates);

    if (!releases || releases.length === 0) {
      console.log("[updater] No releases found or failed to fetch");
      return;
    }

    const users = await ctx.runQuery(
      internal.users.db.getAllUsersForUpdates,
      {},
    );

    for (const user of users) {
      const lastNotified = user.lastNotifiedVersion ?? null;

      for (const release of releases) {
        if (shouldNotify(release, lastNotified)) {
          const notification = formatNotification(release);

          try {
            await ctx.runAction(internal.api.telegram.sendChatMessage, {
              chatId: user.telegramChatId,
              message: notification,
            });
          } catch (err) {
            console.error(
              `[updater] Failed to send notification to ${user.telegramChatId}:`,
              err,
            );
          }

          await ctx.runMutation(internal.users.db.markNotifiedVersion, {
            telegramChatId: user.telegramChatId,
            version: release.version,
          });

          break;
        }
      }
    }
  },
});
