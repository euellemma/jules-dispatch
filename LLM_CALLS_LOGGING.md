# LLM Calls Logging - Implementation Complete

## Usage

```bash
# Fetch last 50 LLM calls (default)
./fetch-llm-calls

# Fetch last 5 calls
./fetch-llm-calls 5
```

Returns JSON array of LLM calls with full request/response bodies.

## What Was Built

### 1. `convex/schema.ts` - `llmCalls` table
Stores: threadId, userId, timestamp, model, provider, requestBody, responseBody, finishReason, usage, durationMs, status. Index on `by_timestamp`.

### 2. `convex/llmCalls/actions.ts` - Insert mutation
`insertLlmCall` internal mutation called by the agent handler after each LLM call.

### 3. `convex/llmCalls/query.ts` - List query
`listLlmCalls` public query (ordered by timestamp desc, with limit).

### 4. `convex/agent/instance.ts` - `rawRequestResponseHandler`
Captures full LLM request/response and logs to `llmCalls` table. Also handles memory nudge counter.

### 5. `convex/dailyCheck/actions.ts` - Daily cleanup
`cleanupLlmCalls` mutation deletes entries older than 2 days. `runDailyChecks` action also runs the update checker.

### 6. `convex/crons.ts` - `daily-checks` cron
Runs every 24 hours, calls `runDailyChecks` which cleans up old LLM calls and checks for updates.

### 7. `convex/http.ts` - `/api/llmCalls` endpoint
GET endpoint requiring `Authorization: Bearer <CONVEX_DEPLOY_KEY>` header.

### 8. `fetch-llm-calls` - CLI script
Reads deploy key from `.env.local`, authenticates with Bearer token.

## Key Learnings

- Convex HTTP actions are served on `CONVEX_SITE_URL` (.convex.site), NOT `CONVEX_URL` (.convex.cloud)
- `process.env.CONVEX_DEPLOY_KEY` must be set via `npx convex env set CONVEX_DEPLOY_KEY <value>`
- Convex internal function paths use `["llmCalls/actions"]` bracket notation for directories with slashes
- `internalQuery` cannot be called from `httpAction` via `ctx.runQuery` - must use public `query`