import {
  operationJournalRepository,
} from '../repositories/operationJournal.repository.js';
import {
  DecisionModel,
  OperationJournalModel,
  type OperationJournalDocument,
  type OperationState,
  type DecisionDocument,
  type DecisionCriterion,
  type DecisionOption,
  type ScoreMatrix,
} from '../models/index.js';
import { DecisionContributionModel } from '../models/contribution.model.js';
import { auditService } from './audit.service.js';
import { evaluationCache } from './evaluationCache.js';
import {
  evaluateDecision,
} from '@decision-os/decision-engine';
import {
  mapToEngineInput,
  validateCompleteness,
} from './decision.service.js';
import {
  ConcurrencyFencingError,
} from '../errors/domain.errors.js';
import { runInTransaction, isReplicaSetSupported } from '../db/connection.js';
import type mongoose from 'mongoose';

export interface HeartbeatHandle {
  stop: () => void;
}

export function startHeartbeat(
  operationId: string,
  workerId: string,
  fencingToken: number,
  decisionId?: string,
  intervalMs: number = 10000,
  leaseDurationMs: number = 30000
): HeartbeatHandle {
  const timer = setInterval(async () => {
    try {
      const renewed = await operationJournalRepository.renewOperationLease(
        operationId,
        workerId,
        fencingToken,
        leaseDurationMs,
        decisionId
      );
      if (!renewed) {
        clearInterval(timer);
      }
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}

/**
 * Executes a strictly monotonic compensating rollback on a decision.
 * Advances version to failedVersion + 1, restores previous snapshot, invalidates cache,
 * appends compensation audit event, and finalizes decision state.
 */
export async function executeCompensatingRollback(
  decisionId: string,
  failedVersion: number,
  previousSnapshot: Record<string, unknown>,
  operationId: string,
  fencingToken: number,
  workerId: string
): Promise<DecisionDocument> {
  // 0. Verify fencing token and lease against operation journal
  if (operationId) {
    const journal = await OperationJournalModel.findOne({ operationId }).exec();
    if (journal) {
      if (journal.fencingToken > fencingToken) {
        throw new ConcurrencyFencingError(
          `Fencing token mismatch on compensating decision write for operation ${operationId}: current token is ${journal.fencingToken}, caller provided token ${fencingToken}`
        );
      }
      if (journal.recoveryOwner && journal.recoveryOwner !== workerId) {
        throw new ConcurrencyFencingError(
          `Fencing ownership mismatch on compensating decision write for operation ${operationId}: owned by ${journal.recoveryOwner}, caller is ${workerId}`
        );
      }
      if (journal.recoveryOwner && journal.leaseExpiresAt && journal.leaseExpiresAt.getTime() < Date.now()) {
        throw new ConcurrencyFencingError(
          `Recovery lease expired for operation ${operationId} (worker: ${workerId}, fencingToken: ${fencingToken})`
        );
      }
    }
  }

  const compensatingVersion = failedVersion + 1;

  const decisionFilter: Record<string, unknown> = {
    _id: decisionId,
    version: failedVersion,
    pendingOperationId: operationId,
  };

  if (fencingToken > 0) {
    decisionFilter.$or = [
      { recoveryFencingToken: fencingToken, recoveryOwner: workerId },
      { recoveryFencingToken: { $lte: fencingToken }, recoveryOwner: null },
      { recoveryFencingToken: null },
      { recoveryFencingToken: { $exists: false } },
    ];
  }

  const executeAtomicReversion = async (session?: mongoose.ClientSession): Promise<DecisionDocument> => {
    const revertedDoc = await DecisionModel.findOneAndUpdate(
      decisionFilter,
      {
        $set: {
          scores: previousSnapshot.scores,
          criteria: previousSnapshot.criteria,
          options: previousSnapshot.options,
          version: compensatingVersion,
          recoveryFencingToken: fencingToken > 0 ? fencingToken : 0,
          recoveryOwner: fencingToken > 0 ? workerId : null,
          analysis: null, // Clear stale evaluation
          isAudited: false, // Remains un-audited until compensation event is confirmed
        },
      },
      { new: true, session }
    ).exec();

    if (!revertedDoc) {
      throw new ConcurrencyFencingError(
        `Failed to execute compensation: decision ${decisionId} version mismatch or worker ${workerId} fencing token ${fencingToken} superseded`
      );
    }

    // Append Compensation Audit Event within the same transaction
    await auditService.recordEvent({
      decisionId,
      action: 'decision.updated',
      entityType: 'decision',
      entityId: decisionId,
      actor: { id: 'system', role: 'admin', name: `System Recovery Worker (${workerId})` },
      summary: `Compensating rollback to restore baseline inputs following failed operation ${operationId}`,
      diff: {
        before: { version: failedVersion },
        after: {
          version: compensatingVersion,
          isCompensated: true,
          restoredVersion: previousSnapshot.version,
        },
      },
    }, session);

    // Finalize Decision
    const finalizeFilter: Record<string, unknown> = {
      _id: decisionId,
      version: compensatingVersion,
    };
    if (fencingToken > 0) {
      finalizeFilter.$or = [
        { recoveryFencingToken: fencingToken, recoveryOwner: workerId },
        { recoveryFencingToken: { $lte: fencingToken }, recoveryOwner: null },
        { recoveryFencingToken: null },
        { recoveryFencingToken: { $exists: false } },
      ];
    }

    const finalizeRes = await DecisionModel.updateOne(
      finalizeFilter,
      {
        $set: {
          isAudited: true,
          pendingOperationId: null,
          recoveryOwner: null,
          recoveryLeaseExpiresAt: null,
        },
      },
      { session }
    ).exec();

    if (fencingToken > 0 && finalizeRes.matchedCount === 0) {
      throw new ConcurrencyFencingError(
        `Fencing violation: Worker ${workerId} with token ${fencingToken} lost lease while finalizing compensation for decision ${decisionId}`
      );
    }

    return revertedDoc;
  };

  let finalDoc: DecisionDocument;
  if (isReplicaSetSupported()) {
    finalDoc = await runInTransaction(async (session) => {
      return executeAtomicReversion(session);
    });
  } else {
    finalDoc = await executeAtomicReversion();
  }

  // Invalidate evaluation cache
  evaluationCache.invalidate(decisionId);

  return finalDoc;
}

export class RecoveryWorkerService {
  /**
   * Reconciles a single claimed operation journal entry across all recovery states.
   * Verifies fencing token on every journal state transition and decision write.
   */
  async reconcileOperation(
    journal: OperationJournalDocument,
    workerId: string
  ): Promise<'completed' | 'reverted' | 'unrecoverable'> {
    const { operationId, decisionId, fencingToken } = journal;

    // Verify worker ownership and current fencing generation against persisted state
    const currentJournal = await OperationJournalModel.findOne({ operationId }).exec();
    if (currentJournal) {
      if (
        currentJournal.fencingToken > fencingToken ||
        (currentJournal.recoveryOwner && currentJournal.recoveryOwner !== workerId)
      ) {
        throw new ConcurrencyFencingError(
          `Fencing violation: Worker ${workerId} with token ${fencingToken} is superseded (current token: ${currentJournal.fencingToken}, owner: ${currentJournal.recoveryOwner})`
        );
      }
    }

    const heartbeat = startHeartbeat(operationId, workerId, fencingToken, decisionId.toString());

    try {
      let currentState: OperationState = journal.state;

      // ─── Step 1: PENDING ──────────────────────────────────────────────────
      if (currentState === 'PENDING') {
        const decision = await DecisionModel.findById(decisionId).exec();
        if (!decision) {
          await this.markQuarantined(journal, workerId, 'Referenced decision not found');
          return 'unrecoverable';
        }

        if (decision.version === journal.expectedVersion) {
          // Mutation never reached database before crash -> Safe abort
          await operationJournalRepository.transitionJournalState(
            operationId,
            workerId,
            fencingToken,
            'PENDING',
            'REVERTED',
            { errorDetails: 'Operation aborted prior to decision mutation' }
          );
          return 'reverted';
        } else if (
          decision.version === journal.targetVersion &&
          decision.pendingOperationId === operationId
        ) {
          // Mutation committed before crash -> Roll forward
          await operationJournalRepository.transitionJournalState(
            operationId,
            workerId,
            fencingToken,
            'PENDING',
            'DECISION_MUTATED'
          );
          currentState = 'DECISION_MUTATED';
        } else {
          // Unresolvable version discrepancy
          await this.markQuarantined(
            journal,
            workerId,
            `Version desynchronization: decision version ${decision.version} does not match expected ${journal.expectedVersion} or target ${journal.targetVersion}`
          );
          return 'unrecoverable';
        }
      }

      // ─── Step 2: DECISION_MUTATED ─────────────────────────────────────────
      if (currentState === 'DECISION_MUTATED') {
        const decision = await DecisionModel.findById(decisionId).exec();
        if (!decision) {
          await this.markQuarantined(journal, workerId, 'Referenced decision not found');
          return 'unrecoverable';
        }

        const criteria = decision.criteria as DecisionCriterion[];
        const options = decision.options as DecisionOption[];
        const scores = decision.scores as ScoreMatrix;

        let evalResult = null;
        let evalError = null;

        if (criteria.length > 0 && options.length > 0 && validateCompleteness(criteria, options, scores).length === 0) {
          try {
            const input = mapToEngineInput(criteria, options, scores);
            evalResult = evaluateDecision(input);
          } catch (err) {
            evalError = err;
          }
        }

        if (evalError) {
          // Engine evaluation failed -> Monotonic compensation to targetVersion + 1
          await operationJournalRepository.transitionJournalState(
            operationId,
            workerId,
            fencingToken,
            'DECISION_MUTATED',
            'COMPENSATING',
            { compensatingVersion: journal.targetVersion + 1 }
          );
          currentState = 'COMPENSATING';
        } else {
          // Engine evaluation succeeded -> Update decision analysis with atomic fencing check
          const updateRes = await DecisionModel.updateOne(
            {
              _id: decisionId,
              version: journal.targetVersion,
              pendingOperationId: operationId,
              $or: [
                { recoveryFencingToken: fencingToken, recoveryOwner: workerId },
                { recoveryFencingToken: { $lte: fencingToken }, recoveryOwner: null },
                { recoveryFencingToken: null },
                { recoveryFencingToken: { $exists: false } },
              ],
            },
            {
              $set: {
                analysis: evalResult,
                recoveryFencingToken: fencingToken,
                recoveryOwner: workerId,
              },
            }
          ).exec();

          if (updateRes.matchedCount === 0) {
            throw new ConcurrencyFencingError(
              `Fencing violation: Worker ${workerId} with token ${fencingToken} lost lease while updating analysis for decision ${decisionId}`
            );
          }

          await operationJournalRepository.transitionJournalState(
            operationId,
            workerId,
            fencingToken,
            'DECISION_MUTATED',
            'EVALUATED'
          );
          currentState = 'EVALUATED';
        }
      }

      // ─── Step 3: EVALUATED ────────────────────────────────────────────────
      if (currentState === 'EVALUATED') {
        if (journal.action === 'contribution.adopted' && journal.auditDraft?.entityId) {
          await DecisionContributionModel.updateOne(
            { _id: journal.auditDraft.entityId, status: 'submitted' },
            {
              $set: {
                status: 'adopted',
                adoptedAt: new Date(),
                adoptedBy: journal.actor.id,
                adoptedOptionId: journal.payload.preferredOptionId as string,
              },
            }
          ).exec();
        }

        await operationJournalRepository.transitionJournalState(
          operationId,
          workerId,
          fencingToken,
          'EVALUATED',
          'ENTITIES_UPDATED'
        );
        currentState = 'ENTITIES_UPDATED';
      }

      // ─── Step 4: ENTITIES_UPDATED ─────────────────────────────────────────
      if (currentState === 'ENTITIES_UPDATED') {
        await auditService.recordEvent({
          decisionId: decisionId.toString(),
          actor: journal.actor,
          action: journal.action,
          entityType: journal.auditDraft.entityType as any,
          entityId: journal.auditDraft.entityId,
          summary: journal.auditDraft.summary,
          diff: journal.auditDraft.diff,
          eventId: journal.auditDraft.eventId,
        });

        await operationJournalRepository.transitionJournalState(
          operationId,
          workerId,
          fencingToken,
          'ENTITIES_UPDATED',
          'AUDITED'
        );
        currentState = 'AUDITED';
      }

      // ─── Step 5: AUDITED ──────────────────────────────────────────────────
      if (currentState === 'AUDITED') {
        const finalizeRes = await DecisionModel.updateOne(
          {
            _id: decisionId,
            version: journal.targetVersion,
            $or: [
              { recoveryFencingToken: fencingToken, recoveryOwner: workerId },
              { recoveryFencingToken: { $lte: fencingToken }, recoveryOwner: null },
              { recoveryFencingToken: null },
              { recoveryFencingToken: { $exists: false } },
            ],
          },
          {
            $set: {
              pendingOperationId: null,
              isAudited: true,
              auditIntegrityStatus: 'healthy',
              recoveryOwner: null,
              recoveryLeaseExpiresAt: null,
            },
          }
        ).exec();

        if (finalizeRes.matchedCount === 0) {
          throw new ConcurrencyFencingError(
            `Fencing violation: Worker ${workerId} with token ${fencingToken} lost lease while finalizing decision ${decisionId}`
          );
        }

        await operationJournalRepository.transitionJournalState(
          operationId,
          workerId,
          fencingToken,
          'AUDITED',
          'COMPLETED'
        );
        return 'completed';
      }

      // ─── Step 6: COMPENSATING ─────────────────────────────────────────────
      if (currentState === 'COMPENSATING') {
        const decision = await DecisionModel.findById(decisionId).exec();
        const compensatingVersion = journal.targetVersion + 1;

        if (decision && decision.version === journal.targetVersion) {
          await executeCompensatingRollback(
            decisionId.toString(),
            journal.targetVersion,
            journal.previousSnapshot,
            operationId,
            fencingToken,
            workerId
          );
        } else if (decision && decision.version === compensatingVersion) {
          // Compensating write already succeeded; ensure audit event is recorded and pendingOperationId cleared
          const compFinalizeRes = await DecisionModel.updateOne(
            {
              _id: decisionId,
              version: compensatingVersion,
              $or: [
                { recoveryFencingToken: fencingToken, recoveryOwner: workerId },
                { recoveryFencingToken: { $lte: fencingToken }, recoveryOwner: null },
                { recoveryFencingToken: null },
                { recoveryFencingToken: { $exists: false } },
              ],
            },
            {
              $set: {
                pendingOperationId: null,
                isAudited: true,
                recoveryOwner: null,
                recoveryLeaseExpiresAt: null,
              },
            }
          ).exec();

          if (compFinalizeRes.matchedCount === 0) {
            throw new ConcurrencyFencingError(
              `Fencing violation: Worker ${workerId} with token ${fencingToken} lost lease while finalizing compensated decision ${decisionId}`
            );
          }
        }

        await operationJournalRepository.transitionJournalState(
          operationId,
          workerId,
          fencingToken,
          'COMPENSATING',
          'REVERTED'
        );
        return 'reverted';
      }

      return 'completed';
    } catch (err: unknown) {
      if (journal.retryCount >= 4) {
        await this.markQuarantined(
          journal,
          workerId,
          err instanceof Error ? err.message : String(err)
        );
        return 'unrecoverable';
      }
      throw err;
    } finally {
      heartbeat.stop();
    }
  }

  /**
   * Quarantines a decision when recovery fails unrecoverably.
   */
  private async markQuarantined(
    journal: OperationJournalDocument,
    workerId: string,
    reason: string
  ): Promise<void> {
    await operationJournalRepository.markUnrecoverable(
      journal.operationId,
      `Quarantined by worker ${workerId}: ${reason}`
    );

    await DecisionModel.updateOne(
      {
        _id: journal.decisionId,
        recoveryFencingToken: journal.fencingToken,
        recoveryOwner: workerId,
      },
      {
        $set: {
          auditIntegrityStatus: 'quarantined',
          quarantineReason: `Unrecoverable operation recovery failure: ${reason}`,
          isAudited: false,
          pendingOperationId: null,
          recoveryOwner: null,
          recoveryLeaseExpiresAt: null,
        },
      }
    ).exec();
  }

  /**
   * Polls and recovers all outstanding journal entries until no more are claimable.
   */
  async runRecoveryPass(workerId: string): Promise<number> {
    let recoveredCount = 0;
    while (true) {
      const claim = await operationJournalRepository.claimJournalOperation(workerId);
      if (!claim) {
        break;
      }
      await this.reconcileOperation(claim, workerId);
      recoveredCount++;
    }
    return recoveredCount;
  }
}

export const recoveryWorkerService = new RecoveryWorkerService();
