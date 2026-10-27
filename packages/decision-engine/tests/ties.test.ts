import { describe, it, expect } from 'vitest';
import { evaluateDecision } from '../src';
import type { EngineCriterion, EngineOption } from '../src';

describe('Canonical Decision Engine v1 Tie Semantics & Rank Assignment', () => {
  const criteria: EngineCriterion[] = [
    { id: 'c1', name: 'Criterion 1', weight: 50 },
    { id: 'c2', name: 'Criterion 2', weight: 50 },
  ];

  it('implements Standard Competition Ranking (1224) for 3-way top tie', () => {
    const options: EngineOption[] = [
      { id: 'oA', name: 'Option A', scores: { c1: 80, c2: 80 } },
      { id: 'oB', name: 'Option B', scores: { c1: 80, c2: 80 } },
      { id: 'oC', name: 'Option C', scores: { c1: 80, c2: 80 } },
      { id: 'oD', name: 'Option D', scores: { c1: 50, c2: 50 } },
    ];

    const result = evaluateDecision({ criteria, options });

    expect(result.isTie).toBe(true);
    expect(result.winnerId).toBeNull();
    expect(result.decisionOutcome).toBe('tie');
    expect(result.tiedWinnerIds).toEqual(['oA', 'oB', 'oC']);

    const oA = result.evaluations.find(e => e.optionId === 'oA')!;
    const oB = result.evaluations.find(e => e.optionId === 'oB')!;
    const oC = result.evaluations.find(e => e.optionId === 'oC')!;
    const oD = result.evaluations.find(e => e.optionId === 'oD')!;

    expect(oA.rank).toBe(1);
    expect(oB.rank).toBe(1);
    expect(oC.rank).toBe(1);
    expect(oD.rank).toBe(4); // 1224 ranking: 4th place skips to rank 4
  });

  it('implements Standard Competition Ranking for tie at rank 2', () => {
    const options: EngineOption[] = [
      { id: 'leader', name: 'Leader', scores: { c1: 95, c2: 95 } },
      { id: 'runner1', name: 'Runner 1', scores: { c1: 80, c2: 80 } },
      { id: 'runner2', name: 'Runner 2', scores: { c1: 80, c2: 80 } },
      { id: 'last', name: 'Last', scores: { c1: 50, c2: 50 } },
    ];

    const result = evaluateDecision({ criteria, options });

    expect(result.isTie).toBe(false);
    expect(result.winnerId).toBe('leader');
    expect(result.decisionOutcome).toBe('decisive');

    const leader = result.evaluations.find(e => e.optionId === 'leader')!;
    const runner1 = result.evaluations.find(e => e.optionId === 'runner1')!;
    const runner2 = result.evaluations.find(e => e.optionId === 'runner2')!;
    const last = result.evaluations.find(e => e.optionId === 'last')!;

    expect(leader.rank).toBe(1);
    expect(runner1.rank).toBe(2);
    expect(runner2.rank).toBe(2);
    expect(last.rank).toBe(4);
  });

  it('breaks presentation ordering via Tier 2 (Locked Criteria Performance)', () => {
    const critsWithLock: EngineCriterion[] = [
      { id: 'c1', name: 'Criterion 1', weight: 50, isLocked: true },
      { id: 'c2', name: 'Criterion 2', weight: 50, isLocked: false },
    ];
    // Both score 75 overall: (50*90 + 50*60)/100 = 75, (50*60 + 50*90)/100 = 75
    // optLockedHigh has higher score on locked c1 (90 vs 60)
    const options: EngineOption[] = [
      { id: 'optLockedLow', name: 'Option Low', scores: { c1: 60, c2: 90 } },
      { id: 'optLockedHigh', name: 'Option High', scores: { c1: 90, c2: 60 } },
    ];

    const result = evaluateDecision({ criteria: critsWithLock, options });

    const high = result.evaluations.find(e => e.optionId === 'optLockedHigh')!;
    const low = result.evaluations.find(e => e.optionId === 'optLockedLow')!;

    expect(high.presentationOrder).toBe(1);
    expect(low.presentationOrder).toBe(2);
    expect(high.rank).toBe(1);
    expect(low.rank).toBe(1);
  });
});
