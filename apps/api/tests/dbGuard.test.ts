import { describe, it, expect } from 'vitest';
import {
  sanitizeMongoUri,
  getDatabaseNameFromUri,
  assertTestDatabase,
} from '../src/db/guard';

describe('Database Safety Guard & URI Sanitization', () => {
  describe('sanitizeMongoUri', () => {
    it('masks username and password in standard connection string', () => {
      const uri = 'mongodb://appUser:superSecretPassword123@127.0.0.1:27017/decision_os_test';
      const sanitized = sanitizeMongoUri(uri);
      expect(sanitized).toBe('mongodb://***:***@127.0.0.1:27017/decision_os_test');
      expect(sanitized).not.toContain('appUser');
      expect(sanitized).not.toContain('superSecretPassword123');
    });

    it('masks credentials in mongodb+srv connection string', () => {
      const uri = 'mongodb+srv://admin_root:P%40ssw0rd!@cluster0.abcde.mongodb.net/decision_os_test?retryWrites=true';
      const sanitized = sanitizeMongoUri(uri);
      expect(sanitized).toContain('mongodb+srv://***:***@cluster0.abcde.mongodb.net');
      expect(sanitized).not.toContain('admin_root');
      expect(sanitized).not.toContain('P%40ssw0rd!');
    });

    it('leaves URIs without credentials intact', () => {
      const uri = 'mongodb://127.0.0.1:27017/decision_os_test';
      expect(sanitizeMongoUri(uri)).toBe(uri);
    });

    it('handles empty or non-string inputs safely', () => {
      expect(sanitizeMongoUri('')).toBe('');
    });
  });

  describe('getDatabaseNameFromUri', () => {
    it('extracts database name from standard URI', () => {
      const uri = 'mongodb://127.0.0.1:27017/decision_os_test';
      expect(getDatabaseNameFromUri(uri)).toBe('decision_os_test');
    });

    it('extracts database name with query parameters', () => {
      const uri = 'mongodb://127.0.0.1:27017/decision_os_test?authSource=admin&replicaSet=rs0';
      expect(getDatabaseNameFromUri(uri)).toBe('decision_os_test');
    });

    it('extracts database name from mongodb+srv URI', () => {
      const uri = 'mongodb+srv://cluster0.abcde.mongodb.net/analytics_test?retryWrites=true';
      expect(getDatabaseNameFromUri(uri)).toBe('analytics_test');
    });

    it('returns null when database name is missing', () => {
      expect(getDatabaseNameFromUri('mongodb://127.0.0.1:27017')).toBeNull();
      expect(getDatabaseNameFromUri('mongodb://127.0.0.1:27017/')).toBeNull();
      expect(getDatabaseNameFromUri('')).toBeNull();
    });
  });

  describe('assertTestDatabase', () => {
    it('permits URIs with database name ending with _test', () => {
      expect(() => {
        assertTestDatabase('mongodb://127.0.0.1:27017/decision_os_test');
      }).not.toThrow();

      expect(() => {
        assertTestDatabase('mongodb://localhost:27017/my_app_test?retryWrites=true');
      }).not.toThrow();
    });

    it('refuses URIs with production or non-test database names', () => {
      expect(() => {
        assertTestDatabase('mongodb://127.0.0.1:27017/decision_os');
      }).toThrowError(/Refusing to execute tests against a potential non-test database/);

      expect(() => {
        assertTestDatabase('mongodb+srv://cluster.mongodb.net/production_db');
      }).toThrowError(/Refusing to execute tests against a potential non-test database/);
    });

    it('refuses URIs without database name', () => {
      expect(() => {
        assertTestDatabase('mongodb://127.0.0.1:27017');
      }).toThrowError(/could not extract database name/);
    });

    it('never leaks credentials in the error message when refusing', () => {
      const uri = 'mongodb://secretUser:ultraSecretPass@127.0.0.1:27017/production_live';
      try {
        assertTestDatabase(uri);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).toContain('***:***@');
        expect(error.message).not.toContain('secretUser');
        expect(error.message).not.toContain('ultraSecretPass');
      }
    });
  });
});
