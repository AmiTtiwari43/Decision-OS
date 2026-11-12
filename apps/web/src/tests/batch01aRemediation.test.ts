import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useDecisionModel } from '../hooks/useDecisionModel';
import { InstrumentsShowcase } from '../components/InstrumentsShowcase';
import { primaryJobOfferDataset } from '../data/decisionData';
import type { DecisionDataset, Criterion } from '../types/decision';

describe('Decision OS — Batch 01A-R1 Blocking Defect Remediation Suite', () => {
  // Helper to execute hook inside a real React component rendering lifecycle without monkey-patching internals
  function renderHookModel(initialDataset?: DecisionDataset) {
    let capturedModel: ReturnType<typeof useDecisionModel> | null = null;

    function TestComponent({ onCapture }: { onCapture: (m: ReturnType<typeof useDecisionModel>) => void }) {
      const model = useDecisionModel(initialDataset);
      onCapture(model);
      return null;
    }

    renderToString(
      React.createElement(TestComponent, {
        onCapture: (m) => {
          capturedModel = m;
        },
      })
    );

    if (!capturedModel) {
      throw new Error('TestComponent failed to capture model during render');
    }

    return capturedModel as ReturnType<typeof useDecisionModel>;
  }

  // ─── 1. Critical remediation — C-01 ─────────────────────────────────────────
  describe('C-01: Hook render-time calculation safety and invalid locked weights', () => {
    it('does not crash during rendering when locked criteria exceed 100%', () => {
      // Create a dataset with 2 criteria whose locked weights exceed 100% (60% + 55% = 115%)
      const invalidLockedCriteria: Criterion[] = [
        {
          id: 'crit-a',
          name: 'Critical Security',
          shortName: 'Security',
          description: '',
          category: 'risk',
          defaultWeight: 60,
          isLocked: true,
        },
        {
          id: 'crit-b',
          name: 'Regulatory Compliance',
          shortName: 'Compliance',
          description: '',
          category: 'risk',
          defaultWeight: 55,
          isLocked: true,
        },
      ];

      const invalidDataset: DecisionDataset = {
        id: 'invalid-locked-decision',
        title: 'Invalid Locked Decision',
        question: 'Which architecture?',
        context: 'Testing locked weights > 100%',
        criteria: invalidLockedCriteria,
        options: [
          {
            id: 'opt-1',
            name: 'Option 1',
            tagline: '',
            description: '',
            color: '#B8FF5A',
            accentBorder: '',
            scores: { 'crit-a': 90, 'crit-b': 85 },
            strengths: [],
            vulnerabilities: [],
          },
          {
            id: 'opt-2',
            name: 'Option 2',
            tagline: '',
            description: '',
            color: '#38BDF8',
            accentBorder: '',
            scores: { 'crit-a': 70, 'crit-b': 80 },
            strengths: [],
            vulnerabilities: [],
          },
        ],
        scenarios: [],
      };

      // Ensure that rendering the hook does not throw any uncaught validation exception
      let model!: ReturnType<typeof useDecisionModel>;
      expect(() => {
        model = renderHookModel(invalidDataset);
      }).not.toThrow();

      // Must produce a controlled invalid state
      expect(model.isInvalid).toBe(true);
      expect(model.engineResult.isInvalid).toBe(true);
      expect(model.engineResult.decisionOutcome).toBe('invalid');

      // Preserve useful error information for the UI
      expect(model.evaluationError).toBeDefined();
      expect(model.evaluationError).toMatch(/exceeds 100\.0%/i);
      expect(model.engineResult.errorMessage).toMatch(/exceeds 100\.0%/i);

      // Do not fabricate scores, weights, or decision rankings
      expect(model.engineResult.winner).toBeNull();
      expect(model.engineResult.runnerUp).toBeNull();
      for (const evalItem of model.engineResult.evaluations) {
        expect(evalItem.rank).toBeNull();
        expect(evalItem.weightedScore).toBe(0);
      }

      // Do NOT silently substitute default weights when canonical normalization fails
      // It must preserve the raw weights so the UI can accurately present the conflicting configuration
      expect(model.engineResult.normalizedWeights['crit-a']).toBe(60);
      expect(model.engineResult.normalizedWeights['crit-b']).toBe(55);
    });
  });

  // ─── 2. High-priority remediation — H-01 ────────────────────────────────────
  describe('H-01: Propagation of lockedIds through component hierarchy', () => {
    it('propagates lockedIds to InstrumentsShowcase and forwards them to MonteCarloTester', () => {
      const criteria = primaryJobOfferDataset.criteria;
      const options = primaryJobOfferDataset.options;
      const weights: Record<string, number> = {};
      criteria.forEach((c) => (weights[c.id] = c.defaultWeight));

      const lockedIds = ['careerGrowth', 'compensation'];

      // Render InstrumentsShowcase active on Monte Carlo tester with lockedIds
      const htmlLocked = renderToString(
        React.createElement(InstrumentsShowcase, {
          criteria,
          options,
          weights,
          lockedIds,
          initialInstrumentId: 'montecarlo',
          activeOptionIds: options.map((o) => o.id),
          evaluations: [],
          sensitivity: [],
          onSelectWeight: () => {},
        })
      );

      // Render InstrumentsShowcase active on Monte Carlo tester without lockedIds
      const htmlUnlocked = renderToString(
        React.createElement(InstrumentsShowcase, {
          criteria,
          options,
          weights,
          lockedIds: [],
          initialInstrumentId: 'montecarlo',
          activeOptionIds: options.map((o) => o.id),
          evaluations: [],
          sensitivity: [],
          onSelectWeight: () => {},
        })
      );

      // Verify InstrumentsShowcase renders MonteCarloTester
      expect(htmlLocked).toContain('Monte Carlo Decision Stress-Tester');
      expect(htmlLocked).toContain('1,000 Iterations');
      expect(htmlLocked).toContain('Empirical Robustness');

      // Proving that lockedIds reached MonteCarloTester:
      // The simulation with locked criteria constrains perturbation and yields observably different results
      expect(htmlLocked).not.toBe(htmlUnlocked);
    });
  });

  // ─── 3. Medium-priority remediation — M-01 ──────────────────────────────────
  describe('M-01: Incomplete score matrices do not display a false leader or winner', () => {
    it('produces rank: null, winner: null, and suppresses leader indicators when score matrix is incomplete', () => {
      // Create incomplete dataset: opt-1 is missing scores for stability and compensation
      const incompleteDataset: DecisionDataset = {
        ...primaryJobOfferDataset,
        options: [
          {
            ...primaryJobOfferDataset.options[0],
            scores: { careerGrowth: 85 }, // missing compensation, learning, workLifeBalance, stability
          },
          {
            ...primaryJobOfferDataset.options[1],
            scores: { careerGrowth: 90, compensation: 80, learning: 70, workLifeBalance: 75, stability: 60 },
          },
        ],
      };

      const model = renderHookModel(incompleteDataset);

      // Must produce a controlled incomplete state
      expect(model.isIncomplete).toBe(true);
      expect(model.engineResult.isIncomplete).toBe(true);
      expect(model.engineResult.decisionOutcome).toBe('incomplete');

      // An incomplete decision must NOT communicate a valid winner
      expect(model.engineResult.winner).toBeNull();
      expect(model.engineResult.runnerUp).toBeNull();

      // Do NOT assign ordinal ranks (1, 2...) that imply a meaningful comparison
      expect(model.engineResult.evaluations).toHaveLength(2);
      for (const ev of model.engineResult.evaluations) {
        expect(ev.rank).toBeNull();
        expect(ev.weightedScore).toBe(0);
      }

      // Explainability communicates incomplete input clearly
      expect(model.engineResult.explainability.winningOption).toBeNull();
      expect(model.engineResult.explainability.headline).toBe('Incomplete Decision Input');
    });

    it('restores correct competition rankings when score matrix becomes complete', () => {
      // Start with complete dataset
      const model = renderHookModel(primaryJobOfferDataset);

      // Complete decision must produce a valid winner and distinct ordinal ranks
      expect(model.isIncomplete).toBe(false);
      expect(model.engineResult.isIncomplete).toBe(false);
      expect(model.engineResult.winner).not.toBeNull();
      expect(model.engineResult.winner!.rank).toBe(1);
      expect(model.engineResult.winner!.weightedScore).toBeGreaterThan(0);
      expect(model.engineResult.runnerUp).not.toBeNull();
      expect(model.engineResult.evaluations[0].rank).toBe(1);
    });
  });

  // ─── 4. Scope Item 1: Detailed Invalid Score Classification ─────────────────
  describe('Scope Item 1: Invalid score classification in useDecisionModel', () => {
    it('distinguishes invalid scores (> 100) from incomplete states and sets isInvalid: true, isIncomplete: false', () => {
      const outOfRangeDataset: DecisionDataset = {
        ...primaryJobOfferDataset,
        options: [
          {
            ...primaryJobOfferDataset.options[0],
            scores: {
              ...primaryJobOfferDataset.options[0].scores,
              careerGrowth: 150, // Out of range (> 100)
            },
          },
          primaryJobOfferDataset.options[1],
        ],
      };

      const model = renderHookModel(outOfRangeDataset);

      // Must be classified as INVALID, NOT incomplete!
      expect(model.isInvalid).toBe(true);
      expect(model.isIncomplete).toBe(false);
      expect(model.engineResult.isInvalid).toBe(true);
      expect(model.engineResult.isIncomplete).toBe(false);
      expect(model.engineResult.decisionOutcome).toBe('invalid');
      expect(model.engineResult.invalidReason).toBe('scores');

      // Must NOT communicate a winner or assign ranks
      expect(model.engineResult.winner).toBeNull();
      expect(model.engineResult.runnerUp).toBeNull();
      for (const ev of model.engineResult.evaluations) {
        expect(ev.rank).toBeNull();
        expect(ev.weightedScore).toBe(0);
      }

      // Headline and explanation must explicitly indicate invalid scores
      expect(model.engineResult.explainability.headline).toBe('Invalid Score Input');
      expect(model.engineResult.explainability.winningOption).toBeNull();
      expect(model.engineResult.errorMessage).toMatch(/between 0\.0 and 100\.0/i);
    });

    it('distinguishes negative scores (< 0) from incomplete states and sets isInvalid: true, isIncomplete: false', () => {
      const negativeScoreDataset: DecisionDataset = {
        ...primaryJobOfferDataset,
        options: [
          {
            ...primaryJobOfferDataset.options[0],
            scores: {
              ...primaryJobOfferDataset.options[0].scores,
              compensation: -25, // Negative score (< 0)
            },
          },
          primaryJobOfferDataset.options[1],
        ],
      };

      const model = renderHookModel(negativeScoreDataset);

      expect(model.isInvalid).toBe(true);
      expect(model.isIncomplete).toBe(false);
      expect(model.engineResult.decisionOutcome).toBe('invalid');
      expect(model.engineResult.invalidReason).toBe('scores');
      expect(model.engineResult.winner).toBeNull();
      expect(model.engineResult.runnerUp).toBeNull();
      for (const ev of model.engineResult.evaluations) {
        expect(ev.rank).toBeNull();
      }
      expect(model.engineResult.explainability.headline).toBe('Invalid Score Input');
    });

    it('distinguishes non-finite NaN scores from incomplete states and sets isInvalid: true, isIncomplete: false', () => {
      const nanScoreDataset: DecisionDataset = {
        ...primaryJobOfferDataset,
        options: [
          {
            ...primaryJobOfferDataset.options[0],
            scores: {
              ...primaryJobOfferDataset.options[0].scores,
              learning: NaN, // Non-finite NaN
            },
          },
          primaryJobOfferDataset.options[1],
        ],
      };

      const model = renderHookModel(nanScoreDataset);

      expect(model.isInvalid).toBe(true);
      expect(model.isIncomplete).toBe(false);
      expect(model.engineResult.decisionOutcome).toBe('invalid');
      expect(model.engineResult.invalidReason).toBe('scores');
      expect(model.engineResult.winner).toBeNull();
      expect(model.engineResult.runnerUp).toBeNull();
      for (const ev of model.engineResult.evaluations) {
        expect(ev.rank).toBeNull();
      }
      expect(model.engineResult.explainability.headline).toBe('Invalid Score Input');
    });

    it('ensures invalid score values take precedence over missing scores to prevent misleading incomplete state', () => {
      const mixedInvalidAndMissingDataset: DecisionDataset = {
        ...primaryJobOfferDataset,
        options: [
          {
            ...primaryJobOfferDataset.options[0],
            // compensation missing, careerGrowth invalid (> 100)
            scores: {
              careerGrowth: 120,
              learning: 80,
              workLifeBalance: 75,
              stability: 70,
            },
          },
          primaryJobOfferDataset.options[1],
        ],
      };

      const model = renderHookModel(mixedInvalidAndMissingDataset);

      // Must be classified as INVALID (not misleadingly incomplete)
      expect(model.isInvalid).toBe(true);
      expect(model.isIncomplete).toBe(false);
      expect(model.engineResult.decisionOutcome).toBe('invalid');
      expect(model.engineResult.invalidReason).toBe('scores');
      expect(model.engineResult.winner).toBeNull();
      expect(model.engineResult.runnerUp).toBeNull();
      for (const ev of model.engineResult.evaluations) {
        expect(ev.rank).toBeNull();
      }
    });

    it('ensures invalid locked weights take precedence and set invalidReason: weights', () => {
      const invalidWeightCriteria: Criterion[] = [
        { id: 'c1', name: 'C1', shortName: 'C1', description: '', category: 'growth', defaultWeight: 70, isLocked: true },
        { id: 'c2', name: 'C2', shortName: 'C2', description: '', category: 'finance', defaultWeight: 45, isLocked: true },
      ];

      const invalidWeightDataset: DecisionDataset = {
        ...primaryJobOfferDataset,
        criteria: invalidWeightCriteria,
      };

      const model = renderHookModel(invalidWeightDataset);

      expect(model.isInvalid).toBe(true);
      expect(model.isIncomplete).toBe(false);
      expect(model.engineResult.decisionOutcome).toBe('invalid');
      expect(model.engineResult.invalidReason).toBe('weights');
      expect(model.engineResult.winner).toBeNull();
      expect(model.engineResult.runnerUp).toBeNull();
      for (const ev of model.engineResult.evaluations) {
        expect(ev.rank).toBeNull();
      }
      expect(model.engineResult.explainability.headline).toBe('Invalid Weight Configuration');
    });
  });
});
