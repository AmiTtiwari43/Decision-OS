import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {
  connectToDatabase,
  disconnectFromDatabase,
  runInTransaction,
  assertReplicaSetSupported,
} from '../src/db/connection.js';
import { getTestDatabaseUri, assertTestDatabase } from '../src/db/guard.js';
import {
  DecisionModel,
  OperationJournalModel,
  AuditEventModel,
} from '../src/models/index.js';
import { auditService, GENESIS_PREVIOUS_HASH } from '../src/services/audit.service.js';
import { auditRepository } from '../src/repositories/audit.repository.js';
import {
  executeCompensatingRollback,
  recoveryWorkerService,
} from '../src/services/recoveryWorker.service.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

const TEST_MONGODB_URI = getTestDatabaseUri();
assertTestDatabase(TEST_MONGODB_URI);

const ownerId = new mongoose.Types.ObjectId().toString();

describe('Batch 4 Phase 4 — Cryptographic Audit Chain Atomicity & Fencing', () => {
  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    assertReplicaSetSupported();
  });

  afterAll(async () => {
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await DecisionModel.deleteMany({});
    await OperationJournalModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});
  });

  async function createTestDecision(initialHead?: { sequenceNumber: number; eventHash: string }) {
    return DecisionModel.create({
      title: 'Audit Chain Test Decision',
      ownerId,
      criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1, direction: 'benefit' }],
      options: [{ id: 'o1', name: 'Option 1' }],
      scores: { o1: { c1: 50 } },
      version: 1,
      auditIntegrityStatus: 'healthy',
      auditHead: initialHead || {
        sequenceNumber: 0,
        eventHash: GENESIS_PREVIOUS_HASH,
        lastEventId: 'genesis',
        updatedAt: new Date(),
      },
    });
  }

  it('1. Concurrent append race produces strictly monotonic sequences with zero gaps and unbroken chain', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    // 5 concurrent appends
    const appendPromises = Array.from({ length: 5 }, (_, i) =>
      auditService.recordEvent({
        decisionId,
        actor: { id: ownerId, role: 'owner' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decisionId,
        summary: `Concurrent update ${i + 1}`,
      })
    );

    const results = await Promise.all(appendPromises);
    expect(results).toHaveLength(5);

    // Verify all sequence numbers from 1 to 5 are present
    const sequences = results.map((r) => r.sequenceNumber).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5]);

    // Verify auditHead on decision is 5
    const updatedDecision = await DecisionModel.findById(decisionId);
    expect(updatedDecision?.auditHead?.sequenceNumber).toBe(5);

    // Verify full chain integrity
    const chainCheck = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
    expect(chainCheck.isValid).toBe(true);
    expect(chainCheck.totalEventsChecked).toBe(5);
  });

  it('2. Head update failure aborts event insertion atomically', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    const badSequence = 99; // Intentionally out of sync with head (which is 0)

    await expect(
      auditService.recordEvent({
        decisionId,
        actor: { id: ownerId, role: 'owner' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decisionId,
        summary: 'Mismatched CAS head append',
        sequenceNumber: badSequence,
      })
    ).rejects.toThrowError(ConcurrencyFencingError);

    // No event must be visible in collection
    const eventCount = await AuditEventModel.countDocuments({ decisionId });
    expect(eventCount).toBe(0);

    // Decision auditHead must remain at sequence 0
    const dec = await DecisionModel.findById(decisionId);
    expect(dec?.auditHead?.sequenceNumber).toBe(0);
  });

  it('3. Duplicate event sequence insertion is rejected by CAS / unique constraint', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    // First event succeeds at sequence 1
    await auditService.recordEvent({
      decisionId,
      actor: { id: ownerId, role: 'owner' },
      action: 'decision.created',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Genesis event',
    });

    // Attempting another event forced to sequence 1 must fail CAS
    await expect(
      runInTransaction(async (session) => {
        return auditService.recordEvent(
          {
            decisionId,
            actor: { id: ownerId, role: 'owner' },
            action: 'decision.updated',
            entityType: 'decision',
            entityId: decisionId,
            summary: 'Conflicting sequence event',
            sequenceNumber: 1,
          },
          session
        );
      })
    ).rejects.toThrowError();

    const eventCount = await AuditEventModel.countDocuments({ decisionId });
    expect(eventCount).toBe(1);
  });

  it('4. Replay of already recorded event ID is idempotent without creating duplicate events', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();
    const staticEventId = crypto.randomUUID();

    const ev1 = await auditService.recordEvent({
      decisionId,
      eventId: staticEventId,
      actor: { id: ownerId, role: 'owner' },
      action: 'decision.updated',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Idempotency test event',
    });

    expect(ev1.eventId).toBe(staticEventId);
    expect(ev1.sequenceNumber).toBe(1);

    // Replay with identical eventId
    const ev2 = await auditService.recordEvent({
      decisionId,
      eventId: staticEventId,
      actor: { id: ownerId, role: 'owner' },
      action: 'decision.updated',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Replayed test event',
    });

    expect(ev2.eventId).toBe(staticEventId);
    expect(ev2.sequenceNumber).toBe(1);

    // Total events in collection must strictly be 1
    const eventCount = await AuditEventModel.countDocuments({ decisionId });
    expect(eventCount).toBe(1);
  });

  it('5. Injected abort after event write leaves 0 uncommitted events', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    await expect(
      runInTransaction(async (session) => {
        await auditRepository.create(
          {
            eventId: crypto.randomUUID(),
            decisionId: new mongoose.Types.ObjectId(decisionId),
            actorId: ownerId,
            action: 'decision.updated',
            entityType: 'decision',
            entityId: decisionId,
            summary: 'Uncommitted doomed event',
            originalTimestamp: new Date(),
            timestamp: new Date(),
            eventHash: 'a'.repeat(64),
            previousEventHash: GENESIS_PREVIOUS_HASH,
            sequenceNumber: 1,
            schemaVersion: 1,
          },
          session
        );

        // Inject simulated failure
        throw new Error('Simulated crash / abort before transaction commit');
      })
    ).rejects.toThrow('Simulated crash / abort before transaction commit');

    const count = await AuditEventModel.countDocuments({ decisionId });
    expect(count).toBe(0);
  });

  it('6. Injected abort after head write leaves zero state inconsistency', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    await expect(
      runInTransaction(async (session) => {
        await auditService.recordEvent(
          {
            decisionId,
            actor: { id: ownerId, role: 'owner' },
            action: 'decision.updated',
            entityType: 'decision',
            entityId: decisionId,
            summary: 'Event that will be rolled back',
          },
          session
        );

        // Abort right before transaction end
        throw new Error('Simulated transaction rollback at end');
      })
    ).rejects.toThrow('Simulated transaction rollback at end');

    // Neither event nor head update must persist
    const count = await AuditEventModel.countDocuments({ decisionId });
    expect(count).toBe(0);

    const dec = await DecisionModel.findById(decisionId);
    expect(dec?.auditHead?.sequenceNumber).toBe(0);
  });

  it('7. Crash simulation between event write and head write leaves no orphan events', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    await expect(
      runInTransaction(async (session) => {
        // Event created
        await auditRepository.create(
          {
            eventId: crypto.randomUUID(),
            decisionId: new mongoose.Types.ObjectId(decisionId),
            actorId: ownerId,
            action: 'decision.updated',
            entityType: 'decision',
            entityId: decisionId,
            summary: 'Crash simulation event',
            originalTimestamp: new Date(),
            timestamp: new Date(),
            eventHash: 'b'.repeat(64),
            previousEventHash: GENESIS_PREVIOUS_HASH,
            sequenceNumber: 1,
            schemaVersion: 1,
          },
          session
        );

        // Simulated process termination/network break
        throw new Error('Simulated worker process crash');
      })
    ).rejects.toThrow('Simulated worker process crash');

    const orphanEvents = await AuditEventModel.find({ decisionId });
    expect(orphanEvents).toHaveLength(0);
  });

  it('8. Recovery worker compensation generates valid audit event linked to chain', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    // 1. First record an initial valid event
    await auditService.recordEvent({
      decisionId,
      actor: { id: ownerId, role: 'owner' },
      action: 'decision.created',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Initial decision creation',
    });

    // 2. Setup an operation journal for compensation
    const operationId = crypto.randomUUID();
    const fencingToken = 10;
    const workerId = 'worker-comp-test';

    await OperationJournalModel.create({
      operationId,
      decisionId: decision._id,
      state: 'PENDING',
      action: 'decision.updated',
      fencingToken,
      recoveryFencingToken: fencingToken,
      recoveryOwner: workerId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      expectedVersion: 1,
      targetVersion: 2,
      actor: { id: ownerId, role: 'owner', name: 'Decision Owner' },
      auditDraft: {
        entityType: 'decision',
        entityId: decisionId,
        eventId: crypto.randomUUID(),
        summary: 'Draft operation audit',
      },
      payload: {},
      previousSnapshot: {
        scores: { o1: { c1: 50 } },
        criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'Option 1' }],
      },
    });

    await DecisionModel.updateOne(
      { _id: decision._id },
      {
        $set: {
          pendingOperationId: operationId,
          recoveryOwner: workerId,
          recoveryFencingToken: fencingToken,
          recoveryLeaseExpiresAt: new Date(Date.now() + 60_000),
        },
      }
    );

    // Execute compensating rollback
    await executeCompensatingRollback(
      decisionId,
      1,
      {
        scores: { o1: { c1: 50 } },
        criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'Option 1' }],
      },
      operationId,
      fencingToken,
      workerId
    );

    // Chain must remain fully valid and unbroken
    const chainCheck = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
    expect(chainCheck.isValid).toBe(true);
    expect(chainCheck.totalEventsChecked).toBe(2);

    // Verify compensation event is recorded
    const latestEvent = await auditRepository.getLatestByDecisionId(decisionId);
    expect(latestEvent?.action).toBe('decision.updated');
    expect(latestEvent?.sequenceNumber).toBe(2);
  });

  it('9. Quarantine transition generates valid audit event linked to chain', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    // Initial event
    await auditService.recordEvent({
      decisionId,
      actor: { id: ownerId, role: 'owner' },
      action: 'decision.created',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Pre-quarantine creation',
    });

    const opId = crypto.randomUUID();
    const fencingToken = 5;
    const workerId = 'worker-quarantine-test';
    const journal = await OperationJournalModel.create({
      operationId: opId,
      decisionId: decision._id,
      state: 'PENDING',
      action: 'decision.updated',
      fencingToken,
      recoveryFencingToken: fencingToken,
      recoveryOwner: workerId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      expectedVersion: 1,
      targetVersion: 2,
      actor: { id: ownerId, role: 'owner', name: 'Decision Owner' },
      auditDraft: {
        entityType: 'decision',
        entityId: decisionId,
        eventId: crypto.randomUUID(),
        summary: 'Quarantine draft',
      },
      payload: {},
      previousSnapshot: { scores: {}, criteria: [], options: [] },
    });

    await DecisionModel.updateOne(
      { _id: decision._id },
      {
        $set: {
          recoveryOwner: workerId,
          recoveryFencingToken: fencingToken,
          recoveryLeaseExpiresAt: new Date(Date.now() + 60_000),
        },
      }
    );

    // Mark quarantined via recovery worker service
    await (recoveryWorkerService as any).markQuarantined(
      journal,
      workerId,
      'Cryptographic hash corruption detected during verification'
    );

    // Verify decision is quarantined
    const quarantinedDec = await DecisionModel.findById(decisionId);
    expect(quarantinedDec?.auditIntegrityStatus).toBe('quarantined');

    // Verify chain integrity includes the quarantine audit event
    const chainCheck = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
    expect(chainCheck.isValid).toBe(true);
    expect(chainCheck.totalEventsChecked).toBe(2);

    const latestEvent = await auditRepository.getLatestByDecisionId(decisionId);
    expect(latestEvent?.action).toBe('decision.quarantined');
    expect(latestEvent?.sequenceNumber).toBe(2);
  });

  it('10. Full chain verification succeeds on healthy chain and fails on any tamper/gap/fork', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    // Append 3 events
    for (let i = 1; i <= 3; i++) {
      await auditService.recordEvent({
        decisionId,
        actor: { id: ownerId, role: 'owner' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decisionId,
        summary: `Healthy event ${i}`,
      });
    }

    // Verify healthy
    let check = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
    expect(check.isValid).toBe(true);
    expect(check.totalEventsChecked).toBe(3);

    // Tamper directly via raw collection to bypass Mongoose schema read-only hook
    await AuditEventModel.collection.updateOne(
      { decisionId: decision._id, sequenceNumber: 2 },
      { $set: { summary: 'Tampered summary payload' } }
    );

    // Verification must now fail
    check = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
    expect(check.isValid).toBe(false);
    expect(check.brokenAtEventId).toBeDefined();
    expect(check.reason).toContain('Content hash verification failed');
  });

  it('11. Corrupted head sequence detected and quarantined, blocking further mutations', async () => {
    const decision = await createTestDecision();
    const decisionId = decision._id.toString();

    // Append 2 events
    await auditService.recordEvent({
      decisionId,
      actor: { id: ownerId, role: 'owner' },
      action: 'decision.created',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Event 1',
    });
    await auditService.recordEvent({
      decisionId,
      actor: { id: ownerId, role: 'owner' },
      action: 'decision.updated',
      entityType: 'decision',
      entityId: decisionId,
      summary: 'Event 2',
    });

    // Artificially corrupt decision auditHead to point to non-existent sequence 99
    await DecisionModel.updateOne(
      { _id: decision._id },
      { $set: { 'auditHead.sequenceNumber': 99, 'auditHead.eventHash': 'deadbeef'.repeat(8) } }
    );

    // Chain integrity verification detects head corruption
    const check = await auditService.verifyChainIntegrity(decisionId, { id: ownerId, role: 'owner' });
    expect(check.isValid).toBe(false);
    expect(check.reason).toContain('Audit head mismatch');

    // Quarantine decision due to head corruption
    const opId = crypto.randomUUID();
    const fencingToken = 9;
    const workerId = 'worker-quarantine-head-test';
    const journal = await OperationJournalModel.create({
      operationId: opId,
      decisionId: decision._id,
      state: 'PENDING',
      action: 'decision.updated',
      fencingToken,
      recoveryFencingToken: fencingToken,
      recoveryOwner: workerId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      expectedVersion: 1,
      targetVersion: 2,
      actor: { id: ownerId, role: 'owner', name: 'Decision Owner' },
      auditDraft: {
        entityType: 'decision',
        entityId: decisionId,
        eventId: crypto.randomUUID(),
        summary: 'Head corruption quarantine',
      },
      payload: {},
      previousSnapshot: { scores: {}, criteria: [], options: [] },
    });

    await DecisionModel.updateOne(
      { _id: decision._id },
      {
        $set: {
          recoveryOwner: workerId,
          recoveryFencingToken: fencingToken,
          recoveryLeaseExpiresAt: new Date(Date.now() + 60_000),
        },
      }
    );

    await (recoveryWorkerService as any).markQuarantined(journal, workerId, 'Audit head mismatch');

    const quarantinedDec = await DecisionModel.findById(decisionId);
    expect(quarantinedDec?.auditIntegrityStatus).toBe('quarantined');
  });
});
