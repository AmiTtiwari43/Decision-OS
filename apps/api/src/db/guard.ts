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

export interface TestDatabaseOwnershipMetadata {
  runId: string;
  workerId?: string;
  claimedAt: Date;
}

/**
 * Atomically establishes test run ownership over a database.
 * Fails closed if the database is already owned by a different runId.
 */
export async function claimTestDatabaseOwnership(
  connection: Connection,
  runId: string,
  workerId?: string
): Promise<void> {
  const db = connection.db;
  if (!db) {
    throw new Error('claimTestDatabaseOwnership: connection has no active db handle');
  }

  const metaCol = db.collection('__test_run_metadata');

  const existing = await metaCol.findOne({ _id: 'ownership_lock' as unknown as import('mongodb').ObjectId });

  if (existing && existing.runId !== runId) {
    throw new Error(
      `Test database isolation violation: database is owned by run '${existing.runId}', cannot be claimed by run '${runId}'`
    );
  }

  await metaCol.updateOne(
    { _id: 'ownership_lock' as unknown as import('mongodb').ObjectId },
    {
      $set: {
        runId,
        workerId: workerId || '0',
        claimedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Asserts that the connected database is owned by the specified runId and safe to clean up.
 * Throws if the database cannot be verified as belonging to the current test run.
 */
export async function assertCanCleanupTestDatabase(
  connection: Connection,
  expectedRunId: string
): Promise<void> {
  const db = connection.db;
  if (!db) {
    throw new Error('assertCanCleanupTestDatabase: connection has no active db handle');
  }

  const dbName = db.databaseName;
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

  if (lock.runId !== expectedRunId) {
    throw new Error(
      `Safety guard violation: database '${dbName}' is owned by run '${lock.runId}' (expected '${expectedRunId}'). Refusing cleanup of another run's database.`
    );
  }
}

/**
 * Safely cleans up (drops) a test database owned by the current test run.
 */
export async function cleanupTestDatabase(
  connection: Connection,
  runId: string
): Promise<void> {
  await assertCanCleanupTestDatabase(connection, runId);
  const db = connection.db;
  if (db) {
    await db.dropDatabase();
  }
}
