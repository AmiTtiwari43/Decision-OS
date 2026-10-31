# Phase 14: Real-Time Collaboration Specification

## 1. Overview & Objective

Phase 14 delivers real-time collaboration for Decision OS, enabling authorized participants to collaborate on shared decisions with immediate state updates, participant presence, conflict detection, and reconnection resilience without requiring complex external message brokers or altering the canonical MCDA engine.

---

## 2. Architecture & Transport Selection

### Transport: Server-Sent Events (SSE) with Authoritative REST Mutations
- **Transport Protocol**: Server-Sent Events (`text/event-stream` over standard HTTP/1.1 and HTTP/2) at `GET /api/decisions/:id/collaboration/stream`.
- **Directionality & Security**:
  - **Inbound Mutations**: Handled exclusively through authenticated, validated REST endpoints (`PATCH /api/decisions/:id`, `POST /api/decisions/:id/collaboration/presence`, etc.). Clients cannot broadcast arbitrary or forged events to other participants.
  - **Outbound Notifications**: Server broadcasts minimal, structured event notifications over the decision-scoped SSE channel following successful database persistence and audit logging.
- **Infrastructure Footprint**: Native to Node.js and Fastify 5. No external message broker (Redis/RabbitMQ) or heavy socket frameworks required. Fully compatible with standard proxies, load balancers, and testing harnesses.

---

## 3. Event Model & Contract

Every SSE event follows the standard `id: <eventId>\nevent: <eventType>\ndata: <jsonPayload>\n\n` format.

### Event Schema
```typescript
export interface CollaborationEvent<T = unknown> {
  eventId: string;
  type: CollaborationEventType;
  decisionId: string;
  version: number;
  actorId?: string;
  actorName?: string;
  timestamp: string;
  payload: T;
}
```

### Supported Event Types
1. `decision.updated`: Decision title, description, criteria, options, or score matrix modified.
2. `decision.calculation.updated`: Authoritative MCDA evaluation calculated by canonical decision engine.
3. `contribution.submitted`: Expert contribution submitted.
4. `evidence.created`: New evidence record attached.
5. `disagreement.resolved`: Disagreement status resolved.
6. `participant.joined`: Collaborator connected or active in decision.
7. `participant.left`: Collaborator disconnected or timed out.
8. `presence.sync`: Full snapshot of active participants in this decision.
9. `decision.conflict`: Optimistic concurrency collision warning.
10. `sync_required`: Signals that the client's missed event window exceeded the ring buffer and a full REST synchronization is needed.

---

## 4. Participant Presence

- **Nature**: Ephemeral in-memory state per decision channel. Not stored in persistent database collections.
- **Attributes**:
  - `userId`: String ID of authenticated participant.
  - `name`: User display name.
  - `email`: User email.
  - `role`: Decision role (`owner`, `editor`, `viewer`, `contributor`).
  - `joinedAt`: Timestamp when connection was established.
  - `lastSeenAt`: Timestamp of last heartbeat or activity.
- **Heartbeat & Expiration**:
  - Clients send periodic presence pings (`POST /api/decisions/:id/collaboration/presence`) every 15 seconds.
  - Heartbeat expiration threshold is 30 seconds. Stale participants are automatically pruned and a `participant.left` event is broadcast.
  - When an SSE connection terminates cleanly, the participant is immediately removed from presence.

---

## 5. Concurrency & Conflict Detection

- **Optimistic Concurrency**:
  - Decisions track a monotonic integer `version` field (incremented on each update).
  - Mutating endpoints accept an optional `expectedVersion` parameter.
  - If `expectedVersion` is provided and does not match the database `version`, the server rejects the write with `409 Conflict`:
    ```json
    {
      "statusCode": 409,
      "error": "Conflict",
      "message": "Decision has been modified by another participant (current version: 4, expected: 3)",
      "currentVersion": 4
    }
    ```
- **Authoritative MCDA Synchronization**:
  - When decision inputs mutate, the backend invokes `CANONICAL_DECISION_ENGINE_V1`.
  - Authoritative calculation results (`normalizedWeights`, `winnerId`, `evaluations`) are persisted and broadcast.
  - Clients never broadcast authoritative results. Stale client previews are discarded upon receiving authoritative calculation events.

---

## 6. Reconnection & Recovery

- **In-Memory Ring Buffer**: Each decision channel retains the last 100 broadcast events.
- **Resumption**:
  - Clients supply `Last-Event-ID` header or `?lastEventId=<id>`.
  - If the requested event ID exists in the ring buffer, missed events are sequentially streamed before real-time delivery resumes.
  - If the event ID is missing or too old, a `sync_required` event is dispatched, prompting the client to fetch fresh state via `GET /api/decisions/:id`.

---

## 7. Security Controls

- **Authentication**: JWT token required via `Authorization: Bearer <token>` or `?token=<jwt>` query param.
- **Authorization**: Validated via `authorizeDecisionAction(decision, 'read', requester)`. Unrelated users receive `404 Not Found` (enumeration defense).
- **Channel Scoping**: Connections are bound strictly to `decisionId`. Cross-decision event leaking is impossible.
- **Sensitive Data Stripping**: Events contain minimal change summaries; passwords, tokens, and database URIs are never broadcast.

