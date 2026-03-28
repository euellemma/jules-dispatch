import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll-jules-activities",
  { seconds: 30 },
  internal.polling.actions.pollJulesActivities,
);

export default crons;
