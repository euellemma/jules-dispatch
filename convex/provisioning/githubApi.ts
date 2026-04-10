"use node";
import * as crypto from "crypto";

export interface RepoInfo {
  repoUrl: string;
  fullName: string;
}

export interface WorkflowRun {
  id: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
}

function getGitHubHeaders(): Record<string, string> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set in environment");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubFetch(
  endpoint: string,
  options: RequestInit = {},
): Promise<any> {
  const url = `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getGitHubHeaders(),
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function createRepo(
  name: string,
  description?: string,
): Promise<RepoInfo> {
  try {
    const result = await githubFetch("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description || "",
        private: true,
        auto_init: false,
      }),
    });
    return {
      repoUrl: result.html_url,
      fullName: result.full_name,
    };
  } catch (error: any) {
    if (error.message?.includes("409")) {
      throw new Error(`Repository "${name}" already exists. Choose a different name.`);
    }
    throw error;
  }
}

export async function getRepoPublicKey(
  fullName: string,
): Promise<{ key: string; keyId: string }> {
  const result = await githubFetch(
    `/repos/${fullName}/actions/secrets/public-key`,
  );
  return { key: result.key, keyId: result.key_id };
}

export function encryptSecret(value: string, publicKeyB64: string): string {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKeyB64.replace(/(.{64})/g, "$1\n")}\n-----END PUBLIC KEY-----`;
  const buffer = Buffer.from(value, "utf8");
  const encrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    buffer,
  );
  return encrypted.toString("base64");
}

export async function setRepoSecret(
  fullName: string,
  secretName: string,
  encryptedValue: string,
  keyId: string,
): Promise<void> {
  await githubFetch(
    `/repos/${fullName}/actions/secrets/${secretName}`,
    {
      method: "PUT",
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    },
  );
}

export async function setAllRepoSecrets(
  fullName: string,
  secrets: Record<string, string>,
): Promise<void> {
  const { key, keyId } = await getRepoPublicKey(fullName);

  for (const [secretName, value] of Object.entries(secrets)) {
    const encrypted = encryptSecret(value, key);
    await setRepoSecret(fullName, secretName, encrypted, keyId);
  }
}

export async function getDefaultBranchSHA(fullName: string): Promise<string> {
  const result = await githubFetch(`/repos/${fullName}/git/ref/heads/main`);
  return result.object.sha;
}

export async function createBlob(
  fullName: string,
  content: string,
): Promise<string> {
  const result = await githubFetch(`/repos/${fullName}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  return result.sha;
}

export async function createTree(
  fullName: string,
  files: Array<{ path: string; sha: string }>,
  parentSHA: string,
): Promise<string> {
  const tree = files.map((f) => ({
    path: f.path,
    mode: "100644",
    type: "blob",
    sha: f.sha,
  }));

  const result = await githubFetch(`/repos/${fullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: parentSHA, tree }),
  });
  return result.sha;
}

export async function createCommit(
  fullName: string,
  message: string,
  treeSHA: string,
  parentSHA: string,
): Promise<string> {
  const result = await githubFetch(`/repos/${fullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: treeSHA,
      parents: [parentSHA],
    }),
  });
  return result.sha;
}

export async function pushInitialCommit(
  fullName: string,
  files: Array<{ path: string; content: string }>,
): Promise<string> {
  const batchSize = 50;
  let currentSHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    const blobs = await Promise.all(
      batch.map((f) => createBlob(fullName, f.content)),
    );

    const treeFiles = batch.map((f, idx) => ({
      path: f.path,
      sha: blobs[idx]!,
    }));

    const treeSHA = await createTree(fullName, treeFiles, currentSHA);
    const commitSHA = await createCommit(
      fullName,
      i === 0 ? "Initial source from upstream" : `Update files ${i + 1}-${i + batch.length}`,
      treeSHA,
      currentSHA,
    );

    currentSHA = commitSHA;
  }

  await githubFetch(`/repos/${fullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: "refs/heads/main",
      sha: currentSHA,
    }),
  });

  return currentSHA;
}

export async function createBranch(
  fullName: string,
  branchName: string,
  fromSHA: string,
): Promise<string> {
  const result = await githubFetch(`/repos/${fullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: fromSHA,
    }),
  });
  return result.ref;
}

export async function updateRef(
  fullName: string,
  ref: string,
  sha: string,
): Promise<void> {
  await githubFetch(`/repos/${fullName}/git/refs/${ref}`, {
    method: "PATCH",
    body: JSON.stringify({ sha, force: false }),
  });
}

export async function pushToBranch(
  fullName: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  message: string,
): Promise<void> {
  const ref = `heads/${branch}`;
  const refResult = await githubFetch(`/repos/${fullName}/git/refs/${ref}`);
  const currentSHA = refResult.object.sha;

  const blobs = await Promise.all(
    files.map((f) => createBlob(fullName, f.content)),
  );

  const treeFiles = files.map((f, idx) => ({
    path: f.path,
    sha: blobs[idx]!,
  }));

  const treeSHA = await createTree(fullName, treeFiles, currentSHA);
  const commitSHA = await createCommit(fullName, message, treeSHA, currentSHA);

  await updateRef(fullName, ref, commitSHA);
}

export async function getWorkflowRuns(
  fullName: string,
  branch?: string,
): Promise<WorkflowRun[]> {
  const url = `/repos/${fullName}/actions/runs?branch=${branch || ""}&per_page=5`;
  const result = await githubFetch(url);
  return (result.workflow_runs || []).map((run: any) => ({
    id: String(run.id),
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
  }));
}

export async function getWorkflowRunLogs(
  fullName: string,
  runId: string,
): Promise<string> {
  const result = await githubFetch(`/repos/${fullName}/actions/runs/${runId}/jobs`);
  const jobs = result.jobs || [];
  return jobs
    .map((job: any) => `${job.name}: ${job.conclusion || job.status}`)
    .join("\n");
}
