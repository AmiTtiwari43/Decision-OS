import mongoose from 'mongoose';
import {
  DecisionInvitationModel,
  type DecisionInvitationDocument,
  type CreateInvitationInput,
} from '../models/index.js';

export class InvitationRepository {
  /**
   * Persists a new invitation record.
   */
  async create(data: CreateInvitationInput): Promise<DecisionInvitationDocument> {
    const expiresAt = data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days default
    const doc = new DecisionInvitationModel({
      decisionId: new mongoose.Types.ObjectId(data.decisionId),
      inviterId: new mongoose.Types.ObjectId(data.inviterId),
      email: data.email.toLowerCase().trim(),
      role: data.role,
      tokenHash: data.tokenHash,
      status: 'pending',
      expiresAt,
    });
    await doc.save();
    return doc;
  }

  /**
   * Finds an invitation by its token hash.
   */
  async findByTokenHash(tokenHash: string): Promise<DecisionInvitationDocument | null> {
    if (!tokenHash) {
      return null;
    }
    return DecisionInvitationModel.findOne({ tokenHash }).exec();
  }

  /**
   * Finds an active pending invitation for a decision and email.
   */
  async findPendingByDecisionAndEmail(
    decisionId: string,
    email: string
  ): Promise<DecisionInvitationDocument | null> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return null;
    }
    return DecisionInvitationModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      email: email.toLowerCase().trim(),
      status: 'pending',
    }).exec();
  }

  /**
   * Finds an invitation by ID.
   */
  async findById(id: string): Promise<DecisionInvitationDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return DecisionInvitationModel.findById(id).exec();
  }

  /**
   * Lists all invitations for a decision, sorted by creation date.
   */
  async listByDecision(decisionId: string): Promise<DecisionInvitationDocument[]> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return [];
    }
    return DecisionInvitationModel.find({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Lists pending invitations for a specific recipient email.
   */
  async listPendingByEmail(email: string): Promise<DecisionInvitationDocument[]> {
    return DecisionInvitationModel.find({
      email: email.toLowerCase().trim(),
      status: 'pending',
      expiresAt: { $gt: new Date() },
    })
      .populate('decisionId', 'title description')
      .populate('inviterId', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Atomically transitions a pending invitation to 'accepted'.
   * Prevents double-spending and concurrent redemption races.
   */
  async accept(
    id: string,
    acceptedByUserId: string
  ): Promise<DecisionInvitationDocument | null> {
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(acceptedByUserId)) {
      return null;
    }
    return DecisionInvitationModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        status: 'pending',
      },
      {
        $set: {
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedBy: new mongoose.Types.ObjectId(acceptedByUserId),
        },
      },
      { returnDocument: 'after' }
    ).exec();
  }

  /**
   * Atomically reverts an acceptance if downstream grant creation fails.
   */
  async rollbackAcceptance(id: string): Promise<void> {
    if (!mongoose.isValidObjectId(id)) {
      return;
    }
    await DecisionInvitationModel.findByIdAndUpdate(id, {
      $set: {
        status: 'pending',
        acceptedAt: null,
        acceptedBy: null,
      },
    }).exec();
  }

  /**
   * Revokes a pending invitation.
   */
  async revoke(
    id: string,
    revokedByUserId: string
  ): Promise<DecisionInvitationDocument | null> {
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(revokedByUserId)) {
      return null;
    }
    return DecisionInvitationModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        status: 'pending',
      },
      {
        $set: {
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy: new mongoose.Types.ObjectId(revokedByUserId),
        },
      },
      { returnDocument: 'after' }
    ).exec();
  }

  /**
   * Marks an expired invitation.
   */
  async markExpired(id: string): Promise<DecisionInvitationDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return DecisionInvitationModel.findByIdAndUpdate(
      id,
      { $set: { status: 'expired' } },
      { returnDocument: 'after' }
    ).exec();
  }

  /**
   * Cascading cleanup: deletes all invitations for a decision.
   */
  async deleteByDecisionId(decisionId: string): Promise<number> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return 0;
    }
    const res = await DecisionInvitationModel.deleteMany({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).exec();
    return res.deletedCount || 0;
  }
}

export const invitationRepository = new InvitationRepository();
