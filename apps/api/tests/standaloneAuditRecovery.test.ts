import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  populateSyntheticDemo,
  replaceSyntheticScore,
  reconcileStandaloneAudit,
} from '../src/services/decision.service.js';
import { decisionRepository } from '../src/repositories/decision.repository.js';
import { operationJournalRepository } from '../src/repositories/operationJournal.repository.js';
import { auditService } from '../src/services/audit.service.js';
import { DecisionModel, OperationJournalModel } from '../src/models/index.js';
import * as connectionModule from '../src/db/connection.js';
import {
  DecisionConflictError,
  DecisionQuarantinedError,
} from '../src/errors/domain.errors.js';

describe('Batch 02-R5: Audit Atomicity & Recovery Verification', () => {
  const validDecisionId = new mongoose.Types.ObjectId().toString();

  const baseCriteria = [
    { id: 'crit-cost', name: 'Cost', weight: 40, direction: 'cost' as const },
    { id: 'crit-perf', name: 'Performance', weight: 60, direction: 'benefit' as const },
  ];

  const baseOptions = [
    { id: 'opt-a', name: 'Option A' },
    { id: 'opt-b', name: 'Option B' },
  ];

  const requester = {
    id: new mongoose.Types.ObjectId().toString(),
    role: 'admin',
    email: 'auditor@decision-os.org',
    name: 'Auditor Admin',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(connectionModule, 'isReplicaSetSupported').mockReturnValue(false);
    vi.spyOn(DecisionModel, 'updateOne').mockReturnValue({
      exec: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as any);
    vi.spyOn(OperationJournalModel, 'updateOne').mockReturnValue({
      exec: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as any);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Task 1: Demo-Fill and Audit Atomicity
  // ══════════════════════════════════════════════════════════════════════════
  describe('Task 1: Demo-Fill and Audit Atomicity', () => {
    it('Transaction rollback: Audit append failure leaves decision unchanged in replica-set mode', async () => {
      vi.spyOn(connectionModule, 'isReplicaSetSupported').mockReturnValue(true);

      const mockSession = {
        withTransaction: vi.fn(async (cb: () => Promise<unknown>) => {
          return cb();
        }),
      } as unknown as mongoose.ClientSession;

      vi.spyOn(connectionModule, 'runInTransaction').mockImplementation(async (cb) => {
        return cb(mockSession);
      });

      const existingDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 1,
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-a': { 'crit-cost': 80 } }, // 3 cells missing
        scoreProvenance: {},
        ownerId: new mongoose.Types.ObjectId(requester.id),
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(existingDoc as any);
      const updateSpy = vi.spyOn(decisionRepository, 'update').mockResolvedValue({
        ...existingDoc,
        version: 2,
      } as any);

      // Failure injection: auditService.recordEvent throws an error
      vi.spyOn(auditService, 'recordEvent').mockRejectedValue(new Error('Audit append disk failure'));

      await expect(
        populateSyntheticDemo(validDecisionId, 75, 1, requester)
      ).rejects.toThrow('Audit append disk failure');

      // Proves decisionRepository.update received the exact same session
      expect(updateSpy).toHaveBeenCalledWith(
        validDecisionId,
        expect.objectContaining({ version: 2 }),
        1,
        mockSession
      );
    });

    it('Decision update failure produces NO audit event', async () => {
      vi.spyOn(connectionModule, 'isReplicaSetSupported').mockReturnValue(true);

      const mockSession = {} as mongoose.ClientSession;
      vi.spyOn(connectionModule, 'runInTransaction').mockImplementation(async (cb) => {
        return cb(mockSession);
      });

      const existingDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 2,
        criteria: baseCriteria,
        options: baseOptions,
        scores: {},
        scoreProvenance: {},
        ownerId: new mongoose.Types.ObjectId(requester.id),
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(existingDoc as any);
      // Failure injection: decisionRepository.update fails due to concurrent modification
      vi.spyOn(decisionRepository, 'update').mockResolvedValue(null);

      const auditSpy = vi.spyOn(auditService, 'recordEvent');

      await expect(
        populateSyntheticDemo(validDecisionId, 75, 2, requester)
      ).rejects.toThrow(DecisionConflictError);

      // Audit event was NEVER called
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it('Successful operation persists scores, provenance, version, and audit event together in same session', async () => {
      vi.spyOn(connectionModule, 'isReplicaSetSupported').mockReturnValue(true);

      const mockSession = {} as mongoose.ClientSession;
      vi.spyOn(connectionModule, 'runInTransaction').mockImplementation(async (cb) => {
        return cb(mockSession);
      });

      const existingDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 1,
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-a': { 'crit-cost': 50 } },
        scoreProvenance: {},
        ownerId: new mongoose.Types.ObjectId(requester.id),
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(existingDoc as any);
      const updateSpy = vi.spyOn(decisionRepository, 'update').mockImplementation(async (_id, data) => {
        return {
          ...existingDoc,
          ...data,
          version: 2,
        } as any;
      });

      const auditSpy = vi.spyOn(auditService, 'recordEvent').mockResolvedValue({} as any);

      const res = await populateSyntheticDemo(validDecisionId, 75, 1, requester);

      expect(res.version).toBe(2);
      expect(updateSpy).toHaveBeenCalledWith(
        validDecisionId,
        expect.objectContaining({
          version: 2,
          scores: expect.objectContaining({
            'opt-a': { 'crit-cost': 50, 'crit-perf': 75 },
            'opt-b': { 'crit-cost': 75, 'crit-perf': 75 },
          }),
          scoreProvenance: expect.objectContaining({
            'opt-a': {
              'crit-perf': expect.objectContaining({ isSynthetic: true, source: 'demo' }),
            },
          }),
        }),
        1,
        mockSession
      );

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionId: validDecisionId,
          action: 'decision.synthetic_demo_populated',
          diff: expect.objectContaining({ populatedCount: 3, defaultValue: 75 }),
        }),
        mockSession
      );
    });

    it('Duplicate retry protection: If all cells are already scored, operation returns existing document without version increment or audit event', async () => {
      const existingDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 3,
        criteria: baseCriteria,
        options: baseOptions,
        scores: {
          'opt-a': { 'crit-cost': 50, 'crit-perf': 75 },
          'opt-b': { 'crit-cost': 75, 'crit-perf': 75 },
        },
        scoreProvenance: {
          'opt-a': { 'crit-perf': { isSynthetic: true, source: 'demo' } },
          'opt-b': {
            'crit-cost': { isSynthetic: true, source: 'demo' },
            'crit-perf': { isSynthetic: true, source: 'demo' },
          },
        },
        ownerId: new mongoose.Types.ObjectId(requester.id),
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(existingDoc as any);
      const updateSpy = vi.spyOn(decisionRepository, 'update');
      const auditSpy = vi.spyOn(auditService, 'recordEvent');
      const journalSpy = vi.spyOn(operationJournalRepository, 'createEntry');

      const res = await populateSyntheticDemo(validDecisionId, 75, 3, requester);

      // Exactly unchanged
      expect(res.version).toBe(3);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(auditSpy).not.toHaveBeenCalled();
      expect(journalSpy).not.toHaveBeenCalled();
      // Real score 50 is strictly preserved
      expect(res.scores['opt-a']['crit-cost']).toBe(50);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Task 2: Standalone Recovery Guarantees
  // ══════════════════════════════════════════════════════════════════════════
  describe('Task 2: Standalone Recovery Guarantees & Durable Journaling', () => {
    it('Simulated crash between decision update and audit append: durable journal allows reconciliation to complete audit event', async () => {
      const existingDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 1,
        criteria: baseCriteria,
        options: baseOptions,
        scores: {},
        scoreProvenance: {},
        ownerId: new mongoose.Types.ObjectId(requester.id),
      };

      let savedJournal: any = null;
      vi.spyOn(operationJournalRepository, 'createEntry').mockImplementation(async (data: any) => {
        savedJournal = {
          ...data,
          state: 'PENDING',
        };
        return savedJournal;
      });

      let updatedDecisionDoc: any = null;
      vi.spyOn(decisionRepository, 'findById').mockImplementation(async () => {
        return updatedDecisionDoc ?? (existingDoc as any);
      });
      vi.spyOn(decisionRepository, 'update').mockImplementation(async (_id, data: any) => {
        updatedDecisionDoc = {
          ...existingDoc,
          ...data,
        };
        return updatedDecisionDoc;
      });

      // Crash simulation: process crashes during auditService.recordEvent
      vi.spyOn(auditService, 'recordEvent').mockRejectedValue(new Error('Process Crash / Power Loss Simulation'));

      await expect(
        populateSyntheticDemo(validDecisionId, 75, 1, requester)
      ).rejects.toThrow('Process Crash / Power Loss Simulation');

      // 1. Durable evidence was recorded in operation journal
      expect(savedJournal).not.toBeNull();
      expect(savedJournal.operationId).toBeDefined();
      expect(savedJournal.state).toBe('PENDING');
      expect(savedJournal.targetVersion).toBe(2);
      expect(savedJournal.auditDraft.eventId).toBeDefined();

      // 2. Decision update committed with pending_reconciliation and pendingOperationId
      expect(updatedDecisionDoc.isAudited).toBe(false);
      expect(updatedDecisionDoc.auditIntegrityStatus).toBe('pending_reconciliation');
      expect(updatedDecisionDoc.pendingOperationId).toBe(savedJournal.operationId);
      expect(updatedDecisionDoc.version).toBe(2);

      // Now, simulate the standalone recovery worker running reconcileStandaloneAudit
      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(updatedDecisionDoc);
      vi.spyOn(operationJournalRepository, 'findByOperationId').mockResolvedValue(savedJournal);

      const decisionUpdateOneSpy = vi.spyOn(DecisionModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      } as any);

      const journalUpdateOneSpy = vi.spyOn(OperationJournalModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      } as any);

      const recordEventSuccessSpy = vi.spyOn(auditService, 'recordEvent').mockResolvedValue({} as any);

      // Recovery pass runs
      await reconcileStandaloneAudit(validDecisionId, savedJournal.operationId);

      // Proves audit event was appended with deterministic eventId
      expect(recordEventSuccessSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionId: validDecisionId,
          eventId: savedJournal.auditDraft.eventId,
          action: 'decision.synthetic_demo_populated',
        })
      );

      // Decision is finalized to healthy and audited
      expect(decisionUpdateOneSpy).toHaveBeenCalledWith(
        { _id: validDecisionId, version: 2 },
        {
          $set: {
            pendingOperationId: null,
            auditIntegrityStatus: 'healthy',
            isAudited: true,
          },
        }
      );

      // Journal state is marked COMPLETED
      expect(journalUpdateOneSpy).toHaveBeenCalledWith(
        { operationId: savedJournal.operationId },
        { $set: { state: 'COMPLETED' } }
      );
    });

    it('Crash after partial recovery: duplicate audit events prevented via deterministic eventId', async () => {
      const opId = 'op-partial-crash-123';
      const deterministicEventId = 'audit-deterministic-event-xyz';

      const journalEntry = {
        operationId: opId,
        decisionId: new mongoose.Types.ObjectId(validDecisionId),
        action: 'decision.synthetic_score_replaced',
        actor: requester,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
        auditDraft: {
          eventId: deterministicEventId,
          entityType: 'decision',
          entityId: validDecisionId,
          summary: 'Replaced score with 88',
          diff: { score: 88 },
        },
      };

      const decisionDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 2,
        isAudited: false,
        auditIntegrityStatus: 'pending_reconciliation',
        pendingOperationId: opId,
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(decisionDoc as any);
      vi.spyOn(operationJournalRepository, 'findByOperationId').mockResolvedValue(journalEntry as any);

      // Pass 1: recordEvent succeeded, but decision update crashed
      const recordEventSpy = vi.spyOn(auditService, 'recordEvent').mockResolvedValue({
        eventId: deterministicEventId,
      } as any);

      vi.spyOn(DecisionModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      } as any);
      vi.spyOn(OperationJournalModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      } as any);

      await reconcileStandaloneAudit(validDecisionId, opId);
      expect(recordEventSpy).toHaveBeenCalledTimes(1);

      // Pass 2: Repeated recovery pass runs again
      await reconcileStandaloneAudit(validDecisionId, opId);

      // The exact same eventId was supplied both times, guaranteeing idempotency
      expect(recordEventSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventId: deterministicEventId,
        })
      );
    });

    it('Safe abort prior to decision update: if crash occurred before version advanced, journal is marked REVERTED and decision remains healthy', async () => {
      const opId = 'op-aborted-before-mutation';
      const journalEntry = {
        operationId: opId,
        decisionId: new mongoose.Types.ObjectId(validDecisionId),
        action: 'decision.synthetic_demo_populated',
        actor: requester,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
      };

      // Decision is still at version 1 (mutation never happened before crash)
      const decisionDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 1,
        isAudited: true,
        auditIntegrityStatus: 'healthy',
        pendingOperationId: null,
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(decisionDoc as any);
      vi.spyOn(operationJournalRepository, 'findByOperationId').mockResolvedValue(journalEntry as any);

      const journalUpdateSpy = vi.spyOn(OperationJournalModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      } as any);

      const auditSpy = vi.spyOn(auditService, 'recordEvent');

      await reconcileStandaloneAudit(validDecisionId, opId);

      // Safely marked REVERTED
      expect(journalUpdateSpy).toHaveBeenCalledWith(
        { operationId: opId },
        expect.objectContaining({
          $set: expect.objectContaining({ state: 'REVERTED' }),
        })
      );
      // No spurious audit event was recorded
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it('Reconciliation failure: Missing journal quarantines decision', async () => {
      const decisionDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 2,
        isAudited: false,
        auditIntegrityStatus: 'pending_reconciliation',
        pendingOperationId: 'non-existent-journal-id',
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(decisionDoc as any);
      vi.spyOn(operationJournalRepository, 'findByOperationId').mockResolvedValue(null);

      const decisionUpdateSpy = vi.spyOn(DecisionModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      } as any);

      await expect(
        reconcileStandaloneAudit(validDecisionId, 'non-existent-journal-id')
      ).rejects.toThrow(DecisionQuarantinedError);

      expect(decisionUpdateSpy).toHaveBeenCalledWith(
        { _id: validDecisionId },
        {
          $set: expect.objectContaining({
            auditIntegrityStatus: 'quarantined',
            isAudited: false,
          }),
        }
      );
    });

    it('Reconciliation failure: Unresolvable version desynchronization marks decision quarantined and journal UNRECOVERABLE', async () => {
      const opId = 'op-desync-456';
      const journalEntry = {
        operationId: opId,
        decisionId: new mongoose.Types.ObjectId(validDecisionId),
        action: 'decision.synthetic_demo_populated',
        actor: requester,
        expectedVersion: 1,
        targetVersion: 2,
        state: 'PENDING',
      };

      // Corrupted state: version jumped to 999
      const decisionDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 999,
        isAudited: false,
        auditIntegrityStatus: 'pending_reconciliation',
        pendingOperationId: opId,
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(decisionDoc as any);
      vi.spyOn(operationJournalRepository, 'findByOperationId').mockResolvedValue(journalEntry as any);

      const journalUpdateSpy = vi.spyOn(OperationJournalModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      } as any);

      const decisionUpdateSpy = vi.spyOn(DecisionModel, 'updateOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      } as any);

      await expect(
        reconcileStandaloneAudit(validDecisionId, opId)
      ).rejects.toThrow(DecisionQuarantinedError);

      expect(journalUpdateSpy).toHaveBeenCalledWith(
        { operationId: opId },
        expect.objectContaining({
          $set: expect.objectContaining({ state: 'UNRECOVERABLE' }),
        })
      );

      expect(decisionUpdateSpy).toHaveBeenCalledWith(
        { _id: validDecisionId },
        expect.objectContaining({
          $set: expect.objectContaining({
            auditIntegrityStatus: 'quarantined',
            isAudited: false,
          }),
        })
      );
    });

    it('Fail-closed persistence invariant: Disconnected MongoDB aborts standalone populateSyntheticDemo before decision update can proceed', async () => {
      vi.restoreAllMocks();
      vi.spyOn(connectionModule, 'isReplicaSetSupported').mockReturnValue(false);
      expect(mongoose.connection.readyState).not.toBe(1);

      const existingDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 1,
        criteria: baseCriteria,
        options: baseOptions,
        scores: {},
        scoreProvenance: {},
        ownerId: new mongoose.Types.ObjectId(requester.id),
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(existingDoc as any);
      const updateSpy = vi.spyOn(decisionRepository, 'update');

      await expect(
        populateSyntheticDemo(validDecisionId, 75, 1, requester)
      ).rejects.toThrow(/Cannot persist operation journal entry: database is not connected/);

      // Crucial durability invariant: decision update was NEVER called!
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('Fail-closed persistence invariant: Disconnected MongoDB aborts standalone replaceSyntheticScore before decision update can proceed', async () => {
      vi.restoreAllMocks();
      vi.spyOn(connectionModule, 'isReplicaSetSupported').mockReturnValue(false);
      expect(mongoose.connection.readyState).not.toBe(1);

      const existingDoc = {
        _id: new mongoose.Types.ObjectId(validDecisionId),
        version: 1,
        criteria: baseCriteria,
        options: baseOptions,
        scores: { 'opt-a': { 'crit-cost': 75 } },
        scoreProvenance: {
          'opt-a': { 'crit-cost': { isSynthetic: true, source: 'demo' } },
        },
        ownerId: new mongoose.Types.ObjectId(requester.id),
      };

      vi.spyOn(decisionRepository, 'findById').mockResolvedValue(existingDoc as any);
      const updateSpy = vi.spyOn(decisionRepository, 'update');

      await expect(
        replaceSyntheticScore(
          validDecisionId,
          {
            optionId: 'opt-a',
            criterionId: 'crit-cost',
            score: 85,
          },
          requester
        )
      ).rejects.toThrow(/Cannot persist operation journal entry: database is not connected/);

      // Decision update was NEVER called
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
