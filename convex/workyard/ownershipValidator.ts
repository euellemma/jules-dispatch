export interface OwnershipConflict {
  file: string;
  task1: string;
  task2: string;
}

export interface Task {
  id: string;
  title?: string;
  files: string[];
  new_files: string[];
  test_files: string[];
  risk?: "low" | "medium" | "high";
  prompt?: string;
}

export function validateOwnership(tasks: Task[]): OwnershipConflict[] {
  const claimed = new Map<string, string>();
  const conflicts: OwnershipConflict[] = [];

  for (const task of tasks) {
    const allFiles = [...task.files, ...task.new_files, ...task.test_files];
    for (const file of allFiles) {
      const existing = claimed.get(file);
      if (existing && existing !== task.id) {
        conflicts.push({
          file,
          task1: existing,
          task2: task.id,
        });
      } else {
        claimed.set(file, task.id);
      }
    }
  }

  return conflicts;
}

export function mergeConflictingTasks(tasks: Task[], conflicts: OwnershipConflict[]): Task[] {
  if (conflicts.length === 0) {
    return tasks;
  }

  const mergeGroups = new Map<string, Set<string>>();

  // Find all components of connected conflicts
  for (const conflict of conflicts) {
    const { task1, task2 } = conflict;

    let group1 = mergeGroups.get(task1);
    let group2 = mergeGroups.get(task2);

    if (group1 && group2) {
      if (group1 !== group2) {
        // Merge the two groups
        for (const id of group2) {
          group1.add(id);
          mergeGroups.set(id, group1);
        }
      }
    } else if (group1) {
      group1.add(task2);
      mergeGroups.set(task2, group1);
    } else if (group2) {
      group2.add(task1);
      mergeGroups.set(task1, group2);
    } else {
      const newGroup = new Set([task1, task2]);
      mergeGroups.set(task1, newGroup);
      mergeGroups.set(task2, newGroup);
    }
  }

  const processedGroups = new Set<Set<string>>();
  const mergedTasks: Task[] = [];
  const tasksById = new Map<string, Task>(tasks.map((t) => [t.id, t]));

  for (const task of tasks) {
    const group = mergeGroups.get(task.id);

    if (!group) {
      // No conflicts for this task, keep it as is
      mergedTasks.push(task);
    } else if (!processedGroups.has(group)) {
      // We haven't processed this merge group yet
      processedGroups.add(group);

      const mergedId = Array.from(group).sort().join("-merged-");
      const mergedFiles = new Set<string>();
      const mergedNewFiles = new Set<string>();
      const mergedTestFiles = new Set<string>();

      const mergedTitles: string[] = [];
      const mergedPrompts: string[] = [];
      const risks: string[] = [];

      for (const taskId of group) {
        const t = tasksById.get(taskId);
        if (t) {
          t.files.forEach((f) => mergedFiles.add(f));
          t.new_files.forEach((f) => mergedNewFiles.add(f));
          t.test_files.forEach((f) => mergedTestFiles.add(f));
          if (t.title) mergedTitles.push(t.title);
          if (t.prompt) mergedPrompts.push(t.prompt);
          if (t.risk) risks.push(t.risk);
        }
      }

      const highestRisk = (risks.includes("high") ? "high" : risks.includes("medium") ? "medium" : "low") as "low" | "medium" | "high";

      mergedTasks.push({
        id: mergedId,
        title: mergedTitles.join(" + "),
        files: Array.from(mergedFiles),
        new_files: Array.from(mergedNewFiles),
        test_files: Array.from(mergedTestFiles),
        risk: highestRisk,
        prompt: mergedPrompts.join("\n\n---\n\n"),
      });
    }
  }

  return mergedTasks;
}

export function checkImplicitCoupling(tasks: Task[], barrelExports?: string[]): OwnershipConflict[] {
  const defaultBarrels = ["index.ts", "index.js"];
  const defaultSharedConfigs = ["package.json", "tsconfig.json", ".eslintrc"];
  const barrelsToCheck = barrelExports ?? defaultBarrels;

  const conflicts: OwnershipConflict[] = [];
  const barrelClaims = new Map<string, string>();
  const configClaims = new Map<string, string>();
  const testClaims = new Map<string, string>();

  for (const task of tasks) {
    const allFiles = [...task.files, ...task.new_files, ...task.test_files];

    for (const file of allFiles) {
      // Check barrel exports
      if (barrelsToCheck.some((b) => file.endsWith(b))) {
        const existing = barrelClaims.get(file);
        if (existing && existing !== task.id) {
          conflicts.push({
            file,
            task1: existing,
            task2: task.id,
          });
        } else {
          barrelClaims.set(file, task.id);
        }
      }

      // Check shared configs
      if (defaultSharedConfigs.some((c) => file.endsWith(c))) {
        const existing = configClaims.get(file);
        if (existing && existing !== task.id) {
          conflicts.push({
            file,
            task1: existing,
            task2: task.id,
          });
        } else {
          configClaims.set(file, task.id);
        }
      }
    }

    // Check test files separately to ensure they are exclusively owned
    for (const file of task.test_files) {
        const existing = testClaims.get(file);
        if (existing && existing !== task.id) {
          conflicts.push({
            file,
            task1: existing,
            task2: task.id,
          });
        } else {
          testClaims.set(file, task.id);
        }
    }
  }

  return conflicts;
}
