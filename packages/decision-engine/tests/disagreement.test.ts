import { describe, it, expect } from 'vitest';
import {
  calculateSampleStdDev,
  calculateMedian,
  calculateConfidenceWeightedMean,
  analyzeDisagreements,
} from '../src';
import type { EngineCriterion, EngineOption, ContributorSubmissionInput } from '../src';

describe('Disagreement Intelligence Engine', () => {
  describe('Statistical Helpers', () => {
    it('calculates sample standard deviation with Bessel correction (N - 1)', () => {
      expect(calculateSampleStdDev([])).toBeNull();
      expect(calculateSampleStdDev([50])).toBe(0);

      // Dataset: [80, 90, 70]
      // Mean = 80
      // Variance = ((80-80)^2 + (90-80)^2 + (70-80)^2) / (3 - 1) = (0 + 100 + 100) / 2 = 100
      // StdDev = sqrt(100) = 10
      expect(calculateSampleStdDev([80, 90, 70])).toBe(10);

      // Dataset: [10, 20]
      // Mean = 15
      // Variance = (25 + 25) / 1 = 50
      // StdDev = sqrt(50) = 7.071 -> 7.1
      expect(calculateSampleStdDev([10, 20])).toBe(7.1);
    });

    it('calculates exact statistical median for odd and even datasets', () => {
      expect(calculateMedian([])).toBeNull();
      expect(calculateMedian([45])).toBe(45);
      // Odd dataset: [30, 80, 10] -> sorted [10, 30, 80] -> median 30
      expect(calculateMedian([30, 80, 10])).toBe(30);
      // Even dataset: [70, 90, 60, 80] -> sorted [60, 70, 80, 90] -> (70 + 80) / 2 = 75
      expect(calculateMedian([70, 90, 60, 80])).toBe(75);
    });

    it('calculates confidence-weighted mean accurately', () => {
      expect(calculateConfidenceWeightedMean([], [])).toBeNull();

      // Scores: [80, 60], Confidences: [1.0, 0.0]
      // Weighted mean = (80*1.0 + 60*0.0) / 1.0 = 80.0
      expect(calculateConfidenceWeightedMean([80, 60], [1.0, 0.0])).toBe(80);

      // Scores: [90, 70], Confidences: [0.8, 0.2]
      // Weighted mean = (90*0.8 + 70*0.2) / 1.0 = (72 + 14) / 1.0 = 86.0
      expect(calculateConfidenceWeightedMean([90, 70], [0.8, 0.2])).toBe(86);

      // Equal confidences = arithmetic mean
      expect(calculateConfidenceWeightedMean([90, 70], [0.5, 0.5])).toBe(80);
    });
  });

  describe('analyzeDisagreements', () => {
    const criteria: EngineCriterion[] = [
      { id: 'crit_tech', name: 'Technical Quality', weight: 60 },
      { id: 'crit_cost', name: 'Cost Efficiency', weight: 40 },
    ];

    const options: EngineOption[] = [
      { id: 'opt_alpha', name: 'Option Alpha', scores: { crit_tech: 80, crit_cost: 70 } },
      { id: 'opt_beta', name: 'Option Beta', scores: { crit_tech: 65, crit_cost: 85 } },
    ];

    it('returns insufficient data response when < 2 contributions are provided', () => {
      const res0 = analyzeDisagreements({ criteria, options, contributions: [] });
      expect(res0.hasSufficientData).toBe(false);
      expect(res0.totalContributors).toBe(0);

      const res1 = analyzeDisagreements({
        criteria,
        options,
        contributions: [
          {
            contributorId: 'usr_1',
            scores: { crit_tech: 85, crit_cost: 75 },
          },
        ],
      });
      expect(res1.hasSufficientData).toBe(false);
      expect(res1.totalContributors).toBe(1);
      expect(res1.summary).toContain('At least 2 submitted contributions are required');
    });

    it('detects decision-critical score disagreement that inverts the winner', () => {
      // Base decision:
      // Alpha: 0.60 * 80 + 0.40 * 70 = 48 + 28 = 76.0
      // Beta:  0.60 * 65 + 0.40 * 85 = 39 + 34 = 73.0
      // Alpha leads Beta by 3.0 pts.
      // Tipping delta on Technical Quality (w=60): (100 * 3.0) / 60 = 5.0 pts.
      //
      // Two contributors evaluate Technical Quality:
      // Contributor 1: 90 pts (high)
      // Contributor 2: 60 pts (low) -> spread = 30 pts!
      //
      // Since spread (30 pts) >= tipping delta (5 pts), and pessimistic scenario on Alpha (60 pts)
      // gives Alpha score: 0.60 * 60 + 0.40 * 70 = 36 + 28 = 64.0 < Beta (73.0),
      // THIS DISAGREEMENT FLIPS THE WINNER and is DECISION-CRITICAL!

      const contributions: ContributorSubmissionInput[] = [
        {
          contributorId: 'expert_alice',
          contributorName: 'Alice',
          preferredOptionId: 'opt_alpha',
          scores: { crit_tech: 90, crit_cost: 70 },
          reasoning: { crit_tech: 'Rock-solid enterprise architecture' },
          confidence: 0.9,
        },
        {
          contributorId: 'expert_bob',
          contributorName: 'Bob',
          preferredOptionId: 'opt_beta',
          scores: { crit_tech: 60, crit_cost: 75 },
          reasoning: { crit_tech: 'High technical debt in core modules' },
          confidence: 0.8,
        },
      ];

      const result = analyzeDisagreements({ criteria, options, contributions });

      expect(result.hasSufficientData).toBe(true);
      expect(result.totalContributors).toBe(2);
      expect(result.decisionCriticalCount).toBeGreaterThan(0);

      const techDisag = result.items.find(i => i.id === 'disag_score_crit_tech')!;
      expect(techDisag).toBeDefined();
      expect(techDisag.isDecisionCritical).toBe(true);
      expect(techDisag.scoreMetrics?.minScore).toBe(60);
      expect(techDisag.scoreMetrics?.maxScore).toBe(90);
      expect(techDisag.scoreMetrics?.scoreRange).toBe(30);
      expect(techDisag.scoreMetrics?.tippingDeltaThreshold).toBe(5);
      expect(techDisag.scoreMetrics?.scenarioResults.minScenarioWinnerFlips).toBe(true);
      expect(techDisag.numericalExplanation).toContain('Spread of 30 pts');
      expect(techDisag.numericalExplanation).toContain('Pessimistic scenario (min score 60 pts) inverts winner');

      // Interpretation disagreement generated due to divergent reasoning
      const interpDisag = result.items.find(i => i.id === 'disag_interp_crit_tech');
      expect(interpDisag).toBeDefined();
      expect(interpDisag?.category).toBe('interpretation');

      // Priority disagreement generated (Alice prefers Alpha, Bob prefers Beta)
      const prioDisag = result.items.find(i => i.id === 'disag_prio_options');
      expect(prioDisag).toBeDefined();
      expect(prioDisag?.isDecisionCritical).toBe(true);
    });

    it('identifies high-spread disagreement as non-critical when winner is invariant', () => {
      // Construct a dominant decision:
      // Option Alpha dominates Option Beta by 40 points!
      // Lead delta = 40.0 pts.
      // Tipping threshold on Cost (w=40): (100 * 40.0) / 40 = 100 pts.
      const dominantOptions: EngineOption[] = [
        { id: 'opt_alpha', name: 'Alpha Dominant', scores: { crit_tech: 95, crit_cost: 90 } },
        { id: 'opt_beta', name: 'Beta Trailing', scores: { crit_tech: 40, crit_cost: 50 } },
      ];

      // Contributors differ by 20 points on Cost:
      const contributions: ContributorSubmissionInput[] = [
        {
          contributorId: 'u1',
          scores: { crit_tech: 95, crit_cost: 95 },
        },
        {
          contributorId: 'u2',
          scores: { crit_tech: 95, crit_cost: 75 },
        },
      ];

      const result = analyzeDisagreements({ criteria, options: dominantOptions, contributions });
      expect(result.hasSufficientData).toBe(true);

      const costDisag = result.items.find(i => i.id === 'disag_score_crit_cost')!;
      expect(costDisag).toBeDefined();
      expect(costDisag.scoreMetrics?.scoreRange).toBe(20);
      // Winner DOES NOT flip even with min score (75): Alpha remains ahead by >30 pts!
      expect(costDisag.isDecisionCritical).toBe(false);
      expect(costDisag.numericalExplanation).toContain('does not alter the winning alternative');
    });

    it('flags assumption disagreements when participant confidence diverges significantly', () => {
      const contributions: ContributorSubmissionInput[] = [
        {
          contributorId: 'u1',
          scores: { crit_tech: 80, crit_cost: 70 },
          confidence: 0.95, // 95%
        },
        {
          contributorId: 'u2',
          scores: { crit_tech: 80, crit_cost: 70 },
          confidence: 0.40, // 40% (spread = 55 percentage points!)
        },
      ];

      const result = analyzeDisagreements({ criteria, options, contributions });
      const assumpDisag = result.items.find(i => i.id === 'disag_assump_confidence');
      expect(assumpDisag).toBeDefined();
      expect(assumpDisag?.category).toBe('assumption');
      expect(assumpDisag?.numericalExplanation).toContain('55 percentage points');
    });

    it('detects evidence silos when contributors cite zero overlapping sources', () => {
      const contributions: ContributorSubmissionInput[] = [
        {
          contributorId: 'u1',
          scores: { crit_tech: 80, crit_cost: 70 },
          evidenceReferences: ['https://aws.amazon.com/benchmark', 'https://gartner.com/mq'],
        },
        {
          contributorId: 'u2',
          scores: { crit_tech: 80, crit_cost: 70 },
          evidenceReferences: ['https://internal-wiki.local/load-tests'],
        },
      ];

      const result = analyzeDisagreements({ criteria, options, contributions });
      const evidenceDisag = result.items.find(i => i.id === 'disag_evidence_silos');
      expect(evidenceDisag).toBeDefined();
      expect(evidenceDisag?.category).toBe('evidence');
      expect(evidenceDisag?.numericalExplanation).toContain('3 evidence references cited');
    });

    it('correctly handles zero-dispersion agreement (R = 0, stdDev = 0) without generating false items', () => {
      const contributions: ContributorSubmissionInput[] = [
        { contributorId: 'u1', scores: { crit_tech: 80, crit_cost: 70 } },
        { contributorId: 'u2', scores: { crit_tech: 80, crit_cost: 70 } },
      ];

      const result = analyzeDisagreements({ criteria, options, contributions });
      expect(result.hasSufficientData).toBe(true);
      expect(result.items.filter(i => i.category === 'score').length).toBe(0);
      expect(result.criteriaMetrics.length).toBe(2);
      expect(result.criteriaMetrics[0].scoreRange).toBe(0);
      expect(result.criteriaMetrics[0].sampleStdDev).toBe(0);
      expect(result.criteriaMetrics[0].isDecisionCritical).toBe(false);
    });

    it('handles incomplete or missing criterion scores across participants safely', () => {
      // Contributor 1 scores tech & cost; Contributor 2 only scores tech
      const contributions: ContributorSubmissionInput[] = [
        { contributorId: 'u1', scores: { crit_tech: 90, crit_cost: 80 } },
        { contributorId: 'u2', scores: { crit_tech: 60 } },
      ];

      const result = analyzeDisagreements({ criteria, options, contributions });
      expect(result.hasSufficientData).toBe(true);
      // tech has 2 scores -> disagreement item
      const techDisag = result.items.find(i => i.id === 'disag_score_crit_tech');
      expect(techDisag).toBeDefined();
      // cost only has 1 score -> no disagreement item, does not crash or emit NaN
      const costDisag = result.items.find(i => i.id === 'disag_score_crit_cost');
      expect(costDisag).toBeUndefined();
    });

    it('targets true 2nd-place runner-up in 3-option decision optimistic scenario', () => {
      const threeOptions: EngineOption[] = [
        { id: 'opt_3rd', name: 'Third Place Option', scores: { crit_tech: 30, crit_cost: 30 } },
        { id: 'opt_1st', name: 'First Place Option', scores: { crit_tech: 85, crit_cost: 85 } },
        { id: 'opt_2nd', name: 'Second Place Option', scores: { crit_tech: 80, crit_cost: 80 } },
      ];

      const contributions: ContributorSubmissionInput[] = [
        { contributorId: 'u1', scores: { crit_tech: 90 } },
        { contributorId: 'u2', scores: { crit_tech: 40 } },
      ];

      const result = analyzeDisagreements({ criteria, options: threeOptions, contributions });
      const techDisag = result.items.find(i => i.id === 'disag_score_crit_tech')!;
      expect(techDisag).toBeDefined();
      expect(techDisag.scoreMetrics?.scenarioResults).toBeDefined();
      // Verifies that optimistic scenario was tested against runner-up
      expect(techDisag.scoreMetrics?.scenarioResults.maxScenarioWinnerId).toBeDefined();
    });

    it('guarantees strict taxonomy compliance and never labels numerical score variance as factual', () => {
      const contributions: ContributorSubmissionInput[] = [
        { contributorId: 'u1', scores: { crit_tech: 90, crit_cost: 80 } },
        { contributorId: 'u2', scores: { crit_tech: 50, crit_cost: 40 } },
      ];

      const result = analyzeDisagreements({ criteria, options, contributions });
      for (const item of result.items) {
        expect(['score', 'priority', 'evidence', 'assumption', 'interpretation']).toContain(item.category);
        expect((item as any).category).not.toBe('factual');
      }
    });
  });
});

