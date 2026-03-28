import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { ErrorFallback } from './components/ErrorFallback'
import './index.css'
import App from './App.tsx'

// Initialize Sentry for browser-side error tracking
// VITE_SENTRY_DSN is injected by Vite from .env (VITE_ prefix is required for client-side env vars)
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Don't send server errors to the browser SDK
    ignoreErrors: [
      // Ignore network errors (user lost connection, etc.)
      'Failed to fetch',
      'NetworkError',
      'Network request failed',
    ],
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {import.meta.env.VITE_SENTRY_DSN ? (
      <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
        <App />
      </Sentry.ErrorBoundary>
    ) : (
      <App />
    )}
  </StrictMode>,
)
