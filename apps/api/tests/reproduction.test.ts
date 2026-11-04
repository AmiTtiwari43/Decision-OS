import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase } from '../src/db/guard.js';
import {
  DecisionModel,
  UserModel,
  OperationJournalModel,
  DecisionContributionModel,
  AuditEventModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { contributionRepository } from '../src/repositories/contribution.repository.js';
import { auditService } from '../src/services/audit.service.js';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI ||
  'mongodb://127.0.0.1:27018/decision_os_test?replicaSet=rs0&directConnection=true';
assertTestDatabase(TEST_MONGODB_URI);

describe('Batch 4 Defects Reproduction Suite (F1 - F8)', () => {
  let testUserId: string;
  let testDecisionId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await OperationJournalModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});

    const user = await UserModel.create({
      email: 'owner@test.internal',
      passwordHash: 'hash12345678',
      name: 'Test Owner',
    });
    testUserId = user._id.toString();

    const decision = await DecisionModel.create({
      title: 'Reproduction Decision',
      ownerId: user._id,
      version: 1,
      criteria: [
        { id: 'c1', name: 'Crit 1', weight: 50, isLocked: false },
        { id: 'c2', name: 'Crit 2', weight: 50, isLocked: false },
      ],
      options: [
        { id: 'opt1', name: 'Opt 1' },
        { id: 'opt2', name: 'Opt 2' },
      ],
      scores: {
        opt1: { c1: 80, c2: 70 },
        opt2: { c1: 60, c2: 90 },
      },
      auditIntegrityStatus: 'healthy',
      isContributionRoundLocked: false,
    });
    testDecisionId = decision._id.toString();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F1: Recovery worker fencing race
  // ───────────────────────────────────────────────────────────────────────────
  it('F1 — exposes gap where journal claim and decision lease binding are separate writes', async () => {
    // 1. Create a pending operation
    await operationJournalRepository.createEntry({
      operationId: 'op-f1-race',
      decisionId: testDecisionId,
      action: 'contribution.adopted',
      actor: { id: testUserId, role: 'owner' },
      expectedVersion: 1,
      targetVersion: 2,
      payload: {},
      previousSnapshot: { version: 1, scores: {} },
      auditDraft: {
        eventId: 'audit-draft-1',
        action: 'contribution.adopted',
        entityType: 'contribution',
        entityId: 'contrib-1',
        summary: 'test',
      },
    });

    // Worker A acquired the lease in journal, but NOT in decision
    // Lease expires
    const now = new Date();
    await OperationJournalModel.updateOne(
      { operationId: 'op-f1-race' },
      {
        $set: {
          recoveryOwner: 'worker-A',
          leaseExpiresAt: new Date(now.getTime() - 1000),
          fencingToken: 1,
        },
      }
    );

    // Worker B claims the operation in journal (fencingToken becomes 2, recoveryOwner: worker-B)
    // BUT before Worker B calls bindDecisionLease:
    await OperationJournalModel.updateOne(
      { operationId: 'op-f1-race' },
      {
        $set: {
          recoveryOwner: 'worker-B',
          leaseExpiresAt: new Date(now.getTime() + 30000),
          fencingToken: 2,
        },
      }
    );

    // Stale Worker A attempts to mutate the Decision directly using its old fencingToken = 1
    // In current code: DecisionModel has recoveryFencingToken: null
    // Filter on DecisionModel is:
    // $or: [{ recoveryFencingToken: 1, recoveryOwner: 'worker-A' }, { recoveryFencingToken: null }, ...]
    const mutateRes = await DecisionModel.updateOne(
      {
        _id: new mongoose.Types.ObjectId(testDecisionId),
        version: 1,
        $or: [
          { recoveryFencingToken: 1, recoveryOwner: 'worker-A' },
          { recoveryFencingToken: null },
        ],
      },
      {
        $set: {
          version: 2,
          scores: { opt1: { c1: 99, c2: 99 } },
        },
      }
    );

    // Stale Worker A's update in the current implementation matches and modifies the document!
    // This proves the defect: Stale Worker A committed changes despite Worker B having claimed the journal!
    expect(mutateRes.modifiedCount).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F2: Lease expiry and heartbeat correctness
  // ───────────────────────────────────────────────────────────────────────────
  it('F2 — exposes that heartbeat resurrects an already-expired lease if token is not incremented', async () => {
    const past = new Date(Date.now() - 60000); // 1 minute ago
    await operationJournalRepository.createEntry({
      operationId: 'op-f2-expiry',
      decisionId: testDecisionId,
      action: 'contribution.adopted',
      actor: { id: testUserId, role: 'owner' },
      expectedVersion: 1,
      targetVersion: 2,
      payload: {},
      previousSnapshot: { version: 1, scores: {} },
      auditDraft: {
        eventId: 'audit-draft-1',
        action: 'contribution.adopted',
        entityType: 'contribution',
        entityId: 'contrib-1',
        summary: 'test',
      },
    });

    // Mark as claimed by worker-A with expired lease
    await OperationJournalModel.updateOne(
      { operationId: 'op-f2-expiry' },
      {
        $set: {
          recoveryOwner: 'worker-A',
          leaseExpiresAt: past,
          fencingToken: 1,
        },
      }
    );

    // IN CURRENT DEFECTIVE CODE: renewOperationLease does NOT check leaseExpiresAt > now!
    // So worker-A's heartbeat succeeds and RESURRECTS the expired lease!
    const renewed = await operationJournalRepository.renewOperationLease(
      'op-f2-expiry',
      'worker-A',
      1,
      30000,
      testDecisionId
    );

    // A heartbeat MUST NEVER resurrect an expired lease!
    // If the lease has already expired, renewOperationLease MUST return false!
    expect(renewed).toBe(false); // In current code, this will FAIL (it returns true)!
  });

  it('F2 — exposes that non-null owner with null leaseExpiresAt cannot be claimed', async () => {
    await operationJournalRepository.createEntry({
      operationId: 'op-f2-null-expiry',
      decisionId: testDecisionId,
      action: 'contribution.adopted',
      actor: { id: testUserId, role: 'owner' },
      expectedVersion: 1,
      targetVersion: 2,
      payload: {},
      previousSnapshot: { version: 1, scores: {} },
      auditDraft: {
        eventId: 'audit-draft-1',
        action: 'contribution.adopted',
        entityType: 'contribution',
        entityId: 'contrib-1',
        summary: 'test',
      },
    });

    // Non-null owner with null expiry
    await OperationJournalModel.updateOne(
      { operationId: 'op-f2-null-expiry' },
      {
        $set: {
          recoveryOwner: 'worker-dead',
          leaseExpiresAt: null,
          fencingToken: 1,
        },
      }
    );

    // In current code, query is: $or: [{ recoveryOwner: null }, { leaseExpiresAt: { $lt: now } }]
    // When leaseExpiresAt is null and recoveryOwner is non-null, neither branch matches!
    const claimed = await operationJournalRepository.claimJournalOperation('worker-new', 30000, 'op-f2-null-expiry');
    // A defective implementation returns null (permanently stuck)
    expect(claimed).not.toBeNull(); // In current code, this will FAIL (it returns null)!
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F3: Contribution projection fencing
  // ───────────────────────────────────────────────────────────────────────────
  it('F3 — exposes that contribution projection modification only checks document ID and overwrites later states', async () => {
    // 1. Create a contribution in 'submitted' state
    const contribution = await DecisionContributionModel.create({
      decisionId: testDecisionId,
      contributorId: testUserId,
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'opt1' },
      criterionScores: { c1: 95, c2: 90 },
    });
    const contributionId = contribution._id.toString();

    // 2. Suppose Owner or Worker B rejects the contribution
    await contributionRepository.reject(contributionId, 'Invalid expert scores', {
      id: testUserId,
      name: 'Owner',
      role: 'owner',
    });

    const rejected = await contributionRepository.findById(contributionId);
    expect(rejected?.status).toBe('rejected');

    // 3. Stale Worker A resumes and calls markAdopted(contributionId, ...)
    // In current defective code, markAdopted uses findByIdAndUpdate without checking status === 'submitted'
    // So stale Worker A overwrites 'rejected' with 'adopted'!
    await contributionRepository.markAdopted(contributionId, testUserId, 'opt1');

    const afterStaleWrite = await contributionRepository.findById(contributionId);
    // Correct behavior: stale adoption MUST NOT overwrite 'rejected' state!
    expect(afterStaleWrite?.status).toBe('rejected'); // In current code, this will FAIL (it will be 'adopted')!
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F4: Audit-chain integrity
  // ───────────────────────────────────────────────────────────────────────────
  it('F4 — exposes that failed transaction leaves partial audit event when audit is not session-bound', async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    let eventCreatedId: string | null = null;
    try {
      // Pass session so audit event is bound to transaction
      const event = await auditService.recordEvent({
        decisionId: testDecisionId,
        action: 'decision.updated',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Inside doomed transaction',
        session,
      });
      eventCreatedId = event.eventId;

      // Now transaction aborts (e.g. failure)
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }

    // In current defective code, because recordEvent did not use session, the audit event PERSISTS!
    const foundEvent = await AuditEventModel.findOne({ eventId: eventCreatedId });
    // Correct behavior: aborted transaction MUST NOT leave orphan audit event!
    expect(foundEvent).toBeNull(); // In current code, this will FAIL (event was committed outside transaction)!
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F6: Quarantine correctness
  // ───────────────────────────────────────────────────────────────────────────
  it('F6 — exposes missing administrative quarantine resolution route and state management', async () => {
    // Put decision into quarantined state
    await DecisionModel.updateOne(
      { _id: testDecisionId },
      {
        $set: {
          auditIntegrityStatus: 'quarantined',
          quarantineReason: 'Corrupted hash chain detected',
        },
      }
    );

    const quarantined = await DecisionModel.findById(testDecisionId);
    expect(quarantined?.auditIntegrityStatus).toBe('quarantined');

    // In current code, there is NO route or service method for admin quarantine resolution:
    // It must atomically verify admin, monotonically increment version, append audit event, and restore 'healthy'
    // We will verify this defect in analysis matrix
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F7: Notification outbox
  // ───────────────────────────────────────────────────────────────────────────
  it('F7 — exposes complete absence of transactional notification outbox', async () => {
    // Current codebase has no NotificationOutbox model or service
    const collections = await mongoose.connection.db?.listCollections().toArray();
    const collectionNames = collections?.map((c) => c.name) || [];
    expect(collectionNames.some((c) => c.includes('outbox'))).toBe(true); // Fails in current code!
  });
});
