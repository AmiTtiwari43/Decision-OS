import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
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
  DecisionContributionModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import {
  recoveryWorkerService,
  executeCompensatingRollback,
} from '../src/services/recoveryWorker.service.js';
import { ConcurrencyFencingError } from '../src/errors/domain.errors.js';

const TEST_MONGODB_URI = getTestDatabaseUri();
assertTestDatabase(TEST_MONGODB_URI);

function makeJournalPayload(overrides: Record<string, unknown> = {}) {
  const decId = (overrides.decisionId as mongoose.Types.ObjectId) || new mongoose.Types.ObjectId();
  const entId = (overrides.entityId as string) || decId.toString();

  return {
    operationId: `op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    decisionId: decId,
    action: 'decision.updated',
    expectedVersion: 1,
    targetVersion: 2,
    fencingToken: 0,
    state: 'PENDING',
    recoveryOwner: null,
    leaseExpiresAt: null,
    actor: { id: 'user-owner-1', role: 'owner', name: 'Decision Owner' },
    auditDraft: {
      entityType: 'decision',
      entityId: entId,
      eventId: `ev-draft-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      summary: 'Adversarial fencing test operation',
      diff: {},
    },
    payload: {},
    previousSnapshot: {
      scores: {},
      criteria: [],
      options: [],
    },
    ...overrides,
  };
}

describe('Batch 4 Phase 2 — Adversarial Recovery Fencing & Lease Safety', () => {
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
    await DecisionContributionModel.deleteMany({});
  });

  it('Scenario A — Original takeover race: stale Worker A writes are all rejected after Worker B takeover', async () => {
    const opId = `op-takeover-${Date.now()}`;

    const decision = await DecisionModel.create({
      title: 'Takeover Race Decision',
      criteria: [
        { id: 'c1', name: 'C1', weight: 1, direction: 'benefit' },
        { id: 'c2', name: 'C2', weight: 1, direction: 'benefit' },
      ],
      options: [{ id: 'o1', name: 'O1' }, { id: 'o2', name: 'O2' }],
      scores: { o1: { c1: 50, c2: 50 }, o2: { c1: 60, c2: 60 } },
      version: 1,
      pendingOperationId: opId,
      auditIntegrityStatus: 'healthy',
      recoveryFencingToken: 0,
    });

    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 90, c2: 90 },
      submittedAt: new Date(),
    });

    await OperationJournalModel.create(
      makeJournalPayload({
        operationId: opId,
        decisionId: decision._id,
        action: 'contribution.adopted',
        auditDraft: {
          entityType: 'contribution',
          entityId: contrib._id.toString(),
          eventId: `ev-draft-${Date.now()}`,
          summary: 'Adopted o1',
          diff: {},
        },
        payload: {
          contributionId: contrib._id.toString(),
          preferredOptionId: 'o1',
          revision: 1,
        },
        previousSnapshot: {
          scores: decision.scores,
          criteria: decision.criteria,
          options: decision.options,
        },
      })
    );

    // 1. Worker A claims operation generation 1 with short 50ms lease
    const claimA = await operationJournalRepository.claimJournalOperation('worker-A', 50, opId);
    expect(claimA).not.toBeNull();
    expect(claimA?.fencingToken).toBe(1);
    expect(claimA?.recoveryOwner).toBe('worker-A');

    // Verify Decision lease bound to Worker A
    const decAfterA = await DecisionModel.findById(decision._id);
    expect(decAfterA?.recoveryFencingToken).toBe(1);
    expect(decAfterA?.recoveryOwner).toBe('worker-A');

    // 2. Worker A pauses immediately before protected write
    // 3. A's lease expires deterministically in database (zero timing-based sleeps)
    await OperationJournalModel.updateOne(
      { operationId: opId },
      { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
    );
    await DecisionModel.updateOne(
      { _id: decision._id },
      { $set: { recoveryLeaseExpiresAt: new Date(Date.now() - 5000) } }
    );

    // 4 & 5. Worker B claims generation 2 through the real repository method
    const claimB = await operationJournalRepository.claimJournalOperation('worker-B', 30000, opId);
    expect(claimB).not.toBeNull();
    expect(claimB?.fencingToken).toBe(2);
    expect(claimB?.recoveryOwner).toBe('worker-B');

    // Verify Decision lease authoritatively bound to Worker B
    const decAfterB = await DecisionModel.findById(decision._id);
    expect(decAfterB?.recoveryFencingToken).toBe(2);
    expect(decAfterB?.recoveryOwner).toBe('worker-B');

    // 6 & 7. Worker A resumes and attempts EVERY protected write with stale token 1:
    // Protected Write 1: Decision Mutation / Analysis update
    const staleNow = new Date();
    const staleDecisionWrite = await DecisionModel.updateOne(
      {
        _id: decision._id,
        version: 2,
        pendingOperationId: opId,
        auditIntegrityStatus: { $ne: 'quarantined' },
        recoveryFencingToken: 1,
        recoveryOwner: 'worker-A',
        recoveryLeaseExpiresAt: { $gt: staleNow },
      },
      { $set: { analysis: { winnerId: 'stale-winner' } } }
    );
    expect(staleDecisionWrite.matchedCount).toBe(0);

    // Protected Write 2: reconcileOperation by Worker A must be strictly rejected
    await expect(
      recoveryWorkerService.reconcileOperation(claimA!, 'worker-A')
    ).rejects.toThrowError(ConcurrencyFencingError);

    // Protected Write 3: Compensation by Worker A must be strictly rejected
    await expect(
      executeCompensatingRollback(
        decision._id.toString(),
        2,
        { scores: {}, criteria: [], options: [] },
        opId,
        1, // Stale token
        'worker-A'
      )
    ).rejects.toThrowError(ConcurrencyFencingError);

    // Protected Write 4: Journal state transition by Worker A must be strictly rejected
    await expect(
      operationJournalRepository.transitionJournalState(
        opId,
        'worker-A',
        1,
        'PENDING',
        'DECISION_MUTATED'
      )
    ).rejects.toThrowError(ConcurrencyFencingError);

    // Worker B remains authoritative and can complete recovery cleanly
    const reconcileB = await recoveryWorkerService.reconcileOperation(claimB!, 'worker-B');
    expect(['completed', 'reverted']).toContain(reconcileB);

    const finalizedJournal = await OperationJournalModel.findOne({ operationId: opId });
    expect(finalizedJournal?.recoveryOwner).toBe('worker-B');
    expect(finalizedJournal?.fencingToken).toBe(2);
  });

  it('Scenario B — Expired heartbeat: heartbeat cannot extend or resurrect expired lease', async () => {
    const opId = `op-heartbeat-${Date.now()}`;
    const decId = new mongoose.Types.ObjectId();

    await DecisionModel.create({
      _id: decId,
      title: 'Heartbeat Expiry Test',
      version: 1,
      pendingOperationId: opId,
    });

    await OperationJournalModel.create(
      makeJournalPayload({
        operationId: opId,
        decisionId: decId,
        fencingToken: 1,
        recoveryOwner: 'worker-hb-1',
        leaseExpiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago!
        retryCount: 1,
      })
    );

    // Heartbeat attempt after expiry
    const renewed = await operationJournalRepository.renewOperationLease(
      opId,
      'worker-hb-1',
      1,
      30000,
      decId.toString()
    );

    expect(renewed).toBe(false);

    // Verify lease was NOT extended
    const journalAfter = await OperationJournalModel.findOne({ operationId: opId });
    expect(journalAfter?.leaseExpiresAt?.getTime()).toBeLessThan(Date.now());
  });

  it('Scenario C — Concurrent takeover: exactly one active owner and one new fencing generation', async () => {
    const opId = `op-concurrent-takeover-${Date.now()}`;
    const decId = new mongoose.Types.ObjectId();

    await DecisionModel.create({
      _id: decId,
      title: 'Concurrent Takeover Decision',
      version: 1,
      pendingOperationId: opId,
      recoveryFencingToken: 1,
    });

    await OperationJournalModel.create(
      makeJournalPayload({
        operationId: opId,
        decisionId: decId,
        fencingToken: 1,
        recoveryOwner: 'crashed-worker',
        leaseExpiresAt: new Date(Date.now() - 1000), // Expired
        retryCount: 1,
      })
    );

    // Two workers race concurrently to claim the expired operation
    const [result1, result2] = await Promise.all([
      operationJournalRepository.claimJournalOperation('worker-racer-1', 30000, opId),
      operationJournalRepository.claimJournalOperation('worker-racer-2', 30000, opId),
    ]);

    const winner = result1 || result2;
    const loser = result1 ? result2 : result1;

    expect(winner).not.toBeNull();
    expect(loser).toBeNull(); // Exactly one winner

    expect(winner?.fencingToken).toBe(2);
    expect(['worker-racer-1', 'worker-racer-2']).toContain(winner?.recoveryOwner);

    // Decision document reflects the exact single winner
    const decisionDoc = await DecisionModel.findById(decId);
    expect(decisionDoc?.recoveryFencingToken).toBe(2);
    expect(decisionDoc?.recoveryOwner).toBe(winner?.recoveryOwner);
  });

  it('Scenario D — Crash during claim transaction: complete transaction commits or none commits', async () => {
    const opId = `op-claim-abort-${Date.now()}`;
    const decId = new mongoose.Types.ObjectId();

    await DecisionModel.create({
      _id: decId,
      title: 'Crash Claim Decision',
      version: 1,
      pendingOperationId: opId,
      recoveryFencingToken: 1,
    });

    await OperationJournalModel.create(
      makeJournalPayload({
        operationId: opId,
        decisionId: decId,
        fencingToken: 1,
        recoveryOwner: null,
        leaseExpiresAt: null,
        retryCount: 0,
      })
    );

    // Simulate an aborted claim transaction
    await expect(
      runInTransaction(async (session) => {
        await operationJournalRepository.claimJournalOperation(
          'worker-crash',
          30000,
          opId,
          session
        );
        throw new Error('Simulated network crash after claim write');
      })
    ).rejects.toThrowError('Simulated network crash after claim write');

    // Verify journal and decision were completely restored
    const journalAfter = await OperationJournalModel.findOne({ operationId: opId });
    expect(journalAfter?.recoveryOwner).toBeNull();
    expect(journalAfter?.fencingToken).toBe(1);

    const decAfter = await DecisionModel.findById(decId);
    expect(decAfter?.recoveryOwner).toBeNull();
    expect(decAfter?.recoveryFencingToken).toBe(1);
  });

  it('Scenario E — Quarantine race: once quarantine wins, ordinary recovery writes are rejected', async () => {
    const opId = `op-quarantine-race-${Date.now()}`;
    const decId = new mongoose.Types.ObjectId();

    await DecisionModel.create({
      _id: decId,
      title: 'Quarantine Race Decision',
      version: 1,
      pendingOperationId: opId,
      recoveryFencingToken: 1,
      recoveryOwner: 'worker-active',
      recoveryLeaseExpiresAt: new Date(Date.now() + 30000),
      auditIntegrityStatus: 'healthy',
    });

    await OperationJournalModel.create(
      makeJournalPayload({
        operationId: opId,
        decisionId: decId,
        state: 'DECISION_MUTATED',
        fencingToken: 1,
        recoveryOwner: 'worker-active',
        leaseExpiresAt: new Date(Date.now() + 30000),
        retryCount: 1,
        expectedVersion: 1,
        targetVersion: 2,
      })
    );

    // Decision gets quarantined (e.g. by an administrator or tamper detection)
    await DecisionModel.updateOne(
      { _id: decId },
      {
        $set: {
          auditIntegrityStatus: 'quarantined',
          quarantineReason: 'Cryptographic hash mismatch detected',
        },
      }
    );

    // Active worker attempts ordinary recovery write
    const now = new Date();
    const updateRes = await DecisionModel.updateOne(
      {
        _id: decId,
        version: 2,
        pendingOperationId: opId,
        auditIntegrityStatus: { $ne: 'quarantined' },
        recoveryFencingToken: 1,
        recoveryOwner: 'worker-active',
        recoveryLeaseExpiresAt: { $gt: now },
      },
      { $set: { isAudited: true } }
    );

    expect(updateRes.matchedCount).toBe(0); // Strictly blocked!
  });
});
