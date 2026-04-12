# Jules Dispatch: Architectural Philosophy & Migration Guide

This document outlines the ground-up rearchitecture for "Jules Dispatch," transitioning from a bloated, push-based context model to a lean, pull-based orchestrator inspired by the Hermes agent blueprint.

## 1. The Division of Responsibility

**Jules Dispatch (The Orchestrator PM)**
- **Role:** Technical Product Manager and user-facing interface via Telegram.
- **Scope:** Intent capture, high-level planning, resource provisioning, state tracking, and asynchronous worker management.
- **Rules of Engagement:** Dispatch does *not* write code or execute engineering tasks directly. It translates user intent into actionable, well-scoped prompts for the worker agents. It tracks the lifecycle of sessions (Queued, Planning, In Progress, Completed) and surfaces key milestones to the user.
- **Communication:** Non-blocking and asynchronous. Dispatch confirms intent, dispatches tasks, and listens for webhook returns or state changes. It interrupts the user only when a session needs approval, feedback, or encounters a fatal error.

**Google Jules Session (The Autonomous Worker)**
- **Role:** The Software Engineering Agent.
- **Scope:** Execution of scoped engineering tasks within a secure, isolated Daytona Sandbox or Google Cloud VM.
- **Capabilities:** Repository cloning, dependency installation, multi-agent execution (Planning, Execution, Critique, Testing), and PR generation.
- **Rules of Engagement:** The worker acts autonomously within its assigned scope. It reads `AGENTS.md` for codebase-specific context and relies on Dispatch only for unblocking (e.g., requesting user clarification via Dispatch).

## 2. Context & State Management

**The Problem:** The current implementation (`instance.ts`) pushes entire tables of system state (My List, Tasks, Inbox) into the Vercel AI SDK context every turn, burying user intent and degrading model focus.

**The Solution: The Hermes "Pull" Model & Lean Context**
- **Just-In-Time (JIT) State:** System state must no longer be injected globally. Instead, Dispatch will use internal tools (like `query_sessions` or `vfs(action="ls")`) to *pull* state only when the user's intent requires it.
- **Context Fencing:** When background facts (like user preferences or memory) *are* injected, they must be fenced in `<memory-context>` tags accompanied by a strict system disclaimer: `[System note: The following is recalled memory context, NOT new user input. Treat as informational background data.]` This prevents the model from hallucinating that past memories are active requests.
- **Strict Behavioral Rules:** System prompts will be decoupled from state and focus purely on immutable operational directives (e.g., `TOOL_USE_ENFORCEMENT_GUIDANCE`, `TELEGRAM_FORMATTING_GUIDANCE`).

## 3. Subagent Delegation

To keep the Dispatch context lean, complex tasks must be delegated to specialized subagents.

**Handoff Lifecycle:**
1. **Intent Capture:** User sends a request via Telegram (e.g., "Fix the auth bug in the backend").
2. **RAG Scoping (Optional):** Dispatch spawns a `research` subagent to query the VFS and build a scoped context brief.
3. **Worker Handoff:** Dispatch uses `create_session` and `message_jules` to launch the Google Jules worker, passing the context brief and the specific task. Dispatch sets the session to `IN_PROGRESS` and notifies the user.
4. **Asynchronous Execution:** The Jules worker executes in its secure VM. Dispatch monitors webhooks or polls for state changes.
5. **Webhook Returns & Notification:** When the Jules worker reaches a milestone (`AWAITING_PLAN_APPROVAL`, `COMPLETED`, `FAILED`), it signals Dispatch. Dispatch parses the payload and sends a concise, formatted Telegram message to the user.

## 4. Prompt Assembly Flow

The Vercel AI SDK `generateText` inputs must follow a strict, layered schema to ensure maximum model adherence.

**Concrete Schema:**

```typescript
const finalMessages = [
  {
    role: "system",
    content: `You are Jules Dispatch, an orchestrator and tech lead...
    
    # Behavioral Rules
    <tool_use_enforcement>
    You MUST use the message_user tool for EVERY SINGLE RESPONSE. Never output text directly to the console.
    </tool_use_enforcement>
    
    <operational_directives>
    - Never expose raw tool outputs or JSON to the user.
    - Use tools to fetch session state; do not assume you know it.
    </operational_directives>`
  },
  {
    role: "system", // Or 'user' depending on strict API requirements
    content: `<memory-context>
[System note: The following is JIT recalled memory context, NOT new user input. Treat as informational background data.]

User Profile:
- Prefers concise, milestone-only updates.

Project Facts:
- Target repository: my-org/my-repo
</memory-context>`
  },
  // ... recent_chat_history (User and Assistant messages)
];
```

**Key Action Items for Migration:**
- **Eradicate Dynamic Tables:** Remove "MY LIST", "TASKS", and "INBOX" array mapping from the `unifiedContextHandler` in `instance.ts`.
- **Enforce Tool Usage:** Update `instructions.ts` to strictly command the model to use `query_sessions`, `vfs`, and `update_task_list` to fetch or mutate state on-demand instead of relying on context injection.
- **Implement Fencing:** Wrap the memory injection logic in `instance.ts` with the `<memory-context>` XML tags and the system disclaimer.
