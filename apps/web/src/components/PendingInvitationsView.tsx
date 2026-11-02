import React, { useState, useRef } from 'react';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  User,
  Key,
  Info,
  ArrowRight,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type PendingInvitationDto,
} from '../api/index.js';

export interface PendingInvitationsViewProps {
  invitations: PendingInvitationDto[];
  isLoading: boolean;
  onRefresh: () => void;
  onAccepted: (decisionId: string) => void;
}

export const PendingInvitationsView: React.FC<PendingInvitationsViewProps> = ({
  invitations,
  isLoading,
  onRefresh,
  onAccepted,
}) => {
  const [manualToken, setManualToken] = useState('');
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const handleRedeemClick = (inv: PendingInvitationDto) => {
    // Populate the token only when the actual invitation response provides it and the flow permits it
    const candidateToken = (inv as any).token;
    if (typeof candidateToken === 'string' && candidateToken.trim()) {
      setManualToken(candidateToken.trim());
    }
    setError(null);
    tokenInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      tokenInputRef.current?.focus();
    }, 150);
  };

  const handleAcceptWithToken = async (tokenToUse: string) => {
    const cleanToken = tokenToUse.trim();
    if (!cleanToken) {
      setError('Please provide an invitation redemption token.');
      return;
    }

    setIsAccepting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await apiClient.acceptInvitation({ token: cleanToken });
      setSuccessMessage(res.message || 'Invitation accepted successfully!');
      setManualToken('');
      onRefresh();
      setTimeout(() => {
        onAccepted(res.decisionId);
      }, 1200);
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to redeem invitation token.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while accepting the invitation.');
      }
    } finally {
      setIsAccepting(false);
    }
  };

  const roleColors: Record<string, string> = {
    editor: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    viewer: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    contributor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Informational Callout */}
      <div className="p-4 rounded-2xl bg-surface-card border border-border-subtle flex items-start gap-3 text-xs text-slate-300">
        <Info className="w-4 h-4 text-signal shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-white">Cryptographic Access Control</p>
          <p className="text-slate-400 leading-relaxed">
            Decision OS protects board-level deliberations with one-time hashed invitation tokens. If you received an invitation link via email or direct message, paste your token below to redeem collaborative access. Note: In accordance with Decision OS API v1 specification, invitations automatically expire at their deadline and backend decline operations are intentionally unsupported.
          </p>
        </div>
      </div>

      {/* Manual Token Redemption Bar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-surface-card border border-border">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
          <Key className="w-4 h-4 text-signal" />
          <span>Redeem Invitation Token</span>
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          Paste the 64-character cryptographic token provided in your invitation link:
        </p>

        {error && (
          <div className="p-3 mb-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 mb-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMessage} Opening decision studio...</span>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAcceptWithToken(manualToken);
          }}
          className="flex flex-col sm:flex-row items-stretch gap-2.5"
        >
          <input
            ref={tokenInputRef}
            type="text"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="Paste raw token e.g. 9f4a1c..."
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface border border-border focus:border-signal text-xs font-mono text-white placeholder-slate-500 focus:outline-none transition-colors"
            disabled={isAccepting}
          />
          <button
            type="submit"
            disabled={isAccepting || !manualToken.trim()}
            className="px-5 py-2.5 rounded-xl bg-signal hover:bg-signal-light disabled:opacity-50 text-background font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-glow-signal-sm shrink-0"
          >
            {isAccepting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Accept Token</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* List of Pending Invitations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
            Pending Invitations Directed to Your Account ({invitations.length})
          </h3>
          {isLoading && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
              <span>Checking invitations...</span>
            </div>
          )}
        </div>

        {invitations.length === 0 ? (
          <div className="p-8 sm:p-12 rounded-2xl bg-surface-card border border-border-subtle flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-surface border border-border flex items-center justify-center text-slate-400 mb-3">
              <Mail className="w-6 h-6 text-slate-500" />
            </div>
            <h4 className="text-sm font-bold text-white">No Pending Invitations</h4>
            <p className="text-xs text-slate-400 max-w-sm mt-1">
              You do not have any pending collaborator invitations at this time. When colleagues share a decision with you, it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {invitations.map((inv) => {
              const inviterName = inv.inviterId?.name || inv.inviterId?.email || 'A collaborator';
              const inviterEmail = inv.inviterId?.email;
              const decisionTitle = inv.decisionId?.title || 'Untitled Decision';
              const expiresDate = formatDate(inv.expiresAt);

              return (
                <div
                  key={inv.id}
                  className="p-4 rounded-2xl bg-surface-card border border-border hover:border-signal/30 transition-all flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md font-mono text-[10px] uppercase font-bold border tracking-wider ${
                          roleColors[inv.role] || roleColors.viewer
                        }`}
                      >
                        {inv.role} Access
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>Expires {expiresDate}</span>
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white line-clamp-1">
                      {decisionTitle}
                    </h4>

                    {inv.decisionId?.description && (
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {inv.decisionId.description}
                      </p>
                    )}

                    <div className="pt-2 flex items-center gap-2 text-xs text-slate-300 font-mono">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">
                        From: <strong className="text-white">{inviterName}</strong>{' '}
                        {inviterEmail && <span className="text-slate-500">({inviterEmail})</span>}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-slate-400">
                    <span className="text-[11px] font-mono text-slate-500">
                      {(inv as any).token ? 'Token available · Click to redeem' : 'Paste invitation token above'}
                    </span>
                    <button
                      onClick={() => handleRedeemClick(inv)}
                      className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-subtle border border-border text-xs text-slate-200 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Focus redemption input"
                    >
                      <span>Redeem</span>
                      <ArrowRight className="w-3 h-3 text-signal" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
