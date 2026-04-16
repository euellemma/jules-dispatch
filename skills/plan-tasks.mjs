#!/usr/bin/env node

import { readStdinJson, writeStdoutJsonAndExit, handleErrorAndExit, isMainModule } from './utils.mjs';

/**
 * @typedef {Object} Task
 * @property {string} [id]
 * @property {string} [title]
 * @property {string} [prompt]
 * @property {string[]} [files]
 * @property {string[]} [new_files]
 * @property {string[]} [test_files]
 */

/**
 * @typedef {Object} TasksJson
 * @property {Task[]} [tasks]
 */

/**
 * @typedef {Object} PlanTasksInput
 * @property {TasksJson} [tasksJson]
 * @property {number} [taskIndex]
 * @property {string} [codebaseContext]
 */

/**
 * Generates a self-contained prompt for a task.
 * @param {PlanTasksInput} inputData The parsed input data.
 * @returns {Object} The task plan output.
 */
export function planTask(inputData) {
  const { tasksJson = {}, taskIndex = 0, codebaseContext = "" } = inputData;
  const tasks = tasksJson.tasks || [];

  if (taskIndex < 0 || taskIndex >= tasks.length) {
    throw new Error(`Invalid taskIndex ${taskIndex}. Expected between 0 and ${tasks.length - 1}.`);
  }

  const task = tasks[taskIndex];
  const files = task.files || [];
  const new_files = task.new_files || [];
  const test_files = task.test_files || [];

  const fileBoundary = [...new Set([...files, ...new_files, ...test_files])];

  const promptParts = [];
  promptParts.push(`Task: ${task.title || "Unnamed Task"}`);
  if (task.prompt) {
    promptParts.push(`Description:\n${task.prompt}`);
  }
  if (codebaseContext) {
    promptParts.push(`Codebase Context:\n${codebaseContext}`);
  }
  if (fileBoundary.length > 0) {
    promptParts.push(`File Boundary Rules:\nYou are restricted to modifying or creating the following files:\n- ${fileBoundary.join('\n- ')}`);
  }

  const acceptanceCriteria = [];
  if (new_files.length > 0) {
    acceptanceCriteria.push(`Create new files: ${new_files.join(', ')}`);
  }
  if (files.length > 0) {
    acceptanceCriteria.push(`Modify existing files: ${files.join(', ')}`);
  }
  if (test_files.length > 0) {
    acceptanceCriteria.push(`Ensure tests pass in: ${test_files.join(', ')}`);
  }
  acceptanceCriteria.push("Implement the described task functionality");

  if (acceptanceCriteria.length > 0) {
    promptParts.push(`Acceptance Criteria:\n- ${acceptanceCriteria.join('\n- ')}`);
  }

  return {
    taskPrompt: promptParts.join('\n\n'),
    fileBoundary,
    acceptanceCriteria
  };
}

/**
 * Main execution function.
 */
export async function main() {
  try {
    const inputData = await readStdinJson();
    const result = planTask(inputData);
    writeStdoutJsonAndExit(result);
  } catch (err) {
    handleErrorAndExit(err);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
