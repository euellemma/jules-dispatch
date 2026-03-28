# Jules Dispatch
Jules Dispatch is an open-source Telegram bot that lets you orchestrate Google Jules through a single, persistent chat thread. Discuss your goals and kick off parallel coding sessions, then track their progress and get a text when your input is needed. It runs entirely on your own Convex account.

Claude Code offers Dispatch for mobile orchestration. I built this bot to bring that workflow to Google AI plans subscribers. Google offers a generous free tier (15 sessions/day) so you just need to bring your own LLM provider API keys to power the orchestration agent.



## Quick Start

```bash
npx jules-dispatch
```

The interactive wizard configures your Telegram bot, API keys, and Convex deployment. Takes about 3 minutes.

**Free LLM trial:** Sign up for a free account on OpenCode Zen to get a MiMo-V2-Pro API key—no credit card required. This lets you try the setup before providing your own LLM keys.

## Requirements

You need a Telegram account, a Google account for Jules API key, and Node.js 18+ installed on your machine for setup.

## Features

**Single-threaded Chat:** One Telegram conversation manages all your Jules sessions—spawn work, track progress, and get a text when Jules needs input or finishes, all without leaving the chat.

**Research Agent:** Exa web search for the latest documentation, or analyze your uploaded files and session results when you need deeper insights.

**Background Polling:** Convex cron jobs poll Jules every 30 seconds via the SDK, detecting state changes and pushing updates to the agent, which decides whether to text you.

**Session Discovery:** Calls the Jules API to list all your active and recent sessions across devices, then surfaces them in Telegram so you can resume work started in the browser.

**File Exchange:** Send and receive files directly in the chat—upload code, documents, or ZIPs to Jules, and get back the results the same way.

**Observational Memory:** Instead of keeping raw message history that hits context limits, Convex background tasks compress conversations into structured facts stored in the database—so you can ask "what did we decide about auth?" weeks later and get the answer.

## How It Works

**The Flow:**

When you text the bot, it hits a Convex HTTP endpoint that routes to the orchestration agent. This isn't just a simple relay—it's a stateful conversation manager that decides whether to spawn a new Jules session, query your existing sessions, search the web, or retrieve compressed memory from previous chats.

**Session Orchestration:**

The agent uses the @google/jules-sdk to create and monitor coding sessions. When you ask it to "refactor the auth system," it doesn't just pass that along blindly. It can first spawn a research sub-agent to analyze your uploaded files and session results, or search the web via Exa, then create a focused Jules session with the right context. Background polling (every 30 seconds via Convex crons) tracks session state and pushes updates back to Telegram—whether that's a "Jules needs your approval" text or the final output files.

**File Pipeline:**

Document uploads from Telegram flow into Convex File Storage with an "unregistered" status—the LLM isn't woken up immediately, keeping costs down. When you reference those files in conversation, the agent retrieves them and includes them in Jules session context. Conversely, when Jules generates outputs (code files, diffs, build artifacts), the polling system fetches them from the Jules API and delivers them back to you via Telegram as documents or ZIP archives.

**Memory Compression:**

Raw conversation history grows indefinitely and eventually hits context limits. Instead of keeping everything, Convex background tasks continuously compress your chat into structured observations—facts, decisions, and context—stored in the database. The active conversation window stays lean with just recent messages, but when you ask something like "what did we decide about the database schema?" weeks later, the system queries the observation database and injects relevant historical context. This observational memory approach means nothing important gets lost, but the agent never drowns in old message history.

**Infrastructure:**

Everything runs on your own Convex deployment—serverless TypeScript functions, document database with real-time sync, file storage, and cron jobs. The settings page is a React SPA served via @convex-dev/static-hosting. You're not relying on any managed service except your own Convex account and the external APIs (Jules, your chosen LLM provider, Exa for search).

## Commands

- `/start` — Welcome and setup guidance
- `/connect` — Configure AI providers via web UI
- `/new` — Start fresh conversation (preserves long-term memory)
- `/compact` — Manually optimize context window
- `/reset` — Clear all data with confirmation
- `/help` — Show all available commands

Deploys to your own Convex project. Fully self-hostable. MIT License.

## CLI Commands

After initial setup, use these commands to manage your installation:

- `npx jules-dispatch update` — Pull the latest code, install dependencies, and optionally redeploy
- `npx jules-dispatch deploy` — Deploy to Convex production (prompts for deploy key if not saved)

## FAQ

**How much does this cost to run?**

Jules offers a generous free tier with 15 sessions per day. Google AI Pro subscribers get 100 sessions/day and Ultra subscribers get 300. For the orchestration agent, you can start with a free MiMo-V2-Pro trial from OpenCode Zen. Convex runs on their free tier. So you can run this entirely for free to start, and only pay if you need more Jules sessions.

**What happens to my data?**

Everything runs on your own Convex deployment. Your texts, file uploads, conversation history, and Jules session data all live in your database. This is an open-source project and the bot is self-hosted infrastructure—you own your data.

**Can I use this with my existing Jules sessions?**

Yes. The bot discovers your active and recent Jules sessions automatically through the API. Sessions you started in the browser yesterday will appear in Telegram today. You can resume work seamlessly across devices.

**Why do I need to bring my own LLM provider?**

The bot needs an LLM to handle the orchestration layer—deciding when to spawn sessions, what context to include, how to respond to your texts. This runs independently of Jules itself. You can use any provider: OpenAI, Anthropic, Google AI Studio, or get a free trial key from OpenCode Zen.

**What file types can I upload?**

You can send code files, documents, and text files through Telegram. The bot handles compression and chunking automatically. Photos, videos, and audio are not supported yet.

**How does the memory system work?**

Instead of keeping your entire conversation history (which would eventually overflow the context window), the bot continuously compresses your chats into structured facts and decisions. These get stored in the database. When you ask about something from weeks ago, it retrieves the relevant facts, not the raw messages. This means nothing gets lost, but the bot never drowns in old conversation.

**What's the difference between Jules and the orchestration agent?**

Jules is Google's coding agent that actually writes and edits code. The orchestration agent (this bot) manages the conversation, decides when to spawn Jules sessions, handles file transfers, and keeps track of everything. Think of Jules as the worker, and this bot as the project manager texting you updates.

**How do I update the bot after deployment?**\
Run `npx jules-dispatch update`. This pulls the latest code, installs dependencies, and optionally redeploys. Convex handles the migration. Your data persists in the database. The whole process takes about 30 seconds.

**Is web search required?**

No. Exa web search is optional—you can use the bot without it. The research tools simply won't have web search capabilities.

**Can I switch LLM providers after setup?**

Yes. Use `/connect` in Telegram anytime to reconfigure your provider, model, or API key.


## License

MIT License — Free for personal and commercial use.
