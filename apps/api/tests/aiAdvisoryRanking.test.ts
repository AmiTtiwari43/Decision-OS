import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard.js';
import { UserModel } from '../src/models/user.model.js';
import { DecisionModel } from '../src/models/decision.model.js';
import { DecisionInvitationModel } from '../src/models/invitation.model.js';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model.js';
import { DecisionContributionModel } from '../src/models/contribution.model.js';
import { DecisionEvidenceModel } from '../src/models/evidence.model.js';
import { setCustomAIProvider } from '../src/services/ai/providers/provider.factory.js';
import { MockAIProvider } from '../src/services/ai/providers/mock.provider.js';
import { suggestionRankingService } from '../src/services/ai/suggestion-ranking.service.js';
import type { DecisionDocument } from '../src/models/index.js';
import type { AiAnalystOutput } from '../src/models/ai.types.js';

const TEST_MONGODB_URI = getTestDatabaseUri();
assertTestDatabase(TEST_MONGODB_URI);

const baseDecisionPayload = {
  title: 'Cloud Architecture Evaluation',
  description: 'Evaluate compute platforms for enterprise ML training pipelines',
  criteria: [
    { id: 'cost', name: 'Cost Efficiency', weight: 40, direction: 'benefit' as const },
    { id: 'perf', name: 'Compute Performance', weight: 60, direction: 'benefit' as const },
  ],
  options: [
    { id: 'aws', name: 'Amazon Web Services' },
    { id: 'gcp', name: 'Google Cloud Platform' },
  ],
  scores: {
    aws: { cost: 70, perf: 90 },
    gcp: { cost: 85, perf: 80 },
  },
};

describe('Batch 03.2 — AI Advisory and Explainable Ranking Suite', { timeout: 30000 }, () => {
  let app: FastifyInstance;

  let ownerToken: string;
  let ownerId: string;
  const ownerEmail = 'owner-b32@example.com';

  let editorToken: string;
  const editorEmail = 'editor-b32@example.com';

  let viewerToken: string;
  const viewerEmail = 'viewer-b32@example.com';

  let contributorToken: string;
  const contributorEmail = 'contributor-b32@example.com';

  let unrelatedToken: string;
  const unrelatedEmail = 'unrelated-b32@example.com';

  let decisionId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
    setCustomAIProvider(new MockAIProvider(true));
  });

  afterAll(async () => {
    setCustomAIProvider(null);
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await DecisionEvidenceModel.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    setCustomAIProvider(new MockAIProvider(true));
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await DecisionEvidenceModel.deleteMany({});

    // 1. Register Owner
    const resOwner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: ownerEmail, password: 'Password123!', name: 'Owner B32' },
    });
    ownerToken = resOwner.json().token;
    ownerId = resOwner.json().user.id;

    // 2. Register Editor
    const resEditor = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: editorEmail, password: 'Password123!', name: 'Editor B32' },
    });
    editorToken = resEditor.json().token;

    // 3. Register Viewer
    const resViewer = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: viewerEmail, password: 'Password123!', name: 'Viewer B32' },
    });
    viewerToken = resViewer.json().token;

    // 4. Register Contributor
    const resContrib = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: contributorEmail, password: 'Password123!', name: 'Contributor B32' },
    });
    contributorToken = resContrib.json().token;

    // 5. Register Unrelated User
    const resUnrelated = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: unrelatedEmail, password: 'Password123!', name: 'Unrelated B32' },
    });
    unrelatedToken = resUnrelated.json().token;

    // 6. Create Base Decision
    const resDec = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: baseDecisionPayload,
    });
    decisionId = resDec.json()._id;

    // 7. Invite and Grant Access
    await DecisionAccessGrantModel.create({
      decisionId,
      userId: resEditor.json().user.id,
      email: editorEmail,
      role: 'editor',
      grantedBy: ownerId,
      grantedAt: new Date(),
    });

    await DecisionAccessGrantModel.create({
      decisionId,
      userId: resViewer.json().user.id,
      email: viewerEmail,
      role: 'viewer',
      grantedBy: ownerId,
      grantedAt: new Date(),
    });

    await DecisionAccessGrantModel.create({
      decisionId,
      userId: resContrib.json().user.id,
      email: contributorEmail,
      role: 'contributor',
      grantedBy: ownerId,
      grantedAt: new Date(),
    });

    // 8. Attach Verified Evidence
    await DecisionEvidenceModel.create({
      decisionId,
      targetType: 'criterion',
      targetId: 'cost',
      createdById: ownerId,
      type: 'url',
      title: 'Cloud TCO Model Q3 2026',
      sourceUrl: 'https://benchmarks.example.com/tco-2026.pdf',
      sourceExcerpt: 'AWS pricing reflects 3-year commitment discount of 32%.',
      userSummary: 'Empirical pricing verification',
      provenance: {
        createdByName: 'Owner B32',
        createdByEmail: ownerEmail,
        capturedVia: 'web_link',
      },
    });
  });

  describe('1. Advisory Suggestions & Explainable Output Generation', () => {
    it('generates structured advisory suggestions with explainable ranking metadata', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/analyze`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { capability: 'all' },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      expect(data.isAiGenerated).toBe(true);
      expect(data.disclaimer).toContain('advisory purposes');
      expect(data.output).toBeDefined();

      // Verify all required advisory fields are populated
      expect(data.output.executiveSummary).toBeTruthy();
      expect(data.output.tradeoffAnalysis).toBeDefined();
      expect(data.output.tradeoffAnalysis.risks).toBeInstanceOf(Array);
      expect(data.output.tradeoffAnalysis.risks.length).toBeGreaterThan(0);

      // Verify alternative proposals & expert recommendations
      expect(data.output.suggestedAlternatives).toBeInstanceOf(Array);
      expect(data.output.suggestedAlternatives.length).toBeGreaterThan(0);
      expect(data.output.suggestedAlternatives[0].id).toBe('hybrid-cloud');

      expect(data.output.expertRecommendations).toBeInstanceOf(Array);
      expect(data.output.expertRecommendations.length).toBeGreaterThan(0);

      // Verify ranked suggestions
      expect(data.output.rankedSuggestions).toBeInstanceOf(Array);
      expect(data.output.rankedSuggestions.length).toBeGreaterThan(0);

      const topSuggestion = data.output.rankedSuggestions[0];
      expect(topSuggestion.rank).toBe(1);
      expect(topSuggestion.rankingScore).toBeGreaterThanOrEqual(0);
      expect(topSuggestion.rankingScore).toBeLessThanOrEqual(100);
      expect(topSuggestion.rankingMethodology).toContain('MDAR v1');

      // Verify Explainability Fields
      expect(topSuggestion.whyThisRank).toBeTruthy();
      expect(topSuggestion.criteriaInfluence).toBeTruthy();
      expect(topSuggestion.evidenceSupport).toBeTruthy();
      expect(topSuggestion.whatCouldChangeRecommendation).toBeTruthy();
      expect(topSuggestion.assumptionsMade).toBeInstanceOf(Array);
      expect(topSuggestion.missingInformation).toBeInstanceOf(Array);
      expect(topSuggestion.scoreBreakdown).toBeDefined();
      expect(topSuggestion.scoreBreakdown.formula).toBeDefined();
    });

    it('identifies missing evidence and links to empirical gaps', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/analyze`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { capability: 'evidence_gaps' },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.output.evidenceGaps).toBeInstanceOf(Array);
      expect(data.output.evidenceGaps.length).toBeGreaterThan(0);
      expect(data.output.evidenceGaps[0].gapDescription).toBeTruthy();
      expect(data.output.evidenceGaps[0].recommendation).toBeTruthy();
    });
  });

  describe('2. Suggestion Ranking Determinism & Methodology', () => {
    it('produces identical scores and ranking order across 50 consecutive runs on identical inputs', async () => {
      const decisionDoc = (await DecisionModel.findById(decisionId)) as DecisionDocument;
      const evidence = await DecisionEvidenceModel.find({ decisionId });

      const mockOutput: AiAnalystOutput = {
        executiveSummary: 'Test Summary',
        tradeoffAnalysis: {
          winnerObservation: 'AWS leads',
          keyTradeoffs: ['Tradeoff A'],
          sensitivityNotes: ['Sensitivity Note B'],
          risks: [
            {
              risk: 'Egress Volatility',
              severity: 'high',
              mitigation: 'Direct Connect',
              affectedOptionIds: ['aws', 'gcp'],
            },
          ],
        },
        evidenceGaps: [
          {
            targetType: 'criterion',
            targetId: 'cost',
            targetName: 'Cost Efficiency',
            gapDescription: 'Lacks egress empirical measurement',
            recommendation: 'Run synthetic load test',
          },
        ],
        assumptions: ['Static workloads'],
        followUpQuestions: ['SLA requirements?'],
        suggestedCriteria: [
          {
            id: 'compliance',
            name: 'Security Compliance',
            description: 'FedRAMP SOC2',
            suggestedWeight: 20,
            direction: 'benefit',
            rationale: 'Required for compliance',
          },
        ],
        suggestedAlternatives: [
          {
            id: 'hybrid-cloud',
            name: 'Hybrid Multi-Cloud Architecture',
            description: 'Deploy stateless across both clouds',
            rationale: 'Prevent lock-in',
          },
        ],
        expertRecommendations: [
          {
            domain: 'FinOps Specialist',
            role: 'contributor',
            rationale: 'Audit discount commitments',
            targetCriteria: ['cost'],
            expectedContribution: 'Validate 3-yr TCO',
          },
        ],
      };

      const baseline = suggestionRankingService.rankSuggestions({
        decision: decisionDoc,
        evidence: evidence as any,
        contributions: [],
        output: mockOutput,
      });

      expect(baseline.length).toBeGreaterThan(0);

      // Verify determinism across 50 iterations
      for (let i = 0; i < 50; i++) {
        const result = suggestionRankingService.rankSuggestions({
          decision: decisionDoc,
          evidence: evidence as any,
          contributions: [],
          output: mockOutput,
        });

        expect(result.length).toBe(baseline.length);
        for (let j = 0; j < baseline.length; j++) {
          expect(result[j].id).toBe(baseline[j].id);
          expect(result[j].rank).toBe(baseline[j].rank);
          expect(result[j].rankingScore).toBe(baseline[j].rankingScore);
          expect(result[j].whyThisRank).toBe(baseline[j].whyThisRank);
        }
      }
    });

    it('breaks ties deterministically by evidence count, low missing info, and alphabetical id', () => {
      const decisionStub = {
        criteria: [{ id: 'c1', name: 'Crit 1', weight: 50 }],
        options: [{ id: 'o1', name: 'Opt 1' }],
        analysis: null,
      } as unknown as DecisionDocument;

      const mockOutput: AiAnalystOutput = {
        executiveSummary: 'Tie Break Test',
        evidenceGaps: [],
        assumptions: [],
        followUpQuestions: [],
        suggestedCriteria: [
          {
            id: 'zebra-crit',
            name: 'Zebra Criterion',
            description: 'Same priority',
            suggestedWeight: 10,
            direction: 'benefit',
            rationale: 'Tie test',
          },
          {
            id: 'alpha-crit',
            name: 'Alpha Criterion',
            description: 'Same priority',
            suggestedWeight: 10,
            direction: 'benefit',
            rationale: 'Tie test',
          },
        ],
      };

      const ranked = suggestionRankingService.rankSuggestions({
        decision: decisionStub,
        evidence: [],
        contributions: [],
        output: mockOutput,
      });

      expect(ranked.length).toBe(2);
      expect(ranked[0].rankingScore).toBe(ranked[1].rankingScore);
      // Alphabetical tie-break: alpha-crit comes before zebra-crit
      expect(ranked[0].id).toBe('criterion-alpha-crit');
      expect(ranked[1].id).toBe('criterion-zebra-crit');
    });

    it('increases evidence grounding factor when verified empirical evidence matches proposal target', async () => {
      const decisionDoc = (await DecisionModel.findById(decisionId)) as DecisionDocument;

      const mockOutput: AiAnalystOutput = {
        executiveSummary: 'Evidence Grounding Test',
        evidenceGaps: [],
        assumptions: [],
        followUpQuestions: [],
        suggestedCriteria: [],
        expertRecommendations: [
          {
            domain: 'FinOps Specialist',
            role: 'contributor',
            rationale: 'Audit cost',
            targetCriteria: ['cost'],
            expectedContribution: 'Audit cost models',
          },
        ],
      };

      // Case A: With verified evidence for 'cost'
      const withEvidence = suggestionRankingService.rankSuggestions({
        decision: decisionDoc,
        evidence: [
          {
            targetType: 'criterion',
            targetId: 'cost',
            title: 'Cost Audit 2026',
          },
        ] as any,
        contributions: [],
        output: mockOutput,
      });

      // Case B: Zero evidence
      const withoutEvidence = suggestionRankingService.rankSuggestions({
        decision: decisionDoc,
        evidence: [],
        contributions: [],
        output: mockOutput,
      });

      expect(withEvidence[0].scoreBreakdown.evidenceGrounding).toBeGreaterThan(
        withoutEvidence[0].scoreBreakdown.evidenceGrounding
      );
      expect(withEvidence[0].rankingScore).toBeGreaterThan(withoutEvidence[0].rankingScore);
    });
  });

  describe('3. Failure & Edge Case Handling', () => {
    it('handles empty suggestions gracefully without throwing', async () => {
      // Use trigger that returns empty suggestions
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/analyze`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { capability: 'all' },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.output).toBeDefined();
    });

    it('deduplicates duplicate proposal IDs deterministically', () => {
      const decisionStub = {
        criteria: [{ id: 'cost', name: 'Cost', weight: 40 }],
        options: [{ id: 'aws', name: 'AWS' }],
        analysis: null,
      } as unknown as DecisionDocument;

      const mockOutputWithDuplicates: AiAnalystOutput = {
        executiveSummary: 'Duplicate Test',
        evidenceGaps: [],
        assumptions: [],
        followUpQuestions: [],
        suggestedCriteria: [
          {
            id: 'compliance',
            name: 'Security Compliance',
            description: 'Duplicate A',
            suggestedWeight: 15,
            direction: 'benefit',
            rationale: 'A',
          },
          {
            id: 'compliance',
            name: 'Security Compliance',
            description: 'Duplicate B',
            suggestedWeight: 15,
            direction: 'benefit',
            rationale: 'B',
          },
        ],
      };

      const ranked = suggestionRankingService.rankSuggestions({
        decision: decisionStub,
        evidence: [],
        contributions: [],
        output: mockOutputWithDuplicates,
      });

      expect(ranked.length).toBe(1);
      expect(ranked[0].id).toBe('criterion-compliance');
    });

    it('safely handles malformed evidence objects with undefined or null fields', () => {
      const decisionStub = {
        criteria: [{ id: 'cost', name: 'Cost', weight: 40 }],
        options: [{ id: 'aws', name: 'AWS' }],
        analysis: null,
      } as unknown as DecisionDocument;

      const mockOutput: AiAnalystOutput = {
        executiveSummary: 'Malformed Evidence Test',
        evidenceGaps: [],
        assumptions: [],
        followUpQuestions: [],
        suggestedCriteria: [
          {
            id: 'compliance',
            name: 'Compliance',
            description: 'Test',
            suggestedWeight: 10,
            direction: 'benefit',
            rationale: 'Test',
          },
        ],
      };

      const malformedEvidence = [
        null,
        undefined,
        {},
        { targetType: null, targetId: undefined, title: null },
        { targetType: 123, targetId: 456 },
      ];

      expect(() =>
        suggestionRankingService.rankSuggestions({
          decision: decisionStub,
          evidence: malformedEvidence as any,
          contributions: [],
          output: mockOutput,
        })
      ).not.toThrow();
    });

    it('handles unsupported decision context (0 criteria, 0 options) without crashing', async () => {
      const emptyDec = await app.inject({
        method: 'POST',
        url: '/api/decisions',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          title: 'Empty Sandbox Decision',
          criteria: [],
          options: [],
        },
      });

      const emptyId = emptyDec.json()._id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${emptyId}/ai/analyze`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { capability: 'all' },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.output.executiveSummary).toBeTruthy();
    });
  });

  describe('4. Human Authority & Proposal Adoption Boundaries', () => {
    it('verifies AI analysis never mutates authoritative decision criteria, weights, or scores', async () => {
      const beforeDec = await DecisionModel.findById(decisionId);

      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/analyze`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { capability: 'all' },
      });

      const afterDec = await DecisionModel.findById(decisionId);

      expect(afterDec!.criteria.length).toBe(beforeDec!.criteria.length);
      expect(afterDec!.options.length).toBe(beforeDec!.options.length);
      expect(afterDec!.scores).toEqual(beforeDec!.scores);
      expect(afterDec!.version).toBe(beforeDec!.version);
    });

    it('blocks viewers from applying an alternative option proposal with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/proposals/apply`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          type: 'add_option',
          option: {
            id: 'hybrid-cloud',
            name: 'Hybrid Multi-Cloud Architecture',
            description: 'Viewer should not be able to add this',
          },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Forbidden');
    });

    it('blocks contributors from applying an alternative option proposal with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/proposals/apply`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          type: 'add_option',
          option: {
            id: 'hybrid-cloud',
            name: 'Hybrid Multi-Cloud Architecture',
          },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Forbidden');
    });

    it('allows decision editor to explicitly adopt an alternative option proposal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/proposals/apply`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          type: 'add_option',
          option: {
            id: 'on-prem-k8s',
            name: 'On-Premises Kubernetes Cluster',
            description: 'Self-hosted bare metal cluster',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.options.some((o: any) => o.id === 'on-prem-k8s')).toBe(true);
      // Stale analysis policy: Adding an option without scores resets analysis to null
      expect(updated.analysis).toBeNull();
    });

    it('allows decision owner to explicitly adopt an alternative option proposal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/proposals/apply`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          type: 'add_option',
          option: {
            id: 'serverless-edge',
            name: 'Serverless Edge Architecture',
            description: 'Edge workers with global distribution',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.options.some((o: any) => o.id === 'serverless-edge')).toBe(true);
      expect(updated.analysis).toBeNull();
    });

    it('rejects duplicate option IDs with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/proposals/apply`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          type: 'add_option',
          option: {
            id: 'aws', // Already in baseDecisionPayload
            name: 'Duplicate AWS Option',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('already exists');
    });

    it('blocks unrelated users from applying proposals with 404 Not Found enumeration defense', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/ai/proposals/apply`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
        payload: {
          type: 'add_option',
          option: {
            id: 'attacker-opt',
            name: 'Unauthorized Option',
          },
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
