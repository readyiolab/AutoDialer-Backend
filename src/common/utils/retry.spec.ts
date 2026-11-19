import { withRetry, isRetryableDbError } from './retry';

describe('withRetry', () => {
  it('retries a deadlock once and then succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          const err: any = new Error('deadlock detected');
          err.code = 'P2034';
          throw err;
        }
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('does not retry unique-constraint errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      ),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(attempts).toBe(1);
  });

  it('detects retryable deadlock messages', () => {
    expect(isRetryableDbError({ message: 'Transaction deadlock' })).toBe(true);
    expect(isRetryableDbError({ code: 'P2002', message: 'unique' })).toBe(false);
  });
});
