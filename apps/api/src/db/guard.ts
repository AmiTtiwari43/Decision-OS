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
 * or an isolated worker test suffix (e.g. '_test_1', '_test_worker2').
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

  const isTestDb = dbName.endsWith('_test') || /_test(?:_[a-zA-Z0-9_-]+)?$/.test(dbName);
  if (!isTestDb) {
    throw new Error(
      `Test database safety guard violation: database '${dbName}' in URI (${sanitizedUri}) does not end with '_test'. Refusing to execute tests against a potential non-test database.`
    );
  }
}

/**
 * Returns an isolated test database URI for the current worker process if parallel execution is active.
 */
export function getTestDatabaseUri(baseUri?: string): string {
  const uri =
    baseUri ||
    process.env.TEST_MONGODB_URI ||
    'mongodb://127.0.0.1:27018/decision_os_test?replicaSet=rs0&directConnection=true';
  const poolId = process.env.VITEST_POOL_ID;
  if (poolId) {
    const dbName = getDatabaseNameFromUri(uri);
    if (dbName && !dbName.includes(`_test_${poolId}`)) {
      const newDbName = `${dbName}_${poolId}`;
      return uri.replace(`/${dbName}`, `/${newDbName}`);
    }
  }
  return uri;
}
