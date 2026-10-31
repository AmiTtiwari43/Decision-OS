import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, AlertTriangle, RefreshCw, X, Radio } from 'lucide-react';
import type { ParticipantPresenceDto } from '../api/types.js';
import type { RealtimeConnectionStatus, DecisionConflictState } from '../hooks/useRealtimeCollaboration.js';

interface RealtimePresenceBarProps {
  connectionStatus: RealtimeConnectionStatus;
  activeParticipants: ParticipantPresenceDto[];
  conflictState: DecisionConflictState | null;
  onDismissConflict: () => void;
  onReviewConflict?: () => void;
  onReconnect?: () => void;
}

export const RealtimePresenceBar: React.FC<RealtimePresenceBarProps> = ({
  connectionStatus,
  activeParticipants,
  conflictState,
  onDismissConflict,
  onReviewConflict,
  onReconnect,
}) => {
  const roleColors: Record<string, string> = {
    owner: 'border-amber-400 bg-amber-400/20 text-amber-300',
    editor: 'border-emerald-400 bg-emerald-400/20 text-emerald-300',
    viewer: 'border-sky-400 bg-sky-400/20 text-sky-300',
    contributor: 'border-purple-400 bg-purple-400/20 text-purple-300',
  };

  const getInitials = (name?: string, email?: string) => {
    const text = name || email || '?';
    return text.slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Collaboration Status & Presence Avatars */}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-surface-subtle/80 border-b border-border-subtle text-xs">
        {/* Left: Connection Status */}
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Sync</span>
            </span>
          )}

          {connectionStatus === 'reconnecting' && (
            <button
              onClick={onReconnect}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all cursor-pointer"
              title="Reconnecting to real-time stream. Click to retry now."
            >
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              <span>Reconnecting...</span>
            </button>
          )}

          {connectionStatus === 'disconnected' && (
            <button
              onClick={onReconnect}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20 hover:bg-slate-500/20 transition-all cursor-pointer"
              title="Real-time collaboration disconnected. Click to reconnect."
            >
              <WifiOff className="w-2.5 h-2.5" />
              <span>Offline</span>
            </button>
          )}
        </div>

        {/* Right: Active Collaborators List */}
        <div className="flex items-center gap-2">
          {activeParticipants.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                {activeParticipants.length} {activeParticipants.length === 1 ? 'collaborator' : 'collaborators'}:
              </span>
              <div className="flex items-center -space-x-1.5 overflow-hidden">
                {activeParticipants.slice(0, 4).map((p) => {
                  const roleClass = roleColors[p.role] || 'border-slate-500 bg-slate-700 text-slate-200';
                  return (
                    <div
                      key={p.userId}
                      className={`relative w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold uppercase transition-transform hover:scale-110 hover:z-10 cursor-help ${roleClass}`}
                      title={`${p.name} (${p.role}) - ${p.status === 'active' ? 'Active' : 'Idle'}`}
                    >
                      {getInitials(p.name, p.email)}
                      {p.status === 'active' && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-background" />
                      )}
                    </div>
                  );
                })}
                {activeParticipants.length > 4 && (
                  <div className="w-6 h-6 rounded-full border-2 border-border bg-surface-subtle text-slate-300 flex items-center justify-center text-[9px] font-mono font-bold">
                    +{activeParticipants.length - 4}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
              <Radio className="w-3 h-3 text-slate-600" />
              <span>Awaiting collaborators</span>
            </span>
          )}
        </div>
      </div>

      {/* Non-Destructive Conflict Warning Banner */}
      <AnimatePresence>
        {conflictState?.hasConflict && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mx-3"
          >
            <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs shadow-lg">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <div className="font-semibold text-white">Concurrent Update Notice</div>
                  <div className="text-amber-200/80 text-[11px]">
                    {conflictState.message ||
                      'Another participant has modified this decision. Your unsaved edits are preserved.'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {onReviewConflict && (
                  <button
                    onClick={onReviewConflict}
                    className="px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-background font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Review Server State
                  </button>
                )}
                <button
                  onClick={onDismissConflict}
                  className="p-1 rounded hover:bg-amber-400/20 text-amber-300 hover:text-white transition-colors cursor-pointer"
                  title="Dismiss warning and keep my local edits"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
