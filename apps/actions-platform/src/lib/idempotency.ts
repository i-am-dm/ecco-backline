import { createHash } from 'node:crypto';
import type pino from 'pino';
import type { RedisLike } from './redisClient.js';
import type { Pool } from 'pg';

type StoredRecord = {
  reqHash: string;
  status: number;
  payload: unknown;
  createdAt: number;
};

export function createIdempotencyStore(opts: { logger: pino.Logger; redis: RedisLike | null; ttlSeconds: number; db?: Pool | null }) {
  const { logger, redis, db } = opts;
  const ttlSeconds = Math.max(60, opts.ttlSeconds || 7 * 24 * 3600);
  const memory = new Map<string, StoredRecord>();

  return {
    async get(key: string): Promise<StoredRecord | null> {
      if (db) {
        const res = await db.query('select req_hash, status, payload, extract(epoch from (now()-created_at))::int as age from idempotency_keys where tenant_id=$1 and tool=$2 and idem_key=$3', (key.split(':') as any));
        if (res.rows[0]) return { reqHash: res.rows[0].req_hash, status: res.rows[0].status, payload: res.rows[0].payload, createdAt: Date.now() - res.rows[0].age * 1000 };
        return null;
      }
      if (redis) {
        const raw = await redis.get(key);
        if (raw) return JSON.parse(raw);
        return null;
      }
      return memory.get(key) || null;
    },
    async set(key: string, rec: StoredRecord): Promise<void> {
      if (db) {
        const [tenantId, tool, idemKey] = key.replace(/^idem:/, '').split(':');
        try {
          await db.query('insert into idempotency_keys (tenant_id, tool, idem_key, req_hash, status, payload) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [tenantId, tool, idemKey, rec.reqHash, rec.status, rec.payload]);
          return;
        } catch (err) {
          logger.warn({ err }, 'Idempotency DB set failed');
        }
      }
      if (redis) {
        try {
          await redis.set(key, JSON.stringify(rec), 'EX', ttlSeconds);
          return;
        } catch (err) {
          logger.warn({ err }, 'Idempotency Redis set failed, falling back to memory');
        }
      }
      memory.set(key, rec);
      // Best-effort cleanup
      setTimeout(() => memory.delete(key), ttlSeconds * 1000).unref?.();
    }
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, replacer);
}

function replacer(_key: string, value: any) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = value[k];
        return acc;
      }, {});
  }
  return value;
}

export function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}


