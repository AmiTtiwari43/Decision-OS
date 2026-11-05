import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  claimTestDatabaseOwnership,
  cleanupTestDatabase,
  getTestDatabaseUri,
} from '../src/db/guard.js';

describe('DECISION OS — BATCH 4 V3.5 CLEANUP FENCING & ATOMIC AUTHORITY SUITE (D35-01 to D35-24)', () => {
  const baseUri =
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_v35_suite?replicaSet=rs0&directConnection=true';

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

  // D35-01: Missing coordination record -> Reject; no drop
  it('D35-01: Missing coordination record is rejected fail-closed; no drop occurs', async () => {
    const runId = `run_35_01_${Date.now()}`;
    const workerId = 'w_35_01';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d01_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_01' });

      // Invalidate by deleting coordination record before cleanup
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.deleteOne({ _id: dbName as unknown as import('mongodb').ObjectId });

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/has no coordination record in registry|coordination registry/);

      expect(dropAttempted).toBe(false);
      // Database was not dropped
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-02: Wrong runId -> Reject; no drop
  it('D35-02: Wrong runId is rejected fail-closed; no drop occurs', async () => {
    const runId = `run_35_02_${Date.now()}`;
    const workerId = 'w_35_02';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d02_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_02' });

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, 'run_wrong_35_02', workerId, {
          _testHooks: {
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/Refusing cleanup of another run's database|owned by run/);

      expect(dropAttempted).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-03: Wrong workerId -> Reject; no drop
  it('D35-03: Wrong workerId is rejected fail-closed; no drop occurs', async () => {
    const runId = `run_35_03_${Date.now()}`;
    const workerId = 'w_35_03';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d03_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_03' });

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, 'w_intruder_03', {
          _testHooks: {
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/Refusing cleanup of another worker's database|owned by worker/);

      expect(dropAttempted).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-04: Wrong database identity -> Reject; no drop
  it('D35-04: Non-matching database record in coordination registry is rejected', async () => {
    const runId = `run_35_04_${Date.now()}`;
    const workerId = 'w_35_04';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d04_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_04' });

      // Invalidate coordination record by setting wrong workerId
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        { $set: { workerId: 'w_other_identity', cleanupOwner: 'w_other_identity' } }
      );

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/Safety guard violation/);

      expect(dropAttempted).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-05: Missing generation -> Reject; no drop
  it('D35-05: Missing generation in coordination record fails closed; no drop', async () => {
    const runId = `run_35_05_${Date.now()}`;
    const workerId = 'w_35_05';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d05_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_05' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        { $unset: { cleanupGeneration: '' }, $set: { lifecycleState: 'CLEANUP_LOCKED' } }
      );

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/destructive drop authority not acquired|Safety guard violation/);

      expect(dropAttempted).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-06: Stale generation -> Reject; no drop
  it('D35-06: Stale generation attempts are rejected fail-closed; no drop occurs', async () => {
    const runId = `run_35_06_${Date.now()}`;
    const workerId = 'w_35_06';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d06_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_06' });

      // Advance cleanup generation in registry to 5
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        { $set: { cleanupGeneration: 5 } }
      );

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          expectedGeneration: 1,
          _testHooks: {
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/cleanup generation 1 is superseded by newer generation 5|destructive drop authority not acquired/);

      expect(dropAttempted).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-07: Takeover before authorization -> Old worker rejected
  it('D35-07: Takeover before authorization: old worker is rejected and cannot acquire lock', async () => {
    const runId = `run_35_07_${Date.now()}`;
    const workerA = 'w_35_07_A';
    const workerB = 'w_35_07_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d07_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('test_items').insertOne({ item: 'd35_07' });

      // Worker B takes over in target metadata before Worker A acquires cleanup lock
      const metaCol = db.collection('__test_run_metadata');
      await metaCol.updateOne(
        { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
        { $set: { workerId: workerB } }
      );

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        { $set: { workerId: workerB } }
      );

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerA, {
          _testHooks: {
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/is owned by worker 'w_35_07_B' \(expected 'w_35_07_A'\)/);

      expect(dropAttempted).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-08: Mandatory D35-08 proof: Interleaving Worker A paused, Worker B attempts takeover
  it('D35-08: Mandatory proof: Worker A pauses after authorization; Worker B cannot revoke and A is fenced if superseded', async () => {
    const runId = `run_35_08_${Date.now()}`;
    const workerA = 'w_35_08_A';
    const workerB = 'w_35_08_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d08_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('critical_data').insertOne({ payload: 'd35_08_critical' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');

      // Test interleaving: Worker A is paused after acquiring destructive drop authority
      let workerBTriedClaim = false;
      let workerBTriedCleanup = false;
      let dropExecutedByA = false;

      const originalDrop = db.dropDatabase.bind(db);
      db.dropDatabase = async () => {
        dropExecutedByA = true;
        return originalDrop();
      };

      try {
        await cleanupTestDatabase(conn, runId, workerA, {
          _testHooks: {
            beforeDropDatabase: async () => {
              // Worker A is PAUSED right here.
              // Worker B attempts to claim the database concurrently:
              try {
                await claimTestDatabaseOwnership(conn, runId, workerB);
              } catch (err: unknown) {
                workerBTriedClaim = true;
                expect((err as Error).message).toMatch(/is locked for cleanup/);
              }

              // Worker B attempts cleanup takeover:
              try {
                await cleanupTestDatabase(conn, runId, workerB);
              } catch (err: unknown) {
                workerBTriedCleanup = true;
                expect((err as Error).message).toMatch(/Refusing cleanup of another worker's database|in progress by another worker/);
              }

              // Verify that coordination registry prevents Worker B from stealing dropExecutionLock
              const lockBefore = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
              expect(lockBefore?.dropExecutionLock).toBe(true);
              expect(lockBefore?.cleanupOwner).toBe(workerA);
            },
          },
        });
      } finally {
        db.dropDatabase = originalDrop;
      }

      // Assertions for D35-08:
      // 1. Worker B was strictly prevented from claiming or revoking authority while A was in flight
      expect(workerBTriedClaim).toBe(true);
      expect(workerBTriedCleanup).toBe(true);

      // 2. Worker A safely finished its drop without interference
      expect(dropExecutedByA).toBe(true);

      // 3. Coordination registry is finalized to CLEANED
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
      expect(regDoc?.dropExecutionLock).toBe(false);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-09: Worker pauses while destructive operation is in flight -> Authority cannot be reassigned unsafely
  it('D35-09: Worker pauses while destructive drop is in flight: database cannot be claimed by another run', async () => {
    const runIdA = `run_35_09_A_${Date.now()}`;
    const runIdB = `run_35_09_B_${Date.now()}`;
    const workerId = 'w_35_09';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d09_test?replicaSet=rs0&directConnection=true`,
      { runId: runIdA, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runIdA, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_09' });

      let foreignRunRejected = false;
      await cleanupTestDatabase(conn, runIdA, workerId, {
        _testHooks: {
          beforeDropDatabase: async () => {
            // Attempt to claim by another run while drop is in flight
            try {
              await claimTestDatabaseOwnership(conn, runIdB, workerId);
            } catch (err: unknown) {
              foreignRunRejected = true;
              expect((err as Error).message).toMatch(/is locked for cleanup/);
            }
          },
        },
      });

      expect(foreignRunRejected).toBe(true);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-10: Two concurrent cleanup requests -> Exactly one destructive executor
  it('D35-10: Two concurrent cleanup requests by same worker: exactly one acquires drop authority', async () => {
    const runId = `run_35_10_${Date.now()}`;
    const workerId = 'w_35_10';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d10_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_10' });

      const results = await Promise.allSettled([
        cleanupTestDatabase(conn, runId, workerId),
        cleanupTestDatabase(conn, runId, workerId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one succeeds, the other is serialized and rejected with concurrency violation
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason.message).toMatch(
          /(?:drop is already in progress concurrently|cleanup authority superseded before drop|The database is currently being dropped)/
        );
      }
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-11: Crash before destructive command -> Safe retry recovers cleanly
  it('D35-11: Crash before destructive command: safe retry recovers cleanly without duplicate lock acquisition', async () => {
    const runId = `run_35_11_${Date.now()}`;
    const workerId = 'w_35_11';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d11_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_11' });

      // Crash after Stage 2 lock acquisition, before Stage 3 drop
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('SIMULATED_PRE_DROP_CRASH_D11');
            },
          },
        })
      ).rejects.toThrow('SIMULATED_PRE_DROP_CRASH_D11');

      // Retry by same worker recovers cleanly
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-12: Crash during destructive command -> No unsafe reassignment
  it('D35-12: Crash during destructive command: database cannot be claimed by another worker', async () => {
    const runId = `run_35_12_${Date.now()}`;
    const workerA = 'w_35_12_A';
    const workerB = 'w_35_12_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d12_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('test_items').insertOne({ item: 'd35_12' });

      // Simulate crash during dropDatabase
      const originalDrop = db.dropDatabase.bind(db);
      db.dropDatabase = async () => {
        throw new Error('SIMULATED_CRASH_DURING_DROP_D12');
      };

      try {
        await expect(cleanupTestDatabase(conn, runId, workerA)).rejects.toThrow('SIMULATED_CRASH_DURING_DROP_D12');
      } finally {
        db.dropDatabase = originalDrop;
      }

      // Worker B attempts to claim the database: must be rejected
      await expect(claimTestDatabaseOwnership(conn, runId, workerB)).rejects.toThrow(
        /is locked for cleanup/
      );
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-13: Crash after deletion before finalization -> Correct reconciliation
  it('D35-13: Crash after deletion before finalization: retry detects 0 collections and finalizes CLEANED', async () => {
    const runId = `run_35_13_${Date.now()}`;
    const workerId = 'w_35_13';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d13_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_13' });

      // Crash after dropDatabase, before registry marked CLEANED
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterDropBeforeCleaned: () => {
              throw new Error('CRASH_AFTER_DROP_D13');
            },
          },
        })
      ).rejects.toThrow('CRASH_AFTER_DROP_D13');

      // Retry: Stage 0 detects 0 collections, verifies registry DROP_IN_PROGRESS, and finalizes to CLEANED
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
      expect(regDoc?.dropExecutionLock).toBe(false);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-14: Network timeout with uncertain drop result -> No unsafe second executor
  it('D35-14: Network timeout with uncertain drop result: retry reconciles without second executor', async () => {
    const runId = `run_35_14_${Date.now()}`;
    const workerId = 'w_35_14';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d14_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_14' });

      // Wrap dropDatabase to execute real drop but throw timeout error to caller
      const origDrop = db.dropDatabase.bind(db);
      let dropExecuted = false;
      db.dropDatabase = async () => {
        await origDrop();
        dropExecuted = true;
        throw new Error('ETIMEDOUT: network partition during drop');
      };

      try {
        await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow('ETIMEDOUT');
      } finally {
        db.dropDatabase = origDrop;
      }

      expect(dropExecuted).toBe(true);

      // Retry by same worker verifies empty database and completes reconciliation
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-15: Registry unavailable before drop -> No destructive command
  it('D35-15: Registry error during sync aborts before drop; database remains intact', async () => {
    const runId = `run_35_15_${Date.now()}`;
    const workerId = 'w_35_15';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d15_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_15' });

      let dropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            simulateRegistryError: true,
            beforeDropDatabase: () => {
              dropAttempted = true;
            },
          },
        })
      ).rejects.toThrow('SIMULATED_REGISTRY_ERROR');

      expect(dropAttempted).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-16: Registry unavailable during cleanup -> Defined safe recovery behavior
  it('D35-16: Transient registry failure recovers safely on subsequent retry', async () => {
    const runId = `run_35_16_${Date.now()}`;
    const workerId = 'w_35_16';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d16_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_16' });

      // First call fails with simulated registry error
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            simulateRegistryError: true,
          },
        })
      ).rejects.toThrow('SIMULATED_REGISTRY_ERROR');

      // Subsequent retry without error finishes cleanup successfully
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-17: Old process resumes after executor restart -> Cannot issue stale destructive command
  it('D35-17: Mandatory proof: Old process resumes after executor restart; cannot issue stale drop', async () => {
    const runId = `run_35_17_${Date.now()}`;
    const workerId = 'w_35_17';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d17_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_17' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');

      // Simulate Old Process 1 entering drop phase, but pausing inside beforeDropDatabase
      // While Old Process 1 is paused, Executor 2 restarts and completes cleanup to CLEANED
      let staleDropAttempted = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeDropDatabase: async () => {
              // Executor 2 completed the drop and marked registry CLEANED
              await coordCol.updateOne(
                { _id: dbName as unknown as import('mongodb').ObjectId },
                { $set: { lifecycleState: 'CLEANED', dropExecutionLock: false, dropExecutionToken: 'new_token_exec_2' } }
              );
              staleDropAttempted = true;
            },
          },
        })
      ).rejects.toThrow(/cleanup authority superseded before drop/);

      expect(staleDropAttempted).toBe(true);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-18: Duplicate cleanup request -> Idempotent or explicit safe rejection
  it('D35-18: Duplicate cleanup request on already CLEANED database returns idempotently without error', async () => {
    const runId = `run_35_18_${Date.now()}`;
    const workerId = 'w_35_18';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d18_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_18' });

      // First cleanup
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      // Duplicate cleanup request on already cleaned database: returns cleanly
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-19: Different worker attempts recovery -> Rejected
  it('D35-19: Different worker attempting recovery on locked database is rejected fail-closed', async () => {
    const runId = `run_35_19_${Date.now()}`;
    const workerA = 'w_35_19_A';
    const workerB = 'w_35_19_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d19_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('test_items').insertOne({ item: 'd35_19' });

      // Crash worker A in CLEANUP_LOCKED
      await expect(
        cleanupTestDatabase(conn, runId, workerA, {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('CRASH_A_D19');
            },
          },
        })
      ).rejects.toThrow('CRASH_A_D19');

      // Worker B attempts to clean it up: strictly rejected
      await expect(cleanupTestDatabase(conn, runId, workerB)).rejects.toThrow(
        /Refusing cleanup of another worker's database|is owned by worker/
      );
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-20: Different run attempts recovery -> Rejected
  it('D35-20: Different run attempting recovery on locked database is rejected fail-closed', async () => {
    const runA = `run_35_20_A_${Date.now()}`;
    const runB = `run_35_20_B_${Date.now()}`;
    const workerId = 'w_35_20';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d20_test?replicaSet=rs0&directConnection=true`,
      { runId: runA, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runA, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_20' });

      // Crash in CLEANUP_LOCKED
      await expect(
        cleanupTestDatabase(conn, runA, workerId, {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('CRASH_RUN_A_D20');
            },
          },
        })
      ).rejects.toThrow('CRASH_RUN_A_D20');

      // Run B attempts recovery: strictly rejected
      await expect(cleanupTestDatabase(conn, runB, workerId)).rejects.toThrow(
        /Refusing cleanup of another run's database|is owned by run/
      );
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D35-21: Reserved database -> Rejected
  it('D35-21: Reserved system database cleanup attempts are rejected immediately', async () => {
    const runId = `run_35_21_${Date.now()}`;
    const workerId = 'w_35_21';
    const conn = await mongoose.createConnection(`mongodb://127.0.0.1:27018/admin?directConnection=true`).asPromise();

    try {
      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /refusing cleanup on reserved\/production database 'admin'/
      );
    } finally {
      await conn.close();
    }
  });

  // D35-22: Non-test database -> Rejected
  it('D35-22: Non-test database missing _test suffix is rejected immediately', async () => {
    const runId = `run_35_22_${Date.now()}`;
    const workerId = 'w_35_22';
    const conn = await mongoose.createConnection(`mongodb://127.0.0.1:27018/custom_application_db?directConnection=true`).asPromise();

    try {
      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /is not a designated test database\. Refusing cleanup\./
      );
    } finally {
      await conn.close();
    }
  });

  // D35-23: Malformed identity -> Rejected
  it('D35-23: Malformed or missing runId and workerId are rejected before database access', async () => {
    const conn = await mongoose.createConnection(`mongodb://127.0.0.1:27018/decision_os_v35_d23_test?directConnection=true`).asPromise();

    try {
      await expect(cleanupTestDatabase(conn, '', 'worker1')).rejects.toThrow(/mandatory runId is missing/);
      await expect(cleanupTestDatabase(conn, 'run1', '')).rejects.toThrow(/mandatory workerId is missing/);
      await expect(cleanupTestDatabase(conn, 'run@invalid!', 'worker1')).rejects.toThrow(/malformed runId/);
      await expect(cleanupTestDatabase(conn, 'run1', 'worker@invalid!')).rejects.toThrow(/malformed workerId/);
    } finally {
      await conn.close();
    }
  });

  // D35-24: Repeated retry -> Generation and ownership remain correct
  it('D35-24: Repeated retries maintain correct generation and ownership without unbounded growth', async () => {
    const runId = `run_35_24_${Date.now()}`;
    const workerId = 'w_35_24';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v35_d24_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'd35_24' });

      // First crash: Stage 2 lock acquired, gen incremented to 1
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('CRASH_1_D24');
            },
          },
        })
      ).rejects.toThrow('CRASH_1_D24');

      // Second crash: Retry recognizes CLEANUP_LOCKED, retains gen 1
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('CRASH_2_D24');
            },
          },
        })
      ).rejects.toThrow('CRASH_2_D24');

      const metaCol = db.collection('__test_run_metadata');
      const docAfter2 = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });
      expect(docAfter2?.cleanupGeneration).toBe(1);

      // Final retry succeeds and completes drop
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
      expect(regDoc?.cleanupGeneration).toBe(1);
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
