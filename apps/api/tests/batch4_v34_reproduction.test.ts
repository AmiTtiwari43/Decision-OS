import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  claimTestDatabaseOwnership,
  cleanupTestDatabase,
  getTestDatabaseUri,
} from '../src/db/guard.js';

describe('DECISION OS — BATCH 4 V3.4 DEFECT REPRODUCTION', () => {
  const baseUri =
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_v34_repro_test?replicaSet=rs0&directConnection=true';

  let client: import('mongodb').MongoClient;

  beforeAll(async () => {
    const directConn = await mongoose.createConnection(baseUri).asPromise();
    client =
      typeof directConn.getClient === 'function'
        ? directConn.getClient()
        : (directConn as unknown as { client: import('mongodb').MongoClient }).client;
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('REPRO-V34-01: Proves that pre-drop crash recovery is rejected in V3.3 due to dropInProgress: true lock conflict', async () => {
    const runId = `repro_run_${Date.now()}`;
    const workerId = 'repro_w1';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_repro_d1_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );

    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      // 1. Establish ownership
      await claimTestDatabaseOwnership(conn, runId, workerId);

      // 2. Insert test data
      const sampleCol = db.collection('sample_data');
      await sampleCol.insertOne({ key: 'val1', createdAt: new Date() });

      // 3. Setup crash injection on db.dropDatabase
      const originalDropDatabase = db.dropDatabase.bind(db);
      let crashInjected = false;
      db.dropDatabase = async () => {
        crashInjected = true;
        throw new Error('SIMULATED_PROCESS_CRASH_BEFORE_DROP');
      };

      // 4. Invoke production cleanupTestDatabase -> real lock acquisition executes
      let initialError: Error | null = null;
      try {
        await cleanupTestDatabase(conn, runId, workerId);
      } catch (err) {
        initialError = err as Error;
      }

      expect(crashInjected).toBe(true);
      expect(initialError?.message).toBe('SIMULATED_PROCESS_CRASH_BEFORE_DROP');

      // 5. Inspect persisted metadata in target DB
      const metaCol = db.collection('__test_run_metadata');
      const persistedLock = await metaCol.findOne({
        _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
      });

      console.log('REPRO PERSISTED LOCK:', JSON.stringify(persistedLock, null, 2));

      expect(persistedLock).toBeDefined();
      expect(['CLEANUP_LOCKED', 'DROP_IN_PROGRESS']).toContain(persistedLock?.lifecycleState);
      expect(persistedLock?.cleanupOwner).toBe(workerId);
      expect(persistedLock?.cleanupInProgress).toBe(true);

      // 6. Inspect coordination registry
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      console.log('REPRO REGISTRY DOC:', JSON.stringify(regDoc, null, 2));
      expect(regDoc).toBeDefined();
      expect(['CLEANUP_LOCKED', 'DROP_IN_PROGRESS']).toContain(regDoc?.lifecycleState);

      // 7. Verify database was NOT dropped
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);

      // 8. Restore dropDatabase method
      db.dropDatabase = originalDropDatabase;

      // 9. Now invoke cleanup again using the same authorized identity:
      // In V3.3, this retry FAILED with "drop is already in progress concurrently".
      // In V3.4, the retry SUCCEEDS and drops the database.
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const colsAfter = await db.listCollections().toArray();
      expect(colsAfter.length).toBe(0);

      const regAfter = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regAfter?.lifecycleState).toBe('CLEANED');
    } finally {
      // Force teardown for test cleanliness
      try {
        await db.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });
});
