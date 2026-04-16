"use node";

export interface JulesSignal {
  status: string;
  nextRole?: string;
  summary?: string;
  questions?: string[];
  taskId?: string;
}

export interface GitHubContentItem {
  name: string;
  path: string;
  type: string;
}

function getGitHubHeaders(): Record<string, string> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT not set");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubFetch(endpoint: string, options?: RequestInit): Promise<any> {
  const url = `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getGitHubHeaders(),
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`GitHub API error ${response.status}: ${body}`);
    (error as any).status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * Retrieves the content of a file from a GitHub repository.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param path The path to the file.
 * @param branch Optional branch name to read from.
 * @returns An object containing the decoded content and SHA, or null if the file does not exist.
 */
export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  branch?: string
): Promise<{ content: string; sha: string } | null> {
  let endpoint = `/repos/${owner}/${repo}/contents/${path}`;
  if (branch) {
    endpoint += `?ref=${encodeURIComponent(branch)}`;
  }

  try {
    const data = await githubFetch(endpoint);
    if (!data || !data.content) {
      return null;
    }
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { content, sha: data.sha };
  } catch (error: any) {
    if (error.status === 404 || error.message?.includes("404")) {
      return null;
    }
    throw error;
  }
}

/**
 * Creates or updates a file in a GitHub repository.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param path The path to the file.
 * @param content The new content of the file.
 * @param message The commit message.
 * @param branch The branch to commit to.
 * @param sha The SHA of the existing file, if updating.
 * @returns The commit information from the GitHub API.
 */
export async function createOrUpdateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<{ content: any; commit: any }> {
  const endpoint = `/repos/${owner}/${repo}/contents/${path}`;
  const body: any = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch,
  };
  if (sha) {
    body.sha = sha;
  }

  const result = await githubFetch(endpoint, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  return result;
}

/**
 * Lists the files and directories in a specific path of a GitHub repository.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param path The path to list contents for.
 * @param branch Optional branch name.
 * @returns An array of content items, or an empty array if the path does not exist.
 */
export async function listFiles(
  owner: string,
  repo: string,
  path: string,
  branch?: string
): Promise<Array<GitHubContentItem>> {
  let endpoint = `/repos/${owner}/${repo}/contents/${path}`;
  if (branch) {
    endpoint += `?ref=${encodeURIComponent(branch)}`;
  }

  try {
    const data = await githubFetch(endpoint);
    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        name: item.name,
        path: item.path,
        type: item.type,
      }));
    }
    return [];
  } catch (error: any) {
    if (error.status === 404 || error.message?.includes("404")) {
      return [];
    }
    throw error;
  }
}

/**
 * Deletes a file in a GitHub repository.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param path The path to the file.
 * @param message The commit message.
 * @param branch The branch to commit to.
 * @param sha The SHA of the file to delete.
 */
export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch: string,
  sha: string
): Promise<void> {
  const endpoint = `/repos/${owner}/${repo}/contents/${path}`;
  await githubFetch(endpoint, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha,
      branch,
    }),
  });
}

/**
 * Retrieves the SHA of a branch head.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param branch The branch name.
 * @returns The SHA of the branch head.
 */
export async function getBranchHead(
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const endpoint = `/repos/${owner}/${repo}/git/ref/heads/${branch}`;
  const data = await githubFetch(endpoint);
  return data.object.sha;
}

/**
 * Creates a new branch from a given SHA.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param branchName The new branch name.
 * @param fromSha The SHA to create the branch from.
 * @returns The ref name of the created branch.
 */
export async function createBranch(
  owner: string,
  repo: string,
  branchName: string,
  fromSha: string
): Promise<string> {
  const endpoint = `/repos/${owner}/${repo}/git/refs`;
  const data = await githubFetch(endpoint, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    }),
  });
  return data.ref;
}

/**
 * Reads and parses the .jules-dispatch/signal.json file.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param branch The branch name.
 * @returns The parsed JulesSignal object, or null if it doesn't exist or is invalid.
 */
export async function readSignalFile(
  owner: string,
  repo: string,
  branch: string
): Promise<JulesSignal | null> {
  const fileInfo = await getFileContent(owner, repo, ".jules-dispatch/signal.json", branch);
  if (!fileInfo) {
    return null;
  }
  try {
    return JSON.parse(fileInfo.content) as JulesSignal;
  } catch (error) {
    return null;
  }
}

/**
 * Writes the .jules-dispatch/signal.json file.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param branch The branch name.
 * @param signal The JulesSignal object to write.
 * @param sha Optional SHA of the existing file to update.
 */
export async function writeSignalFile(
  owner: string,
  repo: string,
  branch: string,
  signal: JulesSignal,
  sha?: string
): Promise<void> {
  const content = JSON.stringify(signal, null, 2);
  await createOrUpdateFile(
    owner,
    repo,
    ".jules-dispatch/signal.json",
    content,
    "Update Jules signal",
    branch,
    sha
  );
}

/**
 * Initializes the .jules-dispatch/ directory by creating a .gitkeep file.
 * @param owner The owner of the repository.
 * @param repo The repository name.
 * @param branch The branch name.
 */
export async function initJulesDispatchDir(
  owner: string,
  repo: string,
  branch: string
): Promise<void> {
  const existing = await getFileContent(owner, repo, ".jules-dispatch/.gitkeep", branch);
  if (!existing) {
    await createOrUpdateFile(
      owner,
      repo,
      ".jules-dispatch/.gitkeep",
      "",
      "Initialize .jules-dispatch directory",
      branch
    );
  }
}
