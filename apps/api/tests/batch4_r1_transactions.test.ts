import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  connectToDatabase,
  disconnectFromDatabase,
  runInTransaction,
  isReplicaSetSupported,
  assertReplicaSetSupported,
} from '../src/db/connection.js';
import { getTestDatabaseUri, assertTestDatabase } from '../src/db/guard.js';
import {
  DecisionModel,
  AuditEventModel,
  NotificationOutboxModel,
  DecisionContributionModel,
} from '../src/models/index.js';
import { executeCompensatingRollback } from '../src/services/recoveryWorker.service.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { resolveQuarantine } from '../src/services/decision.service.js';
import { contributionService } from '../src/services/contribution.service.js';
import { auditService } from '../src/services/audit.service.js';

const REPLICA_SET_URI = getTestDatabaseUri();
assertTestDatabase(REPLICA_SET_URI);

const STANDALONE_URI = 'mongodb://127.0.0.1:27017/decision_os_standalone_test';
assertTestDatabase(STANDALONE_URI);

describe('Batch 4 Phase 1 — Transaction Enforcement & Standalone Fail-Closed Verification', () => {
  describe('A. Real Standalone MongoDB Integration (Port 27017)', () => {
    let standaloneConnected = false;

    beforeAll(async () => {
      try {
        await disconnectFromDatabase();
        await connectToDatabase(STANDALONE_URI, { serverSelectionTimeoutMS: 2000 });
        standaloneConnected = true;
      } catch {
        standaloneConnected = false;
      }
    });

    afterAll(async () => {
      await disconnectFromDatabase();
      // Reconnect to replica set for remaining tests
      await connectToDatabase(REPLICA_SET_URI);
    });

    it('detects standalone topology and reports isReplicaSetSupported() === false', () => {
      if (!standaloneConnected) {
        console.warn('Standalone MongoDB not reachable on port 27017, skipping standalone ping.');
        return;
      }
      expect(isReplicaSetSupported()).toBe(false);
    });

    it('assertReplicaSetSupported() throws clear configuration error on standalone MongoDB', () => {
      if (!standaloneConnected) return;
      expect(() => assertReplicaSetSupported()).toThrowError(
        /does not support multi-document transactions.*requires a MongoDB Replica Set/
      );
    });

    it('runInTransaction() strictly fails closed on standalone MongoDB', async () => {
      if (!standaloneConnected) return;
      let executed = false;
      await expect(
        runInTransaction(async () => {
          executed = true;
        })
      ).rejects.toThrowError(/does not support multi-document transactions/);
      expect(executed).toBe(false);
    });

    it('executeCompensatingRollback() strictly fails closed without standalone fallback', async () => {
      if (!standaloneConnected) return;
      const opId = 'op-standalone-fail-1';
      const decId = new mongoose.Types.ObjectId().toString();

      await expect(
        executeCompensatingRollback(
          decId,
          1,
          { scores: {}, criteria: [], options: [] },
          opId,
          1,
          'worker-standalone'
        )
      ).rejects.toThrowError(/does not support multi-document transactions/);
    });

    it('claimJournalOperation() strictly fails closed without standalone fallback', async () => {
      if (!standaloneConnected) return;
      await expect(
        operationJournalRepository.claimJournalOperation('worker-standalone', 10000, 'op-standalone-fail-2')
      ).rejects.toThrowError(/does not support multi-document transactions/);
    });

    it('resolveQuarantine() strictly fails closed without standalone fallback', async () => {
      if (!standaloneConnected) return;
      const dec = await DecisionModel.create({
        title: 'Quarantine Fail Closed Test',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 1,
        auditIntegrityStatus: 'quarantined',
        quarantineReason: 'Test quarantine',
      });
      await expect(
        resolveQuarantine(dec._id.toString(), { id: 'admin-1', role: 'admin' }, 'Resolve note')
      ).rejects.toThrowError(/does not support multi-document transactions/);
    });

    it('adoptExpertScores() strictly fails closed without standalone fallback', async () => {
      if (!standaloneConnected) return;
      const decId = new mongoose.Types.ObjectId().toString();
      const contribId = new mongoose.Types.ObjectId().toString();

      await expect(
        contributionService.adoptExpertScores(
          decId,
          contribId,
          { confirmation: true, expectedVersion: 1 },
          { id: 'admin-1', role: 'admin' }
        )
      ).rejects.toThrowError();
    });
  });

  describe('B. Multi-Document Transaction Session Propagation & Atomic Rollback', () => {
    beforeAll(async () => {
      await connectToDatabase(REPLICA_SET_URI);
      assertReplicaSetSupported();
    });

    afterAll(async () => {
      await disconnectFromDatabase();
    });

    it('audit insertion and audit-head advancement cannot partially commit on transaction abort', async () => {
      const decision = await DecisionModel.create({
        title: 'Transaction Atomic Audit Test',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 1,
        auditHead: { sequenceNumber: 1, eventHash: 'genesis_hash', lastEventId: 'ev-1', updatedAt: new Date() },
      });

      const eventId = `ev-atomic-abort-${Date.now()}`;

      await expect(
        runInTransaction(async (session) => {
          // Insert audit event
          await auditService.recordEvent(
            {
              decisionId: decision._id.toString(),
              action: 'decision.updated',
              entityType: 'decision',
              entityId: decision._id.toString(),
              summary: 'Pending aborted event',
              eventId,
            },
            session
          );

          // Force failure before commit
          throw new Error('Simulated post-audit transaction failure');
        })
      ).rejects.toThrowError('Simulated post-audit transaction failure');

      // Verify ZERO partial state committed
      const persistedEvent = await AuditEventModel.findOne({ eventId });
      expect(persistedEvent).toBeNull();

      const freshDecision = await DecisionModel.findById(decision._id);
      expect(freshDecision?.auditHead?.sequenceNumber).toBe(1);
      expect(freshDecision?.auditHead?.lastEventId).toBe('ev-1');
    });

    it('outbox notification and decision state cannot partially commit on transaction abort', async () => {
      const decision = await DecisionModel.create({
        title: 'Transaction Atomic Outbox Test',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 1,
      });

      const notifId = `notif-abort-${Date.now()}`;

      await expect(
        runInTransaction(async (session) => {
          await DecisionModel.updateOne(
            { _id: decision._id },
            { $set: { version: 2 } },
            { session }
          );

          await NotificationOutboxModel.create(
            [
              {
                notificationId: notifId,
                decisionId: decision._id,
                eventType: 'decision.updated',
                payload: { version: 2 },
                status: 'PENDING',
              },
            ],
            { session }
          );

          throw new Error('Simulated post-outbox transaction failure');
        })
      ).rejects.toThrowError('Simulated post-outbox transaction failure');

      // Neither decision version update nor outbox record must exist
      const unmutatedDecision = await DecisionModel.findById(decision._id);
      expect(unmutatedDecision?.version).toBe(1);

      const persistedOutbox = await NotificationOutboxModel.findOne({ notificationId: notifId });
      expect(persistedOutbox).toBeNull();
    });

    it('contribution projection cannot be updated outside the intended transaction', async () => {
      const decision = await DecisionModel.create({
        title: 'Transaction Contribution Projection Test',
        criteria: [{ id: 'c1', name: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 50 } },
        version: 1,
      });

      const contrib = await DecisionContributionModel.create({
        decisionId: decision._id,
        contributorId: new mongoose.Types.ObjectId(),
        status: 'submitted',
        revision: 1,
        recommendation: { preferredOptionId: 'o1' },
        criterionScores: { c1: 95 },
        submittedAt: new Date(),
      });

      await expect(
        runInTransaction(async (session) => {
          await DecisionContributionModel.updateOne(
            { _id: contrib._id },
            { $set: { status: 'adopted', adoptedBy: 'user-1' } },
            { session }
          );

          throw new Error('Transaction abort after contribution update');
        })
      ).rejects.toThrowError('Transaction abort after contribution update');

      const restoredContrib = await DecisionContributionModel.findById(contrib._id);
      expect(restoredContrib?.status).toBe('submitted');
      expect(restoredContrib?.adoptedBy).toBeNull();
    });
  });
});
