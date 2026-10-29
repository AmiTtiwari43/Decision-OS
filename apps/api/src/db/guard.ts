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
 * Tests must REFUSE to execute unless the database name strictly ends with '_test'.
 *
 * @throws {Error} If the database name cannot be extracted or does not end with '_test'.
 */
export function assertTestDatabase(uri: string): void {
  const dbName = getDatabaseNameFromUri(uri);
  const sanitizedUri = sanitizeMongoUri(uri);

  if (!dbName) {
    throw new Error(
      `Test database safety guard violation: could not extract database name from URI (${sanitizedUri}). Test database name must end with '_test'.`
    );
  }

  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Test database safety guard violation: database '${dbName}' in URI (${sanitizedUri}) does not end with '_test'. Refusing to execute tests against a potential non-test database.`
    );
  }
}
