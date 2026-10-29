import mongoose from 'mongoose';
import {
  DecisionModel,
  createDecisionSchema,
  updateDecisionSchema,
  type CreateDecisionInput,
  type UpdateDecisionInput,
  type DecisionDocument,
} from '../models/index.js';

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface ListDecisionsFilter {
  search?: string;
  ownerId?: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class DecisionRepository {
  /**
   * Creates and persists a new Decision document.
   */
  async create(data: CreateDecisionInput): Promise<DecisionDocument> {
    const validated = createDecisionSchema.parse(data);
    const doc = new DecisionModel(validated);
    await doc.save();
    return doc;
  }

  /**
   * Retrieves a Decision document by its MongoDB ObjectId.
   * Returns null if the ID is invalid or the document is not found.
   */
  async findById(id: string): Promise<DecisionDocument | null> {
    if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
      return null;
    }
    return DecisionModel.findById(id).exec();
  }

  /**
   * Lists Decision documents with bounded pagination and optional search filter.
   * Default limit: 20, Maximum limit: 100.
   */
  async list(
    filter?: ListDecisionsFilter,
    pagination: PaginationOptions = {}
  ): Promise<PaginatedResult<DecisionDocument>> {
    const page = Math.max(1, pagination.page ?? 1);
    const limit = Math.min(100, Math.max(1, pagination.limit ?? 20));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    if (filter?.ownerId !== undefined) {
      query.ownerId = filter.ownerId;
    }
    if (filter?.search && filter.search.trim().length > 0) {
      // Escape regex special characters to prevent regex injection
      const escaped = filter.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.title = { $regex: escaped, $options: 'i' };
    }

    const [items, total] = await Promise.all([
      DecisionModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      DecisionModel.countDocuments(query).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Updates an existing Decision document by its ObjectId.
   * Protects immutable fields (_id, createdAt) from alteration.
   */
  async update(id: string, updateData: UpdateDecisionInput): Promise<DecisionDocument | null> {
    if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
      return null;
    }

    const validated = updateDecisionSchema.parse(updateData);

    const updatePayload: Record<string, unknown> = { ...validated };
    delete updatePayload._id;
    delete updatePayload.createdAt;

    const updated = await DecisionModel.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { returnDocument: 'after', runValidators: true }
    ).exec();

    return updated;
  }

  /**
   * Deletes a Decision document by its ObjectId.
   * Returns true if a document was found and removed, false otherwise.
   */
  async delete(id: string): Promise<boolean> {
    if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
      return false;
    }

    const result = await DecisionModel.findByIdAndDelete(id).exec();
    return result !== null;
  }
}

export const decisionRepository = new DecisionRepository();
