const RETRYABLE_CODES = new Set([
  'P1001', // Can't reach database
  'P1002', // Database timeout
  'P1008', // Operations timed out
  'P1017', // Server closed connection
  'P2024', // Timed out fetching a connection from pool
  'P2034', // Transaction conflict / write conflict / deadlock
]);

const RETRYABLE_MESSAGE_PARTS = [
  'deadlock',
  'serialization failure',
  'connection terminated',
  'connection reset',
  'econnreset',
  'etimedout',
  'too many connections',
];

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  context?: string;
  retryIf?: (error: unknown) => boolean;
}

export function isRetryableDbError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  if (err?.code && RETRYABLE_CODES.has(err.code)) {
    return true;
  }
  const message = (err?.message || '').toLowerCase();
  return RETRYABLE_MESSAGE_PARTS.some((part) => message.includes(part));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.max(1, exp * 0.2));
  return Math.min(maxDelayMs, exp + jitter);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 25;
  const maxDelayMs = options.maxDelayMs ?? 250;
  const retryIf = options.retryIf ?? isRetryableDbError;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !retryIf(error)) {
        throw error;
      }
      await sleep(computeDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
  throw lastError;
}
