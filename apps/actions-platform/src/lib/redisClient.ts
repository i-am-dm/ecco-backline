import type pino from 'pino';

export type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
};

export async function createRedisClient(logger: pino.Logger): Promise<RedisLike | null> {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  try {
    // Dynamic import to avoid dependency if not used
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(url, { enableAutoPipelining: true });
    client.on('error', (err: any) => logger.warn({ err }, 'Redis error'));
    await client.ping();
    return client as unknown as RedisLike;
  } catch (err) {
    logger.warn({ err }, 'Failed to init Redis, proceeding without it');
    return null;
  }
}


