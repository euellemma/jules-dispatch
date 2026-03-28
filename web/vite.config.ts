import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env files for the current mode (development, production, etc.)
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    base: '/settings/',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      port: 5173,
      // Proxy API calls to Convex dev server during development
      proxy: {
        '/settings/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    // Expose env vars that start with VITE_ to the client
    define: {
      // Ensure VITE_SENTRY_DSN is available to the app
      'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(env.VITE_SENTRY_DSN || ''),
    },
  }
})
