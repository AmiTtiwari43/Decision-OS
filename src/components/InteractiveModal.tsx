import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Layers,
  Copy,
  Check,
  Award,
  Sliders,
  RotateCcw,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { templateDatasets } from '../data/decisionData';
import { useDecisionModel } from '../hooks/useDecisionModel';
import { WeightSlider } from './WeightSlider';

interface InteractiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InteractiveModal: React.FC<InteractiveModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const {
    dataset,
    criteria,
    weights,
    lockedIds,
    engineResult,
    setCriterionWeight,
    toggleLock,
    resetToDefaults,
    switchDataset,
  } = useDecisionModel(templateDatasets[0]);

  const handleTemplateChange = (idx: number) => {
    setSelectedTemplateIndex(idx);
    switchDataset(templateDatasets[idx]);
  };

  const handleExportBriefing = () => {
    const { winner, evaluations, explainability } = engineResult;

    const report = `# Decision OS — Decision Briefing
Generated: ${new Date().toLocaleDateString()}
Decision Prompt: "${dataset.question}"

## Leading Recommendation
🏆 **${winner.option.name}** (Weighted Score: ${winner.weightedScore}/100)
${explainability.headline}

## Explainability Summary
${explainability.dynamicRationale}

${explainability.sensitivityStatement}

## Full Option Rankings
${evaluations
  .map(
    (e, idx) =>
      `${idx + 1}. **${e.option.name}** — ${e.weightedScore} pts (${e.option.badge || ''})`
  )
  .join('\n')}

## Criteria Weight Allocation
${criteria
  .map(
    (c) =>
      `- **${c.name}**: ${weights[c.id]}% (Raw winner score: ${winner.option.scores[c.id] || 0}/100)`
  )
  .join('\n')}

---
*Created with Decision OS — Make decisions you can explain.*
`;

    navigator.clipboard.writeText(report);
    setCopied(true);
    confetti({
      particleCount: 75,
      spread: 60,
      origin: { y: 0.6 },
    });
    setTimeout(() => setCopied(false), 3000);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-background/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25 }}
          className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-surface-card border border-border shadow-2xl overflow-hidden"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-5 border-b border-border bg-surface">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-signal">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span>Decision OS Workspace</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-signal/15 text-signal border border-signal/20">
                    Live Sandbox
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Select a template or calibrate weights to generate an explainable briefing.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-surface-subtle hover:bg-surface border border-border text-slate-400 hover:text-white transition-all"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Template Selector Bar */}
          <div className="p-4 bg-surface-subtle/50 border-b border-border-subtle flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-slate-400 mr-2">Templates:</span>
            {templateDatasets.map((t, idx) => (
              <button
                key={t.id}
                onClick={() => handleTemplateChange(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  selectedTemplateIndex === idx
                    ? 'bg-signal text-background border-signal font-bold shadow-sm'
                    : 'bg-surface border-border text-slate-300 hover:text-white hover:border-slate-600'
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>

          {/* Modal Scrollable Body */}
          <div className="p-6 overflow-y-auto space-y-6 flex-1">
            {/* Question Banner */}
            <div className="p-4 rounded-xl bg-surface/80 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-mono uppercase text-signal tracking-wider">
                  Target Question
                </span>
                <h4 className="text-lg font-bold text-white mt-0.5">
                  "{dataset.question}"
                </h4>
                <p className="text-xs text-slate-400 mt-1">{dataset.context}</p>
              </div>

              <div className="flex items-center gap-3 bg-surface-card p-3 rounded-lg border border-border shrink-0">
                <Award className="w-5 h-5 text-signal" />
                <div>
                  <div className="text-[10px] font-mono text-slate-400 uppercase">
                    Current Winner
                  </div>
                  <div className="text-sm font-bold text-white">
                    {engineResult.winner.option.name} (
                    <span className="text-signal font-mono">
                      {engineResult.winner.weightedScore} pts
                    </span>
                    )
                  </div>
                </div>
              </div>
            </div>

            {/* 2-Column: Weights vs Rankings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Weight Sliders */}
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-300 font-bold uppercase">
                    <Sliders className="w-3.5 h-3.5 text-signal" />
                    <span>Calibrate Weights</span>
                  </div>
                  <button
                    onClick={resetToDefaults}
                    className="text-[11px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                  {criteria.map((c) => (
                    <WeightSlider
                      key={c.id}
                      criterion={c}
                      weight={weights[c.id] ?? 0}
                      isLocked={lockedIds.includes(c.id)}
                      onWeightChange={(val) => setCriterionWeight(c.id, val)}
                      onToggleLock={() => toggleLock(c.id)}
                    />
                  ))}
                </div>
              </div>

              {/* Right Column: Live Option Results & Explainability */}
              <div className="space-y-4">
                <div className="text-xs font-mono text-slate-300 font-bold uppercase pb-2 border-b border-border-subtle">
                  Live Option Scores
                </div>

                <div className="space-y-3">
                  {engineResult.evaluations.map((item) => (
                    <div
                      key={item.option.id}
                      className={`p-3.5 rounded-xl border transition-all ${
                        item.rank === 1
                          ? 'bg-surface-card border-signal/50 shadow-glow-signal-sm'
                          : 'bg-surface/50 border-border-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: item.option.color }}
                          />
                          <span className="text-sm font-bold text-white">
                            {item.option.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <span className="font-bold text-white text-base">
                            {item.weightedScore}
                          </span>
                          <span className="text-slate-500">/100</span>
                        </div>
                      </div>

                      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden mb-2">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${item.weightedScore}%`,
                            backgroundColor: item.rank === 1 ? '#B8FF5A' : item.option.color,
                          }}
                        />
                      </div>

                      <div className="text-[11px] text-slate-400 line-clamp-1">
                        {item.option.tagline}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3.5 rounded-xl bg-surface/70 border border-border text-xs text-slate-300">
                  <span className="font-bold text-signal block mb-1">
                    Explainability Driver:
                  </span>
                  <p className="leading-relaxed">
                    {engineResult.explainability.dynamicRationale}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer Bar */}
          <div className="p-4 bg-surface border-t border-border flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-400 font-mono">
              Deterministic MCDA · Fully Explainable
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleExportBriefing}
                className="px-5 py-2.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs sm:text-sm flex items-center gap-2 transition-all shadow-glow-signal-sm"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-background" />
                    <span>Briefing Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-background" />
                    <span>Copy Decision Briefing</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
