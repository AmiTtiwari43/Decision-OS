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
 * Connects to MongoDB using Mongoose with resilient lifecycle management.
 * Reuses existing active connections to prevent accidental multi-connection leaks.
 */
export async function connectToDatabase(
  uri: string,
  options?: DatabaseConnectionOptions
): Promise<Connection> {
  // If already connected, reuse existing connection
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If currently in the process of connecting, wait for completion
  if (mongoose.connection.readyState === 2 && isConnecting) {
    await mongoose.connection.asPromise();
    return mongoose.connection;
  }

  isConnecting = true;
  try {
    const opts: ConnectOptions = {
      ...DEFAULT_CONNECT_OPTIONS,
      ...options,
    };

    await mongoose.connect(uri, opts);
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
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database ping command failed';
    return {
      status: 'disconnected',
      error: message,
    };
  }
}
