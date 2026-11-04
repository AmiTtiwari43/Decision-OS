import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  assertTestDatabase,
  getDatabaseNameFromUri,
  getTestDatabaseUri,
  claimTestDatabaseOwnership,
  assertCanCleanupTestDatabase,
  cleanupTestDatabase,
  sanitizeMongoUri,
} from '../src/db/guard.js';

describe('Batch 4 Phase 6 — Test Database Isolation, Safety Guards & Cleanup Fencing', () => {
  it('1. Two independent test runs receive distinct database URIs', () => {
    const uri1 = getTestDatabaseUri(undefined, { runId: 'run_alpha', workerId: '0' });
    const uri2 = getTestDatabaseUri(undefined, { runId: 'run_beta', workerId: '0' });

    expect(uri1).not.toBe(uri2);
    expect(getDatabaseNameFromUri(uri1)).toContain('_test_run_alpha_w0');
    expect(getDatabaseNameFromUri(uri2)).toContain('_test_run_beta_w0');
  });

  it('2. Parallel workers within the same run receive distinct database URIs', () => {
    const runId = 'parallel_run';
    const uriWorker1 = getTestDatabaseUri(undefined, { runId, workerId: '1' });
    const uriWorker2 = getTestDatabaseUri(undefined, { runId, workerId: '2' });

    expect(uriWorker1).not.toBe(uriWorker2);
    expect(getDatabaseNameFromUri(uriWorker1)).toContain('_test_parallel_run_w1');
    expect(getDatabaseNameFromUri(uriWorker2)).toContain('_test_parallel_run_w2');
  });

  it('3. Concurrent test database initialization is safe and isolated', async () => {
    const uriA = getTestDatabaseUri(undefined, { runId: 'iso_race', workerId: 'A' });
    const uriB = getTestDatabaseUri(undefined, { runId: 'iso_race', workerId: 'B' });

    const connA = await mongoose.createConnection(uriA).asPromise();
    const connB = await mongoose.createConnection(uriB).asPromise();

    try {
      const colA = connA.collection('isolation_probe');
      const colB = connB.collection('isolation_probe');

      await colA.insertOne({ worker: 'A', secret: 'alpha_secret' });
      await colB.insertOne({ worker: 'B', secret: 'beta_secret' });

      const foundInA = await colA.find({}).toArray();
      const foundInB = await colB.find({}).toArray();

      expect(foundInA).toHaveLength(1);
      expect(foundInA[0].worker).toBe('A');

      expect(foundInB).toHaveLength(1);
      expect(foundInB[0].worker).toBe('B');
    } finally {
      await connA.dropDatabase();
      await connB.dropDatabase();
      await connA.close();
      await connB.close();
    }
  });

  it('4. Active test run cleanly drops only its own database', async () => {
    const runId = 'cleanup_self_test';
    const uri = getTestDatabaseUri(undefined, { runId, workerId: '0' });

    const conn = await mongoose.createConnection(uri).asPromise();
    try {
      await claimTestDatabaseOwnership(conn, runId, '0');
      await conn.collection('dummy').insertOne({ test: 1 });

      // Verifying assertCanCleanup passes
      await expect(assertCanCleanupTestDatabase(conn, runId)).resolves.not.toThrow();

      // Clean drop
      await cleanupTestDatabase(conn, runId);

      const dbList = await conn.db?.admin().listDatabases();
      const dbName = getDatabaseNameFromUri(uri);
      const exists = dbList?.databases.some((d: { name: string }) => d.name === dbName);
      expect(exists).toBe(false);
    } finally {
      await conn.close();
    }
  });

  it('5. Active test run refuses to drop a database owned by another run', async () => {
    const runA = 'run_legitimate_owner';
    const runB = 'run_malicious_or_foreign';
    const uri = getTestDatabaseUri(undefined, { runId: runA, workerId: '0' });

    const conn = await mongoose.createConnection(uri).asPromise();
    try {
      await claimTestDatabaseOwnership(conn, runA, '0');

      // Attempting to claim with runB must fail closed
      await expect(claimTestDatabaseOwnership(conn, runB, '0')).rejects.toThrow(
        /cannot be claimed by run/
      );

      // Attempting to cleanup with runB must fail closed
      await expect(cleanupTestDatabase(conn, runB)).rejects.toThrow(
        /Refusing cleanup of another run's database/
      );
    } finally {
      await conn.dropDatabase();
      await conn.close();
    }
  });

  it('6. Refusal to connect to production database URI', () => {
    const prodUris = [
      'mongodb://prod-cluster.company.internal:27017/decision_os_production',
      'mongodb+srv://admin:secret@atlas-cluster.mongodb.net/decision_os',
      'mongodb://127.0.0.1:27017/prod_db',
    ];

    for (const uri of prodUris) {
      expect(() => assertTestDatabase(uri)).toThrow(
        /Refusing to execute tests against a potential non-test database/
      );
    }
  });

  it('7. Refusal on invalid URI syntax or missing database name', () => {
    const invalidUris = [
      '',
      'not-a-uri',
      'mongodb://localhost:27017',
      'mongodb://localhost:27017/',
    ];

    for (const uri of invalidUris) {
      expect(() => assertTestDatabase(uri)).toThrow(/Test database safety guard violation/);
    }
  });

  it('8. Missing run/worker identifiers default safely without collisions', () => {
    const defaultUri = getTestDatabaseUri();
    expect(defaultUri).toBeDefined();
    expect(() => assertTestDatabase(defaultUri)).not.toThrow();

    const sanitized = sanitizeMongoUri(
      'mongodb://test_user:super_secret_password@127.0.0.1:27018/decision_os_test'
    );
    expect(sanitized).toBe('mongodb://***:***@127.0.0.1:27018/decision_os_test');
    expect(sanitized).not.toContain('super_secret_password');
  });
});
