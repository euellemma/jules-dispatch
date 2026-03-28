export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Optional function to determine if an error is retriable.
   * If it returns false, the retry loop aborts immediately.
   */
  isRetriable?: (error: any) => boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 4, // 1 initial + 3 retries
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  isRetriable: (error: any) => {
    // Retry on network errors (fetch failures)
    if (error.name === "TypeError" && error.message.includes("fetch")) return true;

    // Look for HTTP status codes in standard Error strings or objects
    const status = error.status || error.statusCode || error.response?.status;
    if (status) {
      // 429 Too Many Requests, 500+ Internal Server Errors
      return status === 429 || status >= 500;
    }

    // If it's a generic error string containing 429 or 5xx
    const msg = error.message || String(error);
    if (msg.includes("429") || msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) {
      return true;
    }

    // Default to false for unknown errors (e.g. 400 Bad Request, 401 Unauthorized)
    return false;
  }
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let attempt = 1;

  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      if (attempt >= opts.maxAttempts || !opts.isRetriable(error)) {
        throw error;
      }

      // Check if the error or response has a Retry-After header (often in seconds)
      let delayMs = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);

      const retryAfter = error.response?.headers?.get("Retry-After") || error.headers?.["retry-after"];
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) {
          delayMs = parsed * 1000; // Convert seconds to ms
        }
      }

      console.warn(`[Retry] Attempt ${attempt} failed. Retrying in ${delayMs}ms... Error: ${error.message || error}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}
