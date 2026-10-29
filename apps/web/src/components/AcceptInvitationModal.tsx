import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, Loader2, Sparkles, LogIn } from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type InvitationDetailsDto,
} from '../api/index.js';
import { useAuth } from '../hooks/useAuth.js';

export interface AcceptInvitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  onAccepted: (decisionId: string) => void;
}

export const AcceptInvitationModal: React.FC<AcceptInvitationModalProps> = ({
  isOpen,
  onClose,
  token,
  onAccepted,
}) => {
  const { user, isAuthenticated, openAuthModal } = useAuth();

  const [details, setDetails] = useState<InvitationDetailsDto | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && token) {
      setIsLoadingDetails(true);
      setLoadError(null);
      setAcceptError(null);
      setIsSuccess(false);

      apiClient
        .getInvitationDetails(token)
        .then((res) => {
          setDetails(res);
        })
        .catch((err) => {
          if (err instanceof ApiClientError) {
            setLoadError(err.message);
          } else {
            setLoadError('Failed to retrieve invitation details.');
          }
        })
        .finally(() => {
          setIsLoadingDetails(false);
        });
    }
  }, [isOpen, token]);

  if (!isOpen || !token) return null;

  const handleAccept = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    setIsAccepting(true);
    setAcceptError(null);

    try {
      const res = await apiClient.acceptInvitation({ token });
      setIsSuccess(true);
      setTimeout(() => {
        onAccepted(res.decisionId);
        onClose();
      }, 1500);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setAcceptError(err.message);
      } else {
        setAcceptError('Failed to accept invitation.');
      }
    } finally {
      setIsAccepting(false);
    }
  };

  const isEmailMismatch = Boolean(
    isAuthenticated &&
      user &&
      details &&
      user.email.toLowerCase().trim() !== details.email.toLowerCase().trim()
  );

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-background/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md flex flex-col rounded-2xl bg-surface-card border border-border shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border bg-surface shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-signal/15 border border-signal/30 flex items-center justify-center text-signal">
                <Sparkles className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-white">Decision Invitation</h3>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-surface-subtle hover:bg-surface border border-border text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {isLoadingDetails ? (
              <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-signal" />
                <span>Loading invitation details...</span>
              </div>
            ) : loadError ? (
              <div className="p-3.5 rounded-xl bg-accent-rose/10 border border-accent-rose/30 text-xs text-accent-rose flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5">Invitation Invalid</span>
                  <span>{loadError}</span>
                </div>
              </div>
            ) : isSuccess ? (
              <div className="py-6 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-signal mx-auto animate-bounce" />
                <h4 className="text-base font-bold text-white">Invitation Accepted!</h4>
                <p className="text-xs text-slate-400">Loading your shared decision workspace...</p>
              </div>
            ) : details ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-surface border border-border space-y-2.5">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">
                      Decision
                    </span>
                    <h4 className="text-sm font-bold text-white mt-0.5">
                      "{details.decisionTitle}"
                    </h4>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border-subtle text-xs">
                    <span className="text-slate-400">Invited By:</span>
                    <span className="text-slate-200 font-medium">{details.inviterName}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Granted Role:</span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${
                        details.role === 'editor'
                          ? 'bg-signal/15 text-signal border border-signal/30'
                          : 'bg-surface-subtle text-slate-300 border border-border'
                      }`}
                    >
                      {details.role}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Intended For:</span>
                    <span className="text-slate-300 font-mono text-[11px]">{details.email}</span>
                  </div>
                </div>

                {isEmailMismatch && (
                  <div className="p-3 rounded-xl bg-accent-amber/10 border border-accent-amber/30 text-xs text-accent-amber flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      You are signed in as <strong className="text-white">{user?.email}</strong>,
                      but this invite was sent to <strong className="text-white">{details.email}</strong>.
                    </span>
                  </div>
                )}

                {acceptError && (
                  <div className="p-3 rounded-xl bg-accent-rose/10 border border-accent-rose/30 text-xs text-accent-rose flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{acceptError}</span>
                  </div>
                )}

                <div className="pt-2">
                  {!isAuthenticated ? (
                    <button
                      onClick={() => openAuthModal('login')}
                      className="w-full py-2.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-glow-signal-sm cursor-pointer transition-all"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>Sign In to Accept</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleAccept}
                      disabled={isAccepting || isEmailMismatch}
                      className="w-full py-2.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-glow-signal-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {isAccepting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Accepting...</span>
                        </>
                      ) : (
                        <span>Accept Invitation ({details.role})</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
