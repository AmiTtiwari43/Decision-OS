import mongoose from 'mongoose';
import {
  DecisionEvidenceModel,
  type DecisionEvidenceDocument,
  type CreateEvidenceInput,
  type UpdateEvidenceInput,
  type ListEvidenceFilter,
  type IEvidenceProvenance,
} from '../models/index.js';

export class EvidenceRepository {
  /**
   * Creates an evidence record.
   */
  async create(
    decisionId: string,
    createdById: string,
    provenance: IEvidenceProvenance,
    data: CreateEvidenceInput
  ): Promise<DecisionEvidenceDocument> {
    const doc = new DecisionEvidenceModel({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      createdById: new mongoose.Types.ObjectId(createdById),
      targetType: data.targetType,
      targetId: data.targetId,
      type: data.type,
      title: data.title,
      sourceUrl: data.sourceUrl ?? null,
      documentReference: data.documentReference ?? null,
      sourceExcerpt: data.sourceExcerpt ?? null,
      userSummary: data.userSummary ?? null,
      publicationDate: data.publicationDate ?? null,
      provenance,
    });

    await doc.save();
    return doc;
  }

  /**
   * Finds an evidence record by ID.
   */
  async findById(id: string): Promise<DecisionEvidenceDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    return DecisionEvidenceModel.findById(id).exec();
  }

  /**
   * Lists evidence records matching filters, sorted newest first.
   */
  async list(filter: ListEvidenceFilter): Promise<DecisionEvidenceDocument[]> {
    const query: Record<string, unknown> = {
      decisionId: new mongoose.Types.ObjectId(filter.decisionId),
    };

    if (filter.targetType) {
      query.targetType = filter.targetType;
    }

    if (filter.targetId) {
      query.targetId = filter.targetId;
    }

    return DecisionEvidenceModel.find(query).sort({ createdAt: -1 }).lean<DecisionEvidenceDocument[]>().exec();
  }

  /**
   * Updates an evidence record.
   */
  async update(
    id: string,
    data: UpdateEvidenceInput
  ): Promise<DecisionEvidenceDocument | null> {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }

    const updateFields: Record<string, unknown> = {};

    if (data.title !== undefined) updateFields.title = data.title;
    if (data.sourceUrl !== undefined) updateFields.sourceUrl = data.sourceUrl;
    if (data.documentReference !== undefined) updateFields.documentReference = data.documentReference;
    if (data.sourceExcerpt !== undefined) updateFields.sourceExcerpt = data.sourceExcerpt;
    if (data.userSummary !== undefined) updateFields.userSummary = data.userSummary;
    if (data.publicationDate !== undefined) updateFields.publicationDate = data.publicationDate;

    return DecisionEvidenceModel.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { returnDocument: 'after', runValidators: true }
    ).exec() as Promise<DecisionEvidenceDocument | null>;
  }

  /**
   * Deletes a single evidence record.
   */
  async delete(id: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(id)) {
      return false;
    }
    const result = await DecisionEvidenceModel.findByIdAndDelete(id).exec();
    return result !== null;
  }

  /**
   * Cascading delete of all evidence records linked to a decision.
   */
  async deleteByDecisionId(decisionId: string): Promise<number> {
    if (!mongoose.isValidObjectId(decisionId)) {
      return 0;
    }
    const res = await DecisionEvidenceModel.deleteMany({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    }).exec();
    return res.deletedCount || 0;
  }
}

export const evidenceRepository = new EvidenceRepository();

