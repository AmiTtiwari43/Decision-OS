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
   * Atomically claims an unleased or expired operation journal entry.
   * Monotonically increments fencingToken and retryCount.
   */
  async claimJournalOperation(
    workerId: string,
    leaseDurationMs: number = 30000,
    operationId?: string,
    existingSession?: mongoose.ClientSession
  ): Promise<OperationJournalDocument | null> {
    const executeClaim = async (session?: mongoose.ClientSession) => {
      const now = new Date();
      const leaseExpiration = new Date(now.getTime() + leaseDurationMs);

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

      const claimed = await OperationJournalModel.findOneAndUpdate(
        query,
        {
          $set: {
            recoveryOwner: workerId,
            leaseExpiresAt: leaseExpiration,
            heartbeatAt: now,
          },
          $inc: {
            fencingToken: 1, // Monotonically increasing generation number
            retryCount: 1,
          },
        },
        {
          new: true,
          sort: { createdAt: 1 }, // FIFO oldest first
          session,
        }
      ).exec();

      if (!claimed) {
        return null;
      }

      // Immediately bind ownership and fencing generation to the Decision document.
      // In a transaction, this guarantees journal claim and decision lease binding are atomic.
      const bound = await this.bindDecisionLease(
        claimed.decisionId.toString(),
        workerId,
        claimed.fencingToken,
        leaseExpiration,
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
      return executeClaim(existingSession);
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
   * Renews the recovery lease during active processing.
   * Conditional on { operationId, recoveryOwner: workerId, fencingToken }.
   * Returns false if lease was lost or token was superseded.
   */
  async renewOperationLease(
    operationId: string,
    workerId: string,
    fencingToken: number,
    leaseDurationMs: number = 30000,
    decisionId?: string,
    session?: mongoose.ClientSession
  ): Promise<boolean> {
    const newExpiration = new Date(Date.now() + leaseDurationMs);

    const executeRenew = async (sess?: mongoose.ClientSession): Promise<boolean> => {
      // CRITICAL (F2): A heartbeat must NEVER resurrect an expired lease.
      // Strict database-time server check $$NOW and matching owner + fencingToken.
      const result = await OperationJournalModel.updateOne(
        {
          operationId,
          recoveryOwner: workerId,
          fencingToken, // Strict fencing token match
          $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] },
        },
        {
          $set: {
            leaseExpiresAt: newExpiration,
            heartbeatAt: new Date(),
          },
        },
        { session: sess }
      ).exec();

      if (result.matchedCount === 0) {
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
              recoveryLeaseExpiresAt: newExpiration,
            },
          },
          { session: sess }
        ).exec();

        if (decRes.matchedCount === 0) {
          return false;
        }
      }

      return true;
    };

    if (session) {
      return executeRenew(session);
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

    const result = await OperationJournalModel.updateOne(
      {
        operationId,
        recoveryOwner: workerId,
        fencingToken, // Guarantees this worker still holds the valid lease
        state: stateCondition,
        $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] }, // Database-time lease validity
      },
      {
        $set: {
          state: toState,
          heartbeatAt: new Date(),
          ...extraFields,
        },
      },
      { session }
    ).exec();

    if (result.matchedCount === 0) {
      throw new ConcurrencyFencingError(
        `Fencing violation: Worker ${workerId} with token ${fencingToken} lost lease or state mismatch for operation ${operationId}`
      );
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
