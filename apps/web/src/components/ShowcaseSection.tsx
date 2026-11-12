import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Bot,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Lock,
  ArrowRight,
  MessageSquare,
  Scale,
  Hash,
  Download,
  AlertTriangle,
  FileCode,
  FileSpreadsheet,
  FileText,
  Activity,
  Check,
} from 'lucide-react';
import { sound } from '../utils/audioFx.js';

export interface ShowcaseSectionProps {
  onOpenStudio?: () => void;
  onOpenAudit?: () => void;
}

export const ShowcaseSection: React.FC<ShowcaseSectionProps> = ({
  onOpenStudio,
  onOpenAudit,
}) => {
  const [activeTab, setActiveTab] = useState<'collaboration' | 'ai' | 'audit'>('collaboration');

  // Collaboration State
  const [selectedPersona, setSelectedPersona] = useState<'cto' | 'cfo' | 'cpo'>('cto');

  // Audit State
  const [isVerifyingChain, setIsVerifyingChain] = useState<boolean>(false);
  const [isChainVerified, setIsChainVerified] = useState<boolean>(true);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const personas = {
    cto: {
      role: 'Chief Technology Officer',
      name: 'Elena Rostova',
      topPriority: 'Velocity & Type Safety (45%)',
      consensusDelta: '+4.2 pts',
      leadPick: 'React + Vite + Fastify',
      weights: { Velocity: 45, TypeSafety: 30, Ecosystem: 15, Cost: 10 },
      comment: 'Strongest API developer velocity. Team has verified type coverage across full stack.',
    },
    cfo: {
      role: 'Chief Financial Officer',
      name: 'Marcus Vance',
      topPriority: 'Cost Efficiency & Infra TCO (40%)',
      consensusDelta: '-1.8 pts',
      leadPick: 'Next.js Fullstack',
      weights: { Velocity: 20, TypeSafety: 15, Ecosystem: 25, Cost: 40 },
      comment: 'Single vendor cloud deployment minimizes auxiliary monitoring subscriptions.',
    },
    cpo: {
      role: 'Chief Product Officer',
      name: 'Sarah Chen',
      topPriority: 'Time to Market & Ecosystem (40%)',
      consensusDelta: '+2.6 pts',
      leadPick: 'React + Vite + Fastify',
      weights: { Velocity: 35, TypeSafety: 15, Ecosystem: 40, Cost: 10 },
      comment: 'Rich client-side dashboard ecosystem gives product designers maximum flexibility.',
    },
  };

  const currentPersona = personas[selectedPersona];

  const handleVerifyChain = () => {
    sound.playTick();
    setIsVerifyingChain(true);
    setTimeout(() => {
      setIsVerifyingChain(false);
      setIsChainVerified(true);
      sound.playCelebrate();
    }, 600);
  };

  const handleCopyHash = (hash: string) => {
    sound.playTick();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  return (
    <section className="py-20 md:py-28 relative border-t border-border-subtle bg-surface/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-signal/10 border border-signal/20 text-xs font-mono font-semibold text-signal mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Governance & Intelligence Layer</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            Collaboration, AI Advisory & Cryptographic Audit.
          </h2>
          <p className="mt-3 text-base text-slate-400">
            Enterprise decisions require collective consensus, intelligent advisory stress-testing, and an untamperable mathematical record.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex p-1.5 rounded-2xl bg-surface border border-border shadow-xl">
            <button
              onClick={() => {
                sound.playTick();
                setActiveTab('collaboration');
              }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === 'collaboration'
                  ? 'bg-signal text-slate-950 shadow-glow-signal-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Multi-Expert Collaboration</span>
            </button>
            <button
              onClick={() => {
                sound.playTick();
                setActiveTab('ai');
              }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === 'ai'
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>AI Advisory Analyst</span>
            </button>
            <button
              onClick={() => {
                sound.playTick();
                setActiveTab('audit');
              }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Cryptographic Audit Chain</span>
            </button>
          </div>
        </div>

        {/* Dynamic Interactive Panel */}
        <div className="rounded-3xl bg-surface-card border border-border p-6 sm:p-8 lg:p-10 shadow-2xl relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-signal/5 rounded-full blur-3xl pointer-events-none" />

          {/* TAB 1: COLLABORATION */}
          {activeTab === 'collaboration' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-border">
                <div>
                  <span className="text-xs font-mono uppercase tracking-wider text-signal font-bold">
                    Multi-Stakeholder Alignment
                  </span>
                  <h3 className="text-2xl font-bold text-white mt-1">
                    Aggregate Expert Weights Without Politics
                  </h3>
                  <p className="text-sm text-slate-400 mt-1 max-w-xl">
                    Invite cross-functional leaders to submit independent criteria weights. Decision OS measures variance dispersion and computes collective consensus mathematically.
                  </p>
                </div>
                {/* Consensus Metric Badge */}
                <div className="flex items-center gap-4 bg-surface p-4 rounded-2xl border border-signal/30">
                  <div className="p-3 rounded-xl bg-signal/15 text-signal">
                    <Scale className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 font-mono">Consensus Alignment</div>
                    <div className="text-2xl font-black text-white">88.4%</div>
                    <div className="text-[11px] text-emerald-400 font-mono">Low Variance Dispersion (σ = 0.08)</div>
                  </div>
                </div>
              </div>

              {/* Persona Selector */}
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                  Inspect Stakeholder Weighted Profiles:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(['cto', 'cfo', 'cpo'] as const).map((key) => {
                    const p = personas[key];
                    const isSelected = selectedPersona === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          sound.playTick();
                          setSelectedPersona(key);
                        }}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-signal/10 border-signal/60 shadow-glow-signal-sm'
                            : 'bg-surface hover:bg-surface-subtle border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{p.name}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface border border-border text-slate-400 uppercase">
                            {key.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{p.role}</div>
                        <div className="mt-2 text-xs font-mono text-signal">
                          Primary: {p.topPriority}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Profile Details & Deliberation Thread Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weight Allocation Breakdown */}
                <div className="p-5 rounded-2xl bg-surface border border-border space-y-4">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-white font-bold">{currentPersona.name}&apos;s Criteria Allocation:</span>
                    <span className="text-signal font-bold">Sum = 100% Normalized</span>
                  </div>
                  <div className="space-y-2.5">
                    {Object.entries(currentPersona.weights).map(([cName, w]) => (
                      <div key={cName} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-300 font-medium">{cName}</span>
                          <span className="font-mono text-slate-400">{w}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-subtle overflow-hidden">
                          <div
                            className="h-full bg-signal transition-all duration-300 rounded-full"
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-border-subtle flex items-center justify-between text-xs">
                    <span className="text-slate-400">Preferred Winner Under Profile:</span>
                    <span className="font-bold text-white px-2.5 py-1 rounded-lg bg-surface-subtle border border-border">
                      {currentPersona.leadPick}
                    </span>
                  </div>
                </div>

                {/* Threaded Deliberation Preview */}
                <div className="p-5 rounded-2xl bg-surface border border-border flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-3">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <MessageSquare className="w-4 h-4 text-signal" />
                        <span>Executive Deliberation Thread</span>
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        Resolved Consensus
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-surface-card border border-border text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{currentPersona.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">Verified Sign-off</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        &quot;{currentPersona.comment}&quot;
                      </p>
                    </div>
                    <div className="mt-3 pl-4 border-l-2 border-signal/40 text-[11px] text-slate-400 space-y-1">
                      <div className="font-semibold text-slate-200">Governance Engine Note:</div>
                      <p>
                        Both technical velocity and cost parameters fall within the ±5% sensitivity tolerance window. Lead candidate is robust.
                      </p>
                    </div>
                  </div>
                  {onOpenStudio && (
                    <button
                      onClick={onOpenStudio}
                      className="mt-4 w-full py-2.5 rounded-xl bg-surface hover:bg-surface-subtle border border-signal/40 text-signal font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <span>Open Live Deliberation in Studio</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: AI ADVISORY */}
          {activeTab === 'ai' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-border">
                <div>
                  <span className="text-xs font-mono uppercase tracking-wider text-purple-400 font-bold">
                    Advisory Intelligence with Mathematical Isolation
                  </span>
                  <h3 className="text-2xl font-bold text-white mt-1">
                    AI Stress-Testing Without Black-Box Math
                  </h3>
                  <p className="text-sm text-slate-400 mt-1 max-w-xl">
                    Generic LLMs hallucinate calculations. Decision OS isolates the AI: the backend engine authoritatively computes MCDA utility, while the AI serves purely as an advisory devil&apos;s advocate.
                  </p>
                </div>
                {/* Non-negotiable callout */}
                <div className="flex items-center gap-3 bg-purple-500/10 p-4 rounded-2xl border border-purple-500/30 max-w-sm">
                  <Lock className="w-5 h-5 text-purple-400 shrink-0" />
                  <div className="text-xs text-purple-200 leading-relaxed">
                    <strong>Rule #14 Guarantee:</strong> No LLM ever calculates or alters authoritative scores, weights, or sensitivity points.
                  </div>
                </div>
              </div>

              {/* Advisory Briefing Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Executive Summary */}
                <div className="p-5 rounded-2xl bg-surface border border-purple-500/30 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                    <Bot className="w-4 h-4" />
                    <span>Advisory Synthesis</span>
                  </div>
                  <h4 className="text-sm font-bold text-white">
                    Decisive Architecture Advantage
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Option Alpha holds a decisive +4.0 pt utility advantage driven by technical velocity (90.0) and developer ecosystem adoption.
                  </p>
                  <div className="p-2.5 rounded-lg bg-surface-card border border-border text-[11px] text-slate-400 font-mono">
                    Deterministic MCDA Engine v1.0.0 Verified
                  </div>
                </div>

                {/* Cognitive Bias Detection */}
                <div className="p-5 rounded-2xl bg-surface border border-amber-500/30 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Cognitive Bias Scanner</span>
                  </div>
                  <h4 className="text-sm font-bold text-white">
                    Anchoring & Sunk Cost Flags
                  </h4>
                  <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                    <li className="flex items-start gap-1.5">
                      <span className="text-amber-400 font-bold">•</span>
                      <span><strong>Single-Metric Anchoring:</strong> Risk of over-weighting initial sticker compute pricing while discounting developer friction.</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-amber-400 font-bold">•</span>
                      <span><strong>Loss Aversion:</strong> Migration hesitation accounts for -3.2 pt conservative bias in raw team scoring.</span>
                    </li>
                  </ul>
                </div>

                {/* Counterfactual Proposals */}
                <div className="p-5 rounded-2xl bg-surface border border-signal/30 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-signal">
                    <Activity className="w-4 h-4" />
                    <span>What-If Counterfactuals</span>
                  </div>
                  <h4 className="text-sm font-bold text-white">
                    Analytical Flip Boundary
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Cost Efficiency weight must exceed <strong>50.0%</strong> (an increase of +10.0%) for Option Beta to flip into first rank.
                  </p>
                  <div className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-lg">
                    Feasibility: Low Threshold (+10.0% required)
                  </div>
                </div>
              </div>

              {onOpenStudio && (
                <div className="text-center pt-2">
                  <button
                    onClick={onOpenStudio}
                    className="px-6 py-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold text-xs inline-flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-purple-500/20"
                  >
                    <span>Run Live AI Decision Analyst</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 3: AUDIT SHOWCASE */}
          {activeTab === 'audit' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-border">
                <div>
                  <span className="text-xs font-mono uppercase tracking-wider text-sky-400 font-bold">
                    Cryptographic Integrity & Defense-in-Depth
                  </span>
                  <h3 className="text-2xl font-bold text-white mt-1">
                    SHA-256 Hash Chaining & Tamper Evidence
                  </h3>
                  <p className="text-sm text-slate-400 mt-1 max-w-xl">
                    Every mutation, weight adjustment, and score update generates an immutable cryptographic block chained from genesis via SHA-256. If any database record is altered out-of-band, downstream verification fails immediately.
                  </p>
                </div>

                {/* Chain Status Pill */}
                <div className="flex items-center gap-3 bg-surface p-4 rounded-2xl border border-sky-500/30">
                  <div className="p-3 rounded-xl bg-sky-500/15 text-sky-400">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 font-mono">Cryptographic Chain</div>
                    <div className="text-lg font-bold text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>{isChainVerified ? '100% Intact' : 'Verification In Flight'}</span>
                    </div>
                    <div className="text-[11px] text-sky-400 font-mono">Merkle Root: e3b0c442...</div>
                  </div>
                </div>
              </div>

              {/* Live Hash Chain Blocks */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>Cryptographic Audit Event Stream:</span>
                  <button
                    onClick={handleVerifyChain}
                    disabled={isVerifyingChain}
                    className="px-3 py-1 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/40 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    {isVerifyingChain ? (
                      <span>Verifying Hashes...</span>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Verify Chain Now</span>
                      </>
                    )}
                  </button>
                  {onOpenAudit && (
                    <button
                      onClick={onOpenAudit}
                      className="px-3 py-1 rounded-lg bg-surface hover:bg-surface-subtle border border-border text-slate-300 text-xs font-mono transition-all cursor-pointer"
                    >
                      Audit Terminal (⌘K)
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 font-mono text-xs">
                  {[
                    {
                      block: '#001 (Genesis)',
                      action: 'decision.created',
                      actor: 'elena@lead.org',
                      hash: 'sha256-genesis-0000000000000000',
                      prev: 'GENESIS',
                    },
                    {
                      block: '#002',
                      action: 'criteria.weight_updated',
                      actor: 'elena@lead.org',
                      hash: 'sha256-8f2a1b9c3d4e5f6a7b8c9d0e',
                      prev: 'sha256-genesis',
                    },
                    {
                      block: '#003',
                      action: 'contribution.adopted',
                      actor: 'marcus@lead.org',
                      hash: 'sha256-4c3bea418f17f2a1b9c3d4e5',
                      prev: 'sha256-8f2a1b9c',
                    },
                    {
                      block: '#004 (Head)',
                      action: 'decision.analyzed',
                      actor: 'system.engine_v1',
                      hash: 'sha256-238175f214c7ec8d135e5c5f',
                      prev: 'sha256-4c3bea41',
                    },
                  ].map((b, idx) => (
                    <div
                      key={b.block}
                      className="p-3.5 rounded-xl bg-surface border border-border space-y-2 relative"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sky-400 text-[11px]">{b.block}</span>
                        <span className="text-[10px] text-slate-500">Node {idx + 1}</span>
                      </div>
                      <div className="text-white font-bold text-xs truncate">{b.action}</div>
                      <div className="text-[11px] text-slate-400 truncate">By {b.actor}</div>
                      <div className="pt-2 border-t border-border-subtle flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 truncate max-w-[120px]">{b.hash}</span>
                        <button
                          onClick={() => handleCopyHash(b.hash)}
                          className="text-slate-400 hover:text-white"
                          title="Copy SHA-256 hash"
                        >
                          {copiedHash === b.hash ? (
                            <Check className="w-3 h-3 text-signal" />
                          ) : (
                            <Hash className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Export Showcase Bar */}
              <div className="p-4 rounded-2xl bg-surface border border-border flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-surface-subtle text-slate-300">
                    <Download className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Boardroom Defense Export Formats</div>
                    <div className="text-[11px] text-slate-400">Export deterministic mathematical briefings with verifiable cryptographic hashes</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg bg-surface-subtle border border-border text-xs font-mono text-slate-300 flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-signal" />
                    <span>JSON Proof</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-lg bg-surface-subtle border border-border text-xs font-mono text-slate-300 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
                    <span>CSV Matrix</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-lg bg-surface-subtle border border-border text-xs font-mono text-slate-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-purple-400" />
                    <span>PDF Briefing</span>
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
};
