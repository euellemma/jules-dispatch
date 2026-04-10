export function generateManagedDeployWorkflow(): string {
  return `name: Managed Deploy

on:
  push:
    branches: [managed]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci && cd web && npm ci

      - name: Type check
        run: npx tsc --noEmit && cd web && npx tsc --noEmit

      - name: Lint
        run: npm run lint && cd web && npm run lint

      - name: Build web
        run: npm run build:web

      - name: Set environment variables
        env:
          CONVEX_DEPLOY_KEY: \${{ secrets.CONVEX_DEPLOY_KEY }}
        run: |
          npx convex env set TELEGRAM_BOT_TOKEN "\${{ secrets.TELEGRAM_BOT_TOKEN }}" --prod
          npx convex env set JULES_API_KEY "\${{ secrets.JULES_API_KEY }}" --prod
          npx convex env set GITHUB_PAT "\${{ secrets.GITHUB_PAT }}" --prod
          npx convex env set EXA_API_KEY "\${{ secrets.EXA_API_KEY }}" --prod
          npx convex env set LLM_ENDPOINT "\${{ secrets.LLM_ENDPOINT }}" --prod
          npx convex env set LLM_MODEL "\${{ secrets.LLM_MODEL }}" --prod
          npx convex env set LLM_API_KEY "\${{ secrets.LLM_API_KEY }}" --prod
          npx convex env set LLM_SDK_TYPE "\${{ secrets.LLM_SDK_TYPE }}" --prod
          npx convex env set CONVEX_SITE_URL "\${{ secrets.CONVEX_SITE_URL }}" --prod

      - name: Deploy to Convex
        env:
          CONVEX_DEPLOY_KEY: \${{ secrets.CONVEX_DEPLOY_KEY }}
        run: npx convex deploy --yes

      - name: Deploy web UI
        env:
          CONVEX_DEPLOY_KEY: \${{ secrets.CONVEX_DEPLOY_KEY }}
        run: npm run deploy:web

      - name: Health check
        env:
          CONVEX_SITE_URL: \${{ secrets.CONVEX_SITE_URL }}
        run: |
          for i in $(seq 1 30); do
            if curl -sf "\${CONVEX_SITE_URL}/api/health" > /dev/null 2>&1; then
              echo "Deployment healthy"
              exit 0
            fi
            echo "Waiting for deployment... ($i/30)"
            sleep 5
          done
          echo "Deployment failed health check"
          exit 1

      - name: Set up Telegram webhook
        if: success()
        env:
          TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
          CONVEX_SITE_URL: \${{ secrets.CONVEX_SITE_URL }}
        run: |
          curl -s "https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/setWebhook?url=\${CONVEX_SITE_URL}/telegram" > /dev/null
`;
}
