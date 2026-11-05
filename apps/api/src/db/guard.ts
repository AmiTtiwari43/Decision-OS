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
  dropExecutionLock?: boolean;
  dropExecutionToken?: string;
  executorPid?: number;
  dropStartedAt?: Date;
  dropRetriedAt?: Date;
  cleanedAt?: Date;
}

export interface CleanupTestInjectionHooks {
  beforeLockAcquisition?: () => Promise<void> | void;
  afterLockAcquired?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  afterRegistrySync?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  afterCoordDropLock?: (metadata: TestDatabaseOwnershipMetadata, token?: string) => Promise<void> | void;
  beforeDropDatabase?: (metadata: TestDatabaseOwnershipMetadata, token?: string) => Promise<void> | void;
  overrideDropDatabase?: (originalDrop: () => Promise<unknown>) => Promise<unknown>;
  afterDropBeforeCleaned?: () => Promise<void> | void;
  simulateRegistryError?: boolean;
}

export interface CleanupTestOptions {
  expectedGeneration?: number;
  signal?: AbortSignal;
  _testHooks?: CleanupTestInjectionHooks;
}

/**
 * Verifies whether an OS process with the given PID has terminated.
 * Uses process.kill(pid, 0) which tests for process existence without sending a signal.
 * - If ESRCH is thrown: the process does not exist (confirmed terminated).
 * - If no error: the process is alive.
 * - If EPERM or any other error: process exists or status cannot be verified (treated as alive / fail-closed).
 */
export function isExecutorTerminated(pid?: number): boolean {
  if (pid === undefined || pid === null || typeof pid !== 'number' || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'ESRCH') {
      return true;
    }
    return false;
  }
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
    const client =
      typeof connection.getClient === 'function'
        ? connection.getClient()
        : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;

    if (client) {
      const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
      const existingCoord = await coordCol.findOne({
        _id: dbName as unknown as import('mongodb').ObjectId,
      });
      if (
        existingCoord &&
        (existingCoord.dropExecutionLock === true ||
          (existingCoord.lifecycleState === 'DROP_IN_PROGRESS' && existingCoord.cleanupInProgress === true))
      ) {
        throw new Error(
          `Test database safety guard violation: database '${dbName}' is locked for cleanup in coordination registry (state: '${existingCoord.lifecycleState}'). Re-entry prohibited.`
        );
      }
    }

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
            dropInProgress: false,
            dropExecutionLock: false,
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
                dropInProgress: false,
                dropExecutionLock: false,
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
    if (!coordCol) {
      throw new Error(
        `Safety guard violation: database '${dbName}' has no collections and coordination registry is unavailable. Refusing cleanup.`
      );
    }

    const regDoc = await coordCol.findOne({
      _id: dbName as unknown as import('mongodb').ObjectId,
    });

    if (!regDoc) {
      throw new Error(
        `Safety guard violation: database '${dbName}' has no collections and no verified cleanup lock in registry. Refusing cleanup.`
      );
    }

    if (regDoc.runId !== cleanRun) {
      throw new Error(
        `Safety guard violation: database '${dbName}' is owned by run '${regDoc.runId}' (expected '${cleanRun}'). Refusing cleanup of another run's database.`
      );
    }

    if (regDoc.workerId !== cleanWorker && regDoc.cleanupOwner !== cleanWorker) {
      throw new Error(
        `Safety guard violation: database '${dbName}' is owned by worker '${regDoc.workerId || regDoc.cleanupOwner}' (expected '${cleanWorker}'). Refusing cleanup of another worker's database.`
      );
    }

    if (
      regDoc.lifecycleState !== 'CLEANUP_LOCKED' &&
      regDoc.lifecycleState !== 'DROP_IN_PROGRESS' &&
      regDoc.lifecycleState !== 'CLEANED'
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' has invalid lifecycle state '${regDoc.lifecycleState}' in registry for empty database. Refusing cleanup.`
      );
    }

    if (regDoc.cleanupGeneration === undefined) {
      throw new Error(
        `Safety guard violation: database '${dbName}' coordination record has missing cleanupGeneration. Refusing cleanup.`
      );
    }

    if (
      expectedGen !== undefined &&
      regDoc.cleanupGeneration !== expectedGen
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup generation ${expectedGen} is superseded by newer generation ${regDoc.cleanupGeneration}.`
      );
    }

    if (regDoc.lifecycleState === 'CLEANED') {
      return;
    }

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
          dropExecutionLock: false,
        },
      }
    );
    return;
  }

  if (testHooks?.beforeLockAcquisition) {
    await testHooks.beforeLockAcquisition();
  }

  await assertCanCleanupTestDatabase(connection, runId, workerId);

  if (!coordCol) {
    throw new Error(
      `Safety guard violation: coordination registry unavailable. Refusing cleanup.`
    );
  }

  const existingCoord = await coordCol.findOne({
    _id: dbName as unknown as import('mongodb').ObjectId,
  });

  if (!existingCoord) {
    throw new Error(
      `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing cleanup.`
    );
  }

  if (existingCoord.runId !== cleanRun) {
    throw new Error(
      `Safety guard violation: database '${dbName}' is owned by run '${existingCoord.runId}' (expected '${cleanRun}'). Refusing cleanup of another run's database.`
    );
  }

  if (
    existingCoord.workerId !== cleanWorker &&
    existingCoord.cleanupOwner !== cleanWorker
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' is owned by worker '${existingCoord.workerId || existingCoord.cleanupOwner}' (expected '${cleanWorker}'). Refusing cleanup of another worker's database.`
    );
  }

  if (existingCoord.lifecycleState === 'CLEANED') {
    throw new Error(
      `Safety guard violation: database '${dbName}' is already cleaned.`
    );
  }

  if (
    existingCoord.dropExecutionLock === true &&
    existingCoord.executorPid !== undefined &&
    existingCoord.executorPid !== process.pid &&
    !isExecutorTerminated(existingCoord.executorPid)
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' drop is in progress by active executor PID ${existingCoord.executorPid}. Refusing concurrent or superseded execution while old executor is alive.`
    );
  }

  if (
    existingCoord.dropExecutionLock === true &&
    (existingCoord.executorPid === undefined ||
      existingCoord.executorPid === null ||
      !isExecutorTerminated(existingCoord.executorPid)) &&
    existingCoord.executorPid !== process.pid
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' drop is locked by prior executor (PID: ${existingCoord.executorPid ?? 'unknown'}). Cannot confirm termination; refusing reassignment fail-closed.`
    );
  }

  if (
    expectedGen !== undefined &&
    existingCoord.cleanupGeneration !== undefined &&
    existingCoord.cleanupGeneration !== expectedGen
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' cleanup generation ${expectedGen} is superseded by newer generation ${existingCoord.cleanupGeneration}.`
    );
  }

  if (
    existingCoord.lifecycleState !== 'OWNED' &&
    existingCoord.cleanupGeneration === undefined
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' coordination record has missing cleanupGeneration. Refusing cleanup.`
    );
  }

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
      if (
        existing.lifecycleState === 'DROP_IN_PROGRESS' &&
        existing.executorPid !== undefined &&
        existing.executorPid !== process.pid &&
        !isExecutorTerminated(existing.executorPid)
      ) {
        throw new Error(
          `Safety guard violation: database '${dbName}' drop is in progress by active executor PID ${existing.executorPid}. Refusing concurrent retry while executor process is alive.`
        );
      }
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

  if (!coordCol) {
    throw new Error(
      `Safety guard violation: coordination registry unavailable. Refusing cleanup.`
    );
  }

  const coordSync = await coordCol.findOneAndUpdate(
    {
      _id: dbName as unknown as import('mongodb').ObjectId,
      runId: cleanRun,
      $and: [
        {
          $or: [
            { workerId: cleanWorker },
            { cleanupOwner: cleanWorker },
          ],
        },
        {
          $or: [
            { cleanupGeneration: { $lte: activeGeneration } },
            { cleanupGeneration: { $exists: false }, lifecycleState: 'OWNED' },
          ],
        },
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
        dropExecutionLock: false,
        cleanupStartedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!coordSync) {
    throw new Error(
      `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing cleanup.`
    );
  }

  if (testHooks?.afterRegistrySync) {
    await testHooks.afterRegistrySync(currentMetadata);
  }

  // Stage 3: Atomically transition from CLEANUP_LOCKED to DROP_IN_PROGRESS in target database
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
        dropExecutionLock: true,
        executorPid: process.pid,
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

  // Atomically acquire exclusive destructive drop authority in independent coordination registry
  const currentDropToken = `drop_token_${cleanWorker}_${activeGeneration}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const coordDropLock = await coordCol.findOneAndUpdate(
    {
      _id: dbName as unknown as import('mongodb').ObjectId,
      runId: cleanRun,
      cleanupOwner: cleanWorker,
      cleanupGeneration: activeGeneration,
      lifecycleState: { $in: ['CLEANUP_LOCKED', 'DROP_IN_PROGRESS'] },
      $or: [
        { dropExecutionLock: { $ne: true } },
        ...(isRetry ? [{ dropExecutionLock: true, cleanupOwner: cleanWorker }] : []),
      ],
    },
    {
      $set: {
        lifecycleState: 'DROP_IN_PROGRESS',
        dropInProgress: true,
        dropExecutionLock: true,
        dropExecutionToken: currentDropToken,
        executorPid: process.pid,
        dropStartedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!coordDropLock) {
    // Explicit fail-closed diagnosis: check why authority was denied
    const existingCoord = await coordCol.findOne({
      _id: dbName as unknown as import('mongodb').ObjectId,
    });
    if (!existingCoord) {
      throw new Error(
        `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing destructive drop.`
      );
    }
    if (existingCoord.runId !== cleanRun) {
      throw new Error(
        `Safety guard violation: database '${dbName}' is owned by run '${existingCoord.runId}' (expected '${cleanRun}'). Refusing drop.`
      );
    }
    if (existingCoord.cleanupOwner && existingCoord.cleanupOwner !== cleanWorker) {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup is in progress by another worker '${existingCoord.cleanupOwner}'. Refusing drop.`
      );
    }
    if (
      existingCoord.cleanupGeneration !== undefined &&
      existingCoord.cleanupGeneration > activeGeneration
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup authority superseded before drop (stale generation ${activeGeneration}, active ${existingCoord.cleanupGeneration}).`
      );
    }
    if (existingCoord.lifecycleState === 'CLEANED') {
      throw new Error(
        `Safety guard violation: database '${dbName}' is already cleaned in coordination registry.`
      );
    }
    if (
      existingCoord.dropExecutionLock === true &&
      existingCoord.executorPid !== undefined &&
      existingCoord.executorPid !== process.pid &&
      !isExecutorTerminated(existingCoord.executorPid)
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' drop is in progress by active executor PID ${existingCoord.executorPid}. Refusing concurrent or superseded execution while old executor is alive.`
      );
    }
    throw new Error(
      `Safety guard violation: database '${dbName}' destructive drop authority not acquired from coordination registry. Refusing drop.`
    );
  }

  if (testHooks?.afterCoordDropLock) {
    await testHooks.afterCoordDropLock(dropLock as unknown as TestDatabaseOwnershipMetadata, currentDropToken);
  }

  if (testHooks?.beforeDropDatabase) {
    await testHooks.beforeDropDatabase(dropLock as unknown as TestDatabaseOwnershipMetadata, currentDropToken);
  }

  // Pre-drop atomic verification of coordination authority: fails closed if missing, superseded, or token mismatch
  const verifiedCoord = await coordCol.findOne({
    _id: dbName as unknown as import('mongodb').ObjectId,
  });

  if (!verifiedCoord) {
    throw new Error(
      `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing destructive drop.`
    );
  }

  if (
    verifiedCoord.runId !== cleanRun ||
    verifiedCoord.cleanupOwner !== cleanWorker ||
    (verifiedCoord.cleanupGeneration !== undefined && verifiedCoord.cleanupGeneration > activeGeneration) ||
    verifiedCoord.lifecycleState === 'CLEANED' ||
    verifiedCoord.dropExecutionToken !== currentDropToken ||
    verifiedCoord.dropExecutionLock !== true
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' cleanup authority superseded before drop (revoked or stale generation ${activeGeneration} or token mismatch).`
    );
  }

  // In-process supervised execution gate & AbortController
  const dropAbortController = new AbortController();

  if (optionsOrGeneration && typeof optionsOrGeneration === 'object' && optionsOrGeneration.signal) {
    if (optionsOrGeneration.signal.aborted) {
      dropAbortController.abort();
    } else {
      optionsOrGeneration.signal.addEventListener('abort', () => dropAbortController.abort(), { once: true });
    }
  }

  const executeGuardedDrop = async () => {
    // 1. In-process synchronous abort check
    if (dropAbortController.signal.aborted) {
      throw new Error(
        `Safety guard violation: database '${dbName}' destructive drop aborted: execution authority was revoked or cancelled before dispatch.`
      );
    }

    // 2. Pre-wire verification directly against coordination registry immediately prior to native drop
    const preWireCoord = await coordCol.findOne({
      _id: dbName as unknown as import('mongodb').ObjectId,
    });

    if (!preWireCoord) {
      dropAbortController.abort();
      throw new Error(
        `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing destructive drop.`
      );
    }

    if (
      preWireCoord.runId !== cleanRun ||
      preWireCoord.cleanupOwner !== cleanWorker ||
      (preWireCoord.cleanupGeneration !== undefined && preWireCoord.cleanupGeneration > activeGeneration) ||
      preWireCoord.lifecycleState !== 'DROP_IN_PROGRESS' ||
      preWireCoord.dropExecutionToken !== currentDropToken ||
      preWireCoord.dropExecutionLock !== true
    ) {
      dropAbortController.abort();
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup authority superseded before drop (revoked or stale generation ${activeGeneration} or token mismatch).`
      );
    }

    if (dropAbortController.signal.aborted) {
      throw new Error(
        `Safety guard violation: database '${dbName}' destructive drop aborted: execution authority was revoked or cancelled before dispatch.`
      );
    }

    // 3. Issue native MongoDB drop
    await db.dropDatabase();
  };

  // Execute dropDatabase through guarded dispatcher
  if (testHooks?.overrideDropDatabase) {
    await testHooks.overrideDropDatabase(() => executeGuardedDrop());
  } else {
    await executeGuardedDrop();
  }

  if (testHooks?.afterDropBeforeCleaned) {
    await testHooks.afterDropBeforeCleaned();
  }

  // Stage 4: Mark CLEANED in coordination registry
  await coordCol.updateOne(
    {
      _id: dbName as unknown as import('mongodb').ObjectId,
      runId: cleanRun,
      cleanupGeneration: activeGeneration,
      lifecycleState: 'DROP_IN_PROGRESS',
      dropExecutionToken: currentDropToken,
    },
    {
      $set: {
        lifecycleState: 'CLEANED',
        cleanupInProgress: false,
        dropInProgress: false,
        dropExecutionLock: false,
        cleanedAt: new Date(),
      },
    }
  );
}
