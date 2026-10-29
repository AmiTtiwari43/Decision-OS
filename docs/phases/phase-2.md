# Phase 2 — MongoDB Persistence

## Precondition
Phase 1 foundation is complete and audited (commit `a3bafad`), with `npm run verify` passing across all workspaces (`apps/web`, `apps/api`, `packages/decision-engine`).

## Objective
Persist Decision documents in MongoDB using Mongoose and TypeScript with strict schema validation, robust connection lifecycle management, test database protection, and repository layer without exposing HTTP decision endpoints.

## Decisions Made
- **Mongoose vs Native Driver**: Mongoose selected for structured schema validation, strong TypeScript typing, lifecycle hooks (automatic timestamps, subdocument validation), and connection pool lifecycle management.
- **Connection Configuration**: Validated via Zod (`MONGODB_URI`), with explicit connection timeouts and fail-fast behavior.
- **Test Database Safeguard**: Mandatory guard (`assertTestDatabase`) refuses execution unless the database name strictly ends with `_test`.
- **Health & Readiness**: `/health` remains process liveness (`status: "ok"`). `/health/ready` provides verified database connectivity status (`status: "ok", database: "connected"` or 503 if disconnected).

## Data Model: Decision
```typescript
{
  _id: ObjectId;
  title: string;
  description?: string;
  criteria: Array<{
    id: string;
    name: string;
    shortName?: string;
    weight: number;
    direction: 'benefit' | 'cost';
    isLocked?: boolean;
  }>;
  options: Array<{
    id: string;
    name: string;
    tagline?: string;
    description?: string;
    color?: string;
  }>;
  scores: Record<string, Record<string, number>>; // optionId -> criterionId -> score (0..100)
  analysis: EngineResult | null;
  calculationVersion: number;
  createdAt: Date;
  updatedAt: Date;
}
```

## Indexes
- `{ createdAt: -1 }`: Supports chronological sorting and bounded pagination for decision listings.

## Scope Boundaries (Out of Scope for Phase 2)
- HTTP CRUD endpoints for decisions (`/api/decisions`)
- Authoritative server-side MCDA execution routes
- Authentication and authorization
- User, expert, evidence, audit, and invitation collections
- Realtime subscriptions, WebSockets, or Redis
- Speculative future models

## Acceptance Criteria
1. Real Decision document is created and read back from MongoDB.
2. All repository tests pass against a real MongoDB test instance.
3. Test DB guard strictly refuses non-test database URIs.
4. Startup fails fast with clear errors when MongoDB is unreachable or URI is invalid.
5. No credentials or secrets committed or leaked in logs/errors.
6. `npm run verify` passes with exit code 0 across all workspaces.
