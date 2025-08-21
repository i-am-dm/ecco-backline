import type pino from 'pino';
import type { FastifyInstance } from 'fastify';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { createCrmHandlers } from './handlers/crm.js';
import { createRedisClient } from './redisClient.js';
import { readFile } from 'node:fs/promises';
import { createIdempotencyStore, stableStringify, hashString } from './idempotency.js';
import { authenticate, requireScopes } from './auth.js';
import { getDb, insertOutbox } from './db.js';
import { loadPolicy, checkUpdateCase, checkEscalateCase } from './policyEngine.js';

type ToolRouterOpts = {
  configLoader: { getBundle: () => { toolManifest: any } };
  logger: pino.Logger;
};

export function createToolRouter(opts: ToolRouterOpts) {
  const { configLoader, logger } = opts;
  const ajv = new Ajv2020({ removeAdditional: true, useDefaults: true, strictSchema: false });
  addFormats(ajv);
  // Register canonical model so external $id refs resolve
  const canonical = configLoader.getBundle().canonicalModel;
  if (canonical && canonical.$id) {
    ajv.addSchema(canonical);
  }

  async function registerRoutes(app: FastifyInstance) {
    const manifest = configLoader.getBundle().toolManifest;
    const tenantSchemaObj = configLoader.getBundle().schemas?.tenant;
    const validateTenant = tenantSchemaObj ? ajv.compile(tenantSchemaObj) : null;
    const redis = await createRedisClient(logger);
    const db = await getDb(logger);
    const crm = createCrmHandlers({
      logger,
      redis,
      getTenantConfig: (tenantId: string) => tenantCacheGet(tenantId)
    });
    const idempotency = createIdempotencyStore({ logger, redis, ttlSeconds: 7 * 24 * 3600, db });

    async function tenantCacheGet(tenantId: string) {
      try {
        const cached = tenantCache.get(tenantId);
        if (cached) return cached;
        const url = new URL(`../../../../config/tenants/${tenantId}.json`, import.meta.url);
        const json = JSON.parse(await readFile(url, 'utf-8'));
        if (validateTenant && !validateTenant(json)) {
          logger.warn({ tenantId, errors: validateTenant.errors }, 'Tenant config failed validation');
          return null;
        }
        tenantCache.set(tenantId, json);
        return json;
      } catch (err) {
        logger.warn({ err, tenantId }, 'Failed to load tenant config');
        return null;
      }
    }
    const tenantCache = new Map<string, any>();
    const examples: Record<string, { request: any; response: any }> = {
      'meta.health': { request: {}, response: { status: 'ok', uptime_ms: 1234 } },
      'crm.lookup_customer': {
        request: { query: '+15125550100', include: ['cases', 'entitlements'] },
        response: { match_quality: 'strong', customer: { id: 'cust_123', identifiers: { phone: '+15125550100' } } }
      },
      'crm.create_case': {
        request: { customer_id: 'cust_123', subject: 'Issue with order', priority: 'normal', tags: ['voice'] },
        response: { case: { id: 'case_123', subject: 'Issue with order', status: 'new', customer_id: 'cust_123' } }
      },
      'crm.add_note': {
        request: { case_id: 'case_123', body: 'Call initiated via IVR', visibility: 'internal', author: 'system' },
        response: { note: { id: 'note_123', case_id: 'case_123', channel: 'voice', body: 'Call initiated via IVR', visibility: 'internal', author: 'system' } }
      },
      'crm.update_case': {
        request: { id: 'case_123', status: 'open', priority: 'high' },
        response: { case: { id: 'case_123', status: 'open', priority: 'high' } }
      },
      'crm.escalate_case': {
        request: { id: 'case_123', queue: 'tier2_us' },
        response: { case: { id: 'case_123', assigned_queue: 'tier2_us', custom_fields: { escalated: true } } }
      }
    };

    for (const tool of manifest.tools) {
      const urlPath = `/tools/${tool.name}`.replace(/\./g, '/');
      const validateInput = ajv.compile(tool.input_schema || { type: 'object' });
      const validateOutput = ajv.compile(tool.output_schema || { type: 'object' });

      app.post(
        urlPath,
        {
          schema: {
            summary: tool.description,
            tags: ['tools'],
            headers: {
              type: 'object',
              properties: {
                authorization: { type: 'string', description: 'Bearer token' },
                'x-tenant-id': { type: 'string', description: 'Tenant ID', examples: ['demo'] },
                ...(tool.side_effects === 'write' ? { 'idempotency-key': { type: 'string', description: 'Idempotency key' } } : {})
              },
              required: ['authorization']
            },
            body: { ...tool.input_schema, example: examples[tool.name]?.request } || { type: 'object' },
            response: {
              200: { ...tool.output_schema, example: examples[tool.name]?.response } || { type: 'object' },
              400: { $ref: 'ErrorEnvelope#', example: { error: { type: 'ValidationError', message: 'Invalid input' } } },
              401: { $ref: 'ErrorEnvelope#', example: { error: { type: 'PermissionDenied', message: 'Missing bearer token' } } },
              403: { $ref: 'ErrorEnvelope#', example: { error: { type: 'PermissionDenied', message: 'Insufficient scopes' } } },
              429: { $ref: 'ErrorEnvelope#', example: { error: { type: 'RateLimited', retry_after_ms: 1000, message: 'Too Many Requests' } } },
              503: { $ref: 'ErrorEnvelope#', example: { error: { type: 'ProviderUnavailable', message: 'Circuit open' } } }
            },
            security: [{ bearerAuth: [] }]
          }
        },
        async (request, reply) => {
          const auth = await authenticate(request);
          if (!auth.ok) {
            return reply.code(401).send({ error: auth.error });
          }

          const body = request.body as any;
          const tenantId = (request.headers['x-tenant-id'] as string) || 'demo';
          const callId = (request.headers['x-call-id'] as string) || undefined;
          // Enforce idempotency header on writes
          if (tool.side_effects === 'write') {
            const idem = (request.headers['idempotency-key'] as string) || body.idempotency_key;
            if (!idem) return reply.code(400).send({ error: { type: 'ValidationError', message: 'Idempotency-Key required for writes' } });
          }

          // Scope check from manifest
          const needScopes: string[] = Array.isArray(tool.scopes_required) ? tool.scopes_required : [];
          if (!requireScopes(auth.scopes, needScopes)) {
            return reply.code(403).send({ error: { type: 'PermissionDenied', message: 'Insufficient scopes' } });
          }
          if (!validateInput(body)) {
            return reply.code(400).send({ error: { type: 'ValidationError', message: 'Invalid input', details: validateInput.errors } });
          }

          if (tool.name === 'meta.health') {
            const payload = { status: 'ok', uptime_ms: Math.floor(process.uptime() * 1000) };
            if (!validateOutput(payload)) {
              return reply.code(500).send({ error: { type: 'ValidationError', message: 'Output did not match schema' } });
            }
            return reply.send(payload);
          }

          if (tool.name === 'crm.lookup_customer') {
            const { status, payload } = await crm.lookupCustomer(tenantId, body);
            if (!validateOutput(payload)) {
              return reply.code(500).send({ error: { type: 'ValidationError', message: 'Output did not match schema' } });
            }
            return reply.code(status).send(payload);
          }

          if (tool.name === 'crm.create_case' || tool.name === 'crm.add_note' || tool.name === 'crm.update_case' || tool.name === 'crm.escalate_case') {
            const idempotencyKey = (request.headers['idempotency-key'] as string) || body.idempotency_key;
            const requestHash = hashString(stableStringify({ tool: tool.name, tenantId, body }));
            const cacheKey = `idem:${tenantId}:${tool.name}:${idempotencyKey || 'no-key'}`;
            if (idempotencyKey) {
              const existed = await idempotency.get(cacheKey);
              if (existed && existed.reqHash === requestHash) {
                return reply.code(200).send(existed.payload as any);
              }
            }

            // Policy checks
            if (tool.name === 'crm.update_case' || tool.name === 'crm.escalate_case') {
              const tenant = await tenantCacheGet(tenantId);
              const policyPath = new URL(`../../../../config/policies/${tenant?.tenant_id || 'demo'}.json`, import.meta.url);
              const policy = await loadPolicy(policyPath);
              const decision = tool.name === 'crm.update_case' ? checkUpdateCase(policy, body) : checkEscalateCase(policy, body);
              if (decision.status === 'denied') {
                return reply.code(403).send({ error: { type: 'PermissionDenied', message: decision.reason || 'Denied by policy' } });
              }
              if (decision.status === 'needs_approval' && !body.approval_token) {
                return reply.code(202).send({ error: { type: 'PermissionDenied', message: 'Approval required', details: { required_steps: decision.required_steps } } });
              }
            }
            const result = await (
              tool.name === 'crm.create_case' ? crm.createCase(tenantId, body)
              : tool.name === 'crm.add_note' ? crm.addNote(tenantId, body)
              : tool.name === 'crm.update_case' ? crm.updateCase(tenantId, body)
              : crm.escalateCase(tenantId, body)
            );
            if (db) {
              await insertOutbox(db, tenantId, tool.name, { request: body, result: result.payload });
            }
            if (idempotencyKey) {
              await idempotency.set(cacheKey, { reqHash: requestHash, status: result.status, payload: result.payload, createdAt: Date.now() });
            }
            return reply.code(result.status).send(result.payload);
          }

          logger.info({ tool: tool.name, body }, 'Tool called (not implemented)');
          return reply.code(501).send({ error: { type: 'ProviderUnavailable', message: 'Tool not implemented yet' } });
        }
      );
    }
  }

  return { registerRoutes };
}


