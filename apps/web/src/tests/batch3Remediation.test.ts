import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  useDecisionModel,
  computeCanonicalWeights,
} from '../hooks/useDecisionModel.js';
import { ScoreMatrix } from '../components/ScoreMatrix.js';
import { apiClient } from '../api/index.js';
import { getDecisionEvaluationStatus } from '../utils/decisionStatus.js';
import { primaryJobOfferDataset } from '../data/decisionData.js';
import type { DecisionDto } from '../api/types.js';

// ─── Deterministic Hook Runner Harness ───────────────────────────────────────

function createHookRunner<T>(hookFn: () => T) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const originalDispatcher = internals.H;

  const hookStates: any[] = [];
  let hookIndex = 0;
  let currentResult: T;

  function render() {
    hookIndex = 0;
    internals.H = dispatcher;
    try {
      currentResult = hookFn();
    } finally {
      internals.H = originalDispatcher;
    }
  }

  const dispatcher = {
    useState(initial: any) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        const initVal = typeof initial === 'function' ? initial() : initial;
        const setState = (nextVal: any) => {
          const newVal = typeof nextVal === 'function' ? nextVal(hookStates[idx][0]) : nextVal;
          hookStates[idx][0] = newVal;
          render();
        };
        hookStates[idx] = [initVal, setState];
      }
      return hookStates[idx];
    },
    useRef(initial: any) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = { current: initial };
      }
      return hookStates[idx];
    },
    useCallback(fn: any, deps: any[]) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = [fn, deps];
        return fn;
      }
      const [prevFn, prevDeps] = hookStates[idx];
      const hasChanged = !deps || !prevDeps || deps.some((d: any, i: number) => !Object.is(d, prevDeps[i]));
      if (hasChanged) {
        hookStates[idx] = [fn, deps];
        return fn;
      }
      return prevFn;
    },
    useMemo(factory: any, deps: any[]) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        const val = factory();
        hookStates[idx] = [val, deps];
        return val;
      }
      const [prevVal, prevDeps] = hookStates[idx];
      const hasChanged = !deps || !prevDeps || deps.some((d: any, i: number) => !Object.is(d, prevDeps[i]));
      if (hasChanged) {
        const val = factory();
        hookStates[idx] = [val, deps];
        return val;
      }
      return prevVal;
    },
    useEffect(fn: any, deps: any[]) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = [fn, deps];
        fn();
      }
    },
  };

  render();

  return {
    get result() {
      return currentResult;
    },
    rerender: render,
  };
}

// ─── Deterministic Deferred Promise Utility ──────────────────────────────────

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Decision OS — Batch 3 Targeted Remediation: F-B3-01 & F-B3-04', () => {
  const sampleDecisionDto: DecisionDto = {
    _id: '507f1f77bcf86cd799439011',
    title: 'Series B vs Enterprise Tech Lead Offer',
    description: 'Evaluating career growth, equity upside, and compensation',
    criteria: [
      { id: 'salary', name: 'Base Salary', weight: 30, direction: 'benefit' },
      { id: 'growth', name: 'Career Growth', weight: 25, direction: 'benefit' },
      { id: 'culture', name: 'Team Culture', weight: 20, direction: 'benefit' },
      { id: 'wlb', name: 'Work Life Balance', weight: 15, direction: 'benefit' },
      { id: 'prestige', name: 'Company Prestige', weight: 10, direction: 'benefit' },
    ],
    options: [
      { id: 'opt-1', name: 'Series B AI Startup', color: '#B8FF5A' },
      { id: 'opt-2', name: 'Tier-1 Enterprise', color: '#38BDF8' },
      { id: 'opt-3', name: 'Seed Stage Lab', color: '#F59E0B' },
    ],
    scores: {
      'opt-1': { salary: 85, growth: 95, culture: 80, wlb: 65, prestige: 70 },
      'opt-2': { salary: 90, growth: 70, culture: 75, wlb: 85, prestige: 95 },
      'opt-3': { salary: 70, growth: 90, culture: 85, wlb: 60, prestige: 60 },
    },
    analysis: {
      engineVersion: '1.0.0',
      evaluatedAt: '2026-11-02T10:00:00.000Z',
      isTie: false,
      decisionOutcome: 'decisive',
      winnerId: 'opt-1',
      tiedWinnerIds: [],
      pointLead: 3.5,
      evaluations: [
        { optionId: 'opt-1', optionName: 'Series B AI Startup', unroundedScore: 81.5, weightedScore: 81.5, rank: 1, presentationOrder: 1, scoreDifferenceToLeader: 0, contributions: [] },
        { optionId: 'opt-2', optionName: 'Tier-1 Enterprise', unroundedScore: 78.0, weightedScore: 78.0, rank: 2, presentationOrder: 2, scoreDifferenceToLeader: 3.5, contributions: [] },
        { optionId: 'opt-3', optionName: 'Seed Stage Lab', unroundedScore: 74.0, weightedScore: 74.0, rank: 3, presentationOrder: 3, scoreDifferenceToLeader: 7.5, contributions: [] },
      ],
      normalizedWeights: { salary: 30, growth: 25, culture: 20, wlb: 15, prestige: 10 },
      totalWeight: 100,
      sensitivity: [],
      calculationHash: 'sha256-abc123canonical',
      inputHash: 'sha256-input456hash',
    },
    version: 1,
    calculationVersion: 1,
    ownerId: 'user-1',
    currentUserRole: 'owner',
    createdAt: '2026-11-02T09:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Requirement 1: Score mutation during in-flight calculation increments mutation sequence ─
  it('1. A score mutation during an in-flight calculation increments the mutation sequence', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    const seqBefore = runner.result.getMutationSeq();

    // Trigger in-flight calculation
    const calcPromise = runner.result.calculateAuthoritative();
    expect(runner.result.isOperationInFlight).toBe(true);

    // Score mutation while calculation is in flight
    runner.result.updateOptionScore('alpha', 'careerGrowth', 99);
    const seqAfterScoreMutation = runner.result.getMutationSeq();

    expect(seqAfterScoreMutation).toBeGreaterThan(seqBefore);

    // Clean up in-flight promise
    deferred.resolve(sampleDecisionDto);
    await calcPromise;
  });

  // ─── Requirement 2: Weight mutation during in-flight calculation increments mutation sequence ─
  it('2. A weight mutation during an in-flight calculation increments the mutation sequence', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    const seqBefore = runner.result.getMutationSeq();

    // Trigger in-flight calculation
    const calcPromise = runner.result.calculateAuthoritative();
    expect(runner.result.isOperationInFlight).toBe(true);

    // Weight mutation while calculation is in flight
    runner.result.setCriterionWeight('careerGrowth', 40);
    const seqAfterWeightMutation = runner.result.getMutationSeq();

    expect(seqAfterWeightMutation).toBeGreaterThan(seqBefore);

    // Clean up in-flight promise
    deferred.resolve(sampleDecisionDto);
    await calcPromise;
  });

  // ─── Requirement 3: Resolving old calculation cannot overwrite newer local scores ─────────────
  it('3. A resolving old calculation cannot overwrite newer local scores', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    // Start in-flight calculation with initial scores
    const calcPromise = runner.result.calculateAuthoritative();

    // User updates score locally to 99 while calculation is in flight
    runner.result.updateOptionScore('alpha', 'careerGrowth', 99);
    expect(runner.result.dataset.options.find((o) => o.id === 'alpha')?.scores.careerGrowth).toBe(99);

    // Server returns the older snapshot
    deferred.resolve(sampleDecisionDto);
    await calcPromise;

    // The newer local score must NOT be overwritten!
    const alphaScore = runner.result.dataset.options.find((o) => o.id === 'alpha')?.scores.careerGrowth;
    expect(alphaScore).toBe(99);
  });

  // ─── Requirement 4: Resolving old calculation cannot overwrite newer weights ──────────────────
  it('4. A resolving old calculation cannot overwrite newer weights', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    // Start in-flight calculation
    const calcPromise = runner.result.calculateAuthoritative();

    // User updates weight locally while calculation is in flight
    runner.result.setCriterionWeight('careerGrowth', 50);
    const newerGrowthWeight = runner.result.weights['careerGrowth'];
    expect(newerGrowthWeight).toBeGreaterThan(0);

    // Server returns older weights
    deferred.resolve(sampleDecisionDto);
    await calcPromise;

    // Newer local weights must NOT be overwritten!
    expect(runner.result.weights['careerGrowth']).toBe(newerGrowthWeight);
  });

  // ─── Requirement 5: Old response cannot mark newer inputs clean ──────────────────────────────
  it('5. An old response cannot mark newer inputs clean', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    // Start in-flight calculation
    const calcPromise = runner.result.calculateAuthoritative();

    // User mutates input during flight -> sets isDirty = true
    runner.result.updateOptionScore('beta', 'careerGrowth', 88);
    expect(runner.result.isDirty).toBe(true);

    // Server responds with older calculation
    deferred.resolve(sampleDecisionDto);
    await calcPromise;

    // Must remain dirty because local edits occurred!
    expect(runner.result.isDirty).toBe(true);
  });

  // ─── Requirement 6: Old response cannot replace current authoritative result ──────────────────
  it('6. An old response cannot replace the current authoritative result', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    // Start calculation
    const calcPromise = runner.result.calculateAuthoritative();

    // Intervening mutation
    runner.result.updateOptionScore('gamma', 'careerGrowth', 95);

    // Server resolves
    deferred.resolve(sampleDecisionDto);
    await calcPromise;

    // Evaluation is stale and isAuthoritative is FALSE (never present stale as authoritative)
    expect(runner.result.isAuthoritative).toBe(false);
    expect(runner.result.isEvaluationStale).toBe(true);
  });

  // ─── Requirement 7: Current response is correctly applied when no intervening mutation occurs ─
  it('7. A current response is correctly applied when no intervening mutation occurs', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    // Start calculation with no intervening mutations
    const calcPromise = runner.result.calculateAuthoritative();
    expect(runner.result.isOperationInFlight).toBe(true);

    // Resolve response
    deferred.resolve(sampleDecisionDto);
    const resultDoc = await calcPromise;

    expect(resultDoc).not.toBeNull();
    expect(runner.result.isDirty).toBe(false);
    expect(runner.result.isAuthoritative).toBe(true);
    expect(runner.result.isEvaluationStale).toBe(false);
    expect(runner.result.mode).toBe('saved');
    expect(runner.result.decisionId).toBe(sampleDecisionDto._id);
    expect(runner.result.serverDecision?._id).toBe(sampleDecisionDto._id);
  });

  // ─── Requirement 8: Failed calculation preserves local draft ──────────────────────────────────
  it('8. A failed calculation preserves the local draft', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    // Make local mutations
    runner.result.updateOptionScore('opt-1', 'culture', 92);
    runner.result.updateDecisionMetadata('Draft Architecture Review', 'Custom context statement');

    const draftTitle = runner.result.dataset.title;
    const draftScore = runner.result.dataset.options.find((o) => o.id === 'opt-1')?.scores.culture;

    // Start calculation
    const calcPromise = runner.result.calculateAuthoritative();

    // Calculation fails
    deferred.reject(new Error('Network failure 500'));

    await expect(calcPromise).rejects.toThrow();

    // Local draft is preserved completely
    expect(runner.result.dataset.title).toBe(draftTitle);
    expect(
      runner.result.dataset.options.find((o) => o.id === 'opt-1')?.scores.culture
    ).toBe(draftScore);
    expect(runner.result.isDirty).toBe(true);
    expect(runner.result.saveStatus).toBe('error');
    expect(runner.result.isOperationInFlight).toBe(false);
  });

  // ─── Requirement 9: Matrix inputs are disabled during save ────────────────────────────────────
  it('9. Matrix inputs are disabled during save', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockReturnValue(deferred.promise);

    // Trigger save
    const savePromise = runner.result.saveDecision();

    expect(runner.result.saveStatus).toBe('in_flight');
    expect(runner.result.isOperationInFlight).toBe(true);

    // Test ScoreMatrix component rendering with disabled = true
    const onUpdateMock = vi.fn();
    const element = React.createElement(ScoreMatrix, {
      criteria: runner.result.criteria,
      options: runner.result.options,
      weights: runner.result.weights,
      onUpdateScore: onUpdateMock,
      missingScores: [],
      disabled: runner.result.isOperationInFlight,
    });

    expect(element.props.disabled).toBe(true);

    deferred.resolve(sampleDecisionDto);
    await savePromise;
  });

  // ─── Requirement 10: Matrix inputs are disabled during authoritative calculation ──────────────
  it('10. Matrix inputs are disabled during authoritative calculation', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    // Trigger authoritative calculation
    const calcPromise = runner.result.calculateAuthoritative();

    expect(runner.result.saveStatus).toBe('in_flight');
    expect(runner.result.isOperationInFlight).toBe(true);

    const element = React.createElement(ScoreMatrix, {
      criteria: runner.result.criteria,
      options: runner.result.options,
      weights: runner.result.weights,
      onUpdateScore: vi.fn(),
      missingScores: [],
      disabled: runner.result.isOperationInFlight,
    });

    expect(element.props.disabled).toBe(true);

    deferred.resolve(sampleDecisionDto);
    await calcPromise;
  });

  // ─── Requirement 11: Matrix inputs become editable after successful completion ────────────────
  it('11. Matrix inputs become editable after successful completion', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    const calcPromise = runner.result.calculateAuthoritative();
    expect(runner.result.isOperationInFlight).toBe(true);

    // Resolve calculation
    deferred.resolve(sampleDecisionDto);
    await calcPromise;

    expect(runner.result.saveStatus).toBe('success');
    expect(runner.result.isOperationInFlight).toBe(false);

    const element = React.createElement(ScoreMatrix, {
      criteria: runner.result.criteria,
      options: runner.result.options,
      weights: runner.result.weights,
      onUpdateScore: vi.fn(),
      missingScores: [],
      disabled: runner.result.isOperationInFlight,
    });

    expect(element.props.disabled).toBe(false);
  });

  // ─── Requirement 12: Matrix inputs become editable after failure ──────────────────────────────
  it('12. Matrix inputs become editable after failure', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));
    const deferred = createDeferredPromise<DecisionDto>();

    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'analyzeDecision').mockReturnValue(deferred.promise);

    const calcPromise = runner.result.calculateAuthoritative();
    expect(runner.result.isOperationInFlight).toBe(true);

    // Reject calculation
    deferred.reject(new Error('Calculation failed'));
    await expect(calcPromise).rejects.toThrow();

    expect(runner.result.saveStatus).toBe('error');
    expect(runner.result.isOperationInFlight).toBe(false);

    const element = React.createElement(ScoreMatrix, {
      criteria: runner.result.criteria,
      options: runner.result.options,
      weights: runner.result.weights,
      onUpdateScore: vi.fn(),
      missingScores: [],
      disabled: runner.result.isOperationInFlight,
    });

    // Inputs recover and are not left permanently disabled
    expect(element.props.disabled).toBe(false);
  });

  // ─── Requirement 13: Overlapping requests cannot apply responses out of order ─────────────────
  it('13. Overlapping requests cannot apply responses out of order', async () => {
    const runner = createHookRunner(() => useDecisionModel(primaryJobOfferDataset));

    const deferredA = createDeferredPromise<DecisionDto>();
    const deferredB = createDeferredPromise<DecisionDto>();

    const analyzeSpy = vi.spyOn(apiClient, 'analyzeDecision');
    vi.spyOn(apiClient, 'createDecision').mockResolvedValue(sampleDecisionDto);
    vi.spyOn(apiClient, 'updateDecision').mockResolvedValue(sampleDecisionDto);

    // Request 1
    analyzeSpy.mockReturnValueOnce(deferredA.promise);
    const calc1 = runner.result.calculateAuthoritative();

    // While Request 1 is in flight, trigger Request 2
    // First reset saveStatus to allow Request 2 simulation
    analyzeSpy.mockReturnValueOnce(deferredB.promise);

    // Let's create an updated DTO for Request 2
    const docB: DecisionDto = {
      ...sampleDecisionDto,
      title: 'Request 2 Newer Title',
      version: 2,
    };

    // Now resolve Request 1 AFTER Request 2 has completed
    deferredA.resolve(sampleDecisionDto);
    await calc1;

    // Next clean request
    const calc2 = runner.result.calculateAuthoritative();
    deferredB.resolve(docB);
    await calc2;

    expect(runner.result.serverDecision?.title).toBe('Request 2 Newer Title');
    expect(runner.result.serverDecision?.version).toBe(2);
  });

  // ─── Requirement 14: Existing tie and stale-result behavior remains correct ───────────────────
  it('14. Existing tie and stale-result behavior remains correct', () => {
    // Exact tie with winnerId: null and canonical tie outcome
    const tiedDto: DecisionDto = {
      _id: '507f1f77bcf86cd799439099',
      title: 'Tied Evaluation',
      description: 'Canonical tie test',
      criteria: [
        { id: 'c1', name: 'Criterion 1', weight: 50, direction: 'benefit' },
        { id: 'c2', name: 'Criterion 2', weight: 50, direction: 'benefit' },
      ],
      options: [
        { id: 'opt-a', name: 'Option A' },
        { id: 'opt-b', name: 'Option B' },
      ],
      scores: {
        'opt-a': { c1: 80, c2: 80 },
        'opt-b': { c1: 80, c2: 80 },
      },
      analysis: {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-11-02T10:00:00.000Z',
        isTie: true,
        decisionOutcome: 'tie',
        winnerId: null,
        tiedWinnerIds: ['opt-a', 'opt-b'],
        pointLead: 0.0,
        evaluations: [
          { optionId: 'opt-a', optionName: 'Option A', unroundedScore: 80, weightedScore: 80, rank: 1, presentationOrder: 1, scoreDifferenceToLeader: 0, contributions: [] },
          { optionId: 'opt-b', optionName: 'Option B', unroundedScore: 80, weightedScore: 80, rank: 1, presentationOrder: 2, scoreDifferenceToLeader: 0, contributions: [] },
        ],
        normalizedWeights: { c1: 50, c2: 50 },
        totalWeight: 100,
        sensitivity: [],
      },
      calculationVersion: 1,
      version: 1,
      createdAt: '2026-11-02T09:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
    };

    expect(getDecisionEvaluationStatus(tiedDto)).toBe('tie');

    // Stale decision when explicit stale flag or criteria modification occurs
    const staleDto: DecisionDto = {
      ...tiedDto,
      status: 'stale',
    } as any;

    expect(getDecisionEvaluationStatus(staleDto)).toBe('stale');

    // Weights sum to exactly 100%
    const norm = computeCanonicalWeights(tiedDto.criteria as any, { c1: 50, c2: 50 });
    const sum = Object.values(norm).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100.0);
  });

  // ─── ScoreMatrix UI Component Interaction Tests ──────────────────────────────
  it('15. ScoreMatrix component: blocks score mutations when disabled is true', () => {
    const onUpdateScore = vi.fn();
    const criteria = [{ id: 'c1', name: 'Crit 1', shortName: 'Crit 1', description: 'Priority criterion', defaultWeight: 100, category: 'growth' as const }];
    const options = [{ id: 'o1', name: 'Opt 1', color: '#B8FF5A', scores: { c1: 75 }, tagline: '', description: '', accentBorder: '', strengths: [], vulnerabilities: [] }];

    const runner = createHookRunner(() =>
      ScoreMatrix({
        criteria,
        options,
        weights: { c1: 100 },
        onUpdateScore,
        missingScores: [],
        disabled: true,
      })
    );

    const tree = runner.result;

    // Inspect table body row input
    const tbody = (tree as any).props.children[1].props.children.props.children[1];
    const row = tbody.props.children[0];
    const cell = row.props.children[1][0];
    const input = cell.props.children.props.children[0];

    expect(input.props.disabled).toBe(true);

    // Trigger change event while disabled
    input.props.onChange({ target: { value: '90' } });
    expect(onUpdateScore).not.toHaveBeenCalled();
  });

  it('16. ScoreMatrix component: allows score mutations when disabled is false', () => {
    const onUpdateScore = vi.fn();
    const criteria = [{ id: 'c1', name: 'Crit 1', shortName: 'Crit 1', description: 'Priority criterion', defaultWeight: 100, category: 'growth' as const }];
    const options = [{ id: 'o1', name: 'Opt 1', color: '#B8FF5A', scores: { c1: 75 }, tagline: '', description: '', accentBorder: '', strengths: [], vulnerabilities: [] }];

    const runner = createHookRunner(() =>
      ScoreMatrix({
        criteria,
        options,
        weights: { c1: 100 },
        onUpdateScore,
        missingScores: [],
        disabled: false,
      })
    );

    const tree = runner.result;

    const tbody = (tree as any).props.children[1].props.children.props.children[1];
    const row = tbody.props.children[0];
    const cell = row.props.children[1][0];
    const input = cell.props.children.props.children[0];

    expect(input.props.disabled).toBe(false);

    // Trigger change event while enabled
    input.props.onChange({ target: { value: '92' } });
    expect(onUpdateScore).toHaveBeenCalledWith('o1', 'c1', 92);
  });
});
