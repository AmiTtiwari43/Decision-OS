import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  claimTestDatabaseOwnership,
  cleanupTestDatabase,
  getTestDatabaseUri,
} from '../src/db/guard.js';

describe('DECISION OS — BATCH 4 V3.6 DEFECT REPRODUCTION & RESOLUTION VERIFICATION', () => {
  const baseUri =
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_v36_repro?replicaSet=rs0&directConnection=true';

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

  // Interleaving:
  // 1. Worker A acquires destructive execution authority.
  // 2. Worker A completes its initial pre-drop verification.
  // 3. Worker A pauses immediately before the native drop call.
  // 4. Worker B / recovery supersedes or revokes Worker A in the coordination registry.
  // 5. Worker A resumes and attempts to issue the drop.
  // 6. Prove that in V3.6, Worker A's supervised execution gate intercepts the revocation,
  //    aborts the drop, throws a typed violation, and prevents database destruction!
  it('REPRO-V36-01: In V3.6, Worker A is blocked by supervised execution gate if authority was revoked during pause', async () => {
    const runId = `r36_${Date.now()}`;
    const workerA = 'w36A';
    const workerB = 'w36B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d36_rep_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('test_items').insertOne({ item: 'repro_evidence_v36' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');

      let dropExecutedByA = false;

      // We run the actual production cleanupTestDatabase function.
      // overrideDropDatabase is passed the supervised execution callback `() => executeGuardedDrop()`.
      await expect(
        cleanupTestDatabase(conn, runId, workerA, {
          _testHooks: {
            overrideDropDatabase: async (invokeDrop) => {
              // STEP 2 & 3: Worker A has completed its initial check and is now PAUSED right here.
              // STEP 4: While Worker A is paused, Worker B or recovery revokes Worker A's authority:
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

              // STEP 5 & 6: Worker A resumes and invokes the drop.
              // In V3.6, invokeDrop() calls executeGuardedDrop(), which detects the revocation,
              // aborts execution, and throws a Safety guard violation!
              await invokeDrop();
              dropExecutedByA = true;
            },
          },
        })
      ).rejects.toThrow(
        /cleanup authority superseded before drop \(revoked or stale generation/
      );

      console.log(`[V3.6 RESOLUTION] Did Worker A issue dropDatabase() after its authority was revoked? -> ${dropExecutedByA}`);

      // In V3.6, dropExecutedByA is strictly FALSE!
      expect(dropExecutedByA).toBe(false);

      // Verify the target database was NOT dropped: canary item remains safe on MongoDB cluster!
      const colsAfter = await db.listCollections().toArray();
      expect(colsAfter.length).toBeGreaterThan(0);
      const canary = await db.collection('test_items').findOne({ item: 'repro_evidence_v36' });
      expect(canary).not.toBeNull();
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });
});
