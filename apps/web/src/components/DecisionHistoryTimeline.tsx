import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  User,
  ShieldCheck,
  Layers,
  Filter,
} from 'lucide-react';
import { sound } from '../utils/audioFx';

interface DecisionHistoryTimelineProps {
  onOpenSandbox: () => void;
  onOpenAudit?: () => void;
}

interface DetailedAuditEvent {
  seq: string;
  action: string;
  category: 'core' | 'criteria' | 'options' | 'scores' | 'collaboration' | 'ai' | 'analysis' | 'governance';
  actor: {
    name: string;
    role: string;
    email: string;
  };
  timestamp: string;
  summary: string;
  outcome?: string;
  diff: Record<string, unknown>;
  hash: string;
  previousHash: string;
}

const detailedAuditTrail: DetailedAuditEvent[] = [
  {
    seq: '#001',
    action: 'decision.created',
    category: 'core',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 09:00:00 UTC',
    summary: 'Created "Cloud Architecture Modernization & Framework Selection" decision workspace.',
    outcome: 'Workspace Initialized',
    diff: {
      title: 'Cloud Architecture Modernization & Framework Selection',
      methodology: 'WSM (Weighted Sum Model)',
      status: 'draft',
      initialCriteriaCount: 0,
      initialOptionsCount: 0,
    },
    hash: 'sha256-a1b2c3d4e5f60001',
    previousHash: 'GENESIS',
  },
  {
    seq: '#002',
    action: 'criteria.added',
    category: 'criteria',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 09:12:30 UTC',
    summary: 'Configured 4 core evaluation criteria: Developer Velocity, Type Safety, Ecosystem Adoption, Infra TCO.',
    outcome: '4 Criteria Configured',
    diff: {
      addedCriteria: [
        { id: 'crit-vel', name: 'Developer Velocity', direction: 'maximize', weight: 25 },
        { id: 'crit-type', name: 'Type Safety & Robustness', direction: 'maximize', weight: 25 },
        { id: 'crit-eco', name: 'Ecosystem & Community', direction: 'maximize', weight: 25 },
        { id: 'crit-cost', name: 'Infra TCO & Compute Spend', direction: 'minimize', weight: 25 },
      ],
      totalWeight: 100,
    },
    hash: 'sha256-b2c3d4e5f6a10002',
    previousHash: 'sha256-a1b2c3d4e5f60001',
  },
  {
    seq: '#003',
    action: 'criteria.weight_updated',
    category: 'criteria',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 09:20:15 UTC',
    summary: 'Rebalanced criteria weights to prioritize technical agility: Velocity 35%, Type Safety 25%, Ecosystem 20%, Cost 20%.',
    outcome: 'Weights Rebalanced (Sum = 100%)',
    diff: {
      weightChanges: {
        'Developer Velocity': { previous: 25, updated: 35, delta: '+10%' },
        'Type Safety & Robustness': { previous: 25, updated: 25, delta: '0%' },
        'Ecosystem & Community': { previous: 25, updated: 20, delta: '-5%' },
        'Infra TCO & Compute Spend': { previous: 25, updated: 20, delta: '-5%' },
      },
    },
    hash: 'sha256-c3d4e5f6a1b20003',
    previousHash: 'sha256-b2c3d4e5f6a10002',
  },
  {
    seq: '#004',
    action: 'option.added',
    category: 'options',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 09:35:00 UTC',
    summary: 'Added candidate alternatives: Option Alpha (React + Fastify) and Option Beta (Next.js Fullstack).',
    outcome: '2 Alternatives Defined',
    diff: {
      addedOptions: [
        { id: 'opt-alpha', name: 'Option Alpha (React + Fastify)', description: 'Decoupled Vite client + Fastify REST/tRPC' },
        { id: 'opt-beta', name: 'Option Beta (Next.js Fullstack)', description: 'Monolithic SSR/RSC application deployed to Vercel/Node' },
      ],
    },
    hash: 'sha256-d4e5f6a1b2c30004',
    previousHash: 'sha256-c3d4e5f6a1b20003',
  },
  {
    seq: '#005',
    action: 'score.updated',
    category: 'scores',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 09:50:22 UTC',
    summary: 'Assigned baseline technical evaluation scores based on Q3 engineering benchmark harness.',
    outcome: 'Score Matrix Populated',
    diff: {
      scores: {
        'Option Alpha': { 'Developer Velocity': 92, 'Type Safety': 90, Ecosystem: 80, 'Infra TCO': 75 },
        'Option Beta': { 'Developer Velocity': 78, 'Type Safety': 82, Ecosystem: 94, 'Infra TCO': 85 },
      },
    },
    hash: 'sha256-e5f6a1b2c3d40005',
    previousHash: 'sha256-d4e5f6a1b2c30004',
  },
  {
    seq: '#006',
    action: 'sharing.invited',
    category: 'collaboration',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 10:05:00 UTC',
    summary: 'Invited CFO Marcus Vance (marcus@lead.org) and CPO Sarah Chen (sarah@lead.org) as contributing domain experts.',
    outcome: '2 Expert Invitations Dispatched',
    diff: {
      invitedStakeholders: [
        { email: 'marcus@lead.org', role: 'contributor', department: 'Finance' },
        { email: 'sarah@lead.org', role: 'contributor', department: 'Product' },
      ],
    },
    hash: 'sha256-f6a1b2c3d4e50006',
    previousHash: 'sha256-e5f6a1b2c3d40005',
  },
  {
    seq: '#007',
    action: 'contribution.submitted',
    category: 'collaboration',
    actor: { name: 'Marcus Vance', role: 'Chief Financial Officer', email: 'marcus@lead.org' },
    timestamp: '2026-10-31 10:28:40 UTC',
    summary: 'Marcus Vance submitted independent criteria weighting favoring Infra TCO (40%) and Ecosystem (25%).',
    outcome: 'CFO Contribution Submitted',
    diff: {
      contributorWeightAllocation: {
        'Infra TCO & Compute Spend': 40,
        'Ecosystem & Community': 25,
        'Developer Velocity': 20,
        'Type Safety & Robustness': 15,
      },
      rationale: 'Vendor consolidation reduces recurring observability SaaS costs.',
    },
    hash: 'sha256-a2b3c4d5e6f10007',
    previousHash: 'sha256-f6a1b2c3d4e50006',
  },
  {
    seq: '#008',
    action: 'contribution.adopted',
    category: 'collaboration',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 10:45:10 UTC',
    summary: 'Adopted CFO Marcus Vance\'s contribution into consensus aggregated weighting model (σ = 0.08 dispersion).',
    outcome: 'Multi-Stakeholder Consensus Formed',
    diff: {
      adoptedContributionId: 'contrib-cfo-901',
      consensusMethod: 'Normalized Arithmetic Mean',
      resultingConsensusWeights: {
        'Developer Velocity': 30,
        'Type Safety & Robustness': 22.5,
        'Ecosystem & Community': 22.5,
        'Infra TCO & Compute Spend': 25,
      },
    },
    hash: 'sha256-b3c4d5e6f1a20008',
    previousHash: 'sha256-a2b3c4d5e6f10007',
  },
  {
    seq: '#009',
    action: 'ai.analysis_generated',
    category: 'ai',
    actor: { name: 'AI Advisory Analyst', role: 'Non-Authoritative Advisor', email: 'system.ai_analyst' },
    timestamp: '2026-10-31 11:00:15 UTC',
    summary: 'Synthesized advisory stress-test briefing: identified single-metric anchoring and calculated tipping point at Cost = 36.4%.',
    outcome: 'Rule #14 Compliant Advisory Briefing',
    diff: {
      detectedBiases: ['Single-metric salary/cost anchoring', 'Loss aversion toward framework migration'],
      counterfactualTippingPoint: 'Option Beta flips to leader if Infra TCO weight exceeds 36.4%',
      engineIsolation: 'AI did NOT calculate or modify authoritative MCDA scores',
    },
    hash: 'sha256-c4d5e6f1a2b30009',
    previousHash: 'sha256-b3c4d5e6f1a20008',
  },
  {
    seq: '#010',
    action: 'decision.analyzed',
    category: 'analysis',
    actor: { name: 'Deterministic MCDA Engine v1', role: 'Authoritative Core', email: 'system.engine_v1' },
    timestamp: '2026-10-31 11:15:00 UTC',
    summary: 'Executed authoritative MCDA calculation: Option Alpha wins with 84.50 weighted points vs Option Beta (80.50 pts).',
    outcome: 'Option Alpha Confirmed Leader (+4.00 pts)',
    diff: {
      winnerId: 'opt-alpha',
      winnerName: 'Option Alpha (React + Fastify)',
      finalRankings: [
        { rank: 1, option: 'Option Alpha (React + Fastify)', weightedScore: 84.50, deltaToLeader: 0 },
        { rank: 2, option: 'Option Beta (Next.js Fullstack)', weightedScore: 80.50, deltaToLeader: -4.00 },
      ],
      stabilityMargin: 'Moderate (+4.00 pt cushion)',
    },
    hash: 'sha256-d5e6f1a2b3c40010',
    previousHash: 'sha256-c4d5e6f1a2b30009',
  },
  {
    seq: '#011',
    action: 'sharing.role_updated',
    category: 'governance',
    actor: { name: 'Elena Rostova', role: 'Decision Owner / CTO', email: 'elena@lead.org' },
    timestamp: '2026-10-31 11:30:00 UTC',
    summary: 'Promoted decision to Finalized state; sealed permissions and granted Executive Sponsor audit access.',
    outcome: 'Decision Sealed for Governance Review',
    diff: {
      previousStatus: 'deliberation',
      updatedStatus: 'finalized',
      auditHeadVerified: true,
      executiveAuditorsAdded: ['board-audit@lead.org'],
    },
    hash: 'sha256-e6f1a2b3c4d50011',
    previousHash: 'sha256-d5e6f1a2b3c40010',
  },
];

const narrativeStages = [
  {
    version: 'v1.0',
    title: 'Gut-Feel Default (Salary / Cost Anchoring)',
    timestamp: 'Initial Dilemma',
    summary: 'Subjectively favored Option Beta purely due to perceived vendor consolidation, ignoring developer velocity bottlenecks and framework lock-in.',
    winner: 'Option Beta (Intuitive Bias)',
    tag: 'Unstructured',
    tagColor: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  },
  {
    version: 'v1.1',
    title: 'Multi-Criteria Parameterization',
    timestamp: '+15 mins',
    summary: 'Framed 4 explicit criteria: Developer Velocity (35%), Type Safety (25%), Ecosystem (20%), Infra TCO (20%). Option Alpha surges ahead by +4.0 pts.',
    winner: 'Option Alpha (84.5 pts)',
    tag: 'MCDA Applied',
    tagColor: 'text-signal bg-signal/10 border-signal/20',
  },
  {
    version: 'v1.2',
    title: 'Sensitivity Stress-Test Discovery',
    timestamp: '+25 mins',
    summary: 'Discovered analytical tipping point: If Infra TCO exceeds 36.4%, Option Beta flips to leader. Verified that developer agility remains organizational priority.',
    winner: 'Tipping Point Validated',
    tag: 'Sensitivity Solved',
    tagColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  {
    version: 'v1.3',
    title: 'Verified Decision Briefing Exported',
    timestamp: 'Final Choice',
    summary: 'Generated deterministic briefing ticket with SHA-256 hash proof to defend before executive committee. 100% confidence, zero second-guessing.',
    winner: 'Option Alpha Accepted 🏆',
    tag: 'Airtight Defense',
    tagColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  },
];

export const DecisionHistoryTimeline: React.FC<DecisionHistoryTimelineProps> = ({
  onOpenSandbox,
  onOpenAudit,
}) => {
  const [viewMode, setViewMode] = useState<'audit' | 'narrative'>('audit');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expandedSeq, setExpandedSeq] = useState<string | null>('#003');

  const filteredEvents = detailedAuditTrail.filter((evt) => {
    if (categoryFilter === 'all') return true;
    return evt.category === categoryFilter;
  });

  const getActionBadgeClass = (action: string) => {
    if (action.startsWith('criteria.')) return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    if (action.startsWith('option.')) return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
    if (action.startsWith('score.')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    if (action.startsWith('sharing.')) return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
    if (action.startsWith('contribution.')) return 'bg-teal-500/10 text-teal-400 border-teal-500/30';
    if (action.startsWith('ai.')) return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
    if (action.startsWith('decision.analyzed')) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    return 'bg-signal/10 text-signal border-signal/30';
  };

  return (
    <section className="py-24 md:py-32 relative border-t border-border-subtle bg-surface-subtle/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-border text-xs font-mono font-medium text-slate-300 mb-3">
            <History className="w-3.5 h-3.5 text-signal" />
            <span>Explainable Decision Provenance · From Inception to Sign-Off</span>
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            How a decision evolves.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400">
            From intuitive dilemma to mathematical clarity. Inspect the complete immutable event chain, actor attributions, and state diffs.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-4xl mx-auto mb-8">
          <div className="inline-flex p-1 rounded-xl bg-surface border border-border shadow-md">
            <button
              onClick={() => {
                sound.playTick();
                setViewMode('audit');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                viewMode === 'audit'
                  ? 'bg-signal text-slate-950 shadow-glow-signal-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Full Audit Stream ({detailedAuditTrail.length} Events)</span>
            </button>
            <button
              onClick={() => {
                sound.playTick();
                setViewMode('narrative');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                viewMode === 'narrative'
                  ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Milestone Evolution (4 Stages)</span>
            </button>
          </div>

          {viewMode === 'audit' && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-500 mr-1" />
              {[
                { key: 'all', label: 'All' },
                { key: 'criteria', label: 'Criteria' },
                { key: 'options', label: 'Options' },
                { key: 'scores', label: 'Scores' },
                { key: 'collaboration', label: 'Experts' },
                { key: 'ai', label: 'AI Advisory' },
                { key: 'analysis', label: 'Engine' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    sound.playTick();
                    setCategoryFilter(key);
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition cursor-pointer ${
                    categoryFilter === key
                      ? 'bg-slate-700 text-white border border-slate-500'
                      : 'bg-surface/50 text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* VIEW 1: DETAILED AUDIT STREAM */}
        {viewMode === 'audit' && (
          <div className="max-w-4xl mx-auto relative">
            <div className="hidden sm:block absolute left-8 top-6 bottom-6 w-px bg-gradient-to-b from-signal/40 via-sky-500/30 to-border" />

            <div className="space-y-4">
              {filteredEvents.map((evt, idx) => {
                const isExpanded = expandedSeq === evt.seq;
                return (
                  <motion.div
                    key={evt.seq}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.04 }}
                    className="relative flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 p-5 rounded-2xl bg-surface-card border border-border hover:border-border-strong transition-all group"
                  >
                    {/* Sequence Badge */}
                    <div className="flex sm:flex-col items-center justify-between sm:justify-start gap-2 shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center text-signal font-mono font-bold text-xs group-hover:border-signal/50 group-hover:shadow-glow-signal-sm transition-all">
                        {evt.seq}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        Seq {idx + 1}
                      </span>
                    </div>

                    {/* Event Body */}
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold border ${getActionBadgeClass(
                              evt.action
                            )}`}
                          >
                            {evt.action}
                          </span>
                          <span className="text-sm sm:text-base font-bold text-white group-hover:text-signal transition-colors">
                            {evt.summary}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                          {evt.timestamp}
                        </span>
                      </div>

                      {/* Actor Attribution */}
                      <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1.5 text-slate-300">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            <strong>{evt.actor.name}</strong>
                            <span className="text-[11px] text-slate-500">({evt.actor.role})</span>
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                            Hash: {evt.hash.slice(0, 14)}...
                          </span>
                        </div>

                        <button
                          onClick={() => {
                            sound.playTick();
                            setExpandedSeq(isExpanded ? null : evt.seq);
                          }}
                          className="text-[11px] font-mono text-signal hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>{isExpanded ? 'Hide Change Details' : 'View Change Details'}</span>
                          <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                      </div>

                      {/* Expandable State Diff / Change Details */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3 p-3.5 bg-surface border border-border rounded-xl text-xs space-y-2.5 font-mono overflow-hidden"
                          >
                            <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-border-subtle pb-2">
                              <span><strong>Previous Hash:</strong> {evt.previousHash}</span>
                              <span className="text-emerald-400"><strong>Outcome:</strong> {evt.outcome || 'Success'}</span>
                            </div>

                            <div>
                              <div className="text-[11px] text-slate-400 mb-1">State Diff / Payload Record:</div>
                              <pre className="text-slate-300 text-[11px] overflow-x-auto p-2.5 bg-surface-subtle/80 border border-border-subtle rounded-lg">
                                {JSON.stringify(evt.diff, null, 2)}
                              </pre>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: NARRATIVE MILESTONE WALKTHROUGH */}
        {viewMode === 'narrative' && (
          <div className="max-w-4xl mx-auto relative">
            <div className="hidden sm:block absolute left-8 top-6 bottom-6 w-px bg-gradient-to-b from-cyan-400/40 via-signal/30 to-border" />

            <div className="space-y-6">
              {narrativeStages.map((evt, idx) => (
                <motion.div
                  key={evt.version}
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: idx * 0.1 }}
                  className="relative flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 p-6 rounded-2xl bg-surface-card border border-border hover:border-border-strong transition-all group"
                >
                  <div className="flex sm:flex-col items-center justify-between sm:justify-start gap-2 shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center text-cyan-400 font-mono font-bold text-xs group-hover:border-cyan-400/50 group-hover:shadow-glow-cyan-sm transition-all">
                      {evt.version}
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      {evt.timestamp}
                    </span>
                  </div>

                  <div className="flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <h3 className="text-base sm:text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
                        {evt.title}
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold border ${evt.tagColor}`}>
                        {evt.tag}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-3">
                      {evt.summary}
                    </p>

                    <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                      <span>Outcome: <strong className="text-slate-200">{evt.winner}</strong></span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Action Callouts */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={() => {
              sound.playTick();
              onOpenSandbox();
            }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-surface hover:bg-surface-hover border border-border hover:border-signal/50 text-xs sm:text-sm font-mono text-slate-200 hover:text-white transition-all shadow-sm cursor-pointer"
          >
            <span>Model Your Own Decision Trajectory</span>
            <ArrowRight className="w-4 h-4 text-signal" />
          </button>

          {onOpenAudit && (
            <button
              onClick={() => {
                sound.playTick();
                onOpenAudit();
              }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-xs sm:text-sm font-mono text-sky-300 hover:text-white transition-all shadow-sm cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span>Open Cryptographic Audit Terminal</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
