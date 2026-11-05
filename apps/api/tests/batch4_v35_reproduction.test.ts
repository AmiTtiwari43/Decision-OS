import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  claimTestDatabaseOwnership,
  cleanupTestDatabase,
  getTestDatabaseUri,
} from '../src/db/guard.js';

describe('DECISION OS — BATCH 4 V3.5 DEFECT REPRODUCTION (R1 & R2)', () => {
  const baseUri =
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_v35_repro?replicaSet=rs0&directConnection=true';

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

  // Defect R2: Missing coordination record fails open and drops database in V3.4
  it('REPRO-R2: Missing coordination record should fail closed, but in V3.4 it proceeds to drop', async () => {
    const runId = `run_35_r2_${Date.now()}`;
    const workerId = 'w_35_r2';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_r2_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'r2_evidence' });

      // Invalidate / remove the coordination record before cleanup
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.deleteOne({ _id: dbName as unknown as import('mongodb').ObjectId });

      const regBefore = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regBefore).toBeNull();

      // In V3.4, cleanupTestDatabase proceeds despite missing coordination record because:
      // if (latestCoord && ...) evaluates to false when latestCoord is null!
      // This demonstrates the FAIL-OPEN defect in V3.4:
      let dropExecuted = false;
      const originalDrop = db.dropDatabase.bind(db);
      db.dropDatabase = async () => {
        dropExecuted = true;
        return originalDrop();
      };

      try {
        await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
          /has no coordination record in registry/
        );
      } finally {
        db.dropDatabase = originalDrop;
      }

      // Under V3.5, drop was NOT executed because missing coordination record fails closed!
      expect(dropExecuted).toBe(false);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // Defect R1: Check-then-act race after final read
  it('REPRO-R1: Worker A reads coordination registry, then pauses. Supersession happens, but Worker A still drops', async () => {
    const runId = `run_35_r1_${Date.now()}`;
    const workerId = 'w_35_r1_A';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_r1_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'r1_evidence' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');

      let dropIssuedByA = false;
      const originalDrop = db.dropDatabase.bind(db);
      db.dropDatabase = async () => {
        dropIssuedByA = true;
        return originalDrop();
      };

      try {
        await expect(
          cleanupTestDatabase(conn, runId, workerId, {
            _testHooks: {
              beforeDropDatabase: async () => {
                // Supersede Worker A's authority while paused right before drop
                await coordCol.updateOne(
                  { _id: dbName as unknown as import('mongodb').ObjectId },
                  { $set: { cleanupOwner: 'w_35_r1_B', cleanupGeneration: 999 } }
                );
              },
            },
          })
        ).rejects.toThrow(/cleanup authority superseded before drop/);
      } finally {
        db.dropDatabase = originalDrop;
      }

      // Under V3.5, Worker A was fenced off immediately and did NOT issue dropDatabase!
      expect(dropIssuedByA).toBe(false);
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
