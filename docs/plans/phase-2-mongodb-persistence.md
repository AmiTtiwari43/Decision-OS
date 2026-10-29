# Phase 2 Implementation Plan — MongoDB Persistence

## 1. Context and Architectural Boundaries
Phase 2 establishes authoritative database persistence in `apps/api` using MongoDB and Mongoose.
The decision engine (`packages/decision-engine`) remains pure and untouched. The frontend (`apps/web`) remains untouched.
Decision HTTP endpoints are out of scope for Phase 2 and belong strictly to Phase 3.

## 2. Persistence Architecture & Decisions
- **ORM / Driver Choice**: Mongoose with TypeScript. Provides centralized schema validation, typed models, connection lifecycle hooks, and safe timestamp tracking (`createdAt`, `updatedAt`).
- **Data Model**: `Decision` collection only. No speculative models for users, sessions, experts, or evidence.
- **Criteria Directionality**: Each criterion supports `direction: 'benefit' | 'cost'`, defaulting to `'benefit'`, matching the canonical engine specification.
- **Scores Structure**: Option-keyed and criterion-keyed dictionary: `{ [optionId: string]: { [criterionId: string]: number } }`. Scores are constrained to `[0.0, 100.0]`. Drafts allow partial scores.
- **Analysis Snapshot**: Nullable subdocument storing the last authoritative evaluation (`EngineResult`).
- **Indexes**: Single-field index on `{ createdAt: -1 }` for chronological listing and pagination.
- **Bounded Queries**: Repository pagination enforces default limit of 20 and maximum limit of 100.

## 3. Test Database Protection
- `assertTestDatabase(uri: string)`: Rejects connection strings whose database name does not end with `_test`.
- Sanitized URI masking prevents credential leakage in error messages and logs.

## 4. Execution Units & Commit Plan
1. **Environment & Connection Lifecycle**:
   - Add `MONGODB_URI` to Zod environment validation in `apps/api/src/config/env.ts`.
   - Implement `assertTestDatabase` guard and credential masking in `apps/api/src/db/guard.ts`.
   - Implement `connectToDatabase`, `disconnectFromDatabase`, `checkDatabaseHealth` in `apps/api/src/db/connection.ts`.
   - Update server startup and graceful shutdown in `apps/api/src/server.ts`.
   - Add database readiness check route in `apps/api/src/routes/health.ts`.
2. **Data Model & Schema**:
   - Implement `Decision` schema and Mongoose model in `apps/api/src/models/decision.model.ts`.
   - Implement Zod schema validation for inputs and updates in `apps/api/src/models/decision.schema.ts`.
   - Add model validation unit tests covering required fields, bounds, and duplicate IDs.
3. **Repository Layer**:
   - Implement `DecisionRepository` in `apps/api/src/repositories/decision.repository.ts` with `create`, `findById`, `list`, `update`, `delete`.
   - Add bounded pagination and safe ObjectId handling.
4. **Integration Tests & Verification**:
   - Test connection success, connection failure with timeout, and disconnection.
   - Test test-DB guard refusal against non-test databases.
   - Test repository CRUD against local test database `decision_os_test`.
   - Test health and readiness endpoints.
5. **Verification Gate**:
   - Run full `npm run verify`.
   - Perform adversarial security and failure-mode review.
