import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase, runInTransaction } from '../src/db/connection.js';
import { assertTestDatabase } from '../src/db/guard.js';
import {
  UserModel,
  DecisionModel,
  DecisionContributionModel,
  AuditEventModel,
  OperationJournalModel,
  NotificationOutboxModel,
} from '../src/models/index.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { contributionRepository } from '../src/repositories/contribution.repository.js';
import { contributionService } from '../src/services/contribution.service.js';
import { auditService } from '../src/services/audit.service.js';
import { outboxService } from '../src/services/outbox.service.js';
import { ConcurrencyFencingError, InvalidContributionStatusError } from '../src/errors/domain.errors.js';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI ||
  'mongodb://127.0.0.1:27018/decision_os_test?replicaSet=rs0&directConnection=true';
assertTestDatabase(TEST_MONGODB_URI);

describe('Batch 4 Adversarial Regression Suite — Replica Set & Transactional Recovery', () => {
  let app: FastifyInstance;
  let ownerUser: { id: string; email: string; token: string };
  let adminUser: { id: string; email: string; token: string };
  let expertUser: { id: string; email: string; token: string };
  let testDecisionId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await OperationJournalModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});
    await NotificationOutboxModel.deleteMany({});
    outboxService.resetConsumerRegistry();

    // Create owner
    const regOwner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'owner@adversarial.test',
        password: 'Password123!',
        name: 'Adversarial Owner',
      },
    });
    const ownerBody = regOwner.json();
    ownerUser = {
      id: ownerBody.user.id,
      email: ownerBody.user.email,
      token: ownerBody.token,
    };

    // Create admin
    const regAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'admin@adversarial.test',
        password: 'Password123!',
        name: 'System Admin',
      },
    });
    const adminBody = regAdmin.json();
    await UserModel.updateOne({ _id: adminBody.user.id }, { $set: { role: 'admin' } });
    const loginAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@adversarial.test',
        password: 'Password123!',
      },
    });
    const adminLoginBody = loginAdmin.json();
    adminUser = {
      id: adminBody.user.id,
      email: adminBody.user.email,
      token: adminLoginBody.token,
    };

    // Create expert
    const regExpert = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'expert@adversarial.test',
        password: 'Password123!',
        name: 'Expert Contributor',
      },
    });
    const expertBody = regExpert.json();
    expertUser = {
      id: expertBody.user.id,
      email: expertBody.user.email,
      token: expertBody.token,
    };

    // Create initial test decision
    const decision = await DecisionModel.create({
      title: 'Infrastructure Strategy Decision',
      ownerId: new mongoose.Types.ObjectId(ownerUser.id),
      version: 1,
      criteria: [
        { id: 'crit-cost', name: 'Cost', weight: 40, isLocked: false },
        { id: 'crit-perf', name: 'Performance', weight: 60, isLocked: false },
      ],
      options: [
        { id: 'opt-cloud', name: 'Cloud Native' },
        { id: 'opt-hybrid', name: 'Hybrid Cloud' },
      ],
      scores: {
        'opt-cloud': { 'crit-cost': 80, 'crit-perf': 70 },
        'opt-hybrid': { 'crit-cost': 60, 'crit-perf': 90 },
      },
      auditIntegrityStatus: 'healthy',
      isContributionRoundLocked: false,
    });
    testDecisionId = decision._id.toString();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F1 & F2: Concurrency & Fencing under High Load
  // ───────────────────────────────────────────────────────────────────────────
  describe('F1 & F2 — Recovery Worker Fencing & Heartbeat Correctness', () => {
    it('12 workers racing concurrently to claim 1 expired journal operation: exactly one succeeds', async () => {
      const past = new Date(Date.now() - 30000);
      await operationJournalRepository.createEntry({
        operationId: 'op-concurrent-race-1',
        decisionId: testDecisionId,
        action: 'contribution.adopted',
        actor: { id: ownerUser.id, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {} },
        auditDraft: {
          eventId: 'audit-concurrent-1',
          action: 'contribution.adopted',
          entityType: 'contribution',
          entityId: 'contrib-c1',
          summary: 'concurrent claim race',
        },
      });

      // Expire the operation lease
      await OperationJournalModel.updateOne(
        { operationId: 'op-concurrent-race-1' },
        {
          $set: {
            recoveryOwner: 'dead-worker',
            leaseExpiresAt: past,
            fencingToken: 1,
          },
        }
      );

      // 12 workers contend in parallel
      const workerIds = Array.from({ length: 12 }, (_, i) => `worker-race-${i + 1}`);
      const claims = await Promise.all(
        workerIds.map((wId) => operationJournalRepository.claimJournalOperation(wId, 30000, 'op-concurrent-race-1'))
      );

      const successfulClaims = claims.filter((c) => c !== null);
      expect(successfulClaims).toHaveLength(1);

      const winner = successfulClaims[0]!;
      expect(winner.fencingToken).toBe(2);

      // Verify the Decision document is bound to the winning worker and fencing token
      const decisionDoc = await DecisionModel.findById(testDecisionId);
      expect(decisionDoc?.recoveryOwner).toBe(winner.recoveryOwner);
      expect(decisionDoc?.recoveryFencingToken).toBe(2);
    });

    it('heartbeat cannot resurrect an expired lease', async () => {
      const past = new Date(Date.now() - 5000);
      await operationJournalRepository.createEntry({
        operationId: 'op-heartbeat-expiry',
        decisionId: testDecisionId,
        action: 'contribution.adopted',
        actor: { id: ownerUser.id, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {} },
        auditDraft: {
          eventId: 'audit-hb-1',
          action: 'contribution.adopted',
          entityType: 'contribution',
          entityId: 'contrib-hb-1',
          summary: 'hb test',
        },
      });

      await OperationJournalModel.updateOne(
        { operationId: 'op-heartbeat-expiry' },
        {
          $set: {
            recoveryOwner: 'worker-expired',
            leaseExpiresAt: past,
            fencingToken: 1,
          },
        }
      );

      const renewed = await operationJournalRepository.renewOperationLease(
        'op-heartbeat-expiry',
        'worker-expired',
        1,
        30000,
        testDecisionId
      );
      expect(renewed).toBe(false);

      // Check journal remained expired
      const journal = await OperationJournalModel.findOne({ operationId: 'op-heartbeat-expiry' });
      expect(journal?.leaseExpiresAt?.getTime()).toBeLessThan(Date.now());
    });

    it('superseded worker cannot transition journal state or mutate decision', async () => {
      await operationJournalRepository.createEntry({
        operationId: 'op-superseded-test',
        decisionId: testDecisionId,
        action: 'contribution.adopted',
        actor: { id: ownerUser.id, role: 'owner' },
        expectedVersion: 1,
        targetVersion: 2,
        payload: {},
        previousSnapshot: { version: 1, scores: {} },
        auditDraft: {
          eventId: 'audit-ss-1',
          action: 'contribution.adopted',
          entityType: 'contribution',
          entityId: 'contrib-ss-1',
          summary: 'superseded test',
        },
      });

      // Worker 1 claims
      const claim1 = await operationJournalRepository.claimJournalOperation('worker-1', 1000, 'op-superseded-test');
      expect(claim1?.fencingToken).toBe(1);

      // Worker 1 expires
      await OperationJournalModel.updateOne(
        { operationId: 'op-superseded-test' },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
      );

      // Worker 2 takes over
      const claim2 = await operationJournalRepository.claimJournalOperation('worker-2', 30000, 'op-superseded-test');
      expect(claim2?.fencingToken).toBe(2);

      // Worker 1 tries to transition journal state -> Must throw ConcurrencyFencingError
      await expect(
        operationJournalRepository.transitionJournalState(
          'op-superseded-test',
          'worker-1',
          1,
          'PENDING',
          'DECISION_MUTATED'
        )
      ).rejects.toThrow(ConcurrencyFencingError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F3: Contribution Projection Fencing & Transactional Safety
  // ───────────────────────────────────────────────────────────────────────────
  describe('F3 — Contribution Projection Fencing', () => {
    it('rejects stale adoption if contribution was already rejected', async () => {
      const contrib = await DecisionContributionModel.create({
        decisionId: testDecisionId,
        contributorId: expertUser.id,
        status: 'submitted',
        revision: 1,
        recommendation: { preferredOptionId: 'opt-cloud' },
        criterionScores: { 'crit-cost': 85, 'crit-perf': 75 },
      });

      // Rejection occurs
      const rejected = await contributionRepository.reject(contrib._id.toString(), 'Inadequate evidence', {
        id: ownerUser.id,
        name: 'Owner',
        role: 'owner',
      });
      expect(rejected?.status).toBe('rejected');

      // Attempting adoption on rejected contribution throws InvalidContributionStatusError
      await expect(
        contributionService.adoptExpertScores(
          testDecisionId,
          contrib._id.toString(),
          {
            confirmation: true,
            expectedVersion: 1,
          },
          { id: ownerUser.id, role: 'owner' }
        )
      ).rejects.toThrow(InvalidContributionStatusError);

      // Verify contribution is still rejected
      const finalContrib = await DecisionContributionModel.findById(contrib._id);
      expect(finalContrib?.status).toBe('rejected');
    });

    it('adopting contribution updates decision, marks adopted, records audit event, and creates outbox notification in 1 ACID transaction', async () => {
      const contrib = await DecisionContributionModel.create({
        decisionId: testDecisionId,
        contributorId: expertUser.id,
        status: 'submitted',
        revision: 1,
        recommendation: { preferredOptionId: 'opt-cloud' },
        criterionScores: { 'crit-cost': 95, 'crit-perf': 85 },
      });

      const { decision, isIdempotentReplay } = await contributionService.adoptExpertScores(
        testDecisionId,
        contrib._id.toString(),
        {
          confirmation: true,
          expectedVersion: 1,
        },
        { id: ownerUser.id, role: 'owner' }
      );

      expect(isIdempotentReplay).toBe(false);
      expect(decision.version).toBe(2);
      expect(decision.scores['opt-cloud']['crit-cost']).toBe(95);

      // Contribution marked adopted
      const adoptedContrib = await DecisionContributionModel.findById(contrib._id);
      expect(adoptedContrib?.status).toBe('adopted');

      // Authoritative audit event exists and is chained
      const latestAudit = await AuditEventModel.findOne({
        decisionId: testDecisionId,
        action: 'contribution.adopted',
      });
      expect(latestAudit).not.toBeNull();
      expect(latestAudit?.sequenceNumber).toBe(1);

      // Outbox notification exists
      const outboxRecord = await NotificationOutboxModel.findOne({
        decisionId: testDecisionId,
        eventType: 'contribution.adopted',
      });
      expect(outboxRecord).not.toBeNull();
      expect(outboxRecord?.status).toBe('PENDING');

      // Idempotent replay check: Calling adopt again returns decision without mutation
      const replay = await contributionService.adoptExpertScores(
        testDecisionId,
        contrib._id.toString(),
        {
          confirmation: true,
          expectedVersion: 2,
        },
        { id: ownerUser.id, role: 'owner' }
      );
      expect(replay.isIdempotentReplay).toBe(true);
      expect(replay.decision.version).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F4: Audit Chain Cryptographic Integrity
  // ───────────────────────────────────────────────────────────────────────────
  describe('F4 — Audit Chain Cryptographic Integrity', () => {
    it('advances sequenceNumber monotonically and forms unbroken hash chain', async () => {
      const e1 = await auditService.recordEvent({
        decisionId: testDecisionId,
        action: 'decision.created',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'First event',
      });
      expect(e1.sequenceNumber).toBe(1);
      expect(e1.previousEventHash).toBe('0'.repeat(64));

      const e2 = await auditService.recordEvent({
        decisionId: testDecisionId,
        action: 'decision.updated',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Second event',
      });
      expect(e2.sequenceNumber).toBe(2);
      expect(e2.previousEventHash).toBe(e1.eventHash);

      const e3 = await auditService.recordEvent({
        decisionId: testDecisionId,
        action: 'decision.calculated',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Third event',
      });
      expect(e3.sequenceNumber).toBe(3);
      expect(e3.previousEventHash).toBe(e2.eventHash);

      // Verify the entire chain using auditService.verifyChain
      const verification = await auditService.verifyChain(testDecisionId);
      expect(verification.valid).toBe(true);
      expect(verification.totalEvents).toBe(3);
      expect(verification.violations).toHaveLength(0);

      // Verify decision.auditHead is updated to e3
      const decisionDoc = await DecisionModel.findById(testDecisionId);
      expect(decisionDoc?.auditHead?.lastEventId).toBe(e3.eventId);
      expect(decisionDoc?.auditHead?.sequenceNumber).toBe(3);
      expect(decisionDoc?.auditHead?.eventHash).toBe(e3.eventHash);
    });

    it('session abort leaves zero audit events and does not increment sequence number', async () => {
      const e1 = await auditService.recordEvent({
        decisionId: testDecisionId,
        action: 'decision.created',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Baseline event',
      });
      expect(e1.sequenceNumber).toBe(1);

      // Attempt transaction that aborts
      let abortedEventId: string | null = null;
      try {
        await runInTransaction(async (session) => {
          const eDoomed = await auditService.recordEvent(
            {
              decisionId: testDecisionId,
              action: 'decision.updated',
              entityType: 'decision',
              entityId: testDecisionId,
              summary: 'Doomed audit write',
            },
            session
          );
          abortedEventId = eDoomed.eventId;
          throw new Error('Forced transactional abort');
        });
      } catch {
        // Expected abort
      }

      // Check aborted event was not saved
      const foundAborted = await AuditEventModel.findOne({ eventId: abortedEventId });
      expect(foundAborted).toBeNull();

      // Next successful event receives sequenceNumber 2 (no gap!)
      const e2 = await auditService.recordEvent({
        decisionId: testDecisionId,
        action: 'decision.updated',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Clean subsequent event',
      });
      expect(e2.sequenceNumber).toBe(2);
      expect(e2.previousEventHash).toBe(e1.eventHash);

      const verification = await auditService.verifyChain(testDecisionId);
      expect(verification.valid).toBe(true);
      expect(verification.totalEvents).toBe(2);
    });

    it('idempotent eventId retry returns existing event without creating duplicate or breaking chain', async () => {
      const eventId = 'stable-custom-event-id-123';
      const first = await auditService.recordEvent({
        eventId,
        decisionId: testDecisionId,
        action: 'decision.created',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'First attempt',
      });

      const retry = await auditService.recordEvent({
        eventId,
        decisionId: testDecisionId,
        action: 'decision.created',
        entityType: 'decision',
        entityId: testDecisionId,
        summary: 'Retry attempt',
      });

      expect(retry.eventId).toBe(first.eventId);
      expect(retry.sequenceNumber).toBe(first.sequenceNumber);
      expect(retry.eventHash).toBe(first.eventHash);

      const count = await AuditEventModel.countDocuments({ decisionId: testDecisionId });
      expect(count).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F6: Quarantine Protection & Administrative Resolution
  // ───────────────────────────────────────────────────────────────────────────
  describe('F6 — Quarantine Mutation Blocking & Administrative Resolution', () => {
    it('quarantined decision blocks ordinary mutations with 423 Locked', async () => {
      await DecisionModel.updateOne(
        { _id: testDecisionId },
        {
          $set: {
            auditIntegrityStatus: 'quarantined',
            quarantineReason: 'Adversarial tampering test',
          },
        }
      );

      // Attempt PUT update via REST API
      const res = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${testDecisionId}`,
        headers: { authorization: `Bearer ${ownerUser.token}` },
        payload: { title: 'Attempted mutation while quarantined' },
      });

      expect(res.statusCode).toBe(423);
      const body = res.json();
      expect(body.error).toBe('DecisionQuarantinedError');
    });

    it('administrative quarantine resolution endpoint atomically restores healthy state', async () => {
      await DecisionModel.updateOne(
        { _id: testDecisionId },
        {
          $set: {
            auditIntegrityStatus: 'quarantined',
            quarantineReason: 'Chain mismatch',
            version: 3,
          },
        }
      );

      // Call resolution route
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/decisions/${testDecisionId}/quarantine/resolve`,
        headers: { authorization: `Bearer ${adminUser.token}` },
        payload: { notes: 'Audited and verified manually by SecOps' },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.auditIntegrityStatus).toBe('healthy');
      expect(updated.quarantineReason).toBeNull();
      expect(updated.version).toBe(4); // Monotonically incremented!

      // Verify audit event recorded
      const resolveAudit = await AuditEventModel.findOne({
        decisionId: testDecisionId,
        action: 'decision.quarantine_resolved',
      });
      expect(resolveAudit).not.toBeNull();
      expect(resolveAudit?.diff?.after?.auditIntegrityStatus).toBe('healthy');
      expect(resolveAudit?.diff?.after?.version).toBe(4);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F7: Transactional Outbox & At-Least-Once Delivery
  // ───────────────────────────────────────────────────────────────────────────
  describe('F7 — Transactional Outbox & At-Least-Once Delivery', () => {
    it('creates outbox notification within transaction and dispatches it cleanly', async () => {
      const notifId = 'notif-adversarial-1';
      await runInTransaction(async (session) => {
        await outboxService.createNotification(
          {
            notificationId: notifId,
            decisionId: testDecisionId,
            eventType: 'decision.updated',
            payload: { message: 'Transactionally durable outbox event' },
          },
          session
        );
      });

      const pending = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(pending).not.toBeNull();
      expect(pending?.status).toBe('PENDING');

      // Dispatch pending records
      const dispatchedItems: string[] = [];
      const result = await outboxService.dispatchPending('dispatcher-worker-1', 10, async (item) => {
        dispatchedItems.push(item.notificationId);
      });

      expect(result.succeeded).toBe(1);
      expect(dispatchedItems).toContain(notifId);

      // Record marked DELIVERED
      const delivered = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(delivered?.status).toBe('DELIVERED');
      expect(delivered?.deliveredAt).not.toBeNull();
    });

    it('consumer deduplicates repeated notification deliveries', () => {
      const consumerId = 'email-notifier-service';
      const eventId = 'notif-dup-check-999';

      const firstPass = outboxService.deduplicateConsumerEvent(consumerId, eventId);
      expect(firstPass).toBe(true); // First delivery processed

      const duplicatePass = outboxService.deduplicateConsumerEvent(consumerId, eventId);
      expect(duplicatePass).toBe(false); // Duplicate ignored!
    });
  });
});
