import crypto from 'node:crypto';
import type { EngineResult, EngineEvaluationInput } from '@decision-os/decision-engine';

interface CacheEntry {
  inputHash: string;
  result: EngineResult;
  cachedAt: number;
}

export class EvaluationCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxEntries = 1000, ttlMs = 3600_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Computes deterministic SHA-256 hash of MCDA engine evaluation inputs.
   */
  computeInputHash(input: EngineEvaluationInput): string {
    const canonicalPayload = {
      criteria: input.criteria.map(c => ({ id: c.id, weight: c.weight, isLocked: c.isLocked ?? false })),
      options: input.options.map(o => ({ id: o.id, scores: o.scores })),
      lockedIds: input.lockedIds ? [...input.lockedIds].sort() : [],
      engineVersion: '1.0.0',
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
  }

  /**
   * Retrieves cached authoritative engine result if version and inputHash match exactly.
   */
  get(decisionId: string, version: number, inputHash: string): EngineResult | null {
    const key = `mcda:${decisionId}:v${version}`;
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // TTL expiration check
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Input hash verification prevents stale results under the same version
    if (entry.inputHash !== inputHash) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.result;
  }

  /**
   * Caches authoritative engine result with bounded LRU eviction.
   */
  set(decisionId: string, version: number, inputHash: string, result: EngineResult): void {
    if (this.cache.size >= this.maxEntries) {
      // LRU eviction of oldest key
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const key = `mcda:${decisionId}:v${version}`;
    this.cache.set(key, {
      inputHash,
      result,
      cachedAt: Date.now(),
    });
  }

  /**
   * Explicitly evicts cached results for a decision when mutated or deleted.
   */
  invalidate(decisionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`mcda:${decisionId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears the cache. Used in tests and benchmarks.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Operational telemetry metrics.
   */
  getMetrics(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0,
    };
  }
}

export const evaluationCache = new EvaluationCache();

