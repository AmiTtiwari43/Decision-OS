import mongoose from 'mongoose';
import {
  DecisionSnapshotModel,
  type DecisionSnapshotDocument,
  type IDecisionSnapshot,
} from '../models/index.js';

export class SnapshotRepository {
  /**
   * Appends an immutable decision snapshot.
   */
  async create(data: Omit<IDecisionSnapshot, 'createdAt' | 'updatedAt'>): Promise<DecisionSnapshotDocument> {
    const doc = new DecisionSnapshotModel(data);
    return doc.save();
  }

  /**
   * Lists snapshots for a decision (newest first).
   */
  async listByDecisionId(decisionId: string): Promise<DecisionSnapshotDocument[]> {
    return DecisionSnapshotModel.find({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    })
      .sort({ version: -1 })
      .exec();
  }

  /**
   * Finds a snapshot by its unique UUID snapshotId.
   */
  async findBySnapshotId(snapshotId: string): Promise<DecisionSnapshotDocument | null> {
    return DecisionSnapshotModel.findOne({ snapshotId }).exec();
  }

  /**
   * Computes the next sequence version number for snapshots of this decision.
   */
  async getNextVersion(decisionId: string): Promise<number> {
    const latest = await DecisionSnapshotModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    })
      .sort({ version: -1 })
      .select('version')
      .exec();

    return (latest?.version ?? 0) + 1;
  }
}

export const snapshotRepository = new SnapshotRepository();

