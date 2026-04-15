# Jules Dispatch — Local Agent Bridge

This skill connects your local terminal to Jules Dispatch, your assistant that orchestrates work across sessions and can be reached from anywhere (phone, browser, etc.). This creates a persistent bridge: you can yield control to Jules Dispatch when you're away, or push information upstream when you need orchestration.

The core idea: **the local agent and Jules Dispatch work as a team**. Either side can initiate — the local agent can ask for instructions, or Jules Dispatch can drive the local agent based on a plan the user already discussed.

If commands fail with exit code 1, the user hasn't set up Jules Dispatch yet. Let the user know and suggest they run `npx jules-dispatch deploy` in a separate terminal (it requires API keys and interactive setup — do not run it automatically).

## Two Core Workflows

### Yield Control — `pause-and-wait`

The local agent is working, hits a decision point, or the user is leaving and says "continue without me, check with Jules Dispatch." The agent calls `pause-and-wait` and blocks until an instruction arrives. That instruction may come from:

- **The user** replying on their phone through Jules Dispatch
- **Jules Dispatch itself** automatically continuing based on a grand plan the user discussed with it earlier (Jules Dispatch acts as an autonomous operator, not just a relay — if the user gave it authority to drive, it will)

```bash
npx jules-dispatch pause-and-wait <session-label> [file] [--context <msg>] [--json]
```

- `<session-label>` — Unique kebab-case identifier (e.g. `fix-auth-1`). Must be unique across all currently waiting interactions. Reusing a waiting label returns a 409 error — increment the suffix instead.
- `[file]` — Path to a markdown file with context. If no file and stdin is piped, reads from stdin.
- `--context <msg>` — Inline context. If both `--context` and a file are given, the inline message takes priority.
- `--json` — Structured JSON output.
- Size limit: 100 KB combined.

**JSON success:**
```json
{ "success": true, "interactionId": "uuid", "sessionLabel": "fix-auth-1", "instruction": "..." }
```

**JSON 409 (duplicate label):**
```json
{ "success": false, "error": "A waiting interaction already exists...", "existingInteractionId": "uuid" }
```

If `pause-and-wait` is interrupted (network drop, process killed), resume polling with:

```bash
npx jules-dispatch wait-instruction <session-label> [--json]
```

### Push Upstream — `send-message` / `upload-file`

The local agent proactively sends information, tasks, or handoffs to Jules Dispatch. This is the local agent taking initiative — reporting progress, delegating orchestration, handing off work for parallel Jules sessions, sending a built system for testing, etc.

```bash
# Send a message and wait for a response
npx jules-dispatch send-message [message] [--wait] [--json]
```
Reads from stdin if no message argument. `--wait` polls for up to 5 minutes.

**JSON (`--wait`):**
```json
{ "success": true, "threadId": "...", "response": "...", "error": null }
```

```bash
# Upload a file (max 20 MB) with a prompt
npx jules-dispatch upload-file <file> [--prompt <msg>] [--caption <text>] [--wait] [--json]
```

**JSON (`--wait`):**
```json
{ "success": true, "threadId": "...", "fileId": "...", "filename": "...", "response": "..." }
```

## Patterns

### User is leaving — local agent continues under Jules Dispatch supervision

The user says "I'm heading out, keep working and check with Jules Dispatch when you need direction." The local agent works, and at decision points:

```bash
cat > /tmp/blocker.md << 'EOF'
# Situation
Implementing user auth. Login and signup are done.

# Blocker
Need to decide: session-based or JWT auth? JWT would be stateless but token revocation is harder.

# Question
Which auth approach should I use?
EOF

npx jules-dispatch pause-and-wait auth-impl-1 /tmp/blocker.md
```

The user may reply from their phone, or Jules Dispatch may decide on its own based on context. The local agent continues with the instruction it receives.

### Handoff to Jules Dispatch for orchestration

The local agent finishes a major milestone and delegates the next phase:

```bash
npx jules-dispatch send-message "I've completed the API layer. The database schema is in src/db/schema.ts. Can you handle testing by spinning up Jules sessions? I'll keep working on the frontend." --wait
```

### Report and continue

```bash
npx jules-dispatch send-message "Deployed v2.1.3 to staging. All health checks passing." --wait
```

## Context File

When calling `pause-and-wait` with a file, use sections that give the operator enough context to give a clear instruction:

```markdown
# Situation
What you're working on and what's been done.

# Blocker
What's preventing progress (or why you're yielding control).

# Question
The specific decision, approval, or direction you need.

# Relevant Code
Code snippets, file paths, or error messages.
```

## Session Labels

- Kebab-case: lowercase letters, numbers, hyphens (e.g. `fix-auth-timeout-1`)
- Must be unique across all currently waiting interactions
- Increment suffix for repeated calls (`fix-auth-1`, `fix-auth-2`, ...)
- Be descriptive: `fix-auth-timeout-1` over `task-1`

## Errors

| Scenario | Action |
|---|---|
| Exit code 1 | Tell the user to run `npx jules-dispatch deploy` in a separate terminal (requires API keys, do not run automatically) |
| 409 Duplicate label | Use a unique label (increment suffix) |
| 413 Too large | Reduce to under 100 KB |
| Network error | Retry — the interaction is still pending |
| Process interrupted | Use `wait-instruction` to resume |