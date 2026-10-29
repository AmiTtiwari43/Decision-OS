import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Share2,
  Users,
  Clock,
  Shield,
  Check,
  Copy,
  Trash2,
  AlertTriangle,
  Loader2,
  UserCheck,
  Mail,
} from 'lucide-react';
import {
  apiClient,
  ApiClientError,
  type InvitationDto,
  type AccessGrantCollaboratorDto,
  type DecisionCollaboratorRole,
} from '../api/index.js';

export interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  decisionId: string | null;
  decisionTitle: string;
}

type Tab = 'invite' | 'collaborators' | 'pending';

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  decisionId,
  decisionTitle,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('invite');

  // Form state
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<DecisionCollaboratorRole>('editor');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Success state with created token
  const [createdInviteInfo, setCreatedInviteInfo] = useState<{
    token: string;
    link: string;
    recipient: string;
    role: DecisionCollaboratorRole;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // Access and Invitations lists
  const [collaborators, setCollaborators] = useState<AccessGrantCollaboratorDto[]>([]);
  const [ownerInfo, setOwnerInfo] = useState<{ id: string; name: string; email: string } | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<InvitationDto[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Action in-flight states
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  // Load collaborators and invitations when opened
  const fetchSharingData = useCallback(async () => {
    if (!decisionId) return;
    setIsLoadingList(true);
    setListError(null);
    try {
      const [accessRes, invitesRes] = await Promise.all([
        apiClient.listAccessGrants(decisionId),
        apiClient.listInvitations(decisionId),
      ]);
      setOwnerInfo(accessRes.owner);
      setCollaborators(accessRes.collaborators);
      setPendingInvitations(invitesRes.items.filter((i) => i.status === 'pending'));
    } catch (err) {
      if (err instanceof ApiClientError) {
        setListError(err.message);
      } else {
        setListError('Failed to load sharing information.');
      }
    } finally {
      setIsLoadingList(false);
    }
  }, [decisionId]);

  useEffect(() => {
    if (isOpen && decisionId) {
      fetchSharingData();
      setCreatedInviteInfo(null);
      setFormError(null);
    }
  }, [isOpen, decisionId, fetchSharingData]);

  if (!isOpen || !decisionId) return null;

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setFormError('Please enter a recipient email address.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setCreatedInviteInfo(null);

    try {
      const res = await apiClient.createInvitation(decisionId, {
        email: email.trim().toLowerCase(),
        role,
      });

      const fullLink = `${window.location.origin}?inviteToken=${res.token}`;
      setCreatedInviteInfo({
        token: res.token,
        link: fullLink,
        recipient: email.trim().toLowerCase(),
        role,
      });

      // Clear input and reload list
      setEmail('');
      await fetchSharingData();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to create invitation.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = (text: string, isToken: boolean) => {
    navigator.clipboard.writeText(text);
    if (isToken) {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleUpdateRole = async (grantId: string, newRole: DecisionCollaboratorRole) => {
    setActionInProgressId(grantId);
    try {
      await apiClient.updateAccessGrant(decisionId, grantId, { role: newRole });
      await fetchSharingData();
    } catch (err) {
      alert((err as Error)?.message || 'Failed to update collaborator role');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleRevokeAccess = async (grantId: string) => {
    if (!confirm('Are you sure you want to revoke this user’s access to the decision?')) return;
    setActionInProgressId(grantId);
    try {
      await apiClient.revokeAccess(decisionId, grantId);
      await fetchSharingData();
    } catch (err) {
      alert((err as Error)?.message || 'Failed to revoke collaborator access');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    setActionInProgressId(invitationId);
    try {
      await apiClient.revokeInvitation(decisionId, invitationId);
      await fetchSharingData();
    } catch (err) {
      alert((err as Error)?.message || 'Failed to revoke invitation');
    } finally {
      setActionInProgressId(null);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-background/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl flex flex-col rounded-2xl bg-surface-card border border-border shadow-2xl overflow-hidden"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-surface shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-signal">
                <Share2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span>Share Decision</span>
                  <span className="text-xs font-mono text-signal bg-signal/10 px-2 py-0.5 rounded border border-signal/20">
                    Phase 6
                  </span>
                </h3>
                <p className="text-xs text-slate-400 truncate max-w-md" title={decisionTitle}>
                  "{decisionTitle}"
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-surface-subtle hover:bg-surface border border-border text-slate-400 hover:text-white transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center border-b border-border-subtle bg-surface-subtle/50 px-4 pt-2 gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('invite')}
              className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'invite'
                  ? 'border-signal text-signal bg-surface'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Invite</span>
            </button>

            <button
              onClick={() => setActiveTab('collaborators')}
              className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'collaborators'
                  ? 'border-signal text-signal bg-surface'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Collaborators ({collaborators.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'pending'
                  ? 'border-signal text-signal bg-surface'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Pending Invites ({pendingInvitations.length})</span>
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh]">
            {/* TAB 1: INVITE */}
            {activeTab === 'invite' && (
              <div className="space-y-5">
                <form onSubmit={handleCreateInvitation} className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono uppercase text-slate-300 font-semibold mb-1.5">
                      Recipient Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="collaborator@example.com"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-border text-white text-sm focus:outline-none focus:border-signal/70 focus:ring-1 focus:ring-signal/30 placeholder-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase text-slate-300 font-semibold mb-1.5">
                      Permission Level
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div
                        onClick={() => setRole('editor')}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          role === 'editor'
                            ? 'bg-signal/10 border-signal text-white shadow-glow-signal-sm'
                            : 'bg-surface border-border text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm">Editor</span>
                          <span className="text-[10px] font-mono uppercase text-signal bg-signal/10 px-1.5 py-0.5 rounded">
                            Can Edit
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Can calibrate criteria weights, enter option scores, and compute authoritative MCDA results.
                        </p>
                      </div>

                      <div
                        onClick={() => setRole('viewer')}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          role === 'viewer'
                            ? 'bg-signal/10 border-signal text-white shadow-glow-signal-sm'
                            : 'bg-surface border-border text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm">Viewer</span>
                          <span className="text-[10px] font-mono uppercase text-slate-400 bg-surface-subtle px-1.5 py-0.5 rounded border border-border">
                            Read Only
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Can inspect decision inputs, options, and view analytical reports without altering values.
                        </p>
                      </div>
                    </div>
                  </div>

                  {formError && (
                    <div className="p-3 rounded-xl bg-accent-rose/10 border border-accent-rose/30 flex items-start gap-2.5 text-xs text-accent-rose">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{formError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-slate-400">
                      Invitations expire automatically after 7 days.
                    </span>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-5 py-2.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs sm:text-sm flex items-center gap-2 shadow-glow-signal-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Share2 className="w-4 h-4" />
                          <span>Generate Invitation</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Success Card with Sharable Token and Link */}
                {createdInviteInfo && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-surface border border-signal/40 space-y-3"
                  >
                    <div className="flex items-center gap-2 text-signal text-xs font-bold">
                      <UserCheck className="w-4 h-4" />
                      <span>Invitation created for {createdInviteInfo.recipient} ({createdInviteInfo.role})</span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-surface-subtle border border-border text-[11px] text-slate-300 leading-relaxed">
                      <span className="font-bold text-accent-amber block mb-0.5">
                        Notice on Email Delivery:
                      </span>
                      External email delivery is not configured in this environment. Share the invitation link or token directly with the recipient:
                    </div>

                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                          Invitation Link
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={createdInviteInfo.link}
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-xs font-mono text-slate-300 focus:outline-none select-all"
                          />
                          <button
                            onClick={() => handleCopy(createdInviteInfo.link, false)}
                            className="px-3 py-1.5 rounded-lg bg-signal/20 hover:bg-signal/30 text-signal border border-signal/40 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                          </button>
                        </div>
                      </div>

                      <div>
                        <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                          Direct Token
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={createdInviteInfo.token}
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-card border border-border text-xs font-mono text-slate-300 focus:outline-none select-all"
                          />
                          <button
                            onClick={() => handleCopy(createdInviteInfo.token, true)}
                            className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-subtle text-slate-300 border border-border text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedToken ? 'Copied' : 'Copy Token'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* TAB 2: ACTIVE COLLABORATORS */}
            {activeTab === 'collaborators' && (
              <div className="space-y-4">
                {listError && (
                  <div className="p-3 rounded-xl bg-accent-rose/10 border border-accent-rose/30 text-xs text-accent-rose">
                    {listError}
                  </div>
                )}

                {/* Owner Row */}
                {ownerInfo && (
                  <div className="p-3.5 rounded-xl bg-surface border border-border flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-signal/15 border border-signal/30 flex items-center justify-center text-signal font-bold text-xs">
                        {ownerInfo.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{ownerInfo.name}</span>
                          <span className="text-[10px] font-mono bg-signal/10 text-signal border border-signal/30 px-1.5 py-0.5 rounded font-semibold">
                            OWNER
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">{ownerInfo.email}</span>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-slate-500 italic">Full Control</span>
                  </div>
                )}

                {/* Collaborators List */}
                {isLoadingList ? (
                  <div className="p-6 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-signal" />
                    <span>Loading collaborators...</span>
                  </div>
                ) : collaborators.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-xl">
                    <Shield className="w-6 h-6 text-slate-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 font-medium">
                      No active collaborators yet.
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Invite a team member using the "Invite" tab.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {collaborators.map((c) => (
                      <div
                        key={c.id}
                        className="p-3.5 rounded-xl bg-surface border border-border flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-surface-subtle border border-border flex items-center justify-center text-slate-300 font-bold text-xs">
                            {c.user.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white">{c.user.name}</span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold uppercase ${
                                  c.role === 'editor'
                                    ? 'bg-signal/10 text-signal border border-signal/20'
                                    : 'bg-surface-subtle text-slate-400 border border-border'
                                }`}
                              >
                                {c.role}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400">{c.user.email}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <select
                            value={c.role}
                            disabled={actionInProgressId === c.id}
                            onChange={(e) =>
                              handleUpdateRole(c.id, e.target.value as DecisionCollaboratorRole)
                            }
                            className="px-2.5 py-1 rounded-lg bg-surface-card border border-border text-xs text-slate-300 focus:outline-none cursor-pointer"
                          >
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>

                          <button
                            onClick={() => handleRevokeAccess(c.id)}
                            disabled={actionInProgressId === c.id}
                            title="Revoke collaborator access"
                            className="p-1.5 rounded-lg bg-surface-subtle hover:bg-accent-rose/20 text-slate-400 hover:text-accent-rose border border-border transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PENDING INVITATIONS */}
            {activeTab === 'pending' && (
              <div className="space-y-4">
                {isLoadingList ? (
                  <div className="p-6 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-signal" />
                    <span>Loading invitations...</span>
                  </div>
                ) : pendingInvitations.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-xl">
                    <Clock className="w-6 h-6 text-slate-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 font-medium">
                      No pending invitations.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingInvitations.map((inv) => (
                      <div
                        key={inv.id}
                        className="p-3.5 rounded-xl bg-surface border border-border flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{inv.email}</span>
                            <span className="text-[10px] font-mono bg-accent-amber/10 text-accent-amber border border-accent-amber/30 px-1.5 py-0.5 rounded font-semibold uppercase">
                              {inv.role}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
                            Expires {new Date(inv.expiresAt).toLocaleDateString()}
                          </span>
                        </div>

                        <button
                          onClick={() => handleRevokeInvitation(inv.id)}
                          disabled={actionInProgressId === inv.id}
                          className="px-2.5 py-1 rounded-lg bg-accent-rose/10 hover:bg-accent-rose/20 text-accent-rose border border-accent-rose/30 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Revoke</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

