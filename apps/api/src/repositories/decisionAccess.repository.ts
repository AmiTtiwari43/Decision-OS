import mongoose from 'mongoose';
import {
  DecisionAccessGrantModel,
  type DecisionAccessGrantDocument,
  type CreateDecisionAccessGrantInput,
  type DecisionCollaboratorRole,
} from '../models/index.js';

export class DecisionAccessRepository {
  /**
   * Persists a new access grant.
   */
  async create(data: CreateDecisionAccessGrantInput): Promise<DecisionAccessGrantDocument> {
    const doc = new DecisionAccessGrantModel({
      decisionId: new mongoose.Types.ObjectId(data.decisionId),
      userId: new mongoose.Types.ObjectId(data.userId),
      role: data.role,
      grantedBy: new mongoose.Types.ObjectId(data.grantedBy),
    });
    await doc.save();
    return doc;
  }

  /**
   * Finds an access grant for a specific decision and user.
   */
  async findByDecisionAndUser(
    decisionId: string,
    userId: string
  ): Promise<DecisionAccessGrantDocument | null> {
    if (!mongoose.isValidObjectId(decisionId) || !mongoose.isValidObjectId(userId)) {
      return null;
    }
    return DecisionAccessGrantModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      userId: new mongoose.Types.ObjectId(userId),
    }).exec();
  }

  /**
   * Finds a grant by its primary ID.
   */
  async findById(id: string): Promise<DecisionAccessGrantDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return DecisionAccessGrantModel.findById(id).exec();
  }

  /**
   * Lists all access grants for a decision, populated with user info.
   */
  async listByDecision(decisionId: string): Promise<DecisionAccessGrantDocument[]> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return [];
    }
    return DecisionAccessGrantModel.find({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    })
      .populate('userId', 'id name email')
      .populate('grantedBy', 'id name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Lists all decision IDs shared with a specific user.
   */
  async listSharedDecisionIdsForUser(userId: string): Promise<string[]> {
    if (!mongoose.isValidObjectId(userId)) {
      return [];
    }
    const grants = await DecisionAccessGrantModel.find({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .select('decisionId')
      .lean()
      .exec();

    return grants.map(g => g.decisionId.toString());
  }

  /**
   * Updates an existing grant's role.
   */
  async updateRole(
    id: string,
    role: DecisionCollaboratorRole
  ): Promise<DecisionAccessGrantDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return DecisionAccessGrantModel.findByIdAndUpdate(
      id,
      { $set: { role } },
      { returnDocument: 'after', runValidators: true }
    ).exec();
  }

  /**
   * Deletes a grant by its ID.
   */
  async delete(id: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(id)) {
      return false;
    }
    const res = await DecisionAccessGrantModel.findByIdAndDelete(id).exec();
    return res !== null;
  }

  /**
   * Cascading cleanup: deletes all grants associated with a decision.
   */
  async deleteByDecisionId(decisionId: string): Promise<number> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return 0;
    }
    const res = await DecisionAccessGrantModel.deleteMany({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).exec();
    return res.deletedCount || 0;
  }
}

export const decisionAccessRepository = new DecisionAccessRepository();
