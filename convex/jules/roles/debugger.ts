export interface DebuggerPromptParams {
  repo: string;
  branch: string;
  input: string;
  errorType: "test_failure" | "merge_conflict" | "build_error" | "runtime_error" | "ci_failure" | "stall";
  errorOutput?: string;
  taskContext?: {
    taskId: string;
    taskDescription: string;
    files: string[];
  };
  existingMemory?: string;
}

/**
 * Generates the prompt for the Debugger role based on the given parameters.
 *
 * @param params - Parameters containing context about the error and repository
 * @returns The constructed prompt string for the Debugger agent
 */
export function debuggerPrompt(params: DebuggerPromptParams): string {
  let prompt = `You are the Debugger for the repository ${params.repo} working on branch ${params.branch}.

Your objective is to fix complex test failures, resolve merge conflicts, recover stalled sessions, or handle drift between plan and implementation.

Problem Description:
${params.input}
`;

  if (params.errorType === "test_failure") {
    prompt += `
Error Type: Test Failure
- CI checks are failing on the PR.
- Please investigate the failing test output below.
- Fix the issue within the file boundary while maintaining backward compatibility.
- Ensure you re-run the tests locally if possible to verify your fix.
`;
  } else if (params.errorType === "merge_conflict") {
    prompt += `
Error Type: Merge Conflict
- The PR has conflicts with the base branch.
- Resolve the conflicts carefully, preserving both sides' changes as appropriate.
- If you touch dependencies, regenerate any lock files if needed.
`;
  } else if (params.errorType === "build_error") {
    prompt += `
Error Type: Build Error
- There are TypeScript, lint, or other compilation errors.
- Fix the compilation issues while maintaining existing behavior.
`;
  } else if (params.errorType === "runtime_error") {
    prompt += `
Error Type: Runtime Error
- Unexpected runtime behavior has been encountered.
- Investigate the root cause and propose/implement a fix.
`;
  } else if (params.errorType === "ci_failure") {
    prompt += `
Error Type: CI Failure
- The CI pipeline is failing (this may not just be test failures).
- Investigate the CI config and pipeline logs, and fix the pipeline issues.
`;
  } else if (params.errorType === "stall") {
    prompt += `
Error Type: Stall
- The previous session produced partial or no work.
- Resume from where it left off by checking existing progress and completing the remaining work.
`;
  }

  if (params.errorOutput) {
    prompt += `
Error Output/Logs:
${params.errorOutput}
`;
  }

  if (params.taskContext) {
    prompt += `
Task Context:
Task ID: ${params.taskContext.taskId}
Description: ${params.taskContext.taskDescription}
Relevant Files: ${params.taskContext.files.join(", ")}
`;
  }

  if (params.existingMemory) {
    prompt += `
Existing Memory/Context:
${params.existingMemory}
`;
  }

  prompt += `
Available Skills:
You can pipe error context via stdin to the following skill to get a structured fix strategy:
node skills/debug-analyze.mjs

After finishing your task, you must write a signal file to .jules-dispatch/signal.json with the following structure:
{
  "status": "fix_applied" | "fix_failed",
  "nextRole": "builder" | "merger" | null,
  "summary": "What was fixed",
  "taskId": "task-id",
  "questions": []
}
`;

  return prompt;
}
