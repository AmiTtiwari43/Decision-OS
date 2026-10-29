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

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

const baseDecisionPayload = {
  title: 'Cloud Architecture Choice',
  description: 'Evaluate compute platforms',
  criteria: [
    { id: 'cost', name: 'Cost', weight: 50, direction: 'benefit' as const },
    { id: 'perf', name: 'Performance', weight: 50, direction: 'benefit' as const },
  ],
  options: [
    { id: 'aws', name: 'AWS Cloud' },
    { id: 'gcp', name: 'Google Cloud' },
  ],
  scores: {
    aws: { cost: 80, perf: 90 },
    gcp: { cost: 85, perf: 85 },
  },
};

describe('Phase 7 — Expert Contributions & Deliberation Lifecycle', () => {
  let app: FastifyInstance;

  // Users:
  // User Alpha: Owner
  let ownerToken: string;
  const ownerEmail = 'owner@example.com';

  // User Beta: Contributor Expert
  let expertToken: string;
  let expertId: string;
  const expertEmail = 'expert@example.com';

  // User Gamma: Viewer
  let viewerToken: string;
  const viewerEmail = 'viewer@example.com';

  // User Delta: Unrelated
  let unrelatedToken: string;
  const unrelatedEmail = 'unrelated@example.com';

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
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await DecisionContributionModel.deleteMany({});

    // 1. Register Owner
    const resOwner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: ownerEmail, password: 'Password123!', name: 'Owner Alpha' },
    });
    const bodyOwner = resOwner.json();
    ownerToken = bodyOwner.token;

    // 2. Register Expert Contributor
    const resExpert = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: expertEmail, password: 'Password123!', name: 'Expert Beta' },
    });
    const bodyExpert = resExpert.json();
    expertToken = bodyExpert.token;
    expertId = bodyExpert.user.id;

    // 3. Register Viewer
    const resViewer = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: viewerEmail, password: 'Password123!', name: 'Viewer Gamma' },
    });
    const bodyViewer = resViewer.json();
    viewerToken = bodyViewer.token;

    // 4. Register Unrelated
    const resUnrelated = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: unrelatedEmail, password: 'Password123!', name: 'Unrelated Delta' },
    });
    const bodyUnrelated = resUnrelated.json();
    unrelatedToken = bodyUnrelated.token;

    // Create decision owned by Owner Alpha
    const resDecision = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: baseDecisionPayload,
    });
    decisionId = resDecision.json()._id || resDecision.json().id;

    // Invite and grant Expert Beta 'contributor' role
    const inviteExpert = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: expertEmail, role: 'contributor' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/invitations/accept',
      headers: { authorization: `Bearer ${expertToken}` },
      payload: { token: inviteExpert.json().token },
    });

    // Invite and grant Viewer Gamma 'viewer' role
    const inviteViewer = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: viewerEmail, role: 'viewer' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/invitations/accept',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { token: inviteViewer.json().token },
    });
  });

  // ─── 1. AUTHENTICATION & ACCESS BOUNDARIES ───────────────────────────────────

  describe('Authentication & Access Boundaries', () => {
    it('rejects unauthenticated requests to contribution routes with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        payload: { preferredOptionId: 'aws' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects unrelated users with 404 (enumeration defense)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
        payload: { preferredOptionId: 'aws' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects viewers from submitting contributions with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { preferredOptionId: 'aws' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Viewers are not permitted to submit contributions');
    });

    it('derives contributorId strictly from authenticated token, ignoring spoofed body', async () => {
      const spoofedId = '660000000000000000000099';
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          contributorId: spoofedId,
        },
      });

      expect(res.statusCode).toBe(200);
      const contribution = await DecisionContributionModel.findOne({ decisionId });
      expect(contribution).not.toBeNull();
      expect(contribution?.contributorId.toString()).toBe(expertId);
      expect(contribution?.contributorId.toString()).not.toBe(spoofedId);
    });
  });

  // ─── 2. INPUT VALIDATION & CONSTRAINTS ──────────────────────────────────────

  describe('Validation & Decision Entity Constraints', () => {
    it('rejects preferredOptionId that does not exist in the decision with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { preferredOptionId: 'azure-cloud' }, // Nonexistent option
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Option 'azure-cloud' does not exist in this decision");
    });

    it('rejects criterionScores keys that do not exist in the decision with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          criterionScores: { cost: 80, security: 95 }, // 'security' is not a criterion in decision
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Criterion 'security' does not exist in this decision");
    });

    it('rejects criterion scores outside [0, 100] or non-finite numbers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          criterionScores: { cost: 150 }, // > 100
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Score cannot exceed 100');
    });

    it('rejects confidence outside [0, 1]', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          confidence: 2.5,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Confidence must be between 0 and 1');
    });
  });

  // ─── 3. CONTRIBUTION LIFECYCLE & REVISION HISTORY ───────────────────────────

  describe('Lifecycle: Draft, Submit, Revise, and Withdraw', () => {
    it('saves draft, updates draft, submits with revision 1, and withdraws', async () => {
      // 1. Save initial draft
      const draft1 = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          rationale: 'AWS has superior ecosystem maturity.',
          confidence: 0.9,
          criterionScores: { cost: 75, perf: 95 },
          criterionReasoning: { cost: 'Slightly more expensive', perf: 'Exceptional compute speed' },
        },
      });

      expect(draft1.statusCode).toBe(200);
      expect(draft1.json().status).toBe('draft');
      expect(draft1.json().revision).toBe(1);

      // 2. Contributor inspects their own contribution
      const mineRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/contributions/mine`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(mineRes.statusCode).toBe(200);
      expect(mineRes.json().item.recommendation.preferredOptionId).toBe('aws');
      expect(mineRes.json().item.status).toBe('draft');

      // 3. Submit contribution
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe('submitted');
      expect(submitRes.json().revision).toBe(1);
      expect(submitRes.json().history.length).toBe(0);

      // 4. Revise submission: save update and submit again -> revision 2 with history
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'gcp',
          rationale: 'Re-evaluated GCP pricing advantages.',
          confidence: 0.95,
          criterionScores: { cost: 90, perf: 85 },
        },
      });

      const reviseRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(reviseRes.statusCode).toBe(200);
      expect(reviseRes.json().status).toBe('submitted');
      expect(reviseRes.json().revision).toBe(2);
      expect(reviseRes.json().history.length).toBe(1);
      expect(reviseRes.json().history[0].recommendation.preferredOptionId).toBe('aws');

      // 5. Withdraw contribution
      const withdrawRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/withdraw`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(withdrawRes.statusCode).toBe(200);
      expect(withdrawRes.json().status).toBe('withdrawn');
    });
  });

  // ─── 4. DELIBERATION LOCK ROUND & OWNER POWERS ──────────────────────────────

  describe('Deliberation Round Lock & Unlock', () => {
    it('allows owner to lock round; prevents contributors from saving or submitting while locked', async () => {
      // 1. Expert creates a draft
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { preferredOptionId: 'aws' },
      });

      // 2. Non-owner attempts to lock round -> 403 Forbidden
      const expertLock = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/lock`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(expertLock.statusCode).toBe(403);

      // 3. Owner locks the round -> 200 OK
      const ownerLock = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/lock`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(ownerLock.statusCode).toBe(200);
      expect(ownerLock.json().isContributionRoundLocked).toBe(true);

      // 4. Expert attempts to edit draft while locked -> 403 Forbidden
      const editAttempt = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { preferredOptionId: 'gcp' },
      });
      expect(editAttempt.statusCode).toBe(403);
      expect(editAttempt.json().message).toContain('locked');

      // 5. Expert attempts to submit while locked -> 403 Forbidden
      const submitAttempt = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(submitAttempt.statusCode).toBe(403);

      // 6. Owner unlocks the round -> 200 OK
      const ownerUnlock = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/unlock`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(ownerUnlock.statusCode).toBe(200);
      expect(ownerUnlock.json().isContributionRoundLocked).toBe(false);

      // 7. Expert can now submit
      const postUnlockSubmit = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(postUnlockSubmit.statusCode).toBe(200);
    });
  });

  // ─── 5. MCDA ENGINE PROTECTION & EXPLICIT SCORE ADOPTION ────────────────────

  describe('Canonical MCDA Engine Protection & Score Adoption', () => {
    it('submitting an expert contribution does NOT alter authoritative decision inputs or results', async () => {
      // Fetch initial decision analysis
      const initialDoc = await DecisionModel.findById(decisionId);
      const initialWinner = initialDoc?.analysis?.winnerId;
      const initialAwsScores = initialDoc?.scores?.aws;

      // Expert submits scores differing significantly from owner scores
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          criterionScores: { cost: 10, perf: 20 },
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });

      // Verify decision doc is unchanged
      const afterDoc = await DecisionModel.findById(decisionId);
      expect(afterDoc?.scores?.aws).toEqual(initialAwsScores);
      expect(afterDoc?.analysis?.winnerId).toEqual(initialWinner);
    });

    it('allows owner to explicitly adopt expert scores into decision model, updating MCDA deterministically', async () => {
      // 1. Expert submits scores
      const saveRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'gcp',
          criterionScores: { cost: 99, perf: 99 },
        },
      });
      const contributionId = saveRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });

      // 2. Non-owner cannot adopt -> 403 Forbidden
      const expertAdopt = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(expertAdopt.statusCode).toBe(403);

      // 3. Owner adopts expert scores
      const adoptRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/${contributionId}/adopt`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(adoptRes.statusCode).toBe(200);

      // 4. Decision score matrix now reflects the adopted values
      const updatedDecision = await DecisionModel.findById(decisionId);
      expect(updatedDecision?.scores?.gcp?.cost).toBe(99);
      expect(updatedDecision?.scores?.gcp?.perf).toBe(99);
      expect(updatedDecision?.analysis?.winnerId).toBe('gcp');
    });
  });

  // ─── 6. PRIVACY & CASCADE CLEANUP ───────────────────────────────────────────

  describe('Draft Privacy & Cascade Deletion', () => {
    it('hides unsubmitted drafts of one contributor from other collaborators in listings', async () => {
      // Expert creates draft (NOT submitted)
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { preferredOptionId: 'aws', rationale: 'Top secret draft' },
      });

      // Viewer lists contributions -> draft is not returned
      const viewerList = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(viewerList.statusCode).toBe(200);
      expect(viewerList.json().items.length).toBe(0);

      // Expert lists contributions -> expert can see their own draft
      const expertList = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(expertList.statusCode).toBe(200);
      expect(expertList.json().items.length).toBe(1);
    });

    it('cascades deletion of contributions when decision is deleted', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { preferredOptionId: 'aws' },
      });

      // Owner deletes decision
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(deleteRes.statusCode).toBe(204);

      // Verify contributions collection is cleaned up
      const remaining = await DecisionContributionModel.find({ decisionId });
      expect(remaining.length).toBe(0);
    });
  });

  // ─── 7. ADVERSARIAL SECURITY, PROTECTED FIELDS & CONCURRENCY ─────────────────

  describe('Adversarial Security, Protected Fields & Concurrency', () => {
    it('rejects mass assignment of protected fields (status, revision, history, submittedAt, contributorId)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          preferredOptionId: 'aws',
          status: 'submitted',
          revision: 99,
          history: [{ revision: 10 }],
          submittedAt: new Date().toISOString(),
          contributorId: '65f1a2b3c4d5e6f7a8b9c0d1',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('draft');
      expect(data.revision).toBe(1);
      expect(data.history.length).toBe(0);
      expect(data.submittedAt).toBeNull();
      expect(data.contributorId.id || data.contributorId._id || data.contributorId).toBe(expertId);
    });

    it('prevents withdrawal when contribution round is locked', async () => {
      // 1. Submit contribution
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { preferredOptionId: 'aws' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });

      // 2. Owner locks round
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/lock`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      // 3. Expert attempts to withdraw -> 403 Forbidden
      const withdrawBlocked = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/withdraw`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(withdrawBlocked.statusCode).toBe(403);
      expect(withdrawBlocked.json().message).toContain('locked');

      // 4. Owner unlocks round -> expert successfully withdraws
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/unlock`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      const withdrawAllowed = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/withdraw`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(withdrawAllowed.statusCode).toBe(200);
      expect(withdrawAllowed.json().status).toBe('withdrawn');
    });

    it('handles duplicate repeated submissions and withdrawals idempotently', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: { preferredOptionId: 'aws' },
      });

      // Submit once
      const submit1 = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(submit1.statusCode).toBe(200);
      expect(submit1.json().status).toBe('submitted');
      expect(submit1.json().revision).toBe(1);

      // Submit again (idempotent)
      const submit2 = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/submit`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(submit2.statusCode).toBe(200);
      expect(submit2.json().status).toBe('submitted');
      expect(submit2.json().revision).toBe(1);
      expect(submit2.json().history.length).toBe(0);

      // Withdraw once
      const withdraw1 = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/withdraw`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(withdraw1.statusCode).toBe(200);
      expect(withdraw1.json().status).toBe('withdrawn');

      // Withdraw again (idempotent)
      const withdraw2 = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/contributions/withdraw`,
        headers: { authorization: `Bearer ${expertToken}` },
      });
      expect(withdraw2.statusCode).toBe(200);
      expect(withdraw2.json().status).toBe('withdrawn');
    });

    it('handles concurrent saveDraft requests without violating unique compound index', async () => {
      const results = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/decisions/${decisionId}/contributions`,
          headers: { authorization: `Bearer ${expertToken}` },
          payload: { preferredOptionId: 'aws', confidence: 0.7 },
        }),
        app.inject({
          method: 'POST',
          url: `/api/decisions/${decisionId}/contributions`,
          headers: { authorization: `Bearer ${expertToken}` },
          payload: { preferredOptionId: 'aws', confidence: 0.8 },
        }),
        app.inject({
          method: 'POST',
          url: `/api/decisions/${decisionId}/contributions`,
          headers: { authorization: `Bearer ${expertToken}` },
          payload: { preferredOptionId: 'aws', confidence: 0.9 },
        }),
      ]);

      for (const res of results) {
        expect(res.statusCode).toBe(200);
      }

      // Exactly 1 contribution document exists
      const count = await DecisionContributionModel.countDocuments({
        decisionId,
        contributorId: expertId,
      });
      expect(count).toBe(1);
    });
  });
});

