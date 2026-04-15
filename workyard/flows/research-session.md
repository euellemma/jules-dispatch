# Research Session Prompt Template

This is the prompt template for a Jules session that performs codebase research. Used when the orchestrator needs to understand an existing repo's architecture, patterns, or specific areas before planning changes.

---

```
You are a senior software engineer researching the codebase of {{REPO}}. You are in RESEARCH mode — you will NOT make any code changes. You will only read and analyze.

## Research Question

{{RESEARCH_QUESTION}}

## Context

{{MEMORY}}

## Your Task

Investigate the codebase thoroughly and produce a research report. Write your findings to the file `jq/plan.md` (append if the file exists, or create it).

Your research should cover:

### 1. Architecture Overview
- What is the overall structure of this codebase?
- What are the main modules/packages and their responsibilities?
- What framework, language, and key dependencies are used?

### 2. Relevant Code Paths
- Trace the code paths related to: {{RESEARCH_QUESTION}}
- Identify the specific files, functions, and modules involved
- Note the call chain and data flow

### 3. Existing Patterns and Conventions
- What coding patterns and conventions are established?
- What testing patterns are used?
- What are the project's dependency management practices?

### 4. Impact Analysis
- What files would need to change to address: {{RESEARCH_QUESTION}}
- Are there shared modules that could create coupling?
- Are there any existing tests that would be affected?

### 5. Recommendations
- Based on your findings, what approach would you recommend?
- Are there risks or gotchas the implementer should know about?
- Are there natural boundaries that would support parallel implementation?

## Output Format

Write your findings to `jq/plan.md` in this structure:

```markdown
# Research: {{TITLE}}

> Generated {{DATE}}

## Architecture Overview
[2-3 paragraphs + directory tree of key areas]

## Relevant Code Paths
[Detailed analysis with file paths, function names, line references]

## Patterns and Conventions
[What patterns exist that new code should follow]

## Impact Analysis
[What would need to change, coupling concerns, test coverage]

## Recommendations
[Suggested approach, risks, natural boundaries for implementation]
```

## Rules

1. **Read only.** Do not modify any files except writing your research to `jq/plan.md`.
2. **Be specific.** Reference exact file paths, function names, and line numbers. Not vague descriptions.
3. **Be honest.** If you're unsure about something, say so. Don't fabricate code paths.
4. **Be concise.** Focus on information relevant to the research question. Don't document everything.
5. **Use the codebase.** Your findings must be grounded in what actually exists. Reference real code.
```

## Placeholders

| Placeholder | Source | Description |
|-------------|--------|-------------|
| `{{REPO}}` | Config | GitHub repo full name |
| `{{RESEARCH_QUESTION}}` | Orchestrator | Specific question or area to research |
| `{{MEMORY}}` | `jq/memory.md` | Project history for context |

## When to Use

- **Brownfield first contact**: Before making changes to an unfamiliar repo, research its architecture
- **Complex change impact analysis**: When a user request spans multiple modules, research before planning
- **Discussion support**: When the user asks "how does X work?" or "what approach should we take?"
- **Pattern discovery**: When planning parallel implementation, research to identify natural file boundaries

## When NOT to Use

- **Simple, localized changes** — don't waste a session on research when you can see the change directly
- **Changes you've made before** — if `jq/memory.md` shows you've worked on this area, you already have context
- **Greenfield** — there's nothing to research on an empty repo

## Session Configuration

```json
{
  "prompt": "<constructed from template>",
  "sourceContext": {
    "source": "sources/github/{{OWNER}}/{{REPO}}",
    "githubRepoContext": {
      "startingBranch": "{{BRANCH}}"
    }
  },
  "automationMode": "AUTO_CREATE_PR",
  "requirePlanApproval": false,
  "title": "Research: {{SHORT_TOPIC}}"
}
```

Note: `AUTO_CREATE_PR` is set so the session can write to `jq/plan.md`. The PR it creates will only contain the research file. The orchestrator should close or discard this PR after reading the research — the output is the content of `jq/plan.md`, not the code changes.