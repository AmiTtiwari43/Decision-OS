import React from 'react';
import {
  Layers,
  UserCheck,
  Share2,
  Mail,
  Award,
} from 'lucide-react';

export interface PortfolioSummaryProps {
  totalDecisions: number;
  ownedCount: number;
  sharedCount: number;
  pendingInvitationsCount: number;
  decisiveCount: number;
  averagePointLead?: number;
  activeFilter?: string;
  onFilterChange?: (filter: 'all' | 'owner' | 'shared') => void;
  onSelectInvitations?: () => void;
}

export const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({
  totalDecisions,
  ownedCount,
  sharedCount,
  pendingInvitationsCount,
  decisiveCount,
  averagePointLead = 0,
  activeFilter = 'all',
  onFilterChange,
  onSelectInvitations,
}) => {
  const decisiveRate =
    totalDecisions > 0 ? Math.round((decisiveCount / totalDecisions) * 100) : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      {/* Total Decisions */}
      <div
        onClick={() => onFilterChange?.('all')}
        className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
          activeFilter === 'all'
            ? 'bg-surface-card border-signal/50 shadow-glow-signal-sm'
            : 'bg-surface-card/70 border-border hover:border-slate-600'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-slate-400 font-medium">Total Portfolio</span>
          <div className="w-7 h-7 rounded-lg bg-signal/10 border border-signal/20 flex items-center justify-center text-signal">
            <Layers className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
            {totalDecisions}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Decisions in workspace
          </div>
        </div>
      </div>

      {/* Owned by Me */}
      <div
        onClick={() => onFilterChange?.('owner')}
        className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
          activeFilter === 'owner'
            ? 'bg-surface-card border-signal/50 shadow-glow-signal-sm'
            : 'bg-surface-card/70 border-border hover:border-slate-600'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-slate-400 font-medium">Owned By Me</span>
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <UserCheck className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
            {ownedCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Primary author & owner
          </div>
        </div>
      </div>

      {/* Shared with Me */}
      <div
        onClick={() => onFilterChange?.('shared')}
        className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
          activeFilter === 'shared'
            ? 'bg-surface-card border-signal/50 shadow-glow-signal-sm'
            : 'bg-surface-card/70 border-border hover:border-slate-600'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-slate-400 font-medium">Shared With Me</span>
          <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Share2 className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
            {sharedCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Collaborative access
          </div>
        </div>
      </div>

      {/* Decisive Ratio / Avg Lead */}
      <div className="p-4 rounded-2xl bg-surface-card/70 border border-border flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-slate-400 font-medium">Decisiveness</span>
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Award className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
            {decisiveRate}%
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {decisiveCount} decisive · {averagePointLead > 0 ? `+${averagePointLead.toFixed(1)}pt avg` : 'tie/evaluating'}
          </div>
        </div>
      </div>

      {/* Pending Invitations */}
      <div
        onClick={onSelectInvitations}
        className={`col-span-2 lg:col-span-1 p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
          pendingInvitationsCount > 0
            ? 'bg-signal/10 border-signal/40 shadow-glow-signal-sm'
            : 'bg-surface-card/70 border-border hover:border-slate-600'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-slate-400 font-medium">Pending Invites</span>
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              pendingInvitationsCount > 0
                ? 'bg-signal text-background animate-pulse font-bold'
                : 'bg-slate-700/30 text-slate-400 border border-slate-700/50'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-3">
          <div
            className={`text-2xl sm:text-3xl font-extrabold font-mono ${
              pendingInvitationsCount > 0 ? 'text-signal' : 'text-slate-300'
            }`}
          >
            {pendingInvitationsCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {pendingInvitationsCount > 0
              ? 'Action required to redeem'
              : 'All invitations cleared'}
          </div>
        </div>
      </div>
    </div>
  );
};
