export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  onRetry: () => {},
};

function isRetriableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // Fetch network errors (TypeError: fetch failed)
    return true;
  }

  if (error instanceof Response) {
    // HTTP errors - retry on 5xx server errors and 429 rate limit
    return error.status === 429 || error.status >= 500;
  }

  return false;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= opts.maxAttempts;
      const shouldRetry = isRetriableError(error);

      if (isLastAttempt || !shouldRetry) {
        throw error;
      }

      const delayMs = opts.baseDelayMs * Math.pow(2, attempt - 1);
      opts.onRetry(attempt, error instanceof Error ? error : new Error(String(error)));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
