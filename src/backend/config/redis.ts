import { Redis } from 'ioredis';
import { env } from './env.ts';

let sharedConnection: Redis | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL && env.REDIS_URL.trim().length > 0);
}

export function getRedisConnection(): Redis {
  if (!isRedisConfigured()) {
    throw new Error('REDIS_URL is not configured');
  }
  if (!sharedConnection) {
    sharedConnection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return sharedConnection;
}

export async function closeRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}
