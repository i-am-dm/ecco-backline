import type pino from 'pino';
import type { RedisLike } from '../redisClient.js';

export type TenantConfig = any;

export function createCrmHandlers(opts: { logger: pino.Logger; redis: RedisLike | null; getTenantConfig: (tenantId: string) => TenantConfig | null }) {
  const { logger, redis, getTenantConfig } = opts;

  return {
    async lookupCustomer(tenantId: string, body: { query: string; include?: string[] }) {
      const tenant = getTenantConfig(tenantId);
      if (!tenant) {
        return { status: 400, payload: { error: { type: 'ValidationError', message: 'Unknown tenant' } } };
      }
      const cacheKey = `t:${tenantId}:lookup:${body.query}`;
      const swrMs = Number(tenant?.cache?.stale_while_revalidate_ms || 120000);
      const ttlSeconds = Math.max(1, Math.floor((tenant?.cache?.customer_lookup_ttl_ms || 30000) / 1000));

      if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const { payload, ts } = JSON.parse(cached);
          if (Date.now() - ts < swrMs) {
            revalidateInBackground();
            return { status: 200, payload };
          }
        }
      }

      const fresh = await performProviderLookup(tenant, body);
      if (redis) {
        await redis.set(cacheKey, JSON.stringify({ payload: fresh, ts: Date.now() }), 'EX', ttlSeconds);
      }
      return { status: 200, payload: fresh };

      async function revalidateInBackground() {
        performProviderLookup(tenant, body)
          .then((fresh) => redis && redis.set(cacheKey, JSON.stringify({ payload: fresh, ts: Date.now() }), 'EX', ttlSeconds))
          .catch((err) => logger.warn({ err }, 'Lookup revalidation failed'));
      }
    },

    async updateCase(tenantId: string, body: { id: string; subject?: string; status?: string; priority?: string; assigned_queue?: string; tags?: string[]; custom_fields?: Record<string, unknown> }) {
      const tenant = getTenantConfig(tenantId);
      if (!tenant) return { status: 400, payload: { error: { type: 'ValidationError', message: 'Unknown tenant' } } };
      const c = {
        id: body.id,
        subject: body.subject || 'Updated',
        status: body.status || 'open',
        priority: body.priority || 'normal',
        customer_id: 'unknown',
        assigned_queue: body.assigned_queue,
        tags: body.tags || [],
        custom_fields: body.custom_fields || {}
      };
      return { status: 200, payload: { case: c } };
    },

    async escalateCase(tenantId: string, body: { id: string; queue: string; note?: string }) {
      const tenant = getTenantConfig(tenantId);
      if (!tenant) return { status: 400, payload: { error: { type: 'ValidationError', message: 'Unknown tenant' } } };
      const c = {
        id: body.id,
        subject: 'Escalated',
        status: 'open',
        priority: 'high',
        customer_id: 'unknown',
        assigned_queue: body.queue,
        tags: [],
        custom_fields: { escalated: true }
      };
      return { status: 200, payload: { case: c } };
    },

    async createCase(tenantId: string, body: { customer_id: string; subject: string; priority?: string; initial_note?: string; tags?: string[] }) {
      const tenant = getTenantConfig(tenantId);
      if (!tenant) return { status: 400, payload: { error: { type: 'ValidationError', message: 'Unknown tenant' } } };
      const c = {
        id: `case_${hash(body.customer_id + ':' + body.subject)}`,
        subject: body.subject,
        status: 'new',
        priority: body.priority || 'normal',
        customer_id: body.customer_id,
        tags: body.tags || [],
        custom_fields: {}
      };
      return { status: 200, payload: { case: c } };
    },

    async addNote(tenantId: string, body: { case_id: string; body: string; visibility?: 'internal' | 'external'; author?: 'system' | 'agent' | 'bot' }) {
      const tenant = getTenantConfig(tenantId);
      if (!tenant) return { status: 400, payload: { error: { type: 'ValidationError', message: 'Unknown tenant' } } };
      const n = {
        id: `note_${hash(body.case_id + ':' + body.body)}`,
        case_id: body.case_id,
        channel: 'voice',
        body: body.body,
        visibility: body.visibility || 'internal',
        author: body.author || 'system',
        timestamp: new Date().toISOString()
      };
      return { status: 200, payload: { note: n } };
    }
  };
}

async function performProviderLookup(_tenant: TenantConfig, body: { query: string; include?: string[] }) {
  // Stubbed response; will call configured connectors next
  const match = inferMatchQuality(body.query);
  const customer = {
    id: `cust_${hash(body.query)}`,
    identifiers: inferIdentifiers(body.query),
    primary_contact: { name: 'Unknown', phones: [], emails: [] },
    external_ids: [],
    attributes: {},
    entitlements: [],
    segments: []
  };
  return { match_quality: match, customer };
}

function inferMatchQuality(q: string): 'exact' | 'strong' | 'fuzzy' | 'none' {
  if (/^\+?\d{10,}$/.test(q) || /@/.test(q)) return 'strong';
  if (q.length > 3) return 'fuzzy';
  return 'none';
}

function inferIdentifiers(q: string) {
  if (/@/.test(q)) return { email: q };
  if (/^\+?\d{10,}$/.test(q)) return { phone: q };
  return { customer_number: q };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}


