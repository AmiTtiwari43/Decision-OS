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
import { DecisionEvidenceModel } from '../src/models/evidence.model.js';

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

describe('Phase 8 — Evidence and Provenance Subsystem', () => {
  let app: FastifyInstance;

  // Users:
  // User Alpha: Owner
  let ownerToken: string;
  const ownerEmail = 'owner-p8@example.com';

  // User Beta: Contributor Expert
  let expertToken: string;
  let expertId: string;
  const expertEmail = 'expert-p8@example.com';

  // User Gamma: Collaborator Editor
  let editorToken: string;
  const editorEmail = 'editor-p8@example.com';

  // User Delta: Viewer
  let viewerToken: string;
  const viewerEmail = 'viewer-p8@example.com';

  // User Epsilon: Unrelated
  let unrelatedToken: string;
  const unrelatedEmail = 'unrelated-p8@example.com';

  let decisionId: string;
  let contributionId: string;

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
    await DecisionEvidenceModel.deleteMany({});
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
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
      payload: { email: ownerEmail, password: 'Password123!', name: 'Owner Alpha' },
    });
    ownerToken = resOwner.json().token;

    // 2. Register Expert Contributor
    const resExpert = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: expertEmail, password: 'Password123!', name: 'Expert Beta' },
    });
    expertToken = resExpert.json().token;
    expertId = resExpert.json().user.id;

    // 3. Register Editor
    const resEditor = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: editorEmail, password: 'Password123!', name: 'Editor Gamma' },
    });
    editorToken = resEditor.json().token;

    // 4. Register Viewer
    const resViewer = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: viewerEmail, password: 'Password123!', name: 'Viewer Delta' },
    });
    viewerToken = resViewer.json().token;

    // 5. Register Unrelated
    const resUnrelated = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: unrelatedEmail, password: 'Password123!', name: 'Unrelated Epsilon' },
    });
    unrelatedToken = resUnrelated.json().token;

    // Create decision owned by Owner Alpha
    const resDecision = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: baseDecisionPayload,
    });
    decisionId = resDecision.json()._id || resDecision.json().id;

    // Grant Expert Beta 'contributor' role
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

    // Grant Editor Gamma 'editor' role
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

    // Grant Viewer Delta 'viewer' role
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

    // Create an expert contribution for testing contribution target attachment
    const contribRes = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions`,
      headers: { authorization: `Bearer ${expertToken}` },
      payload: { preferredOptionId: 'aws', criterionScores: { cost: 75, perf: 95 } },
    });
    contributionId = contribRes.json().id;
  });

  // ─── 1. AUTHENTICATION & ACCESS BOUNDARIES ───────────────────────────────────

  describe('Authentication & Access Boundaries', () => {
    it('rejects unauthenticated requests to evidence endpoints with 401', async () => {
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence`,
      });
      expect(getRes.statusCode).toBe(401);

      const postRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        payload: {
          targetType: 'option',
          targetId: 'aws',
          type: 'excerpt',
          title: 'Unauthenticated note',
        },
      });
      expect(postRes.statusCode).toBe(401);
    });

    it('rejects unrelated users with 404 (enumeration defense)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toContain('Decision');
    });

    it('rejects viewers from creating evidence with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          targetType: 'option',
          targetId: 'aws',
          type: 'excerpt',
          title: 'Viewer assertion',
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Viewers are not permitted');
    });
  });

  // ─── 2. CREATION, PROVENANCE & TARGET VALIDATION ────────────────────────────

  describe('Creation, Provenance & Target Validation', () => {
    it('allows contributor to attach evidence to an option with full provenance', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          targetType: 'option',
          targetId: 'aws',
          type: 'url',
          title: 'AWS Benchmarking Report',
          sourceUrl: 'https://aws.amazon.com/ec2/pricing/',
          sourceExcerpt: 'Graviton4 provides 30% lower cost per transaction.',
          userSummary: 'Supports higher cost efficiency for AWS workloads.',
          publicationDate: '2026-03-01T00:00:00.000Z',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.targetType).toBe('option');
      expect(data.targetId).toBe('aws');
      expect(data.type).toBe('url');
      expect(data.title).toBe('AWS Benchmarking Report');
      expect(data.sourceUrl).toBe('https://aws.amazon.com/ec2/pricing/');
      expect(data.sourceExcerpt).toBe('Graviton4 provides 30% lower cost per transaction.');
      expect(data.userSummary).toBe('Supports higher cost efficiency for AWS workloads.');
      expect(data.createdById).toBe(expertId);
      expect(data.provenance.createdByName).toBe('Expert Beta');
      expect(data.provenance.createdByEmail).toBe(expertEmail);
      expect(data.provenance.capturedVia).toBe('web_link');
    });

    it('allows attaching evidence to a criterion', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'criterion',
          targetId: 'cost',
          type: 'document',
          title: 'Corporate Budgeting Guidelines FY26',
          documentReference: 'Policy Doc #402, Sec. 3.1',
          sourceExcerpt: 'Cloud expenditure must not exceed 15% of engineering budget.',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().targetType).toBe('criterion');
      expect(res.json().targetId).toBe('cost');
      expect(res.json().provenance.capturedVia).toBe('document_citation');
    });

    it('allows attaching evidence to an expert contribution', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          targetType: 'contribution',
          targetId: contributionId,
          type: 'excerpt',
          title: 'Expert Interview Notes',
          sourceExcerpt: 'Chief Architect recommended AWS due to VPC peering stability.',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().targetType).toBe('contribution');
      expect(res.json().targetId).toBe(contributionId);
    });

    it('rejects invalid option references with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'option',
          targetId: 'azure-nonexistent',
          type: 'excerpt',
          title: 'Phantom cloud test',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Option 'azure-nonexistent' does not exist");
    });

    it('rejects invalid criterion references with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'criterion',
          targetId: 'security-nonexistent',
          type: 'excerpt',
          title: 'Phantom criterion test',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Criterion 'security-nonexistent' does not exist");
    });

    it('rejects contribution references that belong to a different decision with 400', async () => {
      // Create a second decision owned by owner
      const resDec2 = await app.inject({
        method: 'POST',
        url: '/api/decisions',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: baseDecisionPayload,
      });
      const dec2Id = resDec2.json()._id;

      // Try to attach dec1 contribution to dec2
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${dec2Id}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'contribution',
          targetId: contributionId,
          type: 'excerpt',
          title: 'Cross-decision reference attempt',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('does not exist in this decision');
    });
  });

  // ─── 3. URL SCHEME SAFETY & SSRF DEFENSE ────────────────────────────────────

  describe('URL Scheme Safety & Input Validation', () => {
    it('rejects unsafe javascript: URLs with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          type: 'url',
          title: 'XSS Attempt',
          sourceUrl: 'javascript:alert(1)',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("must use 'http://' or 'https://'");
    });

    it('rejects data: URLs with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          type: 'url',
          title: 'Data URI Attempt',
          sourceUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("must use 'http://' or 'https://'");
    });

    it('rejects file: and ftp: URLs with 400', async () => {
      const resFile = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          type: 'url',
          title: 'Local File Attempt',
          sourceUrl: 'file:///etc/passwd',
        },
      });
      expect(resFile.statusCode).toBe(400);

      const resFtp = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          type: 'url',
          title: 'FTP Attempt',
          sourceUrl: 'ftp://ftp.example.com/file.txt',
        },
      });
      expect(resFtp.statusCode).toBe(400);
    });

    it('requires sourceUrl when type is "url"', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          type: 'url',
          title: 'Missing URL',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('sourceUrl is required');
    });
  });

  // ─── 4. MASS ASSIGNMENT & CREATOR SPOOFING ──────────────────────────────────

  describe('Mass Assignment & Creator Spoofing Protection', () => {
    it('ignores client-supplied createdById, decisionId, and provenance override', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          targetType: 'option',
          targetId: 'aws',
          type: 'excerpt',
          title: 'Spoof Test',
          createdById: '65f1a2b3c4d5e6f7a8b9c0d1',
          decisionId: '65f1a2b3c4d5e6f7a8b9c0d2',
          provenance: {
            createdByName: 'Admin Overlord',
            createdByEmail: 'admin@gov.org',
            capturedVia: 'manual_entry',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.createdById).toBe(expertId);
      expect(data.decisionId).toBe(decisionId);
      expect(data.provenance.createdByName).toBe('Expert Beta');
      expect(data.provenance.createdByEmail).toBe(expertEmail);
    });
  });

  // ─── 5. LISTING, FILTERING & RETRIEVAL ──────────────────────────────────────

  describe('Listing, Filtering & Retrieval', () => {
    beforeEach(async () => {
      // Create 3 evidence records: 1 on option 'aws', 1 on option 'gcp', 1 on decision
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'option',
          targetId: 'aws',
          type: 'excerpt',
          title: 'AWS Evidence',
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'option',
          targetId: 'gcp',
          type: 'excerpt',
          title: 'GCP Evidence',
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          type: 'excerpt',
          title: 'Overall Decision Rationale',
        },
      });
    });

    it('lists all evidence for decision', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBe(3);
    });

    it('filters evidence by targetType and targetId', async () => {
      const resAws = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence?targetType=option&targetId=aws`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(resAws.statusCode).toBe(200);
      expect(resAws.json().items.length).toBe(1);
      expect(resAws.json().items[0].title).toBe('AWS Evidence');

      const resDecision = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence?targetType=decision`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(resDecision.statusCode).toBe(200);
      expect(resDecision.json().items.length).toBe(1);
      expect(resDecision.json().items[0].title).toBe('Overall Decision Rationale');
    });

    it('retrieves single evidence record by ID', async () => {
      const list = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      const item = list.json().items[0];

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence/${item._id || item.id}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().title).toBe(item.title);
    });
  });

  // ─── 6. UPDATE & DELETE PERMISSION CONTROLS ─────────────────────────────────

  describe('Update & Delete Permissions', () => {
    let authorEvidenceId: string;

    beforeEach(async () => {
      // Expert creates an evidence item
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          targetType: 'option',
          targetId: 'aws',
          type: 'excerpt',
          title: 'Author Editable Note',
          sourceExcerpt: 'Original excerpt.',
        },
      });
      authorEvidenceId = res.json()._id || res.json().id;
    });

    it('allows author to update their own evidence record', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/decisions/${decisionId}/evidence/${authorEvidenceId}`,
        headers: { authorization: `Bearer ${expertToken}` },
        payload: {
          title: 'Author Updated Note',
          sourceExcerpt: 'Updated excerpt.',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Author Updated Note');
      expect(res.json().sourceExcerpt).toBe('Updated excerpt.');
    });

    it('allows decision owner to update collaborator evidence record', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/decisions/${decisionId}/evidence/${authorEvidenceId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          title: 'Owner Moderated Title',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Owner Moderated Title');
    });

    it('blocks other collaborator from updating evidence with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/decisions/${decisionId}/evidence/${authorEvidenceId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          title: 'Editor Hijack Attempt',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Only the author or decision owner');
    });

    it('blocks other collaborator from deleting evidence with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/evidence/${authorEvidenceId}`,
        headers: { authorization: `Bearer ${editorToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Only the author or decision owner');
    });

    it('allows author to delete their own evidence record', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/evidence/${authorEvidenceId}`,
        headers: { authorization: `Bearer ${expertToken}` },
      });

      expect(res.statusCode).toBe(204);

      // Verify it no longer exists
      const checkRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/evidence/${authorEvidenceId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(checkRes.statusCode).toBe(404);
    });
  });

  // ─── 7. CANONICAL MCDA ENGINE ISOLATION & CASCADE ───────────────────────────

  describe('Canonical Engine Isolation & Cascade Deletion', () => {
    it('evidence operations do NOT alter authoritative decision inputs or results', async () => {
      const beforeDoc = await DecisionModel.findById(decisionId);
      const initialWinner = beforeDoc?.analysis?.winnerId;
      const initialScores = beforeDoc?.scores;

      // Create evidence
      const addRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'option',
          targetId: 'gcp',
          type: 'url',
          title: 'GCP Whitepaper',
          sourceUrl: 'https://cloud.google.com/whitepapers',
        },
      });
      const evidId = addRes.json()._id || addRes.json().id;

      // Verify decision is completely untouched
      const afterAdd = await DecisionModel.findById(decisionId);
      expect(afterAdd?.scores).toEqual(initialScores);
      expect(afterAdd?.analysis?.winnerId).toEqual(initialWinner);

      // Update evidence
      await app.inject({
        method: 'PATCH',
        url: `/api/decisions/${decisionId}/evidence/${evidId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { title: 'Updated Title' },
      });

      const afterUpdate = await DecisionModel.findById(decisionId);
      expect(afterUpdate?.scores).toEqual(initialScores);
      expect(afterUpdate?.analysis?.winnerId).toEqual(initialWinner);

      // Delete evidence
      await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/evidence/${evidId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      const afterDelete = await DecisionModel.findById(decisionId);
      expect(afterDelete?.scores).toEqual(initialScores);
      expect(afterDelete?.analysis?.winnerId).toEqual(initialWinner);
    });

    it('cascades deletion of evidence when decision is deleted', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/evidence`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'option',
          targetId: 'aws',
          type: 'excerpt',
          title: 'Evidence to cascade',
        },
      });

      // Confirm evidence exists
      const before = await DecisionEvidenceModel.find({ decisionId });
      expect(before.length).toBeGreaterThan(0);

      // Delete decision
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(deleteRes.statusCode).toBe(204);

      // Confirm all evidence linked to this decision is cleaned up
      const after = await DecisionEvidenceModel.find({ decisionId });
      expect(after.length).toBe(0);
    });
  });
});

