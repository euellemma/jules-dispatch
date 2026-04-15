# File Ownership Validation

Algorithm for detecting file ownership conflicts before dispatching parallel Jules sessions.

## Why This Matters

When parallel Jules sessions each create a PR against the same base branch, any two sessions that modify the same file **will cause a merge conflict**. Ownership validation prevents this by ensuring file exclusivity before dispatch.

## Algorithm

```python
def validate_ownership(tasks):
    """
    Validate that no two tasks claim the same file.
    Returns list of conflicts. Empty list = safe to dispatch.
    """
    claimed = {}  # file_path -> task_id
    conflicts = []
    
    for task in tasks:
        all_files = task.files + task.new_files + task.test_files
        for file_path in all_files:
            if file_path in claimed:
                conflicts.append({
                    "file": file_path,
                    "task_1": claimed[file_path],
                    "task_2": task.id
                })
            else:
                claimed[file_path] = task.id
    
    return conflicts
```

## Resolution Strategies

### Strategy 1: Merge Conflicting Tasks

If tasks A and B both need `src/utils/auth.ts`, merge them into a single task. The merged task inherits the union of both tasks' files.

```
Before:
  task-auth-core: [src/auth/login.ts, src/utils/auth.ts]
  task-auth-ui:   [src/pages/Login.tsx, src/utils/auth.ts]
  
After merge:
  task-auth: [src/auth/login.ts, src/utils/auth.ts, src/pages/Login.tsx]
```

### Strategy 2: Refactor Boundaries

If the shared file is a natural boundary (e.g., a barrel export, a shared utility), consider:
- Making the shared file part of a separate "shared changes" task
- OR making one task responsible for all changes to the shared file

### Strategy 3: Sequential Execution

If merging makes a task too large, fall back to sequential execution for the conflicting tasks while keeping non-conflicting tasks parallel.

## Implicit Coupling Detection

Beyond explicit file ownership, check for **implicitly coupled files**:

### Barrel Exports (index.ts, index.js)

If multiple tasks depend on a barrel export file (`src/index.ts`, `src/components/index.ts`), the barrel must be owned by exactly one task. Include it in that task's `files` array.

### Shared Test Files

If an integration test or test utility is used by multiple tasks' code, the test file must be owned by exactly one task. The other task must make its changes backward-compatible so the shared test passes unmodified.

### Shared Type Definitions

Type files (`types.ts`, `interfaces.ts`, `schema.ts`) that are imported by multiple tasks' source files. The type file must be owned by one task, and other tasks must work with the existing types.

### Configuration Files

`package.json`, `tsconfig.json`, `.eslintrc`, etc. If multiple tasks need to modify the same config file, merge those tasks.

## Validation Checklist

Before dispatching parallel sessions, run this checklist:

- [ ] Every file in every task's `files`, `new_files`, and `test_files` appears in `file_ownership`
- [ ] No file appears in `file_ownership` more than once
- [ ] No barrel export is claimed by more than one task
- [ ] No shared test file is claimed by more than one task
- [ ] No shared type definition is claimed by more than one task
- [ ] No config file (`package.json`, `tsconfig.json`, etc.) is claimed by more than one task
- [ ] For each task: all files in its `files` list are also in its `test_files` list's companion test files (if tests exist)
- [ ] Tasks are ordered by risk level (lowest first) for merge sequencing

If any check fails, resolve the conflict before dispatching. Merging tasks is always preferred over risking merge conflicts.