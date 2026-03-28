import { internalMutation } from "../_generated/server";

export const clearAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deletedCount = 0;
    
    // Wipe sessions
    const sessions = await ctx.db.query("julesSessions").take(1000);
    for (const doc of sessions) {
      await ctx.db.delete(doc._id);
      deletedCount++;
    }

    // Wipe users
    const users = await ctx.db.query("users").take(1000);
    for (const doc of users) {
      await ctx.db.delete(doc._id);
      deletedCount++;
    }
    
    return { deletedCount };
  }
});
