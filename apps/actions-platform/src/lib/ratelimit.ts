import type { FastifyRequest, FastifyReply } from 'fastify';

type TokenBucket = { tokens: number; lastRefill: number };

export function createRateLimiter(getTenantCfg: (tenantId: string) => any) {
  const buckets = new Map<string, TokenBucket>();

  return function rateLimit(req: FastifyRequest, reply: FastifyReply) {
    const tenantId = (req.headers['x-tenant-id'] as string) || 'demo';
    const cfg = getTenantCfg(tenantId);
    const rps = Number(cfg?.rate_limiter?.rps || 50);
    const burst = Number(cfg?.rate_limiter?.burst || rps * 2);
    const key = `${tenantId}`;
    const now = Date.now();
    const bucket = buckets.get(key) || { tokens: burst, lastRefill: now };
    // refill
    const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000);
    bucket.tokens = Math.min(burst, bucket.tokens + elapsedSec * rps);
    bucket.lastRefill = now;
    if (bucket.tokens < 1) {
      reply.code(429).send({ error: { type: 'RateLimited', retry_after_ms: 1000, message: 'Too Many Requests' } });
      return false;
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return true;
  };
}


