import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll-jules-activities",
  { seconds: 30 },
  internal.polling.actions.pollJulesActivities,
);

crons.interval(
  "daily-checks",
  { seconds: 86400 },
  internal.dailyCheck.actions.runDailyChecks,
);

crons.interval(
  "check-provisioned-bots",
  { seconds: 60 },
  internal.provisioning.polling.checkProvisionedBots,
);

export default crons;
