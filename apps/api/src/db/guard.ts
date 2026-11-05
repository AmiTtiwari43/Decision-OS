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

export type TestDatabaseLifecycleState = 'OWNED' | 'CLEANUP_LOCKED' | 'CLEANED';

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
  cleanedAt?: Date;
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

  if (!lock) {
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
 * Fenced by cleanup generation and idempotent for crash recovery retries.
 */
export async function cleanupTestDatabase(
  connection: Connection,
  runId: string,
  workerId: string,
  cleanupGeneration: number = 1
): Promise<void> {
  const { runId: cleanRun, workerId: cleanWorker } = validateTestIdentity(runId, workerId);
  const db = connection.db;
  if (!db) return;

  const collections = await db.listCollections().toArray();
  if (collections.length === 0) {
    // Database was already dropped in a previous crash-recovery attempt
    return;
  }

  await assertCanCleanupTestDatabase(connection, runId, workerId);

  const dbName = db.databaseName;
  const metaCol = db.collection('__test_run_metadata');

  // Atomically acquire cleanup lock to prevent competing cleanup or ownership changes
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
        cleanupGeneration,
        cleanupStartedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!cleanupLock) {
    // If atomic transition failed, check if this is an idempotent retry by the same cleanup owner
    const existing = await metaCol.findOne({
      _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
    });

    if (!existing) {
      // Database was already dropped in a previous crash-recovery attempt
      return;
    }

    if (
      existing.runId === cleanRun &&
      existing.cleanupOwner === cleanWorker &&
      existing.lifecycleState === 'CLEANUP_LOCKED' &&
      existing.cleanupGeneration === cleanupGeneration
    ) {
      // Idempotent retry by the same crash-recovery cleanup owner with matching generation
      await db.dropDatabase();
      return;
    }

    if (existing.cleanupGeneration && existing.cleanupGeneration > cleanupGeneration) {
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup generation ${cleanupGeneration} is superseded by newer generation ${existing.cleanupGeneration}.`
      );
    }

    throw new Error(
      `Safety guard violation: database '${dbName}' cleanup lock acquisition failed (already in progress or ownership lost).`
    );
  }

  await db.dropDatabase();
}
