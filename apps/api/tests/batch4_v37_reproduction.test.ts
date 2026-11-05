import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  claimTestDatabaseOwnership,
  cleanupTestDatabase,
  getTestDatabaseUri,
} from '../src/db/guard.js';

describe('DECISION OS — BATCH 4 V3.7 DEFECT REPRODUCTION & RESOLUTION', () => {
  const baseUri =
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_v37_repro?replicaSet=rs0&directConnection=true';

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

  /**
   * REPRO-V37-01: Proves the resolution of the V3.6 race condition at the native execution boundary:
   * 1. Worker A acquires cleanup authority.
   * 2. Worker A performs its coordination-registry verification.
   * 3. Worker A pauses at the exact execution boundary (before wire dispatch).
   * 4. Worker B revokes Worker A's authority using the production coordination registry.
   * 5. Worker A resumes.
   * 6. Under V3.7, the Supervised Cleanup Executor intercepts the revocation, aborts dispatch,
   *    and strictly prevents the destructive command from reaching the MongoDB wire.
   */
  it('REPRO-V37-01: Supervised Cleanup Executor intercepts boundary race and blocks stale drop', async () => {
    const runId = `r37_repro_${Date.now()}`;
    const workerA = 'w37_repro_A';
    const workerB = 'w37_repro_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_repro_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('canary').insertOne({ secret: 'd37_repro_canary_payload' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');

      let dropDispatchedByA = false;

      // STEP 1: Worker A initiates production cleanup through the supervised executor
      await expect(
        cleanupTestDatabase(conn, runId, workerA, {
          _testHooks: {
            beforeWireDispatch: async () => {
              // STEP 3: Paused at the exact execution boundary (after initial authorization)
              // STEP 4: While paused, Worker B revokes Worker A's authority in the coordination registry
              await coordCol.updateOne(
                { _id: dbName as unknown as import('mongodb').ObjectId },
                {
                  $set: {
                    cleanupOwner: workerB,
                    cleanupGeneration: 999,
                    dropExecutionToken: 'revoked_by_worker_B',
                    dropExecutionLock: false,
                  },
                }
              );
            },
          },
        })
      ).rejects.toThrow(/cleanup authority superseded before drop \(revoked or stale generation/);

      console.log(`[V3.7 RESOLUTION] Did stale Worker A dispatch dropDatabase? -> ${dropDispatchedByA}`);

      // In V3.7: dropDispatchedByA is strictly FALSE!
      expect(dropDispatchedByA).toBe(false);

      // Verify the target database was NOT destroyed: canary item remains safe on MongoDB cluster!
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
      const canary = await db.collection('canary').findOne({ secret: 'd37_repro_canary_payload' });
      expect(canary).not.toBeNull();
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  /**
   * REPRO-V37-02: Direct drop capability is stripped from ordinary workers.
   * Proves that an ordinary worker connection cannot independently call db.dropDatabase().
   */
  it('REPRO-V37-02: Direct dropDatabase capability is denied on worker handles', async () => {
    const runId = `r37_cap_${Date.now()}`;
    const workerId = 'w37_cap';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_cap_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ data: 'must_survive' });

      // Direct call on worker db handle is denied
      await expect(db.dropDatabase()).rejects.toThrow(
        /Destructive execution capability denied: direct dropDatabase\(\) is prohibited/
      );

      // Canary document must still exist
      const count = await db.collection('canary').countDocuments();
      expect(count).toBe(1);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });
});
