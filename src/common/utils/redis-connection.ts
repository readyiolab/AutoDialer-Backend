import type { RedisOptions } from 'ioredis';

/**
 * Build ioredis options from REDIS_URL or Upstash-style REDIS_HOST / PORT / PASSWORD / TLS.
 * BullMQ needs TCP Redis (rediss://), not the Upstash REST API.
 */
export function resolveRedisConnection():
  | { kind: 'url'; url: string; options: RedisOptions }
  | { kind: 'options'; options: RedisOptions }
  | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  const base: RedisOptions = {
    maxRetriesPerRequest: null,
    connectTimeout: 3_000,
    lazyConnect: true,
    enableOfflineQueue: false,
  };

  if (redisUrl) {
    return {
      kind: 'url',
      url: redisUrl,
      options: { ...base },
    };
  }

  const host = process.env.REDIS_HOST?.trim();
  if (!host) return null;

  const port = Number(process.env.REDIS_PORT || 6379);
  const password = process.env.REDIS_PASSWORD?.trim() || undefined;
  const tlsEnabled =
    process.env.REDIS_TLS === 'true' ||
    process.env.REDIS_TLS === '1' ||
    host.includes('upstash.io');

  const options: RedisOptions = {
    ...base,
    host,
    port,
    password,
    ...(tlsEnabled ? { tls: {} } : {}),
  };

  return { kind: 'options', options };
}

export function isRedisConfigured(): boolean {
  return resolveRedisConnection() != null;
}
