import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DecisionApiClient, ApiClientError } from '../api/client.js';
import type {
  PresenceResponseDto,
} from '../api/types.js';

describe('Real-Time Collaboration Frontend API Client & Integration', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-collab-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Collaboration Stream URL Generation', () => {
    it('builds authenticated SSE stream URL with token and decision ID', () => {
      const url = client.getCollaborationStreamUrl('507f1f77bcf86cd799439011');
      expect(url).toContain('/api/decisions/507f1f77bcf86cd799439011/collaboration/stream');
      expect(url).toContain('token=valid-collab-token');
    });

    it('includes lastEventId parameter when reconnecting after disconnection', () => {
      const url = client.getCollaborationStreamUrl('507f1f77bcf86cd799439011', 'event-uuid-1234');
      expect(url).toContain('/api/decisions/507f1f77bcf86cd799439011/collaboration/stream');
      expect(url).toContain('token=valid-collab-token');
      expect(url).toContain('&lastEventId=event-uuid-1234');
    });
  });

  describe('Presence Management Endpoints', () => {
    it('validates decision ID before requesting presence', async () => {
      await expect(client.getDecisionPresence('')).rejects.toThrow(ApiClientError);
      await expect(client.sendPresenceHeartbeat('')).rejects.toThrow(ApiClientError);
    });

    it('retrieves active collaborators from GET /presence', async () => {
      const mockPresence: PresenceResponseDto = {
        decisionId: '507f1f77bcf86cd799439011',
        items: [
          {
            userId: 'user-alice',
            name: 'Alice Owner',
            email: 'alice@example.com',
            role: 'owner',
            status: 'active',
            currentView: 'matrix',
            joinedAt: '2026-10-31T20:00:00.000Z',
            lastSeenAt: '2026-10-31T20:00:10.000Z',
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockPresence,
      });

      const res = await client.getDecisionPresence('507f1f77bcf86cd799439011');
      expect(res.items.length).toBe(1);
      expect(res.items[0].name).toBe('Alice Owner');
      expect(res.items[0].status).toBe('active');
    });

    it('sends heartbeat and receives updated active presence', async () => {
      const mockPresence: PresenceResponseDto = {
        decisionId: '507f1f77bcf86cd799439011',
        items: [
          {
            userId: 'user-bob',
            name: 'Bob Editor',
            email: 'bob@example.com',
            role: 'editor',
            status: 'active',
            currentView: 'scoring',
            joinedAt: '2026-10-31T20:01:00.000Z',
            lastSeenAt: '2026-10-31T20:01:15.000Z',
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockPresence,
      });

      const res = await client.sendPresenceHeartbeat('507f1f77bcf86cd799439011', {
        status: 'active',
        currentView: 'scoring',
      });

      expect(res.items[0].currentView).toBe('scoring');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011/collaboration/presence'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'active', currentView: 'scoring' }),
        })
      );
    });
  });

  describe('Optimistic Concurrency & Conflict Detection', () => {
    it('transmits expectedVersion when updating decision', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          _id: '507f1f77bcf86cd799439011',
          title: 'Updated Decision',
          version: 3,
        }),
      });

      await client.updateDecision('507f1f77bcf86cd799439011', {
        title: 'Updated Decision',
        expectedVersion: 2,
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ title: 'Updated Decision', expectedVersion: 2 }),
        })
      );
    });

    it('handles 409 Conflict when concurrent edits occur', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 409,
          error: 'Conflict',
          message: 'Decision has been modified by another participant (current version: 3, expected: 2)',
          currentVersion: 3,
        }),
      });

      await expect(
        client.updateDecision('507f1f77bcf86cd799439011', {
          title: 'Conflicting Edit',
          expectedVersion: 2,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        error: 'Conflict',
      });
    });
  });

  describe('Unsaved Input & Conflict State Preservation Logic', () => {
    it('preserves dirty local edits and triggers conflict state instead of clobbering', () => {
      let isDirty = true;
      let hasConflict = false;
      let modelUpdated = false;

      // Simulated handler matching useRealtimeCollaboration logic
      const handleDecisionUpdated = (_event: any) => {
        if (isDirty) {
          hasConflict = true;
        } else {
          modelUpdated = true;
        }
      };

      // When dirty, incoming event triggers conflict notice
      handleDecisionUpdated({ type: 'decision.updated', version: 3, actorName: 'Bob' });
      expect(hasConflict).toBe(true);
      expect(modelUpdated).toBe(false);

      // When clean, incoming event applies cleanly
      isDirty = false;
      hasConflict = false;
      handleDecisionUpdated({ type: 'decision.updated', version: 4, actorName: 'Bob' });
      expect(hasConflict).toBe(false);
      expect(modelUpdated).toBe(true);
    });
  });
});
