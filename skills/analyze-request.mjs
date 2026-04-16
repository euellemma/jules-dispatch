#!/usr/bin/env node

import { readStdinJson, writeStdoutJsonAndExit, handleErrorAndExit, isMainModule } from './utils.mjs';

/**
 * @typedef {Object} RepoState
 * @property {boolean} [hasJulesDispatch]
 * @property {boolean} [existingPlan]
 * @property {boolean} [existingTasks]
 * @property {number} [openPRs]
 * @property {boolean} [recentFailures]
 */

/**
 * @typedef {Object} AnalyzeInput
 * @property {string} [input]
 * @property {RepoState} [repoState]
 */

/**
 * Analyzes a user request and repository state to recommend a role and scope.
 * @param {AnalyzeInput} inputData The parsed input data.
 * @returns {Object} The recommendation.
 */
export function analyzeRequest(inputData) {
  const { input = "", repoState = {} } = inputData;
  const state = {
    hasJulesDispatch: !!repoState.hasJulesDispatch,
    existingPlan: !!repoState.existingPlan,
    existingTasks: !!repoState.existingTasks,
    openPRs: repoState.openPRs || 0,
    recentFailures: !!repoState.recentFailures
  };

  const isTriage = /issue|triage|bug\s*list/i.test(input) || input.includes('ad-hoc') || input.includes('markdown');
  const isSmallChange = /fix\s*typo|small|minor|quick/i.test(input);

  if (!state.hasJulesDispatch) {
    return {
      role: "planner",
      scope: "greenfield",
      estimatedSessions: 1,
      reasoning: "No .jules-dispatch folder found, initiating greenfield project planning.",
      inputType: isTriage ? "triage" : "feature"
    };
  }

  if (state.recentFailures) {
    return {
      role: "debugger",
      scope: "iterative-complex",
      estimatedSessions: 1,
      reasoning: "Recent failures detected, handing off to debugger.",
      inputType: "bugfix"
    };
  }

  if (state.hasJulesDispatch && state.existingTasks) {
    return {
      role: "builder",
      scope: isSmallChange ? "iterative-small" : "iterative-new",
      estimatedSessions: 2,
      reasoning: "Pending tasks exist, continuing build phase.",
      inputType: isSmallChange ? "bugfix" : "feature"
    };
  }

  if (state.hasJulesDispatch && isSmallChange) {
    return {
      role: "builder",
      scope: "iterative-small",
      estimatedSessions: 1,
      reasoning: "Small focused change on initialized repository, directly assigning to builder.",
      inputType: "bugfix"
    };
  }

  if (state.openPRs > 0 && !state.existingTasks) {
    return {
      role: "merger",
      scope: "iterative-small",
      estimatedSessions: 1,
      reasoning: "Open PRs detected with no pending tasks, entering merge phase.",
      inputType: "merge"
    };
  }

  return {
    role: "planner",
    scope: isSmallChange ? "iterative-small" : "iterative-new",
    estimatedSessions: 3,
    reasoning: "New feature or request with initialized repository, entering planning phase.",
    inputType: isTriage ? "triage" : "feature"
  };
}

/**
 * Main execution function.
 */
export async function main() {
  try {
    const inputData = await readStdinJson();
    const result = analyzeRequest(inputData);
    writeStdoutJsonAndExit(result);
  } catch (err) {
    handleErrorAndExit(err);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
