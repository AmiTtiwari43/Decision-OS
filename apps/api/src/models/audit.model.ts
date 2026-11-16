import mongoose, { Schema, type Model } from 'mongoose';
import type { AuditEventDocument, IAuditEvent } from './audit.types.js';

export const AuditEventSchema = new Schema<IAuditEvent, Model<AuditEventDocument>>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    decisionId: {
      type: Schema.Types.ObjectId,
      ref: 'Decision',
      required: true,
      index: true,
    },
    actorId: {
      type: String,
      required: true,
      index: true,
    },
    actorEmail: {
      type: String,
      default: undefined,
    },
    actorName: {
      type: String,
      default: undefined,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      required: true,
      index: true,
    },
    entityId: {
      type: String,
      required: true,
    },
    summary: {
      type: String,
      required: true,
    },
    diff: {
      type: Schema.Types.Mixed,
      default: null,
    },
    originalTimestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    sequenceNumber: {
      type: Number,
      required: true,
      default: 1,
      index: true,
    },
    eventHash: {
      type: String,
      required: true,
    },
    previousEventHash: {
      type: String,
      required: true,
    },
    schemaVersion: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        delete ret.__v;
        if (ret.decisionId && typeof ret.decisionId === 'object') {
          ret.decisionId = (ret.decisionId as mongoose.Types.ObjectId).toString();
        }
        ret.sequenceNumber = ret.sequenceNumber !== undefined ? Number(ret.sequenceNumber) : 1;
        return ret;
      },
    },
  }
);

// Compound indexes for timeline retrieval, filtered audits, and unique monotonic sequence
AuditEventSchema.index({ decisionId: 1, timestamp: -1 });
AuditEventSchema.index({ decisionId: 1, action: 1 });
AuditEventSchema.index({ decisionId: 1, entityType: 1 });
AuditEventSchema.index({ decisionId: 1, timestamp: 1 });
AuditEventSchema.index({ decisionId: 1, sequenceNumber: 1 }, { unique: true });
AuditEventSchema.index({ decisionId: 1, previousEventHash: 1 }, { unique: true });

// Strictly enforce append-only semantics: prevent updates and deletions on audit records
AuditEventSchema.pre('updateOne', function () {
  throw new Error('Audit records are strictly append-only. Updates are prohibited.');
});
AuditEventSchema.pre('updateMany', function () {
  throw new Error('Audit records are strictly append-only. Updates are prohibited.');
});
AuditEventSchema.pre('findOneAndUpdate', function () {
  throw new Error('Audit records are strictly append-only. Updates are prohibited.');
});

AuditEventSchema.pre('deleteOne', function () {
  throw new Error('Audit records are strictly append-only. Deletions are prohibited.');
});
AuditEventSchema.pre('deleteMany', function () {
  throw new Error('Audit records are strictly append-only. Deletions are prohibited.');
});
AuditEventSchema.pre('findOneAndDelete', function () {
  throw new Error('Audit records are strictly append-only. Deletions are prohibited.');
});
AuditEventSchema.pre('replaceOne', function () {
  throw new Error('Audit records are strictly append-only. Replacements are prohibited.');
});
AuditEventSchema.pre('findOneAndReplace', function () {
  throw new Error('Audit records are strictly append-only. Replacements are prohibited.');
});
// Document-level deleteOne() is separate from the query hook above in Mongoose 9.
AuditEventSchema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('Audit records are strictly append-only. Deletions are prohibited.');
});
// save() on an existing document would rewrite a persisted event in place.
AuditEventSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('Audit records are strictly append-only. Updates are prohibited.');
  }
});
// bulkWrite can carry update/replace/delete operations; only inserts are allowed.
AuditEventSchema.pre('bulkWrite', function (ops) {
  const operations = (ops ?? []) as unknown as Array<Record<string, unknown>>;
  if (operations.some(op => !('insertOne' in op))) {
    throw new Error('Audit records are strictly append-only. Only insert operations are permitted.');
  }
});

export const AuditEventModel =
  (mongoose.models.AuditEvent as Model<AuditEventDocument>) ||
  mongoose.model<AuditEventDocument>('AuditEvent', AuditEventSchema);
