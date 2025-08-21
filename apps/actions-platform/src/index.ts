import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import pino from 'pino';
import { createConfigLoader } from './lib/configLoader.js';
import { createToolRouter } from './lib/toolRouter.js';
import { createRateLimiter } from './lib/ratelimit.js';
import { createCircuit } from './lib/circuitBreaker.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

async function main() {
  const app = Fastify({ logger });
  // Use Ajv 2020 so $schema 2020-12 and $id refs resolve
  const ajv = new Ajv2020({ removeAdditional: true, useDefaults: true, strictSchema: false });
  addFormats(ajv);
  app.setValidatorCompiler(({ schema }) => {
    return ajv.compile(schema as any);
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Actions Platform API', version: '0.1.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          mtls: { type: 'mutualTLS' }
        },
        headers: {
          XTenantId: { schema: { type: 'string', description: 'Tenant ID', example: 'demo' } },
          XCallId: { schema: { type: 'string', description: 'Correlation ID for a call/session' } },
          IdempotencyKey: { schema: { type: 'string', description: 'Required for writes' } }
        },
        schemas: {
          ErrorEnvelope: {
            type: 'object',
            properties: {
              error: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  retry_after_ms: { type: 'number' },
                  message: { type: 'string' },
                  details: { type: 'object', additionalProperties: true }
                },
                required: ['type', 'message']
              }
            },
            required: ['error']
          }
        }
      },
      security: [{ bearerAuth: [] }]
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const configLoader = await createConfigLoader({
    manifestPath: new URL('../../../config/manifest/mcp.json', import.meta.url),
    watch: true
  });

  // Register canonical schema with both Fastify and Ajv
  const canonical = configLoader.getBundle().canonicalModel;
  if (canonical && canonical.$id) {
    app.addSchema(canonical);
    ajv.addSchema(canonical);
  }

  // Register ErrorEnvelope schema for route responses
  const ErrorEnvelope = {
    $id: 'ErrorEnvelope',
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          retry_after_ms: { type: 'number' },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true }
        },
        required: ['type', 'message']
      }
    },
    required: ['error']
  } as const;
  app.addSchema(ErrorEnvelope);
  ajv.addSchema(ErrorEnvelope as any);

  const toolRouter = createToolRouter({ configLoader, logger });

  // Rate limit and circuit breaker hooks with per-tenant JSON loader
  const tenantCfgCache = new Map<string, any>();
  async function loadTenantCfg(tenantId: string) {
    const cached = tenantCfgCache.get(tenantId);
    if (cached) return cached;
    const url = new URL(`../../../config/tenants/${tenantId}.json`, import.meta.url);
    try {
      const { readFile } = await import('node:fs/promises');
      const json = JSON.parse(await readFile(url, 'utf-8'));
      tenantCfgCache.set(tenantId, json);
      return json;
    } catch {
      return null;
    }
  }
  const rateLimiter = createRateLimiter((tenantId: string) => tenantCfgCache.get(tenantId));
  const circuit = createCircuit((tenantId: string) => tenantCfgCache.get(tenantId));
  app.addHook('onRequest', (req, reply, done) => {
    const tenantId = (req.headers['x-tenant-id'] as string) || 'demo';
    loadTenantCfg(tenantId).finally(() => {
      if (circuit.pre(req, reply) === false) return;
      if (rateLimiter(req, reply) === false) return;
      done();
    });
  });

  app.get('/health', async (_req, _res) => ({ status: 'ok', uptime_ms: Math.floor(process.uptime() * 1000) }));

  // Register tool endpoints from manifest as OpenAPI routes
  await toolRouter.registerRoutes(app);

  // Expose raw OpenAPI JSON
  app.get('/openapi.json', async (_req, reply) => reply.send(app.swagger()));

  const port = Number(process.env.PORT || 3030);
  await app.listen({ host: '0.0.0.0', port });
  logger.info({ port }, 'Actions Platform listening');
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});


