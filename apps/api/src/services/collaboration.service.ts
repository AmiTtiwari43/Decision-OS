import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type {
  CollaborationEvent,
  ParticipantPresence,
} from '../models/collaboration.types.js';
import type { RequesterContext } from './decision.service.js';

interface SubscriberClient {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  replyRaw: ServerResponse;
  keepAliveTimer?: NodeJS.Timeout;
}

const MAX_EVENT_BUFFER_SIZE = 100;
const MAX_SUBSCRIBERS_PER_DECISION = 100;
const PRESENCE_TTL_MS = 30_000; // 30 seconds inactivity threshold
const KEEPALIVE_INTERVAL_MS = 15_000; // 15 seconds SSE comment heartbeat

export class CollaborationService {
  // Map of decisionId -> Set of active SSE subscriber clients
  private subscribers = new Map<string, Set<SubscriberClient>>();

  // Map of decisionId -> Map of userId -> ParticipantPresence
  private presence = new Map<string, Map<string, ParticipantPresence>>();

  // Map of decisionId -> array of recent CollaborationEvents
  private eventBuffers = new Map<string, CollaborationEvent[]>();

  // Cleanup timer for pruning stale participant presence
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startPruneTimer();
  }

  /**
   * Registers a client SSE connection for a specific decision.
   */
  registerClient(
    decisionId: string,
    user: RequesterContext,
    replyRaw: ServerResponse,
    lastEventId?: string
  ): void {
    const clientId = crypto.randomUUID();
    const userId = user.id;
    const name = user.name || user.email || 'Collaborator';
    const email = user.email || '';
    const role = (user.role as 'owner' | 'editor' | 'viewer' | 'contributor') || 'viewer';

    // Guard against socket exhaustion / unbounded connection storms
    if ((this.subscribers.get(decisionId)?.size || 0) >= MAX_SUBSCRIBERS_PER_DECISION) {
      replyRaw.writeHead(429, { 'Content-Type': 'application/json' });
      replyRaw.end(
        JSON.stringify({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Maximum active collaboration subscribers reached for this decision',
        })
      );
      return;
    }

    // 1. Setup SSE headers and keepalive
    replyRaw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const keepAliveTimer = setInterval(() => {
      try {
        replyRaw.write(':keepalive\n\n');
      } catch {
        // Handled in close listener
      }
    }, KEEPALIVE_INTERVAL_MS);

    const client: SubscriberClient = {
      id: clientId,
      userId,
      email,
      name,
      role,
      replyRaw,
      keepAliveTimer,
    };

    if (!this.subscribers.has(decisionId)) {
      this.subscribers.set(decisionId, new Set());
    }
    this.subscribers.get(decisionId)!.add(client);

    // 2. Handle missed events replay if lastEventId is provided
    if (lastEventId) {
      this.replayMissedEvents(decisionId, replyRaw, lastEventId);
    }

    // 3. Register and broadcast presence
    const activeList = this.updatePresence(decisionId, user, 'active');
    this.broadcastEvent(decisionId, {
      type: 'participant.joined',
      decisionId,
      version: 0,
      actorId: userId,
      actorName: name,
      payload: {
        userId,
        name,
        email,
        role,
        status: 'active',
        activeParticipants: activeList,
      },
    });

    // Send initial presence sync directly to the connecting client
    const syncEvent: CollaborationEvent = {
      eventId: crypto.randomUUID(),
      type: 'presence.sync',
      decisionId,
      version: 0,
      timestamp: new Date().toISOString(),
      payload: { participants: activeList },
    };
    this.sendSseMessage(replyRaw, syncEvent);

    // 4. Handle client disconnection
    const cleanup = () => {
      clearInterval(keepAliveTimer);
      const set = this.subscribers.get(decisionId);
      if (set) {
        set.delete(client);
        if (set.size === 0) {
          this.subscribers.delete(decisionId);
        }
      }

      // Check if user has other open tabs for this decision
      const remainingUserTabs = set ? Array.from(set).filter((c) => c.userId === userId) : [];
      if (remainingUserTabs.length === 0) {
        this.removePresence(decisionId, userId);
        const updatedList = this.getPresence(decisionId);
        this.broadcastEvent(decisionId, {
          type: 'participant.left',
          decisionId,
          version: 0,
          actorId: userId,
          actorName: name,
          payload: {
            userId,
            name,
            activeParticipants: updatedList,
          },
        });
      }
    };

    replyRaw.on('close', cleanup);
    replyRaw.on('error', cleanup);
  }

  /**
   * Publishes and broadcasts an event to all subscribers of a decision.
   */
  publishEvent<T = unknown>(
    decisionId: string,
    event: Omit<CollaborationEvent<T>, 'eventId' | 'timestamp'>
  ): CollaborationEvent<T> {
    const fullEvent: CollaborationEvent<T> = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // Store in ring buffer
    if (!this.eventBuffers.has(decisionId)) {
      this.eventBuffers.set(decisionId, []);
    }
    const buffer = this.eventBuffers.get(decisionId)!;
    buffer.push(fullEvent as CollaborationEvent<unknown>);
    if (buffer.length > MAX_EVENT_BUFFER_SIZE) {
      buffer.shift();
    }

    // Broadcast to subscribers
    const clients = this.subscribers.get(decisionId);
    if (clients) {
      for (const client of clients) {
        try {
          this.sendSseMessage(client.replyRaw, fullEvent);
        } catch {
          // Handled via client close listener
        }
      }
    }

    return fullEvent;
  }

  /**
   * Updates participant presence for a decision.
   */
  updatePresence(
    decisionId: string,
    user: RequesterContext,
    status: 'active' | 'idle' = 'active',
    currentView?: string
  ): ParticipantPresence[] {
    if (!this.presence.has(decisionId)) {
      this.presence.set(decisionId, new Map());
    }
    const decisionPresenceMap = this.presence.get(decisionId)!;
    const nowIso = new Date().toISOString();
    const existing = decisionPresenceMap.get(user.id);

    const presenceItem: ParticipantPresence = {
      userId: user.id,
      name: user.name || user.email || 'Collaborator',
      email: user.email || '',
      role: (user.role as 'owner' | 'editor' | 'viewer' | 'contributor') || 'viewer',
      status,
      currentView: currentView ?? existing?.currentView,
      joinedAt: existing?.joinedAt || nowIso,
      lastSeenAt: nowIso,
    };

    decisionPresenceMap.set(user.id, presenceItem);
    return Array.from(decisionPresenceMap.values());
  }

  /**
   * Gets current active participants for a decision.
   */
  getPresence(decisionId: string): ParticipantPresence[] {
    const map = this.presence.get(decisionId);
    if (!map) return [];
    return Array.from(map.values());
  }

  /**
   * Removes a participant from presence.
   */
  removePresence(decisionId: string, userId: string): void {
    const map = this.presence.get(decisionId);
    if (map) {
      map.delete(userId);
      if (map.size === 0) {
        this.presence.delete(decisionId);
      }
    }
  }

  /**
   * Replays missed events if lastEventId is within ring buffer, or sends sync_required.
   */
  private replayMissedEvents(decisionId: string, replyRaw: ServerResponse, lastEventId: string): void {
    const buffer = this.eventBuffers.get(decisionId);
    if (!buffer || buffer.length === 0) {
      // Buffer empty (e.g. server restart) but client has a lastSeenEventId: signal sync_required!
      const syncRequiredEvent: CollaborationEvent = {
        eventId: crypto.randomUUID(),
        type: 'sync_required',
        decisionId,
        version: 0,
        timestamp: new Date().toISOString(),
        payload: {
          code: 'reconnection_buffer_overflow',
          reason: 'Event history unavailable after server restart or channel eviction',
          lastSeenEventId: lastEventId,
        },
      };
      this.sendSseMessage(replyRaw, syncRequiredEvent);
      return;
    }

    const idx = buffer.findIndex((e) => e.eventId === lastEventId);
    if (idx !== -1) {
      // Replay all events occurring after lastEventId
      const missed = buffer.slice(idx + 1);
      for (const ev of missed) {
        this.sendSseMessage(replyRaw, ev);
      }
    } else {
      // Event too old or buffer overflowed: require client full REST synchronization
      const syncRequiredEvent: CollaborationEvent = {
        eventId: crypto.randomUUID(),
        type: 'sync_required',
        decisionId,
        version: 0,
        timestamp: new Date().toISOString(),
        payload: {
          code: 'reconnection_buffer_overflow',
          reason: 'Event history exceeded buffer window',
          lastSeenEventId: lastEventId,
        },
      };
      this.sendSseMessage(replyRaw, syncRequiredEvent);
    }
  }

  /**
   * Terminates active SSE connections and clears presence when access is revoked.
   */
  disconnectUser(decisionId: string, userId: string): void {
    const clients = this.subscribers.get(decisionId);
    if (clients) {
      for (const client of Array.from(clients)) {
        if (client.userId === userId) {
          if (client.keepAliveTimer) {
            clearInterval(client.keepAliveTimer);
          }
          try {
            this.sendSseMessage(client.replyRaw, {
              eventId: crypto.randomUUID(),
              type: 'sync_required',
              decisionId,
              version: 0,
              timestamp: new Date().toISOString(),
              payload: {
                code: 'access_revoked',
                reason: 'Access to this decision has been revoked',
              },
            });
            client.replyRaw.end();
          } catch {
            // Ignore if socket already closed
          }
          clients.delete(client);
        }
      }
      if (clients.size === 0) {
        this.subscribers.delete(decisionId);
      }
    }

    this.removePresence(decisionId, userId);
    const updatedList = this.getPresence(decisionId);
    this.broadcastEvent(decisionId, {
      type: 'participant.left',
      decisionId,
      version: 0,
      actorId: userId,
      actorName: 'Revoked Collaborator',
      payload: {
        userId,
        reason: 'access_revoked',
        activeParticipants: updatedList,
      },
    });
  }

  /**
   * Closes all active connections and cleans up state when a decision is deleted.
   */
  closeDecision(decisionId: string): void {
    const clients = this.subscribers.get(decisionId);
    if (clients) {
      for (const client of clients) {
        if (client.keepAliveTimer) {
          clearInterval(client.keepAliveTimer);
        }
        try {
          client.replyRaw.end();
        } catch {
          // Ignore
        }
      }
      this.subscribers.delete(decisionId);
    }
    this.presence.delete(decisionId);
    this.eventBuffers.delete(decisionId);
  }

  /**
   * Writes a formatted SSE event to a stream.
   */
  private sendSseMessage(replyRaw: ServerResponse, event: CollaborationEvent<unknown>): void {
    const formatted = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    replyRaw.write(formatted);
  }

  /**
   * Broadcasts an event to all subscribers of a decision.
   */
  broadcastEvent<T>(
    decisionId: string,
    event: Omit<CollaborationEvent<T>, 'eventId' | 'timestamp'>
  ): CollaborationEvent<T> {
    return this.publishEvent(decisionId, event);
  }

  /**
   * Starts periodic timer to prune stale participant presence.
   */
  private startPruneTimer(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const [decisionId, map] of this.presence.entries()) {
        let changed = false;
        for (const [userId, p] of map.entries()) {
          const lastSeen = new Date(p.lastSeenAt).getTime();
          if (now - lastSeen > PRESENCE_TTL_MS) {
            map.delete(userId);
            changed = true;
            this.broadcastEvent(decisionId, {
              type: 'participant.left',
              decisionId,
              version: 0,
              actorId: userId,
              actorName: p.name,
              payload: {
                userId,
                name: p.name,
                reason: 'presence_timeout',
                activeParticipants: Array.from(map.values()),
              },
            });
          }
        }
        if (map.size === 0) {
          this.presence.delete(decisionId);
        } else if (changed) {
          this.broadcastEvent(decisionId, {
            type: 'presence.sync',
            decisionId,
            version: 0,
            payload: { participants: Array.from(map.values()) },
          });
        }
      }
    }, 10_000);

    // Allow process to exit cleanly without keeping event loop alive
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  /**
   * For testing: clear all active subscribers and presence.
   */
  reset(): void {
    for (const clients of this.subscribers.values()) {
      for (const client of clients) {
        if (client.keepAliveTimer) {
          clearInterval(client.keepAliveTimer);
        }
        try {
          client.replyRaw.end();
        } catch {
          // Ignore
        }
      }
    }
    this.subscribers.clear();
    this.presence.clear();
    this.eventBuffers.clear();
  }
}

export const collaborationService = new CollaborationService();
