import { describe, it, expect } from 'vitest';
import {
  calculateBrierScore,
  calculateClimatologyBss,
  calculateCalibrationBins,
  calculateExpectedCalibrationError,
  calculateExpertCalibration,
} from '../src';
import type { CalibrationPredictionInput } from '../src';

describe('Expert Calibration Engine', () => {
  describe('calculateBrierScore', () => {
    it('returns null for empty prediction sets', () => {
      expect(calculateBrierScore([])).toBeNull();
    });

    it('calculates exact 0.0 Brier score for perfect forecasts', () => {
      const perfect = [
        { probability: 1.0, observedOutcome: 1 },
        { probability: 0.0, observedOutcome: 0 },
        { probability: 1.0, observedOutcome: 1 },
      ];
      expect(calculateBrierScore(perfect)).toBe(0.0);
    });

    it('calculates exact 1.0 Brier score for completely inverted forecasts', () => {
      const inverted = [
        { probability: 0.0, observedOutcome: 1 },
        { probability: 1.0, observedOutcome: 0 },
      ];
      expect(calculateBrierScore(inverted)).toBe(1.0);
    });

    it('calculates exact 0.25 Brier score for uninformative 50/50 guesses', () => {
      const uninformative = [
        { probability: 0.5, observedOutcome: 1 },
        { probability: 0.5, observedOutcome: 0 },
        { probability: 0.5, observedOutcome: 1 },
        { probability: 0.5, observedOutcome: 0 },
      ];
      expect(calculateBrierScore(uninformative)).toBe(0.25);
    });

    it('matches manual calculation on known 4-item test dataset', () => {
      // Item 1: p=0.9, o=1 -> (0.9 - 1)^2 = 0.01
      // Item 2: p=0.7, o=1 -> (0.7 - 1)^2 = 0.09
      // Item 3: p=0.2, o=0 -> (0.2 - 0)^2 = 0.04
      // Item 4: p=0.4, o=1 -> (0.4 - 1)^2 = 0.36
      // Sum = 0.50 -> Mean = 0.50 / 4 = 0.125
      const dataset = [
        { probability: 0.9, observedOutcome: 1 },
        { probability: 0.7, observedOutcome: 1 },
        { probability: 0.2, observedOutcome: 0 },
        { probability: 0.4, observedOutcome: 1 },
      ];
      expect(calculateBrierScore(dataset)).toBe(0.125);
    });
  });

  describe('calculateClimatologyBss', () => {
    it('returns positive skill score when forecasting outperforms base-rate reference', () => {
      // Base rate: 3/4 = 0.75. Ref Brier = 0.75 * 0.25 = 0.1875.
      // Brier score = 0.125.
      // BSS = 1 - (0.125 / 0.1875) = 1 - 0.6667 = 0.333.
      const dataset = [
        { probability: 0.9, observedOutcome: 1 },
        { probability: 0.7, observedOutcome: 1 },
        { probability: 0.2, observedOutcome: 0 },
        { probability: 0.4, observedOutcome: 1 },
      ];
      expect(calculateClimatologyBss(dataset)).toBe(0.333);
    });

    it('returns null when all outcomes are identical (base rate variance is zero)', () => {
      const allOnes = [
        { probability: 0.8, observedOutcome: 1 },
        { probability: 0.9, observedOutcome: 1 },
      ];
      expect(calculateClimatologyBss(allOnes)).toBeNull();
    });
  });

  describe('calculateCalibrationBins and ECE', () => {
    it('correctly partitions forecasts into 5 standard bins and computes calibration gap', () => {
      const items = [
        { probability: 0.1, observedOutcome: 0 }, // bin 0 [0.0, 0.2)
        { probability: 0.15, observedOutcome: 0 }, // bin 0 [0.0, 0.2)
        { probability: 0.85, observedOutcome: 1 }, // bin 4 [0.8, 1.0]
        { probability: 0.95, observedOutcome: 1 }, // bin 4 [0.8, 1.0]
      ];

      const bins = calculateCalibrationBins(items);
      expect(bins.length).toBe(5);

      // Bin 0
      expect(bins[0].count).toBe(2);
      expect(bins[0].meanPredictedProbability).toBe(0.125);
      expect(bins[0].observedFrequency).toBe(0.0);
      expect(bins[0].calibrationError).toBe(0.125);

      // Bin 4
      expect(bins[4].count).toBe(2);
      expect(bins[4].meanPredictedProbability).toBe(0.9);
      expect(bins[4].observedFrequency).toBe(1.0);
      expect(bins[4].calibrationError).toBe(0.1);

      // Empty bins
      expect(bins[1].count).toBe(0);
      expect(bins[2].count).toBe(0);
      expect(bins[3].count).toBe(0);

      // ECE: (2/4)*0.125 + (2/4)*0.1 = 0.0625 + 0.05 = 0.1125
      const ece = calculateExpectedCalibrationError(bins, items.length);
      expect(ece).toBe(0.1125);
    });
  });

  describe('calculateExpertCalibration', () => {
    it('handles empty predictions with clear insufficient sample response', () => {
      const res = calculateExpertCalibration([]);
      expect(res.hasSufficientSample).toBe(false);
      expect(res.eligibleCount).toBe(0);
      expect(res.brierScore).toBeNull();
      expect(res.summary).toContain('No predictions recorded');
    });

    it('enforces prospective rule: excludes predictions submitted after outcome date', () => {
      const predictions: CalibrationPredictionInput[] = [
        // Valid prospective forecast: submitted Oct 10, outcome observed Nov 1
        {
          id: 'p1',
          probability: 0.8,
          observedOutcome: 1,
          domain: 'engineering',
          submittedAt: '2026-10-10T10:00:00Z',
          outcomeDate: '2026-11-01T12:00:00Z',
        },
        // Retrospective cheating: submitted Nov 5, outcome already occurred Nov 1!
        {
          id: 'p2',
          probability: 1.0,
          observedOutcome: 1,
          domain: 'engineering',
          submittedAt: '2026-11-05T10:00:00Z',
          outcomeDate: '2026-11-01T12:00:00Z',
        },
      ];

      const res = calculateExpertCalibration(predictions);
      expect(res.totalPredictions).toBe(2);
      expect(res.eligibleCount).toBe(1);
      expect(res.excludedCount).toBe(1);
      expect(res.brierScore).toBe(0.04); // (0.8 - 1)^2 = 0.04
    });

    it('flags insufficient sample size when N < 3 eligible predictions exist', () => {
      const predictions: CalibrationPredictionInput[] = [
        {
          id: 'p1',
          probability: 0.9,
          observedOutcome: 1,
          submittedAt: '2026-10-01T00:00:00Z',
          outcomeDate: '2026-10-15T00:00:00Z',
        },
        {
          id: 'p2',
          probability: 0.8,
          observedOutcome: 1,
          submittedAt: '2026-10-01T00:00:00Z',
          outcomeDate: '2026-10-15T00:00:00Z',
        },
      ];

      const res = calculateExpertCalibration(predictions);
      expect(res.hasSufficientSample).toBe(false);
      expect(res.eligibleCount).toBe(2);
      expect(res.summary).toContain('Preliminary sample size (N = 2 < 3)');
    });

    it('separates performance by domain rather than conflating distinct specializations', () => {
      const predictions: CalibrationPredictionInput[] = [
        // Engineering predictions (highly calibrated)
        {
          id: 'e1',
          probability: 0.9,
          observedOutcome: 1,
          domain: 'engineering',
          submittedAt: '2026-10-01T00:00:00Z',
          outcomeDate: '2026-10-15T00:00:00Z',
        },
        {
          id: 'e2',
          probability: 0.85,
          observedOutcome: 1,
          domain: 'engineering',
          submittedAt: '2026-10-01T00:00:00Z',
          outcomeDate: '2026-10-15T00:00:00Z',
        },
        // Finance predictions (poorly calibrated)
        {
          id: 'f1',
          probability: 0.9,
          observedOutcome: 0,
          domain: 'finance',
          submittedAt: '2026-10-01T00:00:00Z',
          outcomeDate: '2026-10-15T00:00:00Z',
        },
      ];

      const res = calculateExpertCalibration(predictions);
      expect(res.eligibleCount).toBe(3);
      expect(res.hasSufficientSample).toBe(true);

      const eng = res.domainBreakdown.find(d => d.domain === 'engineering')!;
      expect(eng).toBeDefined();
      expect(eng.count).toBe(2);
      expect(eng.brierScore).toBeLessThan(0.05); // High accuracy

      const fin = res.domainBreakdown.find(d => d.domain === 'finance')!;
      expect(fin).toBeDefined();
      expect(fin.count).toBe(1);
      expect(fin.brierScore).toBe(0.81); // (0.9 - 0)^2 = 0.81
    });

    it('excludes invalid probabilities and non-binary outcomes', () => {
      const predictions: CalibrationPredictionInput[] = [
        { id: 'bad_p1', probability: 1.5, observedOutcome: 1 },
        { id: 'bad_p2', probability: -0.2, observedOutcome: 0 },
        { id: 'bad_o1', probability: 0.7, observedOutcome: 2 as any },
        { id: 'good_1', probability: 0.8, observedOutcome: 1 },
      ];

      const res = calculateExpertCalibration(predictions);
      expect(res.totalPredictions).toBe(4);
      expect(res.eligibleCount).toBe(1);
      expect(res.excludedCount).toBe(3);
    });
  });
});

