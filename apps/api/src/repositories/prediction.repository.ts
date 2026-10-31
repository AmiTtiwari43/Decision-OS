import mongoose from 'mongoose';
import {
  ExpertPredictionModel,
  type ExpertPredictionDocument,
  type IExpertPrediction,
  type IPredictionOutcome,
  type PredictionStatus,
} from '../models/index.js';

export interface PredictionFilterOptions {
  contributorId?: string;
  status?: string;
  domain?: string;
}

export class PredictionRepository {
  async listByDecision(
    decisionId: string,
    filter?: PredictionFilterOptions
  ): Promise<ExpertPredictionDocument[]> {
    const query: Record<string, unknown> = {
      decisionId: new mongoose.Types.ObjectId(decisionId),
    };

    if (filter?.contributorId && mongoose.isValidObjectId(filter.contributorId)) {
      query.contributorId = new mongoose.Types.ObjectId(filter.contributorId);
    }

    if (filter?.status) {
      query.status = filter.status;
    }

    if (filter?.domain) {
      query.domain = filter.domain.trim().toLowerCase();
    }

    return ExpertPredictionModel.find(query).sort({ submittedAt: -1 }).exec();
  }

  async listByContributor(contributorId: string): Promise<ExpertPredictionDocument[]> {
    return ExpertPredictionModel.find({
      contributorId: new mongoose.Types.ObjectId(contributorId),
    })
      .sort({ submittedAt: -1 })
      .exec();
  }

  async findByPredictionId(
    decisionId: string,
    predictionId: string
  ): Promise<ExpertPredictionDocument | null> {
    return ExpertPredictionModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      predictionId,
    }).exec();
  }

  async create(data: Partial<IExpertPrediction>): Promise<ExpertPredictionDocument> {
    const doc = new ExpertPredictionModel(data);
    return doc.save();
  }

  async updateOutcome(
    decisionId: string,
    predictionId: string,
    outcome: IPredictionOutcome,
    status: PredictionStatus
  ): Promise<ExpertPredictionDocument | null> {
    return ExpertPredictionModel.findOneAndUpdate(
      {
        decisionId: new mongoose.Types.ObjectId(decisionId),
        predictionId,
      },
      {
        $set: {
          outcome,
          status,
        },
      },
      { returnDocument: 'after' }
    ).exec();
  }

  async updateDispute(
    decisionId: string,
    predictionId: string,
    disputeReason: string,
    disputedById?: string
  ): Promise<ExpertPredictionDocument | null> {
    return ExpertPredictionModel.findOneAndUpdate(
      {
        decisionId: new mongoose.Types.ObjectId(decisionId),
        predictionId,
      },
      {
        $set: {
          status: 'disputed',
          'outcome.verificationStatus': 'disputed',
          'outcome.disputeReason': disputeReason,
          'outcome.disputedById': disputedById ? new mongoose.Types.ObjectId(disputedById) : undefined,
          'outcome.disputedAt': new Date(),
        },
      },
      { returnDocument: 'after' }
    ).exec();
  }

  async deleteByDecision(decisionId: string): Promise<number> {
    const res = await ExpertPredictionModel.deleteMany({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).exec();
    return res.deletedCount;
  }
}

export const predictionRepository = new PredictionRepository();

