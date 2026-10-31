import mongoose from 'mongoose';
import {
  DisagreementResolutionModel,
  type DisagreementResolutionDocument,
  type IDisagreementResolution,
} from '../models/index.js';

export class DisagreementRepository {
  async listByDecision(decisionId: string): Promise<DisagreementResolutionDocument[]> {
    if (!mongoose.isValidObjectId(decisionId)) return [];
    return DisagreementResolutionModel.find({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    })
      .lean()
      .exec() as Promise<DisagreementResolutionDocument[]>;
  }

  async findByDisagreementId(
    decisionId: string,
    disagreementId: string
  ): Promise<DisagreementResolutionDocument | null> {
    if (!mongoose.isValidObjectId(decisionId)) return null;
    return DisagreementResolutionModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      disagreementId,
    })
      .lean()
      .exec() as Promise<DisagreementResolutionDocument | null>;
  }

  async upsertResolution(
    decisionId: string,
    disagreementId: string,
    data: Partial<IDisagreementResolution>
  ): Promise<DisagreementResolutionDocument> {
    const filter = {
      decisionId: new mongoose.Types.ObjectId(decisionId),
      disagreementId,
    };

    const update = {
      $set: {
        ...data,
        decisionId: new mongoose.Types.ObjectId(decisionId),
        disagreementId,
      },
    };

    const doc = await DisagreementResolutionModel.findOneAndUpdate(filter, update, {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
    })
      .lean()
      .exec();

    return doc as DisagreementResolutionDocument;
  }

  async deleteByDecision(decisionId: string): Promise<number> {
    if (!mongoose.isValidObjectId(decisionId)) return 0;
    const res = await DisagreementResolutionModel.deleteMany({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).exec();
    return res.deletedCount ?? 0;
  }
}

export const disagreementRepository = new DisagreementRepository();
