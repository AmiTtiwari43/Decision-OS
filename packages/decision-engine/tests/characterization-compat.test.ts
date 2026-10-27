import { describe, it, expect } from 'vitest';
import { evaluateDecision } from '../src';
import type { EngineCriterion, EngineOption } from '../src';

describe('Phase 0 Characterization Compatibility Suite (F1–F3)', () => {
  describe('F1: Job Offer Evaluation', () => {
    const criteria: EngineCriterion[] = [
      { id: 'careerGrowth', name: 'Career Growth', weight: 30 },
      { id: 'compensation', name: 'Compensation', weight: 25 },
      { id: 'learning', name: 'Learning & Mentorship', weight: 20 },
      { id: 'workLifeBalance', name: 'Work-Life Balance', weight: 15 },
      { id: 'stability', name: 'Company Stability', weight: 10 },
    ];
    const options: EngineOption[] = [
      {
        id: 'alpha',
        name: 'Company Alpha',
        scores: { careerGrowth: 95, compensation: 70, learning: 92, workLifeBalance: 74, stability: 65 },
      },
      {
        id: 'beta',
        name: 'Company Beta',
        scores: { careerGrowth: 72, compensation: 95, learning: 76, workLifeBalance: 86, stability: 94 },
      },
      {
        id: 'gamma',
        name: 'Company Gamma',
        scores: { careerGrowth: 68, compensation: 78, learning: 80, workLifeBalance: 96, stability: 82 },
      },
    ];

    it('reproduces F1 Default Weights: Beta 82.9 vs Alpha 82.0 vs Gamma 78.5', () => {
      const result = evaluateDecision({ criteria, options });
      expect(result.winnerId).toBe('beta');
      expect(result.evaluations.find(e => e.optionId === 'beta')!.weightedScore).toBe(82.9);
      expect(result.evaluations.find(e => e.optionId === 'alpha')!.weightedScore).toBe(82.0);
      expect(result.evaluations.find(e => e.optionId === 'gamma')!.weightedScore).toBe(78.5);
    });

    it('reproduces F1 Career-First scenario: Alpha 85.7 vs Beta 80.1 vs Gamma 76.5', () => {
      const careerFirstCriteria: EngineCriterion[] = [
        { id: 'careerGrowth', name: 'Career Growth', weight: 40 },
        { id: 'compensation', name: 'Compensation', weight: 20 },
        { id: 'learning', name: 'Learning', weight: 25 },
        { id: 'workLifeBalance', name: 'WLB', weight: 10 },
        { id: 'stability', name: 'Stability', weight: 5 },
      ];
      const result = evaluateDecision({ criteria: careerFirstCriteria, options });
      expect(result.winnerId).toBe('alpha');
      expect(result.evaluations.find(e => e.optionId === 'alpha')!.weightedScore).toBe(85.7);
      expect(result.evaluations.find(e => e.optionId === 'beta')!.weightedScore).toBe(80.1);
      expect(result.evaluations.find(e => e.optionId === 'gamma')!.weightedScore).toBe(76.5);
    });

    it('reproduces F1 Money-First scenario: Beta 88.1 vs Gamma 80.0 vs Alpha 75.8', () => {
      const moneyFirstCriteria: EngineCriterion[] = [
        { id: 'careerGrowth', name: 'Career Growth', weight: 15 },
        { id: 'compensation', name: 'Compensation', weight: 45 },
        { id: 'learning', name: 'Learning', weight: 10 },
        { id: 'workLifeBalance', name: 'WLB', weight: 15 },
        { id: 'stability', name: 'Stability', weight: 15 },
      ];
      const result = evaluateDecision({ criteria: moneyFirstCriteria, options });
      expect(result.winnerId).toBe('beta');
      expect(result.evaluations.find(e => e.optionId === 'beta')!.weightedScore).toBe(88.1);
      expect(result.evaluations.find(e => e.optionId === 'gamma')!.weightedScore).toBe(80.0);
      expect(result.evaluations.find(e => e.optionId === 'alpha')!.weightedScore).toBe(75.8);
    });

    it('reproduces F1 Worklife-First scenario: Beta 85.4 vs Gamma 83.7 vs Alpha 77.7', () => {
      const worklifeCriteria: EngineCriterion[] = [
        { id: 'careerGrowth', name: 'Career Growth', weight: 15 },
        { id: 'compensation', name: 'Compensation', weight: 20 },
        { id: 'learning', name: 'Learning', weight: 15 },
        { id: 'workLifeBalance', name: 'WLB', weight: 35 },
        { id: 'stability', name: 'Stability', weight: 15 },
      ];
      const result = evaluateDecision({ criteria: worklifeCriteria, options });
      expect(result.winnerId).toBe('beta');
      expect(result.evaluations.find(e => e.optionId === 'beta')!.weightedScore).toBe(85.4);
      expect(result.evaluations.find(e => e.optionId === 'gamma')!.weightedScore).toBe(83.7);
      expect(result.evaluations.find(e => e.optionId === 'alpha')!.weightedScore).toBe(77.7);
    });
  });

  describe('F2: City Relocation Matrix', () => {
    const criteria: EngineCriterion[] = [
      { id: 'costOfLiving', name: 'Cost of Living', weight: 30 },
      { id: 'careerNetwork', name: 'Career Network', weight: 25 },
      { id: 'lifestyle', name: 'Lifestyle', weight: 20 },
      { id: 'climate', name: 'Climate', weight: 15 },
      { id: 'commute', name: 'Commute', weight: 10 },
    ];
    const options: EngineOption[] = [
      {
        id: 'austin',
        name: 'Austin',
        scores: { costOfLiving: 75, careerNetwork: 82, lifestyle: 85, climate: 70, commute: 60 },
      },
      {
        id: 'nyc',
        name: 'New York City',
        scores: { costOfLiving: 40, careerNetwork: 96, lifestyle: 98, climate: 65, commute: 94 },
      },
      {
        id: 'lisbon',
        name: 'Lisbon',
        scores: { costOfLiving: 88, careerNetwork: 68, lifestyle: 90, climate: 92, commute: 80 },
      },
    ];

    it('reproduces F2 Default: Lisbon 83.2 vs Austin 76.5 vs NYC 74.8', () => {
      const result = evaluateDecision({ criteria, options });
      expect(result.winnerId).toBe('lisbon');
      expect(result.evaluations.find(e => e.optionId === 'lisbon')!.weightedScore).toBe(83.2);
      expect(result.evaluations.find(e => e.optionId === 'austin')!.weightedScore).toBe(76.5);
      expect(result.evaluations.find(e => e.optionId === 'nyc')!.weightedScore).toBe(74.8);
    });

    it('reproduces F2 Career-Dense: NYC 84.7 vs Lisbon 79.0 vs Austin 78.2', () => {
      const careerDenseCriteria: EngineCriterion[] = [
        { id: 'costOfLiving', name: 'Cost of Living', weight: 15 },
        { id: 'careerNetwork', name: 'Career Network', weight: 45 },
        { id: 'lifestyle', name: 'Lifestyle', weight: 20 },
        { id: 'climate', name: 'Climate', weight: 10 },
        { id: 'commute', name: 'Commute', weight: 10 },
      ];
      const result = evaluateDecision({ criteria: careerDenseCriteria, options });
      expect(result.winnerId).toBe('nyc');
      expect(result.evaluations.find(e => e.optionId === 'nyc')!.weightedScore).toBe(84.7);
      expect(result.evaluations.find(e => e.optionId === 'lisbon')!.weightedScore).toBe(79.0);
      expect(result.evaluations.find(e => e.optionId === 'austin')!.weightedScore).toBe(78.2);
    });
  });

  describe('F3: Frontend Architecture Matrix', () => {
    const criteria: EngineCriterion[] = [
      { id: 'perf', name: 'Performance', weight: 30 },
      { id: 'dx', name: 'Dev Velocity', weight: 30 },
      { id: 'maintainability', name: 'Maintainability', weight: 25 },
      { id: 'talent', name: 'Hiring Pool', weight: 15 },
    ];
    const options: EngineOption[] = [
      {
        id: 'vite-react',
        name: 'Vite + React + Tailwind',
        scores: { perf: 88, dx: 95, maintainability: 90, talent: 96 },
      },
      {
        id: 'nextjs',
        name: 'Next.js App Router',
        scores: { perf: 92, dx: 78, maintainability: 82, talent: 92 },
      },
    ];

    it('reproduces F3 Default: Vite 91.8 vs Next.js 85.3', () => {
      const result = evaluateDecision({ criteria, options });
      expect(result.winnerId).toBe('vite-react');
      expect(result.evaluations.find(e => e.optionId === 'vite-react')!.weightedScore).toBe(91.8);
      expect(result.evaluations.find(e => e.optionId === 'nextjs')!.weightedScore).toBe(85.3);
    });

    it('reproduces F3 Velocity-First: Vite 92.8 vs Next.js 83.7', () => {
      const velocityCriteria: EngineCriterion[] = [
        { id: 'perf', name: 'Performance', weight: 20 },
        { id: 'dx', name: 'Dev Velocity', weight: 45 },
        { id: 'maintainability', name: 'Maintainability', weight: 20 },
        { id: 'talent', name: 'Hiring Pool', weight: 15 },
      ];
      const result = evaluateDecision({ criteria: velocityCriteria, options });
      expect(result.winnerId).toBe('vite-react');
      expect(result.evaluations.find(e => e.optionId === 'vite-react')!.weightedScore).toBe(92.8);
      expect(result.evaluations.find(e => e.optionId === 'nextjs')!.weightedScore).toBe(83.7);
    });
  });
});
