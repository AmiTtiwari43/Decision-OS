import mongoose, { type Types } from 'mongoose';
import {
  OperationJournalModel,
  DecisionModel,
  type OperationJournalDocument,
  type OperationState,
  type IOperationJournal,
} from '../models/index.js';
import { ConcurrencyFencingError } from '../errors/domain.errors.js';
import { runInTransaction } from '../db/connection.js';

export const NON_TERMINAL_OPERATION_STATES: OperationState[] = [
  'PENDING',
  'DECISION_MUTATED',
  'EVALUATED',
  'ENTITIES_UPDATED',
  'AUDITED',
  'COMPENSATING',
];

/**
 * Safely aborts a caller-provided or active MongoDB ClientSession transaction on failure.
 * Guarantees that any partially staged operations (e.g. journal writes) cannot be committed
 * by callers that catch errors and proceed to commit.
 */
async function abortTransactionIfActive(
  session?: mongoose.ClientSession,
  cause?: unknown
): Promise<void> {
  if (session && session.inTransaction()) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      if (cause instanceof Error) {
        throw new Error(
          `Failed to abort transaction (${abortErr instanceof Error ? abortErr.message : String(abortErr)}) after fencing failure: ${cause.message}`,
          { cause: abortErr }
        );
      }
      throw abortErr;
    }
  }
}

/**
 * Validates that lease duration is a finite, positive, bounded integer.
 * Default: 30,000ms. Min: 1,000ms. Max: 300,000ms (5 minutes).
 */
export function validateLeaseDuration(
  durationMs: unknown,
  defaultMs = 30000,
  minMs = 1000,
  maxMs = 300000
): number {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return defaultMs;
  }
  return Math.max(minMs, Math.min(Math.floor(durationMs), maxMs));
}

export class OperationJournalRepository {
  /**
   * Creates a new pending operation journal entry.
   */
  async createEntry(data: {
    operationId: string;
    decisionId: Types.ObjectId | string;
    action: IOperationJournal['action'];
    actor: IOperationJournal['actor'];
    expectedVersion: number;
    targetVersion: number;
    payload: Record<string, unknown>;
    previousSnapshot: Record<string, unknown>;
    auditDraft: IOperationJournal['auditDraft'];
  }): Promise<OperationJournalDocument> {
    const doc = new OperationJournalModel({
      ...data,
      decisionId: new mongoose.Types.ObjectId(data.decisionId),
      state: 'PENDING',
      recoveryOwner: null,
      leaseExpiresAt: null,
      fencingToken: 0,
      heartbeatAt: new Date(),
      retryCount: 0,
    });
    return doc.save();
  }

  /**
   * Finds a journal entry by operationId.
   */
  async findByOperationId(operationId: string): Promise<OperationJournalDocument | null> {
    return OperationJournalModel.findOne({ operationId }).exec();
  }

  /**
   * Finds any active/incomplete operations for a decision.
   */
  async findActiveByDecisionId(decisionId: string): Promise<OperationJournalDocument | null> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return null;
    }
    return OperationJournalModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      state: { $in: NON_TERMINAL_OPERATION_STATES },
    }).exec();
  }

  /**
   * Atomically claims an unleased or expired operation journal entry using MongoDB server-derived time.
   * Monotonically increments fencingToken and retryCount.
   */
  async claimJournalOperation(
    workerId: string,
    leaseDurationMs: number = 30000,
    operationId?: string,
    existingSession?: mongoose.ClientSession
  ): Promise<OperationJournalDocument | null> {
    const validDuration = validateLeaseDuration(leaseDurationMs);

    const executeClaim = async (session?: mongoose.ClientSession) => {
      const query: Record<string, unknown> = {
        state: { $in: NON_TERMINAL_OPERATION_STATES },
        $or: [
          { recoveryOwner: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $exists: false } },
          { $expr: { $lt: ['$leaseExpiresAt', '$$NOW'] } },
        ],
        retryCount: { $lt: 5 },
      };

      if (operationId) {
        query.operationId = operationId;
      }

      // MongoDB server-time update pipeline: $$NOW and $dateAdd
      const claimed = await OperationJournalModel.findOneAndUpdate(
        query,
        [
          {
            $set: {
              recoveryOwner: workerId,
              heartbeatAt: '$$NOW',
              leaseExpiresAt: {
                $dateAdd: {
                  startDate: '$$NOW',
                  unit: 'millisecond',
                  amount: validDuration,
                },
              },
              fencingToken: { $add: [{ $ifNull: ['$fencingToken', 0] }, 1] },
              retryCount: { $add: [{ $ifNull: ['$retryCount', 0] }, 1] },
            },
          },
        ],
        {
          returnDocument: 'after',
          sort: { createdAt: 1 }, // FIFO oldest first
          session,
          updatePipeline: true,
        }
      ).exec();

      if (!claimed) {
        return null;
      }

      // Bind ownership and exact server-derived lease timestamp to the Decision document.
      // In a transaction, this guarantees journal claim and decision lease binding are atomic.
      const bound = await this.bindDecisionLease(
        claimed.decisionId.toString(),
        workerId,
        claimed.fencingToken,
        claimed.leaseExpiresAt!,
        session
      );

      if (!bound) {
        throw new ConcurrencyFencingError(
          `Failed to bind decision lease for decision ${claimed.decisionId} to worker ${workerId}`
        );
      }

      return claimed;
    };

    if (existingSession) {
      if (existingSession.hasEnded || !existingSession.inTransaction()) {
        throw new ConcurrencyFencingError(
          `Journal claim failed: provided session is invalid, ended, or not in an active transaction`
        );
      }
      try {
        return await executeClaim(existingSession);
      } catch (err) {
        await abortTransactionIfActive(existingSession, err);
        throw err;
      }
    }

    try {
      return await runInTransaction(async (session) => {
        return executeClaim(session);
      });
    } catch (err) {
      if (err instanceof ConcurrencyFencingError) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Durably binds the recovery lease and advances recoveryFencingToken on DecisionModel.
   * Guarantees that any prior worker holding an older fencing token is instantly fenced out.
   */
  async bindDecisionLease(
    decisionId: string,
    workerId: string,
    fencingToken: number,
    leaseExpiration: Date,
    session?: mongoose.ClientSession
  ): Promise<boolean> {
    const result = await DecisionModel.updateOne(
      {
        _id: decisionId,
        auditIntegrityStatus: { $ne: 'quarantined' },
        $or: [
          { recoveryFencingToken: { $lt: fencingToken } },
          { recoveryFencingToken: null },
          { recoveryFencingToken: { $exists: false } },
        ],
      },
      {
        $set: {
          recoveryFencingToken: fencingToken,
          recoveryOwner: workerId,
          recoveryLeaseExpiresAt: leaseExpiration,
        },
      },
      { session }
    ).exec();

    return result.matchedCount === 1;
  }

  /**
   * Renews the recovery lease during active processing using server-side time ($$NOW + $dateAdd).
   * Conditional on { operationId, recoveryOwner: workerId, fencingToken }.
   *
   * Transaction Contract:
   * When caller provides an existing ClientSession, failures throw ConcurrencyFencingError
   * to guarantee the caller's transaction is aborted and partial state is never committed.
   * When internally managed, catches the error and returns false.
   */
  async renewOperationLease(
    operationId: string,
    workerId: string,
    fencingToken: number,
    leaseDurationMs: number = 30000,
    decisionId?: string,
    session?: mongoose.ClientSession
  ): Promise<boolean> {
    const validDuration = validateLeaseDuration(leaseDurationMs);

    const executeRenew = async (sess?: mongoose.ClientSession): Promise<boolean> => {
      // CRITICAL (F2): A heartbeat must NEVER resurrect an expired lease.
      // Strict database-time server check $$NOW and matching owner + fencingToken.
      const journalDoc = await OperationJournalModel.findOneAndUpdate(
        {
          operationId,
          recoveryOwner: workerId,
          fencingToken, // Strict fencing token match
          $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
        },
        [
          {
            $set: {
              heartbeatAt: '$$NOW',
              leaseExpiresAt: {
                $dateAdd: {
                  startDate: '$$NOW',
                  unit: 'millisecond',
                  amount: validDuration,
                },
              },
            },
          },
        ],
        {
          returnDocument: 'after',
          session: sess,
          updatePipeline: true,
        }
      ).exec();

      if (!journalDoc) {
        if (session) {
          throw new ConcurrencyFencingError(
            `Lease renewal failed for operation ${operationId}: journal lease expired or superseded`
          );
        }
        return false;
      }

      if (decisionId) {
        const decRes = await DecisionModel.updateOne(
          {
            _id: decisionId,
            recoveryOwner: workerId,
            recoveryFencingToken: fencingToken,
            auditIntegrityStatus: { $ne: 'quarantined' },
            $expr: { $gt: ['$recoveryLeaseExpiresAt', '$$NOW'] },
          },
          {
            $set: {
              recoveryLeaseExpiresAt: journalDoc.leaseExpiresAt,
            },
          },
          { session: sess }
        ).exec();

        if (decRes.matchedCount === 0) {
          if (session) {
            throw new ConcurrencyFencingError(
              `Lease renewal failed for decision ${decisionId}: decision quarantined or lease expired`
            );
          }
          return false;
        }
      }

      return true;
    };

    if (session) {
      if (session.hasEnded || !session.inTransaction()) {
        throw new ConcurrencyFencingError(
          `Lease renewal failed for operation ${operationId}: provided session is invalid, ended, or not in an active transaction`
        );
      }
      try {
        return await executeRenew(session);
      } catch (err) {
        await abortTransactionIfActive(session, err);
        throw err;
      }
    }

    try {
      return await runInTransaction(async (txSession) => {
        const ok = await executeRenew(txSession);
        if (!ok) {
          throw new ConcurrencyFencingError(`Lease renewal failed for operation ${operationId}`);
        }
        return true;
      });
    } catch (err: unknown) {
      if (err instanceof ConcurrencyFencingError) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Performs a fenced state transition on the operation journal.
   * Guaranteed to fail with ConcurrencyFencingError if worker's lease or token is invalid.
   */
  async transitionJournalState(
    operationId: string,
    workerId: string,
    fencingToken: number,
    fromState: OperationState | OperationState[],
    toState: OperationState,
    extraFields: Record<string, unknown> = {},
    session?: mongoose.ClientSession
  ): Promise<void> {
    const stateCondition = Array.isArray(fromState)
      ? { $in: fromState }
      : fromState;

    try {
      const result = await OperationJournalModel.updateOne(
        {
          operationId,
          recoveryOwner: workerId,
          fencingToken, // Guarantees this worker still holds the valid lease
          state: stateCondition,
          $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] }, // Database-time lease validity
        },
        [
          {
            $set: {
              state: toState,
              heartbeatAt: '$$NOW',
              ...extraFields,
            },
          },
        ],
        { session, updatePipeline: true }
      ).exec();

      if (result.matchedCount === 0) {
        const err = new ConcurrencyFencingError(
          `Fencing violation: Worker ${workerId} with token ${fencingToken} lost lease or state mismatch for operation ${operationId}`
        );
        if (session) {
          await abortTransactionIfActive(session, err);
        }
        throw err;
      }
    } catch (err) {
      if (session) {
        await abortTransactionIfActive(session, err);
      }
      throw err;
    }
  }

  /**
   * Transitions an operation directly to UNRECOVERABLE if retry count exceeds 5.
   */
  async markUnrecoverable(
    operationId: string,
    errorDetails: string,
    session?: mongoose.ClientSession
  ): Promise<void> {
    await OperationJournalModel.updateOne(
      { operationId },
      {
        $set: {
          state: 'UNRECOVERABLE',
          errorDetails,
          heartbeatAt: new Date(),
        },
      },
      { session }
    ).exec();
  }
}

export const operationJournalRepository = new OperationJournalRepository();
