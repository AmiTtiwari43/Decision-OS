import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env';

describe('API Foundation — Environment Validation', () => {
  it('validates a correct environment configuration', () => {
    const validRaw = {
      NODE_ENV: 'test',
      PORT: '4000',
      HOST: '0.0.0.0',
      CORS_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'warn',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/decision_os_test',
    };

    const parsed = validateEnv(validRaw);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(4000);
    expect(parsed.HOST).toBe('0.0.0.0');
    expect(parsed.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(parsed.LOG_LEVEL).toBe('warn');
    expect(parsed.MONGODB_URI).toBe('mongodb://127.0.0.1:27017/decision_os_test');
  });

  it('provides safe default for MONGODB_URI when omitted', () => {
    const validRaw = {
      NODE_ENV: 'development',
    };

    const parsed = validateEnv(validRaw);
    expect(parsed.MONGODB_URI).toBe('mongodb://127.0.0.1:27017/decision_os');
  });

  it('fails fast on invalid MONGODB_URI protocol', () => {
    const invalidRaw = {
      MONGODB_URI: 'postgres://localhost:5432/db',
    };

    expect(() => validateEnv(invalidRaw)).toThrowError(/MONGODB_URI/);
  });

  it('fails fast with readable message on invalid PORT', () => {
    const invalidRaw = {
      PORT: 'not-a-number',
    };

    expect(() => validateEnv(invalidRaw)).toThrowError(/Environment validation failed:/);
    expect(() => validateEnv(invalidRaw)).toThrowError(/PORT/);
  });

  it('fails fast on out-of-range PORT', () => {
    const invalidRaw = {
      PORT: '70000',
    };

    expect(() => validateEnv(invalidRaw)).toThrowError(/PORT/);
  });

  it('fails fast on invalid NODE_ENV', () => {
    const invalidRaw = {
      NODE_ENV: 'invalid_environment',
    };

    expect(() => validateEnv(invalidRaw)).toThrowError(/NODE_ENV/);
  });

  it('provides safe default for JWT_SECRET and rejects short secrets when provided', () => {
    const valid = validateEnv({});
    expect(valid.JWT_SECRET).toBeDefined();
    expect(valid.JWT_SECRET.length).toBeGreaterThanOrEqual(16);

    const invalidRaw = {
      JWT_SECRET: 'short',
    };
    expect(() => validateEnv(invalidRaw)).toThrowError(/JWT_SECRET/);
  });
});
