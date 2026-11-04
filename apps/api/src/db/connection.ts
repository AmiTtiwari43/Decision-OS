import mongoose, { type Connection, type ConnectOptions } from 'mongoose';
import { sanitizeMongoUri } from './guard.js';
import { env } from '../config/env.js';

export interface DatabaseConnectionOptions extends ConnectOptions {
  serverSelectionTimeoutMS?: number;
  connectTimeoutMS?: number;
  socketTimeoutMS?: number;
  maxPoolSize?: number;
  minPoolSize?: number;
  maxIdleTimeMS?: number;
  requireReplicaSet?: boolean;
}

const DEFAULT_CONNECT_OPTIONS: ConnectOptions = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxIdleTimeMS: 30000,
  maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
  minPoolSize: env.MONGODB_MIN_POOL_SIZE,
  autoIndex: true,
};

let isConnecting = false;

/**
 * Checks whether the current active MongoDB connection supports multi-document transactions.
 * Transactions require a replica set topology (ReplicaSetWithPrimary or Sharded).
 */
export function isReplicaSetSupported(): boolean {
  if (mongoose.connection.readyState !== 1) {
    return false;
  }
  const client = mongoose.connection.getClient() as unknown as {
    topology?: {
      description?: {
        type?: string;
        setName?: string;
        servers?: Map<string, { setName?: string; type?: string }>;
      };
    };
  };
  const desc = client?.topology?.description;
  if (!desc) return false;
  if (desc.type === 'ReplicaSetWithPrimary' || desc.type === 'Sharded') {
    return true;
  }
  if (desc.setName) {
    return true;
  }
  if (desc.servers) {
    for (const server of desc.servers.values()) {
      if (server.setName || server.type === 'RSPrimary') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Asserts that the connected MongoDB deployment is a transaction-capable replica set.
 * Throws a clear configuration error if standalone or unsupported.
 */
export function assertReplicaSetSupported(): void {
  if (!isReplicaSetSupported()) {
    const client = mongoose.connection.getClient() as unknown as {
      topology?: { description?: { type?: string } };
    };
    const topologyType = client?.topology?.description?.type || 'Unknown';
    throw new Error(
      `MongoDB topology '${topologyType}' does not support multi-document transactions. Decision OS Batch 4 requires a MongoDB Replica Set (Topology A). Standalone MongoDB is not supported.`
    );
  }
}

/**
 * Connects to MongoDB using Mongoose with resilient lifecycle management.
 * Reuses existing active connections to prevent accidental multi-connection leaks.
 */
export async function connectToDatabase(
  uri: string,
  options?: DatabaseConnectionOptions
): Promise<Connection> {
  // If already connected, reuse existing connection
  if (mongoose.connection.readyState === 1) {
    if (options?.requireReplicaSet) {
      assertReplicaSetSupported();
    }
    return mongoose.connection;
  }

  // If currently in the process of connecting, wait for completion
  if (mongoose.connection.readyState === 2 && isConnecting) {
    await mongoose.connection.asPromise();
    if (options?.requireReplicaSet) {
      assertReplicaSetSupported();
    }
    return mongoose.connection;
  }

  isConnecting = true;
  try {
    const opts: ConnectOptions = {
      ...DEFAULT_CONNECT_OPTIONS,
      ...options,
    };

    await mongoose.connect(uri, opts);

    if (options?.requireReplicaSet) {
      assertReplicaSetSupported();
    }

    return mongoose.connection;
  } catch (error) {
    const sanitized = sanitizeMongoUri(uri);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to MongoDB at ${sanitized}: ${message}`);
  } finally {
    isConnecting = false;
  }
}

/**
 * Gracefully disconnects from MongoDB if currently connected or connecting.
 */
export async function disconnectFromDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/**
 * Returns true if the Mongoose connection is verified open (readyState === 1).
 */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Returns the current Mongoose connection instance.
 */
export function getDatabaseConnection(): Connection {
  return mongoose.connection;
}

export interface DatabaseHealthReport {
  status: 'connected' | 'disconnected';
  latencyMs?: number;
  error?: string;
  isReplicaSet?: boolean;
}

/**
 * Actively checks database health via ping command.
 * Never reports healthy unless connection is open and ping succeeds.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthReport> {
  if (mongoose.connection.readyState !== 1) {
    return {
      status: 'disconnected',
      error: 'Database connection is not open (readyState !== 1)',
    };
  }

  try {
    const start = Date.now();
    const db = mongoose.connection.db;
    if (!db) {
      return {
        status: 'disconnected',
        error: 'No active MongoDB database handle available',
      };
    }
    await db.admin().ping();
    const latencyMs = Date.now() - start;
    return {
      status: 'connected',
      latencyMs,
      isReplicaSet: isReplicaSetSupported(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database ping command failed';
    return {
      status: 'disconnected',
      error: message,
    };
  }
}

export interface TransactionOptions {
  readConcern?: { level: 'snapshot' | 'local' | 'majority' };
  writeConcern?: { w: 'majority' | number; j?: boolean; wtimeoutMS?: number };
  maxCommitTimeMS?: number;
}

export const DEFAULT_TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  maxCommitTimeMS: 10000,
};

/**
 * Executes a callback within a managed MongoDB multi-document ACID transaction.
 * Automatically validates replica-set capability, manages session lifecycle,
 * and retries transient transaction errors using standard MongoDB driver guarantees.
 */
export async function runInTransaction<T>(
  callback: (session: mongoose.ClientSession) => Promise<T>,
  options: TransactionOptions = DEFAULT_TRANSACTION_OPTIONS
): Promise<T> {
  assertReplicaSetSupported();

  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(
      async () => {
        result = await callback(session);
      },
      {
        readConcern: options.readConcern as mongoose.mongo.ReadConcern,
        writeConcern: options.writeConcern as mongoose.mongo.WriteConcern,
        maxCommitTimeMS: options.maxCommitTimeMS,
      }
    );
    return result!;
  } finally {
    await session.endSession();
  }
}
