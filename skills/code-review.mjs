#!/usr/bin/env node

import { readStdinJson, writeStdoutJsonAndExit, handleErrorAndExit, isMainModule } from './utils.mjs';

/**
 * @typedef {Object} CodeReviewInput
 * @property {string} [diff]
 * @property {string} [prTitle]
 * @property {string} [prDescription]
 * @property {string[]} [changedFiles]
 */

/**
 * Conducts a code review based on PR data.
 * @param {CodeReviewInput} inputData The parsed input data.
 * @returns {Object} The code review output.
 */
export function conductCodeReview(inputData) {
  const { diff = "", prTitle = "", prDescription = "", changedFiles = [] } = inputData;

  const findings = [];
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  let handoffTarget = null;
  let verdict = "APPROVE";
  let summary = "Review completed successfully. No critical issues found.";

  if (!diff || changedFiles.length === 0) {
    return {
      verdict: "APPROVE",
      severityCounts,
      findings,
      summary: "Empty PR or no changed files.",
      handoffTarget
    };
  }

  if (diff.includes("console.log") && changedFiles.some(f => !f.includes("test") && !f.includes("utils"))) {
    findings.push({
      severity: "low",
      category: "quality",
      file: changedFiles[0],
      line: 0,
      description: "Leftover console.log statement.",
      suggestion: "Remove console.log or use a proper logging framework."
    });
    severityCounts.low++;
  }

  if (diff.includes("TODO") || diff.includes("FIXME")) {
    findings.push({
      severity: "medium",
      category: "quality",
      file: changedFiles[0],
      line: 0,
      description: "Unresolved TODO or FIXME comment found.",
      suggestion: "Resolve the issue or create a ticket for it."
    });
    severityCounts.medium++;
  }

  if (severityCounts.critical > 0 || severityCounts.high > 0) {
    verdict = "REJECT_AND_HANDOFF";
    handoffTarget = "debugger";
    summary = "Review found critical/high severity issues. Handoff to debugger recommended.";
  } else if (severityCounts.medium > 0 || severityCounts.low > 0) {
    verdict = "APPROVE_WITH_NOTES";
    summary = "Review approved with some minor notes.";
  }

  return {
    verdict,
    severityCounts,
    findings,
    summary,
    handoffTarget
  };
}

/**
 * Main execution function.
 */
export async function main() {
  try {
    const inputData = await readStdinJson();
    const result = conductCodeReview(inputData);
    writeStdoutJsonAndExit(result);
  } catch (err) {
    handleErrorAndExit(err);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
