import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard';
import { AuditEventModel } from '../src/models/audit.model';

const TEST_MONGODB_URI = getTestDatabaseUri(undefined, { runId: 'audit_append_only' });
assertTestDatabase(TEST_MONGODB_URI);

/**
 * F17: audit events are append-only at the model boundary. Query-level
 * update/delete hooks already existed; these cover the remaining Mongoose
 * paths that could rewrite or remove a persisted event.
 */
describe('Audit ledger append-only guards (real MongoDB)', () => {
  const decisionId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    // Test-only cleanup through the raw collection (the model forbids deletes).
    await mongoose.connection.collection('auditevents').deleteMany({});
  });

  async function seedEvent() {
    return AuditEventModel.create({
      eventId: new mongoose.Types.ObjectId().toString(),
      decisionId,
      actorId: 'actor-1',
      action: 'decision.create',
      entityType: 'decision',
      entityId: decisionId.toString(),
      summary: 'Original summary',
      previousEventHash: '0'.repeat(64),
      eventHash: 'a'.repeat(64),
      sequenceNumber: 1,
    });
  }

  async function expectUnchanged(id: unknown) {
    const raw = await mongoose.connection.collection('auditevents').findOne({ _id: id as mongoose.Types.ObjectId });
    expect(raw?.summary).toBe('Original summary');
  }

  it('allows appending a new event', async () => {
    const event = await seedEvent();
    expect(event._id).toBeDefined();
  });

  it('blocks save() on an existing event', async () => {
    const event = await seedEvent();
    event.summary = 'Tampered summary';
    await expect(event.save()).rejects.toThrow(/append-only/);
    await expectUnchanged(event._id);
  });

  it('blocks document-level deleteOne()', async () => {
    const event = await seedEvent();
    await expect(event.deleteOne()).rejects.toThrow(/append-only/);
    await expectUnchanged(event._id);
  });

  it('blocks replaceOne and findOneAndReplace', async () => {
    const event = await seedEvent();
    await expect(AuditEventModel.replaceOne({ _id: event._id }, { summary: 'Tampered summary' })).rejects.toThrow(
      /append-only/
    );
    await expect(
      AuditEventModel.findOneAndReplace({ _id: event._id }, { summary: 'Tampered summary' })
    ).rejects.toThrow(/append-only/);
    await expectUnchanged(event._id);
  });

  it('blocks bulkWrite update/delete operations', async () => {
    const event = await seedEvent();
    await expect(
      AuditEventModel.bulkWrite([{ updateOne: { filter: { _id: event._id }, update: { $set: { summary: 'Tampered summary' } } } }])
    ).rejects.toThrow(/append-only/);
    await expect(AuditEventModel.bulkWrite([{ deleteOne: { filter: { _id: event._id } } }])).rejects.toThrow(
      /append-only/
    );
    await expectUnchanged(event._id);
  });

  it('still blocks query-level updates and deletes', async () => {
    const event = await seedEvent();
    await expect(AuditEventModel.updateOne({ _id: event._id }, { summary: 'Tampered summary' })).rejects.toThrow(
      /append-only/
    );
    await expect(AuditEventModel.deleteOne({ _id: event._id })).rejects.toThrow(/append-only/);
    await expectUnchanged(event._id);
  });
});
