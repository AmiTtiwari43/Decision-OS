import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DecisionHistoryTimeline } from '../components/DecisionHistoryTimeline.js';
import { EvidenceModal } from '../components/EvidenceModal.js';
import { AuditExportModal } from '../components/AuditExportModal.js';
import { ShowcaseSection } from '../components/ShowcaseSection.js';
import type { DecisionDto } from '../api/index.js';

// Mock audioFx sound
vi.mock('../utils/audioFx.js', () => ({
  sound: {
    playTick: vi.fn(),
    playCelebrate: vi.fn(),
    playScenarioChime: vi.fn(),
  },
}));

vi.mock('../utils/audioFx', () => ({
  sound: {
    playTick: vi.fn(),
    playCelebrate: vi.fn(),
    playScenarioChime: vi.fn(),
  },
}));

describe('Batch 03.3: Decision History, Evidence and Audit Showcase Frontend Suite', () => {
  const dummyDecision: DecisionDto = {
    _id: '507f1f77bcf86cd799439011',
    title: 'Cloud Infrastructure Modernization',
    description: 'Framework selection for enterprise services',
    ownerId: 'user-lead-1',
    analysis: null,
    calculationVersion: 1,
    criteria: [
      { id: 'crit-vel', name: 'Developer Velocity', direction: 'benefit', weight: 35, isLocked: false },
      { id: 'crit-sec', name: 'Security & Compliance', direction: 'benefit', weight: 35, isLocked: false },
      { id: 'crit-cost', name: 'Infra TCO', direction: 'cost', weight: 30, isLocked: false },
    ],
    options: [
      { id: 'opt-alpha', name: 'Option Alpha (React + Fastify)', description: 'Decoupled Vite + Fastify' },
      { id: 'opt-beta', name: 'Option Beta (Next.js Fullstack)', description: 'Monolithic SSR' },
    ],
    scores: {
      'opt-alpha': { 'crit-vel': 92, 'crit-sec': 88, 'crit-cost': 75 },
      'opt-beta': { 'crit-vel': 78, 'crit-sec': 85, 'crit-cost': 90 },
    },
    currentUserRole: 'owner',
    createdAt: '2026-10-31T09:00:00.000Z',
    updatedAt: '2026-10-31T11:30:00.000Z',
    isAudited: true,
    auditIntegrityStatus: 'healthy',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. DecisionHistoryTimeline Component', () => {
    it('renders the 11 sequential lifecycle audit milestones with sequences and attributions', () => {
      const html = renderToString(
        React.createElement(DecisionHistoryTimeline, {
          onOpenSandbox: vi.fn(),
          onOpenAudit: vi.fn(),
        })
      );

      // Header and description
      expect(html).toContain('How a decision evolves.');
      expect(html).toContain('Explainable Decision Provenance');
      expect(html).toContain('Inspect the complete immutable event chain');

      // Sequence numbers #001 through #011
      expect(html).toContain('#001');
      expect(html).toContain('#002');
      expect(html).toContain('#003');
      expect(html).toContain('#004');
      expect(html).toContain('#005');
      expect(html).toContain('#006');
      expect(html).toContain('#007');
      expect(html).toContain('#008');
      expect(html).toContain('#009');
      expect(html).toContain('#010');
      expect(html).toContain('#011');

      // Concrete Actions
      expect(html).toContain('decision.created');
      expect(html).toContain('criteria.added');
      expect(html).toContain('criteria.weight_updated');
      expect(html).toContain('option.added');
      expect(html).toContain('score.updated');
      expect(html).toContain('sharing.invited');
      expect(html).toContain('contribution.submitted');
      expect(html).toContain('contribution.adopted');
      expect(html).toContain('ai.analysis_generated');
      expect(html).toContain('decision.analyzed');
      expect(html).toContain('sharing.role_updated');

      // Actors
      expect(html).toContain('Elena Rostova');
      expect(html).toContain('Marcus Vance');
      expect(html).toContain('AI Advisory Analyst');
      expect(html).toContain('Deterministic MCDA Engine v1');

      // Action buttons
      expect(html).toContain('Model Your Own Decision Trajectory');
      expect(html).toContain('Open Cryptographic Audit Terminal');
    });

    it('renders view mode switches and category filters in the timeline', () => {
      const html = renderToString(
        React.createElement(DecisionHistoryTimeline, {
          onOpenSandbox: vi.fn(),
        })
      );

      expect(html).toContain('Full Audit Stream');
      expect(html).toContain('Milestone Evolution (4 Stages)');
      expect(html).toContain('Criteria');
      expect(html).toContain('Options');
      expect(html).toContain('Scores');
      expect(html).toContain('Experts');
      expect(html).toContain('AI Advisory');
      expect(html).toContain('Engine');
    });
  });

  describe('2. EvidenceModal Component', () => {
    it('renders empty when isOpen is false', () => {
      const html = renderToString(
        React.createElement(EvidenceModal, {
          isOpen: false,
          onClose: vi.fn(),
          decision: dummyDecision,
        })
      );

      expect(html).toBe('');
    });

    it('renders modal header, provenance invariant banner, and navigation tabs when open', () => {
      const html = renderToString(
        React.createElement(EvidenceModal, {
          isOpen: true,
          onClose: vi.fn(),
          decision: dummyDecision,
        })
      );

      expect(html).toContain('Evidence &amp; Provenance');
      expect(html).toContain('Traceability');
      expect(html).toContain('Provenance Invariant:');
      expect(html).toContain('Attached URLs, citations, and quotes provide attribution');
      expect(html).toContain('They do not alter authoritative MCDA mathematical rankings');
      expect(html).toContain('Browse Evidence');
      expect(html).toContain('Coverage &amp; Gaps');
      expect(html).toContain('Attach Supporting Material');
    });

    it('omits Attach Supporting Material button for users with viewer role', () => {
      const viewerDecision: DecisionDto = {
        ...dummyDecision,
        currentUserRole: 'viewer',
      };

      const html = renderToString(
        React.createElement(EvidenceModal, {
          isOpen: true,
          onClose: vi.fn(),
          decision: viewerDecision,
        })
      );

      expect(html).not.toContain('Attach Supporting Material');
    });
  });

  describe('3. AuditExportModal Component', () => {
    it('renders empty when isOpen is false', () => {
      const html = renderToString(
        React.createElement(AuditExportModal, {
          isOpen: false,
          onClose: vi.fn(),
          decision: dummyDecision,
        })
      );

      expect(html).toBe('');
    });

    it('renders modal header, SHA-256 chain card, and filter tabs when open', () => {
      const html = renderToString(
        React.createElement(AuditExportModal, {
          isOpen: true,
          onClose: vi.fn(),
          decision: dummyDecision,
        })
      );

      expect(html).toContain('Decision Audit, History &amp; Export');
      expect(html).toContain('Cloud Infrastructure Modernization');
      expect(html).toContain('Audit Timeline');
      expect(html).toContain('Snapshots &amp; Milestones');
      expect(html).toContain('Export Center');
      expect(html).toContain('SHA-256 Hash Chain Integrity');
      expect(html).toContain('Re-verify Now');

      // Action Filter Pills
      expect(html).toContain('All Events');
      expect(html).toContain('Criteria &amp; Weights');
      expect(html).toContain('Roles &amp; Invites');
      expect(html).toContain('AI Advisory');
    });
  });

  describe('4. ShowcaseSection Component (Tab 3: Cryptographic Audit Stream)', () => {
    it('renders the 6 chained nodes, tamper simulation, and Rule #15 provenance card', () => {
      const html = renderToString(
        React.createElement(ShowcaseSection, {
          defaultTab: 'audit',
        })
      );

      // Section title & description
      expect(html).toContain('SHA-256 Hash Chaining &amp; Tamper Evidence');
      expect(html).toContain('Cryptographic Integrity &amp; Defense-in-Depth');

      // 6 Chained Block Nodes
      expect(html).toContain('#001 (Genesis)');
      expect(html).toContain('decision.created');
      expect(html).toContain('#002');
      expect(html).toContain('criteria.weight_updated');
      expect(html).toContain('#003');
      expect(html).toContain('evidence.created');
      expect(html).toContain('#004');
      expect(html).toContain('contribution.adopted');
      expect(html).toContain('#005');
      expect(html).toContain('ai.analysis_generated');
      expect(html).toContain('#006 (Head)');
      expect(html).toContain('decision.analyzed');

      // Tamper Simulation Trigger
      expect(html).toContain('Simulate Out-of-Band Tamper');
      expect(html).toContain('Verify Chain Now');

      // Rule #15 Grounding Invariant
      expect(html).toContain('Evidence Provenance &amp; Missing Evidence Safeguards');
      expect(html).toContain('Rule #15 Grounding Invariant');
      expect(html).toContain('Self-Reported Citation Transparency');
      expect(html).toContain('Missing Evidence Gap Identification');

      // Export formats
      expect(html).toContain('Boardroom Defense Export Formats');
      expect(html).toContain('JSON Package');
      expect(html).toContain('CSV Matrix');
      expect(html).toContain('Printable HTML');
    });
  });
});
