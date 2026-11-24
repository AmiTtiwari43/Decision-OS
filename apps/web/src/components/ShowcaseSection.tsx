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
  Award,
  Loader2,
  X,
} from 'lucide-react';
import { sound } from '../utils/audioFx.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import { generateShowcaseExport, triggerFileDownload } from '../utils/showcaseExport.js';

export interface ShowcaseSectionProps {
  onOpenStudio?: () => void;
  onOpenAudit?: () => void;
  onExport?: (format: 'json' | 'csv' | 'html') => void;
  defaultTab?: 'collaboration' | 'ai' | 'audit';
}

export const ShowcaseSection: React.FC<ShowcaseSectionProps> = ({
  onOpenStudio,
  onOpenAudit,
  onExport,
  defaultTab = 'collaboration',
}) => {
  const [activeTab, setActiveTab] = useState<'collaboration' | 'ai' | 'audit'>(defaultTab);

  // Collaboration State
  const [selectedPersona, setSelectedPersona] = useState<'cto' | 'cfo' | 'cpo'>('cto');

  // Audit State
  const [isVerifyingChain, setIsVerifyingChain] = useState<boolean>(false);
  const [isChainVerified, setIsChainVerified] = useState<boolean>(true);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [isSimulatingTamper, setIsSimulatingTamper] = useState<boolean>(false);
  const [tamperDetected, setTamperDetected] = useState<boolean>(false);

  // Export State
  const [isExporting, setIsExporting] = useState<'json' | 'csv' | 'html' | null>(null);
  const [exportedFormat, setExportedFormat] = useState<'json' | 'csv' | 'html' | null>(null);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);

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
      if (isSimulatingTamper) {
        setIsChainVerified(false);
        setTamperDetected(true);
      } else {
        setIsChainVerified(true);
        setTamperDetected(false);
        sound.playCelebrate();
      }
    }, 600);
  };

  const handleToggleTamper = () => {
    sound.playTick();
    const nextState = !isSimulatingTamper;
    setIsSimulatingTamper(nextState);
    if (!nextState) {
      setIsChainVerified(true);
      setTamperDetected(false);
    }
  };

  const handleCopyHash = async (hash: string) => {
    sound.playTick();
    if (!(await copyTextToClipboard(hash))) return;
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  const handleExport = (format: 'json' | 'csv' | 'html') => {
    sound.playTick();
    setIsExporting(format);
    setExportSuccessMessage(null);
    try {
      if (onExport) {
        onExport(format);
      }
      const pkg = generateShowcaseExport(format, isSimulatingTamper);
      triggerFileDownload(pkg.filename, pkg.contentType, pkg.content);
      setExportedFormat(format);
      setExportSuccessMessage(`Downloaded ${pkg.filename}`);
      sound.playCelebrate();
      setTimeout(() => {
        setExportedFormat((prev) => (prev === format ? null : prev));
      }, 2500);
      setTimeout(() => {
        setExportSuccessMessage(null);
      }, 5000);
    } catch {
      // safe fallback
    } finally {
      setIsExporting(null);
    }
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
        <div className="flex justify-start sm:justify-center mb-10 max-w-full overflow-x-auto scrollbar-none px-2">
          <div className="inline-flex p-1.5 rounded-2xl bg-surface border border-border shadow-xl shrink-0 whitespace-nowrap" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'collaboration'}
              onClick={() => {
                sound.playTick();
                setActiveTab('collaboration');
              }}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${
                activeTab === 'collaboration'
                  ? 'bg-signal text-slate-950 shadow-glow-signal-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Multi-Expert Collaboration</span>
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'ai'}
              onClick={() => {
                sound.playTick();
                setActiveTab('ai');
              }}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${
                activeTab === 'ai'
                  ? 'bg-accent-indigo text-slate-950 font-bold shadow-glow-indigo-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>AI Advisory Analyst</span>
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'audit'}
              onClick={() => {
                sound.playTick();
                setActiveTab('audit');
              }}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none ${
                activeTab === 'audit'
                  ? 'bg-accent-cyan text-slate-950 font-bold shadow-sm'
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

              {/* Explainable Recommendation Ranking Showcase (MDAR v1) */}
              <div className="p-5 rounded-2xl bg-surface border border-purple-500/20 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                    <Award className="w-4 h-4 text-purple-400" />
                    <span>Explainable Advisory Recommendation Ranking (MDAR v1)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Deterministic Multi-Factor Prioritization • Non-Probabilistic
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Rank #1 Card */}
                  <div className="p-4 rounded-xl bg-surface-card border border-border space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold font-mono text-[11px]">
                          RANK #1
                        </span>
                        <span className="font-semibold text-white">Proposed Criterion: Security Compliance</span>
                      </div>
                      <span className="text-[11px] font-mono text-cyan-400 font-bold">84.5 / 100</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[11px]">
                      Incorporate FedRAMP and SOC2 Type II certifications to mitigate enterprise regulatory exposure.
                    </p>
                    <div className="p-2.5 rounded-lg bg-surface border border-border text-[11px] space-y-1 text-slate-400">
                      <div><strong className="text-slate-300">Why this rank:</strong> Targets high-sensitivity tipping point (+10.0% weight change flips outcome) with verified evidence citations.</div>
                      <div><strong className="text-slate-300">Human Authority Boundary:</strong> Requires explicit owner adoption before entering decision model.</div>
                    </div>
                  </div>

                  {/* Rank #2 Card */}
                  <div className="p-4 rounded-xl bg-surface-card border border-border space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold font-mono text-[11px]">
                          RANK #2
                        </span>
                        <span className="font-semibold text-white">Alternative Option: Hybrid Multi-Cloud</span>
                      </div>
                      <span className="text-[11px] font-mono text-indigo-400 font-bold">78.0 / 100</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed text-[11px]">
                      Deploy core stateless workloads across both providers to prevent single-vendor lock-in.
                    </p>
                    <div className="p-2.5 rounded-lg bg-surface border border-border text-[11px] space-y-1 text-slate-400">
                      <div><strong className="text-slate-300">Why this rank:</strong> High strategic utility with identified trade-off in cross-region egress networking costs.</div>
                      <div><strong className="text-slate-300">Missing Information:</strong> Benchmark egress pricing under multi-region failover spike load.</div>
                    </div>
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
                    Cryptographic Integrity &amp; Defense-in-Depth
                  </span>
                  <h3 className="text-2xl font-bold text-white mt-1">
                    SHA-256 Hash Chaining &amp; Tamper Evidence
                  </h3>
                  <p className="text-sm text-slate-400 mt-1 max-w-xl">
                    Every mutation, weight adjustment, and score update generates an immutable cryptographic block chained from genesis via SHA-256. If any database record is altered out-of-band, downstream verification fails immediately.
                  </p>
                </div>

                {/* Chain Status Pill */}
                <div
                  className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${
                    tamperDetected
                      ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                      : 'bg-surface border-sky-500/30'
                  }`}
                >
                  <div
                    className={`p-3 rounded-xl ${
                      tamperDetected ? 'bg-rose-500/20 text-rose-400' : 'bg-sky-500/15 text-sky-400'
                    }`}
                  >
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 font-mono">Cryptographic Chain</div>
                    <div className="text-lg font-bold text-white flex items-center gap-1.5">
                      {tamperDetected ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-rose-400" />
                          <span className="text-rose-400">Integrity Violation</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>{isChainVerified ? '100% Intact' : 'Verifying...'}</span>
                        </>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {tamperDetected ? (
                        <span className="text-rose-400">Broken at Node #003</span>
                      ) : (
                        'Merkle Head: sha256-d5e6f1a2...'
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tamper Detection Banner */}
              {tamperDetected && (
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 font-mono space-y-1">
                  <div className="flex items-center gap-2 font-bold text-rose-200">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>Cryptographic Verification Alert: Hash Linkage Mismatch Detected</span>
                  </div>
                  <div>
                    Out-of-band record mutation detected at <strong>Block #003 (evidence.created)</strong>. Computed SHA-256 hash does not match next block&apos;s previousHash. Server verification status: <strong>REJECTED</strong>.
                  </div>
                </div>
              )}

              {/* Live Hash Chain Blocks */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span>Cryptographic Audit Event Stream:</span>
                    <button
                      onClick={handleToggleTamper}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                        isSimulatingTamper
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-surface hover:bg-surface-subtle text-slate-300 border border-border'
                      }`}
                    >
                      {isSimulatingTamper ? 'Restore Pristine DB' : 'Simulate Out-of-Band Tamper'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
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
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-xs">
                  {[
                    {
                      block: '#001 (Genesis)',
                      action: 'decision.created',
                      actor: 'elena@lead.org',
                      hash: 'sha256-a1b2c3d4e5f60001',
                      prev: 'GENESIS',
                      status: 'normal',
                    },
                    {
                      block: '#002',
                      action: 'criteria.weight_updated',
                      actor: 'elena@lead.org',
                      hash: 'sha256-b2c3d4e5f6a10002',
                      prev: 'sha256-a1b2c3d4...',
                      status: 'normal',
                    },
                    {
                      block: '#003',
                      action: 'evidence.created',
                      actor: 'marcus@lead.org',
                      hash: isSimulatingTamper
                        ? 'sha256-tampered-corrupted-hash'
                        : 'sha256-c3d4e5f6a1b20003',
                      prev: 'sha256-b2c3d4e5...',
                      status: isSimulatingTamper ? 'corrupted' : 'normal',
                    },
                    {
                      block: '#004',
                      action: 'contribution.adopted',
                      actor: 'elena@lead.org',
                      hash: 'sha256-d4e5f6a1b2c30004',
                      prev: isSimulatingTamper ? 'sha256-c3d4e5f6... (MISMATCH)' : 'sha256-c3d4e5f6...',
                      status: isSimulatingTamper ? 'broken' : 'normal',
                    },
                    {
                      block: '#005',
                      action: 'ai.analysis_generated',
                      actor: 'system.ai_analyst',
                      hash: 'sha256-e5f6a1b2c3d40005',
                      prev: 'sha256-d4e5f6a1...',
                      status: 'normal',
                    },
                    {
                      block: '#006 (Head)',
                      action: 'decision.analyzed',
                      actor: 'system.engine_v1',
                      hash: 'sha256-f6a1b2c3d4e50006',
                      prev: 'sha256-e5f6a1b2...',
                      status: 'normal',
                    },
                  ].map((b, idx) => {
                    const isCorrupt = b.status === 'corrupted';
                    const isBroken = b.status === 'broken';

                    return (
                      <div
                        key={b.block}
                        className={`p-3.5 rounded-xl border space-y-2 relative transition-all ${
                          isCorrupt
                            ? 'bg-rose-500/10 border-rose-500/60 shadow-lg shadow-rose-500/10'
                            : isBroken
                            ? 'bg-amber-500/10 border-amber-500/40'
                            : 'bg-surface border-border hover:border-border-strong'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-bold text-[11px] ${
                              isCorrupt ? 'text-rose-400' : isBroken ? 'text-amber-400' : 'text-sky-400'
                            }`}
                          >
                            {b.block}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {isCorrupt ? 'TAMPERED' : `Node ${idx + 1}`}
                          </span>
                        </div>
                        <div className="text-white font-bold text-xs truncate">{b.action}</div>
                        <div className="text-[11px] text-slate-400 truncate">By {b.actor}</div>
                        <div className="pt-2 border-t border-border-subtle flex items-center justify-between text-[10px]">
                          <span
                            className={`truncate max-w-[130px] ${
                              isCorrupt ? 'text-rose-300 font-bold' : 'text-slate-500'
                            }`}
                          >
                            {b.hash}
                          </span>
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
                    );
                  })}
                </div>
              </div>

              {/* Evidence Provenance & Missing Gaps Card */}
              <div className="p-5 rounded-2xl bg-surface border border-sky-500/20 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
                    <FileText className="w-4 h-4 text-sky-400" />
                    <span>Evidence Provenance &amp; Missing Evidence Safeguards</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                    Rule #15 Grounding Invariant
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-surface-card border border-border space-y-2">
                    <div className="font-semibold text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Self-Reported Citation Transparency</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      Citations attached to options or criteria are explicitly tagged as <strong>Unverified Citations</strong>. Decision OS forbids fabricating external verification badges to maintain boardroom transparency.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-surface-card border border-border space-y-2">
                    <div className="font-semibold text-white flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Missing Evidence Gap Identification</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      Export packages and deliberation modals actively compute coverage gaps. Decision makers are warned when options or high-sensitivity criteria lack supporting empirical citations.
                    </p>
                  </div>
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
                    <div className="text-[11px] text-slate-400">
                      Export deterministic mathematical briefings with 11 guaranteed audit components &amp; hash chain proofs
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleExport('json')}
                    disabled={isExporting !== null}
                    className="px-3 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface active:scale-95 border border-border hover:border-signal/50 text-xs font-mono text-slate-300 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none disabled:opacity-50"
                    title="Export complete JSON Package with 11 guaranteed components &amp; cryptographic audit proof"
                    aria-label="Export Boardroom Defense JSON Package"
                  >
                    {exportedFormat === 'json' ? (
                      <Check className="w-3.5 h-3.5 text-signal" />
                    ) : isExporting === 'json' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-signal" />
                    ) : (
                      <FileCode className="w-3.5 h-3.5 text-signal" />
                    )}
                    <span>{exportedFormat === 'json' ? 'JSON Downloaded' : 'JSON Package'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExport('csv')}
                    disabled={isExporting !== null}
                    className="px-3 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface active:scale-95 border border-border hover:border-sky-400/50 text-xs font-mono text-slate-300 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none disabled:opacity-50"
                    title="Export RFC 4180 CSV Matrix with criteria weights &amp; sensitivity findings"
                    aria-label="Export Boardroom Defense CSV Matrix"
                  >
                    {exportedFormat === 'csv' ? (
                      <Check className="w-3.5 h-3.5 text-sky-400" />
                    ) : isExporting === 'csv' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
                    )}
                    <span>{exportedFormat === 'csv' ? 'CSV Downloaded' : 'CSV Matrix'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExport('html')}
                    disabled={isExporting !== null}
                    className="px-3 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface active:scale-95 border border-border hover:border-purple-400/50 text-xs font-mono text-slate-300 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none disabled:opacity-50"
                    title="Export standalone executive Printable Briefing (HTML/PDF)"
                    aria-label="Export Boardroom Defense Printable HTML"
                  >
                    {exportedFormat === 'html' ? (
                      <Check className="w-3.5 h-3.5 text-purple-400" />
                    ) : isExporting === 'html' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-purple-400" />
                    )}
                    <span>{exportedFormat === 'html' ? 'HTML Downloaded' : 'Printable HTML'}</span>
                  </button>
                </div>
              </div>

              {exportSuccessMessage && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 flex items-center justify-between gap-2 font-mono">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>{exportSuccessMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExportSuccessMessage(null)}
                    className="text-emerald-400 hover:text-white cursor-pointer"
                    aria-label="Dismiss export success notice"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
};
