import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase } from '../src/db/guard';
import { DecisionModel } from '../src/models/decision.model';
import { UserModel } from '../src/models/user.model';
import { DecisionEvidenceModel } from '../src/models/evidence.model';
import { DecisionContributionModel } from '../src/models/contribution.model';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model';
import { createDecision } from '../src/services/decision.service';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

describe('Analytics API — /api/analytics and /api/decisions/:id/analytics', () => {
  let app: FastifyInstance;
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();

    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionEvidenceModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});

    // Create User A
    const userA = new UserModel({
      email: 'analytics-user-a@example.com',
      passwordHash: 'dummy_hash',
      name: 'User A',
      role: 'user',
    });
    await userA.save();
    userAId = userA._id.toString();
    userAToken = app.jwt.sign({
      sub: userAId,
      id: userAId,
      email: userA.email,
      name: userA.name,
      role: userA.role,
    });

    // Create User B
    const userB = new UserModel({
      email: 'analytics-user-b@example.com',
      passwordHash: 'dummy_hash',
      name: 'User B',
      role: 'user',
    });
    await userB.save();
    userBId = userB._id.toString();
    userBToken = app.jwt.sign({
      sub: userBId,
      id: userBId,
      email: userB.email,
      name: userB.name,
      role: userB.role,
    });
  });

  afterAll(async () => {
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await DecisionModel.deleteMany({});
    await DecisionEvidenceModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
  });

  describe('GET /api/decisions/:id/analytics', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/decisions/507f1f77bcf86cd799439011/analytics',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid ObjectId formats with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/decisions/invalid-id-xyz/analytics',
        headers: { authorization: `Bearer ${userAToken}` },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message).toContain('not a valid 24-character hexadecimal string');
    });

    it('returns 404 when unrelated user requests another user private decision (enumeration defense)', async () => {
      // User A creates decision
      const doc = await createDecision(
        {
          title: 'Private Decision A',
          criteria: [
            { id: 'c1', name: 'C1', weight: 50, direction: 'benefit' },
            { id: 'c2', name: 'C2', weight: 50, direction: 'benefit' },
          ],
          options: [
            { id: 'o1', name: 'Opt 1' },
            { id: 'o2', name: 'Opt 2' },
          ],
          scores: {
            o1: { c1: 90, c2: 80 },
            o2: { c1: 70, c2: 60 },
          },
        },
        { id: userAId, email: 'analytics-user-a@example.com', name: 'User A', role: 'user' }
      );

      // User B attempts to access User A's decision analytics
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${doc._id.toString()}/analytics`,
        headers: { authorization: `Bearer ${userBToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns comprehensive decision analytics for authorized owner', async () => {
      const doc = await createDecision(
        {
          title: 'Infrastructure Provider Selection',
          description: 'Evaluating AWS vs GCP for big data pipeline',
          criteria: [
            { id: 'growth', name: 'Scalability', weight: 40, direction: 'benefit' },
            { id: 'cost', name: 'Cost Efficiency', weight: 35, direction: 'benefit' },
            { id: 'support', name: 'Support', weight: 25, direction: 'benefit' },
          ],
          options: [
            { id: 'aws', name: 'Amazon Web Services' },
            { id: 'gcp', name: 'Google Cloud Platform' },
          ],
          scores: {
            aws: { growth: 90, cost: 70, support: 60 },
            gcp: { growth: 70, cost: 85, support: 75 },
          },
        },
        { id: userAId, email: 'analytics-user-a@example.com', name: 'User A', role: 'user' }
      );

      // Attach evidence records
      await DecisionEvidenceModel.create({
        decisionId: doc._id,
        targetType: 'option',
        targetId: 'aws',
        createdById: userAId,
        type: 'url',
        title: 'AWS Pricing Benchmark',
        sourceUrl: 'https://aws.amazon.com/pricing',
        provenance: {
          createdByName: 'User A',
          createdByEmail: 'analytics-user-a@example.com',
          capturedVia: 'web_link',
        },
      });

      await DecisionEvidenceModel.create({
        decisionId: doc._id,
        targetType: 'criterion',
        targetId: 'growth',
        createdById: userAId,
        type: 'document',
        title: 'Workload Capacity Planning Doc',
        provenance: {
          createdByName: 'User A',
          createdByEmail: 'analytics-user-a@example.com',
          capturedVia: 'document_citation',
        },
      });

      // Attach expert contribution
      await DecisionContributionModel.create({
        decisionId: doc._id,
        contributorId: userAId,
        status: 'submitted',
        submittedAt: new Date(),
        recommendation: {
          preferredOptionId: 'gcp',
          rationale: 'Better managed Kubernetes and BigQuery economics',
        },
        criterionScores: {
          growth: 75,
          cost: 90,
          support: 80,
        },
        confidence: 0.9,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${doc._id.toString()}/analytics?includeMonteCarlo=true&iterations=500&seed=42`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();

      // Basic metadata
      expect(data.decisionId).toBe(doc._id.toString());
      expect(data.title).toBe('Infrastructure Provider Selection');
      expect(data.isAuthoritative).toBe(true);
      expect(data.outcome).toBe('decisive');
      expect(data.winner.id).toBe('gcp');
      expect(data.runnerUp.id).toBe('aws');

      // Criteria importance
      expect(data.criteriaImportance.length).toBe(3);
      expect(data.criteriaImportance.find((c: any) => c.id === 'growth').relativeShare).toBe(40);

      // Sensitivity & Counterfactual
      expect(data.sensitivityAnalysis.analyticalTippingPoints.length).toBe(3);
      expect(data.sensitivityAnalysis.optionScoreSensitivity.length).toBe(3);
      expect(data.sensitivityAnalysis.multiParameterCounterfactual.isFeasible).toBe(true);
      expect(data.sensitivityAnalysis.multiParameterCounterfactual.targetOptionId).toBe('aws');

      // Uncertainty Analysis with strict metric interpretation
      expect(data.uncertaintyAnalysis.hasMonteCarlo).toBe(true);
      expect(data.uncertaintyAnalysis.iterations).toBe(500);
      expect(data.uncertaintyAnalysis.seed).toBe(42);
      expect(data.uncertaintyAnalysis.metricInterpretation).toBe(
        'win probability under the specified uncertainty model'
      );
      expect(data.uncertaintyAnalysis.optionResults.length).toBe(2);

      // Evidence Coverage & Missing Indicators
      expect(data.evidenceCoverage.totalEvidenceCount).toBe(2);
      expect(data.evidenceCoverage.byTargetType.option).toBe(1);
      expect(data.evidenceCoverage.byTargetType.criterion).toBe(1);
      expect(data.evidenceCoverage.bySourceType.url).toBe(1);
      expect(data.evidenceCoverage.bySourceType.document).toBe(1);

      // Option coverage check: aws has evidence, gcp is missing
      const gcpOptCov = data.evidenceCoverage.optionsCoverage.find((o: any) => o.optionId === 'gcp');
      expect(gcpOptCov.hasEvidence).toBe(false);
      expect(data.evidenceCoverage.missingEvidenceTargets.options).toContainEqual({
        id: 'gcp',
        name: 'Google Cloud Platform',
      });

      // Criterion coverage check: cost and support are missing evidence
      expect(data.evidenceCoverage.missingEvidenceTargets.criteria.length).toBe(2);

      // Methodology disclaimer present without invented quality score
      expect(data.evidenceCoverage.methodologyDisclaimer).toContain('Evidence quantity does NOT imply');

      // Expert Deliberation
      expect(data.expertParticipation.totalContributions).toBe(1);
      expect(data.expertParticipation.submittedCount).toBe(1);
      expect(data.expertParticipation.recommendationTally).toContainEqual({
        optionId: 'gcp',
        optionName: 'Google Cloud Platform',
        count: 1,
      });

      // Guarantees query is read-only (did not mutate decision)
      const afterDoc = await DecisionModel.findById(doc._id);
      expect(afterDoc?.calculationVersion).toBe(doc.calculationVersion);
    });

    it('handles incomplete / unscored decisions with graceful fallback', async () => {
      // Incomplete scores
      const doc = new DecisionModel({
        title: 'Unscored Draft Decision',
        criteria: [{ id: 'c1', name: 'Speed', weight: 100 }],
        options: [{ id: 'o1', name: 'Opt 1' }],
        scores: {},
        ownerId: userAId,
      });
      await doc.save();

      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${doc._id.toString()}/analytics`,
        headers: { authorization: `Bearer ${userAToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.outcome).toBe('unscored');
      expect(data.isAuthoritative).toBe(false);
      expect(data.winner).toBeNull();
      expect(data.pointLead).toBe(0);
      expect(data.uncertaintyAnalysis.hasMonteCarlo).toBe(false);
      expect(data.uncertaintyAnalysis.robustnessRating).toBe('unavailable');
    });

    it('allows shared collaborator with viewer role to view analytics', async () => {
      // User A creates decision
      const doc = await createDecision(
        {
          title: 'Shared Decision for Review',
          criteria: [
            { id: 'c1', name: 'C1', weight: 50 },
            { id: 'c2', name: 'C2', weight: 50 },
          ],
          options: [
            { id: 'o1', name: 'Opt 1' },
            { id: 'o2', name: 'Opt 2' },
          ],
          scores: {
            o1: { c1: 80, c2: 80 },
            o2: { c1: 70, c2: 70 },
          },
        },
        { id: userAId, email: 'analytics-user-a@example.com', name: 'User A', role: 'user' }
      );

      // Grant User B viewer access
      await DecisionAccessGrantModel.create({
        decisionId: doc._id,
        userId: userBId,
        role: 'viewer',
        grantedBy: userAId,
      });

      // User B fetches analytics
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${doc._id.toString()}/analytics`,
        headers: { authorization: `Bearer ${userBToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.title).toBe('Shared Decision for Review');
      expect(data.winner.id).toBe('o1');
    });
  });

  describe('GET /api/analytics/overview', () => {
    it('rejects unauthenticated requests to /api/analytics/overview with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/analytics/overview',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns empty zero-state structure when user has no decisions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/analytics/overview',
        headers: { authorization: `Bearer ${userAToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.decisionMetrics.totalDecisions).toBe(0);
      expect(data.decisionMetrics.completionRate).toBe(0);
      expect(data.decisionMetrics.averagePointLead).toBeNull();
      expect(data.evidenceMetrics.totalEvidenceRecords).toBe(0);
      expect(data.deliberationMetrics.totalContributions).toBe(0);
      expect(data.activityTrends).toEqual([]);
    });

    it('correctly aggregates portfolio metrics with strict cross-user data isolation', async () => {
      // User A creates 2 decisions
      const decA1 = await createDecision(
        {
          title: 'User A Completed Decision',
          criteria: [
            { id: 'c1', name: 'Cost', weight: 50 },
            { id: 'c2', name: 'Speed', weight: 50 },
          ],
          options: [
            { id: 'o1', name: 'Opt 1' },
            { id: 'o2', name: 'Opt 2' },
          ],
          scores: {
            o1: { c1: 90, c2: 90 },
            o2: { c1: 70, c2: 70 },
          },
        },
        { id: userAId, email: 'analytics-user-a@example.com', name: 'User A', role: 'user' }
      );

      await createDecision(
        {
          title: 'User A Tied Decision',
          criteria: [
            { id: 'c1', name: 'Quality', weight: 100 },
          ],
          options: [
            { id: 'o1', name: 'Alpha' },
            { id: 'o2', name: 'Beta' },
          ],
          scores: {
            o1: { c1: 80 },
            o2: { c1: 80 },
          },
        },
        { id: userAId, email: 'analytics-user-a@example.com', name: 'User A', role: 'user' }
      );

      // Add evidence to decA1
      await DecisionEvidenceModel.create({
        decisionId: decA1._id,
        targetType: 'decision',
        targetId: 'root',
        createdById: userAId,
        type: 'url',
        title: 'Project Roadmap',
        provenance: {
          createdByName: 'User A',
          createdByEmail: 'analytics-user-a@example.com',
          capturedVia: 'web_link',
        },
      });

      // User B creates 1 decision with evidence
      const decB = await createDecision(
        {
          title: 'User B Confidential Decision',
          criteria: [{ id: 'secret', name: 'Secret Factor', weight: 100 }],
          options: [{ id: 'bx', name: 'Secret Option' }, { id: 'by', name: 'Secret Opt 2' }],
          scores: { bx: { secret: 95 }, by: { secret: 40 } },
        },
        { id: userBId, email: 'analytics-user-b@example.com', name: 'User B', role: 'user' }
      );

      await DecisionEvidenceModel.create({
        decisionId: decB._id,
        targetType: 'decision',
        targetId: 'root',
        createdById: userBId,
        type: 'excerpt',
        title: 'Private Note',
        provenance: {
          createdByName: 'User B',
          createdByEmail: 'analytics-user-b@example.com',
          capturedVia: 'manual_entry',
        },
      });

      // User A requests workspace overview
      const resA = await app.inject({
        method: 'GET',
        url: '/api/analytics/overview',
        headers: { authorization: `Bearer ${userAToken}` },
      });

      expect(resA.statusCode).toBe(200);
      const dataA = resA.json();

      // Total decisions: User A sees only their 2 decisions
      expect(dataA.decisionMetrics.totalDecisions).toBe(2);
      expect(dataA.decisionMetrics.statusDistribution.decisive).toBe(1);
      expect(dataA.decisionMetrics.statusDistribution.tie).toBe(1);
      expect(dataA.decisionMetrics.statusDistribution.unscored).toBe(0);
      expect(dataA.decisionMetrics.completionRate).toBe(100);

      // Point lead on decisive decision: (90-70) = 20
      expect(dataA.decisionMetrics.averagePointLead).toBe(20);

      // Evidence count: User A sees only 1 evidence (not User B's evidence!)
      expect(dataA.evidenceMetrics.totalEvidenceRecords).toBe(1);
      expect(dataA.evidenceMetrics.decisionsWithEvidenceCount).toBe(1);
      expect(dataA.evidenceMetrics.decisionEvidenceCoverageRate).toBe(50);
      expect(dataA.evidenceMetrics.sourceTypeBreakdown.url).toBe(1);
      expect(dataA.evidenceMetrics.sourceTypeBreakdown.excerpt).toBe(0);

      // Criteria metrics: Cost, Speed, Quality
      expect(dataA.criteriaAndOptionsMetrics.totalCriteriaDefined).toBe(3);
      expect(dataA.criteriaAndOptionsMetrics.topCriteriaNames).not.toContainEqual(
        expect.objectContaining({ name: 'Secret Factor' })
      );

      // User B requests workspace overview
      const resB = await app.inject({
        method: 'GET',
        url: '/api/analytics/overview',
        headers: { authorization: `Bearer ${userBToken}` },
      });

      expect(resB.statusCode).toBe(200);
      const dataB = resB.json();
      expect(dataB.decisionMetrics.totalDecisions).toBe(1);
      expect(dataB.evidenceMetrics.totalEvidenceRecords).toBe(1);
      expect(dataB.evidenceMetrics.sourceTypeBreakdown.excerpt).toBe(1);
      expect(dataB.evidenceMetrics.sourceTypeBreakdown.url).toBe(0);
    });

    it('filters workspace analytics by valid date ranges', async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10); // 10 days ago
      const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 10); // 10 days future

      await createDecision(
        {
          title: 'Recent Decision',
          criteria: [{ id: 'c1', name: 'C1', weight: 100 }],
          options: [{ id: 'o1', name: 'O1' }, { id: 'o2', name: 'O2' }],
          scores: { o1: { c1: 90 }, o2: { c1: 80 } },
        },
        { id: userAId, email: 'analytics-user-a@example.com', name: 'User A', role: 'user' }
      );

      // Query with date range covering now
      const resCovered = await app.inject({
        method: 'GET',
        url: `/api/analytics/overview?startDate=${pastDate.toISOString()}&endDate=${futureDate.toISOString()}`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      expect(resCovered.statusCode).toBe(200);
      expect(resCovered.json().decisionMetrics.totalDecisions).toBe(1);

      // Query with date range in past before creation
      const wayPastStart = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30).toISOString();
      const wayPastEnd = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 20).toISOString();
      const resPast = await app.inject({
        method: 'GET',
        url: `/api/analytics/overview?startDate=${wayPastStart}&endDate=${wayPastEnd}`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      expect(resPast.statusCode).toBe(200);
      expect(resPast.json().decisionMetrics.totalDecisions).toBe(0);
    });

    it('rejects invalid date range when startDate > endDate with 400 Bad Request', async () => {
      const startDate = '2026-10-20T00:00:00.000Z';
      const endDate = '2026-10-10T00:00:00.000Z';
      const res = await app.inject({
        method: 'GET',
        url: `/api/analytics/overview?startDate=${startDate}&endDate=${endDate}`,
        headers: { authorization: `Bearer ${userAToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('startDate cannot be after endDate');
    });
  });
});

