import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AiAnalystModal } from '../components/AiAnalystModal.js';
import type { DecisionDto } from '../api/index.js';

describe('Batch 03.2 — Frontend AI Advisory & Explainable Ranking Modal Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockDecision: DecisionDto = {
    _id: '507f1f77bcf86cd799439011',
    title: 'Cloud Infrastructure Migration',
    description: 'Evaluating enterprise compute providers',
    ownerId: 'user-lead-1',
    criteria: [
      { id: 'cost', name: 'Cost Efficiency', weight: 40, direction: 'benefit' },
      { id: 'perf', name: 'Compute Performance', weight: 60, direction: 'benefit' },
    ],
    options: [
      { id: 'aws', name: 'Amazon Web Services' },
      { id: 'gcp', name: 'Google Cloud Platform' },
    ],
    scores: {
      aws: { cost: 70, perf: 90 },
      gcp: { cost: 85, perf: 80 },
    },
    analysis: null,
    calculationVersion: 1,
    isAudited: true,
    currentUserRole: 'owner',
    version: 2,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
  };

  it('1. returns empty output when modal is closed (isOpen: false)', () => {
    const html = renderToString(
      React.createElement(AiAnalystModal, {
        isOpen: false,
        onClose: vi.fn(),
        decision: mockDecision,
      })
    );

    expect(html).toBe('');
  });

  it('2. renders header with non-authoritative advisory disclaimer badge when opened', () => {
    const html = renderToString(
      React.createElement(AiAnalystModal, {
        isOpen: true,
        onClose: vi.fn(),
        decision: mockDecision,
      })
    );

    expect(html).toContain('AI Decision Analyst');
    expect(html).toContain('Advisory • Non-Authoritative');
    expect(html).toContain('Cloud Infrastructure Migration');
    expect(html).toContain('MCDA mathematical scores are strictly computed by the canonical backend engine.');
  });

  it('3. contains all explainable advisory tabs in navigation bar', () => {
    const html = renderToString(
      React.createElement(AiAnalystModal, {
        isOpen: true,
        onClose: vi.fn(),
        decision: mockDecision,
      })
    );

    expect(html).toContain('Ranked Advice');
    expect(html).toContain('Trade-offs &amp; Risks');
    expect(html).toContain('Evidence Gaps');
    expect(html).toContain('Alternatives');
    expect(html).toContain('Criteria Proposals');
    expect(html).toContain('Expert Perspectives');
    expect(html).toContain('Executive Briefing');
    expect(html).toContain('Assumptions &amp; Questions');
  });

  it('4. displays loading state indicating multi-factor calculation and MCDA extraction', () => {
    const html = renderToString(
      React.createElement(AiAnalystModal, {
        isOpen: true,
        onClose: vi.fn(),
        decision: mockDecision,
      })
    );

    expect(html).toContain('Synthesizing Evidence-Aware Advisory Analysis...');
    expect(html).toContain('Extracting MCDA calculations');
  });

  it('5. enforces human authority boundaries: non-authoritative notice is always rendered in footer', () => {
    const viewerDecision: DecisionDto = {
      ...mockDecision,
      currentUserRole: 'viewer',
    };

    const html = renderToString(
      React.createElement(AiAnalystModal, {
        isOpen: true,
        onClose: vi.fn(),
        decision: viewerDecision,
      })
    );

    expect(html).toContain('MCDA mathematical scores are strictly computed by the canonical backend engine.');
    expect(html).toContain('standard');
    expect(html).toContain('server-configured');
  });

  it('6. verifies transparent methodology is described in the modal header and footer', () => {
    const html = renderToString(
      React.createElement(AiAnalystModal, {
        isOpen: true,
        onClose: vi.fn(),
        decision: mockDecision,
      })
    );

    // Verifies that neither scores nor rankings pretend to be objective probabilities
    expect(html).not.toContain('objective probability');
    expect(html).toContain('Advisory • Non-Authoritative');
  });

  it('7. retains and caches analysis without re-fetching on already seen views', async () => {
    const { getCachedAiAnalysis, setCachedAiAnalysis, clearCachedAiAnalysis } = await import('../components/AiAnalystModal.js');
    clearCachedAiAnalysis(mockDecision._id);
    expect(getCachedAiAnalysis(mockDecision._id, 'all')).toBeNull();

    const mockResult = {
      decisionId: mockDecision._id,
      analysisType: 'all' as const,
      generatedAt: new Date().toISOString(),
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      isAiGenerated: true as const,
      disclaimer: 'Advisory notice',
      output: {
        executiveSummary: 'Retained executive summary briefing',
        rankedSuggestions: [],
        evidenceGaps: [],
        assumptions: [],
        followUpQuestions: [],
        suggestedCriteria: [],
        suggestedAlternatives: [],
        expertRecommendations: [],
      },
    };

    setCachedAiAnalysis(mockDecision._id, 'all', mockResult);
    expect(getCachedAiAnalysis(mockDecision._id, 'all')).toEqual(mockResult);
    // Sub-capabilities can also leverage the 'all' cache
    expect(getCachedAiAnalysis(mockDecision._id, 'ranked_suggestions')).toEqual(mockResult);

    // Render with cached analysis present: should render cached output immediately rather than loading state
    const html = renderToString(
      React.createElement(AiAnalystModal, {
        isOpen: true,
        onClose: vi.fn(),
        decision: mockDecision,
      })
    );
    expect(html).toContain('Retained executive summary briefing');
    expect(html).not.toContain('Synthesizing Evidence-Aware Advisory Analysis...');

    clearCachedAiAnalysis(mockDecision._id);
    expect(getCachedAiAnalysis(mockDecision._id, 'all')).toBeNull();
  });
});
