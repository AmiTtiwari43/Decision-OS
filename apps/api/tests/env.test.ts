import { describe, it, expect } from 'vitest';
import { validateEnv, KNOWN_DEV_JWT_SECRET } from '../src/config/env';

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

  describe('F-02: JWT_SECRET Configuration & Production Enforcement', () => {
    it('1. development without an explicitly supplied secret uses safe development fallback', () => {
      const parsed = validateEnv({ NODE_ENV: 'development' });
      expect(parsed.JWT_SECRET).toBe(KNOWN_DEV_JWT_SECRET);
      expect(parsed.JWT_SECRET.length).toBeGreaterThanOrEqual(16);
    });

    it('2. test environment without an explicitly supplied secret uses safe development fallback', () => {
      const parsed = validateEnv({ NODE_ENV: 'test' });
      expect(parsed.JWT_SECRET).toBe(KNOWN_DEV_JWT_SECRET);
    });

    it('3. production with missing JWT_SECRET fails fast with non-sensitive error', () => {
      const invalidRaw = {
        NODE_ENV: 'production',
      };

      expect(() => validateEnv(invalidRaw)).toThrowError(
        /JWT_SECRET must be explicitly configured in production environments/
      );
    });

    it('4. production with empty string JWT_SECRET fails fast', () => {
      const invalidRaw = {
        NODE_ENV: 'production',
        JWT_SECRET: '   ',
      };

      expect(() => validateEnv(invalidRaw)).toThrowError(
        /JWT_SECRET must be explicitly configured in production environments/
      );
    });

    it('5. production with known development fallback is strictly rejected', () => {
      const invalidRaw = {
        NODE_ENV: 'production',
        JWT_SECRET: KNOWN_DEV_JWT_SECRET,
      };

      expect(() => validateEnv(invalidRaw)).toThrowError(
        /JWT_SECRET cannot use the known development fallback in production environments/
      );
    });

    it('6. production with a valid supplied secret succeeds', () => {
      const validSecret = 'super-secure-production-jwt-signing-secret-2026!';
      const parsed = validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: validSecret,
      });

      expect(parsed.NODE_ENV).toBe('production');
      expect(parsed.JWT_SECRET).toBe(validSecret);
    });

    it('7. secret below the minimum length (< 16 chars) fails fast and never logs secret value', () => {
      const secretUnder16 = 'short-secret-12';
      let errorThrown: Error | null = null;
      try {
        validateEnv({
          NODE_ENV: 'development',
          JWT_SECRET: secretUnder16,
        });
      } catch (err) {
        errorThrown = err as Error;
      }

      expect(errorThrown).not.toBeNull();
      expect(errorThrown?.message).toContain('JWT_SECRET must be at least 16 characters long');
      // Crucial: The error message must NEVER leak the raw secret value
      expect(errorThrown?.message).not.toContain(secretUnder16);
    });
  });
});
