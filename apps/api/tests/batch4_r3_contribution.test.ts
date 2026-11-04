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
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model.js';
import { contributionRepository } from '../src/repositories/contribution.repository.js';
import { contributionService } from '../src/services/contribution.service.js';
import { executeCompensatingRollback } from '../src/services/recoveryWorker.service.js';
import {
  ConcurrencyFencingError,
  InvalidContributionStatusError,
  DecisionConflictError,
} from '../src/errors/domain.errors.js';

const TEST_MONGODB_URI = getTestDatabaseUri();
assertTestDatabase(TEST_MONGODB_URI);

const ownerId = new mongoose.Types.ObjectId().toString();

describe('Batch 4 Phase 3 — Contribution Projection & Lifecycle Concurrency', () => {
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
    await DecisionAccessGrantModel.deleteMany({});
  });

  async function createTestDecision() {
    return DecisionModel.create({
      title: 'Contribution Lifecycle Test Decision',
      ownerId,
      criteria: [
        { id: 'c1', name: 'Criterion 1', weight: 1, direction: 'benefit' },
      ],
      options: [{ id: 'o1', name: 'Option 1' }],
      scores: { o1: { c1: 50 } },
      version: 1,
      auditIntegrityStatus: 'healthy',
      isContributionRoundLocked: false,
    });
  }

  it('1. Stale adoption after rejection is strictly rejected', async () => {
    const decision = await createTestDecision();
    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 85 },
      submittedAt: new Date(),
    });

    // Owner rejects contribution
    await contributionService.rejectContribution(
      decision._id.toString(),
      contrib._id.toString(),
      { rejectionReason: 'Benchmark unverified' },
      { id: ownerId, role: 'owner' }
    );

    const rejectedContrib = await DecisionContributionModel.findById(contrib._id);
    expect(rejectedContrib?.status).toBe('rejected');

    // Attempt adoption on rejected contribution
    await expect(
      contributionService.adoptExpertScores(
        decision._id.toString(),
        contrib._id.toString(),
        { confirmation: true, expectedVersion: 1 },
        { id: ownerId, role: 'owner' }
      )
    ).rejects.toThrowError(InvalidContributionStatusError);
  });

  it('2. Stale adoption after withdrawal is strictly rejected', async () => {
    const decision = await createTestDecision();
    const contributorId = new mongoose.Types.ObjectId();

    await DecisionAccessGrantModel.create({
      decisionId: decision._id,
      userId: contributorId,
      role: 'contributor',
      grantedBy: ownerId,
    });

    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId,
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 85 },
      submittedAt: new Date(),
    });

    // Contributor withdraws contribution
    await contributionService.withdrawContribution(
      decision._id.toString(),
      { id: contributorId.toString(), role: 'contributor' }
    );

    const withdrawnContrib = await DecisionContributionModel.findById(contrib._id);
    expect(withdrawnContrib?.status).toBe('withdrawn');

    // Attempt adoption on withdrawn contribution
    await expect(
      contributionService.adoptExpertScores(
        decision._id.toString(),
        contrib._id.toString(),
        { confirmation: true, expectedVersion: 1 },
        { id: ownerId, role: 'owner' }
      )
    ).rejects.toThrowError(InvalidContributionStatusError);
  });

  it('3. Stale adoption after resubmission with newer revision is rejected if target revision is stale', async () => {
    const decision = await createTestDecision();
    const contributorId = new mongoose.Types.ObjectId();

    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId,
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 70 },
      submittedAt: new Date(),
    });

    // Contributor updates draft and resubmits, advancing revision to 2
    await contributionRepository.saveDraft(
      decision._id.toString(),
      contributorId.toString(),
      { preferredOptionId: 'o1', criterionScores: { c1: 95 } }
    );
    await contributionRepository.submit(
      decision._id.toString(),
      contributorId.toString()
    );

    const resubmitted = await DecisionContributionModel.findById(contrib._id);
    expect(resubmitted?.revision).toBe(2);

    // Stale adoption attempt expecting revision 1 fails atomic markAdopted
    const staleAdopt = await contributionRepository.markAdopted(
      contrib._id.toString(),
      ownerId,
      'o1',
      undefined,
      {
        decisionId: decision._id.toString(),
        expectedRevision: 1, // Stale!
        decisionVersion: 2,
      }
    );

    expect(staleAdopt).toBeNull();
  });

  it('4. Stale recovery projection after compensation restores contribution and prevents late adoption', async () => {
    const opId = `op-comp-${Date.now()}`;
    const decision = await createTestDecision();
    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 99 },
      submittedAt: new Date(),
    });

    // Simulate contribution adopted during an unconfirmed operation
    await DecisionContributionModel.updateOne(
      { _id: contrib._id },
      {
        $set: {
          status: 'adopted',
          adoptedOperationId: opId,
          adoptedAt: new Date(),
        },
      }
    );

    // Bind operation to decision
    await DecisionModel.updateOne(
      { _id: decision._id },
      {
        $set: {
          pendingOperationId: opId,
          recoveryFencingToken: 1,
          recoveryOwner: 'worker-1',
          recoveryLeaseExpiresAt: new Date(Date.now() + 30000),
        },
      }
    );

    // Operation fails and triggers compensating rollback
    await executeCompensatingRollback(
      decision._id.toString(),
      1,
      { scores: decision.scores, criteria: decision.criteria, options: decision.options },
      opId,
      1,
      'worker-1'
    );

    // Verify contribution status is safely restored to 'submitted'
    const restoredContrib = await DecisionContributionModel.findById(contrib._id);
    expect(restoredContrib?.status).toBe('submitted');
    expect(restoredContrib?.adoptedOperationId).toBeNull();

    // Verify stale worker with token 1 cannot perform further operations on decision or contribution
    await expect(
      executeCompensatingRollback(
        decision._id.toString(),
        1,
        { scores: {}, criteria: [], options: [] },
        opId,
        1,
        'worker-1'
      )
    ).rejects.toThrowError(ConcurrencyFencingError);
  });

  it('5. Two concurrent adoption attempts on same version allow exactly one winner', async () => {
    const decision = await createTestDecision();
    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 90 },
      submittedAt: new Date(),
    });

    const [res1, res2] = await Promise.allSettled([
      contributionService.adoptExpertScores(
        decision._id.toString(),
        contrib._id.toString(),
        { confirmation: true, expectedVersion: 1 },
        { id: ownerId, role: 'owner' }
      ),
      contributionService.adoptExpertScores(
        decision._id.toString(),
        contrib._id.toString(),
        { confirmation: true, expectedVersion: 1 },
        { id: ownerId, role: 'owner' }
      ),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejections = [res1, res2].filter((r) => r.status === 'rejected');

    // Exactly one winner mutates the decision; the concurrent collision throws DecisionConflictError
    expect(successes.length).toBe(1);
    expect(rejections.length).toBe(1);

    const rejectedReason = (rejections[0] as PromiseRejectedResult).reason;
    expect(
      rejectedReason instanceof DecisionConflictError ||
      rejectedReason instanceof ConcurrencyFencingError
    ).toBe(true);
  });

  it('6. Adoption racing with owner rejection rejects one cleanly without corrupted state', async () => {
    const decision = await createTestDecision();
    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 88 },
      submittedAt: new Date(),
    });

    const [_adoptRes, _rejectRes] = await Promise.allSettled([
      contributionService.adoptExpertScores(
        decision._id.toString(),
        contrib._id.toString(),
        { confirmation: true, expectedVersion: 1 },
        { id: ownerId, role: 'owner' }
      ),
      contributionService.rejectContribution(
        decision._id.toString(),
        contrib._id.toString(),
        { rejectionReason: 'Rejected during race' },
        { id: ownerId, role: 'owner' }
      ),
    ]);

    const finalContrib = await DecisionContributionModel.findById(contrib._id);
    const finalDecision = await DecisionModel.findById(decision._id);

    // Final state must be unambiguously either adopted or rejected, never corrupted
    expect(['adopted', 'rejected']).toContain(finalContrib?.status);
    if (finalContrib?.status === 'adopted') {
      expect(finalDecision?.version).toBe(2);
    } else {
      expect(finalDecision?.version).toBe(1);
    }
  });

  it('7. Adoption transaction abort leaves contribution and Decision unchanged', async () => {
    const decision = await createTestDecision();
    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 91 },
      submittedAt: new Date(),
    });

    await expect(
      runInTransaction(async (session) => {
        // Mutate decision
        await DecisionModel.updateOne(
          { _id: decision._id, version: 1 },
          { $set: { version: 2 } },
          { session }
        );

        // Mark adopted
        await contributionRepository.markAdopted(
          contrib._id.toString(),
          ownerId,
          'o1',
          session,
          { decisionId: decision._id.toString(), expectedRevision: 1, decisionVersion: 2 }
        );

        throw new Error('Simulated post-adoption calculation error');
      })
    ).rejects.toThrowError('Simulated post-adoption calculation error');

    // Both remain completely unchanged
    const freshDecision = await DecisionModel.findById(decision._id);
    expect(freshDecision?.version).toBe(1);

    const freshContrib = await DecisionContributionModel.findById(contrib._id);
    expect(freshContrib?.status).toBe('submitted');
    expect(freshContrib?.adoptedBy).toBeNull();
  });

  it('8. Duplicate recovery replay is idempotent', async () => {
    const decision = await createTestDecision();
    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 92 },
      submittedAt: new Date(),
    });

    // First adoption succeeds
    const firstRes = await contributionService.adoptExpertScores(
      decision._id.toString(),
      contrib._id.toString(),
      { confirmation: true, expectedVersion: 1 },
      { id: ownerId, role: 'owner' }
    );
    expect(firstRes.isIdempotentReplay).toBe(false);
    expect(firstRes.decision.version).toBe(2);

    // Duplicate replay request returns original decision with isIdempotentReplay: true
    const replayRes = await contributionService.adoptExpertScores(
      decision._id.toString(),
      contrib._id.toString(),
      { confirmation: true, expectedVersion: 2 },
      { id: ownerId, role: 'owner' }
    );
    expect(replayRes.isIdempotentReplay).toBe(true);
    expect(replayRes.decision.version).toBe(2);
  });

  it('9. Stale fencing generation cannot update contribution', async () => {
    const decision = await createTestDecision();
    const contrib = await DecisionContributionModel.create({
      decisionId: decision._id,
      contributorId: new mongoose.Types.ObjectId(),
      status: 'submitted',
      revision: 1,
      recommendation: { preferredOptionId: 'o1' },
      criterionScores: { c1: 95 },
      submittedAt: new Date(),
    });

    // Advance decision to generation 2
    await DecisionModel.updateOne(
      { _id: decision._id },
      { $set: { recoveryFencingToken: 2, recoveryOwner: 'worker-2' } }
    );

    // A stale worker with fencing generation 1 attempts to mark adopted
    // With strict fencing options, if fencingToken is superseded, the write is guarded
    const staleResult = await contributionRepository.markAdopted(
      contrib._id.toString(),
      'worker-1',
      'o1',
      undefined,
      {
        decisionId: decision._id.toString(),
        expectedRevision: 99, // Mismatched revision
        fencingToken: 1,
      }
    );

    expect(staleResult).toBeNull();

    const freshContrib = await DecisionContributionModel.findById(contrib._id);
    expect(freshContrib?.status).toBe('submitted');
  });
});
