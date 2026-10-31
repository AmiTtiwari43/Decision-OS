# Decision OS — Phase 13 Specification: Audit, History, and Export

## 1. Overview & Objective

Phase 13 establishes a comprehensive, immutable audit trail, historical snapshot system, and multi-format decision export capability for Decision OS.

The primary objective is to allow decision-makers, auditors, and stakeholders to:
1. Reconstruct how a decision evolved over time with reliable attribution.
2. Verify historical calculations and engine versions without silent recomputation.
3. Export complete, portable decision packages (JSON, CSV, HTML/Printable Briefing) safely and securely.

---

## 2. Core Architectural Invariants

1. **Canonical MCDA Immutability:**
   - Audit logging, snapshots, and exports are read-only or append-only observational subsystems.
   - They **NEVER** alter criterion weights, scores, rankings, sensitivity tipping points, or Monte Carlo win probabilities.
   - `CANONICAL_DECISION_ENGINE_V1_SPEC.md` and golden fixtures G1–G10 remain strictly read-only and intact.

2. **Append-Only Audit Storage:**
   - Audit records and historical snapshots cannot be modified, updated, or deleted through ordinary application routes.
   - The repository exposes only `create`, `findById`, and bounded `list` methods. No `update` or `delete` methods exist for audit events.
   - Even when a parent decision is deleted, historical audit records are preserved or archived according to the retention policy without deleting historical trails.

3. **Cryptographic SHA-256 Hash Chaining:**
   - To detect tampering or missing records within a decision's timeline, each audit event includes:
     - `eventHash`: SHA-256 digest of the canonical string representation of `{ eventId, decisionId, actorId, action, entityType, entityId, timestamp, diff, previousEventHash }`.
     - `previousEventHash`: Hash of the immediately preceding event for that decision, initialized to `0`.repeat(64) for the root event.
   - A dedicated verification service verifies the integrity of the chain and flags any modified or dropped records.
   - *Actual Guarantee:* Tamper-evidence within the application and database layer; does not claim legal non-repudiation against an infrastructure DBA with direct raw write access.

4. **Historical Engine Version & Hash Preservation:**
   - Snapshots and calculation events record the exact `engineVersion`, `specificationHash`, and `inputsHash` produced at the time of evaluation.
   - Historical records are never silently re-evaluated under newer engine versions.

5. **Export Security & Formula Injection Defense:**
   - All export endpoints require authentication and enforce decision-level access control.
   - Private drafts and unsubmitted contributions from other users are strictly excluded.
   - In CSV exports, spreadsheet formula injection (CSV Injection) is strictly mitigated: any text starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is escaped with a leading single quote (`'`).

---

## 3. Data Models

### A. Audit Event (`apps/api/src/models/audit.model.ts`)
```typescript
interface IAuditEvent {
  eventId: string; // UUIDv4
  decisionId: string; // ObjectId string
  actorId: string; // ObjectId string or 'system'
  actorEmail?: string;
  actorName?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  diff?: {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    changedFields?: string[];
  };
  timestamp: Date;
  eventHash: string; // SHA-256
  previousEventHash: string; // SHA-256
  schemaVersion: number; // 1
}
```

### B. Decision Snapshot (`apps/api/src/models/snapshot.model.ts`)
```typescript
interface IDecisionSnapshot {
  snapshotId: string; // UUIDv4
  decisionId: string; // ObjectId string
  version: number; // Snapshot sequence number
  title: string;
  description: string;
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  scores: ScoreMatrix;
  analysis: EngineResult | null;
  metadata: {
    evidenceCount: number;
    contributionCount: number;
    predictionCount: number;
    disagreementCount: number;
  };
  snapshotReason: 'calculation' | 'milestone' | 'manual' | 'round_lock';
  createdAt: Date;
  createdById: string;
}
```

---

## 4. Export Specifications

1. **JSON Export (`application/json`)**:
   - Complete schema-validated document containing decision metadata, criteria, options, scores, authoritative engine results (with version and input hashes), evidence citations, accepted expert contributions, calibration metrics, and audit summary.
2. **CSV Export (`text/csv`)**:
   - Multi-section RFC 4180 CSV with sanitized cells, formula injection escapes, criterion weights, option scores, final scores, rankings, and sensitivity thresholds.
3. **HTML / Printable Briefing (`text/html`)**:
   - Standalone, self-contained printable report with decision header, executive summary, authoritative MCDA rankings, sensitivity breakdown, participant consensus, and audit chain verification banner.

---

## 5. API Endpoints

- `GET /api/decisions/:id/audit` — Paginated audit history with action and entity filters.
- `GET /api/decisions/:id/audit/verify` — Validates SHA-256 hash chain integrity.
- `GET /api/decisions/:id/snapshots` — Lists historical snapshots for the decision.
- `POST /api/decisions/:id/snapshots` — Creates a historical milestone snapshot.
- `GET /api/decisions/:id/snapshots/:snapshotId` — Retrieves a specific snapshot.
- `GET /api/decisions/:id/export?format=json|csv|html` — Generates and downloads export package.

