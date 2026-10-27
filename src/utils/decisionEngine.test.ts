import { describe, it, expect } from 'vitest';
import {
  normalizeWeights,
  evaluateOption,
  runDecisionEngine,
} from './decisionEngine';
import type { Criterion, Option } from '../types/decision';

const mockCriteria: Criterion[] = [
  { id: 'careerGrowth', name: 'Career Growth', shortName: 'Growth', description: '', category: 'growth', defaultWeight: 30 },
  { id: 'compensation', name: 'Compensation', shortName: 'Comp', description: '', category: 'finance', defaultWeight: 25 },
  { id: 'learning', name: 'Learning & Mentorship', shortName: 'Learning', description: '', category: 'growth', defaultWeight: 20 },
  { id: 'workLifeBalance', name: 'Work-Life Balance', shortName: 'WLB', description: '', category: 'lifestyle', defaultWeight: 15 },
  { id: 'stability', name: 'Company Stability', shortName: 'Stability', description: '', category: 'risk', defaultWeight: 10 },
];

const optionAlpha: Option = {
  id: 'alpha',
  name: 'Company Alpha',
  badge: 'Series B Startup',
  tagline: 'High velocity, steep growth, moderate comp',
  description: 'Fast-paced hypergrowth team.',
  color: '#B8FF5A',
  accentBorder: 'border-signal',
  scores: {
    careerGrowth: 95,
    compensation: 70,
    learning: 92,
    workLifeBalance: 75,
    stability: 65,
  },
  strengths: ['Rapid promotion cadence', 'Exceptional mentorship'],
  vulnerabilities: ['Demanding sprint cycles', 'Startup equity risk'],
};

const optionBeta: Option = {
  id: 'beta',
  name: 'Company Beta',
  badge: 'Established Tech Enterprise',
  tagline: 'Top-of-market compensation, strong stability',
  description: 'Public global tech leader.',
  color: '#38BDF8',
  accentBorder: 'border-sky-500',
  scores: {
    careerGrowth: 72,
    compensation: 95,
    learning: 75,
    workLifeBalance: 82,
    stability: 92,
  },
  strengths: ['Top tier base salary & bonuses', 'High job security & 40h weeks'],
  vulnerabilities: ['Slower advancement tracks', 'More bureaucratic approvals'],
};

describe('Decision OS Engine Mathematical Integrity', () => {
  it('correctly calculates weighted score for Option Alpha', () => {
    const weights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };
    const evaluation = evaluateOption(optionAlpha, mockCriteria, weights);
    
    expect(evaluation.weightedScore).toBeCloseTo(82.2, 1);
    expect(evaluation.contributions.length).toBe(5);
  });

  it('correctly calculates weighted score for Option Beta', () => {
    const weights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };
    const evaluation = evaluateOption(optionBeta, mockCriteria, weights);
    
    expect(evaluation.weightedScore).toBeCloseTo(81.9, 1);
  });

  it('normalizes weights so their total sum equals exactly 100%', () => {
    const rawWeights = { careerGrowth: 50, compensation: 50, learning: 50, workLifeBalance: 50, stability: 50 };
    const normalized = normalizeWeights(rawWeights, mockCriteria);
    const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    expect(normalized.careerGrowth).toBe(20);
  });

  it('respects locked weights during normalization', () => {
    const rawWeights = { careerGrowth: 40, compensation: 20, learning: 20, workLifeBalance: 10, stability: 10 };
    const lockedIds = ['careerGrowth'];
    const adjustedWeights = { ...rawWeights, compensation: 60 };
    
    const normalized = normalizeWeights(adjustedWeights, mockCriteria, lockedIds);
    expect(normalized.careerGrowth).toBe(40);
    const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('correctly identifies tipping point where Beta overtakes Alpha', () => {
    const weights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };
    const engineResult = runDecisionEngine([optionAlpha, optionBeta], mockCriteria, weights);

    expect(engineResult.winner.option.id).toBe('alpha');
    expect(engineResult.runnerUp?.option.id).toBe('beta');

    const compSensitivity = engineResult.sensitivity.find(s => s.criterionId === 'compensation');
    expect(compSensitivity).toBeDefined();
    expect(compSensitivity?.tippingPointWeight).toBeGreaterThan(25);
    expect(compSensitivity?.wouldFlipToOptionId).toBe('beta');
  });

  it('switches ranking when Money-First scenario is applied', () => {
    const moneyFirstWeights = { careerGrowth: 15, compensation: 45, learning: 10, workLifeBalance: 15, stability: 15 };
    const engineResult = runDecisionEngine([optionAlpha, optionBeta], mockCriteria, moneyFirstWeights);

    expect(engineResult.winner.option.id).toBe('beta');
    expect(engineResult.runnerUp?.option.id).toBe('alpha');
    expect(engineResult.explainability.headline).toContain('Company Beta');
  });
});
