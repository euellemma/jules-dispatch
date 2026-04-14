# Debugging Progress: Executor IPC Bridge Error

## The Issue
The Daytona sandbox executor is failing to execute OpenAPI tools synced from `executor.jsonc`.
When `tools.github.user.getAuthenticated()` (or similar nested tool paths) is called, it throws:
`IPC Bridge Error: [object Object]`

## What We've Done / Found So Far
1. **Tool Resolution is Working:** The proxy in `convex/executor/daytona.ts` correctly resolves nested paths (e.g. `github_v3_rest_api.users.getAuthenticated`). It sends the `toolPath` to the Convex backend correctly.
2. **Tool Routing is Working:** The Convex `handleIpcCall` in `convex/executor/ipc.ts` correctly finds the synced tool and routes it to `invokeOpenApiTool`.
3. **The Failure Point:** The error originates from within the `invokeOpenApiTool` function (or similar plugin invocations) in `convex/executor/ipc.ts`. The error being thrown is an object (`[object Object]`), which suggests an error object is being converted to a string or returned directly where a string was expected in the JSON response to the sandbox.

## Next Steps for Debugging
1. **Inspect `invokeOpenApiTool`:** We need to look closely at `invokeOpenApiTool` in `convex/executor/ipc.ts` to see where it might be throwing or returning an object as an error.
2. **Check the Fetch Call:** Inside `invokeOpenApiTool` (or the underlying fetch logic it uses), see how errors from external APIs (like GitHub) are handled. It's likely an error from `fetch` or a non-200 response is being caught, and the raw error object or response object is being passed back as the `error` property.
3. **Fix Error Serialization:** Ensure that any caught errors are properly converted to strings (e.g., `e.message` or `JSON.stringify(e)`) before being returned to the IPC bridge.


## Fix Applied: `[object Object]` error serialization
- I found two places in `convex/executor/ipc.ts` (`invokeOpenApiTool` and `invokeGoogleDiscoveryTool`) where non-200 responses fallback to `error: String(data)`.
- If the HTTP response is JSON (like the GitHub API returning a 401 Unauthorized `{ message: "Bad credentials" }`), `data` is already parsed into an object.
- Calling `String({ message: "Bad credentials" })` results in `[object Object]`.
- I have updated these lines to use `typeof data === "object" && data !== null ? JSON.stringify(data) : String(data)`.
- Now, if the GitHub token fails, the actual API error (like `{"message":"Bad credentials","documentation_url":"..."}`) will be bubbled up to the Daytona sandbox and visible to the user/bot, instead of being masked by `[object Object]`.
