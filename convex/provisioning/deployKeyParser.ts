export function parseDeployKey(deployKey: string): {
  convexUrl: string;
  convexSiteUrl: string;
  deploymentName: string;
  environment: string;
} | null {
  const parts = deployKey.split("|");
  if (parts.length < 2) return null;

  const prefix = parts[0];
  if (!prefix) return null;

  const colonIdx = prefix.indexOf(":");
  if (colonIdx < 0) return null;

  const environment = prefix.substring(0, colonIdx);
  const deploymentName = prefix.substring(colonIdx + 1);

  if (!deploymentName) return null;

  return {
    convexUrl: `https://${deploymentName}.convex.cloud`,
    convexSiteUrl: `https://${deploymentName}.convex.site`,
    deploymentName,
    environment,
  };
}
