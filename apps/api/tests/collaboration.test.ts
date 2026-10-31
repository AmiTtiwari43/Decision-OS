import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { buildApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection';
import { assertTestDatabase } from '../src/db/guard';
import { DecisionModel } from '../src/models/decision.model';
import { UserModel } from '../src/models/user.model';
import { DecisionAccessGrantModel } from '../src/models/decisionAccess.model';
import { createDecision, updateDecision, analyzeDecision } from '../src/services/decision.service';
import { collaborationService } from '../src/services/collaboration.service';
import { DecisionConflictError } from '../src/errors/domain.errors';

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os_test';

assertTestDatabase(TEST_MONGODB_URI);

// Helper to create a mock ServerResponse using a PassThrough stream
function createMockServerResponse() {
  const stream = new PassThrough();
  const headers: Record<string, string | number | readonly string[]> = {};
  let statusCode = 200;

  const res = stream as unknown as ServerResponse & {
    _written: string[];
    _headers: Record<string, string | number | readonly string[]>;
    _statusCode: number;
  };

  res._written = [];
  res._headers = headers;
  res._statusCode = statusCode;

  res.writeHead = (code: number, hdrs?: any) => {
    res._statusCode = code;
    if (hdrs) {
      for (const [k, v] of Object.entries(hdrs)) {
        headers[k.toLowerCase()] = v as any;
      }
    }
    return res;
  };

  res.setHeader = (name: string, value: any) => {
    headers[name.toLowerCase()] = value;
    return res;
  };

  res.getHeader = (name: string) => headers[name.toLowerCase()];

  const originalWrite = stream.write.bind(stream);
  res.write = (chunk: any, ...args: any[]) => {
    res._written.push(chunk.toString());
    return originalWrite(chunk, ...args);
  };

  return res;
}

describe('Phase 14: Real-Time Collaboration & Concurrency', () => {
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

    // 1. Owner
    const owner = new UserModel({
      email: 'collab-owner@example.com',
      passwordHash: 'dummy_hash',
      name: 'Alice Owner',
      role: 'user',
    });
    await owner.save();
    ownerId = owner._id.toString();
    ownerToken = app.jwt.sign({ sub: ownerId, id: ownerId, email: owner.email, name: owner.name, role: owner.role });

    // 2. Editor
    const editor = new UserModel({
      email: 'collab-editor@example.com',
      passwordHash: 'dummy_hash',
      name: 'Bob Editor',
      role: 'user',
    });
    await editor.save();
    editorId = editor._id.toString();
    editorToken = app.jwt.sign({ sub: editorId, id: editorId, email: editor.email, name: editor.name, role: editor.role });

    // 3. Viewer
    const viewer = new UserModel({
      email: 'collab-viewer@example.com',
      passwordHash: 'dummy_hash',
      name: 'Charlie Viewer',
      role: 'user',
    });
    await viewer.save();
    viewerId = viewer._id.toString();
    viewerToken = app.jwt.sign({ sub: viewerId, id: viewerId, email: viewer.email, name: viewer.name, role: viewer.role });

    // 4. Unrelated User
    const unrelated = new UserModel({
      email: 'collab-unrelated@example.com',
      passwordHash: 'dummy_hash',
      name: 'Dave Unrelated',
      role: 'user',
    });
    await unrelated.save();
    unrelatedId = unrelated._id.toString();
    unrelatedToken = app.jwt.sign({ sub: unrelatedId, id: unrelatedId, email: unrelated.email, name: unrelated.name, role: unrelated.role });
  });

  afterAll(async () => {
    collaborationService.reset();
    await app.close();
    await disconnectFromDatabase();
  });

  beforeEach(async () => {
    collaborationService.reset();
    await DecisionModel.deleteMany({});
    await DecisionAccessGrantModel.deleteMany({});
  });

  async function createTestDecision(customTitle = 'Realtime Collaboration Decision') {
    const doc = await createDecision(
      {
        title: customTitle,
        description: 'Testing SSE collaboration and optimistic locking',
        criteria: [
          { id: 'crit-speed', name: 'Speed', weight: 50, direction: 'benefit', isLocked: false },
          { id: 'crit-cost', name: 'Cost', weight: 50, direction: 'cost', isLocked: false },
        ],
        options: [
          { id: 'opt-a', name: 'Solution A' },
          { id: 'opt-b', name: 'Solution B' },
        ],
        scores: {
          'opt-a': { 'crit-speed': 80, 'crit-cost': 40 },
          'opt-b': { 'crit-speed': 60, 'crit-cost': 20 },
        },
      },
      { id: ownerId, email: 'collab-owner@example.com', name: 'Alice Owner', role: 'user' }
    );

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

  // ─── 1. Authentication & Authorization for Collaboration Stream ─────────────

  describe('SSE Stream Security & Access Control', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const decision = await createTestDecision();

      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decision._id}/collaboration/stream`,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toContain('authentication required');
    });

    it('rejects malformed decision ID with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/decisions/invalid-id-format/collaboration/stream',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Bad Request');
    });

    it('returns 404 for non-existent decision', async () => {
      const nonExistentId = '507f1f77bcf86cd799439011';
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${nonExistentId}/collaboration/stream`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Not Found');
    });

    it('returns 404 for unrelated user (ID enumeration defense)', async () => {
      const decision = await createTestDecision();

      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decision._id}/collaboration/stream`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Not Found');
    });
  });

  // ─── 2. Presence Tracking & Heartbeats ───────────────────────────────────────

  describe('Presence Management', () => {
    it('allows authorized collaborator to post presence heartbeat', async () => {
      const decision = await createTestDecision();

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decision._id}/collaboration/presence`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          status: 'active',
          currentView: 'matrix',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(Array.isArray(body.participants)).toBe(true);
      expect(body.participants.length).toBe(1);
      expect(body.participants[0].userId).toBe(editorId);
      expect(body.participants[0].status).toBe('active');
      expect(body.participants[0].currentView).toBe('matrix');
    });

    it('allows query of active participants via GET /presence', async () => {
      const decision = await createTestDecision();

      // Post editor presence
      await app.inject({
        method: 'POST',
        url: `/api/decisions/${decision._id}/collaboration/presence`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: { status: 'active', currentView: 'summary' },
      });

      // Query via viewer
      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decision._id}/collaboration/presence`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.decisionId).toBe(decision._id.toString());
      expect(body.participants.length).toBe(1);
      expect(body.participants[0].name).toBe('Bob Editor');
    });

    it('rejects unauthenticated presence updates', async () => {
      const decision = await createTestDecision();

      const res = await app.inject({
        method: 'POST',
        url: `/api/decisions/${decision._id}/collaboration/presence`,
        payload: { status: 'active' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects presence queries from unrelated users with 404', async () => {
      const decision = await createTestDecision();

      const res = await app.inject({
        method: 'GET',
        url: `/api/decisions/${decision._id}/collaboration/presence`,
        headers: { authorization: `Bearer ${unrelatedToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── 3. Optimistic Concurrency & Conflict Detection ──────────────────────────

  describe('Optimistic Concurrency & Versioning', () => {
    it('initializes decision at version 1', async () => {
      const decision = await createTestDecision();
      expect(decision.version).toBe(1);
    });

    it('increments version on successful update', async () => {
      const decision = await createTestDecision();

      const updated = await updateDecision(
        decision._id.toString(),
        {
          title: 'Updated Title V2',
          expectedVersion: 1,
        },
        { id: ownerId, email: 'collab-owner@example.com', name: 'Alice Owner', role: 'user' }
      );

      expect(updated.version).toBe(2);
      expect(updated.title).toBe('Updated Title V2');
    });

    it('throws DecisionConflictError when expectedVersion does not match current version', async () => {
      const decision = await createTestDecision();

      // First update increments version to 2
      await updateDecision(
        decision._id.toString(),
        { title: 'First Update', expectedVersion: 1 },
        { id: ownerId, email: 'collab-owner@example.com', name: 'Alice Owner', role: 'user' }
      );

      // Second update tries to update with stale version 1
      await expect(
        updateDecision(
          decision._id.toString(),
          { title: 'Concurrent Stale Update', expectedVersion: 1 },
          { id: editorId, email: 'collab-editor@example.com', name: 'Bob Editor', role: 'user' }
        )
      ).rejects.toThrow(DecisionConflictError);

      // Verify database still has "First Update" at version 2
      const fresh = await DecisionModel.findById(decision._id);
      expect(fresh!.version).toBe(2);
      expect(fresh!.title).toBe('First Update');
    });

    it('returns HTTP 409 Conflict with currentVersion on API PUT', async () => {
      const decision = await createTestDecision();

      // First update to bump version to 2
      const put1 = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decision._id}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          title: 'Version 2 Title',
          expectedVersion: 1,
        },
      });
      expect(put1.statusCode).toBe(200);

      // Stale update with expectedVersion 1
      const put2 = await app.inject({
        method: 'PUT',
        url: `/api/decisions/${decision._id}`,
        headers: { authorization: `Bearer ${editorToken}` },
        payload: {
          title: 'Stale Editor Overwrite',
          expectedVersion: 1,
        },
      });

      expect(put2.statusCode).toBe(409);
      const conflictBody = JSON.parse(put2.body);
      expect(conflictBody.error).toBe('Conflict');
      expect(conflictBody.currentVersion).toBe(2);
      expect(conflictBody.message).toContain('modified by another participant');
    });
  });

  // ─── 4. In-Memory Ring Buffer & SSE Event Formatting ─────────────────────────

  describe('In-Memory Ring Buffer & Replay Service', () => {
    it('registers subscriber, writes SSE headers, and delivers presence.sync', () => {
      const mockRes = createMockServerResponse();
      const decisionId = '507f1f77bcf86cd799439011';

      collaborationService.registerClient(
        decisionId,
        { id: ownerId, email: 'collab-owner@example.com', name: 'Alice Owner', role: 'user' },
        mockRes
      );

      expect(mockRes._statusCode).toBe(200);
      expect(mockRes._headers['content-type']).toBe('text/event-stream');
      expect(mockRes._headers['cache-control']).toBe('no-cache, no-transform');

      // Check written chunks include presence.sync
      const allData = mockRes._written.join('');
      expect(allData).toContain('event: presence.sync');
      expect(allData).toContain('Alice Owner');
    });

    it('replays missed events when Last-Event-ID is within ring buffer', () => {
      const decisionId = '507f1f77bcf86cd799439012';

      // Broadcast 3 events into buffer
      const event1 = collaborationService.broadcastEvent(decisionId, {
        type: 'decision.updated',
        decisionId,
        version: 2,
        payload: { title: 'Event 1' },
      });

      const event2 = collaborationService.broadcastEvent(decisionId, {
        type: 'decision.updated',
        decisionId,
        version: 3,
        payload: { title: 'Event 2' },
      });

      const event3 = collaborationService.broadcastEvent(decisionId, {
        type: 'decision.updated',
        decisionId,
        version: 4,
        payload: { title: 'Event 3' },
      });

      // New subscriber connects with Last-Event-ID = event1.eventId
      const mockRes = createMockServerResponse();
      collaborationService.registerClient(
        decisionId,
        { id: editorId, email: 'collab-editor@example.com', name: 'Bob Editor', role: 'user' },
        mockRes,
        event1.eventId
      );

      const allData = mockRes._written.join('');
      // Should have replayed event2 and event3, but not event1
      expect(allData).not.toContain(event1.eventId);
      expect(allData).toContain(event2.eventId);
      expect(allData).toContain(event3.eventId);
    });

    it('emits sync_required when Last-Event-ID has fallen outside the ring buffer', () => {
      const decisionId = '507f1f77bcf86cd799439013';

      // Push 105 events to overflow 100-event ring buffer
      for (let i = 1; i <= 105; i++) {
        collaborationService.broadcastEvent(decisionId, {
          type: 'decision.updated',
          decisionId,
          version: i,
          payload: { step: i },
        });
      }

      // Reconnect with an evicted event ID
      const mockRes = createMockServerResponse();
      collaborationService.registerClient(
        decisionId,
        { id: viewerId, email: 'collab-viewer@example.com', name: 'Charlie Viewer', role: 'user' },
        mockRes,
        'evicted-event-id-from-past'
      );

      const allData = mockRes._written.join('');
      expect(allData).toContain('event: sync_required');
      expect(allData).toContain('reconnection_buffer_overflow');
    });

    it('broadcasts participant.left when subscriber connection terminates', () => {
      const decisionId = '507f1f77bcf86cd799439014';
      const mockRes1 = createMockServerResponse();
      const mockRes2 = createMockServerResponse();

      // Subscriber 1 (Owner)
      collaborationService.registerClient(
        decisionId,
        { id: ownerId, email: 'collab-owner@example.com', name: 'Alice Owner', role: 'user' },
        mockRes1
      );

      // Subscriber 2 (Editor)
      collaborationService.registerClient(
        decisionId,
        { id: editorId, email: 'collab-editor@example.com', name: 'Bob Editor', role: 'user' },
        mockRes2
      );

      expect(collaborationService.getPresence(decisionId).length).toBe(2);

      // Simulate Subscriber 2 disconnecting (emitting 'close')
      mockRes2.emit('close');

      expect(collaborationService.getPresence(decisionId).length).toBe(1);
      const remainingPresence = collaborationService.getPresence(decisionId);
      expect(remainingPresence[0].userId).toBe(ownerId);

      // Subscriber 1 should have received participant.left
      const ownerData = mockRes1._written.join('');
      expect(ownerData).toContain('event: participant.left');
      expect(ownerData).toContain('Bob Editor');
    });
  });

  // ─── 5. Authoritative Engine Integration & Broadcasts ────────────────────────

  describe('Authoritative MCDA Engine Calculations & Broadcasts', () => {
    it('broadcasts decision.calculation.updated with canonical MCDA results', async () => {
      const decision = await createTestDecision();
      const decisionId = decision._id.toString();

      // Attach mock subscriber
      const mockRes = createMockServerResponse();
      collaborationService.registerClient(
        decisionId,
        { id: viewerId, email: 'collab-viewer@example.com', name: 'Charlie Viewer', role: 'user' },
        mockRes
      );

      // Run authoritative analysis
      const decisionResult = await analyzeDecision(
        decisionId,
        { id: ownerId, email: 'collab-owner@example.com', name: 'Alice Owner', role: 'user' }
      );

      expect(decisionResult.analysis).toBeDefined();
      expect(decisionResult.analysis!.evaluations).toBeDefined();
      expect(decisionResult.analysis!.engineVersion).toBe('1.0.0');

      // Verify that subscriber received calculation broadcast
      const streamData = mockRes._written.join('');
      expect(streamData).toContain('event: decision.calculation.updated');
      expect(streamData).toContain('"engineVersion":"1.0.0"');
      expect(streamData).toContain('opt-a');
      expect(streamData).toContain('opt-b');
    });
  });
});
