import mongoose from 'mongoose';
import {
  DecisionContributionModel,
  type DecisionContributionDocument,
  type SaveContributionInput,
} from '../models/index.js';

export class ContributionRepository {
  /**
   * Finds a contribution by decision ID and contributor ID.
   */
  async findByDecisionAndContributor(
    decisionId: string,
    contributorId: string
  ): Promise<DecisionContributionDocument | null> {
    if (!mongoose.isValidObjectId(decisionId) || !mongoose.isValidObjectId(contributorId)) {
      return null;
    }
    return DecisionContributionModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      contributorId: new mongoose.Types.ObjectId(contributorId),
    })
      .populate('contributorId', 'id name email')
      .exec();
  }

  /**
   * Finds a contribution by its ID.
   */
  async findById(id: string): Promise<DecisionContributionDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return DecisionContributionModel.findById(id)
      .populate('contributorId', 'id name email')
      .exec();
  }

  /**
   * Lists contributions for a decision.
   * If includeDraftsForUserId is provided, returns all submitted/withdrawn contributions
   * PLUS drafts belonging to that user. Otherwise only submitted/withdrawn contributions.
   */
  async listByDecision(
    decisionId: string,
    includeDraftsForUserId?: string
  ): Promise<DecisionContributionDocument[]> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return [];
    }

    const conditions: Record<string, unknown>[] = [];
    conditions.push({ decisionId: new mongoose.Types.ObjectId(decisionId) });

    if (includeDraftsForUserId && mongoose.isValidObjectId(includeDraftsForUserId)) {
      conditions.push({
        $or: [
          { status: { $in: ['submitted', 'withdrawn'] } },
          { contributorId: new mongoose.Types.ObjectId(includeDraftsForUserId) },
        ],
      });
    } else {
      conditions.push({ status: { $in: ['submitted', 'withdrawn'] } });
    }

    return DecisionContributionModel.find({ $and: conditions })
      .populate('contributorId', 'id name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Upserts a draft contribution for a contributor on a decision.
   */
  async saveDraft(
    decisionId: string,
    contributorId: string,
    data: SaveContributionInput
  ): Promise<DecisionContributionDocument> {
    const filter = {
      decisionId: new mongoose.Types.ObjectId(decisionId),
      contributorId: new mongoose.Types.ObjectId(contributorId),
    };

    const existing = await DecisionContributionModel.findOne(filter);

    if (existing) {
      // If the contribution was previously submitted, archive the submitted state before modifying
      if (
        existing.status === 'submitted' ||
        (existing.status === 'withdrawn' &&
          existing.submittedAt &&
          !existing.history.some((h) => h.revision === existing.revision))
      ) {
        existing.history.push({
          revision: existing.revision,
          submittedAt: existing.submittedAt || new Date(),
          recommendation: { ...existing.recommendation },
          criterionScores: { ...existing.criterionScores },
          criterionReasoning: { ...existing.criterionReasoning },
          confidence: existing.confidence,
          prediction: existing.prediction ? { ...existing.prediction } : undefined,
        });
        existing.revision += 1;
        existing.status = 'draft';
      }

      existing.recommendation = {
        preferredOptionId: data.preferredOptionId,
        rationale: data.rationale || '',
      };
      if (data.criterionScores !== undefined) {
        existing.criterionScores = data.criterionScores;
      }
      if (data.criterionReasoning !== undefined) {
        existing.criterionReasoning = data.criterionReasoning;
      }
      if (data.confidence !== undefined) {
        existing.confidence = data.confidence;
      }
      if (data.prediction !== undefined) {
        existing.prediction = data.prediction;
      }
      if (data.evidenceReferences !== undefined) {
        existing.evidenceReferences = data.evidenceReferences;
      }
      // If was withdrawn, saving a draft moves it back to draft
      if (existing.status === 'withdrawn') {
        existing.status = 'draft';
      }
      await existing.save();
      await existing.populate('contributorId', 'id name email');
      return existing;
    }

    const doc = new DecisionContributionModel({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      contributorId: new mongoose.Types.ObjectId(contributorId),
      recommendation: {
        preferredOptionId: data.preferredOptionId,
        rationale: data.rationale || '',
      },
      criterionScores: data.criterionScores || {},
      criterionReasoning: data.criterionReasoning || {},
      confidence: data.confidence !== undefined ? data.confidence : 1,
      prediction: data.prediction,
      evidenceReferences: data.evidenceReferences || [],
      status: 'draft',
      revision: 1,
      history: [],
      submittedAt: null,
      withdrawnAt: null,
    });

    try {
      await doc.save();
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        // Concurrent insert won the race; retry so we update the now-existing record
        return this.saveDraft(decisionId, contributorId, data);
      }
      throw err;
    }
    await doc.populate('contributorId', 'id name email');
    return doc;
  }

  /**
   * Submits a contribution, capturing a historical snapshot if this is a revision.
   */
  async submit(
    decisionId: string,
    contributorId: string
  ): Promise<DecisionContributionDocument | null> {
    const contribution = await DecisionContributionModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      contributorId: new mongoose.Types.ObjectId(contributorId),
    });

    if (!contribution) {
      return null;
    }

    // If it was already submitted, return idempotently
    if (contribution.status === 'submitted') {
      await contribution.populate('contributorId', 'id name email');
      return contribution;
    }

    contribution.status = 'submitted';
    contribution.submittedAt = new Date();
    contribution.withdrawnAt = null;

    await contribution.save();
    await contribution.populate('contributorId', 'id name email');
    return contribution;
  }

  /**
   * Withdraws a contribution.
   */
  async withdraw(
    decisionId: string,
    contributorId: string
  ): Promise<DecisionContributionDocument | null> {
    const contribution = await DecisionContributionModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      contributorId: new mongoose.Types.ObjectId(contributorId),
    });

    if (!contribution) {
      return null;
    }

    contribution.status = 'withdrawn';
    contribution.withdrawnAt = new Date();

    await contribution.save();
    await contribution.populate('contributorId', 'id name email');
    return contribution;
  }

  /**
   * Cascading cleanup: deletes all contributions for a decision.
   */
  async deleteByDecisionId(decisionId: string): Promise<number> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return 0;
    }
    const res = await DecisionContributionModel.deleteMany({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).exec();
    return res.deletedCount || 0;
  }
}

export const contributionRepository = new ContributionRepository();

