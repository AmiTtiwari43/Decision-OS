import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

// Precomputed bcrypt hash used to simulate work when user is not found,
// preventing timing attacks that leak whether an email exists.
const DUMMY_BCRYPT_HASH = '$2a$12$K.zG8qP2iW4sM5rT7yU9OeN3vB1xZ0aC8mF6hJ4kL2pQ9wE7rT1y.';

/**
 * Hashes a plaintext password using bcrypt with 12 salt rounds.
 * Plaintext passwords and hashes must NEVER be logged.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Runs a dummy verification against a validly formatted hash to maintain constant-time
 * behavior when an account does not exist.
 */
export async function dummyVerifyPassword(password: string): Promise<boolean> {
  await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
  return false;
}

/**
 * Generates a cryptographically secure 256-bit random hex token for invitations.
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hashes an invitation token using SHA-256 for secure database storage.
 */
export function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}


