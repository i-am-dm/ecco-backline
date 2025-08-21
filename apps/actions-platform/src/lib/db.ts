import { Pool } from 'pg';
import type pino from 'pino';

let pool: Pool | null = null;

export async function getDb(logger: pino.Logger): Promise<Pool | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (pool) return pool;
  try {
    pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30000 });
    await pool.query('select 1');
    await ensureSchema(pool);
    return pool;
  } catch (err) {
    logger.error({ err }, 'Failed to init Postgres');
    return null;
  }
}

async function ensureSchema(db: Pool) {
  await db.query(`
    create table if not exists idempotency_keys (
      tenant_id text not null,
      tool text not null,
      idem_key text not null,
      req_hash text not null,
      status int not null,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      primary key (tenant_id, tool, idem_key)
    );
  `);
  await db.query(`
    create table if not exists outbox (
      id bigserial primary key,
      tenant_id text not null,
      tool text not null,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      dispatched boolean not null default false
    );
  `);
}

export async function insertOutbox(db: Pool, tenantId: string, tool: string, payload: unknown) {
  await db.query('insert into outbox (tenant_id, tool, payload) values ($1,$2,$3)', [tenantId, tool, payload]);
}


