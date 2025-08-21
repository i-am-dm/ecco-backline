# Testing Patterns for Ecco Backline

This directory demonstrates the testing architecture for the Actions Platform reference implementation.

## Structure

```
tests/
├── unit/           # Pure function tests
├── integration/    # API endpoint tests  
└── fixtures/       # Test data and mocks
```

## Testing Patterns

### Unit Tests
- Test pure functions (idempotency, validation, mapping)
- Mock external dependencies (Redis, HTTP clients)
- Focus on business logic correctness

### Integration Tests  
- Test complete request/response flows
- Use Fastify's `inject()` for HTTP testing
- Test with real JSON Schema validation
- Mock external vendor APIs

### Contract Tests
- Validate all tool schemas work with canonical model
- Test vendor mappings against real API responses
- Ensure backward compatibility

## Example Test Structure

```typescript
// tests/unit/idempotency.test.ts
describe('Idempotency Store', () => {
  it('should generate stable hashes for identical requests', () => {
    // Test stableStringify and hashString functions
  });
});

// tests/integration/crm-tools.test.ts  
describe('CRM Tools', () => {
  it('should validate customer lookup requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tools/crm/lookup_customer',
      headers: { 'x-tenant-id': 'demo' },
      payload: { query: 'test@example.com' }
    });
    // Assert response matches output schema
  });
});
```

## Future Implementation

When implementing tests, follow these patterns:
- Use Jest or Vitest as test runner
- Use Fastify's built-in test utilities
- Mock external APIs with MSW or similar
- Test both happy path and error scenarios
- Validate all responses against JSON Schemas
