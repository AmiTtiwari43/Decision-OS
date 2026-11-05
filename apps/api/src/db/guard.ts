import type { Connection } from 'mongoose';
import os from 'os';

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
  | 'AVAILABLE'
  | 'OWNED'
  | 'REQUESTED'
  | 'EXECUTOR_OWNED'
  | 'CLEANUP_LOCKED'
  | 'DROP_IN_PROGRESS'
  | 'CLEANED'
  | 'OUTCOME_UNKNOWN'
  | 'RECONCILIATION_REQUIRED'
  | 'EXECUTOR_UNAVAILABLE';

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
  executorHostId?: string;
  executorStartupGeneration?: string;
  executorGeneration?: number;
  requestId?: string;
  dropStartedAt?: Date;
  dropRetriedAt?: Date;
  cleanedAt?: Date;
  reconciledAt?: Date;
  reconciledBy?: string;
  reconciliationReason?: string;
}

export interface CleanupTestInjectionHooks {
  beforeLockAcquisition?: () => Promise<void> | void;
  afterLockAcquired?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  afterRegistrySync?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  afterCoordDropLock?: (metadata: TestDatabaseOwnershipMetadata, token?: string) => Promise<void> | void;
  beforeDropDatabase?: (metadata: TestDatabaseOwnershipMetadata, token?: string) => Promise<void> | void;
  beforeWireDispatch?: (metadata: TestDatabaseOwnershipMetadata, token?: string) => Promise<void> | void;
  overrideDropDatabase?: (originalDrop: () => Promise<unknown>) => Promise<unknown>;
  afterDropBeforeCleaned?: () => Promise<void> | void;
  simulateRegistryError?: boolean;
  simulateLostResponse?: boolean;
}

export interface CleanupTestOptions {
  requestId?: string;
  expectedGeneration?: number;
  signal?: AbortSignal;
  _testHooks?: CleanupTestInjectionHooks;
  adminContext?: {
    operator: string;
    reason: string;
    adminToken: string;
  };
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
 * Returns host identifier. Fails closed if host identity cannot be determined.
 */
export function getHostIdentity(): string {
  try {
    const hostname = os.hostname();
    if (!hostname || typeof hostname !== 'string' || !hostname.trim()) {
      throw new Error('Host identity unavailable: empty hostname');
    }
    return hostname.trim();
  } catch (err) {
    throw new Error(`Host identity unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const PROCESS_STARTUP_GENERATION = `incarnation_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

let activeSupervisedDropContext: { dbName: string; token: string } | null = null;

/**
 * Strips direct destructive execution capability from a worker-held MongoDB database handle.
 * Ordinary cleanup workers must not independently possess the capability to issue uncoordinated dropDatabase().
 * Direct calls on the native database handle are strictly denied unless executed within an active
 * Supervised Cleanup Executor dispatch context.
 * Helper calls on the connection wrapper are routed through the Supervised Cleanup Executor.
 */
export function stripDirectDestructiveCapability(
  connection: Connection,
  runId: string,
  workerId: string
): void {
  const db = connection.db;
  if (db) {
    const rawNativeDrop = db.dropDatabase.bind(db);
    db.dropDatabase = async () => {
      // 1. If inside active Supervised Cleanup Executor dispatch: permit
      if (
        activeSupervisedDropContext &&
        activeSupervisedDropContext.dbName === db.databaseName
      ) {
        return rawNativeDrop();
      }

      // 2. Direct drop outside active supervised context:
      // Verify whether the caller holds verified CLEANUP_LOCKED authority (e.g. crash-test simulation)
      const metaCol = db.collection('__test_run_metadata');
      let isVerifiedCleanupLocked = false;
      try {
        const metaDoc = await metaCol.findOne({
          _id: 'ownership_lock' as unknown as import('mongodb').ObjectId,
        });
        if (
          metaDoc &&
          metaDoc.runId === runId &&
          (metaDoc.cleanupOwner === workerId || metaDoc.workerId === workerId) &&
          (metaDoc.lifecycleState === 'CLEANUP_LOCKED' || metaDoc.lifecycleState === 'DROP_IN_PROGRESS')
        ) {
          isVerifiedCleanupLocked = true;
        }
      } catch {
        // ignore read failure
      }

      const client =
        typeof connection.getClient === 'function'
          ? connection.getClient()
          : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;
      if (client && !isVerifiedCleanupLocked) {
        try {
          const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
          const regDoc = await coordCol.findOne({
            _id: db.databaseName as unknown as import('mongodb').ObjectId,
          });

          if (
            regDoc &&
            regDoc.runId === runId &&
            (regDoc.cleanupOwner === workerId || regDoc.workerId === workerId) &&
            (regDoc.lifecycleState === 'CLEANUP_LOCKED' || regDoc.lifecycleState === 'DROP_IN_PROGRESS') &&
            regDoc.cleanupInProgress === true
          ) {
            isVerifiedCleanupLocked = true;
          }
        } catch {
          // ignore read failure
        }
      }

      if (isVerifiedCleanupLocked) {
        return rawNativeDrop();
      }

      // 3. Unauthorized, uncoordinated, or stale direct drop: strictly capability-denied
      throw new Error(
        'Safety guard violation: Destructive execution capability denied: direct dropDatabase() is prohibited. All cleanup must be submitted as an authorized request to the Supervised Cleanup Executor.'
      );
    };
  }

  // Intercept connection.dropDatabase to route through Supervised Cleanup Executor
  connection.dropDatabase = async () => {
    return cleanupTestDatabase(connection, runId, workerId);
  };
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
 * Strips direct destructive capability from the connection handle.
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

    // Strip direct destructive capability and bind verified claim identity
    stripDirectDestructiveCapability(connection, cleanRun, cleanWorker);

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
        stripDirectDestructiveCapability(connection, cleanRun, cleanWorker);
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

export interface SupervisedExecutorIdentity {
  hostId: string;
  processId: number;
  startupGeneration: string;
  executorGeneration: number;
  executorToken: string;
}

export interface CleanupExecutionRequest {
  requestId: string;
  runId: string;
  workerId: string;
  databaseName: string;
  cleanupGeneration?: number;
  expectedOwnership?: {
    runId: string;
    workerId: string;
    ownershipGeneration: number;
  };
  submittedAt: Date;
}

export interface CleanupExecutionResult {
  requestId: string;
  databaseName: string;
  status: 'CLEANED' | 'ALREADY_CLEANED' | 'RECONCILED' | 'OUTCOME_UNKNOWN' | 'REJECTED';
  cleanupGeneration: number;
  executorIdentity: SupervisedExecutorIdentity;
  dispatchedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Supervised Cleanup Executor.
 * Dedicated, explicitly controlled execution authority that centralizes all destructive database deletion.
 * Isolates execution authority from ordinary cleanup workers.
 */
export class SupervisedCleanupExecutor {
  private identity: SupervisedExecutorIdentity;
  private inFlightByRequestId = new Map<string, Promise<void>>();
  private completedRequests = new Map<string, { databaseName: string; completedAt: Date }>();

  constructor(options?: {
    hostId?: string;
    processId?: number;
    startupGeneration?: string;
    executorGeneration?: number;
    executorToken?: string;
  }) {
    const hostId = options?.hostId ?? getHostIdentity();
    const processId = options?.processId ?? process.pid;
    const startupGeneration = options?.startupGeneration ?? PROCESS_STARTUP_GENERATION;
    const executorGeneration = options?.executorGeneration ?? 1;
    const executorToken =
      options?.executorToken ??
      `exec_tok_${processId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    if (!hostId || typeof hostId !== 'string' || !hostId.trim()) {
      throw new Error('Safety guard violation: malformed executor identity: hostId is required.');
    }
    if (!processId || typeof processId !== 'number' || processId <= 0) {
      throw new Error('Safety guard violation: malformed executor identity: valid processId is required.');
    }

    this.identity = {
      hostId,
      processId,
      startupGeneration,
      executorGeneration,
      executorToken,
    };
  }

  public getIdentity(): SupervisedExecutorIdentity {
    return { ...this.identity };
  }

  /**
   * Serializes execution of cleanup requests per target database and handles request deduplication.
   */
  public async executeCleanupRequest(
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

    const requestId =
      (typeof optionsOrGeneration === 'object' && optionsOrGeneration !== null && optionsOrGeneration.requestId) ||
      `req_${cleanWorker}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Scenario D37-02: Check duplicate completed request ID
    if (this.completedRequests.has(requestId)) {
      return;
    }

    // Scenario D37-02: Check duplicate in-flight request ID
    const inFlight = this.inFlightByRequestId.get(requestId);
    if (inFlight) {
      await inFlight;
      return;
    }

    const currentOp = this.performSupervisedCleanup(
      connection,
      cleanRun,
      cleanWorker,
      dbName,
      expectedGen,
      testHooks,
      requestId,
      optionsOrGeneration && typeof optionsOrGeneration === 'object' ? optionsOrGeneration.signal : undefined
    );

    this.inFlightByRequestId.set(requestId, currentOp);
    try {
      await currentOp;
      this.completedRequests.set(requestId, { databaseName: dbName, completedAt: new Date() });
    } finally {
      this.inFlightByRequestId.delete(requestId);
    }
  }

  private async performSupervisedCleanup(
    connection: Connection,
    cleanRun: string,
    cleanWorker: string,
    dbName: string,
    expectedGen: number | undefined,
    testHooks: CleanupTestInjectionHooks | undefined,
    requestId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const db = connection.db!;
    const client =
      typeof connection.getClient === 'function'
        ? connection.getClient()
        : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;
    const coordCol = client
      ? client.db('decision_os_test_coordination_test').collection('cleanup_registry')
      : null;

    // Check if database has 0 collections (e.g. already dropped)
    const collections = await db.listCollections().toArray();
    if (collections.length === 0) {
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

    await assertCanCleanupTestDatabase(connection, cleanRun, cleanWorker);

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

    // Host boundary verification: Scenario D37-19
    if (
      existingCoord.dropExecutionLock === true &&
      existingCoord.executorHostId !== undefined &&
      existingCoord.executorHostId !== this.identity.hostId
    ) {
      throw new Error(
        `Safety guard violation: database '${dbName}' drop is locked by executor on foreign host '${existingCoord.executorHostId}'. Cross-host takeover prohibited without multi-host fencing proof.`
      );
    }

    // Process liveness & PID reuse verification: Scenario D37-11, D37-17
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

    // Stage 3: Atomically transition to DROP_IN_PROGRESS in target database
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
          executorPid: this.identity.processId,
          executorHostId: this.identity.hostId,
          executorStartupGeneration: this.identity.startupGeneration,
          executorGeneration: this.identity.executorGeneration,
          requestId,
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

    // Atomically acquire exclusive destructive authority in coordination registry
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
          executorPid: this.identity.processId,
          executorHostId: this.identity.hostId,
          executorStartupGeneration: this.identity.startupGeneration,
          executorGeneration: this.identity.executorGeneration,
          requestId,
          dropStartedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!coordDropLock) {
      const existingCoordDoc = await coordCol.findOne({
        _id: dbName as unknown as import('mongodb').ObjectId,
      });
      if (!existingCoordDoc) {
        throw new Error(
          `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing destructive drop.`
        );
      }
      if (existingCoordDoc.runId !== cleanRun) {
        throw new Error(
          `Safety guard violation: database '${dbName}' is owned by run '${existingCoordDoc.runId}' (expected '${cleanRun}'). Refusing drop.`
        );
      }
      if (existingCoordDoc.cleanupOwner && existingCoordDoc.cleanupOwner !== cleanWorker) {
        throw new Error(
          `Safety guard violation: database '${dbName}' cleanup is in progress by another worker '${existingCoordDoc.cleanupOwner}'. Refusing drop.`
        );
      }
      if (
        existingCoordDoc.cleanupGeneration !== undefined &&
        existingCoordDoc.cleanupGeneration > activeGeneration
      ) {
        throw new Error(
          `Safety guard violation: Destructive execution capability denied: database '${dbName}' cleanup authority superseded before drop (stale generation ${activeGeneration}, active ${existingCoordDoc.cleanupGeneration}).`
        );
      }
      if (existingCoordDoc.lifecycleState === 'CLEANED') {
        throw new Error(
          `Safety guard violation: database '${dbName}' is already cleaned in coordination registry.`
        );
      }
      if (existingCoordDoc.dropExecutionLock === true || existingCoordDoc.dropInProgress === true) {
        if (
          existingCoordDoc.executorPid !== undefined &&
          existingCoordDoc.executorPid !== process.pid &&
          !isExecutorTerminated(existingCoordDoc.executorPid)
        ) {
          throw new Error(
            `Safety guard violation: database '${dbName}' drop is in progress by active executor PID ${existingCoordDoc.executorPid}. Refusing concurrent or superseded execution while old executor is alive.`
          );
        }
        throw new Error(
          `Safety guard violation: database '${dbName}' drop is already in progress concurrently by worker '${existingCoordDoc.cleanupOwner || cleanWorker}'. Refusing concurrent drop.`
        );
      }
      throw new Error(
        `Safety guard violation: Destructive execution capability denied: database '${dbName}' destructive drop authority not acquired from coordination registry. Refusing drop.`
      );
    }

    if (testHooks?.afterCoordDropLock) {
      await testHooks.afterCoordDropLock(dropLock as unknown as TestDatabaseOwnershipMetadata, currentDropToken);
    }

    if (testHooks?.beforeDropDatabase) {
      await testHooks.beforeDropDatabase(dropLock as unknown as TestDatabaseOwnershipMetadata, currentDropToken);
    }

    // Pre-drop atomic verification of coordination authority
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
        `Safety guard violation: Destructive execution capability denied: database '${dbName}' cleanup authority superseded before drop (revoked or stale generation ${activeGeneration} or token mismatch).`
      );
    }

    // Supervised execution boundary & abort signal handling
    const dropAbortController = new AbortController();

    if (signal) {
      if (signal.aborted) {
        dropAbortController.abort();
      } else {
        signal.addEventListener('abort', () => dropAbortController.abort(), { once: true });
      }
    }

    const executeGuardedDrop = async () => {
      if (dropAbortController.signal.aborted) {
        throw new Error(
          `Safety guard violation: database '${dbName}' destructive drop aborted: execution authority was revoked or cancelled before dispatch.`
        );
      }

      if (testHooks?.beforeWireDispatch) {
        await testHooks.beforeWireDispatch(dropLock as unknown as TestDatabaseOwnershipMetadata, currentDropToken);
      }

      // Verification directly against coordination registry immediately prior to native drop
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
          `Safety guard violation: Destructive execution capability denied: database '${dbName}' cleanup authority superseded before drop (revoked or stale generation ${activeGeneration} or token mismatch).`
        );
      }

      if (dropAbortController.signal.aborted) {
        throw new Error(
          `Safety guard violation: database '${dbName}' destructive drop aborted: execution authority was revoked or cancelled before dispatch.`
        );
      }

      // Scenario D37-14: Test simulated lost response
      if (testHooks?.simulateLostResponse) {
        await coordCol.updateOne(
          { _id: dbName as unknown as import('mongodb').ObjectId },
          {
            $set: {
              lifecycleState: 'OUTCOME_UNKNOWN',
              dropInProgress: true,
              dropExecutionLock: true,
            },
          }
        );
        throw new Error('SIMULATED_LOST_RESPONSE: MongoDB response timed out');
      }

      // Privileged native drop execution under Supervised Cleanup Executor context
      activeSupervisedDropContext = { dbName, token: currentDropToken };
      try {
        await db.dropDatabase();
      } finally {
        activeSupervisedDropContext = null;
      }
    };

    if (testHooks?.overrideDropDatabase) {
      await testHooks.overrideDropDatabase(() => executeGuardedDrop());
    } else {
      await executeGuardedDrop();
    }

    if (testHooks?.afterDropBeforeCleaned) {
      await testHooks.afterDropBeforeCleaned();
    }

    // Finalize state to CLEANED in coordination registry
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
}

let defaultSupervisedExecutor: SupervisedCleanupExecutor | null = null;

export function getSupervisedCleanupExecutor(): SupervisedCleanupExecutor {
  if (!defaultSupervisedExecutor) {
    defaultSupervisedExecutor = new SupervisedCleanupExecutor();
  }
  return defaultSupervisedExecutor;
}

/**
 * Safely cleans up (drops) a test database owned by the current test run and worker.
 * Centralized behind the Supervised Cleanup Executor.
 * Ordinary workers do not possess direct drop capability.
 */
export async function cleanupTestDatabase(
  connection: Connection,
  runId: string,
  workerId: string,
  optionsOrGeneration?: number | CleanupTestOptions
): Promise<void> {
  const executor = getSupervisedCleanupExecutor();
  return executor.executeCleanupRequest(connection, runId, workerId, optionsOrGeneration);
}

/**
 * Explicitly authorized and audited administrative reconciliation protocol.
 * Scenario D37-24.
 */
export async function reconcileTestDatabaseCleanup(
  connection: Connection,
  dbName: string,
  authContext: { operator: string; reason: string; adminToken: string }
): Promise<void> {
  if (!authContext || !authContext.adminToken || !authContext.operator || !authContext.reason) {
    throw new Error(
      `Safety guard violation: administrative reconciliation requires explicit operator, reason, and adminToken.`
    );
  }
  if (!authContext.adminToken.startsWith('admin_token_')) {
    throw new Error(
      `Safety guard violation: invalid administrative reconciliation token.`
    );
  }

  const isTestDb = dbName.endsWith('_test') || /_test(?:_[a-zA-Z0-9_-]+)+$/.test(dbName);
  if (!isTestDb) {
    throw new Error(
      `Safety guard violation: refusing reconciliation on non-test database '${dbName}'.`
    );
  }

  const client =
    typeof connection.getClient === 'function'
      ? connection.getClient()
      : (connection as unknown as { client?: import('mongodb').MongoClient })?.client;

  if (!client) {
    throw new Error(`Safety guard violation: client unavailable for administrative reconciliation.`);
  }

  const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
  const existing = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
  if (!existing) {
    throw new Error(`Safety guard violation: database '${dbName}' has no coordination record in registry.`);
  }

  // Inspect cluster state
  const dbList = await client.db().admin().listDatabases();
  const dbExists = dbList.databases.some((d: { name: string }) => d.name === dbName);

  if (dbExists) {
    const cols = await client.db(dbName).listCollections().toArray();
    if (cols.length > 0) {
      await client.db(dbName).dropDatabase();
    }
  }

  await coordCol.updateOne(
    { _id: dbName as unknown as import('mongodb').ObjectId },
    {
      $set: {
        lifecycleState: 'CLEANED',
        dropExecutionLock: false,
        dropInProgress: false,
        cleanupInProgress: false,
        cleanedAt: new Date(),
        reconciledAt: new Date(),
        reconciledBy: authContext.operator,
        reconciliationReason: authContext.reason,
      },
    }
  );
}
