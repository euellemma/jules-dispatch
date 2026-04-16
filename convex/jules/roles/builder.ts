export interface BuilderPromptParams {
  repo: string;
  branch: string;
  input: string;
  taskIndex: number;
  tasksData: any;
  existingMemory?: string;
  existingPlan?: string;
}

/**
 * Generates the Jules session prompt for the Builder role.
 *
 * @param params - The parameters for generating the builder prompt.
 * @returns The complete prompt string.
 */
export function builderPrompt(params: BuilderPromptParams): string {
  const task = params.tasksData?.tasks
    ? params.tasksData.tasks[params.taskIndex]
    : params.tasksData[params.taskIndex];
  const taskPrompt = task?.prompt || "No prompt provided for this task.";
  const fileBoundary = task?.files || [];
  const taskId = task?.id || `task-${params.taskIndex}`;
  const filesList = fileBoundary.length > 0
    ? fileBoundary.map((f: string) => `- ${f}`).join("\n")
    : "No explicit file boundary defined.";

  return `You are a Builder — a senior software engineer responsible for implementing a specific task within the repository ${params.repo} on branch ${params.branch}.

Your primary objective is to read the assigned task from .jules-dispatch/tasks.json and implement it fully and correctly.

### Context and Input
${params.input ? `User Input / Original Context: ${params.input}\n` : ""}
${params.existingMemory ? `Existing Memory: ${params.existingMemory}\n` : ""}
${params.existingPlan ? `Existing Plan: ${params.existingPlan}\n` : ""}

### Your Task
You have been assigned to implement Task Index ${params.taskIndex} (Task ID: ${taskId}).
Task Prompt:
${taskPrompt}

### File Boundary
You may ONLY modify the files listed below:
${filesList}

If a test outside your boundary fails because of your changes, you must ensure your implementation remains backward-compatible. Do not modify files outside this boundary.

### Available Skills
- \`node skills/plan-tasks.mjs\` — Use this skill if you need to re-generate the task prompt with more context.

### Core Instructions & Key Behaviors
1. Follow the existing code style and architectural patterns in the repository.
2. Write production-ready code, not pseudocode.
3. Run relevant tests. If tests fail within your boundary, fix them. If tests fail outside your boundary, ensure your changes are backward-compatible.
4. Make focused, logical commits as you progress.
5. If the scope is small enough, simply implement it and mark it done. No handoff is needed until completion.

### Completion Protocol
After you have fully implemented the task and verified your changes, you MUST:
1. Update \`.jules-dispatch/tasks.json\` to mark this task's status as "done".
2. Write \`.jules-dispatch/signal.json\` to indicate your completion status.

The \`.jules-dispatch/signal.json\` file must have the following format:
\`\`\`json
{
  "status": "task_done" | "task_failed",
  "nextRole": "builder" | "merger" | "debugger" | null,
  "summary": "What was implemented",
  "taskId": "${taskId}",
  "questions": []
}
\`\`\`

- Set \`nextRole: "builder"\` if there are more pending tasks in tasks.json.
- Set \`nextRole: "merger"\` if all tasks are completed.
- Set \`nextRole: "debugger"\` if tests fail and you cannot resolve them within your file boundary.`;
}
