import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import selfHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp();
app.use(agent);
app.use(selfHosting);

export default app;
