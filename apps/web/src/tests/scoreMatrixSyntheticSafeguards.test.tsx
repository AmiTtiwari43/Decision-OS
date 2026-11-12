import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ScoreMatrix } from '../components/ScoreMatrix.js';
import type { Criterion, Option } from '../types/decision.js';
import type { MissingScoreCoordinate } from '../hooks/useDecisionModel.js';

// Recursive helper to find elements by data-testid in React element trees
function findByTestId(node: any, testId: string): any {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findByTestId(item, testId);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  if (node.props?.['data-testid'] === testId) return node;
  return findByTestId(node.props?.children, testId);
}

function findAllByTestId(node: any, testId: string, acc: any[] = []): any[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const item of node) {
      findAllByTestId(item, testId, acc);
    }
    return acc;
  }
  if (typeof node !== 'object') return acc;
  if (node.props?.['data-testid'] === testId) acc.push(node);
  findAllByTestId(node.props?.children, testId, acc);
  return acc;
}

// Deterministic test hook dispatcher for interactive React component testing
function createComponentRunner<T>(componentFn: () => T) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const originalDispatcher = internals.H;

  const hookStates: any[] = [];
  let hookIndex = 0;
  let currentResult: T;

  function render() {
    hookIndex = 0;
    internals.H = dispatcher;
    try {
      currentResult = componentFn();
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
    useCallback(fn: any) {
      return fn;
    },
    useEffect() {},
    useMemo(fn: any) {
      return fn();
    },
  };

  render();

  return {
    get result() {
      return currentResult;
    },
    render,
  };
}

describe('ScoreMatrix Synthetic Demo Safeguards (Finding 2)', () => {
  const sampleCriteria: Criterion[] = [
    {
      id: 'crit-tech',
      name: 'Technical Architecture',
      shortName: 'Tech',
      description: 'API maturity and developer experience',
      category: 'growth',
      defaultWeight: 60,
    },
    {
      id: 'crit-cost',
      name: 'Cost Efficiency',
      shortName: 'Cost',
      description: 'Compute and egress spend',
      category: 'finance',
      defaultWeight: 40,
    },
  ];

  const sampleOptions: Option[] = [
    {
      id: 'opt-alpha',
      name: 'Option Alpha',
      badge: 'Tier 1',
      tagline: 'Leading Architecture',
      description: 'High capability tier',
      color: '#38BDF8',
      accentBorder: 'border-sky-500',
      scores: { 'crit-tech': 90, 'crit-cost': null as any }, // 1 missing score
      strengths: [],
      vulnerabilities: [],
    },
    {
      id: 'opt-beta',
      name: 'Option Beta',
      badge: 'Budget',
      tagline: 'Low Cost',
      description: 'Budget tier',
      color: '#B8FF5A',
      accentBorder: 'border-signal',
      scores: { 'crit-tech': 70, 'crit-cost': 90 }, // complete
      strengths: [],
      vulnerabilities: [],
    },
  ];

  const missingScores: MissingScoreCoordinate[] = [
    {
      optionId: 'opt-alpha',
      criterionId: 'crit-cost',
      optionName: 'Option Alpha',
      criterionName: 'Cost Efficiency',
    },
  ];
  const weights = { 'crit-tech': 60, 'crit-cost': 40 };

  // ─── 1. Static Initial Render & Confirmation Wording ─────────────────────────
  it('renders "Fill Missing (Demo 75)" button with explanatory title when missing scores exist', () => {
    const onUpdateScore = vi.fn();
    const html = renderToString(
      React.createElement(ScoreMatrix, {
        criteria: sampleCriteria,
        options: sampleOptions,
        weights,
        onUpdateScore,
        missingScores,
        disabled: false,
      })
    );

    expect(html).toContain('Fill Missing (Demo 75)');
    expect(html).toContain('Populate empty score cells with default baseline (75.0) after explicit confirmation');
    expect(html).toMatch(/Incomplete:.*1.*missing score/);
  });

  // ─── 2. Explicit Confirmation Step Before Insertion ──────────────────────────
  it('requires explicit confirmation before inserting synthetic baseline values', () => {
    const onUpdateScore = vi.fn();

    const runner = createComponentRunner(() =>
      ScoreMatrix({
        criteria: sampleCriteria,
        options: sampleOptions,
        weights,
        onUpdateScore,
        missingScores,
        disabled: false,
      })
    );

    // Initial tree should not display confirmation modal
    let tree = runner.result;
    expect(findByTestId(tree, 'synthetic-confirm-dialog')).toBeNull();

    // Find and click the Fill Missing (Demo 75) button
    const fillMissingBtn = findByTestId(tree, 'fill-missing-btn');
    expect(fillMissingBtn).not.toBeNull();
    fillMissingBtn.props.onClick();

    // Now confirmation modal should be visible
    tree = runner.result;
    const confirmDialog = findByTestId(tree, 'synthetic-confirm-dialog');
    expect(confirmDialog).not.toBeNull();

    // Check safeguard warning text inside confirmation modal
    const dialogHtml = renderToString(confirmDialog);
    expect(dialogHtml).toContain('75.0 is a synthetic demonstration value for illustration only');
    expect(dialogHtml).toContain('Synthetic values must never be treated as real decision evidence');

    // Test Cancel button dismisses modal without calling onUpdateScore
    const cancelBtn = findByTestId(confirmDialog, 'cancel-synthetic-fill');
    expect(cancelBtn).not.toBeNull();
    cancelBtn.props.onClick();

    expect(onUpdateScore).not.toHaveBeenCalled();
    tree = runner.result;
    expect(findByTestId(tree, 'synthetic-confirm-dialog')).toBeNull();
  });

  // ─── 3. Confirmation Triggers Synthetic Labeling & Badges ───────────────────
  it('marks populated cells with DEMO badge, synthetic indicator, and non-authoritative banner', () => {
    let currentOptions = JSON.parse(JSON.stringify(sampleOptions));
    let currentMissingScores: MissingScoreCoordinate[] = [
      {
        optionId: 'opt-alpha',
        criterionId: 'crit-cost',
        optionName: 'Option Alpha',
        criterionName: 'Cost Efficiency',
      },
    ];
    const onUpdateScore = vi.fn((optId: string, critId: string, score: any) => {
      const opt = currentOptions.find((o: any) => o.id === optId);
      if (opt) opt.scores[critId] = score;
      if (score !== null && score !== undefined) {
        currentMissingScores = currentMissingScores.filter(
          (m) => !(m.optionId === optId && m.criterionId === critId)
        );
      } else {
        currentMissingScores.push({
          optionId: optId,
          criterionId: critId,
          optionName: 'Option Alpha',
          criterionName: 'Cost Efficiency',
        });
      }
    });

    const runner = createComponentRunner(() =>
      ScoreMatrix({
        criteria: sampleCriteria,
        options: currentOptions,
        weights,
        onUpdateScore,
        missingScores: currentMissingScores,
        disabled: false,
      })
    );

    // Click Fill Missing button
    let tree = runner.result;
    const fillMissingBtn = findByTestId(tree, 'fill-missing-btn');
    fillMissingBtn.props.onClick();

    // Click Confirm button inside dialog
    tree = runner.result;
    const confirmBtn = findByTestId(tree, 'confirm-synthetic-fill');
    expect(confirmBtn).not.toBeNull();
    confirmBtn.props.onClick();

    // Verify onUpdateScore was called with 75 and explicit synthetic provenance for missing coordinate
    expect(onUpdateScore).toHaveBeenCalledWith('opt-alpha', 'crit-cost', 75, {
      isSynthetic: true,
      source: 'demo',
    });

    // Re-render runner with updated score
    runner.render();
    tree = runner.result;

    // Verify Synthetic Indicator in Header
    const syntheticIndicator = findByTestId(tree, 'synthetic-indicator');
    expect(syntheticIndicator).not.toBeNull();
    expect(renderToString(syntheticIndicator)).toMatch(/1.*Synthetic Value.*\(Demo Only\)/);

    // Verify Completion badge states "Non-Authoritative"
    const completeBadge = findByTestId(tree, 'synthetic-complete-badge');
    expect(completeBadge).not.toBeNull();
    expect(renderToString(completeBadge)).toContain('Non-Authoritative');

    // Verify Synthetic Banner rendered at bottom
    const syntheticBanner = findByTestId(tree, 'synthetic-banner');
    expect(syntheticBanner).not.toBeNull();
    expect(renderToString(syntheticBanner)).toContain('Synthetic Demo Notice');
    expect(renderToString(syntheticBanner)).toContain('Not an authoritative assessment or verified evidence');

    // Verify Table Cell for (opt-alpha, crit-cost) displays DEMO badge
    const demoBadges = findAllByTestId(tree, 'synthetic-cell-badge');
    expect(demoBadges).toHaveLength(1);
    expect(renderToString(demoBadges[0])).toContain('DEMO');
  });

  // ─── 4. Straightforward Individual Value Replacement ─────────────────────────
  it('editing a synthetic cell immediately removes its synthetic status and DEMO badge', () => {
    let currentOptions = JSON.parse(JSON.stringify(sampleOptions));
    let currentMissingScores: MissingScoreCoordinate[] = [
      {
        optionId: 'opt-alpha',
        criterionId: 'crit-cost',
        optionName: 'Option Alpha',
        criterionName: 'Cost Efficiency',
      },
    ];
    const onUpdateScore = vi.fn((optId: string, critId: string, score: any) => {
      const opt = currentOptions.find((o: any) => o.id === optId);
      if (opt) opt.scores[critId] = score;
      if (score !== null && score !== undefined) {
        currentMissingScores = currentMissingScores.filter(
          (m) => !(m.optionId === optId && m.criterionId === critId)
        );
      } else {
        currentMissingScores.push({
          optionId: optId,
          criterionId: critId,
          optionName: 'Option Alpha',
          criterionName: 'Cost Efficiency',
        });
      }
    });

    const runner = createComponentRunner(() =>
      ScoreMatrix({
        criteria: sampleCriteria,
        options: currentOptions,
        weights,
        onUpdateScore,
        missingScores: currentMissingScores,
        disabled: false,
      })
    );

    // Confirm synthetic fill
    let tree = runner.result;
    findByTestId(tree, 'fill-missing-btn').props.onClick();

    tree = runner.result;
    findByTestId(tree, 'confirm-synthetic-fill').props.onClick();

    runner.render();
    tree = runner.result;

    // Verify cell is initially marked synthetic with DEMO badge
    expect(findAllByTestId(tree, 'synthetic-cell-badge')).toHaveLength(1);

    // Locate the input for Option Alpha on Cost Efficiency
    const tbody = (tree as any).props.children[1].props.children.props.children[1];
    const costRow = tbody.props.children[1];
    const cellInput = costRow.props.children[1][0].props.children.props.children[0];

    // Simulate user editing the score to a real assessment (e.g. 85.0)
    cellInput.props.onChange({ target: { value: '85' } });
    expect(onUpdateScore).toHaveBeenCalledWith('opt-alpha', 'crit-cost', 85);

    // Re-render after manual edit
    runner.render();
    tree = runner.result;

    // Verify cell no longer has DEMO badge
    expect(findAllByTestId(tree, 'synthetic-cell-badge')).toHaveLength(0);

    // Verify header synthetic indicator is gone
    expect(findByTestId(tree, 'synthetic-indicator')).toBeNull();

    // Verify complete badge now indicates authoritative 100% complete
    expect(findByTestId(tree, 'synthetic-complete-badge')).toBeNull();
    const treeHtml = renderToString(tree as React.ReactElement);
    expect(treeHtml).toMatch(/Complete:.*4.*\/.*4.*scores.*\(100%\)/);
  });

  // ─── 5. Clear All Synthetic Values Button ─────────────────────────────────────
  it('"Clear Synthetic Values" button reverts synthetic cells back to unpopulated null', () => {
    let currentOptions = JSON.parse(JSON.stringify(sampleOptions));
    let currentMissingScores: MissingScoreCoordinate[] = [
      {
        optionId: 'opt-alpha',
        criterionId: 'crit-cost',
        optionName: 'Option Alpha',
        criterionName: 'Cost Efficiency',
      },
    ];
    const onUpdateScore = vi.fn((optId: string, critId: string, score: any) => {
      const opt = currentOptions.find((o: any) => o.id === optId);
      if (opt) opt.scores[critId] = score;
      if (score !== null && score !== undefined) {
        currentMissingScores = currentMissingScores.filter(
          (m) => !(m.optionId === optId && m.criterionId === critId)
        );
      } else {
        currentMissingScores.push({
          optionId: optId,
          criterionId: critId,
          optionName: 'Option Alpha',
          criterionName: 'Cost Efficiency',
        });
      }
    });

    const runner = createComponentRunner(() =>
      ScoreMatrix({
        criteria: sampleCriteria,
        options: currentOptions,
        weights,
        onUpdateScore,
        missingScores: currentMissingScores,
        disabled: false,
      })
    );

    // Fill synthetic
    let tree = runner.result;
    findByTestId(tree, 'fill-missing-btn').props.onClick();
    tree = runner.result;
    findByTestId(tree, 'confirm-synthetic-fill').props.onClick();

    runner.render();
    tree = runner.result;

    // Locate Clear Synthetic button on banner
    const clearBtn = findByTestId(tree, 'clear-synthetic-btn');
    expect(clearBtn).not.toBeNull();

    // Click clear button
    clearBtn.props.onClick();

    // Verify onUpdateScore was called with null to restore missing score state
    expect(onUpdateScore).toHaveBeenCalledWith('opt-alpha', 'crit-cost', null);

    runner.render();
    tree = runner.result;

    // Synthetic banner should be dismissed
    expect(findByTestId(tree, 'synthetic-banner')).toBeNull();
  });

  // ─── 6. Persisted Synthetic Provenance Across Reopen / Refresh (Finding A) ──
  it('displays DEMO badges and non-authoritative banner immediately when reloaded with scoreProvenance prop', () => {
    const populatedOptions = JSON.parse(JSON.stringify(sampleOptions));
    populatedOptions[0].scores['crit-cost'] = 75; // populated with synthetic score

    const scoreProvenance = {
      'opt-alpha': {
        'crit-cost': { isSynthetic: true, source: 'demo' },
      },
    };

    const onUpdateScore = vi.fn();

    const html = renderToString(
      React.createElement(ScoreMatrix, {
        criteria: sampleCriteria,
        options: populatedOptions,
        weights,
        scoreProvenance,
        onUpdateScore,
        missingScores: [],
        disabled: false,
      })
    );

    // Verify DEMO badge rendered for the synthetic cell
    expect(html).toContain('DEMO');
    // Verify Synthetic Indicator in Header
    expect(html).toMatch(/1.*Synthetic Value.*\(Demo Only\)/);
    // Verify non-authoritative completion badge
    expect(html).toContain('Complete with Synthetic Placeholders');
    expect(html).toContain('Non-Authoritative');
    // Verify Synthetic Demo Notice banner at bottom
    expect(html).toContain('Synthetic Demo Notice:');
    expect(html).toContain('Not an authoritative assessment or verified evidence');
  });

  // ─── 7. Persisted Provenance Clear on Edit ────────────────────────────────────
  it('editing a persisted synthetic coordinate clears DEMO badge and calls onUpdateScore', () => {
    let populatedOptions = JSON.parse(JSON.stringify(sampleOptions));
    populatedOptions[0].scores['crit-cost'] = 75;

    let scoreProvenance: any = {
      'opt-alpha': {
        'crit-cost': { isSynthetic: true, source: 'demo' },
      },
    };

    const onUpdateScore = vi.fn((optId: string, critId: string, score: any) => {
      const opt = populatedOptions.find((o: any) => o.id === optId);
      if (opt) opt.scores[critId] = score;
      if (scoreProvenance[optId]?.[critId]) {
        delete scoreProvenance[optId][critId];
      }
    });

    const runner = createComponentRunner(() =>
      ScoreMatrix({
        criteria: sampleCriteria,
        options: populatedOptions,
        weights,
        scoreProvenance,
        onUpdateScore,
        missingScores: [],
        disabled: false,
      })
    );

    let tree = runner.result;
    expect(findAllByTestId(tree, 'synthetic-cell-badge')).toHaveLength(1);

    // Locate the input for Option Alpha on Cost Efficiency
    const tbody = (tree as any).props.children[1].props.children.props.children[1];
    const costRow = tbody.props.children[1];
    const cellInput = costRow.props.children[1][0].props.children.props.children[0];

    // User replaces synthetic score with 70.0
    cellInput.props.onChange({ target: { value: '70' } });
    expect(onUpdateScore).toHaveBeenCalledWith('opt-alpha', 'crit-cost', 70);

    runner.render();
    tree = runner.result;

    expect(findAllByTestId(tree, 'synthetic-cell-badge')).toHaveLength(0);
    expect(findByTestId(tree, 'synthetic-indicator')).toBeNull();
  });

  // ─── 8. Batch 02-R4: Dedicated Server Endpoint Integration ──────────────────
  it('calls onPopulateSyntheticDemo with defaultValue 75 upon explicit confirmation', async () => {
    const onPopulateSyntheticDemo = vi.fn().mockResolvedValue(undefined);
    const onUpdateScore = vi.fn();
    const currentMissingScores: MissingScoreCoordinate[] = [
      {
        optionId: 'opt-alpha',
        criterionId: 'crit-cost',
        optionName: 'Option Alpha',
        criterionName: 'Cost Efficiency',
      },
    ];

    const runner = createComponentRunner(() =>
      ScoreMatrix({
        criteria: sampleCriteria,
        options: sampleOptions,
        weights,
        onUpdateScore,
        onPopulateSyntheticDemo,
        missingScores: currentMissingScores,
        disabled: false,
      })
    );

    // Open confirmation modal
    let tree = runner.result;
    const fillMissingBtn = findByTestId(tree, 'fill-missing-btn');
    fillMissingBtn.props.onClick();

    tree = runner.result;
    const confirmBtn = findByTestId(tree, 'confirm-synthetic-fill');
    expect(confirmBtn).not.toBeNull();

    // Click confirm
    await confirmBtn.props.onClick();

    // Dedicated server-endpoint handler was invoked
    expect(onPopulateSyntheticDemo).toHaveBeenCalledWith(75);
    // Modal is closed on success
    tree = runner.result;
    expect(findByTestId(tree, 'synthetic-confirm-dialog')).toBeNull();
  });

  it('displays error and keeps modal open when onPopulateSyntheticDemo fails', async () => {
    const onPopulateSyntheticDemo = vi.fn().mockRejectedValue(new Error('Server failed to populate demo scores'));
    const onUpdateScore = vi.fn();
    const currentMissingScores: MissingScoreCoordinate[] = [
      {
        optionId: 'opt-alpha',
        criterionId: 'crit-cost',
        optionName: 'Option Alpha',
        criterionName: 'Cost Efficiency',
      },
    ];

    const runner = createComponentRunner(() =>
      ScoreMatrix({
        criteria: sampleCriteria,
        options: sampleOptions,
        weights,
        onUpdateScore,
        onPopulateSyntheticDemo,
        missingScores: currentMissingScores,
        disabled: false,
      })
    );

    // Open confirmation modal
    let tree = runner.result;
    const fillMissingBtn = findByTestId(tree, 'fill-missing-btn');
    fillMissingBtn.props.onClick();

    tree = runner.result;
    const confirmBtn = findByTestId(tree, 'confirm-synthetic-fill');

    // Click confirm, which will reject
    await confirmBtn.props.onClick();

    // Modal must NOT be closed
    tree = runner.result;
    expect(findByTestId(tree, 'synthetic-confirm-dialog')).not.toBeNull();

    // Error alert must be visible inside modal
    const errorEl = findByTestId(tree, 'synthetic-populate-error');
    expect(errorEl).not.toBeNull();
    expect(renderToString(errorEl)).toContain('Server failed to populate demo scores');
  });
});
