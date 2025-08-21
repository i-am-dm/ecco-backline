# Ecco Backline — Actions Platform

Schema-first, config-driven API platform for customer support integrations. Brokers between canonical data models and vendor-specific connectors (Salesforce, Zendesk, etc.).

> **Reference Architecture**  
> This codebase demonstrates patterns for client integration layers: config-driven tools, JSON Schema validation, idempotent writes, tenant isolation, and observability hooks.

### Architecture at a glance

```mermaid
flowchart LR
  Client[Agent / Voice Platform] -->|"HTTP POST /tools/*"| AP[Actions Platform - Fastify]
  subgraph Config
    M["Manifest<br/>config/manifest/mcp.json"]
    T["Tenants<br/>config/tenants/*.json"]
    V["Vendor mappings<br/>config/connectors/vendors/*.json"]
    O["OAuth providers<br/>config/oauth/providers/*.json"]
  end
  Config -->|"load & watch"| CL[Config Loader]
  CL --> AP
  AP --> TR[Tool Router]
  TR --> HCRM[CRM Handlers]
  HCRM -.->|"future"| SF[Salesforce]
  HCRM -.->|"future"| ZD[Zendesk]
  AP -->|"docs"| Swagger[Swagger UI / OpenAPI]
  AP -->|"optional"| Redis[("Redis: cache + idempotency")]
```

**Key Features:** Declarative tools • OpenAPI + Swagger UI • JSON Schema validation • Canonical data model • Idempotent writes • Optional Redis caching

## Status

**✅ Implemented:** Core API, schema validation, idempotency, multi-tenant config, OpenAPI docs, Redis caching  
**🚧 Stubbed:** Vendor connectors, observability hooks, rate limiting, circuit breaker, automated tests

## Architecture Diagrams

### System Architecture & Request Flow

```mermaid
graph TB
    subgraph "Client Layer"
        Voice[Voice Platform]
        Agent[Agent Platform]
        API[External API Clients]
    end
    
    subgraph "Actions Platform - Fastify"
        Router[Tool Router]
        Auth[Auth Middleware]
        Valid[Schema Validation<br/>Ajv 2020-12]
        Idem[Idempotency Store]
        Cache[Cache Layer<br/>SWR]
    end
    
    subgraph "Handlers"
        CRM[CRM Handlers]
        Meta[Meta Handlers]
        Future[Future Handlers...]
    end
    
    subgraph "External Systems"
        SF[Salesforce API]
        ZD[Zendesk API]
        Other[Other Vendors...]
    end
    
    subgraph "Storage"
        Redis[(Redis<br/>Cache + Idempotency)]
        Secrets[Secret Store<br/>Vault/AWS SM]
    end
    
    subgraph "Config System"
        Manifest[Tool Manifest<br/>packages/tool-schemas/]
        Canonical[Canonical Model<br/>packages/canonical-model/]
        Tenants[Tenant Configs<br/>config/tenants/]
        Mappings[Vendor Mappings<br/>config/connectors/]
        OAuth[OAuth Providers<br/>config/oauth/]
    end
    
    Voice -->|"HTTP POST /tools/*"| Router
    Agent -->|"HTTP POST /tools/*"| Router
    API -->|"HTTP POST /tools/*"| Router
    
    Router --> Auth
    Auth --> Valid
    Valid --> Idem
    Idem --> Cache
    Cache --> CRM
    Cache --> Meta
    Cache --> Future
    
    CRM -.->|"Future: via mappings"| SF
    CRM -.->|"Future: via mappings"| ZD
    Future -.-> Other
    
    Cache <--> Redis
    Idem <--> Redis
    
    Manifest -.->|"Hot reload"| Router
    Canonical -.->|"Hot reload"| Router
    Tenants -.->|"Hot reload"| Router
    Mappings -.->|"Hot reload"| Router
    OAuth -.->|"Hot reload"| Router
    Secrets -.->|"Runtime lookup"| CRM
```

### Configuration-Driven Data Flow

```mermaid
graph LR
    subgraph "Request Flow"
        Client[Client Request<br/>x-tenant-id: demo<br/>Idempotency-Key: abc123]
        Router[Tool Router<br/>POST /tools/crm/lookup_customer]
        Handler[CRM Handler<br/>lookupCustomer]
    end
    
    subgraph "Configuration Layers"
        subgraph "Tool Definition"
            ToolSchema[Tool Schema<br/>packages/tool-schemas/v1/tools.json<br/>• input_schema<br/>• output_schema<br/>• side_effects: read/write]
        end
        
        subgraph "Tenant Configuration"
            TenantConfig[Tenant Config<br/>config/tenants/demo.json<br/>• enabled tools<br/>• scopes<br/>• connectors<br/>• cache settings]
        end
        
        subgraph "Vendor Integration"
            VendorMap[Vendor Mapping<br/>config/connectors/vendors/salesforce.json<br/>• Customer.id → Account.Id<br/>• Case.subject → Case.Subject]
            OAuthConfig[OAuth Provider<br/>config/oauth/providers/salesforce.json<br/>• authorization_endpoint<br/>• token_endpoint<br/>• default_scopes]
        end
        
        subgraph "Data Model"
            CanonicalModel[Canonical Model<br/>packages/canonical-model/v1/schema.json<br/>• Customer schema<br/>• Case schema<br/>• Note schema]
        end
    end
    
    subgraph "Runtime Components"
        Validator[JSON Schema<br/>Validator<br/>Ajv 2020-12]
        IdempotencyStore[Idempotency Store<br/>Redis/Memory<br/>TTL: 7 days]
        CacheStore[Cache Store<br/>Redis/Memory<br/>SWR pattern]
        ConnectorStub[Connector<br/>Stubbed Implementation<br/>Returns mock data]
    end
    
    Client --> Router
    Router --> Handler
    
    ToolSchema -.->|"Defines endpoints"| Router
    TenantConfig -.->|"Controls access"| Router
    CanonicalModel -.->|"Validates payloads"| Validator
    
    Handler --> Validator
    Handler --> IdempotencyStore
    Handler --> CacheStore
    Handler --> ConnectorStub
    
    VendorMap -.->|"Future: field mapping"| ConnectorStub
    OAuthConfig -.->|"Future: authentication"| ConnectorStub
    
    IdempotencyStore -.->|"Dedup writes"| Handler
    CacheStore -.->|"Serve cached reads"| Handler
    
    classDef config fill:#E6F3FF,stroke:#0066CC,stroke-width:2px
    classDef runtime fill:#F0F8E6,stroke:#66AA00,stroke-width:2px
    classDef flow fill:#FFF2E6,stroke:#FF8800,stroke-width:2px
    classDef future fill:#FFE6F2,stroke:#CC0066,stroke-width:2px,stroke-dasharray: 5 5
    
    class ToolSchema,TenantConfig,VendorMap,OAuthConfig,CanonicalModel config
    class Validator,IdempotencyStore,CacheStore runtime
    class Client,Router,Handler flow
    class ConnectorStub future
```

**Requirements:** Node.js >= 20.10, optional Redis 6+

## Quick Start

```bash
git clone <this-repo> && cd ecco-backline && npm install
npm run dev  # starts on http://localhost:3030
```

**API Docs:** http://localhost:3030/docs  
**Health:** http://localhost:3030/health

### Development Templates

- **`env.example`** - Environment configuration template
- **`Dockerfile.example`** - Production build pattern  
- **`docker-compose.example.yml`** - Local setup with Redis
- **`CONTRIBUTING.md`** - Patterns for extending tools and connectors

## Configuration

**Main manifest:** `config/manifest/mcp.json` (hot-reloaded)  
**Tenants:** `config/tenants/*.json` (enabled tools, connectors, cache settings)  
**Vendor mappings:** `config/connectors/vendors/*.json` (canonical ↔ provider field mapping)  
**OAuth providers:** `config/oauth/providers/*.json` (endpoint metadata)

## API

**Routes:** `/tools/<tool.name>` (dots → slashes)  
**Multi-tenant:** `x-tenant-id` header (defaults to `demo`)  
**Idempotency:** `Idempotency-Key` header required for writes  
**Auth:** Declared in OpenAPI but not enforced (add gateway/plugin as needed)

### Example Usage

```bash
# Health check
curl -s http://localhost:3030/tools/meta/health | jq

# Customer lookup (read)
curl -s -H 'Content-Type: application/json' -H 'x-tenant-id: demo' \
  -X POST http://localhost:3030/tools/crm/lookup_customer \
  -d '{"query":"user@example.com"}' | jq

# Create case (write - requires Idempotency-Key)
curl -s -H 'Content-Type: application/json' -H 'x-tenant-id: demo' \
  -H 'Idempotency-Key: case-123' \
  -X POST http://localhost:3030/tools/crm/create_case \
  -d '{"customer_id":"cust_abc","subject":"Issue with order"}' | jq
```

## Architecture Details

**Caching:** SWR pattern with Redis (optional fallback to memory)  
**Idempotency:** 7-day deduplication for writes, scoped by tenant+tool  
**Observability:** Config hooks for tracing/metrics (not yet wired up)  
**Environment:** `PORT`, `LOG_LEVEL`, `REDIS_URL` (see `env.example`)

**Development:** `npm run dev` • `npm run build` • `npm run typecheck`

## Extending

See **`CONTRIBUTING.md`** for detailed patterns:
- Adding new tools (schema → handler → tenant config)
- Adding new connectors (mapping → OAuth → client)
- Configuration-driven architecture principles

## Why Reference Architecture?

**Schema-first:** JSON Schema validation for all inputs/outputs  
**Config-driven:** Tools, tenants, connectors declared in JSON  
**Extensible:** Add new integrations without modifying core runtime  
**Multi-tenant:** Isolation via config, rate limiting, circuit breakers  
**Enterprise-ready:** Idempotency, observability hooks, audit trail

## License

License to be determined.


