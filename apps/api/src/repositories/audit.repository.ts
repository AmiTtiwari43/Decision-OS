import mongoose from 'mongoose';
import {
  AuditEventModel,
  type AuditEventDocument,
  type IAuditEvent,
  type AuditHistoryQueryFilter,
} from '../models/index.js';

export interface AuditPaginationOptions {
  page?: number;
  limit?: number;
}

export class AuditRepository {
  /**
   * Appends a new audit event. Strictly append-only.
   */
  async create(data: Omit<IAuditEvent, 'createdAt' | 'updatedAt'>): Promise<AuditEventDocument> {
    const doc = new AuditEventModel(data);
    return doc.save();
  }

  /**
   * Retrieves the most recent audit event for a decision to establish the hash linkage.
   */
  async getLatestByDecisionId(decisionId: string): Promise<AuditEventDocument | null> {
    return AuditEventModel.findOne({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    })
      .sort({ timestamp: -1, _id: -1 })
      .exec();
  }

  /**
   * Retrieves all audit events for a decision in chronological order (oldest to newest)
   * used for cryptographic chain verification.
   */
  async getAllForDecision(decisionId: string): Promise<AuditEventDocument[]> {
    return AuditEventModel.find({
      decisionId: new mongoose.Types.ObjectId(decisionId),
    })
      .sort({ timestamp: 1, _id: 1 })
      .lean<AuditEventDocument[]>()
      .exec();
  }

  /**
   * Lists audit events with optional filtering and pagination (newest first).
   */
  async listByDecisionId(
    decisionId: string,
    filter?: AuditHistoryQueryFilter,
    pagination?: AuditPaginationOptions
  ): Promise<{ items: AuditEventDocument[]; total: number }> {
    const query: Record<string, unknown> = {
      decisionId: new mongoose.Types.ObjectId(decisionId),
    };

    if (filter?.action) {
      if (filter.action.endsWith('.*')) {
        const prefix = filter.action.slice(0, -2);
        query.action = { $regex: `^${prefix}\\.` };
      } else {
        query.action = filter.action;
      }
    }

    if (filter?.entityType) {
      query.entityType = filter.entityType;
    }

    if (filter?.actorId) {
      query.actorId = filter.actorId;
    }

    if (filter?.startDate || filter?.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filter.startDate) dateFilter.$gte = new Date(filter.startDate);
      if (filter.endDate) dateFilter.$lte = new Date(filter.endDate);
      query.timestamp = dateFilter;
    }

    const page = Math.max(1, pagination?.page ?? 1);
    const limit = Math.min(200, Math.max(1, pagination?.limit ?? 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      AuditEventModel.find(query)
        .sort({ timestamp: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<AuditEventDocument[]>()
        .exec(),
      AuditEventModel.countDocuments(query).exec(),
    ]);

    return { items, total };
  }
}

export const auditRepository = new AuditRepository();

