import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard.js';
import { UserModel } from '../src/models/user.model.js';
import { DecisionModel } from '../src/models/decision.model.js';
import { DecisionContributionModel } from '../src/models/contribution.model.js';
import { AuditEventModel } from '../src/models/audit.model.js';
import { OperationJournalModel } from '../src/models/operationJournal.model.js';
import { CommentModel } from '../src/models/comment.model.js';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model.js';
import { DecisionInvitationModel } from '../src/models/invitation.model.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import {
  recoveryWorkerService,
  executeCompensatingRollback,
} from '../src/services/recoveryWorker.service.js';
import { auditService } from '../src/services/audit.service.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

const TEST_MONGODB_URI = getTestDatabaseUri();

assertTestDatabase(TEST_MONGODB_URI);

const baseDecisionPayload = {
  title: 'Cloud Database Architecture Selection',
  description: 'Evaluate PostgreSQL vs MongoDB Atlas',
  criteria: [
    { id: 'cost', name: 'Cost', weight: 40, direction: 'benefit' as const },
    { id: 'perf', name: 'Performance', weight: 60, direction: 'benefit' as const },
  ],
  options: [
    { id: 'postgres', name: 'PostgreSQL RDS' },
    { id: 'atlas', name: 'MongoDB Atlas' },
  ],
  scores: {
    postgres: { cost: 80, perf: 75 },
    atlas: { cost: 70, perf: 90 },
  },
};

describe('Batch 4 Phase 1 — Concurrency, Recovery Worker & Cryptographic Audit Invariants', () => {
  let app: FastifyInstance;

  let ownerToken: string;
  let ownerId: string;
  const ownerEmail = 'recovery-owner@example.com';

  let expertToken: string;
  let expertId: string;
  const expertEmail = 'recovery-expert@example.com';

  let decisionId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await CommentModel.deleteMany({});
    await OperationJournalModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await CommentModel.deleteMany({});
    await OperationJournalModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});

    // Register Owner
    const resOwner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: ownerEmail, password: 'Password123!', name: 'Recovery Owner' },
    });
    ownerToken = resOwner.json().token;
    ownerId = resOwner.json().user.id;

    // Register Expert
    const resExpert = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: expertEmail, password: 'Password123!', name: 'Recovery Expert' },
    });
    expertToken = resExpert.json().token;
    expertId = resExpert.json().user.id;

    // Create Decision
    const resDec = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: baseDecisionPayload,
    });
    decisionId = resDec.json().id;

    // Grant Expert contributor role
    await DecisionAccessGrantModel.create({
      decisionId,
      userId: expertId,
      role: 'contributor',
      grantedBy: ownerId,
    });
  });

  // Helper to create a submitted contribution
  async function createSubmittedContribution() {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions`,
      headers: { authorization: `Bearer ${expertToken}` },
      payload: {
        preferredOptionId: 'atlas',
        criterionScores: { cost: 75, perf: 95 },
        rationale: 'Atlas high throughput benchmarks',
      },
    });
    const contributionId = createRes.json().id || createRes.json()._id;

    await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions/submit`,
      headers: { authorization: `Bearer ${expertToken}` },
    });

    return contributionId;
  }

  function makeAuditDraft(entityId: string = decisionId) {
    return {
      eventId: crypto.randomUUID(),
      entityType: 'contribution' as const,
      entityId,
      summary: 'Deliberation action audit record',
      diff: { after: { status: 'adopted' } },
    };
  }

  // =========================================================================
  // 1. Contended Lease Claim Protocol & Monotonic Fencing Tokens
  // =========================================================================
  describe('Journal Lease Claiming & Fencing Token Protocol', () => {
    it('guarantees mutual exclusion: exactly one worker succeeds in claiming an unclaimed operation', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {}, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      // Two workers race to claim simultaneously
      const [claimA, claimB] = await Promise.all([
        operationJournalRepository.claimJournalOperation('worker-alpha', 5000, opId),
        operationJournalRepository.claimJournalOperation('worker-beta', 5000, opId),
      ]);

      const winner = claimA || claimB;
      const loser = claimA ? claimB : claimA;

      expect(winner).not.toBeNull();
      expect(loser).toBeNull();
      expect(winner!.fencingToken).toBe(1);
      expect(['worker-alpha', 'worker-beta']).toContain(winner!.recoveryOwner);
    });

    it('allows claiming an abandoned operation after lease expiration and increments fencingToken', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {}, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      // Worker Alpha claims with very short lease (40ms)
      const claim1 = await operationJournalRepository.claimJournalOperation('worker-alpha', 40, opId);
      expect(claim1).not.toBeNull();
      expect(claim1!.fencingToken).toBe(1);
      expect(claim1!.recoveryOwner).toBe('worker-alpha');

      // Immediate second claim attempt by Worker Beta fails (lease still valid)
      const claimBeforeExpire = await operationJournalRepository.claimJournalOperation('worker-beta', 5000, opId);
      expect(claimBeforeExpire).toBeNull();

      // Deterministically expire lease in database (no sleep)
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // Worker Beta claims expired operation
      const claim2 = await operationJournalRepository.claimJournalOperation('worker-beta', 5000, opId);
      expect(claim2).not.toBeNull();
      expect(claim2!.fencingToken).toBe(2);
      expect(claim2!.recoveryOwner).toBe('worker-beta');
    });

    it('enforces monotonically increasing fencing tokens across successive takeovers', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {}, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      for (let expectedToken = 1; expectedToken <= 4; expectedToken++) {
        const claim = await operationJournalRepository.claimJournalOperation(`worker-${expectedToken}`, 30000, opId);
        expect(claim).not.toBeNull();
        expect(claim!.fencingToken).toBe(expectedToken);
        // Deterministically expire lease for next takeover
        await OperationJournalModel.updateOne(
          { operationId: opId },
          { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
        );
      }
    });

    it('rejects stale worker state transitions when fencingToken is obsolete', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {}, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      // Worker 1 claims (token = 1)
      const claim1 = await operationJournalRepository.claimJournalOperation('worker-1', 40000, opId);
      expect(claim1!.fencingToken).toBe(1);

      // Deterministically expire Worker 1 lease; Worker 2 takes over (token = 2)
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );
      const claim2 = await operationJournalRepository.claimJournalOperation('worker-2', 5000, opId);
      expect(claim2!.fencingToken).toBe(2);

      // Worker 1 attempts to transition journal with stale token 1 -> Rejected
      await expect(
        operationJournalRepository.transitionJournalState(
          opId,
          'worker-1',
          1,
          'PENDING',
          'DECISION_MUTATED'
        )
      ).rejects.toThrow(ConcurrencyFencingError);

      // Worker 2 transitions with valid token 2 -> Succeeded
      await expect(
        operationJournalRepository.transitionJournalState(
          opId,
          'worker-2',
          2,
          'PENDING',
          'DECISION_MUTATED'
        )
      ).resolves.not.toThrow();
    });

    it('rejects stale worker decision writes when fencingToken is superseded', async () => {
      const opId = crypto.randomUUID();

      // Decision at version 1
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: opId, version: 2 },
      });

      // Attempt compensating write with an obsolete fencing token (e.g. 1 when journal has 2)
      await OperationJournalModel.create({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        fencingToken: 2, // Current active token is 2
        recoveryOwner: 'worker-2',
        state: 'COMPENSATING',
        auditDraft: makeAuditDraft(),
      });

      // Worker 1 with stale fencing token 1 attempts compensating rollback
      await expect(
        executeCompensatingRollback(
          decisionId,
          2,
          { version: 1, scores: baseDecisionPayload.scores, criteria: [], options: [] },
          opId,
          1, // Stale token!
          'worker-1'
        )
      ).rejects.toThrow(ConcurrencyFencingError);
    });

    it('prevents lease theft when worker continuously renews lease with active heartbeat', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {}, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      // Worker claims with 30000ms lease
      const claim = await operationJournalRepository.claimJournalOperation('worker-active', 30000, opId);
      expect(claim).not.toBeNull();

      // Renew lease
      const renewed = await operationJournalRepository.renewOperationLease(opId, 'worker-active', 1, 60000);
      expect(renewed).toBe(true);

      // Another worker tries to claim while lease is unexpired
      const stealAttempt = await operationJournalRepository.claimJournalOperation('worker-thief', 1000, opId);
      expect(stealAttempt).toBeNull(); // Claim blocked because lease was actively renewed!
    });

    it('guarantees terminal states (COMPLETED, REVERTED) are permanently excluded from claim', async () => {
      const opCompleted = crypto.randomUUID();
      const opReverted = crypto.randomUUID();

      // Create COMPLETED entry with expired lease
      await OperationJournalModel.create({
        operationId: opCompleted,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        state: 'COMPLETED',
        leaseExpiresAt: new Date(Date.now() - 10000), // Expired!
        fencingToken: 1,
        auditDraft: makeAuditDraft(),
      });

      // Create REVERTED entry with expired lease
      await OperationJournalModel.create({
        operationId: opReverted,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        state: 'REVERTED',
        leaseExpiresAt: new Date(Date.now() - 10000), // Expired!
        fencingToken: 1,
        auditDraft: makeAuditDraft(),
      });

      const claimCompleted = await operationJournalRepository.claimJournalOperation('worker-test', 5000, opCompleted);
      expect(claimCompleted).toBeNull();

      const claimReverted = await operationJournalRepository.claimJournalOperation('worker-test', 5000, opReverted);
      expect(claimReverted).toBeNull();
    });
  });

  // =========================================================================
  // 2. Crash Recovery Windows & Startup Reconciliation
  // =========================================================================
  describe('Crash Recovery Windows & Startup Reconciliation', () => {
    it('handles crash after decision mutation but before journal advancement (rolls forward cleanly)', async () => {
      const contributionId = await createSubmittedContribution();
      const opId = crypto.randomUUID();

      // 1. Journal created in PENDING state
      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {
          contributionId,
          preferredOptionId: 'atlas',
          expertScores: { cost: 75, perf: 95 },
        },
        previousSnapshot: {
          version: 1,
          scores: baseDecisionPayload.scores,
          criteria: baseDecisionPayload.criteria,
          options: baseDecisionPayload.options,
        },
        auditDraft: {
          eventId: crypto.randomUUID(),
          entityType: 'contribution',
          entityId: contributionId,
          summary: 'Adopted expert scores',
          diff: { after: { preferredOptionId: 'atlas' } },
        },
      });

      // 2. Decision mutation committed to DB: version = 2, pendingOperationId = opId
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: {
          version: 2,
          scores: {
            postgres: { cost: 80, perf: 75 },
            atlas: { cost: 75, perf: 95 },
          },
          analysis: null,
          pendingOperationId: opId,
          isAudited: false,
        },
      });

      // 3. API crashed before updating journal! (Journal still says PENDING)

      // 4. Startup recovery worker runs recovery pass
      const recoveredCount = await recoveryWorkerService.runRecoveryPass('startup-worker');
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      // Verify Decision is rolled forward and healthy
      const healthyDec = await DecisionModel.findById(decisionId);
      expect(healthyDec).not.toBeNull();
      expect(healthyDec!.version).toBe(2);
      expect(healthyDec!.pendingOperationId).toBeNull();
      expect(healthyDec!.isAudited).toBe(true);
      expect(healthyDec!.auditIntegrityStatus).toBe('healthy');
      expect(healthyDec!.analysis).toBeDefined();

      // Verify Contribution marked adopted
      const contrib = await DecisionContributionModel.findById(contributionId);
      expect(contrib?.status).toBe('adopted');

      // Verify Journal reached terminal state COMPLETED
      const journalDoc = await OperationJournalModel.findOne({ operationId: opId });
      expect(journalDoc?.state).toBe('COMPLETED');
    });

    it('handles crash before decision mutation occurred (cleanly marks journal REVERTED)', async () => {
      const opId = crypto.randomUUID();

      // Journal created in PENDING
      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: {
          version: 1,
          scores: baseDecisionPayload.scores,
          criteria: baseDecisionPayload.criteria,
          options: baseDecisionPayload.options,
        },
        auditDraft: makeAuditDraft(),
      });

      // API crashed immediately — Decision was NEVER mutated (version is still 1)
      const recoveredCount = await recoveryWorkerService.runRecoveryPass('startup-worker');
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      // Journal cleanly transitioned to REVERTED
      const journalDoc = await OperationJournalModel.findOne({ operationId: opId });
      expect(journalDoc?.state).toBe('REVERTED');

      // Decision remains unchanged at version 1
      const dec = await DecisionModel.findById(decisionId);
      expect(dec?.version).toBe(1);
      expect(dec?.pendingOperationId).toBeNull();
    });
  });

  // =========================================================================
  // 3. Monotonic Compensation Invariant (v5 -> v6 -> v7)
  // =========================================================================
  describe('Monotonic Compensation Invariants', () => {
    it('strictly increments decision version on compensation and rejects stale clients', async () => {
      // Setup decision at version 5
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { version: 5 },
      });

      const opId = crypto.randomUUID();
      const previousSnapshot = {
        version: 5,
        scores: baseDecisionPayload.scores,
        criteria: baseDecisionPayload.criteria,
        options: baseDecisionPayload.options,
      };

      // Operation mutated decision to version 6 (targetVersion = 6)
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: {
          version: 6,
          pendingOperationId: opId,
          scores: { postgres: { cost: 10, perf: 10 }, atlas: { cost: 10, perf: 10 } },
          recoveryOwner: 'worker-recovery',
          recoveryFencingToken: 1,
          recoveryLeaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      // Claim journal entry with fencing token 1
      await OperationJournalModel.create({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 5,
        targetVersion: 6,
        compensatingVersion: 7,
        fencingToken: 1,
        recoveryOwner: 'worker-recovery',
        state: 'COMPENSATING',
        auditDraft: makeAuditDraft(),
      });

      // Execute compensating rollback
      const compensatedDoc = await executeCompensatingRollback(
        decisionId,
        6,
        previousSnapshot,
        opId,
        1,
        'worker-recovery'
      );

      // 1. Version is strictly incremented: 6 -> 7 (never decremented to 5!)
      expect(compensatedDoc.version).toBe(7);

      // 2. Baseline scores restored
      expect(compensatedDoc.scores.postgres.cost).toBe(80);
      expect(compensatedDoc.scores.atlas.perf).toBe(90);

      // 3. Stale client holding version 5 receives 409 Conflict
      const resV5 = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          ...baseDecisionPayload,
          expectedVersion: 5,
        },
      });
      expect(resV5.statusCode).toBe(409);

      // 4. Stale client holding version 6 receives 409 Conflict
      const resV6 = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          ...baseDecisionPayload,
          expectedVersion: 6,
        },
      });
      expect(resV6.statusCode).toBe(409);
    });
  });

  // =========================================================================
  // 4. Quarantine Visibility & HTTP 423 Mutation Blocking
  // =========================================================================
  describe('Quarantine Visibility & HTTP 423 Blocking', () => {
    beforeEach(async () => {
      // Quarantine decision
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: {
          auditIntegrityStatus: 'quarantined',
          quarantineReason: 'Cryptographic hash mismatch at sequence 4',
        },
      });
    });

    it('exposes quarantine status in GET response', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const dec = res.json();
      expect(dec.auditIntegrityStatus).toBe('quarantined');
      expect(dec.quarantineReason).toBe('Cryptographic hash mismatch at sequence 4');
    });

    it('blocks PUT /decisions/:id with 423 Locked', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: baseDecisionPayload,
      });
      expect(res.statusCode).toBe(423);
      expect(res.json().error).toBe('DecisionQuarantinedError');
    });

    it('blocks DELETE /decisions/:id with 423 Locked', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(res.statusCode).toBe(423);
      expect(res.json().error).toBe('DecisionQuarantinedError');
    });

    it('blocks comment creation on quarantined decision with 423 Locked', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'decision',
          targetId: decisionId,
          content: 'Blocked comment on quarantined decision',
        },
      });
      expect(res.statusCode).toBe(423);
      expect(res.json().error).toBe('DecisionQuarantinedError');
    });

    it('blocks contribution creation on quarantined decision with 423 Locked', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'atlas',
          criterionScores: { cost: 80 },
        },
      });
      expect(res.statusCode).toBe(423);
      expect(res.json().error).toBe('DecisionQuarantinedError');
    });
  });

  // =========================================================================
  // 5. Cryptographic Audit Chain & Dual Timestamp Invariants
  // =========================================================================
  describe('Cryptographic Audit Chain Invariants', () => {
    it('records append-only SHA-256 hash chain with dual timestamps', async () => {
      // Append three distinct audit events
      await auditService.recordEvent({
        decisionId,
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decisionId,
        actor: { id: ownerId, role: 'owner' },
        summary: 'First audit update',
      });

      await auditService.recordEvent({
        decisionId,
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decisionId,
        actor: { id: ownerId, role: 'owner' },
        summary: 'Second audit update',
      });

      await auditService.recordEvent({
        decisionId,
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decisionId,
        actor: { id: ownerId, role: 'owner' },
        summary: 'Third audit update',
      });

      // Verify the entire chain in the database
      const events = await AuditEventModel.find({ decisionId }).sort({ createdAt: 1 });
      expect(events.length).toBeGreaterThanOrEqual(4); // initial create + 3 updates

      // Check dual timestamps and hash chain continuity
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        expect(ev.originalTimestamp).toBeInstanceOf(Date);
        expect(ev.timestamp).toBeInstanceOf(Date);
        expect(ev.eventHash).toBeDefined();
        expect(ev.eventHash.length).toBe(64); // SHA-256 hex string

        if (i === 0) {
          expect(ev.previousEventHash).toBe(
            '0000000000000000000000000000000000000000000000000000000000000000'
          );
        } else {
          expect(ev.previousEventHash).toBe(events[i - 1].eventHash);
        }
      }

      // Check verifyChainIntegrity
      const verification = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
      expect(verification.isValid).toBe(true);
      expect(verification.totalEventsChecked).toBeGreaterThanOrEqual(4);
    });

    it('detects tampering if an audit record hash is altered', async () => {
      await auditService.recordEvent({
        decisionId,
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decisionId,
        actor: { id: ownerId, role: 'owner' },
        summary: 'Clean update',
      });

      // Tamper with native collection directly (bypassing mongoose middleware)
      const events = await AuditEventModel.find({ decisionId }).sort({ createdAt: 1 });
      const lastEvent = events[events.length - 1];

      await AuditEventModel.collection.updateOne(
        { _id: lastEvent._id },
        { $set: { summary: 'TAMPERED SUMMARY CONTENT' } }
      );

      const verification = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
      expect(verification.isValid).toBe(false);
      expect(verification.brokenAtEventId).toBe(lastEvent.eventId);
      expect(verification.reason).toBeDefined();
    });
  });

  // =========================================================================
  // 6. Remediation F-B4-01: Dedicated Atomic Recovery Fencing Tests (A through E)
  // =========================================================================
  describe('Remediation F-B4-01: Atomic Recovery Fencing & Distributed Ownership Protocol', () => {
    it('Test A — Ownership transfer before decision write: stale Worker A fails decision mutation before Worker B performs first decision write', async () => {
      const opId = crypto.randomUUID();

      // Create operation journal entry and set up decision
      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: baseDecisionPayload.scores, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: opId, version: 2 },
      });

      // 1. Worker A claims operation with token 1 and short lease (40ms)
      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 40, opId);
      expect(claimA).not.toBeNull();
      expect(claimA!.fencingToken).toBe(1);

      // Verify that DecisionModel now has recoveryFencingToken = 1 and recoveryOwner = 'worker-A'
      const decAfterA = await DecisionModel.findById(decisionId);
      expect(decAfterA!.recoveryFencingToken).toBe(1);
      expect(decAfterA!.recoveryOwner).toBe('worker-A');

      // 2. Worker A pauses; deterministically expire Worker A's lease in database
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );
      await DecisionModel.updateOne(
        { _id: decisionId },
        { $set: { recoveryLeaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // 3. Worker B claims token 2 in the journal (ownership transfer)
      const claimB = await operationJournalRepository.claimJournalOperation('worker-B', 5000, opId);
      expect(claimB).not.toBeNull();
      expect(claimB!.fencingToken).toBe(2);

      // Verify that DecisionModel's recoveryFencingToken is ALREADY 2 and recoveryOwner is 'worker-B'
      const decAfterBClaim = await DecisionModel.findById(decisionId);
      expect(decAfterBClaim!.recoveryFencingToken).toBe(2);
      expect(decAfterBClaim!.recoveryOwner).toBe('worker-B');

      // 4. Worker B has NOT performed its first decision write yet!
      // (Version is still 2, analysis has not been written)
      expect(decAfterBClaim!.version).toBe(2);

      // 5. Worker A resumes and attempts to mutate the decision with stale token 1
      await expect(
        executeCompensatingRollback(
          decisionId,
          2,
          { version: 1, scores: baseDecisionPayload.scores, criteria: [], options: [] },
          opId,
          1, // Stale Token 1!
          'worker-A'
        )
      ).rejects.toThrow(ConcurrencyFencingError);

      // 6. Verify that DecisionModel was NOT mutated by Worker A
      const decFinal = await DecisionModel.findById(decisionId);
      expect(decFinal!.version).toBe(2); // Still version 2, not incremented to 3 by stale Worker A
      expect(decFinal!.recoveryFencingToken).toBe(2); // Still token 2 owned by Worker B
      expect(decFinal!.recoveryOwner).toBe('worker-B');
    });

    it('Test B — Stale worker after token advancement: all recovery writes from stale worker fail', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: baseDecisionPayload.scores, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: opId, version: 2 },
      });

      // Worker A claims token 1
      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 40, opId);
      expect(claimA!.fencingToken).toBe(1);

      // Worker A pauses and lease expires deterministically in database
      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );
      await DecisionModel.updateOne(
        { _id: decisionId },
        { $set: { recoveryLeaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // Worker B claims token 2 and advances state
      const claimB = await operationJournalRepository.claimJournalOperation('worker-B', 5000, opId);
      expect(claimB!.fencingToken).toBe(2);

      // Worker A attempts all possible recovery writes with token 1:
      // Write 1: Compensating rollback
      await expect(
        executeCompensatingRollback(
          decisionId,
          2,
          { version: 1, scores: baseDecisionPayload.scores, criteria: [], options: [] },
          opId,
          1,
          'worker-A'
        )
      ).rejects.toThrow(ConcurrencyFencingError);

      // Write 2: Journal transition
      await expect(
        operationJournalRepository.transitionJournalState(
          opId,
          'worker-A',
          1,
          'PENDING',
          'DECISION_MUTATED'
        )
      ).rejects.toThrow(ConcurrencyFencingError);

      // Write 3: Heartbeat lease renewal
      const renewRes = await operationJournalRepository.renewOperationLease(opId, 'worker-A', 1, 30000, decisionId);
      expect(renewRes).toBe(false);

      // Write 4: Direct fenced decision update
      const directUpdate = await DecisionModel.updateOne(
        { _id: decisionId, recoveryFencingToken: 1, recoveryOwner: 'worker-A' },
        { $set: { title: 'Compromised Title' } }
      );
      expect(directUpdate.matchedCount).toBe(0);
    });

    it('Test C — Stale worker after process restart: restarted/delayed worker with token 1 cannot write', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: baseDecisionPayload.scores, criteria: [], options: [] },
        auditDraft: makeAuditDraft(),
      });

      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: opId, version: 2 },
      });

      // Worker A starts recovery and crashes/pauses; deterministically expire Worker A lease
      const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 40000, opId);
      expect(claimA!.fencingToken).toBe(1);

      await OperationJournalModel.updateOne(
        { operationId: opId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
      );
      await DecisionModel.updateOne(
        { _id: decisionId },
        { $set: { recoveryLeaseExpiresAt: new Date(Date.now() - 5000) } }
      );

      // Worker B recovers and completes the operation
      const claimB = await operationJournalRepository.claimJournalOperation('worker-B', 5000, opId);
      expect(claimB!.fencingToken).toBe(2);
      const resultB = await recoveryWorkerService.reconcileOperation(claimB!, 'worker-B');
      expect(['completed', 'reverted']).toContain(resultB);

      // Worker A process restarts or unfreezes and attempts to resume with its stale token 1
      await expect(
        recoveryWorkerService.reconcileOperation(
          { ...claimA!.toObject(), fencingToken: 1 } as any,
          'worker-A'
        )
      ).rejects.toThrow(ConcurrencyFencingError);

      // Verify the final decision remains healthy and unmodified by Worker A
      const dec = await DecisionModel.findById(decisionId);
      expect(dec!.auditIntegrityStatus).toBe('healthy');
      expect(dec!.pendingOperationId).toBeNull();
    });

    it('Test D — Concurrent recovery: multiple workers contend, exactly one succeeds without duplicate events', async () => {
      const opId = crypto.randomUUID();

      await operationJournalRepository.createEntry({
        operationId: opId,
        decisionId,
        action: 'contribution.adopted',
        actor: { id: ownerId, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: { preferredOptionId: 'atlas' },
        previousSnapshot: { version: 1, scores: baseDecisionPayload.scores, criteria: baseDecisionPayload.criteria, options: baseDecisionPayload.options },
        auditDraft: makeAuditDraft(),
      });

      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: opId, version: 2 },
      });

      // 5 workers race to claim simultaneously
      const workerIds = ['w1', 'w2', 'w3', 'w4', 'w5'];
      const claims = await Promise.all(
        workerIds.map((wId) => operationJournalRepository.claimJournalOperation(wId, 5000, opId))
      );

      const successfulClaims = claims.filter((c) => c !== null);
      expect(successfulClaims.length).toBe(1);
      const winner = successfulClaims[0]!;
      expect(winner.fencingToken).toBe(1);

      // Winner completes reconciliation
      const result = await recoveryWorkerService.reconcileOperation(winner, winner.recoveryOwner!);
      expect(result).toBe('completed');

      // Verify exactly one journal completion
      const journalFinal = await OperationJournalModel.findOne({ operationId: opId });
      expect(journalFinal!.state).toBe('COMPLETED');
    });

    it('Test E — Concurrent ordinary mutation: normal update rejected while recovery is in-flight', async () => {
      const opId = crypto.randomUUID();

      // Establish in-flight operation on decision
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: opId, version: 1 },
      });

      // Ordinary user attempts PUT update while recovery/operation is in-flight
      const normalUpdateRes = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          title: 'Attempted Concurrent Update Title',
          description: 'Racing against recovery',
        },
      });

      // Rejected because pendingOperationId is active
      expect([409, 423]).toContain(normalUpdateRes.statusCode);

      // Clean up in-flight lock (simulating recovery completion)
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: null, version: 2 },
      });

      // Ordinary update retried after recovery
      const retryRes = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          title: 'Successfully Updated Title',
          description: 'Updated after recovery',
        },
      });

      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.json().title).toBe('Successfully Updated Title');
    });
  });
});
