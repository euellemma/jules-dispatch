# Objective
You are tasked with performing an elite-level technical analysis to design a brand-new, ground-up architecture and philosophical guide for "Jules Dispatch". 

Jules Dispatch is our orchestrator agent. Its job is to act as a highly capable Technical Product Manager (PM): routing user intent via Telegram, managing persistent storage, and orchestrating numerous headless "Google Jules" software engineering sessions (the workers). 

## Step 1: Execute Deep Research
Before proposing any designs or philosophies, you must thoroughly research the following three pillars:

### 1. Jules Dispatch (Our Current Codebase)
- **Directory:** `./convex/agent`
- **Key Files to read:** `instance.ts`, `instructions.ts`, and the tool definitions.
- **The Problem Context:** Our current implementation's context injection is extremely bloated. We are pushing entire markdown tables of system state ("MY LIST" of tracked sessions, "TASKS" lists, and "INBOX" files) directly into `contextMessages` every single turn. Because these huge data blocks are appended to the LLM context, they bury the user's recent messages, destroy conversational continuity, and drift the LLM's focus away from executing tool calls.

### 2. Hermes Agent (Our Desired Blueprint)
- **Directory:** `./docs/hermes-agent-main/agent`
- **Key Files to read:** `prompt_builder.py` and `memory_manager.py`.
- **The Blueprint Context:** Hermes uses a highly disciplined "Lean Context" approach. 
  - It uses strict, predefined **Behavioral Rules** (e.g., `TOOL_USE_ENFORCEMENT_GUIDANCE`, `OPENAI_MODEL_EXECUTION_GUIDANCE`) that go into the system prompt to force the LLM to act autonomously.
  - It utilizes **Just-In-Time (JIT) injected memory**, pulling only exact facts relevant to the user's specific prompt, rather than dumping all preferences every turn.
  - It uses **Context Fencing** (wrapping background facts in `<memory-context>` tags accompanied by a system disclaimer) so the LLM doesn't mistake background facts for active chat history.

### 3. Google Jules (Web Research)
- **Action Required:** Use your web browsing tools to research "Google Deepmind Jules AI" or "Google Jules Software Engineering Agent".
- **The Integration Context:** To accurately design an orchestrator, you must understand the entity it is orchestrating. Understand the capabilities of the Google Jules model (e.g., how it interacts with GitHub issues, Daytona sandboxes, and long-horizon tasks) so you can correctly define where Dispatch's job ends and the worker Jules session's job begins.

## Step 2: Output Requirements (The Philosophy Document)
After performing this research, you must construct a comprehensive architectural philosophy document that will act as our migration guide.

You must deeply re-evaluate and document:
1. **The Division of Responsibility:** What exactly is the scope of the orchestrator PM (Jules Dispatch) vs the autonomous worker (Google Jules session)? How do they communicate asynchronously without the orchestrator "blocking" the user's Telegram chat?
2. **Context & State Management:** How do we transition from our flawed "Push" model to the Hermes "Pull" model? Which tools need to be built/adjusted so the orchestrator looks up state (sessions, files) dynamically rather than having it injected?
3. **Subagent Delegation:** How should we structure the handoff? Formulate a clean lifecycle (Intent Capture -> RAG Scoping -> Worker Handoff -> Webhook Returns -> User Notification).
4. **Prompt Assembly Flow:** Provide a concrete schema for how our Vercel AI SDK `generateText` inputs should literally be formatted (Static Identity -> Constraints -> `<fenced-jit-memory>` -> `...recent_chat_history`).

**Constraint:** Your design must be technically grounded in our stack (Convex backend, Vercel AI SDK, Telegram API). Do not let the current bloated logic in `instance.ts` bias your new design—think from first principles.
