#!/usr/bin/env node

import { readStdinJson, writeStdoutJsonAndExit, handleErrorAndExit, isMainModule } from './utils.mjs';

/**
 * @typedef {Object} TaskContext
 * @property {string} [taskId]
 * @property {string} [taskDescription]
 * @property {string[]} [files]
 */

/**
 * @typedef {Object} DebugAnalyzeInput
 * @property {string} [errorOutput]
 * @property {TaskContext} [taskContext]
 * @property {string} [type]
 */

/**
 * Analyzes error output to produce a structured fix strategy.
 * @param {DebugAnalyzeInput} inputData The parsed input data.
 * @returns {Object} The analysis result.
 */
export function analyzeError(inputData) {
  const { errorOutput = "", taskContext = {}, type = "runtime_error" } = inputData;
  const files = taskContext.files || [];

  const result = {
    errorType: type,
    rootCause: "Unknown error",
    affectedFiles: files,
    fixStrategy: "Review logs and error output to diagnose the issue.",
    isRecoverable: true,
    suggestedAction: "retry",
    correctionPrompt: ""
  };

  const lowerError = errorOutput.toLowerCase();

  if (type === "test_failure" || lowerError.includes("test failed") || lowerError.includes("expect(")) {
    result.errorType = "test_failure";
    result.rootCause = "One or more tests failed assertions.";
    result.fixStrategy = "1. Identify the failing test.\n2. Review test expectations against code behavior.\n3. Modify code or test to align.";
    result.suggestedAction = "correction_message";
    result.correctionPrompt = `Tests are failing with the following output:\n${errorOutput}\nPlease fix the failing tests.`;
  } else if (type === "merge_conflict" || lowerError.includes("conflict") || lowerError.includes("merge failed")) {
    result.errorType = "merge_conflict";
    result.rootCause = "Git merge conflict encountered.";
    result.fixStrategy = "1. Locate files with conflict markers (<<<<<<<, =======, >>>>>>>).\n2. Manually resolve conflicts preserving required changes.\n3. Commit resolved files.";
    result.suggestedAction = "human_intervention";
    result.isRecoverable = false;
  } else if (type === "build_error" || lowerError.includes("error tsc") || lowerError.includes("compile error") || lowerError.includes("syntaxerror")) {
    result.errorType = "build_error";
    result.rootCause = "Compilation or syntax error prevented build.";
    result.fixStrategy = "1. Find the file and line number reported in the error.\n2. Fix syntax or type errors.\n3. Re-run the build.";
    result.suggestedAction = "correction_message";
    result.correctionPrompt = `The build failed with the following error:\n${errorOutput}\nPlease fix the build errors.`;
  } else {
    result.rootCause = "A runtime or generic execution error occurred.";
    result.suggestedAction = "new_session";
  }

  return result;
}

/**
 * Main execution function.
 */
export async function main() {
  try {
    const inputData = await readStdinJson();
    const result = analyzeError(inputData);
    writeStdoutJsonAndExit(result);
  } catch (err) {
    handleErrorAndExit(err);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
