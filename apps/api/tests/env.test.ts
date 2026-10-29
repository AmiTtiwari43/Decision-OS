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
    };

    const parsed = validateEnv(validRaw);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(4000);
    expect(parsed.HOST).toBe('0.0.0.0');
    expect(parsed.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(parsed.LOG_LEVEL).toBe('warn');
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
});
