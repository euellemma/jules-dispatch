# Jules Dispatch + Executor Integration

Use Jules Dispatch (`send-message` and `upload-file`) as tools in [Executor](https://github.com/executor/executor).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              EACH DEPLOYMENT (Per-User)                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Your Convex Site                                       ││
│  │  https://happy-hippo-123.convex.site                   ││
│  │                                                         ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     ││
│  │  │/openapi.json│  │/api/send-   │  │/api/upload- │     ││
│  │  │  (spec)     │  │  message    │  │  file       │     ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘     ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────┘
                          │
              Spec URL +  │  Auth
              Auth Token  │  (CONVEX_DEPLOY_KEY)
                 │        │           │
                 ▼        ▼           ▼
┌─────────────────────────────────────────────────────────────┐
│                 EXECUTOR (Source Detection)                   │
│                                                              │
│  Add OpenAPI Source:                                         │
│  - Spec URL: https://happy-hippo-123.convex.site/openapi.json│
│  - Base URL: (from spec)                                     │
│  - Auth: Bearer <deploy_key>                                 │
│                                                              │
│  Result: jules_dispatch.sendMessage tool                     │
│          jules_dispatch.uploadFile tool                      │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Get Your Deployment URL

```bash
# From your project
cat .env.local | grep CONVEX_SITE_URL
# https://happy-hippo-123.convex.site
```

### 2. Add to Executor

In Executor (desktop app or Daytona):

1. **Tool Sources** → **Add Source** → **OpenAPI**
2. **Spec URL**: Your Convex site + `/openapi.json`
   ```
   https://happy-hippo-123.convex.site/openapi.json
   ```
   *(The spec is now served from your own deployment - works with private repos)*
3. **Base URL**: Auto-populated from the spec (your Convex site URL)
4. **Authentication**:
   - Type: Bearer Token
   - Token: Your `CONVEX_DEPLOY_KEY` from `.env.local`

### 3. Use the Tools

```typescript
// Send a message
await tools.jules_dispatch.sendMessage({
  message: "Review the code in src/utils.ts"
});

// Upload a file
await tools.jules_dispatch.uploadFile({
  file: someFileBuffer,
  caption: "Bug report screenshot",
  prompt: "Analyze this error and suggest fixes"
});
```

## Why This Pattern?

| Aspect | Design |
|--------|--------|
| **Spec** | Served from each deployment (no external hosting needed) |
| **Base URL** | Auto-detected from the spec (your Convex site) |
| **Auth** | Per-deployment (your unique CONVEX_DEPLOY_KEY) |

This works with **private repos** because the spec is served from your Convex deployment, not GitHub.

## Files

| File | Purpose | Location |
|------|---------|----------|
| `openapi.json` (static) | Backup spec file | Repo root (not used directly) |
| `/openapi.json` (endpoint) | **Live spec served from your deployment** | `https://YOUR_SITE.convex.site/openapi.json` |

## Future: Automatic Setup

Later we can add:

```bash
npx jules-dispatch executor-init
# Detects your Convex URL
# Creates executor.jsonc with your specific config
# Prompts for deploy key
# Triggers executor sync
```

But for now, manual setup via Executor UI works perfectly.
