import { describe, it, expect, afterEach } from 'vitest';
import {
  connectToDatabase,
  disconnectFromDatabase,
  isDatabaseConnected,
  checkDatabaseHealth,
} from '../../src/db/connection';
import { assertTestDatabase } from '../../src/db/guard';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

describe('MongoDB Connection & Lifecycle Integration', () => {
  // Ensure the test database safety guard is verified before any connection attempt
  assertTestDatabase(TEST_MONGODB_URI);

  afterEach(async () => {
    await disconnectFromDatabase();
  });

  it('connects to real MongoDB instance successfully', async () => {
    const conn = await connectToDatabase(TEST_MONGODB_URI);
    expect(conn).toBeDefined();
    expect(isDatabaseConnected()).toBe(true);

    const health = await checkDatabaseHealth();
    expect(health.status).toBe('connected');
    expect(typeof health.latencyMs).toBe('number');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('re-uses existing connection without duplicating', async () => {
    const conn1 = await connectToDatabase(TEST_MONGODB_URI);
    const conn2 = await connectToDatabase(TEST_MONGODB_URI);
    expect(conn1).toBe(conn2);
    expect(isDatabaseConnected()).toBe(true);
  });

  it('disconnects cleanly and reports disconnected health', async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    expect(isDatabaseConnected()).toBe(true);

    await disconnectFromDatabase();
    expect(isDatabaseConnected()).toBe(false);

    const health = await checkDatabaseHealth();
    expect(health.status).toBe('disconnected');
    expect(health.error).toBeDefined();
  });

  it('fails fast on unreachable database and sanitizes error without leaking credentials', async () => {
    const unreachableUri = 'mongodb://fakeUser:secretP@ss@127.0.0.1:27999/decision_os_test';

    // Must still pass test database name check
    assertTestDatabase(unreachableUri);

    await expect(
      connectToDatabase(unreachableUri, { serverSelectionTimeoutMS: 1500, connectTimeoutMS: 1500 })
    ).rejects.toThrowError(/Failed to connect to MongoDB at/);

    try {
      await connectToDatabase(unreachableUri, { serverSelectionTimeoutMS: 1500, connectTimeoutMS: 1500 });
      expect.unreachable('Should have thrown connection error');
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toContain('***:***@');
      expect(message).not.toContain('fakeUser');
      expect(message).not.toContain('secretP@ss');
    }
  });
});
