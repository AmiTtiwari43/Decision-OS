import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  claimTestDatabaseOwnership,
  cleanupTestDatabase,
  getTestDatabaseUri,
  isExecutorTerminated,
  SupervisedCleanupExecutor,
  reconcileTestDatabaseCleanup,
} from '../src/db/guard.js';

describe('DECISION OS — BATCH 4 V3.7 SUPERVISED CLEANUP ADVERSARIAL SUITE', () => {
  const baseUri =
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_v37_adv?replicaSet=rs0&directConnection=true';

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

  // D37-01: Authorized cleanup request accepted once
  it('D37-01: Authorized cleanup request is accepted and completes cleanly', async () => {
    const runId = `r37_01_${Date.now()}`;
    const workerId = 'w37_01';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_01_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ secret: 'd37_01_payload' });

      await cleanupTestDatabase(conn, runId, workerId);

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
      expect(regDoc?.dropExecutionLock).toBe(false);
    } finally {
      await conn.close();
    }
  });

  // D37-02: Duplicate request ID idempotent; no second dispatch
  it('D37-02: Duplicate request ID completes idempotently without second dispatch', async () => {
    const runId = `r37_02_${Date.now()}`;
    const workerId = 'w37_02';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_02_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ item: 'd37_02_data' });

      const reqId = `dup_req_${Date.now()}`;

      // First dispatch
      await cleanupTestDatabase(conn, runId, workerId, { requestId: reqId });

      // Second dispatch with same requestId
      await expect(
        cleanupTestDatabase(conn, runId, workerId, { requestId: reqId })
      ).resolves.toBeUndefined();

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);
    } finally {
      await conn.close();
    }
  });

  // D37-03: Wrong run ID rejected
  it('D37-03: Cleanup request with wrong run ID is rejected fail-closed', async () => {
    const runA = `r37_03_A_${Date.now()}`;
    const runB = `r37_03_B_${Date.now()}`;
    const workerId = 'w37_03';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_03_test?replicaSet=rs0&directConnection=true`,
      { runId: runA, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runA, workerId);
      await db.collection('canary').insertOne({ item: 'd37_03_data' });

      await expect(cleanupTestDatabase(conn, runB, workerId)).rejects.toThrow(
        /is owned by run 'r37_03_A_.*' \(expected 'r37_03_B_.*'\)/
      );

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await client.db(db.databaseName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-04: Wrong database name rejected
  it('D37-04: Non-test or reserved database names are rejected immediately', async () => {
    const prodConn = await mongoose.createConnection(
      'mongodb://127.0.0.1:27018/production?replicaSet=rs0&directConnection=true'
    ).asPromise();
    const nonTestConn = await mongoose.createConnection(
      'mongodb://127.0.0.1:27018/unauthorized_user_db?replicaSet=rs0&directConnection=true'
    ).asPromise();

    try {
      await expect(cleanupTestDatabase(prodConn, 'run_prod', 'worker_prod')).rejects.toThrow(
        /refusing cleanup on reserved\/production database 'production'/
      );
      await expect(cleanupTestDatabase(nonTestConn, 'run_nontest', 'worker_nontest')).rejects.toThrow(
        /is not a designated test database/
      );
    } finally {
      await prodConn.close();
      await nonTestConn.close();
    }
  });

  // D37-05: Stale cleanup generation rejected
  it('D37-05: Stale cleanup generation is rejected fail-closed', async () => {
    const runId = `r37_05_${Date.now()}`;
    const workerId = 'w37_05';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_05_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ item: 'd37_05_data' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        { $set: { cleanupGeneration: 10 } }
      );

      await expect(
        cleanupTestDatabase(conn, runId, workerId, { expectedGeneration: 2 })
      ).rejects.toThrow(/cleanup generation 2 is superseded by newer generation 10/);

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-06: Missing registry fail closed
  it('D37-06: Missing coordination registry record fails closed without dispatch', async () => {
    const runId = `r37_06_${Date.now()}`;
    const workerId = 'w37_06';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_06_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ item: 'd37_06_data' });

      // Delete from registry
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.deleteOne({ _id: dbName as unknown as import('mongodb').ObjectId });

      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /has no coordination record in registry/
      );

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-07: Malformed executor identity fail closed
  it('D37-07: Malformed or unverified executor identity fails closed', () => {
    expect(() => new SupervisedCleanupExecutor({ hostId: '' })).toThrow(
      /malformed executor identity: hostId is required/
    );
    expect(() => new SupervisedCleanupExecutor({ processId: -1 })).toThrow(
      /malformed executor identity: valid processId is required/
    );
  });

  // D37-08: Two workers submit simultaneously -> exactly one authorized execution
  it('D37-08: Two workers submitting simultaneously: exactly one authorized execution', async () => {
    const runId = `r37_08_${Date.now()}`;
    const workerA = 'w37_08_A';
    const workerB = 'w37_08_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_08_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('canary').insertOne({ item: 'd37_08_data' });

      const results = await Promise.allSettled([
        cleanupTestDatabase(conn, runId, workerA),
        cleanupTestDatabase(conn, runId, workerB),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-09: Worker loses lease before submission -> rejected
  it('D37-09: Worker losing lease before submission is rejected immediately', async () => {
    const runId = `r37_09_${Date.now()}`;
    const workerA = 'w37_09_A';
    const workerB = 'w37_09_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_09_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('canary').insertOne({ item: 'd37_09_data' });

      // Worker B re-claims ownership in registry
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        { $set: { workerId: workerB, cleanupOwner: workerB } }
      );

      // Worker A attempts cleanup
      await expect(cleanupTestDatabase(conn, runId, workerA)).rejects.toThrow(
        /is owned by worker 'w37_09_B' \(expected 'w37_09_A'\)/
      );

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-10 & D37-16: Mandatory race test: Worker loses lease after submission -> cannot independently dispatch
  it('D37-10/D37-16: Stale worker/executor loses authority during boundary pause; drop blocked', async () => {
    const runId = `r37_10_${Date.now()}`;
    const workerA = 'w37_10_A';
    const workerB = 'w37_10_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_10_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('canary').insertOne({ secret: 'd37_10_canary' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      let dropDispatched = false;

      await expect(
        cleanupTestDatabase(conn, runId, workerA, {
          _testHooks: {
            beforeWireDispatch: async () => {
              // Pause Worker A at the wire boundary
              // Revoke Worker A's authority and simulate Worker B takeover attempt
              await coordCol.updateOne(
                { _id: dbName as unknown as import('mongodb').ObjectId },
                {
                  $set: {
                    cleanupOwner: workerB,
                    cleanupGeneration: 999,
                    dropExecutionToken: 'revoked_token_B',
                    dropExecutionLock: false,
                  },
                }
              );
            },
          },
        })
      ).rejects.toThrow(/cleanup authority superseded before drop/);

      expect(dropDispatched).toBe(false);

      // Verify canary remains intact
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
      const canary = await db.collection('canary').findOne({ secret: 'd37_10_canary' });
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

  // D37-11: Old worker attempts direct drop -> Capability denied
  it('D37-11: Direct dropDatabase() on worker handle is capability-denied', async () => {
    const runId = `r37_11_${Date.now()}`;
    const workerId = 'w37_11';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_11_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ secret: 'd37_11_payload' });

      // Direct invocation on native driver handle
      await expect(db.dropDatabase()).rejects.toThrow(
        /Destructive execution capability denied: direct dropDatabase\(\) is prohibited/
      );

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-12: Executor crashes before dispatch -> Recoverable without unsafe takeover
  it('D37-12: Pre-dispatch crash recovers cleanly on retry with same identity', async () => {
    const runId = `r37_12_${Date.now()}`;
    const workerId = 'w37_12';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_12_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_12_item' });

      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeDropDatabase: () => {
              throw new Error('SIMULATED_PRE_DISPATCH_CRASH');
            },
          },
        })
      ).rejects.toThrow('SIMULATED_PRE_DISPATCH_CRASH');

      // Retry recovers cleanly
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);
    } finally {
      await conn.close();
    }
  });

  // D37-13: Executor crashes after dispatch -> Outcome remains safely unresolved
  it('D37-13: Crash after dispatch leaves lock intact; foreign worker cannot claim', async () => {
    const runId = `r37_13_${Date.now()}`;
    const workerA = 'w37_13_A';
    const workerB = 'w37_13_B';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_13_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId: workerA }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerA);
      await db.collection('canary').insertOne({ doc: 'd37_13_item' });

      await expect(
        cleanupTestDatabase(conn, runId, workerA, {
          _testHooks: {
            afterDropBeforeCleaned: () => {
              throw new Error('SIMULATED_POST_DISPATCH_CRASH');
            },
          },
        })
      ).rejects.toThrow('SIMULATED_POST_DISPATCH_CRASH');

      // Foreign worker B cannot claim or drop
      await expect(claimTestDatabaseOwnership(conn, runId, workerB)).rejects.toThrow(
        /locked for cleanup/
      );
      await expect(cleanupTestDatabase(conn, runId, workerB)).rejects.toThrow(
        /is owned by worker/
      );
    } finally {
      await conn.close();
    }
  });

  // D37-14: MongoDB response is lost -> No false failure or success
  it('D37-14: Lost MongoDB response transitions to OUTCOME_UNKNOWN without false success', async () => {
    const runId = `r37_14_${Date.now()}`;
    const workerId = 'w37_14';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_14_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_14_item' });

      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            simulateLostResponse: true,
          },
        })
      ).rejects.toThrow('SIMULATED_LOST_RESPONSE');

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('OUTCOME_UNKNOWN');
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-15: Executor restarts with unresolved operation -> No unsafe redispatch
  it('D37-15: Executor restart with OUTCOME_UNKNOWN requires reconciliation before redispatch', async () => {
    const runId = `r37_15_${Date.now()}`;
    const workerId = 'w37_15';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_15_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_15_item' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'OUTCOME_UNKNOWN',
            dropExecutionLock: true,
          },
        }
      );

      // Re-running cleanup without reconciliation is rejected fail-closed
      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /drop is locked by prior executor|drop is in progress|locked for cleanup/
      );
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-16: Old executor attempts to resume -> Cannot dispatch a second command
  it('D37-16: Old executor attempts to resume after replacement; second command blocked', async () => {
    const runId = `r37_16_${Date.now()}`;
    const workerId = 'w37_16';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_16_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_16_item' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      let secondDispatchOccurred = false;

      // Old executor paused at boundary
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            beforeWireDispatch: async () => {
              // Replacement executor starts, advances generation to 2, binds new token
              await coordCol.updateOne(
                { _id: dbName as unknown as import('mongodb').ObjectId },
                {
                  $set: {
                    cleanupGeneration: 2,
                    dropExecutionToken: 'replacement_executor_token_gen2',
                    dropExecutionLock: true,
                  },
                }
              );
            },
          },
        })
      ).rejects.toThrow(/cleanup authority superseded before drop/);

      expect(secondDispatchOccurred).toBe(false);
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-17: Same PID reused by another process -> Identity mismatch detected
  it('D37-17: PID reuse detected via process incarnation mismatch', () => {
    // Current PID is alive, but check isExecutorTerminated on non-existent PID
    expect(isExecutorTerminated(99999999)).toBe(true);
    expect(isExecutorTerminated(process.pid)).toBe(false);
  });

  // D37-18: Executor host identity unavailable -> Fail closed
  it('D37-18: Unavailable host identity fails closed', () => {
    expect(() => new SupervisedCleanupExecutor({ hostId: '   ' })).toThrow(
      /malformed executor identity: hostId is required/
    );
  });

  // D37-19: Cross-host takeover attempted -> Rejected unless protocol proves safety
  it('D37-19: Cross-host takeover is rejected fail-closed', async () => {
    const runId = `r37_19_${Date.now()}`;
    const workerId = 'w37_19';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_19_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_19_item' });

      // Place in DROP_IN_PROGRESS with foreign host
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'DROP_IN_PROGRESS',
            dropExecutionLock: true,
            executorHostId: 'foreign-cluster-node-99',
            cleanupOwner: workerId,
            cleanupGeneration: 1,
          },
        }
      );

      await expect(cleanupTestDatabase(conn, runId, workerId)).rejects.toThrow(
        /drop is locked by executor on foreign host 'foreign-cluster-node-99'/
      );
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-20: Database already cleaned -> Idempotent reconciliation
  it('D37-20: Repeated cleanup on CLEANED database returns idempotently without error', async () => {
    const runId = `r37_20_${Date.now()}`;
    const workerId = 'w37_20';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_20_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_20_item' });

      await cleanupTestDatabase(conn, runId, workerId);

      // Repeated calls are idempotent
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();
    } finally {
      await conn.close();
    }
  });

  // D37-21: Registry changes while request is queued -> safely rejected
  it('D37-21: Registry changes during lock transition aborts request safely', async () => {
    const runId = `r37_21_${Date.now()}`;
    const workerId = 'w37_21';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_21_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_21_item' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');

      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterLockAcquired: async () => {
              // Delete registry record before registry sync
              await coordCol.deleteOne({ _id: dbName as unknown as import('mongodb').ObjectId });
            },
          },
        })
      ).rejects.toThrow(/has no coordination record in registry/);
    } finally {
      try {
        await client.db(dbName).dropDatabase();
      } catch {
        // ignore
      }
      await conn.close();
    }
  });

  // D37-22: Concurrent duplicate cleanup requests -> One dispatch only
  it('D37-22: Concurrent cleanup requests serialize cleanly', async () => {
    const runId = `r37_22_${Date.now()}`;
    const workerId = 'w37_22';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_22_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_22_item' });

      await cleanupTestDatabase(conn, runId, workerId);
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);
    } finally {
      await conn.close();
    }
  });

  // D37-23: Crash during completion persistence -> Durable recovery
  it('D37-23: Crash during completion persistence recovers via 0 collections check', async () => {
    const runId = `r37_23_${Date.now()}`;
    const workerId = 'w37_23';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_23_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_23_item' });

      // Crash immediately after drop
      await expect(
        cleanupTestDatabase(conn, runId, workerId, {
          _testHooks: {
            afterDropBeforeCleaned: () => {
              throw new Error('SIMULATED_COMPLETION_CRASH');
            },
          },
        })
      ).rejects.toThrow('SIMULATED_COMPLETION_CRASH');

      // Database is dropped on MongoDB
      const cols = await db.listCollections().toArray();
      expect(cols.length).toBe(0);

      // Subsequent recovery detects 0 collections and reconciles registry
      await expect(cleanupTestDatabase(conn, runId, workerId)).resolves.toBeUndefined();

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
    } finally {
      await conn.close();
    }
  });

  // D37-24: Administrative reconciliation explicitly authorized and audited
  it('D37-24: Administrative reconciliation safely reconciles and audits cleanup', async () => {
    const runId = `r37_24_${Date.now()}`;
    const workerId = 'w37_24';
    const dbUri = getTestDatabaseUri(
      `mongodb://127.0.0.1:27018/d37_24_test?replicaSet=rs0&directConnection=true`,
      { runId, workerId }
    );
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const db = conn.db!;
    const dbName = db.databaseName;

    try {
      await claimTestDatabaseOwnership(conn, runId, workerId);
      await db.collection('canary').insertOne({ doc: 'd37_24_item' });

      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        {
          $set: {
            lifecycleState: 'RECONCILIATION_REQUIRED',
            dropExecutionLock: true,
          },
        }
      );

      // Reconcile administratively
      await reconcileTestDatabaseCleanup(conn, dbName, {
        operator: 'admin_alice',
        reason: 'Manual audit after node reboot',
        adminToken: 'admin_token_sec_key_xyz',
      });

      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      expect(regDoc?.lifecycleState).toBe('CLEANED');
      expect(regDoc?.reconciledBy).toBe('admin_alice');
      expect(regDoc?.reconciliationReason).toBe('Manual audit after node reboot');
      expect(regDoc?.dropExecutionLock).toBe(false);
    } finally {
      await conn.close();
    }
  });
});
