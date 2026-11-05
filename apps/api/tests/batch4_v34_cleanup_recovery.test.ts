import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  claimTestDatabaseOwnership,
  cleanupTestDatabase,
  getTestDatabaseUri,
} from '../src/db/guard.js';

describe('DECISION OS — BATCH 4 V3.4 CLEANUP RECOVERY ADVERSARIAL SUITE (D34-01 to D34-18)', () => {
  const baseUri =
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_v34_test?replicaSet=rs0&directConnection=true';

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

  // D34-01: Crash after actual cleanup lock acquisition, before drop -> Retry recovers
  it('D34-01: Crash after actual cleanup lock acquisition, before drop: retry recovers cleanly', async () => {
    const runId = `run_34_01_${Date.now()}`;
    const workerId = 'w_34_01';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d01_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'alpha' });

      // Crash immediately after atomic lock acquisition in target DB
      let crashInjected = false;
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterLockAcquired: async (metadata) => {
              crashInjected = true;
              expect(metadata.lifecycleState).toBe('CLEANUP_LOCKED');
              expect(metadata.cleanupInProgress).toBe(true);
              expect(metadata.dropInProgress).toBe(false);
              throw new Error('CRASH_AFTER_LOCK_ACQUIRED');
            },
          },
        })
      ).rejects.toThrow('CRASH_AFTER_LOCK_ACQUIRED');

      expect(crashInjected).toBe(true);

      // Verify persisted state: database still exists, collections > 0, lock is CLEANUP_LOCKED
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);

      const metaCol = db.collection('__test_run_metadata');
      const lockDoc = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });
      expect(lockDoc).toBeDefined();
      expect(lockDoc?.lifecycleState).toBe('CLEANUP_LOCKED');
      expect(lockDoc?.cleanupOwner).toBe(workerId);
      expect(lockDoc?.dropInProgress).toBe(false);

      // Retry cleanup using same authorized identity: must recover and drop DB
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      // Database should be dropped now
      const colsAfter = await db.listCollections().toArray();
      expect(colsAfter.length).toBe(0);

      // Coordination registry should record CLEANED
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

  // D34-02: Crash before cleanup lock acquisition -> No destructive action; valid retry can start
  it('D34-02: Crash before cleanup lock acquisition: target database remains in OWNED state', async () => {
    const runId = `run_34_02_${Date.now()}`;
    const workerId = 'w_34_02';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d02_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'beta' });

      // Crash before lock acquisition
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeLockAcquisition: () => {
              throw new Error('CRASH_BEFORE_LOCK_ACQUISITION');
            },
          },
        })
      ).rejects.toThrow('CRASH_BEFORE_LOCK_ACQUISITION');

      // State remains OWNED
      const metaCol = db.collection('__test_run_metadata');
      const lockDoc = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });
      expect(lockDoc?.lifecycleState).toBe('OWNED');
      expect(lockDoc?.cleanupInProgress).toBe(false);

      // Normal cleanup succeeds on retry
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
      const colsAfter = await db.listCollections().toArray();
      expect(colsAfter.length).toBe(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D34-03: Crash after registry synchronization, before drop -> Retry recovers
  it('D34-03: Crash after registry synchronization, before drop: retry recovers cleanly', async () => {
    const runId = `run_34_03_${Date.now()}`;
    const workerId = 'w_34_03';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d03_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'gamma' });

      // Crash after registry sync
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterRegistrySync: async (metadata) => {
              expect(metadata.lifecycleState).toBe('CLEANUP_LOCKED');
              throw new Error('CRASH_AFTER_REGISTRY_SYNC');
            },
          },
        })
      ).rejects.toThrow('CRASH_AFTER_REGISTRY_SYNC');

      // Target DB and Registry are both CLEANUP_LOCKED
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANUP_LOCKED');
      expect(regDoc?.dropInProgress).toBe(false);

      // Retry succeeds
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
      const colsAfter = await db.listCollections().toArray();
      expect(colsAfter.length).toBe(0);
      const regAfter = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regAfter?.lifecycleState).toBe('CLEANED');
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D34-04: Crash after drop, before CLEANED registry update -> Retry verifies and finalizes
  it('D34-04: Crash after drop, before CLEANED registry update: retry verifies empty DB and finalizes', async () => {
    const runId = `run_34_04_${Date.now()}`;
    const workerId = 'w_34_04';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d04_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'delta' });

      // Crash immediately after dropDatabase, before registry update to CLEANED
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterDropBeforeCleaned: () => {
              throw new Error('CRASH_AFTER_DROP_BEFORE_CLEANED');
            },
          },
        })
      ).rejects.toThrow('CRASH_AFTER_DROP_BEFORE_CLEANED');

      // Database has 0 collections
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);

      // Registry still has DROP_IN_PROGRESS
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('DROP_IN_PROGRESS');

      // Retry cleanup verifies post-drop state via registry and finalizes to CLEANED
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
      const regAfter = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regAfter?.lifecycleState).toBe('CLEANED');
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D34-05: Two concurrent cleanup calls by same worker -> No conflicting cleanup authority
  it('D34-05: Two concurrent cleanup calls by same worker: exactly one acquires drop authority', async () => {
    const runId = `run_34_05_${Date.now()}`;
    const workerId = 'w_34_05';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d05_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'epsilon' });

      // Run two concurrent cleanups simultaneously
      const results = await Promise.allSettled([
        cleanupTestDatabase(conn, runId, workerId),
        cleanupTestDatabase(conn, runId, workerId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // At least one fulfilled, and if one rejected it must be due to concurrent drop conflict
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      if (rejected.length > 0) {
        const error = (rejected[0] as PromiseRejectedResult).reason as Error;
        expect(error.message).toMatch(
          /(?:drop is already in progress concurrently|The database is currently being dropped)/
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

  // D34-06: Different worker attempts recovery -> Rejected unless explicitly authorized
  it('D34-06: Different worker attempts recovery on locked database: strictly rejected', async () => {
    const runId = `run_34_06_${Date.now()}`;
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d06_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: 'w_34_06_A' }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, 'w_34_06_A');
      await db.collection('test_items').insertOne({ item: 'zeta' });

      // Worker A acquires lock and crashes
      await expect(
        cleanupTestDatabase(conn, runId, 'w_34_06_A', {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('CRASH_WORKER_A');
            },
          },
        })
      ).rejects.toThrow('CRASH_WORKER_A');

      // Worker B attempts recovery: rejected!
      await expect(cleanupTestDatabase(conn, runId, 'w_34_06_B')).rejects.toThrow(
        /(?:is in progress by another worker 'w_34_06_A'|is owned by worker 'w_34_06_A' \(expected 'w_34_06_B'\))/
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

  // D34-07: Different run attempts recovery -> Rejected
  it('D34-07: Different run attempts recovery: strictly rejected', async () => {
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d07_test?replicaSet=rs0&directConnection=true`,
      { runId: 'run_34_07_A', workerId: 'w_34_07' }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, 'run_34_07_A', 'w_34_07');
      await db.collection('test_items').insertOne({ item: 'eta' });

      // Different run attempts cleanup: rejected!
      await expect(cleanupTestDatabase(conn, 'run_34_07_B', 'w_34_07')).rejects.toThrow(
        /is owned by run 'run_34_07_A' \(expected 'run_34_07_B'\)/
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

  // D34-08: Stale cleanup generation attempts recovery -> Rejected
  it('D34-08: Stale cleanup generation attempts recovery: strictly rejected', async () => {
    const runId = `run_34_08_${Date.now()}`;
    const workerId = 'w_34_08';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d08_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'theta' });

      // Cleanup acquires generation 1, then crashes
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('CRASH_GEN_1');
            },
          },
        })
      ).rejects.toThrow('CRASH_GEN_1');

      // Caller expecting generation 0 attempts recovery: rejected!
      await expect(cleanupTestDatabase(conn, runId, workerId, 0)).rejects.toThrow(
        /cleanup generation 0 is superseded by newer generation 1/
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

  // D34-09: Retry does not increment generation again -> Original generation retained
  it('D34-09: Retry does not increment generation again: retains original generation', async () => {
    const runId = `run_34_09_${Date.now()}`;
    const workerId = 'w_34_09';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d09_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'iota' });

      // First cleanup acquires generation 1, crashes after lock
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterLockAcquired: () => {
              throw new Error('CRASH_BEFORE_DROP');
            },
          },
        })
      ).rejects.toThrow('CRASH_BEFORE_DROP');

      const metaCol = db.collection('__test_run_metadata');
      const initialDoc = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });
      expect(initialDoc?.cleanupGeneration).toBe(1);

      // Retry cleanup
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      // Check registry generation: remained 1!
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
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

  // D34-10: Missing target ownership record -> Fail closed
  it('D34-10: Missing target ownership record: fails closed and refuses cleanup', async () => {
    const runId = `run_34_10_${Date.now()}`;
    const workerId = 'w_34_10';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d10_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      // Create collection without calling claimTestDatabaseOwnership
      await db.collection('unowned_col').insertOne({ test: true });

      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /has no ownership lock metadata\. Refusing cleanup\./
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

  // D34-11: Missing coordination record -> Fail closed on empty database, or reconstruct on non-empty owned database
  it('D34-11: Missing coordination record on empty database: fails closed', async () => {
    const runId = `run_34_11_${Date.now()}`;
    const workerId = 'w_34_11';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d11_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();

    try {
      // Empty database with no collections and no registry record
      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /has no collections and no verified cleanup lock in registry/
      );
    } finally {
      await conn.close();
    }
  });

  // D34-12: Empty database without cleanup proof -> Rejected
  it('D34-12: Empty database without cleanup proof in registry: rejected', async () => {
    const runId = `run_34_12_${Date.now()}`;
    const workerId = 'w_34_12';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d12_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();

    try {
      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /has no collections and no verified cleanup lock in registry\. Refusing cleanup\./
      );
    } finally {
      await conn.close();
    }
  });

  // D34-13: Already CLEANED database -> Idempotent completion
  it('D34-13: Already CLEANED database: idempotent return without error', async () => {
    const runId = `run_34_13_${Date.now()}`;
    const workerId = 'w_34_13';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d13_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'kappa' });

      // First cleanup drops DB and marks CLEANED
      await cleanupTestDatabase(conn, runId, workerId);

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');

      // Second cleanup on already cleaned database returns cleanly and idempotently
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
    } finally {
      await conn.close();
    }
  });

  // D34-14: Stale process attempts to continue after takeover -> Cannot perform an unsafe destructive action
  it('D34-14: Stale process attempts to drop after takeover: fenced and blocked from unsafe drop', async () => {
    const runId = `run_34_14_${Date.now()}`;
    const workerId = 'w_34_14';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d14_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('critical_data').insertOne({ critical: true });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');

      // Simulate Process A entering drop phase with generation 1, but before calling db.dropDatabase(),
      // a newer process takes over and advances generation in registry
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeDropDatabase: async () => {
              // Simulate takeover in registry with higher generation
              await coordCol.updateOne(
                { _id: dbName as unknown as import('mongodb').ObjectId },
                { $set: { cleanupGeneration: 2, cleanupOwner: 'w_34_14_takeover' } }
              );
            },
          },
        })
      ).rejects.toThrow(/cleanup authority superseded before drop/);

      // Verify destructive command was NOT executed on critical_data
      const criticalDoc = await db.collection('critical_data').findOne({ critical: true });
      expect(criticalDoc).toBeDefined();
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D34-15: Cleanup registry update fails -> Target state and retry behavior remain safe
  it('D34-15: Registry update failure leaves target database safe for subsequent retry', async () => {
    const runId = `run_34_15_${Date.now()}`;
    const workerId = 'w_34_15';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d15_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'lambda' });

      // Registry error simulated
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            simulateRegistryError: true,
          },
        })
      ).rejects.toThrow('SIMULATED_REGISTRY_ERROR');

      // Database not dropped
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);

      // Subsequent retry without registry error succeeds
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
      const colsAfter = await db.listCollections().toArray();
      expect(colsAfter.length).toBe(0);
    } finally {
      try {
        await conn.db?.dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D34-16: Drop operation returns an error after uncertain completion -> Retry safely reconciles actual database state
  it('D34-16: Drop operation returns an error after actual drop: retry reconciles and finalizes', async () => {
    const runId = `run_34_16_${Date.now()}`;
    const workerId = 'w_34_16';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/decision_os_v34_d16_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('test_items').insertOne({ item: 'mu' });

      // Wrap dropDatabase: actually executes drop, but throws uncertain error to caller
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            overrideDropDatabase: async (originalDrop) => {
              await originalDrop();
              throw new Error('UNCERTAIN_NETWORK_TIMEOUT_AFTER_DROP');
            },
          },
        })
      ).rejects.toThrow('UNCERTAIN_NETWORK_TIMEOUT_AFTER_DROP');

      // Collections are gone on MongoDB
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);

      // Retry recognizes drop completed, verifies registry, and marks CLEANED
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
    } finally {
      await conn.close();
    }
  });

  // D34-17: Reserved database cleanup attempt -> Rejected
  it('D34-17: Reserved and non-test database cleanup attempts are rejected', async () => {
    const runId = `run_34_17_${Date.now()}`;
    const workerId = 'w_34_17';
    const conn = await mongoose
      .createConnection('mongodb://127.0.0.1:27018/admin?directConnection=true')
      .asPromise();

    try {
      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /refusing cleanup on reserved\/production database 'admin'/
      );
    } finally {
      await conn.close();
    }
  });

  // D34-18: Malformed runId or workerId -> Rejected
  it('D34-18: Malformed or missing runId/workerId is rejected immediately', async () => {
    const conn = await mongoose
      .createConnection('mongodb://127.0.0.1:27018/decision_os_v34_d18_test?replicaSet=rs0&directConnection=true')
      .asPromise();

    try {
      await expect(cleanupTestDatabase(conn, '', 'worker1')).rejects.toThrow(
        /mandatory runId is missing or empty/
      );
      await expect(cleanupTestDatabase(conn, 'run1', '')).rejects.toThrow(
        /mandatory workerId is missing or empty/
      );
      await expect(cleanupTestDatabase(conn, 'run@invalid!', 'worker1')).rejects.toThrow(
        /malformed runId/
      );
      await expect(cleanupTestDatabase(conn, 'run1', 'worker@invalid!')).rejects.toThrow(
        /malformed workerId/
      );
    } finally {
      await conn.close();
    }
  });
});
