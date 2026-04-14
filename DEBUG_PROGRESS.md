# Debugging Progress: Executor IPC Bridge Error & Chunking

## The Issue
1. We successfully fixed the `[object Object]` error serialization in `invokeOpenApiTool`. The underlying GitHub error (Rate Limit Exceeded) is now being sent back.
2. However, the sandbox's `stdout` stream is breaking JSON messages into chunks when the output is long.
3. The IPC parser in `convex/executor/action.ts` (`handleMessage`) attempts to `JSON.parse` each line or chunk individually. Because the payload is split across two chunks (e.g. `{"type": "completed", "result": [{"test":...` and then `... }]\n`), the first chunk is invalid JSON and throws `Failed to parse IPC`.

## Next Steps for Debugging
1. **Examine `convex/executor/daytona.ts` or `convex/executor/action.ts`:** We need to find where the `@@executor-ipc@@` prefix is detected and parsed.
2. **Implement an IPC Buffer:** The stdout reader should not blindly parse every chunk that contains the prefix if it's incomplete. It needs to buffer the string until a newline `\n` is encountered, and then extract the IPC message from the complete line, OR it needs to handle the fact that Daytona might split a single `console.log` into multiple stream chunks.

## Fix Applied: Chunked stdout IPC stream buffering
- I found that the Daytona worker stream reads chunks, and if a JSON IPC message payload is larger than the underlying buffer size, `stdout` splits the `console.log` across multiple chunks.
- I introduced a `stdoutBuffer` to `convex/executor/daytona.ts` to accumulate chunks.
- It loops to process lines safely only when a `\n` newline boundary is encountered.
- This guarantees `JSON.parse` only runs on a fully formed JSON line, eliminating the `Unterminated string in JSON` error!

## Fix Applied: Resilient Secret Header Resolution
- I identified that the `config.headers` stored in the database for synced OpenAPI tools was missing the `type: "secret"` property (e.g., `{"Authorization": {"secretId": "github-token", "prefix": "Bearer "}}`).
- The previous implementation strictly required `value.type === "secret"`, which caused it to skip injecting the `Authorization` header entirely.
- This explains why GitHub was returning unauthenticated rate limit errors!
- I updated `resolveHeaders` and `invokeGraphQlTool` in `convex/executor/ipc.ts` to check for the presence of a `secretId` property as a fallback.
- Now the `Authorization` header will be correctly resolved from the `executor_secrets` table and sent with the API request.
