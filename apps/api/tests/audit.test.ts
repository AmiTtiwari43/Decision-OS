import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase, getTestDatabaseUri } from '../src/db/guard';
import { DecisionModel } from '../src/models/decision.model';
import { UserModel } from '../src/models/user.model';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model';
import { AuditEventModel } from '../src/models/audit.model';
import { DecisionSnapshotModel } from '../src/models/snapshot.model';
import { createDecision, analyzeDecision, updateDecision } from '../src/services/decision.service';
import { auditService, GENESIS_PREVIOUS_HASH } from '../src/services/audit.service';
import { sanitizeCsvCell } from '../src/services/export.service';
import { contributionRepository } from '../src/repositories/index';

const TEST_MONGODB_URI = getTestDatabaseUri();

assertTestDatabase(TEST_MONGODB_URI);

describe('Phase 13: Audit, History & Export System', () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let editorToken: string;
  let viewerToken: string;
  let unrelatedToken: string;
  let ownerId: string;
  let editorId: string;
  let viewerId: string;
  let unrelatedId: string;

  beforeAll(async () => {
    await connectToDatabase(TEST_MONGODB_URI);
    app = await buildApp();
    await app.ready();

    await UserModel.deleteMany({});
    await DecisionModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});
    await DecisionSnapshotModel.collection.deleteMany({});

    // 1. Owner
    const owner = new UserModel({
      email: 'audit-owner@example.com',
      passwordHash: 'dummy_hash',
      name: 'Owner Alice',
      role: 'user',
    });
    await owner.save();
    ownerId = owner._id.toString();
    ownerToken = app.jwt.sign({ sub: ownerId, id: ownerId, email: owner.email, name: owner.name, role: owner.role });

    // 2. Editor
    const editor = new UserModel({
      email: 'audit-editor@example.com',
      passwordHash: 'dummy_hash',
      name: 'Editor Bob',
      role: 'user',
    });
    await editor.save();
    editorId = editor._id.toString();
    editorToken = app.jwt.sign({ sub: editorId, id: editorId, email: editor.email, name: editor.name, role: editor.role });

    // 3. Viewer
    const viewer = new UserModel({
      email: 'audit-viewer@example.com',
      passwordHash: 'dummy_hash',
      name: 'Viewer Charlie',
      role: 'user',
    });
    await viewer.save();
    viewerId = viewer._id.toString();
    viewerToken = app.jwt.sign({ sub: viewerId, id: viewerId, email: viewer.email, name: viewer.name, role: viewer.role });

    // 4. Unrelated User
    const unrelated = new UserModel({
      email: 'audit-unrelated@example.com',
      passwordHash: 'dummy_hash',
      name: 'Unrelated Dave',
      role: 'user',
    });
    await unrelated.save();
    unrelatedId = unrelated._id.toString();
    unrelatedToken = app.jwt.sign({ sub: unrelatedId, id: unrelatedId, email: unrelated.email, name: unrelated.name, role: unrelated.role });
  });

  afterAll(async () => {
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    await DecisionModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
    await AuditEventModel.collection.deleteMany({});
    await DecisionSnapshotModel.collection.deleteMany({});
  });

  // Helper to create a test decision with full criteria, options, and scores
  async function createTestDecision(customTitle = 'Cloud Architecture Decision') {
    const doc = await createDecision(
      {
        title: customTitle,
        description: 'Evaluating cloud vendors',
        criteria: [
          { id: 'cost', name: 'Cost Efficiency', weight: 40, direction: 'benefit', isLocked: false },
          { id: 'perf', name: 'Performance', weight: 60, direction: 'benefit', isLocked: false },
        ],
        options: [
          { id: 'aws', name: 'AWS Cloud' },
          { id: 'gcp', name: 'Google Cloud Platform' },
        ],
        scores: {
          aws: { cost: 70, perf: 90 },
          gcp: { cost: 85, perf: 80 },
        },
      },
      { id: ownerId, email: 'audit-owner@example.com', name: 'Owner Alice', role: 'user' }
    );

    // Grant access to Editor and Viewer
    await DecisionAccessGrantModel.create({
      decisionId: doc._id,
      userId: editorId,
      role: 'editor',
      grantedBy: ownerId,
    });

    await DecisionAccessGrantModel.create({
      decisionId: doc._id,
      userId: viewerId,
      role: 'viewer',
      grantedBy: ownerId,
    });

    return doc;
  }

  // ─── 1. Audit Trail & Hash Chaining Unit Tests ──────────────────────────────

  it('automatically creates a root audit event with genesis previousEventHash on decision creation', async () => {
    const decision = await createTestDecision();

    const events = await AuditEventModel.find({ decisionId: decision._id }).sort({ timestamp: 1 });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const rootEvent = events[0];
    expect(rootEvent.action).toBe('decision.created');
    expect(rootEvent.previousEventHash).toBe(GENESIS_PREVIOUS_HASH);
    expect(rootEvent.eventHash).toBeDefined();
    expect(rootEvent.eventHash.length).toBe(64);
  });

  it('chains subsequent events to the previous event hash monotonically', async () => {
    const decision = await createTestDecision();

    // Trigger analysis to create a second event
    await analyzeDecision(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
      name: 'Owner Alice',
      role: 'user',
    });

    const events = await AuditEventModel.find({ decisionId: decision._id }).sort({ timestamp: 1, _id: 1 });
    expect(events.length).toBe(2);

    expect(events[0].previousEventHash).toBe(GENESIS_PREVIOUS_HASH);
    expect(events[1].previousEventHash).toBe(events[0].eventHash);
    expect(events[1].action).toBe('decision.calculated');
  });

  it('validates a pristine audit chain successfully via verifyChainIntegrity', async () => {
    const decision = await createTestDecision();
    await analyzeDecision(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
      name: 'Owner Alice',
    });

    const result = await auditService.verifyChainIntegrity(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
    });

    expect(result.isValid).toBe(true);
    expect(result.totalEventsChecked).toBe(2);
    expect(result.rootHash).toBeDefined();
    expect(result.headHash).toBeDefined();
  });

  it('detects tampering and flags an invalid chain if an event is modified or corrupted', async () => {
    const decision = await createTestDecision();
    await analyzeDecision(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
    });

    // Tamper directly in MongoDB collection (bypassing append-only middleware by updating raw)
    await AuditEventModel.collection.updateOne(
      { decisionId: decision._id, action: 'decision.created' },
      { $set: { summary: 'Forged Summary Unauthorized Alteration' } }
    );

    const result = await auditService.verifyChainIntegrity(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
    });

    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Content hash verification failed');
    expect(result.brokenAtEventId).toBeDefined();
  });

  it('strictly blocks ordinary Mongoose updates and deletes on audit records (append-only safeguard)', async () => {
    const decision = await createTestDecision();
    const event = await AuditEventModel.findOne({ decisionId: decision._id });
    expect(event).not.toBeNull();

    await expect(
      AuditEventModel.updateOne({ _id: event!._id }, { summary: 'Hacked' })
    ).rejects.toThrow('Audit records are strictly append-only. Updates are prohibited.');

    await expect(
      AuditEventModel.deleteOne({ _id: event!._id })
    ).rejects.toThrow('Audit records are strictly append-only. Deletions are prohibited.');

    await expect(
      AuditEventModel.deleteMany({})
    ).rejects.toThrow('Audit records are strictly append-only. Deletions are prohibited.');
  });

  // ─── 2. Audit API Endpoints ──────────────────────────────────────────────────

  it('GET /api/decisions/:id/audit enforces authentication and decision authorization', async () => {
    const decision = await createTestDecision();

    // 1. Unauthenticated -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/audit`,
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Unrelated User -> 404 (enumeration defense)
    const unrelatedRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/audit`,
      headers: { authorization: `Bearer ${unrelatedToken}` },
    });
    expect(unrelatedRes.statusCode).toBe(404);

    // 3. Collaborator (Viewer) -> 200 OK
    const viewerRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/audit`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerRes.statusCode).toBe(200);
    const body = JSON.parse(viewerRes.payload);
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0].eventHash).toBeDefined();
  });

  it('GET /api/decisions/:id/audit/verify returns cryptographic chain verification', async () => {
    const decision = await createTestDecision();

    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/audit/verify`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.isValid).toBe(true);
    expect(body.totalEventsChecked).toBeGreaterThanOrEqual(1);
    expect(body.headHash).toBeDefined();
  });

  // ─── 3. Decision Snapshots & Version History ─────────────────────────────────

  it('POST /api/decisions/:id/snapshots allows owner/editor to capture snapshot and preserves calculation', async () => {
    const decision = await createTestDecision();

    // Editor captures a milestone snapshot
    const res = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision._id}/snapshots`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: {
        reason: 'milestone',
        note: 'Sprint Review Signoff',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.snapshotId).toBeDefined();
    expect(body.version).toBe(1);
    expect(body.snapshotReason).toBe('milestone');
    expect(body.snapshotNote).toBe('Sprint Review Signoff');
    expect(body.analysis.winnerId).toBeDefined();
    expect(body.analysis.engineVersion).toBeDefined();

    // Check that a snapshot.created audit event was recorded
    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/audit?action=snapshot.*`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(auditRes.statusCode).toBe(200);
    const auditBody = JSON.parse(auditRes.payload);
    expect(auditBody.items.some((e: { action: string }) => e.action === 'snapshot.created')).toBe(true);
  });

  it('blocks viewers from creating milestone snapshots with 403 Forbidden', async () => {
    const decision = await createTestDecision();

    const res = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision._id}/snapshots`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { reason: 'manual', note: 'Unauthorized snapshot attempt' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('GET /api/decisions/:id/snapshots/:snapshotId retrieves preserved snapshot details', async () => {
    const decision = await createTestDecision();

    const snap = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision._id}/snapshots`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: 'milestone', note: 'Initial Release' },
    });
    const snapshotId = JSON.parse(snap.payload).snapshotId;

    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/snapshots/${snapshotId}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.snapshotId).toBe(snapshotId);
    expect(body.criteria.length).toBe(2);
    expect(body.options.length).toBe(2);
  });

  it('prevents updates and deletes on DecisionSnapshot records (immutable snapshot guarantee)', async () => {
    const decision = await createTestDecision();
    const snap = await DecisionSnapshotModel.create({
      snapshotId: 'test-uuid-snapshot',
      decisionId: decision._id,
      version: 1,
      title: 'Frozen Decision',
      criteria: [],
      options: [],
      scores: {},
      analysis: null,
      metadata: { evidenceCount: 0, contributionCount: 0, predictionCount: 0, disagreementCount: 0 },
      snapshotReason: 'milestone',
      createdById: ownerId,
    });

    await expect(
      DecisionSnapshotModel.updateOne({ _id: snap._id }, { title: 'Mutated' })
    ).rejects.toThrow('Decision snapshots are strictly append-only. Updates are prohibited.');

    await expect(
      DecisionSnapshotModel.deleteOne({ _id: snap._id })
    ).rejects.toThrow('Decision snapshots are strictly append-only. Deletions are prohibited.');

    await expect(
      DecisionSnapshotModel.deleteMany({})
    ).rejects.toThrow('Decision snapshots are strictly append-only. Deletions are prohibited.');
  });

  // ─── 4. Export Functionality & Security ──────────────────────────────────────

  it('GET /api/decisions/:id/export?format=json exports complete validated schema without secrets', async () => {
    const decision = await createTestDecision();

    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/export?format=json`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment; filename=');

    const json = JSON.parse(res.payload);
    expect(json.exportVersion).toBe('1.0.0');
    expect(json.exportedAt).toBeDefined();
    expect(json.decision.title).toBe('Cloud Architecture Decision');
    expect(json.decision.criteria.length).toBe(2);
    expect(json.mcdaAnalysis.winnerId).toBeDefined();
    expect(json.auditChain.isValid).toBe(true);

    // Verify secrets, passwords, or raw tokens are strictly absent
    const stringified = JSON.stringify(json);
    expect(stringified).not.toContain('passwordHash');
    expect(stringified).not.toContain('dummy_hash');
  });

  it('GET /api/decisions/:id/export?format=csv applies formula injection defense to dangerous fields', async () => {
    // Create decision with formula injection attempts in title, criterion, and option
    const maliciousDecision = await createTestDecision('=cmd|"/C calc"!A0');

    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${maliciousDecision._id}/export?format=csv`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const csvContent = res.payload;

    // Check that dangerous leading characters are escaped with leading single quote
    expect(csvContent).toContain("'=cmd");
    expect(csvContent).not.toMatch(/^=cmd/m);
  });

  it('sanitizeCsvCell safely escapes dangerous spreadsheet formula triggers (=, +, -, @, \\t, \\r)', () => {
    expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(sanitizeCsvCell('+12345')).toBe("'+12345");
    expect(sanitizeCsvCell('-50.0')).toBe("'-50.0");
    expect(sanitizeCsvCell('@cmd')).toBe("'@cmd");
    expect(sanitizeCsvCell('\tmalicious')).toBe("'\tmalicious");
    expect(sanitizeCsvCell('Normal Text')).toBe('Normal Text');
    expect(sanitizeCsvCell('Text with, comma')).toBe('"Text with, comma"');
    expect(sanitizeCsvCell('Text with "quotes"')).toBe('"Text with ""quotes"""');
  });

  it('GET /api/decisions/:id/export?format=html returns standalone printable executive briefing', async () => {
    const decision = await createTestDecision();

    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/export?format=html`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<!DOCTYPE html>');
    expect(res.payload).toContain('Decision Briefing: Cloud Architecture Decision');
    expect(res.payload).toContain('Rankings &amp; Authoritative MCDA Scores');
    expect(res.payload).toContain('SHA-256 Chain Verified');
  });

  it('records an export.generated audit event when an export is created', async () => {
    const decision = await createTestDecision();

    await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/export?format=json`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/audit?action=export.*`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(auditRes.statusCode).toBe(200);
    const auditBody = JSON.parse(auditRes.payload);
    expect(auditBody.items.some((e: { action: string }) => e.action === 'export.generated')).toBe(true);
  });

  it('guarantees canonical MCDA engine immutability across all Phase 13 actions', async () => {
    const decision = await createTestDecision();
    const initialAnalysis = JSON.stringify(decision.analysis);

    // Run audit queries, verify chain, create snapshot, and download export
    await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/audit/verify`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision._id}/snapshots`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: 'milestone' },
    });

    await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/export?format=csv`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    const refreshed = await DecisionModel.findById(decision._id);
    expect(JSON.stringify(refreshed?.analysis)).toBe(initialAnalysis);
  });

  // ─── 5. Adversarial Audit & Security Verification ───────────────────────────

  it('prevents audit event creation on failed domain operations', async () => {
    const decision = await createTestDecision();
    const countBefore = await AuditEventModel.countDocuments({ decisionId: decision._id });

    // Attempt invalid update with negative criterion weight
    await expect(
      updateDecision(
        decision._id.toString(),
        {
          criteria: [{ id: 'cost', name: 'Cost', weight: -10 }],
        },
        { id: ownerId, email: 'audit-owner@example.com' }
      )
    ).rejects.toThrow();

    const countAfter = await AuditEventModel.countDocuments({ decisionId: decision._id });
    expect(countAfter).toBe(countBefore);
  });

  it('detects tampering when an event is deleted or corrupted in the middle of the chain', async () => {
    const decision = await createTestDecision();
    await analyzeDecision(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
    });
    await updateDecision(
      decision._id.toString(),
      { description: 'Updated description for chaining' },
      { id: ownerId, email: 'audit-owner@example.com' }
    );

    const events = await AuditEventModel.find({ decisionId: decision._id }).sort({ timestamp: 1 });
    expect(events.length).toBe(3);

    // Tamper: delete the middle event directly in raw Mongo collection
    await AuditEventModel.collection.deleteOne({ eventId: events[1].eventId });

    const verification = await auditService.verifyChainIntegrity(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
    });

    expect(verification.isValid).toBe(false);
    expect(verification.reason).toContain('Previous hash linkage broken');
    expect(verification.brokenAtEventId).toBe(events[2].eventId);
  });

  it('handles concurrent audit event creation without breaking the hash chain (optimistic concurrency)', async () => {
    const decision = await createTestDecision();

    // Fire 4 concurrent audit events
    await Promise.all([
      auditService.recordEvent({
        decisionId: decision._id.toString(),
        actor: { id: ownerId, email: 'audit-owner@example.com' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decision._id.toString(),
        summary: 'Concurrent Event A',
      }),
      auditService.recordEvent({
        decisionId: decision._id.toString(),
        actor: { id: editorId, email: 'audit-editor@example.com' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decision._id.toString(),
        summary: 'Concurrent Event B',
      }),
      auditService.recordEvent({
        decisionId: decision._id.toString(),
        actor: { id: viewerId, email: 'audit-viewer@example.com' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decision._id.toString(),
        summary: 'Concurrent Event C',
      }),
      auditService.recordEvent({
        decisionId: decision._id.toString(),
        actor: { id: ownerId, email: 'audit-owner@example.com' },
        action: 'decision.updated',
        entityType: 'decision',
        entityId: decision._id.toString(),
        summary: 'Concurrent Event D',
      }),
    ]);

    const verification = await auditService.verifyChainIntegrity(decision._id.toString(), {
      id: ownerId,
      email: 'audit-owner@example.com',
    });

    expect(verification.isValid).toBe(true);
    // 1 root event + 4 concurrent events = 5 total events
    expect(verification.totalEventsChecked).toBe(5);
  });

  it('strictly blocks unauthorized users from accessing snapshot details of deleted decisions (orphaned snapshot protection)', async () => {
    const decision = await createTestDecision();

    const snap = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision._id}/snapshots`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: 'milestone', note: 'Pre-delete Snapshot' },
    });
    const snapshotId = JSON.parse(snap.payload).snapshotId;

    // Delete the decision directly in MongoDB collection (simulating deleted decision with retained snapshot)
    await DecisionModel.collection.deleteOne({ _id: decision._id });

    // Unauthorized query must receive 404 (not leak snapshot)
    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/snapshots/${snapshotId}`,
      headers: { authorization: `Bearer ${unrelatedToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('filters unsubmitted drafts of other contributors from JSON exports while preserving contributor own draft', async () => {
    const decision = await createTestDecision();

    // Editor saves a draft contribution (unsubmitted)
    await contributionRepository.saveDraft(decision._id.toString(), editorId, {
      preferredOptionId: 'aws',
      rationale: 'Editor confidential draft reasoning',
      confidence: 0.85,
    });

    // 1. Viewer exports decision -> Editor draft must NOT be leaked
    const viewerExportRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/export?format=json`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerExportRes.statusCode).toBe(200);
    const viewerExport = JSON.parse(viewerExportRes.payload);
    expect(viewerExport.expertContributions.length).toBe(0);

    // 2. Editor exports decision -> Editor sees their own draft
    const editorExportRes = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/export?format=json`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(editorExportRes.statusCode).toBe(200);
    const editorExport = JSON.parse(editorExportRes.payload);
    expect(editorExport.expertContributions.length).toBe(1);
    expect(editorExport.expertContributions[0].contributorId).toBe(editorId);
    expect(editorExport.expertContributions[0].status).toBe('draft');
  });

  it('rejects unsupported export format with 400 Bad Request', async () => {
    const decision = await createTestDecision();

    const res = await app.inject({
      method: 'GET',
      url: `/api/decisions/${decision._id}/export?format=unsupported_xml`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toMatch(/Expected 'json' \| 'csv' \| 'html'/);
  });
});

