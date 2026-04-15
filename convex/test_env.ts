
import { internalAction } from "./_generated/server";

export const testEnv = internalAction({
  args: {},
  handler: async () => {
    return {
      GITHUB_PAT_SET: !!process.env.GITHUB_PAT,
      JULES_API_KEY_SET: !!process.env.JULES_API_KEY,
    };
  },
});
