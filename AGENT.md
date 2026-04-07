# Jules Dispatch: Agent Source of Truth

This document is the "Grand Map" of the Jules Dispatch project. It is intended for both human and AI agents to maintain architectural consistency and prevent the repetition of past mistakes. It is a **live document** that must be updated after major architectural shifts or milestones.

> [!IMPORTANT]
> **Guideline for Agents:** This file is the primary source of truth. If the file structure or logic changes, update the "File Map" or "Architecture" immediately. Use `TODO.md` for active task tracking.

---

## 🗺 File Map

### 🤖 Core Agent (Convex Orchestrator)
- **`convex/agent/instance.ts`**: The `Agent` class instantiation using `@convex-dev/agent`. Contains `contextHandler` for memory, task, session tracking, and uploaded files injection.
- **`convex/agent/instructions.ts`**: The System Prompt. Contains rules for research delegation, Telegram HTML, and session creation protocol (requires explicit user approval).
- **`convex/agent/modelResolver.ts`**: Resolves the appropriate language model based on the user's `providerConfig` stored in the `users` table.
- **`convex/config/initial.ts`**: Initial configuration template for seeding the first user. Exports `INITIAL_CONFIG` and `isConfigured()` helper.

### 🧠 Memory System (Hermes-Style Curated Memory)
- **`convex/memory/db.ts`**: Memory entry CRUD (addEntry, replaceEntry, removeEntry, getEntries, getCharCount), nudge counter, thread summaries. Includes security scanning (10 threat patterns + invisible unicode detection) and character limit enforcement (2,200 memory / 1,375 user).
- **`convex/memory/tool.ts`**: Memory tool definition using createTool v6. Actions: add, replace, remove on 'memory' and 'user' targets. Resets nudge counter on every invocation.
- **`convex/memory/compaction.ts`**: Pre-compaction memory flush (LLM saves facts via memory tool, storage: none) and message summarization into threadSummaries table. HEAD_PROTECT=3, TAIL_PROTECT=10.
- **`convex/memory/index.ts`**: Module re-exports.

### 🛠 Tools & Workers
- **`convex/tools/index.ts`**: Agent tool registry. All tools are created with `createTool()`:
  - `message_jules` — Send a prompt to a Jules session
  - `approve_plan` — Approve a pending Jules session plan
  - `message_user` — Send a message to the user on Telegram (Telegram HTML)
  - `create_session` — Create a new Jules session (with github repo, branch, prefs)
  - `update_task_list` / `delete_task_list` — Persistent task list management
  - `query_sessions` — Browse/manage sessions via Session Manager sub-agent (on-demand discovery)
  - `manage_sessions` — Bulk session actions: REGISTER, TRACK, ARCHIVE, CONFIGURE (uses lightweight query, no PR metadata)
  - `exa_search`, `exa_get_contents`, `exa_find_similar`, `research` — Re-exported from `exa_search.ts`
  - `memory` — Re-exported from `memory/tool.ts`
  - `vfs` — Re-exported from `../vfs`
- **`convex/tools/exa_search.ts`**: The Research Agent engine. Supports dynamic context injection from files and web search via Exa.
- **`convex/tools/nodeActions.ts`**: Pure Node.js bridge for operations that require the Node runtime (Telegram document/zip uploads, Jules SDK client). Resolves Jules API key via single-query `getProviderConfigByThreadId`.
- **`convex/sessions/actions.ts`**: Node bridge to the `@google/jules-sdk`. Handles `createSession`, `sendMessage`, `approvePlan`, `sendTelegramMessage`, `getSessionActivities`.
- **`convex/sessions/sessionManager.ts`**: Session manager actions:
  - `getAllSessionsBasic` — Lightweight session list (no PR metadata). Used by `manage_sessions`. Upserts newly discovered sessions into DB.
  - `getAllSessionsWithInfo` — Full session list with batch PR metadata. Used by `query_sessions`. Upserts newly discovered sessions into DB.
  - `getSessionDetails` — Fetches details + activity log for specific sessions. Accepts optional pre-fetched sessions array; when omitted, does a live API fetch for fresh activity logs.
- **`convex/sessions/sessionManagerAgent.ts`**: Session Manager sub-agent. Contains `spawnSessionManagerAgent` which creates local tool closures (`local_list_sessions`, `local_inspect_session`). `local_list_sessions` operates on pre-fetched sessions array — no re-fetching. `local_inspect_session` intentionally does a live API fetch for fresh activity logs.
- **`convex/sessions/db.ts`**: Session table CRUD:
  - `addSession`, `updateSessionState`, `getAllSessions`, `getDashboardSessions`, `getUnacknowledgedSessions`, `upsertDiscoveredSession`
  - `getBulkSessionOutputs` — Batch PR metadata query (returns `Map<julesSessionId, outputs[]>`). Eliminates N+1 pattern.
  - `bulkUpdateSessions` — Single `collect()` + batch patch. Returns `{ updated }` count. Supports `repo` field.
  - `saveSessionOutputRecord`, `getSessionOutputsRaw`, `getSessionByJulesId`
  - `getSessionOutputCounts` — File counts per session using denormalized `outputCount` field.
  - `assignThreadAndInitTasks` — Assigns threadId to discovered sessions and creates task lists.
- **`convex/files/db.ts`**: Database for uploaded files (status: "unregistered" or "registered"). Functions: `addUploadedFile`, `getThreadFiles`, `deleteFilesForThread`, `deleteAllFiles`.

### 🌐 Settings Web App (React Frontend)
- **`web/src/App.tsx`**: Main settings page component for configuring the AI provider. Includes update notification toggle.
- **`web/src/api.ts`**: API client for settings config fetch/save/test via `/settings/api/*`. Includes `saveNotificationPreference`.
- **`web/src/types.ts`**: TypeScript types (`ProviderConfig`, `SettingsData`, `Preset`). Actual preset data lives in `shared/presets.ts`.
- **`web/src/components/CustomBYOKCard.tsx`**: Provider configuration card with preset wizard, manual inputs, and connection testing.
- **`web/src/components/ProviderModal.tsx`**: Preset provider selection modal. Imports presets from `@shared/presets`.
- **`web/src/components/SuccessScreen.tsx`**: Confirmation screen after config save.
- **`web/src/main.tsx`**: React app entry point.
- **`web/src/index.css`**: Tailwind directives and base component styling (`.card-v2`, `.btn-v2-primary`).
- **`web/vite.config.ts`**: Vite config with base path `/settings/` and dev proxy.
- **`web/index.html`**: HTML template.

### 📡 System & Sync
- **`convex/polling/actions.ts`**: Background sync engine between Jules worker and Convex Orchestrator (polled every 30s via `convex/crons.ts`). Handles state changes and message forwarding.
  - **Single `sessions().all()` call** — builds a session map, no per-session `info()` calls (except for final output fetch on `sessionCompleted`).
  - **Activity filtering** — uses `filter: create_time>"..."` for incremental fetches.
  - **No fallback hell** — if `sessions().all()` fails, the entire poll cycle is skipped with a log. No per-session fallbacks that multiply API calls.
- **`convex/api/telegram.ts`**: Telegram message processing. Contains `processTelegramUpdate` (webhook + bot entry point), `processMessageQueue`, `sendChatMessage`, `sendChatDocument`, `downloadAndStoreFile`. Also contains the Telegram API client functions (`telegramApiCall`, `sendTelegramMessage`, etc.).
- **`convex/api/utils.ts`**: Telegram HTML sanitization (`sanitizeHtmlForTelegram`) and message chunking (`chunkHtml`).
- **`convex/http.ts`**: Convex HTTP Router. Contains:
  - `/settings/api/config` — GET provider config (React app)
  - `/settings/api/save` — POST save provider config
  - `/settings/api/save-jules` — POST save Jules API key
  - `/settings/api/save-exa` — POST save Exa API key
  - `/settings/api/test` — POST test provider connection
  - `/settings/api/notifications` — POST save update notification preference
  - `/telegram` — Telegram webhook
  - `/api/health` — Health check endpoint
  - `/settings/*` — Static file serving via @convex-dev/static-hosting (SPA fallback)

### 👤 Single-User Architecture
- **One deployment = one owner.** The first person to message the bot becomes the owner.
- `getAnyExistingUser` query checks if a user already exists.
- Telegram gate check in `processTelegramUpdate`: if a user exists with a different `telegramChatId`, the message is rejected with "Bot Already Claimed".
- No OTP, no waiting room — first come, first served.

### 🔐 Authentication & Configuration
- **`convex/users/db.ts`**: Consolidated database functions for user state, provider configurations, auth sessions, thread cycling, pending messages, and agent running state.
  - `getProviderConfigByThreadId` — Single query: threadId → telegramChatId + providerConfig + julesApiKey + exaApiKey. Replaces the previous two-query chain (getChatIdForThread → getProviderConfig).
  - `getAnyExistingUser` — Returns any existing user or null. Used for single-user ownership check.
- **`convex/users/actions.ts`**: Node actions for provider configuration (`testConnection`), thread cycling (`cycleThreadAction`), and user data nuke (`nukeUserAction`).

### 🖥 CLI (`cli/`)
- **`cli/bin.js`**: Shebang entry point for `npx jules-dispatch`. Imports from `dist/cli/index.js` (pre-compiled JS, no tsx required).
- **`cli/index.ts`**: Main CLI wizard and commands (compiled to `dist/cli/index.js`):
  - **Fresh Wizard** (6 steps): Location → Telegram Token → Jules API Key (required) → AI Provider → Exa Search (press Enter to skip) → Convex Setup → npm install
  - **Update Command** (`npx jules-dispatch update`): Downloads latest archive (tar.gz) → npm install → deploy if deploy key exists
  - **Deploy Command** (`npx jules-dispatch deploy`): deploy to production using deploy key, set up webhook
  - Archive extraction: pure Node.js tar.gz download and extraction (cross-platform: Windows, macOS, Linux)
- **`cli/config.ts`**: Config management (compiled to `dist/cli/config.js`):
  - `readHomeConfig` / `writeHomeConfig` — `~/.jules-dispatch.json` (install path, deploy key, tokens, AI provider config)
  - `readEnvLocal` / `writeEnvLocal` / `removeEnvKeys` — `.env.local` operations (merge-aware, not overwrite)
  - `parseDeployKey` — Extract team/deployment/URLs from `team:project|token` format
  - `findJulesDispatchProject` — Auto-detect existing installation
  - `writeInitialConfig` — Writes `convex/config/initial.ts` with user config for first-run seeding
- **`tsconfig.cli.json`**: TypeScript config for CLI compilation. Outputs ESM JS to `dist/`. Uses `module: "NodeNext"` and `moduleResolution: "NodeNext"` for proper `.js` extensions.

### ⏰ Cron Jobs
- **`convex/crons.ts`**: 
  - Polls `pollJulesActivities` every 30 seconds for session discovery and state sync.
  - Checks for app updates every 24 hours via `updater/actions.checkForUpdates`.

### 🔔 Update Notifications
- **`convex/updater/`**: Update notification system that checks an updates JSON URL daily.
  - **`fetch.ts`**: Fetches the updates.json file. Note: URL is currently set to a development endpoint — revert to production URL before deploying.
  - **`actions.ts`**: Compares versions and sends Telegram notifications to opted-in users.
  - **`types.ts`**: TypeScript types for release data.
- **Schema changes**: `users` table has `updateNotificationsEnabled` and `lastNotifiedVersion` fields.
- **Notification tiers**: Only notifies on minor/major releases (no patch notifications).
- **User opt-in**: Users can enable/disable via the Settings UI checkbox.
- **updates.json format** (hosted at production URL):
```json
{
  "releases": [
    {
      "version": "1.2.0",
      "type": "minor",
      "date": "2026-03-30",
      "title": "Agent Memory System",
      "body": "Release notes in plain text...",
      "url": "https://julesdispatch.com/changelog#v1.2.0"
    }
  ]
}
```

### 📝 Schema
- **`convex/schema.ts`**: Convex DB schema. Tables: `users`, `julesSessions`, `tasks`, `memoryEntries`, `threadSummaries`, `sessionOutputs`, `sessionActivities`, `uploadedFiles`, `authSessions`.

---

## 🏗 Architecture: Progressive Disclosure & Fact Extraction

Jules Dispatch uses a tiered context architecture to maintain efficiency:

1. **Main Agent (Conversationalist):** Never reads large files directly. It sees metadata (Inbox/My List) and uses **Delegation** to handle complexity.
2. **Research Agent (Fact Extractor):** A specialized sub-agent spawned to analyze specific files or web content. It synthesizes answers and returns high-signal data to the Main Agent.
3. **Session Manager (Discovery Expert):** A specialized sub-agent for managing 100+ Jules sessions. It handles fuzzy searching across titles, repos, and PR metadata. Receives pre-fetched sessions array for listing — `local_inspect_session` does a live API fetch for fresh activity logs.
4. **Silent Inbox:** User uploads are stored in Convex File Storage and added to a "Silent Inbox" row. The LLM is NOT woken up on upload, reducing cost and noise.

---

## 🌊 Session Management (Iceberg Model)

To handle 100+ concurrent sessions without context bloat, Jules Dispatch implements an "Iceberg" model for session context:

### Jules Session States (from API)

| State | Meaning |
|-------|---------|
| `STATE_UNSPECIFIED` | State is unspecified |
| `QUEUED` | Session is waiting to be processed |
| `PLANNING` | Jules is creating a plan |
| `AWAITING_PLAN_APPROVAL` | Plan ready, needs user approval |
| `AWAITING_USER_FEEDBACK` | Jules needs user input |
| `IN_PROGRESS` | Jules is actively working |
| `PAUSED` | Session paused (can be resumed) |
| `FAILED` | Session failed |
| `COMPLETED` | Session completed successfully |

**Important:** Sessions are RESUMABLE. Sending a message to a COMPLETED/FAILED session transitions it back to an active state.

### Internal Tracking States

```
DISCOVERED ──► REGISTERED ──► TRACKED
     │              │            │
     │              │        ARCHIVED
     └──────────────┴────────────┘
         (all persist in DB forever)
```

| Field | Meaning |
|-------|---------|
| `acknowledged: false` | Session discovered from API, user hasn't acknowledged |
| `acknowledged: true` | User knows about this session |
| `inDashboard: true` | In my list (being actively monitored) |
| `inDashboard: false` | Not in my list (archived or never tracked) |
| `origin: "agent"` | Created by bot via `create_session` |
| `origin: "discovered"` | Found via API polling |
| `lastKnownState` | Last known Jules state |
| `repo` | "owner/repo" or "repoless" |

### Discovery Model
- **On-demand only** — sessions are NOT discovered automatically in the background.
- `query_sessions` is the sole entry point for discovery. It calls `getAllSessionsWithInfo` once, then passes the results into the Session Manager sub-agent.
- `getAllSessionsBasic` is a lightweight variant (no PR metadata) used by `manage_sessions`.

### Tiered Context Injection
1. **Warm Context (Injected):**
   - **Tracked Sessions:** Sessions in my list (`inDashboard: true`).
   - **Active Untracked:** Sessions that are acknowledged but not in my list, and still running.
2. **Context handler uses single DB query** — one `getAllSessions` call, client-side filtering replaces the previous 3 separate queries.

### Intent-Based Bulk Actions
- **`manage_sessions`**: Single tool for `REGISTER`, `TRACK`, `ARCHIVE`, and `CONFIGURE`.
- **Bulk Selection**: Supports targeting specific `ids` or broad groups via `target` (`unregistered`, `active`, `completed`, `tracked`, `all`).
- **Bulk Prefs**: Interaction preferences (approval/verbosity) can be applied to entire groups in one call.

### Fuzzy Discovery
- **`list_sessions`**: Used by the Session Manager sub-agent to perform "lossy" subsequence/substring matching across session titles, repository names, and associated Pull Request metadata.
- **Batch PR metadata**: `getBulkSessionOutputs` replaces the N+1 pattern — one DB query groups all outputs by session ID.

### Repo Field
- The `julesSessions` table has a `repo` field (`v.optional(v.string())`) storing `"owner/repo"` extracted from the Jules API `source.githubRepo` object.
- Defaults to `"repoless"` for sessions without a GitHub source or malformed source objects.
- The previous incorrect extraction (`source.github`) has been replaced with `source.githubRepo.owner/githubRepo.repo`.

### Pre-Fetch Data Flow
```
query_sessions → getAllSessionsWithInfo (1 Jules API call + 1 bulk DB query)
  → spawnSessionManagerAgent(sessions, prompt)
    → local_list_sessions uses sessions[] (no re-fetch)
    → manage_sessions passed through from tools/index
    → local_inspect_session does live API fetch for fresh activity logs
```

---

## 🧠 Curated Memory System (Hermes-Style)

Jules Dispatch implements a Hermes-style curated memory system for persistent knowledge across conversations.

### Architecture
- **Per-user, not per-thread**: Memory entries keyed by `telegramChatId`, survive thread cycles
- **Two stores**: `memory` (agent's notes) and `user` (user profile)
- **Character limits**: 2,200 chars (memory), 1,375 chars (user) — Hermes values
- **Thread summaries**: LLM-generated summaries stored separately in `threadSummaries` table
- **Nudge counter**: Persisted in users table, triggers memory review every 10 turns
- **Security scanning**: Hermes-style injection/exfil pattern checking on every write

### Context Handler Order
```
search results → recent messages → thread summary → memory entries → user profile → my list → tasks → inbox → nudge → slow tools
```

### Memory Tool
- Actions: `add` (new entry), `replace` (update existing), `remove` (delete)
- Targets: `memory` (agent's notes) and `user` (user profile)
- Agent uses it proactively when learning something that matters long-term

### Compaction Flow
1. `/compact` triggers `memoryFlush` (LLM saves facts via memory tool, storage: none)
2. Then `compactMemory` (summarizes middle messages into `threadSummaries`)
3. Head (3 messages) and tail (10 messages) preserved

### Commands
| Command | Behavior |
|---------|----------|
| `/new` | New thread, memory persists (per-user) |
| `/reset` | Clear conversation only, keep memory |
| `/compact` | Flush facts + summarize middle messages |
| `/nuke` | Nuclear: wipe ALL data (memory, tasks, files) |

### Session Context Optimization
- **Single DB query** — `getAllSessions` replaces the previous 3 separate queries.
- Client-side filtering splits sessions into tracked and active untracked.
- Unregistered sessions section removed from context (discovery is on-demand now).
- If the DB query fails, the agent turn continues without session context (logged, not crashed).

---

## 🌐 Settings Page (React Web App)

The settings page is a React + Vite SPA served from Convex static hosting at `/settings`.

### Access
- URL: `https://<deployment>.convex.site/settings?token=<uuid>`
- Token is validated against `authSessions` table (**24hr expiry**)
- Link generated by Telegram `/connect` command

### Features
1. **Preset Wizard**
   - Clickable presets for common providers (OpenCode, Google AI Studio, Anthropic, OpenAI, etc.).
   - Automatically pre-fills endpoint, model, and SDK type.
   - **OpenCode.ai** is the recommended default.

2. **Manual Configuration**
   - Fine-grained control over Base URL, Model Name, API Key, and SDK Type.
   - Supports any OpenAI-compatible provider.

3. **Connection Testing**
   - Real-time verification of API keys and endpoints before saving.
   - Performs a lightweight "hi" prompt to confirm the provider is responsive.

---

## 🖥 CLI Setup

The CLI (`npx jules-dispatch`) sets up a new Jules Dispatch instance from a fresh clone.

### Commands
- **`npx jules-dispatch`** — Run the setup wizard (fresh or update)
- **`npx jules-dispatch update`** — Download latest code (tar.gz), install deps, deploy if deploy key exists
- **`npx jules-dispatch deploy`** — Deploy to production Convex (prompts for deploy key if not saved)

### Config Storage
- **`~/.jules-dispatch.json`** — User-level config: install path, deploy key, telegram token, Jules API key, Exa API key, AI provider config
- **`<installPath>/.env.local`** — Project-level env vars: `TELEGRAM_BOT_TOKEN`, `JULES_API_KEY`, `EXA_API_KEY`

### Convex Setup (Wizard Step 6)
- Prompts for a Convex deploy key (format: `team:project|token`). Saves to `~/.jules-dispatch.json`. Deploy key is only used by deploy/update commands.

### Deploy Key Parsing
`parseDeployKey()` extracts:
- `team` — Convex team name
- `deploymentName` — e.g., `qualified-jaguar-123`
- `convexUrl` — `https://qualified-jaguar-123.convex.cloud`
- `convexSiteUrl` — `https://qualified-jaguar-123.convex.site`

### Archive Download
The update command uses archive download (GitHub `main.tar.gz`) and extracts it using pure Node.js (`zlib.createGunzip()` + manual tar parser). Works on Windows, macOS, and Linux without external tools.

---

---

## 🚀 Deployment

### Production Deploy (via CLI)
```bash
# Deploy backend to Convex production
npx jules-dispatch deploy

# Or manually:
CONVEX_DEPLOY_KEY='team:project|token' npx convex deploy --yes
```

### Upload Static Files
```bash
npm run build:web
npx @convex-dev/static-hosting upload --build --prod
```

### CI/CD
- **GitHub Actions** (`.github/workflows/`):
  - `ci.yml` — Type check, lint, build web, smoke test (triggers on push to main/develop)
  - `deploy-dev.yml` — Deploy to dev Convex deployment

### Scripts (`package.json`)
- `npm run dev` — Alias for `dev:convex`
- `npm run dev:convex` — `npx convex dev`
- `npm run dev:web` — Vite dev server for React app
- `npm run dev:logged` / `npm run logs` — Log viewer
- `npm run build:cli` — Compile CLI TypeScript to `dist/cli/` (ESM JS)
- `npm run build:web` — Build React app
- `npm run build` — Build CLI + web
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run typecheck` — TypeScript check (root + convex)
- `npm run typecheck:all` — TypeScript check (root + web)
- `npm run ci` — typecheck:all + lint
- `npm run deploy` — Deploy static hosting
- `npm run deploy:web` — Build web + upload to production
- `npm run cli` — `npm run build:cli && node dist/cli/index.js` (compiles + runs)
- `prepublishOnly` — `npm run build:cli` (auto-builds CLI before `npm publish`)

---

## 🧠 Learned Quirks & Gotchas

### 1. The V8 vs Node.js Great Wall (Strict)
- **Quirk:** Importing Node-only modules (like `fs` or `grammy/InputFile`) into any file bundled for V8 will fail.
- **Practice:** Use `nodeActions.ts` for all Node-specific logic. All actions that need Node runtime must use `"use node"` directive.

### 2. Pure BYOK (No OAuth)
- **Architectural Shift:** All AI interaction happens via API Keys. For Google models, use **Google AI Studio** keys with the `google` SDK type.
- **No Fallback:** Users must configure an API key via `/connect` before using the agent.

### 3. Telegram Webhook Timeouts
- **Quirk:** Downloading files during a Telegram webhook hit can cause timeouts and retries.
- **Practice:** The webhook immediately returns 200 OK and schedules a background action to handle the file download.

### 4. The `.env.local` Lifecycle
- `writeEnvLocal()` in `cli/config.ts` **merges** with existing vars — it does NOT overwrite.
- Deploy key is NOT written to `.env.local` during wizard setup. It is saved to `~/.jules-dispatch.json` and set as `process.env.CONVEX_DEPLOY_KEY` at deploy time only.

### 5. No Fallback Hell Policy
- **Rule:** Never add a fallback that multiplies API calls. If a batch operation fails, skip the cycle and log it.
- **Example removed:** The polling fallback that did per-session `session.info()` when `sessions().all()` failed was eliminated. This was the original source of N+1 API explosion.
- **Allowed:** Graceful degradation that returns less data (e.g., DB-only sessions when Jules API is down). Not allowed: fallbacks that re-fetch the same data through a slower path.

### 6. Jules SDK `source` Structure
- `source` is NOT a string. There is no `source.github` property.
- Correct path: `source?.githubRepo?.owner + "/" + source?.githubRepo?.repo`.
- If `source` is undefined or `githubRepo` is missing, the session is **repoless** — use `"repoless"` as the default.
- The `julesSessions` table has a `repo` field to store this extracted value.

### 7. `sessions().all()` vs `session.info()`
- Both return the same `SessionResource` fields: `id`, `title`, `state`, `source`, `createTime`, `outputs`.
- **Never call `session.info()` if you already have the session from `sessions().all()`.**
- In Convex stateless actions, the SDK's in-memory cache is always empty — every call hits the network.

---

## 🔌 Model Provisioning

Jules Dispatch uses a **Pure BYOK (Bring Your Own Key)** architecture.

### Model Resolution
- `modelResolver.ts` determines which model to use based on the `providerConfig` in the `users` table.
- **Direct Feedback:** If a model call fails (quota, invalid key), the agent informs the user with a hint to check their `/connect` settings.

### Multi-Turn Recovery
- If an LLM call fails, the user's message is preserved in a pending queue.
- Once the user updates their settings via /connect, the system automatically resumes the pending request.

### Supported SDK Types
- `openai-compatible` (Default)
- `openai`
- `anthropic`
- `google` (AI Studio API)

---

## 📬 Message Batching

When the agent is busy (`isAgentRunning: true`), incoming Telegram messages are queued in `pendingMessageText` rather than being processed immediately.

### Batch Processing
- Messages are collected and joined into a single prompt
- Format: `Message 1: <text>\nMessage 2: <text>\n...`
- A single `generateText()` call processes all queued messages
- On success: all pending messages are cleared
- On failure: messages stay queued for retry after user corrects the issue

### Why Batch?
Prevents rapid-fire responses when user sends multiple messages in quick succession (e.g., "hi", "hello", "hey" → single combined response instead of 3 separate replies).

---

## 🔧 Slash Commands

### `/start`
Initial welcome message and setup guidance.

### `/help`
Lists all available commands and their specific behaviors.

### `/connect`
Opens the settings page for provider configuration.
- Generates a secure link valid for **24 hours**.

### `/new` (Context Cycle)
Starts a fresh conversation while keeping long-term "Facts".
- **Action**: Cycles `threadId`, wipes todos and files (including Convex storage).
- **Memory**: Runs a "Handover Summary" of the current task before deleting the old thread.

### `/compact` (Memory Optimization)
Manually triggers context compaction.
- **Action**: Flushes facts via memory tool (storage: none), then summarizes middle messages into `threadSummaries`.
- **Optimization**: Head (3 messages) and tail (10 messages) preserved; middle messages replaced by summary.

### `/reset` (Nuclear Wipe)
Deletes all user data except provider settings.
- **Action**: Wipes all memory, history, and files.
- **Security**: Requires a "Yes, I am sure" confirmation via inline buttons.

---

## 📋 Scope Notes

### Out of Scope for v1
- **Photo/media handling**: Photos, video, audio, voice messages, stickers, and animations are not supported. The Telegram webhook silently ignores them. Only **text messages** and **document files** are supported.
- **Edited message handling**: Edited messages are logged but not processed.

# Creator of the project preference for coding agents
- do not user interview / ask user question tools when discussing plans, the user prefers being asked in plain text with your recommendations and also suggestions and is open to push backs on his answers.
