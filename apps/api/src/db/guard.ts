import type { Connection } from 'mongoose';

/**
 * Database safety guard and URI sanitization utilities.
 * Enforces that test environments strictly target databases ending with '_test'
 * and prevents credentials from leaking in logs or error messages.
 */

/**
 * Sanitizes a MongoDB connection URI by masking credentials (username and password).
 * If no credentials are present, returns the URI unchanged.
 */
export function sanitizeMongoUri(uri: string): string {
  if (!uri || typeof uri !== 'string') return '';
  // Masks mongodb://user:pass@host or mongodb+srv://user:pass@host
  return uri.replace(
    /(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/i,
    '$1***:***@'
  );
}

/**
 * Extracts the database name from a MongoDB connection string.
 * Handles both standard mongodb:// and mongodb+srv:// formats,
 * with or without query parameters and options.
 */
export function getDatabaseNameFromUri(uri: string): string | null {
  if (!uri || typeof uri !== 'string') return null;

  try {
    // Match the database name between the host portion and optional query parameters:
    // e.g. mongodb://localhost:27017/my_database?retryWrites=true -> my_database
    const match = uri.match(/^(?:mongodb(?:\+srv)?:\/\/[^/]+)\/([^?#]+)/i);
    if (match && match[1]) {
      const dbName = decodeURIComponent(match[1].trim());
      return dbName.length > 0 ? dbName : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Asserts that the provided MongoDB URI points to a designated test database.
 * Tests must REFUSE to execute unless the database name strictly ends with '_test'
 * or an isolated test suffix (e.g. '_test_1', '_test_worker2', '_test_run1_w1').
 *
 * @throws {Error} If the database name cannot be extracted or does not end with a test suffix.
 */
export function assertTestDatabase(uri: string): void {
  const dbName = getDatabaseNameFromUri(uri);
  const sanitizedUri = sanitizeMongoUri(uri);

  if (!dbName) {
    throw new Error(
      `Test database safety guard violation: could not extract database name from URI (${sanitizedUri}). Test database name must end with '_test'.`
    );
  }

  const isTestDb = dbName.endsWith('_test') || /_test(?:_[a-zA-Z0-9_-]+)+$/.test(dbName);
  if (!isTestDb) {
    throw new Error(
      `Test database safety guard violation: database '${dbName}' in URI (${sanitizedUri}) does not end with '_test'. Refusing to execute tests against a potential non-test database.`
    );
  }
}

export interface TestDatabaseUriOptions {
  runId?: string;
  workerId?: string;
}

let cachedRunId: string | null = null;

/**
 * Returns or generates a deterministic run identifier for this test run.
 */
export function getTestRunId(): string {
  if (process.env.TEST_RUN_ID) {
    return process.env.TEST_RUN_ID;
  }
  if (!cachedRunId) {
    cachedRunId = `run_${Date.now()}`;
  }
  return cachedRunId;
}

/**
 * Returns an isolated test database URI ensuring deterministic isolation
 * per run identifier and parallel worker identifier.
 */
export function getTestDatabaseUri(
  baseUri?: string,
  options?: TestDatabaseUriOptions
): string {
  const uri =
    baseUri ||
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_test?replicaSet=rs0&directConnection=true';

  const runId = options?.runId || process.env.TEST_RUN_ID;
  const workerId =
    options?.workerId ||
    process.env.VITEST_POOL_ID ||
    process.env.VITEST_WORKER_ID;

  if (runId || workerId) {
    const dbName = getDatabaseNameFromUri(uri);
    if (dbName) {
      const cleanRun = (runId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanWorker = (workerId || '0').replace(/[^a-zA-Z0-9_-]/g, '');
      const suffix = `_test_${cleanRun}_w${cleanWorker}`;

      if (!dbName.includes(suffix)) {
        // Strip existing _test suffix if present on base before appending full qualified test suffix
        const base = dbName.endsWith('_test') ? dbName.slice(0, -5) : dbName;
        const newDbName = `${base}${suffix}`;
        return uri.replace(`/${dbName}`, `/${newDbName}`);
      }
    }
  }

  return uri;
}

export type TestDatabaseLifecycleState =
  | 'OWNED'
  | 'CLEANUP_LOCKED'
  | 'DROP_IN_PROGRESS'
  | 'CLEANED';

export interface TestDatabaseOwnershipMetadata {
  runId: string;
  workerId: string;
  ownershipGeneration: number;
  lifecycleState: TestDatabaseLifecycleState;
  claimedAt: Date;
  lastClaimVerifiedAt?: Date;
  cleanupInProgress?: boolean;
  cleanupOwner?: string;
  cleanupGeneration?: number;
  cleanupStartedAt?: Date;
  dropInProgress?: boolean;
  dropStartedAt?: Date;
  dropRetriedAt?: Date;
  cleanedAt?: Date;
}

export interface CleanupTestInjectionHooks {
  beforeLockAcquisition?: () => Promise<void> | void;
  afterLockAcquired?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  afterRegistrySync?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  beforeDropDatabase?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  overrideDropDatabase?: (originalDrop: () => Promise<unknown>) => Promise<unknown>;
  afterDropBeforeCleaned?: () => Promise<void> | void;
  simulateRegistryError?: boolean;
}

export interface CleanupTestOptions {
  expectedGeneration?: number;
  _testHooks?: CleanupTestInjectionHooks;
}

/**
 * Validates that both runId and workerId are provided, non-empty, and well-formed.
 * Prevents identity omissions or cross-worker impersonation during test DB lifecycle.
 */
export function validateTestIdentity(
  runId: unknown,
  workerId: unknown
): { runId: string; workerId: string } {
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new Error('Test database safety guard violation: mandatory runId is missing or empty.');
  }
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new Error('Test database safety guard violation: mandatory workerId is missing or empty.');
  }
  const cleanRun = runId.trim();
  const cleanWorker = workerId.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanRun)) {
    throw new Error(`Test database safety guard violation: malformed runId '${cleanRun}'.`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanWorker)) {
    throw new Error(`Test database safety guard violation: malformed workerId '${cleanWorker}'.`);
  }
  return { runId: cleanRun, workerId: cleanWorker };
}

/**
 * Atomically establishes test run ownership over a database.
 * Replaces read-then-upsert race with strictly atomic insertOne conditional ownership.
 * Fails closed if the database is already owned by a different runId or workerId.
 * Strictly blocks re-entry if cleanup lock has been acquired or state is CLEANUP_LOCKED/CLEANED.
 */
export async function claimTestDatabaseOwnership(
  connection: Connection,
  runId: string,
  workerId: string
): Promise<void> {
  const { runId: cleanRun, workerId: cleanWorker } = validateTestIdentity(runId, workerId);

  const db = connection.db;
  if (!db) {
    throw new Error('claimTestDatabaseOwnership: connection has no active db handle');
  }

  const dbName = db.databaseName;

  if (dbName === 'production' || dbName === 'admin' || dbName === 'local' || dbName === 'config') {
    throw new Error(
      `Test database safety guard violation: refusing claim on reserved database '${dbName}'.`
    );
  }

  const isTestDb = dbName.endsWith('_test') || /_test(?:_[a-zA-Z0-9_-]+)+$/.test(dbName);
  if (!isTestDb) {
    throw new Error(
      `Test database safety guard violation: database '${dbName}' is not a designated test database. Refusing claim.`
    );
  }

  const metaCol = db.collection('__test_run_metadata');

  try {
    // Atomic unique claim via insertOne in OWNED state
    await metaCol.insertOne({
      _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
      runId: cleanRun,
      workerId: cleanWorker,
      ownershipGeneration: 1,
      lifecycleState: 'OWNED',
      cleanupInProgress: false,
      claimedAt: new Date(),
      lastClaimVerifiedAt: new Date(),
    });

    const client =
      typeof connection.getClient === 'function'
        ? connection.getClient()
        : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;
    if (client) {
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      await coordCol.updateOne(
        { _id: dbName as unknown as import('mongodb').ObjectId },
        {
          $set: {
            runId: cleanRun,
            workerId: cleanWorker,
            lifecycleState: 'OWNED',
            cleanupInProgress: false,
            claimedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }
  } catch (err: unknown) {
    const isDuplicateKey =
      err &&
      typeof err === 'object' &&
      ('code' in err) &&
      (err as { code?: number }).code === 11000;

    if (isDuplicateKey) {
      // Record already exists -> atomically verify conditional ownership re-claim.
      // Strictly rejected if cleanup is in progress or state is CLEANUP_LOCKED / CLEANED!
      const confirmedClaim = await metaCol.findOneAndUpdate(
        {
          _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
          runId: cleanRun,
          workerId: cleanWorker,
          lifecycleState: 'OWNED',
          cleanupInProgress: { $ne: true },
        },
        {
          $set: {
            lastClaimVerifiedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );

      if (confirmedClaim) {
        // Atomic verification succeeded: same run, same worker, active OWNED state
        const client =
          typeof connection.getClient === 'function'
            ? connection.getClient()
            : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;
        if (client) {
          const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
          await coordCol.updateOne(
            { _id: dbName as unknown as import('mongodb').ObjectId },
            {
              $set: {
                runId: cleanRun,
                workerId: cleanWorker,
                lifecycleState: 'OWNED',
                cleanupInProgress: false,
                lastClaimVerifiedAt: new Date(),
              },
            },
            { upsert: true }
          );
        }
        return;
      }

      // Conditional verification failed -> inspect existing metadata to throw exact typed violation
      const existing = await metaCol.findOne({
        _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
      });

      if (!existing) {
        throw new Error(
          `Test database isolation violation: ownership lock on database '${dbName}' was dropped or removed concurrently.`
        );
      }

      if (!existing.runId || !existing.workerId) {
        throw new Error(
          `Test database safety guard violation: database '${dbName}' has malformed or missing identity metadata.`
        );
      }

      if (
        existing.cleanupInProgress === true ||
        existing.lifecycleState === 'CLEANUP_LOCKED' ||
        existing.lifecycleState === 'DROP_IN_PROGRESS' ||
        existing.lifecycleState === 'CLEANED'
      ) {
        throw new Error(
          `Test database safety guard violation: database '${dbName}' is locked for cleanup or already cleaned (state: '${existing.lifecycleState || 'CLEANUP_LOCKED'}'). Re-entry prohibited.`
        );
      }

      if (existing.runId !== cleanRun || existing.workerId !== cleanWorker) {
        throw new Error(
          `Test database isolation violation: database is owned by run '${existing.runId}' worker '${existing.workerId || '0'}', cannot be claimed by run '${cleanRun}' worker '${cleanWorker}'`
        );
      }

      throw new Error(
        `Test database isolation violation: unable to acquire ownership of database '${dbName}'.`
      );
    }
    throw err;
  }
}

/**
 * Asserts that the connected database is owned by the specified runId and workerId, and safe to clean up.
 * Throws if the database cannot be verified as belonging to the current test run and worker.
 * Both runId and workerId are strictly mandatory.
 */
export async function assertCanCleanupTestDatabase(
  connection: Connection,
  runId: string,
  workerId: string
): Promise<void> {
  const { runId: cleanRun, workerId: cleanWorker } = validateTestIdentity(runId, workerId);

  const db = connection.db;
  if (!db) {
    throw new Error('assertCanCleanupTestDatabase: connection has no active db handle');
  }

  const dbName = db.databaseName;

  if (dbName === 'production' || dbName === 'admin' || dbName === 'local' || dbName === 'config') {
    throw new Error(
      `Safety guard violation: refusing cleanup on reserved/production database '${dbName}'.`
    );
  }

  const isTestDb = dbName.endsWith('_test') || /_test(?:_[a-zA-Z0-9_-]+)+$/.test(dbName);
  if (!isTestDb) {
    throw new Error(
      `Safety guard violation: database '${dbName}' is not a designated test database. Refusing cleanup.`
    );
  }

  const metaCol = db.collection('__test_run_metadata');
  const lock = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });

  const client =
    typeof connection.getClient === 'function'
      ? connection.getClient()
      : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;
  const coordCol = client
    ? client.db('decision_os_test_coordination_test').collection('cleanup_registry')
    : null;

  if (!lock) {
    if (coordCol) {
      const regDoc = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
      if (regDoc && regDoc.lifecycleState === 'CLEANED') {
        throw new Error(
          `Safety guard violation: database '${dbName}' is already cleaned.`
        );
      }
    }
    throw new Error(
      `Safety guard violation: database '${dbName}' has no ownership lock metadata. Refusing cleanup.`
    );
  }

  if (!lock.workerId) {
    throw new Error(
      `Safety guard violation: database '${dbName}' ownership record is missing workerId. Refusing cleanup.`
    );
  }

  if (!lock.runId) {
    throw new Error(
      `Safety guard violation: database '${dbName}' ownership record is missing or malformed identity fields. Refusing cleanup.`
    );
  }

  if (lock.runId !== cleanRun) {
    throw new Error(
      `Safety guard violation: database '${dbName}' is owned by run '${lock.runId}' (expected '${cleanRun}'). Refusing cleanup of another run's database.`
    );
  }

  if (lock.workerId !== cleanWorker) {
    throw new Error(
      `Safety guard violation: database '${dbName}' is owned by worker '${lock.workerId}' (expected '${cleanWorker}'). Refusing cleanup of another worker's database.`
    );
  }

  if (lock.lifecycleState === 'CLEANED') {
    throw new Error(
      `Safety guard violation: database '${dbName}' is already cleaned.`
    );
  }

  if (lock.cleanupInProgress === true && lock.cleanupOwner && lock.cleanupOwner !== cleanWorker) {
    throw new Error(
      `Safety guard violation: database '${dbName}' cleanup is in progress by another worker '${lock.cleanupOwner}'.`
    );
  }
}

/**
 * Safely cleans up (drops) a test database owned by the current test run and worker.
 * Uses an atomic cleanup-lock transition to eliminate concurrency race gaps between check and drop.
 * Fenced by cleanup generation (atomically advanced via $inc) and idempotent for crash recovery retries.
 * Employs an independent durable registry (decision_os_test_coordination_test.cleanup_registry)
 * to verify post-drop status and prevent empty databases from bypassing ownership.
 */
export async function cleanupTestDatabase(
  connection: Connection,
  runId: string,
  workerId: string,
  optionsOrGeneration?: number | CleanupTestOptions
): Promise<void> {
  const { runId: cleanRun, workerId: cleanWorker } = validateTestIdentity(runId, workerId);
  const db = connection.db;
  if (!db) return;

  const dbName = db.databaseName;

  if (dbName === 'production' || dbName === 'admin' || dbName === 'local' || dbName === 'config') {
    throw new Error(
      `Safety guard violation: refusing cleanup on reserved/production database '${dbName}'.`
    );
  }

  const isTestDb = dbName.endsWith('_test') || /_test(?:_[a-zA-Z0-9_-]+)+$/.test(dbName);
  if (!isTestDb) {
    throw new Error(
      `Safety guard violation: database '${dbName}' is not a designated test database. Refusing cleanup.`
    );
  }

  const expectedGen =
    typeof optionsOrGeneration === 'number'
      ? optionsOrGeneration
      : optionsOrGeneration?.expectedGeneration;

  const testHooks =
    typeof optionsOrGeneration === 'object' && optionsOrGeneration !== null
      ? optionsOrGeneration._testHooks
      : undefined;

  const client =
    typeof connection.getClient === 'function'
      ? connection.getClient()
      : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;
  const coordCol = client
    ? client.db('decision_os_test_coordination_test').collection('cleanup_registry')
    : null;

  const collections = await db.listCollections().toArray();
  if (collections.length === 0) {
    // Database has zero collections. Check independent durable registry for verified crash-recovery
    if (coordCol) {
      const regDoc = await coordCol.findOne({
        _id: dbName as unknown as import('mongodb').ObjectId,
      });

      if (
        regDoc &&
        regDoc.runId === cleanRun &&
        (regDoc.workerId === cleanWorker || regDoc.cleanupOwner === cleanWorker) &&
        (regDoc.lifecycleState === 'CLEANUP_LOCKED' ||
          regDoc.lifecycleState === 'DROP_IN_PROGRESS' ||
          regDoc.lifecycleState === 'CLEANED')
      ) {
        if (
          expectedGen !== undefined &&
          regDoc.cleanupGeneration !== undefined &&
          regDoc.cleanupGeneration !== expectedGen
        ) {
          throw new Error(
            `Safety guard violation: database '${dbName}' cleanup generation ${expectedGen} is superseded by newer generation ${regDoc.cleanupGeneration}.`
          );
        }
        if (regDoc.lifecycleState !== 'CLEANED') {
          await coordCol.updateOne(
            {
              _id: dbName as unknown as import('mongodb').ObjectId,
              runId: cleanRun,
              cleanupGeneration: regDoc.cleanupGeneration,
              lifecycleState: { $in: ['CLEANUP_LOCKED', 'DROP_IN_PROGRESS'] },
            },
            {
              $set: {
                lifecycleState: 'CLEANED',
                cleanedAt: new Date(),
                cleanupInProgress: false,
                dropInProgress: false,
              },
            }
          );
        }
        return;
      }
    }

    throw new Error(
      `Safety guard violation: database '${dbName}' has no collections and no verified cleanup lock in registry. Refusing cleanup.`
    );
  }

  if (testHooks?.beforeLockAcquisition) {
    await testHooks.beforeLockAcquisition();
  }

  await assertCanCleanupTestDatabase(connection, runId, workerId);

  const metaCol = db.collection('__test_run_metadata');

  let activeGeneration: number;
  let isRetry = false;

  // Atomically acquire cleanup lock to prevent competing cleanup or ownership changes
  // Advances cleanupGeneration atomically via $inc: { cleanupGeneration: 1 }
  // Transitions OWNED -> CLEANUP_LOCKED (dropInProgress remains false until DROP_IN_PROGRESS stage)
  const cleanupLock = await metaCol.findOneAndUpdate(
    {
      _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
      runId: cleanRun,
      workerId: cleanWorker,
      lifecycleState: 'OWNED',
      cleanupInProgress: { $ne: true },
    },
    {
      $set: {
        lifecycleState: 'CLEANUP_LOCKED',
        cleanupInProgress: true,
        cleanupOwner: cleanWorker,
        cleanupStartedAt: new Date(),
        dropInProgress: false,
      },
      $inc: {
        cleanupGeneration: 1,
      },
    },
    { returnDocument: 'after' }
  );

  if (!cleanupLock) {
    // Atomic transition from OWNED failed -> check existing metadata
    const existing = await metaCol.findOne({
      _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
    });

    if (!existing) {
      throw new Error(
        `Safety guard violation: database '${dbName}' has no ownership lock metadata. Refusing cleanup.`
      );
    }

    if (existing.runId !== cleanRun) {
      throw new Error(
        `Safety guard violation: database '${dbName}' is owned by run '${existing.runId}' (expected '${cleanRun}'). Refusing cleanup of another run's database.`
      );
    }

    if (existing.cleanupOwner && existing.cleanupOwner !== cleanWorker) {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup is in progress by another worker '${existing.cleanupOwner}'.`
      );
    }

    if (
      existing.workerId !== cleanWorker &&
      (!existing.cleanupOwner || existing.cleanupOwner !== cleanWorker)
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' is owned by worker '${existing.workerId}' (expected '${cleanWorker}'). Refusing cleanup of another worker's database.`
      );
    }

    if (
      expectedGen !== undefined &&
      existing.cleanupGeneration !== undefined &&
      existing.cleanupGeneration !== expectedGen
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup generation ${expectedGen} is superseded by newer generation ${existing.cleanupGeneration}.`
      );
    }

    if (existing.lifecycleState === 'CLEANED') {
      throw new Error(
        `Safety guard violation: database '${dbName}' is already cleaned.`
      );
    }

    if (
      (existing.lifecycleState === 'CLEANUP_LOCKED' ||
        existing.lifecycleState === 'DROP_IN_PROGRESS') &&
      existing.cleanupOwner === cleanWorker
    ) {
      // Valid idempotent retry by the same crash-recovery cleanup owner
      activeGeneration = existing.cleanupGeneration || 1;
      isRetry = true;
    } else {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup lock acquisition failed (already in progress or ownership lost).`
      );
    }
  } else {
    activeGeneration = cleanupLock.cleanupGeneration;
    isRetry = false;
  }

  const currentMetadata: TestDatabaseOwnershipMetadata = {
    runId: cleanRun,
    workerId: cleanWorker,
    ownershipGeneration: 1,
    lifecycleState: 'CLEANUP_LOCKED',
    claimedAt: new Date(),
    cleanupInProgress: true,
    cleanupOwner: cleanWorker,
    cleanupGeneration: activeGeneration,
    dropInProgress: false,
  };

  if (testHooks?.afterLockAcquired) {
    await testHooks.afterLockAcquired(currentMetadata);
  }

  // Synchronize CLEANUP_LOCKED state to independent coordination registry
  if (testHooks?.simulateRegistryError) {
    throw new Error('SIMULATED_REGISTRY_ERROR');
  }

  if (coordCol) {
    await coordCol.updateOne(
      {
        _id: dbName as unknown as import('mongodb').ObjectId,
        $or: [
          { runId: cleanRun, cleanupGeneration: { $lte: activeGeneration } },
          { runId: cleanRun, cleanupGeneration: { $exists: false } },
          { runId: cleanRun, lifecycleState: 'OWNED' },
        ],
      },
      {
        $set: {
          runId: cleanRun,
          workerId: cleanWorker,
          cleanupOwner: cleanWorker,
          cleanupGeneration: activeGeneration,
          lifecycleState: 'CLEANUP_LOCKED',
          cleanupInProgress: true,
          dropInProgress: false,
          cleanupStartedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  if (testHooks?.afterRegistrySync) {
    await testHooks.afterRegistrySync(currentMetadata);
  }

  // Stage 3: Atomically transition from CLEANUP_LOCKED to DROP_IN_PROGRESS
  // Serializes concurrent drops by the same worker and fences by cleanupGeneration
  const dropFilter: import('mongodb').Filter<import('mongodb').Document> = {
    _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
    runId: cleanRun,
    cleanupOwner: cleanWorker,
    cleanupGeneration: activeGeneration,
    $or: [
      { lifecycleState: 'CLEANUP_LOCKED', dropInProgress: { $ne: true } },
      ...(isRetry ? [{ lifecycleState: 'DROP_IN_PROGRESS', cleanupOwner: cleanWorker }] : []),
    ],
  };

  const dropLock = await metaCol.findOneAndUpdate(
    dropFilter,
    {
      $set: {
        lifecycleState: 'DROP_IN_PROGRESS',
        dropInProgress: true,
        dropStartedAt: new Date(),
        ...(isRetry ? { dropRetriedAt: new Date() } : {}),
      },
    },
    { returnDocument: 'after' }
  );

  if (!dropLock) {
    throw new Error(
      `Safety guard violation: database '${dbName}' drop is already in progress concurrently by worker '${cleanWorker}'.`
    );
  }

  // Synchronize DROP_IN_PROGRESS state to coordination registry
  if (coordCol) {
    await coordCol.updateOne(
      {
        _id: dbName as unknown as import('mongodb').ObjectId,
        runId: cleanRun,
        cleanupGeneration: activeGeneration,
        lifecycleState: { $in: ['CLEANUP_LOCKED', 'DROP_IN_PROGRESS'] },
      },
      {
        $set: {
          lifecycleState: 'DROP_IN_PROGRESS',
          dropInProgress: true,
          dropStartedAt: new Date(),
        },
      }
    );
  }

  if (testHooks?.beforeDropDatabase) {
    await testHooks.beforeDropDatabase(dropLock as unknown as TestDatabaseOwnershipMetadata);
  }

  // Fencing check before destructive drop: verify ownership and generation were not superseded
  if (coordCol) {
    const latestCoord = await coordCol.findOne({
      _id: dbName as unknown as import('mongodb').ObjectId,
    });
    if (
      latestCoord &&
      (latestCoord.runId !== cleanRun ||
        latestCoord.cleanupOwner !== cleanWorker ||
        (latestCoord.cleanupGeneration !== undefined && latestCoord.cleanupGeneration > activeGeneration) ||
        latestCoord.lifecycleState === 'CLEANED')
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup authority superseded before drop (stale generation ${activeGeneration}).`
      );
    }
  }

  // Execute dropDatabase
  if (testHooks?.overrideDropDatabase) {
    await testHooks.overrideDropDatabase(() => db.dropDatabase());
  } else {
    await db.dropDatabase();
  }

  if (testHooks?.afterDropBeforeCleaned) {
    await testHooks.afterDropBeforeCleaned();
  }

  // Stage 4: Mark CLEANED in coordination registry
  if (coordCol) {
    await coordCol.updateOne(
      {
        _id: dbName as unknown as import('mongodb').ObjectId,
        runId: cleanRun,
        cleanupGeneration: activeGeneration,
        lifecycleState: 'DROP_IN_PROGRESS',
      },
      {
        $set: {
          lifecycleState: 'CLEANED',
          cleanupInProgress: false,
          dropInProgress: false,
          cleanedAt: new Date(),
        },
      }
    );
  }
}
