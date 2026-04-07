/**
 * Extract file paths from a git unidiff patch string.
 * Returns just the file paths (no content).
 */
export function extractFilePaths(unidiff: string): string[] {
  const fileBlocks = unidiff.split(/(?=^diff --git)/m).filter(Boolean);
  const paths: string[] = [];

  for (const block of fileBlocks) {
    const pathMatch = block.match(/^\+\+\+ b\/(.+)$/m);
    if (pathMatch) paths.push(pathMatch[1]!);
  }

  return paths;
}

/**
 * Extract file paths and added content from a git unidiff patch string.
 * Used by processOutputs for session output file extraction.
 */
export function extractFilesFromDiff(
  unidiff: string,
): Array<{ path: string; content: string }> {
  const fileBlocks = unidiff.split(/(?=^diff --git)/m).filter(Boolean);
  const files: Array<{ path: string; content: string }> = [];

  for (const block of fileBlocks) {
    const pathMatch = block.match(/^\+\+\+ b\/(.+)$/m);
    if (!pathMatch) continue;

    const filePath = pathMatch[1]!;
    const lines = block.split("\n");
    const contentLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("@@")) continue;
      if (line.startsWith("diff --git")) continue;
      if (line.startsWith("index ")) continue;
      if (line.startsWith("new file")) continue;

      if (line.startsWith("+")) {
        contentLines.push(line.slice(1));
      }
    }

    if (contentLines.length > 0) {
      files.push({ path: filePath, content: contentLines.join("\n") });
    }
  }

  return files;
}
