# Contributing to Ecco Backline

This document outlines the patterns and conventions for extending the Ecco Backline reference architecture.

## Reference Architecture Patterns

### Adding New Tools

1. **Define the tool** in `packages/tool-schemas/v1/tools.json`:
```json
{
  "name": "inventory.check_stock",
  "description": "Check product inventory levels",
  "input_schema": {
    "type": "object",
    "required": ["sku"],
    "properties": {
      "sku": { "type": "string" },
      "location": { "type": "string" }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "available": { "type": "integer" },
      "reserved": { "type": "integer" }
    }
  },
  "side_effects": "read",
  "scopes_required": ["inventory:read"]
}
```

2. **Extend the canonical model** if needed in `packages/canonical-model/v1/schema.json`

3. **Implement the handler** following the pattern in `src/lib/handlers/`

4. **Register the handler** in `src/lib/toolRouter.ts`

5. **Enable in tenant config** in `config/tenants/*.json`

### Adding New Connectors

1. **Create vendor mapping** in `config/connectors/vendors/newvendor.json`:
```json
{
  "provider": "newvendor",
  "mappings": {
    "Customer": {
      "id": "user.id",
      "primary_contact.name": "user.full_name"
    }
  },
  "features": {
    "supports_webhooks": true
  }
}
```

2. **Add OAuth provider** in `config/oauth/providers/newvendor.json`

3. **Implement connector client** following established patterns

### Configuration Patterns

- **Schema-first**: All inputs/outputs must have JSON Schema definitions
- **Multi-tenant**: Use tenant configs to control feature access
- **Idempotent writes**: All write operations must support idempotency keys
- **Observability**: Log structured data, emit metrics for key operations
- **Graceful degradation**: Fall back to memory when Redis unavailable

### Code Style

- TypeScript with strict mode
- ESM modules targeting Node 20+
- Prefer explicit types over `any`
- Use Ajv for runtime validation
- Follow existing error handling patterns

### Testing Strategy (Future)

- Unit tests for pure functions (idempotency, validation)
- Integration tests using Fastify's inject()
- Contract tests against JSON Schemas
- End-to-end tests with real vendor APIs (sandbox)

## Development Workflow

1. Fork and create feature branch
2. Implement following the patterns above  
3. Update relevant documentation
4. Test locally with `npm run dev`
5. Submit PR with clear description of changes

## Questions?

This is a reference architecture - adapt these patterns to your specific client integration needs.
