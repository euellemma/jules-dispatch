import * as p from "@clack/prompts";
import { link, c } from "../ui.js";
import { parseDeployKey } from "../utils/deploy.js";

export async function promptForDeployKey(): Promise<string | null> {
  p.log.message(c.cyan("🔗 Convex Deploy Key"));
  p.log.info(
    c.dim(
      `1. Go to ${link("https://dashboard.convex.dev")}`,
    ),
  );
  p.log.info(c.dim("2. Create a new project"));
  p.log.info(c.dim("3. Settings → Deploy Keys"));
  p.log.info(c.dim("4. Create a new key"));

  const deployKey = await p.text({
    message: "Paste your Convex deploy key",
    placeholder: "team:project|eyJ...",
    validate: (value) => {
      if (!value) return "Deploy key is required";
      const info = parseDeployKey(value);
      if (!info) return "Invalid deploy key format";
    },
  });

  if (p.isCancel(deployKey)) {
    return null;
  }

  const info = parseDeployKey(deployKey as string);
  if (info) {
    p.log.success(`Team: ${c.bold(info.team)}`);
    p.log.success(`Deployment: ${c.bold(info.deploymentName)}`);
  }

  return deployKey as string;
}

export async function runStepConvex(): Promise<string | undefined> {
  return await promptForDeployKey() ?? undefined;
}
