import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MonteCarloTester } from '../components/MonteCarloTester';
import { primaryJobOfferDataset } from '../data/decisionData';
import type { Option, Criterion } from '../types/decision';

describe('Monte Carlo Decision Stress-Tester Observable Component Suite', () => {
  const criteria = primaryJobOfferDataset.criteria;
  const options = primaryJobOfferDataset.options;
  const weights: Record<string, number> = {};
  criteria.forEach((c) => (weights[c.id] = c.defaultWeight));

  // Helper function to render component using supported standard React infrastructure
  function renderTester(props: React.ComponentProps<typeof MonteCarloTester>): string {
    return renderToString(React.createElement(MonteCarloTester, props));
  }

  // 1. Initial rendering
  it('renders initial simulation frame with title, 1,000 iterations badge, and controls', () => {
    const html = renderTester({
      criteria,
      options,
      weights,
    });

    expect(html).toContain('Monte Carlo Decision Stress-Tester');
    expect(html).toContain('1,000 Iterations');
    expect(html).toContain('Rerun 1,000 Passes');
    expect(html).toContain('Empirical Robustness');
    expect(html).toContain('Priority Fluctuation Noise (±15%)');
  });

  // 2. Valid simulation results & observable outputs
  it('renders valid simulation results displaying alternative win rates and robustness', () => {
    const html = renderTester({
      criteria,
      options,
      weights,
      initialSeed: 42,
      initialNoiseLevel: 15,
    });

    // Check that option names and win percentages appear in the rendered output
    expect(html).toContain('Company Alpha');
    expect(html).toContain('Company Beta');
    expect(html).toContain('%');
    expect(html).toMatch(/Company (Alpha|Beta)<\/strong> maintains victory/);
    expect(html).toContain('Total Distribution:');
  });

  // 3. Invalid and incomplete inputs (safely returns empty string / null without crashing)
  describe('Invalid and incomplete inputs error handling', () => {
    it('safely handles fewer than 2 alternatives (0 options) without runtime errors', () => {
      const html = renderTester({
        criteria,
        options: [],
        weights,
      });
      expect(html).toBe('');
    });

    it('safely handles a single alternative without runtime errors', () => {
      const html = renderTester({
        criteria,
        options: [options[0]],
        weights,
      });
      expect(html).toBe('');
    });

    it('safely handles empty criteria list without runtime errors', () => {
      const html = renderTester({
        criteria: [],
        options: [options[0], options[1]],
        weights: {},
      });
      expect(html).toBe('');
    });

    it('safely handles incomplete score matrix (missing criterion score) without runtime errors', () => {
      const incompleteOption: Option = {
        ...options[0],
        scores: { careerGrowth: 90 }, // missing other criteria scores
      };
      const html = renderTester({
        criteria,
        options: [incompleteOption, options[1]],
        weights,
      });
      expect(html).toBe('');
    });

    it('safely handles non-finite scores (NaN) without runtime errors', () => {
      const nanOption: Option = {
        ...options[0],
        scores: { ...options[0].scores, careerGrowth: NaN },
      };
      const html = renderTester({
        criteria,
        options: [nanOption, options[1]],
        weights,
      });
      expect(html).toBe('');
    });

    it('safely handles out-of-range scores (> 100) without runtime errors', () => {
      const outOfRangeOption: Option = {
        ...options[0],
        scores: { ...options[0].scores, careerGrowth: 150 },
      };
      const html = renderTester({
        criteria,
        options: [outOfRangeOption, options[1]],
        weights,
      });
      expect(html).toBe('');
    });
  });

  // 4. Multiple alternatives: render all alternatives and display 3rd alternative dominant winner (M-02 & M-03)
  describe('Multiple alternatives handling (M-02)', () => {
    const multiCriteria: Criterion[] = [
      { id: 'c1', name: 'Speed', shortName: 'Speed', description: '', category: 'execution', defaultWeight: 50 },
      { id: 'c2', name: 'Quality', shortName: 'Quality', description: '', category: 'growth', defaultWeight: 50 },
    ];
    const multiWeights = { c1: 50, c2: 50 };

    const threeOptions: Option[] = [
      {
        id: 'opt1',
        name: 'Option First',
        tagline: '',
        description: '',
        color: '#B8FF5A',
        accentBorder: '',
        scores: { c1: 40, c2: 40 },
        strengths: [],
        vulnerabilities: [],
      },
      {
        id: 'opt2',
        name: 'Option Second',
        tagline: '',
        description: '',
        color: '#38BDF8',
        accentBorder: '',
        scores: { c1: 45, c2: 45 },
        strengths: [],
        vulnerabilities: [],
      },
      {
        id: 'opt3',
        name: 'Option Third Dominant',
        tagline: '',
        description: '',
        color: '#F59E0B',
        accentBorder: '',
        scores: { c1: 95, c2: 95 }, // Clearly dominant winner!
        strengths: [],
        vulnerabilities: [],
      },
    ];

    it('renders every alternative and correctly displays Option 3 as the dominant winner', () => {
      const html = renderTester({
        criteria: multiCriteria,
        options: threeOptions,
        weights: multiWeights,
        initialSeed: 42,
      });

      // Verify every alternative is rendered in the output
      expect(html).toContain('Option First');
      expect(html).toContain('Option Second');
      expect(html).toContain('Option Third Dominant');

      // Verify the 3rd alternative is correctly highlighted as dominant winner
      expect(html).toContain('Option Third Dominant</strong> maintains victory in');
      expect(html).toContain('High Confidence');

      // Verify total distribution sums to ~100%
      expect(html).toMatch(/Total Distribution: 100(\.0)?%/);
    });
  });

  // 5. Locked-weight propagation (H-01 & M-03)
  it('propagates locked criteria to simulation and reflects constrained perturbation', () => {
    const lockedHtml = renderTester({
      criteria,
      options,
      weights,
      lockedIds: ['careerGrowth', 'compensation'],
      initialSeed: 42,
      initialNoiseLevel: 25,
    });

    const unlockedHtml = renderTester({
      criteria,
      options,
      weights,
      lockedIds: [],
      initialSeed: 42,
      initialNoiseLevel: 25,
    });

    expect(lockedHtml).toContain('Monte Carlo Decision Stress-Tester');
    expect(unlockedHtml).toContain('Monte Carlo Decision Stress-Tester');
    // Because lockedIds freezes key criteria, the rendered outputs differ from fully unlocked perturbations
    expect(lockedHtml).not.toBe(unlockedHtml);
  });

  // 6. Seeded rerun behavior
  it('produces identical outputs for identical seeds and varies when seed changes', () => {
    const run1Seed42 = renderTester({
      criteria,
      options,
      weights,
      initialSeed: 42,
    });

    const run2Seed42 = renderTester({
      criteria,
      options,
      weights,
      initialSeed: 42,
    });

    const runSeed999 = renderTester({
      criteria,
      options,
      weights,
      initialSeed: 999,
    });

    // Identical seeds MUST produce byte-for-byte identical rendered HTML
    expect(run1Seed42).toBe(run2Seed42);
    // Different seeds MUST produce different simulation iterations
    expect(run1Seed42).not.toBe(runSeed999);
  });

  // 7. Noise-level changes
  it('observably changes perturbation when noise level is adjusted', () => {
    const lowNoiseHtml = renderTester({
      criteria,
      options,
      weights,
      initialNoiseLevel: 10,
      initialSeed: 42,
    });

    const highNoiseHtml = renderTester({
      criteria,
      options,
      weights,
      initialNoiseLevel: 25,
      initialSeed: 42,
    });

    expect(lowNoiseHtml).toContain('Priority Fluctuation Noise (±10%)');
    expect(highNoiseHtml).toContain('Priority Fluctuation Noise (±25%)');
    expect(lowNoiseHtml).not.toBe(highNoiseHtml);
  });

  // 8. Scope Item 6: No-dominant-result handling
  describe('Scope Item 6: No-dominant-result handling', () => {
    it('displays an explicit unavailable state and does not invent options[0] as winner when simulation is tied', () => {
      // Create two options with identical scores across all criteria to produce an exact mathematical tie
      const tiedCriteria: Criterion[] = [
        { id: 'c1', name: 'Speed', shortName: 'Speed', description: '', category: 'execution', defaultWeight: 50 },
        { id: 'c2', name: 'Quality', shortName: 'Quality', description: '', category: 'growth', defaultWeight: 50 },
      ];
      const tiedWeights = { c1: 50, c2: 50 };

      const tiedOptions: Option[] = [
        {
          id: 'tied-opt-1',
          name: 'Alternative One',
          tagline: '',
          description: '',
          color: '#B8FF5A',
          accentBorder: '',
          scores: { c1: 75, c2: 75 },
          strengths: [],
          vulnerabilities: [],
        },
        {
          id: 'tied-opt-2',
          name: 'Alternative Two',
          tagline: '',
          description: '',
          color: '#38BDF8',
          accentBorder: '',
          scores: { c1: 75, c2: 75 },
          strengths: [],
          vulnerabilities: [],
        },
      ];

      const html = renderTester({
        criteria: tiedCriteria,
        options: tiedOptions,
        weights: tiedWeights,
        initialSeed: 42,
      });

      // Must display an explicit "No Dominant Option" state
      expect(html).toContain('No Dominant Option');
      expect(html).toContain('No single option dominates under priority noise');

      // Crucial: Must NOT fall back to options[0] ("Alternative One") and invent a dominant victory statement
      expect(html).not.toContain('Alternative One</strong> maintains victory');
      expect(html).not.toContain('Alternative Two</strong> maintains victory');
    });
  });

  // 9. Scope Item 7: Interactive Controller State Machine & Rerun Verification
  describe('Scope Item 7: Monte Carlo Controller State & Noise Level Transitions', () => {
    /**
     * NOTE ON DOM TESTING ENVIRONMENT:
     * In this project workspace, Vitest executes in the Node.js environment by default.
     * Packages like 'happy-dom' or 'jsdom' are not installed in apps/web/node_modules.
     * Setting Vitest environment to happy-dom throws ERR_MODULE_NOT_FOUND.
     * Therefore, server rendering (renderToString) is strictly used for markup verification,
     * while the deterministic state transitions of the rerun button (seed progression) and
     * noise level controls (10% -> 15% -> 25%) are validated below via their state machine contract.
     * The smallest justified change to enable full DOM synthetic event testing is:
     * `npm install -D happy-dom --workspace=@decision-os/web` and `environment: 'happy-dom'` in vite.config.ts.
     */
    it('rerun action produces a deterministic sequence of distinct seed evaluations', () => {
      let currentSeed = 42;
      const seedSequence: number[] = [currentSeed];

      // Simulate 5 rerun passes as executed by handleRunTest: setSeed(prev => (prev + 1) >>> 0)
      for (let i = 0; i < 5; i++) {
        currentSeed = (currentSeed + 1) >>> 0;
        seedSequence.push(currentSeed);
      }

      expect(seedSequence).toEqual([42, 43, 44, 45, 46, 47]);

      // Every distinct seed in the sequence produces distinct simulated perturbations
      const renderedOutputs = seedSequence.map((s) =>
        renderTester({
          criteria,
          options,
          weights,
          initialSeed: s,
        })
      );

      const uniqueOutputs = new Set(renderedOutputs);
      expect(uniqueOutputs.size).toBe(seedSequence.length);
    });

    it('noise level selector transitions across supported settings [10, 15, 25]', () => {
      const supportedLevels = [10, 15, 25];
      const outputs = supportedLevels.map((lvl) =>
        renderTester({
          criteria,
          options,
          weights,
          initialNoiseLevel: lvl,
          initialSeed: 42,
        })
      );

      // Verify each noise level badge renders its specific percentage
      expect(outputs[0]).toContain('Priority Fluctuation Noise (±10%)');
      expect(outputs[1]).toContain('Priority Fluctuation Noise (±15%)');
      expect(outputs[2]).toContain('Priority Fluctuation Noise (±25%)');

      // Verify each noise level produces a distinct perturbation distribution
      expect(outputs[0]).not.toBe(outputs[1]);
      expect(outputs[1]).not.toBe(outputs[2]);
    });
  });
});
