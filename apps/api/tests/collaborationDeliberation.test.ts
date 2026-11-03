import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase } from '../src/db/guard.js';
import { UserModel } from '../src/models/user.model.js';
import { DecisionModel } from '../src/models/decision.model.js';
import { DecisionInvitationModel } from '../src/models/invitation.model.js';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model.js';
import { DecisionContributionModel } from '../src/models/contribution.model.js';
import { AuditEventModel } from '../src/models/audit.model.js';
import { OperationJournalModel } from '../src/models/operationJournal.model.js';
import { CommentModel } from '../src/models/comment.model.js';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

const baseDecisionPayload = {
  title: 'Cloud Infrastructure Provider Selection',
  description: 'Evaluate compute, network, and storage across hyper-scalers',
  criteria: [
    { id: 'cost', name: 'Cost Efficiency', weight: 40, direction: 'benefit' as const },
    { id: 'latency', name: 'Global Latency', weight: 30, direction: 'cost' as const },
    { id: 'security', name: 'Security Posture', weight: 30, direction: 'benefit' as const },
  ],
  options: [
    { id: 'aws', name: 'Amazon Web Services' },
    { id: 'gcp', name: 'Google Cloud Platform' },
    { id: 'azure', name: 'Microsoft Azure' },
  ],
  scores: {
    aws: { cost: 70, latency: 40, security: 85 },
    gcp: { cost: 85, latency: 30, security: 80 },
    azure: { cost: 75, latency: 45, security: 80 },
  },
};

describe('Batch 4 Phase 1 — Collaboration, Deliberation & Adoption Lifecycle', () => {
  let app: FastifyInstance;

  // Roles
  let ownerToken: string;
  let ownerId: string;
  const ownerEmail = 'owner-delib@example.com';

  let editorToken: string;
  let editorId: string;
  const editorEmail = 'editor-delib@example.com';

  let expertToken: string;
  let expertId: string;
  const expertEmail = 'expert-delib@example.com';

  let viewerToken: string;
  let viewerId: string;
  const viewerEmail = 'viewer-delib@example.com';

  let unrelatedToken: string;
  const unrelatedEmail = 'unrelated-delib@example.com';

  let decisionId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await CommentModel.deleteMany({});
    await OperationJournalModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});
    await CommentModel.deleteMany({});
    await OperationJournalModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});

    // Register test participants
    const resOwner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: ownerEmail, password: 'Password123!', name: 'Owner User' },
    });
    ownerToken = resOwner.json().token;
    ownerId = resOwner.json().user.id;

    const resEditor = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: editorEmail, password: 'Password123!', name: 'Editor User' },
    });
    editorToken = resEditor.json().token;
    editorId = resEditor.json().user.id;

    const resExpert = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: expertEmail, password: 'Password123!', name: 'Expert Contributor' },
    });
    expertToken = resExpert.json().token;
    expertId = resExpert.json().user.id;

    const resViewer = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: viewerEmail, password: 'Password123!', name: 'Viewer User' },
    });
    viewerToken = resViewer.json().token;
    viewerId = resViewer.json().user.id;

    const resUnrelated = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: unrelatedEmail, password: 'Password123!', name: 'Unrelated User' },
    });
    unrelatedToken = resUnrelated.json().token;

    // Create primary decision
    const resDec = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: baseDecisionPayload,
    });
    decisionId = resDec.json().id;

    // Grant Editor access
    await DecisionAccessGrantModel.create({
      decisionId,
      userId: editorId,
      role: 'editor',
      grantedBy: ownerId,
    });

    // Grant Contributor access
    await DecisionAccessGrantModel.create({
      decisionId,
      userId: expertId,
      role: 'contributor',
      grantedBy: ownerId,
    });

    // Grant Viewer access
    await DecisionAccessGrantModel.create({
      decisionId,
      userId: viewerId,
      role: 'viewer',
      grantedBy: ownerId,
    });
  });

  // Helper to create and submit a contribution
  async function createAndSubmitContribution(criterionScores: Record<string, number> = { cost: 95, latency: 25, security: 90 }) {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions`,
      headers: { authorization: `Bearer ${expertToken}` },
      payload: {
        preferredOptionId: 'gcp',
        criterionScores,
        rationale: 'Deep latency and cloud cost benchmarks based on 2026 performance testing',
        recommendation: {
          preferredOptionId: 'gcp',
          justification: 'Best network latency and lowest egress pricing',
        },
      },
    });
    expect(createRes.statusCode).toBe(200);
    const contributionId = createRes.json().id || createRes.json()._id;

    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions/submit`,
      headers: { authorization: `Bearer ${expertToken}` },
    });
    expect(submitRes.statusCode).toBe(200);

    return { contributionId, submitRes: submitRes.json() };
  }

  // =========================================================================
  // 1. Contribution Rejection Lifecycle & Authorization
  // =========================================================================
  describe('Contribution Rejection Lifecycle', () => {
    it('allows decision owner to reject a submitted contribution with rationale', async () => {
      const { contributionId } = await createAndSubmitContribution();

      const rejectRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/reject`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          rejectionReason: 'Latency testing methodologies do not align with internal network telemetry',
        },
      });

      expect(rejectRes.statusCode).toBe(200);
      const rejected = rejectRes.json();
      expect(rejected.id).toBe(contributionId);
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toBe(
        'Latency testing methodologies do not align with internal network telemetry'
      );
      expect(rejected.rejectedBy).toBeDefined();
      expect(rejected.rejectedBy.id).toBe(ownerId);
      expect(rejected.rejectedAt).toBeDefined();

      // Verify audit event recorded
      const auditLog = await AuditEventModel.findOne({
        decisionId,
        action: 'contribution.rejected',
        entityId: contributionId,
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.actorId).toBe(ownerId);
    });

    it('rejects rejection attempts by non-owner roles (editor, contributor, viewer) with 403 Forbidden', async () => {
      const { contributionId } = await createAndSubmitContribution();

      // Editor attempt
      const editorRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/reject`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { rejectionReason: 'Editor rejecting' },
      });
      expect(editorRes.statusCode).toBe(403);

      // Contributor attempt (even if own contribution)
      const expertRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/reject`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { rejectionReason: 'Expert rejecting own' },
      });
      expect(expertRes.statusCode).toBe(403);

      // Viewer attempt
      const viewerRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/reject`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { rejectionReason: 'Viewer rejecting' },
      });
      expect(viewerRes.statusCode).toBe(403);
    });

    it('rejects unrelated users with 404 (ID enumeration defense)', async () => {
      const { contributionId } = await createAndSubmitContribution();

      const unrelatedRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/reject`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
        payload: { rejectionReason: 'Unrelated rejecting' },
      });
      expect(unrelatedRes.statusCode).toBe(404);
    });

    it('blocks rejection of contributions not in submitted state (e.g. draft)', async () => {
      const draftRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          criterionScores: { cost: 80, latency: 40, security: 80 },
          rationale: 'Draft analysis',
        },
      });
      expect(draftRes.statusCode).toBe(200);
      const draftId = draftRes.json().id || draftRes.json()._id;

      const rejectRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${draftId}/reject`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { rejectionReason: 'Premature rejection' },
      });
      expect(rejectRes.statusCode).toBe(400);
      expect(rejectRes.json().message).toContain('Only submitted contributions can be rejected');
    });

    it('blocks rejection when decision is quarantined with 423 Locked', async () => {
      const { contributionId } = await createAndSubmitContribution();

      // Quarantine decision
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: {
          auditIntegrityStatus: 'quarantined',
          quarantineReason: 'Audit chain tamper detected',
        },
      });

      const rejectRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/reject`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { rejectionReason: 'Quarantined rejection' },
      });
      expect(rejectRes.statusCode).toBe(423);
      expect(rejectRes.json().error).toBe('DecisionQuarantinedError');
    });
  });

  // =========================================================================
  // 2. Adoption Contracts & Authorization Matrix
  // =========================================================================
  describe('Adoption Input Validation & Authorization', () => {
    it('requires explicit confirmation: true', async () => {
      const { contributionId } = await createAndSubmitContribution();

      // confirmation omitted
      const resMissing = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { expectedVersion: 1 },
      });
      expect(resMissing.statusCode).toBe(400);
      expect(resMissing.json().message).toContain('confirmation');

      // confirmation: false
      const resFalse = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: false, expectedVersion: 1 },
      });
      expect(resFalse.statusCode).toBe(400);
    });

    it('requires valid expectedVersion positive integer', async () => {
      const { contributionId } = await createAndSubmitContribution();

      const resZero = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 0 },
      });
      expect(resZero.statusCode).toBe(400);

      const resString = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 'one' },
      });
      expect(resString.statusCode).toBe(400);
    });

    it('restricts adoption exclusively to Owner (Editor, Contributor, Viewer receive 403 Forbidden)', async () => {
      const { contributionId } = await createAndSubmitContribution();

      // Editor attempt
      const editorRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });
      expect(editorRes.statusCode).toBe(403);

      // Contributor attempt
      const expertRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });
      expect(expertRes.statusCode).toBe(403);

      // Viewer attempt
      const viewerRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });
      expect(viewerRes.statusCode).toBe(403);
    });

    it('blocks adoption on quarantined decision with HTTP 423 Locked', async () => {
      const { contributionId } = await createAndSubmitContribution();

      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: {
          auditIntegrityStatus: 'quarantined',
          quarantineReason: 'Compensating transaction under review',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(423);
      expect(res.json().error).toBe('DecisionQuarantinedError');
    });
  });

  // =========================================================================
  // 3. Optimistic Concurrency & In-Flight Collision Guard
  // =========================================================================
  describe('Optimistic Concurrency & Collision Blocking', () => {
    it('returns 409 Conflict when expectedVersion does not match current version', async () => {
      const { contributionId } = await createAndSubmitContribution();

      // Decision version is 1, client sends expectedVersion: 99
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 99 },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error).toBe('Conflict');
      expect(body.message).toContain('current version: 1, expected: 99');
    });

    it('returns 409 Conflict when decision has an in-flight operation pending', async () => {
      const { contributionId } = await createAndSubmitContribution();

      // Simulate an in-flight background operation
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: { pendingOperationId: 'op-in-flight-12345' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toContain('in-flight operation pending reconciliation');
    });
  });

  // =========================================================================
  // 4. Successful Adoption & Synchronous Canonical Evaluation
  // =========================================================================
  describe('Adoption Execution & Engine Recalculation', () => {
    it('successfully adopts contribution, updates scores, runs engine, increments version, and audits', async () => {
      const { contributionId } = await createAndSubmitContribution({
        cost: 92,
        latency: 22,
        security: 95,
      });

      const adoptRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });

      expect(adoptRes.statusCode).toBe(200);
      const adoptedDec = adoptRes.json();

      // 1. Version incremented
      expect(adoptedDec.version).toBe(2);

      // 2. Score matrix updated for GCP (preferred option)
      expect(adoptedDec.scores.gcp.cost).toBe(92);
      expect(adoptedDec.scores.gcp.latency).toBe(22);
      expect(adoptedDec.scores.gcp.security).toBe(95);

      // 3. Synchronous Canonical Evaluation performed
      expect(adoptedDec.analysis).toBeDefined();
      expect(adoptedDec.analysis.evaluations).toBeDefined();
      expect(adoptedDec.analysis.evaluations.length).toBe(3);
      expect(adoptedDec.analysis.decisionOutcome).toBe('decisive');
      expect(adoptedDec.analysis.winnerId).toBeDefined();

      // 4. Contribution status updated in DB
      const updatedContrib = await DecisionContributionModel.findById(contributionId);
      expect(updatedContrib?.status).toBe('adopted');
      expect(updatedContrib?.adoptedBy).toBe(ownerId);
      expect(updatedContrib?.adoptedAt).toBeDefined();

      // 5. Audit trail durably appended
      const auditLog = await AuditEventModel.findOne({
        decisionId,
        action: 'contribution.adopted',
        entityId: contributionId,
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.actorId).toBe(ownerId);
      expect(auditLog?.eventHash).toBeDefined();
      expect(auditLog?.previousEventHash).toBeDefined();
    });

    it('allows partial criterion adoption using selectedCriterionIds', async () => {
      const { contributionId } = await createAndSubmitContribution({
        cost: 99,
        latency: 10,
        security: 99,
      });

      // Adopt only cost and security, skipping latency
      const adoptRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          confirmation: true,
          expectedVersion: 1,
          selectedCriterionIds: ['cost', 'security'],
        },
      });

      expect(adoptRes.statusCode).toBe(200);
      const adoptedDec = adoptRes.json();
      expect(adoptedDec.scores.gcp.cost).toBe(99);
      expect(adoptedDec.scores.gcp.security).toBe(99);
      // Latency remains unchanged from base score (30)
      expect(adoptedDec.scores.gcp.latency).toBe(30);
    });
  });

  // =========================================================================
  // 5. Idempotent Replay Handling
  // =========================================================================
  describe('Idempotent Adoption Replay', () => {
    it('returns original decision with X-Decision-Idempotent-Replay header when re-requesting completed adoption', async () => {
      const { contributionId } = await createAndSubmitContribution({
        cost: 88,
        latency: 28,
        security: 82,
      });

      // First adoption
      const firstAdoptRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });
      expect(firstAdoptRes.statusCode).toBe(200);
      expect(firstAdoptRes.headers['x-decision-idempotent-replay']).toBeUndefined();
      expect(firstAdoptRes.json().version).toBe(2);

      const auditCountBefore = await AuditEventModel.countDocuments({ decisionId });

      // Retry adoption (e.g. network retry with the now updated decision version or expectedVersion)
      const replayRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 2 },
      });

      expect(replayRes.statusCode).toBe(200);
      expect(replayRes.headers['x-decision-idempotent-replay']).toBe('true');
      expect(replayRes.json().version).toBe(2);

      // Audit count must NOT increase
      const auditCountAfter = await AuditEventModel.countDocuments({ decisionId });
      expect(auditCountAfter).toBe(auditCountBefore);
    });
  });

  // =========================================================================
  // 6. Canonical Evaluation Failure & Monotonic Compensating Rollback
  // =========================================================================
  describe('Monotonic Compensation on Calculation Failure', () => {
    it('monotonically compensates state (incrementing version) if calculation throws an error', async () => {
      // Create a contribution
      const { contributionId } = await createAndSubmitContribution({
        cost: 90,
        latency: 35,
        security: 80,
      });

      // Break criteria weights on the decision in the database so that canonical engine runAnalysis fails
      // (Weights summing to something invalid or corrupting criteria definition)
      await DecisionModel.findByIdAndUpdate(decisionId, {
        $set: {
          criteria: [
            { id: 'cost', name: 'Cost', weight: -50, direction: 'benefit' }, // invalid negative weight triggers engine ValidationError
            { id: 'latency', name: 'Latency', weight: 80, direction: 'cost' },
            { id: 'security', name: 'Security', weight: 70, direction: 'benefit' },
          ],
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { confirmation: true, expectedVersion: 1 },
      });

      // The evaluation failed and was caught by compensation logic
      expect(res.statusCode).toBeGreaterThanOrEqual(400);

      // Inspect Decision in DB:
      // Monotonic compensation rule: Version MUST NOT be rolled back or decremented.
      // Version was mutated to 2, then compensating rollback advanced it to 3 (targetVersion + 1).
      const compensatedDecision = await DecisionModel.findById(decisionId);
      expect(compensatedDecision).not.toBeNull();
      expect(compensatedDecision!.version).toBe(3);

      // Analysis cleared
      expect(compensatedDecision!.analysis).toBeNull();

      // Pending operation cleared
      expect(compensatedDecision!.pendingOperationId).toBeNull();

      // Verify compensation audit event recorded
      const compAudit = await AuditEventModel.findOne({
        decisionId,
        summary: { $regex: /compensat/i },
      });
      expect(compAudit).not.toBeNull();
      expect(compAudit?.summary).toContain('Compensating rollback');

      // Stale client holding version 1 or 2 receives 409 Conflict
      const staleRes = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          ...baseDecisionPayload,
          expectedVersion: 1,
        },
      });
      expect(staleRes.statusCode).toBe(409);
    });
  });
});
