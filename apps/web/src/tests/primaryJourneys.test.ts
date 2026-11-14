import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient } from '../api/client.js';
import type {
  DecisionDto,
  UserDto,
  AuthResponseDto,
  InvitationDto,
  CreateInvitationResponseDto,
  DecisionContributionDto,
  AiAnalystResponseDto,
  AuditHistoryResponseDto,
  ChainVerificationResultDto,
} from '../api/types.js';
import type { DecisionDataset, Criterion, Option } from '../types/decision.js';
import {
  computeCanonicalWeights,
  addAlternativeToDataset,
  addCriterionToDataset,
  updateOptionScoreInDataset,
} from '../hooks/useDecisionModel.js';
import { runDecisionEngine } from '../utils/decisionEngine.js';
import { getDecisionEvaluationStatus } from '../utils/decisionStatus.js';

describe('Decision OS — Batch 04.1: Primary User Journeys Verification', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;
  const storageMap = new Map<string, string>();

  const testUser: UserDto = {
    id: 'user-presenter-001',
    email: 'presenter@decision-os.org',
    name: 'Lead Presenter',
    role: 'user',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  };

  const expertUser: UserDto = {
    id: 'user-expert-002',
    email: 'expert@decision-os.org',
    name: 'Dr. Sarah Lin',
    role: 'user',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
  };

  const authResponse: AuthResponseDto = {
    user: testUser,
    token: 'jwt.token.presentation-session-001',
  };

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    storageMap.clear();

    const mockStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => storageMap.set(key, String(value)),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
      length: storageMap.size,
      key: () => null,
    };

    vi.stubGlobal('localStorage', mockStorage);
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'localStorage', {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
    } else {
      vi.stubGlobal('window', { localStorage: mockStorage });
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JOURNEY 1: NEW USER
  // 1. Open application.
  // 2. Register.
  // 3. Log in.
  // 4. View dashboard.
  // 5. Create a decision.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Journey 1: New User Onboarding & Decision Initialization', () => {
    it('1.1 registers new user account with validated credentials', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => authResponse,
      });
      globalThis.fetch = fetchMock;

      const res = await client.register({
        email: 'presenter@decision-os.org',
        password: 'PresentationPassword@2026',
        name: 'Lead Presenter',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:3000/api/auth/register');
      expect(options.method).toBe('POST');
      expect(res.user.email).toBe('presenter@decision-os.org');
      expect(res.token).toBe('jwt.token.presentation-session-001');
      expect(client.getToken()).toBe('jwt.token.presentation-session-001');
    });

    it('1.2 authenticates user via login and verifies in-memory session token', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => authResponse,
      });
      globalThis.fetch = fetchMock;

      const res = await client.login({
        email: 'presenter@decision-os.org',
        password: 'PresentationPassword@2026',
      });

      expect(res.user.id).toBe('user-presenter-001');
      expect(client.getToken()).toBe('jwt.token.presentation-session-001');
    });

    it('1.3 loads dashboard with empty state, portfolio metrics, and creates first decision', async () => {
      const createdDecision: DecisionDto = {
        _id: 'dec-presentation-101',
        title: 'Core Database Modernization: PostgreSQL vs Mongo vs Spanner',
        description: 'Evaluating high-throughput ACID database architecture for Decision OS',
        criteria: [
          { id: 'c1', name: 'Transactional ACID Consistency', weight: 50, direction: 'benefit' },
          { id: 'c2', name: 'Operational Simplicity & Dev Velocity', weight: 50, direction: 'benefit' },
        ],
        options: [
          { id: 'opt1', name: 'PostgreSQL + Prisma', color: '#38BDF8' },
          { id: 'opt2', name: 'MongoDB Replica Set', color: '#B8FF5A' },
        ],
        scores: {
          opt1: { c1: 95, c2: 70 },
          opt2: { c1: 80, c2: 90 },
        },
        analysis: null,
        calculationVersion: 0,
        ownerId: 'user-presenter-001',
        currentUserRole: 'owner',
        createdAt: '2026-11-14T01:00:00.000Z',
        updatedAt: '2026-11-14T01:00:00.000Z',
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ items: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => createdDecision,
        });
      globalThis.fetch = fetchMock;

      // View Dashboard (empty initial portfolio)
      const listRes = await client.listDecisions({ limit: 100 });
      expect(listRes.items).toHaveLength(0);

      // Create decision
      const created = await client.createDecision({
        title: 'Core Database Modernization: PostgreSQL vs Mongo vs Spanner',
        description: 'Evaluating high-throughput ACID database architecture for Decision OS',
        criteria: [
          { id: 'c1', name: 'Transactional ACID Consistency', weight: 50, direction: 'benefit' },
          { id: 'c2', name: 'Operational Simplicity & Dev Velocity', weight: 50, direction: 'benefit' },
        ],
        options: [
          { id: 'opt1', name: 'PostgreSQL + Prisma', color: '#38BDF8' },
          { id: 'opt2', name: 'MongoDB Replica Set', color: '#B8FF5A' },
        ],
        scores: {
          opt1: { c1: 95, c2: 70 },
          opt2: { c1: 80, c2: 90 },
        },
      });

      expect(created._id).toBe('dec-presentation-101');
      expect(created.title).toContain('Core Database Modernization');
      expect(created.currentUserRole).toBe('owner');
      expect(getDecisionEvaluationStatus(created)).toBe('draft');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JOURNEY 2: DECISION EVALUATION
  // 1. Define decision question.
  // 2. Add alternatives.
  // 3. Add criteria.
  // 4. Assign weights.
  // 5. Enter scores.
  // 6. View ranking.
  // 7. Review explainability.
  // 8. Explore sensitivity.
  // 9. Save decision.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Journey 2: Decision Evaluation & Multi-Criteria Analysis', () => {
    it('2.1 executes complete MCDA evaluation workflow from framing to sensitivity and save', async () => {
      // 1. Define question & initial dataset
      const baseCriteria: Criterion[] = [
        { id: 'crit-cost', name: 'Annual Compute & Storage TCO', shortName: 'TCO', description: 'Total spend', defaultWeight: 50, category: 'finance' },
        { id: 'crit-ai', name: 'AI & Managed ML Tooling', shortName: 'AI Stack', description: 'Model hosting & inference', defaultWeight: 50, category: 'growth' },
      ];

      const baseOptions: Option[] = [
        { id: 'opt-aws', name: 'Amazon Web Services', tagline: 'Broad enterprise ecosystem', description: '', color: '#F59E0B', accentBorder: '', scores: { 'crit-cost': 70, 'crit-ai': 80 }, strengths: [], vulnerabilities: [] },
        { id: 'opt-gcp', name: 'Google Cloud Platform', tagline: 'Superior AI & BigQuery stack', description: '', color: '#38BDF8', accentBorder: '', scores: { 'crit-cost': 85, 'crit-ai': 95 }, strengths: [], vulnerabilities: [] },
      ];

      let dataset: DecisionDataset = {
        id: 'eval-flow-001',
        title: 'Cloud Infrastructure Vendor Standardization',
        question: 'Which cloud provider minimizes TCO while maximizing AI engineering velocity?',
        context: 'Evaluating multi-year enterprise contracts for production workloads.',
        criteria: baseCriteria,
        options: baseOptions,
        scenarios: [],
      };

      // 2. Add an alternative (Azure)
      const { dataset: dsWithOpt, newOption } = addAlternativeToDataset(
        dataset,
        'Microsoft Azure',
        'Enterprise Office 365 synergy',
        'Strong corporate directory integration'
      );
      dataset = dsWithOpt;
      expect(dataset.options).toHaveLength(3);
      expect(newOption.name).toBe('Microsoft Azure');

      // 3. Add a criterion (Developer Experience & Latency)
      let weights: Record<string, number> = { 'crit-cost': 50, 'crit-ai': 50 };
      const { dataset: dsWithCrit, weights: newWeights } = addCriterionToDataset(
        dataset,
        weights,
        [],
        'Global Edge Latency & Network Reliability',
        'execution',
        25,
        'Edge Latency',
        'Global CDN performance'
      );
      dataset = dsWithCrit;
      weights = newWeights;
      expect(dataset.criteria).toHaveLength(3);

      // 4. Assign weights with canonical Hare-Niemeyer normalization (strictly summing to 100%)
      const canonicalWeights = computeCanonicalWeights(dataset.criteria, {
        'crit-cost': 30,
        'crit-ai': 50,
        [dataset.criteria[2].id]: 20,
      });
      const sumWeights = Object.values(canonicalWeights).reduce((a, b) => a + b, 0);
      expect(sumWeights).toBe(100);

      // 5. Enter scores for all alternatives on all criteria
      const edgeCritId = dataset.criteria[2].id;
      dataset = updateOptionScoreInDataset(dataset, 'opt-aws', edgeCritId, 88);
      dataset = updateOptionScoreInDataset(dataset, 'opt-gcp', edgeCritId, 92);
      dataset = updateOptionScoreInDataset(dataset, newOption.id, 'crit-cost', 75);
      dataset = updateOptionScoreInDataset(dataset, newOption.id, 'crit-ai', 78);
      dataset = updateOptionScoreInDataset(dataset, newOption.id, edgeCritId, 80);

      // Verify all cells filled
      const allFilled = dataset.options.every(o =>
        dataset.criteria.every(c => typeof o.scores[c.id] === 'number')
      );
      expect(allFilled).toBe(true);

      // 6. View ranking via canonical MCDA engine calculation
      const result = runDecisionEngine(
        dataset.options,
        dataset.criteria,
        canonicalWeights,
        []
      );

      expect(result.winner).not.toBeNull();
      expect(result.winner?.option.id).toBe('opt-gcp'); // Highest scores across AI and Edge
      expect(result.evaluations[0].rank).toBe(1);
      expect(result.evaluations[0].option.name).toBe('Google Cloud Platform');

      // 7. Review explainability (headline, drivers, dynamic rationale)
      expect(result.explainability.headline).toContain('Google Cloud Platform');
      expect(result.explainability.dynamicRationale).toBeTruthy();
      expect(result.explainability.pointLead).toBeGreaterThan(0);
      expect(result.explainability.primaryDrivers.length).toBeGreaterThan(0);

      // 8. Explore sensitivity tipping points
      expect(result.sensitivity.length).toBeGreaterThan(0);
      const tippingPoint = result.sensitivity.find(s => s.tippingPointWeight !== null);
      if (tippingPoint && tippingPoint.tippingPointWeight !== null) {
        expect(tippingPoint.wouldFlipToOptionName).toBeTruthy();
      }

      // 9. Save decision to server
      const updatedServerDecision: DecisionDto = {
        _id: 'dec-infra-cloud-001',
        title: dataset.title,
        description: dataset.context,
        criteria: dataset.criteria.map(c => ({
          id: c.id,
          name: c.name,
          weight: canonicalWeights[c.id],
          direction: 'benefit',
        })),
        options: dataset.options.map(o => ({
          id: o.id,
          name: o.name,
          color: o.color,
        })),
        scores: Object.fromEntries(dataset.options.map(o => [o.id, { ...o.scores }])),
        analysis: {
          engineVersion: '1.0.0',
          evaluatedAt: '2026-11-14T02:00:00.000Z',
          isTie: false,
          decisionOutcome: 'decisive',
          winnerId: result.winner!.option.id,
          tiedWinnerIds: [],
          pointLead: result.explainability.pointLead,
          evaluations: result.evaluations.map(e => ({
            optionId: e.option.id,
            optionName: e.option.name,
            weightedScore: e.weightedScore,
            unroundedScore: e.weightedScore,
            rank: e.rank ?? 1,
            presentationOrder: 1,
            scoreDifferenceToLeader: e.scoreDifferenceToLeader,
            contributions: [],
          })),
          normalizedWeights: { ...canonicalWeights },
          totalWeight: 100,
          sensitivity: [],
        },
        calculationVersion: 1,
        ownerId: 'user-presenter-001',
        currentUserRole: 'owner',
        createdAt: '2026-11-14T01:30:00.000Z',
        updatedAt: '2026-11-14T02:00:00.000Z',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => updatedServerDecision,
      });
      globalThis.fetch = fetchMock;

      const saved = await client.updateDecision('dec-infra-cloud-001', {
        title: dataset.title,
        description: dataset.context,
        criteria: updatedServerDecision.criteria,
        options: updatedServerDecision.options,
        scores: updatedServerDecision.scores,
      });

      expect(saved.title).toBe('Cloud Infrastructure Vendor Standardization');
      expect(saved.analysis?.winnerId).toBe('opt-gcp');
      expect(getDecisionEvaluationStatus(saved)).toBe('decisive');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JOURNEY 3: COLLABORATION
  // 1. Open decision.
  // 2. Invite an expert.
  // 3. Expert accepts invitation.
  // 4. Expert submits contribution.
  // 5. Owner reviews contribution.
  // 6. Owner accepts or rejects it.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Journey 3: Multi-Stakeholder Collaboration & Expert Deliberation', () => {
    it('3.1 completes end-to-end invitation, contribution submission, and owner adoption', async () => {
      const decisionId = 'dec-collab-301';

      // 1. Open decision (retrieve details)
      const mockDecision: DecisionDto = {
        _id: decisionId,
        title: 'Strategic Security Framework Adoption: Zero Trust vs Perimeter Defense',
        description: 'Multi-expert evaluation of modern network architectures',
        criteria: [
          { id: 'crit-sec', name: 'Cryptographic Security Posture', weight: 60, direction: 'benefit' },
          { id: 'crit-cost', name: 'Operational Overhead', weight: 40, direction: 'cost' },
        ],
        options: [
          { id: 'opt-zt', name: 'BeyondCorp Zero Trust', color: '#B8FF5A' },
          { id: 'opt-vpn', name: 'Legacy Enterprise VPN', color: '#38BDF8' },
        ],
        scores: {
          'opt-zt': { 'crit-sec': 95, 'crit-cost': 45 },
          'opt-vpn': { 'crit-sec': 60, 'crit-cost': 80 },
        },
        analysis: null,
        calculationVersion: 0,
        ownerId: testUser.id,
        currentUserRole: 'owner',
        createdAt: '2026-11-14T02:10:00.000Z',
        updatedAt: '2026-11-14T02:10:00.000Z',
      };

      // 2. Invite an expert
      const mockInvitation: InvitationDto = {
        id: 'inv-301-expert',
        decisionId,
        email: expertUser.email,
        role: 'contributor',
        status: 'pending',
        expiresAt: '2026-11-21T00:00:00.000Z',
        createdAt: '2026-11-14T02:12:00.000Z',
        updatedAt: '2026-11-14T02:12:00.000Z',
      };

      const mockCreateInviteResponse: CreateInvitationResponseDto = {
        invitation: mockInvitation,
        token: 'crypto-invite-token-sarah-lin-64chars-sha256-abcdef1234567890',
        invitationLink: 'http://localhost:5173/?inviteToken=crypto-invite-token-sarah-lin-64chars-sha256-abcdef1234567890',
      };

      // 3. Expert accepts invitation
      const acceptResponse = {
        message: 'Invitation accepted successfully.',
        decisionId,
        role: 'contributor' as const,
      };

      // 4. Expert submits contribution
      const submittedContribution: DecisionContributionDto = {
        id: 'contrib-sarah-01',
        decisionId,
        contributorId: {
          id: expertUser.id,
          name: expertUser.name,
          email: expertUser.email,
        },
        revision: 1,
        status: 'submitted',
        recommendation: {
          preferredOptionId: 'opt-zt',
          rationale: 'Zero Trust eliminates lateral network movement during compromised perimeter events.',
        },
        confidence: 0.95,
        criterionScores: {
          'crit-sec': 98,
          'crit-cost': 50,
        },
        criterionReasoning: {
          'crit-sec': 'Hardware security key enforcement provides phishing resistance.',
        },
        history: [],
        submittedAt: '2026-11-14T02:25:00.000Z',
        withdrawnAt: null,
        createdAt: '2026-11-14T02:20:00.000Z',
        updatedAt: '2026-11-14T02:25:00.000Z',
      };

      // 5 & 6. Owner adopts expert contribution
      const adoptedDecision: DecisionDto = {
        ...mockDecision,
        scores: {
          'opt-zt': { 'crit-sec': 98, 'crit-cost': 50 },
          'opt-vpn': { 'crit-sec': 60, 'crit-cost': 80 },
        },
        calculationVersion: 1,
      };

      const fetchMock = vi.fn()
        // Open decision
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mockDecision,
        })
        // Invite expert
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mockCreateInviteResponse,
        })
        // Accept invitation
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => acceptResponse,
        })
        // Submit contribution
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => submittedContribution,
        })
        // Owner reviews contributions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ items: [submittedContribution], total: 1 }),
        })
        // Owner adopts expert scores
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => adoptedDecision,
        });
      globalThis.fetch = fetchMock;

      // 1. Open
      const dec = await client.getDecision(decisionId);
      expect(dec._id).toBe(decisionId);

      // 2. Invite
      const inviteRes = await client.createInvitation(decisionId, {
        email: expertUser.email,
        role: 'contributor',
      });
      expect(inviteRes.invitation.status).toBe('pending');
      expect(inviteRes.token).toBe('crypto-invite-token-sarah-lin-64chars-sha256-abcdef1234567890');

      // 3. Accept
      const acceptRes = await client.acceptInvitation({ token: inviteRes.token });
      expect(acceptRes.decisionId).toBe(decisionId);
      expect(acceptRes.role).toBe('contributor');

      // 4. Submit
      const contribRes = await client.submitContribution(decisionId);
      expect(contribRes.status).toBe('submitted');
      expect(contribRes.recommendation.preferredOptionId).toBe('opt-zt');

      // 5. Review
      const reviewRes = await client.listContributions(decisionId);
      expect(reviewRes.items).toHaveLength(1);
      expect(reviewRes.items[0].recommendation.rationale).toContain('Zero Trust eliminates lateral network movement');

      // 6. Adopt
      const adoptedRes = await client.adoptExpertScores(decisionId, contribRes.id, {
        confirmation: true,
        expectedVersion: 1,
      });
      expect(adoptedRes.scores['opt-zt']['crit-sec']).toBe(98);
    });

    it('3.2 allows owner to reject contribution with transparent rationale', async () => {
      const decisionId = 'dec-collab-302';
      const rejectedContribution: DecisionContributionDto = {
        id: 'contrib-uncalibrated-01',
        decisionId,
        contributorId: { id: 'user-009', name: 'External Contractor', email: 'contractor@thirdparty.com' },
        revision: 1,
        status: 'rejected',
        recommendation: { preferredOptionId: 'opt-legacy', rationale: 'Familiar tooling' },
        confidence: 0.2,
        criterionScores: {},
        criterionReasoning: {},
        history: [],
        rejectionReason: 'Contribution lacks empirical benchmarking evidence and contradicts compliance requirements.',
        rejectedAt: '2026-11-14T02:30:00.000Z',
        submittedAt: '2026-11-14T02:25:00.000Z',
        withdrawnAt: null,
        createdAt: '2026-11-14T02:20:00.000Z',
        updatedAt: '2026-11-14T02:30:00.000Z',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => rejectedContribution,
      });
      globalThis.fetch = fetchMock;

      const res = await client.rejectContribution(decisionId, 'contrib-uncalibrated-01', {
        rejectionReason: 'Contribution lacks empirical benchmarking evidence and contradicts compliance requirements.',
      });

      expect(res.status).toBe('rejected');
      expect(res.rejectionReason).toContain('lacks empirical benchmarking evidence');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JOURNEY 4: AI ADVISORY
  // 1. Open AI advisory.
  // 2. Generate suggestions.
  // 3. Review ranking.
  // 4. Inspect reasoning.
  // 5. Review evidence and limitations.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Journey 4: Autonomous AI Advisory with Explainable MDAR v1 Ranking', () => {
    it('4.1 generates non-authoritative ranked advice, inspects reasoning and evidence grounding', async () => {
      const decisionId = 'dec-ai-401';
      const mockAiResponse: AiAnalystResponseDto = {
        decisionId,
        analysisType: 'all',
        generatedAt: '2026-11-14T02:40:00.000Z',
        provider: 'google',
        model: 'gemini-1.5-pro',
        isAiGenerated: true,
        disclaimer: 'Non-authoritative advisory suggestions generated by AI. Must be independently verified.',
        output: {
          rankedSuggestions: [
            {
              id: 'sugg-01',
              rank: 1,
              category: 'criterion',
              title: 'Incorporate Automated Recovery RTO as Key Resilience Criterion',
              explanation: 'Current model evaluates feature velocity but omits Mean Time to Recovery (MTTR), which directly governs SLA compliance penalties.',
              relevantCriteria: [{ id: 'crit-1', name: 'Velocity' }],
              supportingEvidence: [{ id: 'ev-01', title: 'NIST SP 800-34 Contingency Planning Guide' }],
              confidence: 0.91,
              uncertaintyLevel: 'low',
              rankingScore: 9.2,
              rankingMethodology: 'MDAR v1',
              scoreBreakdown: {
                criteriaRelevance: 0.95,
                evidenceGrounding: 0.90,
                sensitivityUrgency: 0.92,
                confidenceScore: 0.91,
                penalties: 0,
                formula: '0.40*CR + 0.25*EG + 0.20*SU + 0.15*CS - P',
              },
              criteriaInfluence: 'high',
              evidenceSupport: 'empirical',
              assumptionsMade: ['SLA requirements remain stable'],
              whatCouldChangeRecommendation: 'Significant price reduction on competing stack',
              missingInformation: ['Specific tier-1 disaster recovery target SLA'],
              potentialBiasOrLimitations: [
                'Subject to cloud region peering availability constraints.',
              ],
              whyThisRank: 'High criterion relevance and sensitivity tipping impact.',
            },
            {
              id: 'sugg-02',
              rank: 2,
              category: 'alternative',
              title: 'Stress-test Database Latency Sensitivity Boundary',
              explanation: 'A 6% weight shift in Query Latency flips the winning recommendation from Alternative A to Alternative B.',
              relevantCriteria: [{ id: 'crit-2', name: 'Latency' }],
              supportingEvidence: [],
              confidence: 0.81,
              uncertaintyLevel: 'medium',
              rankingScore: 8.4,
              rankingMethodology: 'MDAR v1',
              scoreBreakdown: {
                criteriaRelevance: 0.85,
                evidenceGrounding: 0.82,
                sensitivityUrgency: 0.88,
                confidenceScore: 0.81,
                penalties: 0,
                formula: '0.40*CR + 0.25*EG + 0.20*SU + 0.15*CS - P',
              },
              criteriaInfluence: 'medium',
              evidenceSupport: 'analytical',
              assumptionsMade: ['Consistent peak read/write ratios'],
              whatCouldChangeRecommendation: 'Hardware offload acceleration adoption',
              missingInformation: ['Tail p99 latency benchmarks at peak traffic'],
              potentialBiasOrLimitations: [
                'Synthetic load generator may not reflect real multi-tenant contention spikes.',
              ],
              whyThisRank: 'Crucial sensitivity boundary test before contract finalization.',
            },
          ],
          executiveSummary: 'The decision model exhibits strong structural integrity with high differentiation on engineering velocity.',
          tradeoffAnalysis: {
            winnerObservation: 'Option Alpha holds lead on velocity',
            keyTradeoffs: ['Higher developer velocity vs increased compute expenditure'],
            sensitivityNotes: ['Close sensitivity boundary on latency criterion'],
          },
          evidenceGaps: [
            {
              targetType: 'criterion',
              targetId: 'crit-cost',
              targetName: 'Cost',
              gapDescription: 'Missing empirical pricing models for egress traffic exceeding 50TB/month.',
              recommendation: 'Request verified enterprise quote from cloud billing specialist.',
            },
          ],
          assumptions: ['Cloud pricing remains fixed across 36-month horizon', 'Workload concurrency grows at 15% CAGR'],
          followUpQuestions: ['Are multi-region egress costs included in the operational budget?'],
          suggestedAlternatives: [],
          suggestedCriteria: [],
        },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockAiResponse,
      });
      globalThis.fetch = fetchMock;

      // 1 & 2. Open AI advisory & Generate suggestions
      const aiResult = await client.runAiAnalysis(decisionId, 'all');

      // 3. Review ranking
      expect(aiResult.output.rankedSuggestions).toHaveLength(2);
      expect(aiResult.output.rankedSuggestions![0].rankingScore).toBe(9.2);
      expect(aiResult.output.rankedSuggestions![0].rankingScore).toBeGreaterThan(
        aiResult.output.rankedSuggestions![1].rankingScore
      );

      // 4. Inspect reasoning
      const topSugg = aiResult.output.rankedSuggestions![0];
      expect(topSugg.scoreBreakdown.criteriaRelevance).toBe(0.95);
      expect(topSugg.scoreBreakdown.evidenceGrounding).toBe(0.90);
      expect(topSugg.explanation).toContain('Current model evaluates feature velocity');

      // 5. Review evidence grounding & limitations
      expect(topSugg.supportingEvidence).toHaveLength(1);
      expect(topSugg.supportingEvidence[0].title).toContain('NIST SP 800-34');
      expect(topSugg.potentialBiasOrLimitations).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JOURNEY 5: AUDIT
  // 1. Open decision history.
  // 2. Review events.
  // 3. Verify audit integrity.
  // 4. Export decision report.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Journey 5: Cryptographic Audit Trail, SHA-256 Verification & Export Packages', () => {
    it('5.1 verifies chronological audit timeline, SHA-256 hash chaining, and exports packages', async () => {
      const decisionId = 'dec-audit-501';

      // 1 & 2. Decision history events
      const mockHistory: AuditHistoryResponseDto = {
        items: [
          {
            eventId: 'evt-001',
            decisionId,
            action: 'decision.created',
            sequenceNumber: 1,
            schemaVersion: 1,
            actorId: testUser.id,
            actorName: testUser.name,
            actorEmail: testUser.email,
            entityType: 'decision',
            entityId: decisionId,
            timestamp: '2026-11-14T03:00:00.000Z',
            summary: 'Created "Core Engine Upgrade" decision model',
            diff: { title: 'Core Engine Upgrade', criteriaCount: 0, optionsCount: 0 },
            previousEventHash: '0'.repeat(64),
            eventHash: 'a1b2c3d4e5f60001000000000000000000000000000000000000000000000001',
          },
          {
            eventId: 'evt-002',
            decisionId,
            action: 'criteria.weight_updated',
            sequenceNumber: 2,
            schemaVersion: 1,
            actorId: testUser.id,
            actorName: testUser.name,
            actorEmail: testUser.email,
            entityType: 'decision',
            entityId: decisionId,
            timestamp: '2026-11-14T03:05:00.000Z',
            summary: 'Rebalanced criteria weights: Velocity 40%, Cost 30%, Reliability 30%',
            diff: { weights: { Velocity: 40, Cost: 30, Reliability: 30 } },
            previousEventHash: 'a1b2c3d4e5f60001000000000000000000000000000000000000000000000001',
            eventHash: 'b2c3d4e5f6000102000000000000000000000000000000000000000000000002',
          },
        ],
        total: 2,
        page: 1,
        limit: 25,
        hasMore: false,
      };

      // 3. SHA-256 Chain Verification
      const mockVerification: ChainVerificationResultDto = {
        isValid: true,
        decisionId,
        totalEventsChecked: 2,
        rootHash: '0'.repeat(64),
        headHash: 'b2c3d4e5f6000102000000000000000000000000000000000000000000000002',
        verifiedAt: '2026-11-14T03:10:00.000Z',
      };

      // 4. Export report package
      const jsonPackage = JSON.stringify({
        exportVersion: '1.0.0',
        decisionId,
        title: 'Core Engine Upgrade',
        authoritativeRankings: [
          { rank: 1, optionName: 'Option A', weightedScore: 88.5 },
        ],
        sha256Head: mockVerification.headHash,
      });

      const fetchMock = vi.fn()
        // History
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mockHistory,
        })
        // Integrity verification
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mockVerification,
        })
        // Export JSON
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json', 'content-disposition': 'attachment; filename="decision.json"' }),
          text: async () => jsonPackage,
        })
        // Export CSV
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="decision.csv"' }),
          text: async () => 'Rank,Option,Weighted Score\n1,Option A,88.5\n',
        });
      globalThis.fetch = fetchMock;

      // 1 & 2. Open History & Review events
      const history = await client.getDecisionAuditHistory(decisionId, { page: 1, limit: 25 });
      expect(history.items).toHaveLength(2);
      expect(history.items[0].sequenceNumber).toBe(1);
      expect(history.items[1].sequenceNumber).toBe(2);
      expect(history.items[1].previousEventHash).toBe(history.items[0].eventHash);

      // 3. Verify audit integrity
      const verifyRes = await client.verifyAuditChain(decisionId);
      expect(verifyRes.isValid).toBe(true);
      expect(verifyRes.totalEventsChecked).toBe(2);
      expect(verifyRes.headHash).toBe(history.items[1].eventHash);

      // 4. Export reports
      const exportedJson = await client.exportDecision(decisionId, 'json');
      expect(exportedJson.contentType).toContain('application/json');
      expect(exportedJson.content).toContain('Core Engine Upgrade');

      const exportedCsv = await client.exportDecision(decisionId, 'csv');
      expect(exportedCsv.contentType).toContain('text/csv');
      expect(exportedCsv.content).toContain('Rank,Option,Weighted Score');
    });
  });
});
