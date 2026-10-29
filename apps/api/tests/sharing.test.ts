import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { assertTestDatabase } from '../src/db/guard.js';
import { UserModel } from '../src/models/user.model.js';
import { DecisionModel } from '../src/models/decision.model.js';
import { DecisionInvitationModel } from '../src/models/invitation.model.js';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model.js';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

const baseDecisionPayload = {
  title: 'Cloud Architecture Strategy',
  description: 'Evaluate cloud compute infrastructure',
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

describe('Phase 6 — Sharing, Invitations & Permission Enforcement', () => {
  let app: FastifyInstance;

  // Users:
  // User Alpha: Decision Owner
  let ownerToken: string;
  let _ownerId: string;
  const ownerEmail = 'owner-alpha@example.com';

  // User Beta: Editor Collaborator
  let editorToken: string;
  let editorId: string;
  const editorEmail = 'editor-beta@example.com';

  // User Gamma: Viewer Collaborator
  let viewerToken: string;
  let viewerId: string;
  const viewerEmail = 'viewer-gamma@example.com';

  // User Delta: Unrelated / Attacker
  let unrelatedToken: string;
  let _unrelatedId: string;
  const unrelatedEmail = 'unrelated-delta@example.com';

  // Active test decision
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
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionInvitationModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});

    // 1. Register Owner
    const resOwner = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: ownerEmail, password: 'Password123!', name: 'Owner Alpha' },
    });
    const bodyOwner = resOwner.json();
    ownerToken = bodyOwner.token;
    _ownerId = bodyOwner.user.id;

    // 2. Register Editor
    const resEditor = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: editorEmail, password: 'Password123!', name: 'Editor Beta' },
    });
    const bodyEditor = resEditor.json();
    editorToken = bodyEditor.token;
    editorId = bodyEditor.user.id;

    // 3. Register Viewer
    const resViewer = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: viewerEmail, password: 'Password123!', name: 'Viewer Gamma' },
    });
    const bodyViewer = resViewer.json();
    viewerToken = bodyViewer.token;
    viewerId = bodyViewer.user.id;

    // 4. Register Unrelated User
    const resUnrelated = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: unrelatedEmail, password: 'Password123!', name: 'Unrelated Delta' },
    });
    const bodyUnrelated = resUnrelated.json();
    unrelatedToken = bodyUnrelated.token;
    _unrelatedId = bodyUnrelated.user.id;

    // Create a base decision owned by Owner Alpha
    const resDecision = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: baseDecisionPayload,
    });
    const bodyDecision = resDecision.json();
    decisionId = bodyDecision._id || bodyDecision.id;
  });

  // ─── 1. INVITATION CREATION & VALIDATION ────────────────────────────────────

  describe('Invitation Creation & Constraints', () => {
    it('allows decision owner to create an invitation with a secure token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toBeDefined();
      expect(body.token).toMatch(/^[0-9a-f]{64}$/i); // 32-byte hex token
      expect(body.invitationLink).toBe(`/invite?token=${body.token}`);
      expect(body.invitation).toBeDefined();
      expect(body.invitation.email).toBe(editorEmail);
      expect(body.invitation.role).toBe('editor');
      expect(body.invitation.status).toBe('pending');

      // Verify that database stores tokenHash, NOT the raw token
      const stored = await DecisionInvitationModel.findById(body.invitation.id);
      expect(stored).not.toBeNull();
      expect(stored?.tokenHash).toBeDefined();
      expect(stored?.tokenHash).not.toBe(body.token);
    });

    it('rejects invitation creation with invalid role (e.g. owner or forged role)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: 'test@example.com', role: 'owner' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Role must be either 'editor' or 'viewer'");
    });

    it('rejects invitation creation when attempting to invite the decision owner', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: ownerEmail, role: 'editor' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Cannot invite');
    });

    it('rejects duplicate active pending invitations for the same recipient', async () => {
      // First invitation
      const first = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      expect(first.statusCode).toBe(201);

      // Second duplicate invitation
      const second = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'viewer' },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().message).toContain('pending invitation already exists');
    });

    it('blocks non-owner from creating an invitation (404 for unrelated, 403 for collaborator)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
        payload: { email: 'another@example.com', role: 'viewer' },
      });

      // 404 to prevent ID enumeration
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── 2. INVITATION LISTING & TOKEN SECRECY ───────────────────────────────────

  describe('Invitation Listing & Token Secrecy', () => {
    it('lists pending invitations without exposing raw tokens or token hashes', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      const rawToken = createRes.json().token;

      const listRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(listRes.statusCode).toBe(200);
      const items = listRes.json().items;
      expect(items.length).toBe(1);
      expect(items[0].email).toBe(editorEmail);
      expect(items[0].role).toBe('editor');
      expect(items[0].status).toBe('pending');

      // Verify token secrecy
      expect(items[0].token).toBeUndefined();
      expect(items[0].tokenHash).toBeUndefined();
      expect(JSON.stringify(listRes.json())).not.toContain(rawToken);
    });
  });

  // ─── 3. INVITATION ACCEPTANCE & REDEMPTION WORKFLOW ─────────────────────────

  describe('Invitation Acceptance & Access Grant Creation', () => {
    it('successfully accepts invitation and creates active DecisionAccessGrant', async () => {
      // 1. Owner invites Editor Beta
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      const { token } = inviteRes.json();

      // 2. Editor Beta accepts the invitation
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token },
      });

      expect(acceptRes.statusCode).toBe(200);
      expect(acceptRes.json().decisionId).toBe(decisionId);
      expect(acceptRes.json().role).toBe('editor');

      // 3. Verify access grant exists in DB
      const grant = await DecisionAccessGrantModel.findOne({
        decisionId,
        userId: editorId,
      });
      expect(grant).not.toBeNull();
      expect(grant?.role).toBe('editor');

      // 4. Verify invitation status transitioned to 'accepted'
      const inv = await DecisionInvitationModel.findOne({ decisionId, email: editorEmail });
      expect(inv?.status).toBe('accepted');
      expect(inv?.acceptedBy?.toString()).toBe(editorId);
    });

    it('rejects acceptance if the authenticated user is NOT the intended recipient (403)', async () => {
      // Owner invites Editor Beta
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      const { token } = inviteRes.json();

      // Unrelated Delta attempts to accept
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${unrelatedToken}` },
        payload: { token },
      });

      expect(acceptRes.statusCode).toBe(403);
      expect(acceptRes.json().message).toContain('This invitation was issued to');
    });

    it('rejects double redemption of an already accepted invitation (409)', async () => {
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      const { token } = inviteRes.json();

      // First acceptance
      await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token },
      });

      // Second acceptance attempt
      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token },
      });

      expect(secondRes.statusCode).toBe(409);
      expect(secondRes.json().message).toContain('already been accepted');
    });

    it('rejects acceptance of an expired invitation (410)', async () => {
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      const { token } = inviteRes.json();

      // Manually backdate the expiration date
      await DecisionInvitationModel.updateOne(
        { email: editorEmail },
        { $set: { expiresAt: new Date(Date.now() - 1000 * 60) } }
      );

      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token },
      });

      expect(acceptRes.statusCode).toBe(410);
      expect(acceptRes.json().message).toContain('expired');
    });

    it('rejects acceptance of a revoked invitation (410)', async () => {
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      const { token, invitation } = inviteRes.json();

      // Owner revokes invitation
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/invitations/${invitation.id}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(revokeRes.statusCode).toBe(200);

      // Editor attempts to accept revoked invitation
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token },
      });

      expect(acceptRes.statusCode).toBe(410);
      expect(acceptRes.json().message).toContain('revoked');
    });
  });

  // ─── 4. ROLE × ACTION AUTHORIZATION MATRIX ───────────────────────────────────

  describe('Full Role × Action Authorization Matrix (Owner, Editor, Viewer, Unrelated)', () => {
    beforeEach(async () => {
      // Grant Editor Beta 'editor' role
      const inviteEditor = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token: inviteEditor.json().token },
      });

      // Grant Viewer Gamma 'viewer' role
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

    // ── READ (GET /api/decisions/:id) ──
    it('READ: Owner, Editor, and Viewer can GET; Unrelated receives 404', async () => {
      // Owner GET
      const resOwner = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resOwner.statusCode).toBe(200);
      expect(resOwner.json().currentUserRole).toBe('owner');

      // Editor GET
      const resEditor = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(resEditor.statusCode).toBe(200);
      expect(resEditor.json().currentUserRole).toBe('editor');

      // Viewer GET
      const resViewer = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(resViewer.statusCode).toBe(200);
      expect(resViewer.json().currentUserRole).toBe('viewer');

      // Unrelated GET -> 404 (Enumeration Defense)
      const resUnrelated = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
      });
      expect(resUnrelated.statusCode).toBe(404);
    });

    // ── EDIT (PUT /api/decisions/:id) ──
    it('EDIT: Owner and Editor can update; Viewer receives 403; Unrelated receives 404', async () => {
      // Owner PUT
      const resOwner = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { title: 'Updated by Owner' },
      });
      expect(resOwner.statusCode).toBe(200);

      // Editor PUT
      const resEditor = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { title: 'Updated by Editor' },
      });
      expect(resEditor.statusCode).toBe(200);

      // Viewer PUT -> 403 Forbidden
      const resViewer = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { title: 'Hacked by Viewer' },
      });
      expect(resViewer.statusCode).toBe(403);
      expect(resViewer.json().message).toContain('Viewers are not permitted');

      // Unrelated PUT -> 404
      const resUnrelated = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
        payload: { title: 'Hacked by Unrelated' },
      });
      expect(resUnrelated.statusCode).toBe(404);
    });

    // ── ANALYZE (POST /api/decisions/:id/analyze) ──
    it('ANALYZE: Owner and Editor can run analysis; Viewer receives 403; Unrelated receives 404', async () => {
      // Owner analyze
      const resOwner = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/analyze`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resOwner.statusCode).toBe(200);

      // Editor analyze
      const resEditor = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/analyze`,
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(resEditor.statusCode).toBe(200);

      // Viewer analyze -> 403 Forbidden
      const resViewer = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/analyze`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(resViewer.statusCode).toBe(403);

      // Unrelated analyze -> 404
      const resUnrelated = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/analyze`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
      });
      expect(resUnrelated.statusCode).toBe(404);
    });

    // ── DELETE (DELETE /api/decisions/:id) ──
    it('DELETE: Only Owner can delete; Editor & Viewer receive 403; Unrelated receives 404', async () => {
      // Viewer DELETE -> 403
      const resViewer = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(resViewer.statusCode).toBe(403);

      // Editor DELETE -> 403
      const resEditor = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(resEditor.statusCode).toBe(403);

      // Unrelated DELETE -> 404
      const resUnrelated = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
      });
      expect(resUnrelated.statusCode).toBe(404);

      // Owner DELETE -> 204
      const resOwner = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resOwner.statusCode).toBe(204);

      // Verify cascading deletion of grants
      const remainingGrants = await DecisionAccessGrantModel.find({ decisionId });
      expect(remainingGrants.length).toBe(0);
    });

    // ── SHARE (POST /api/decisions/:id/invitations & access management) ──
    it('SHARE: Only Owner can manage sharing; Editor & Viewer receive 403; Unrelated receives 404', async () => {
      // Viewer attempt to share -> 403
      const resViewer = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { email: 'another@example.com', role: 'viewer' },
      });
      expect(resViewer.statusCode).toBe(403);

      // Editor attempt to share -> 403
      const resEditor = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { email: 'another@example.com', role: 'viewer' },
      });
      expect(resEditor.statusCode).toBe(403);

      // Unrelated attempt to share -> 404
      const resUnrelated = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
        payload: { email: 'another@example.com', role: 'viewer' },
      });
      expect(resUnrelated.statusCode).toBe(404);
    });
  });

  // ─── 5. ACCESS REVOCATION & IMMEDIATE ENFORCEMENT ───────────────────────────

  describe('Access Grant Management & Immediate Revocation Enforcement', () => {
    it('allows owner to list access grants, update role, and revoke access immediately', async () => {
      // 1. Grant editor access to Editor Beta
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token: inviteRes.json().token },
      });

      // 2. Owner lists access
      const accessListRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/access`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(accessListRes.statusCode).toBe(200);
      const accessBody = accessListRes.json();
      expect(accessBody.owner.email).toBe(ownerEmail);
      expect(accessBody.collaborators.length).toBe(1);
      const grantId = accessBody.collaborators[0].id;

      // 3. Owner updates role to viewer
      const updateRoleRes = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}/access/${grantId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { role: 'viewer' },
      });
      expect(updateRoleRes.statusCode).toBe(200);

      // Editor Beta attempts to edit -> now gets 403 Forbidden!
      const editAttempt = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { title: 'Should fail as viewer' },
      });
      expect(editAttempt.statusCode).toBe(403);

      // 4. Owner revokes access grant
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/access/${grantId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(revokeRes.statusCode).toBe(204);

      // 5. Immediate revocation: Editor Beta now receives 404 Not Found on subsequent requests
      const getAfterRevoke = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(getAfterRevoke.statusCode).toBe(404);
    });
  });

  // ─── 6. SCOPED LISTING WITH SHARED DECISIONS ────────────────────────────────

  describe('Scoped Listings (/api/decisions)', () => {
    it('shows owned and shared decisions to collaborator, while hiding unshared decisions', async () => {
      // Create a second decision owned by Owner Alpha (NOT shared)
      const unsharedRes = await app.inject({
        method: 'POST',
        url: '/api/decisions',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { ...baseDecisionPayload, title: 'Secret Private Decision' },
      });
      const unsharedId = unsharedRes.json()._id;

      // Share the first decision with Editor Beta
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { token: inviteRes.json().token },
      });

      // Editor Beta lists decisions
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/decisions',
        headers: { authorization: `Bearer ${editorToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const items = listRes.json().items;

      const itemIds = items.map((i: { _id?: string; id?: string }) => i._id || i.id);
      expect(itemIds).toContain(decisionId);
      expect(itemIds).not.toContain(unsharedId); // Unshared private decision strictly hidden!
    });
  });

  // ─── 7. ADVERSARIAL & CONCURRENCY ATTACK SCENARIOS ──────────────────────────

  describe('Adversarial & Concurrency Scenarios', () => {
    it('Scenario 8: Concurrent requests to redeem the same token only allow 1 winner', async () => {
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: editorEmail, role: 'editor' },
      });
      const { token } = inviteRes.json();

      // Launch 2 concurrent acceptance requests
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/invitations/accept',
          headers: { authorization: `Bearer ${editorToken}` },
          payload: { token },
        }),
        app.inject({
          method: 'POST',
          url: '/api/invitations/accept',
          headers: { authorization: `Bearer ${editorToken}` },
          payload: { token },
        }),
      ]);

      const statusCodes = [res1.statusCode, res2.statusCode].sort();
      expect(statusCodes).toEqual([200, 409]); // Exactly one 200 and one 409!

      // Only one grant created
      const grantCount = await DecisionAccessGrantModel.countDocuments({
        decisionId,
        userId: editorId,
      });
      expect(grantCount).toBe(1);
    });

    it('Scenario 9: Recipient cannot escalate role during acceptance', async () => {
      // Owner invites with 'viewer' role
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/invitations`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: viewerEmail, role: 'viewer' },
      });
      const { token } = inviteRes.json();

      // Recipient tries to inject "role": "editor" or "role": "owner"
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/invitations/accept',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { token, role: 'editor', privilege: 'admin' },
      });

      expect(acceptRes.statusCode).toBe(200);
      expect(acceptRes.json().role).toBe('viewer'); // Strictly viewer!

      const grant = await DecisionAccessGrantModel.findOne({ decisionId, userId: viewerId });
      expect(grant?.role).toBe('viewer');
    });

    it('Scenario 12: Submitting a forged access-grant ID returns 404', async () => {
      const fakeGrantId = '654321654321654321654321';
      const res = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decisionId}/access/${fakeGrantId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { role: 'viewer' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
