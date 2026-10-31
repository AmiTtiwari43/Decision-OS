import { useEffect, useState, useRef, useCallback } from 'react';
import { apiClient } from '../api/client.js';
import type {
  ParticipantPresenceDto,
  CollaborationEventDto,
  CollaborationEventType,
} from '../api/types.js';

export type RealtimeConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface DecisionConflictState {
  hasConflict: boolean;
  serverVersion?: number;
  actorName?: string;
  message?: string;
}

export interface UseRealtimeCollaborationOptions {
  decisionId: string | null;
  enabled?: boolean;
  isDirty?: boolean;
  currentView?: string;
  onDecisionUpdated?: (payload: any) => void;
  onCalculationUpdated?: (payload: any) => void;
  onEventReceived?: (event: CollaborationEventDto) => void;
  onSyncRequired?: () => void;
}

export interface UseRealtimeCollaborationReturn {
  connectionStatus: RealtimeConnectionStatus;
  activeParticipants: ParticipantPresenceDto[];
  lastEventId: string | null;
  conflictState: DecisionConflictState | null;
  dismissConflict: () => void;
  reconnect: () => void;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_BASE_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function useRealtimeCollaboration({
  decisionId,
  enabled = true,
  isDirty = false,
  currentView = 'decision',
  onDecisionUpdated,
  onCalculationUpdated,
  onEventReceived,
  onSyncRequired,
}: UseRealtimeCollaborationOptions): UseRealtimeCollaborationReturn {
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>('disconnected');
  const [activeParticipants, setActiveParticipants] = useState<ParticipantPresenceDto[]>([]);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<DecisionConflictState | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const connectStreamRef = useRef<() => void>(() => {});
  const isDirtyRef = useRef<boolean>(isDirty);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const callbacksRef = useRef({
    onDecisionUpdated,
    onCalculationUpdated,
    onEventReceived,
    onSyncRequired,
  });

  useEffect(() => {
    callbacksRef.current = {
      onDecisionUpdated,
      onCalculationUpdated,
      onEventReceived,
      onSyncRequired,
    };
  }, [onDecisionUpdated, onCalculationUpdated, onEventReceived, onSyncRequired]);

  const dismissConflict = useCallback(() => {
    setConflictState(null);
  }, []);

  const connectStream = useCallback(() => {
    if (!decisionId || !enabled) {
      return;
    }

    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const streamUrl = apiClient.getCollaborationStreamUrl(
        decisionId,
        lastEventId || undefined
      );

      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
      };

      const handleEventMessage = (event: MessageEvent, eventType: CollaborationEventType) => {
        try {
          const parsed = JSON.parse(event.data) as CollaborationEventDto;
          if (parsed.eventId) {
            setLastEventId(parsed.eventId);
          }

          callbacksRef.current.onEventReceived?.(parsed);

          switch (eventType) {
            case 'presence.sync': {
              const payload = parsed.payload as { participants?: ParticipantPresenceDto[] };
              if (payload?.participants) {
                setActiveParticipants(payload.participants);
              }
              break;
            }

            case 'participant.joined': {
              const payload = parsed.payload as { activeParticipants?: ParticipantPresenceDto[] };
              if (payload?.activeParticipants) {
                setActiveParticipants(payload.activeParticipants);
              }
              break;
            }

            case 'participant.left': {
              const payload = parsed.payload as { activeParticipants?: ParticipantPresenceDto[] };
              if (payload?.activeParticipants) {
                setActiveParticipants(payload.activeParticipants);
              }
              break;
            }

            case 'decision.updated': {
              if (isDirtyRef.current) {
                // User has unsaved edits in progress: do NOT overwrite their changes!
                setConflictState({
                  hasConflict: true,
                  serverVersion: parsed.version,
                  actorName: parsed.actorName || 'Another participant',
                  message: `${parsed.actorName || 'Another participant'} modified this decision. Your unsaved changes are preserved.`,
                });
              } else {
                // User is in sync: seamlessly apply the updated model
                callbacksRef.current.onDecisionUpdated?.(parsed.payload);
              }
              break;
            }

            case 'decision.calculation.updated': {
              if (isDirtyRef.current) {
                setConflictState({
                  hasConflict: true,
                  serverVersion: parsed.version,
                  actorName: parsed.actorName || 'Another participant',
                  message: `New calculations are available from ${parsed.actorName || 'server'}. Review before saving.`,
                });
              } else {
                callbacksRef.current.onCalculationUpdated?.(parsed.payload);
              }
              break;
            }

            case 'sync_required': {
              callbacksRef.current.onSyncRequired?.();
              break;
            }

            default:
              break;
          }
        } catch {
          // Non-JSON or parse error
        }
      };

      const registeredEventTypes: CollaborationEventType[] = [
        'stream.connected',
        'presence.sync',
        'participant.joined',
        'participant.left',
        'decision.updated',
        'decision.calculation.updated',
        'contribution.submitted',
        'evidence.created',
        'disagreement.resolved',
        'sync_required',
      ];

      for (const evType of registeredEventTypes) {
        es.addEventListener(evType, (event: MessageEvent) => {
          handleEventMessage(event, evType);
        });
      }

      es.onerror = () => {
        setConnectionStatus('reconnecting');
        es.close();
        eventSourceRef.current = null;

        // Exponential backoff reconnect
        const attempt = reconnectAttemptsRef.current;
        const delay = Math.min(
          MAX_RECONNECT_DELAY_MS,
          RECONNECT_BASE_DELAY_MS * Math.pow(1.5, attempt)
        );
        reconnectAttemptsRef.current = attempt + 1;

        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = setTimeout(() => {
          connectStreamRef.current();
        }, delay);
      };
    } catch {
      setConnectionStatus('disconnected');
    }
  }, [decisionId, enabled, lastEventId]);

  useEffect(() => {
    connectStreamRef.current = connectStream;
  }, [connectStream]);

  // Handle presence heartbeat interval
  useEffect(() => {
    if (!decisionId || !enabled || connectionStatus !== 'connected') {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      return;
    }

    const sendHeartbeat = async () => {
      try {
        const res = await apiClient.sendPresenceHeartbeat(decisionId, {
          status: 'active',
          currentView,
        });
        if (res.items) {
          setActiveParticipants(res.items);
        } else if (res.participants) {
          setActiveParticipants(res.participants);
        }
      } catch {
        // Silently tolerate transient heartbeat drop
      }
    };

    heartbeatTimerRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [decisionId, enabled, connectionStatus, currentView]);

  // Main lifecycle effect for connection
  useEffect(() => {
    if (decisionId && enabled) {
      connectStream();
    } else {
      setConnectionStatus('disconnected');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [decisionId, enabled, connectStream]);

  return {
    connectionStatus,
    activeParticipants,
    lastEventId,
    conflictState,
    dismissConflict,
    reconnect: connectStream,
  };
}
