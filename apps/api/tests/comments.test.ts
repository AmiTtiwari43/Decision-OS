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
import { CommentModel } from '../src/models/comment.model.js';

const TEST_MONGODB_URI = getTestDatabaseUri();

assertTestDatabase(TEST_MONGODB_URI);

const baseDecisionPayload = {
  title: 'Cloud Database Architecture',
  description: 'Evaluate managed databases',
  criteria: [
    { id: 'cost', name: 'Cost', weight: 40, direction: 'benefit' as const },
    { id: 'perf', name: 'Performance', weight: 60, direction: 'benefit' as const },
  ],
  options: [
    { id: 'atlas', name: 'MongoDB Atlas' },
    { id: 'dynamo', name: 'DynamoDB' },
  ],
  scores: {
    atlas: { cost: 80, perf: 90 },
    dynamo: { cost: 70, perf: 85 },
  },
};

describe('Phase 1 — Deliberation Comment Threads & Privacy Hardening', () => {
  let app: FastifyInstance;

  let ownerToken: string;
  let ownerId: string;
  const ownerEmail = 'owner-comments@example.com';

  let editorToken: string;
  let editorId: string;
  const editorEmail = 'editor-comments@example.com';

  let contributorToken: string;
  let contributorId: string;
  const contributorEmail = 'contrib-comments@example.com';

  let viewerToken: string;
  const viewerEmail = 'viewer-comments@example.com';

  let unrelatedToken: string;
  const unrelatedEmail = 'unrelated-comments@example.com';

  let decisionId: string;
  let otherDecisionId: string;
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
    await CommentModel.deleteMany({});
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

    // Register Users
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

    const resContrib = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: contributorEmail, password: 'Password123!', name: 'Contributor User' },
    });
    contributorToken = resContrib.json().token;
    contributorId = resContrib.json().user.id;

    const resViewer = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: viewerEmail, password: 'Password123!', name: 'Viewer User' },
    });
    viewerToken = resViewer.json().token;

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

    // Create another decision for cross-boundary testing
    const resOtherDec = await app.inject({
      method: 'POST',
      url: '/api/decisions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...baseDecisionPayload, title: 'Another Decision' },
    });
    otherDecisionId = resOtherDec.json().id;

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
      userId: contributorId,
      role: 'contributor',
      grantedBy: ownerId,
    });

    // Grant Viewer access
    await DecisionAccessGrantModel.create({
      decisionId,
      userId: resViewer.json().user.id,
      role: 'viewer',
      grantedBy: ownerId,
    });

    // Contributor creates and submits a contribution
    const resContribDoc = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions`,
      headers: { authorization: `Bearer ${contributorToken}` },
      payload: {
        preferredOptionId: 'atlas',
        criterionScores: { cost: 85, perf: 95 },
      },
    });
    contributionId = resContribDoc.json().id;

    await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisionId}/contributions/submit`,
      headers: { authorization: `Bearer ${contributorToken}` },
    });
  });

  // ─── 1. AUTHENTICATION & ACCESS BOUNDARIES ───────────────────────────────────

  describe('Authentication & Access Boundaries', () => {
    it('rejects unauthenticated requests to comment endpoints with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/comments`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects unrelated users with 404 (enumeration defense)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects viewers from creating comments with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Viewers should not be able to comment',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows viewer to read comments', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().items)).toBe(true);
    });
  });

  // ─── 2. COMMENT CREATION, TARGET VALIDATION & PRIVACY ────────────────────────

  describe('Creation, Target Validation & Privacy', () => {
    it('allows contributor to create root comment on decision with full metadata', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Let us consider database scaling needs early.',
        },
      });

      expect(res.statusCode).toBe(201);
      const comment = res.json();
      expect(comment.id).toBeDefined();
      expect(comment.authorId).toBe(contributorId);
      expect(comment.authorRole).toBe('contributor');
      expect(comment.authorName).toBe('Contributor User');
      expect(comment.targetType).toBe('decision');
      expect(comment.content).toBe('Let us consider database scaling needs early.');
      expect(comment.replyCount).toBe(0);
      expect(comment.isResolved).toBe(false);
      expect(comment.isDeleted).toBe(false);

      // CRITICAL PRIVACY INVARIANT: authorEmail must NEVER be returned
      expect(comment.authorEmail).toBeUndefined();
    });

    it('guarantees authorEmail is never persisted in MongoDB database document', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Privacy check comment',
        },
      });
      expect(res.statusCode).toBe(201);
      const commentId = res.json().id;

      const rawDoc = await CommentModel.findById(commentId).lean();
      expect((rawDoc as Record<string, unknown>).authorEmail).toBeUndefined();
    });

    it('allows creating comments on options, criteria, cells, and contributions', async () => {
      // 1. Option comment
      const optRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'option',
          targetId: 'atlas',
          content: 'Atlas handles auto-sharding well.',
        },
      });
      expect(optRes.statusCode).toBe(201);

      // 2. Criterion comment
      const critRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'criterion',
          targetId: 'cost',
          content: 'Cost is sensitive to egress traffic.',
        },
      });
      expect(critRes.statusCode).toBe(201);

      // 3. Cell comment
      const cellRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'cell',
          targetId: 'atlas:cost',
          cellCoordinates: { optionId: 'atlas', criterionId: 'cost' },
          content: 'Why was cost scored 80 here?',
        },
      });
      expect(cellRes.statusCode).toBe(201);
      expect(cellRes.json().cellCoordinates).toEqual({ optionId: 'atlas', criterionId: 'cost' });

      // 4. Contribution comment
      const contribRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          targetType: 'contribution',
          targetId: contributionId,
          content: 'Strong expert rationale on performance.',
        },
      });
      expect(contribRes.statusCode).toBe(201);
    });

    it('rejects non-existent option, criterion, or cell references with 400', async () => {
      const badOpt = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'option',
          targetId: 'non-existent-option',
          content: 'Invalid target option',
        },
      });
      expect(badOpt.statusCode).toBe(400);

      const badCrit = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'criterion',
          targetId: 'non-existent-criterion',
          content: 'Invalid target criterion',
        },
      });
      expect(badCrit.statusCode).toBe(400);

      const badCell = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'cell',
          targetId: 'cell',
          cellCoordinates: { optionId: 'atlas', criterionId: 'non-existent-crit' },
          content: 'Invalid cell',
        },
      });
      expect(badCell.statusCode).toBe(400);
    });
  });

  // ─── 3. REPLY INVARIANTS, NESTING LIMIT & TARGET CONGRUENCY ──────────────────

  describe('Reply Invariants, Nesting Limit & Target Congruency', () => {
    let rootCommentId: string;

    beforeEach(async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'cell',
          targetId: 'atlas:perf',
          cellCoordinates: { optionId: 'atlas', criterionId: 'perf' },
          content: 'Root question: Can Atlas hit 100k IOPS?',
        },
      });
      rootCommentId = res.json().id;
    });

    it('allows reply pointing to root comment and increments root replyCount', async () => {
      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          parentCommentId: rootCommentId,
          content: 'Yes, with NVMe clusters IOPS can exceed 100k.',
        },
      });

      expect(replyRes.statusCode).toBe(201);
      const reply = replyRes.json();
      expect(reply.parentCommentId).toBe(rootCommentId);
      expect(reply.targetType).toBe('cell');
      expect(reply.cellCoordinates).toEqual({ optionId: 'atlas', criterionId: 'perf' });

      // Verify root comment reply count incremented
      const rootDoc = await CommentModel.findById(rootCommentId);
      expect(rootDoc?.replyCount).toBe(1);
    });

    it('strictly prohibits nested replies deeper than 1 level (depth = 1)', async () => {
      // 1. Create valid reply (depth 1)
      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          parentCommentId: rootCommentId,
          content: 'First level reply.',
        },
      });
      expect(replyRes.statusCode).toBe(201);
      const replyId = replyRes.json().id;

      // 2. Attempt reply to reply (depth 2) -> MUST be rejected with 400
      const nestedRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          parentCommentId: replyId,
          content: 'Nested reply to reply should fail.',
        },
      });

      expect(nestedRes.statusCode).toBe(400);
      expect(nestedRes.json().message).toContain('Replies cannot be nested deeper than 1 level');
    });

    it('rejects cross-decision reply attempts with 400', async () => {
      // Attempt to reply on otherDecisionId pointing to rootCommentId on decisionId
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${otherDecisionId}/comments`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          parentCommentId: rootCommentId,
          content: 'Cross decision parent attempt.',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Parent comment does not belong to this decision');
    });

    it('rejects mismatched target references in replies with 400', async () => {
      // Root is cell atlas:perf; try to pass targetType: 'option'
      const mismatchType = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          parentCommentId: rootCommentId,
          targetType: 'option',
          targetId: 'atlas',
          content: 'Mismatched targetType attempt',
        },
      });
      expect(mismatchType.statusCode).toBe(400);
      expect(mismatchType.json().message).toContain('Reply targetType does not match root comment');

      // Try to pass differing cellCoordinates
      const mismatchCell = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          parentCommentId: rootCommentId,
          targetType: 'cell',
          cellCoordinates: { optionId: 'atlas', criterionId: 'cost' },
          content: 'Mismatched cellCoordinates attempt',
        },
      });
      expect(mismatchCell.statusCode).toBe(400);
      expect(mismatchCell.json().message).toContain('Reply cellCoordinates do not match root comment');
    });
  });

  // ─── 4. THREAD RESOLUTION LIFECYCLE ──────────────────────────────────────────

  describe('Thread Resolution Lifecycle', () => {
    let rootCommentId: string;
    let replyCommentId: string;

    beforeEach(async () => {
      const rootRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Does our SLA support this?',
        },
      });
      rootCommentId = rootRes.json().id;

      const replyRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          parentCommentId: rootCommentId,
          content: 'Yes, 99.99% SLA is confirmed.',
        },
      });
      replyCommentId = replyRes.json().id;
    });

    it('allows decision owner or editor to resolve a root comment thread', async () => {
      // Editor resolves
      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments/${rootCommentId}/resolve`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { isResolved: true },
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolvedDoc = resolveRes.json();
      expect(resolvedDoc.isResolved).toBe(true);
      expect(resolvedDoc.resolvedBy.id).toBe(editorId);
      expect(resolvedDoc.resolvedAt).toBeDefined();

      // Owner reopens
      const reopenRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments/${rootCommentId}/resolve`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { isResolved: false },
      });

      expect(reopenRes.statusCode).toBe(200);
      expect(reopenRes.json().isResolved).toBe(false);
      expect(reopenRes.json().resolvedBy).toBeNull();
      expect(reopenRes.json().resolvedAt).toBeNull();
    });

    it('blocks contributors and viewers from resolving threads with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments/${rootCommentId}/resolve`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: { isResolved: true },
      });
      expect(res.statusCode).toBe(403);
    });

    it('strictly rejects resolution attempts on child replies with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments/${replyCommentId}/resolve`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { isResolved: true },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Resolution status can only be toggled on root comments');
    });
  });

  // ─── 5. EDITING, DELETION & TOMBSTONES ────────────────────────────────────────

  describe('Editing, Deletion & Tombstones', () => {
    it('allows author to edit their own comment, updating editedAt', async () => {
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Initial comment before edit',
        },
      });
      const commentId = postRes.json().id;

      const editRes = await app.inject({
        method: 'PATCH',
        url: `/api/decisions/${decisionId}/comments/${commentId}`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: { content: 'Corrected comment after edit' },
      });

      expect(editRes.statusCode).toBe(200);
      expect(editRes.json().content).toBe('Corrected comment after edit');
      expect(editRes.json().editedAt).toBeDefined();

      // Another user cannot edit -> 403 Forbidden
      const unauthorizedEdit = await app.inject({
        method: 'PATCH',
        url: `/api/decisions/${decisionId}/comments/${commentId}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { content: 'Malicious edit attempt' },
      });
      expect(unauthorizedEdit.statusCode).toBe(403);
    });

    it('permanently deletes comment when replyCount is 0', async () => {
      const postRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Zero replies comment to delete',
        },
      });
      const commentId = postRes.json().id;

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/comments/${commentId}`,
        headers: { authorization: `Bearer ${contributorToken}` },
      });

      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().action).toBe('deleted');

      const doc = await CommentModel.findById(commentId);
      expect(doc).toBeNull();
    });

    it('tombstones comment when replyCount > 0, masking content and authorName', async () => {
      // 1. Create root comment
      const rootRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Author comment that will be tombstoned',
        },
      });
      const rootId = rootRes.json().id;

      // 2. Add reply so replyCount is 1
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          parentCommentId: rootId,
          content: 'A reply anchoring the thread',
        },
      });

      // 3. Author deletes root comment
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/comments/${rootId}`,
        headers: { authorization: `Bearer ${contributorToken}` },
      });

      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().action).toBe('tombstoned');

      // 4. Verify tombstoned state in database
      const tombstonedDoc = await CommentModel.findById(rootId);
      expect(tombstonedDoc?.isDeleted).toBe(true);
      expect(tombstonedDoc?.content).toBe('[This comment was deleted by its author]');
      expect(tombstonedDoc?.authorName).toBe('[Deleted]');
      expect(tombstonedDoc?.deletedAt).toBeDefined();

      // 5. Verify tombstone appears in listings so replies remain anchored
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const items = listRes.json().items;
      const foundTombstone = items.find((c: { id: string }) => c.id === rootId);
      expect(foundTombstone).toBeDefined();
      expect(foundTombstone.isDeleted).toBe(true);
      expect(foundTombstone.content).toBe('[This comment was deleted by its author]');
    });

    it('allows decision owner to moderate and tombstone collaborator comments', async () => {
      const rootRes = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${contributorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Unprofessional comment that owner removes',
        },
      });
      const rootId = rootRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { parentCommentId: rootId, content: 'Reply to keep thread intact' },
      });

      // Owner deletes contributor comment
      const modDelRes = await app.inject({
        method: 'DELETE',
        url: `/api/decisions/${decisionId}/comments/${rootId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(modDelRes.statusCode).toBe(200);
      expect(modDelRes.json().action).toBe('tombstoned');

      const doc = await CommentModel.findById(rootId);
      expect(doc?.content).toBe('[This comment was removed by moderator]');
    });
  });

  // ─── 6. QUARANTINE MUTATION BLOCKING ─────────────────────────────────────────

  describe('Quarantine Mutation Blocking', () => {
    it('blocks comment operations with 423 Locked when decision is quarantined', async () => {
      // Put decision in quarantine
      await DecisionModel.findByIdAndUpdate(decisionId, {
        auditIntegrityStatus: 'quarantined',
        quarantineReason: 'Simulated audit desynchronization in test',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decisionId}/comments`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          targetType: 'decision',
          targetId: 'decision',
          content: 'Attempt comment on quarantined decision',
        },
      });

      expect(res.statusCode).toBe(423);
      expect(res.json().error).toBe('DecisionQuarantinedError');
      expect(res.json().decisionId).toBe(decisionId);
    });
  });
});
