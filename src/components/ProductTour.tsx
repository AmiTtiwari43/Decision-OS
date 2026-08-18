import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Sliders,
  Radar,
  Award,
  Layers,
} from 'lucide-react';
import { sound } from '../utils/audioFx';

interface ProductTourProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSandbox: () => void;
}

interface TourStep {
  step: number;
  badge: string;
  title: string;
  description: string;
  highlightText: string;
  targetElementId?: string;
  icon: React.ComponentType<{ className?: string }>;
  actionLabel?: string;
}

const tourSteps: TourStep[] = [
  {
    step: 1,
    badge: 'Welcome to Decision OS',
    title: 'How does Decision OS work?',
    description:
      'Instead of trusting raw gut feeling or an opaque AI black box, Decision OS helps you calibrate what actually matters to you (percentage weights) and gives you the exact mathematical reason why one option wins.',
    highlightText: 'Core Principle: "The best decision depends on what matters to you."',
    targetElementId: 'product',
    icon: Sparkles,
    actionLabel: 'Explore the Hero Console',
  },
  {
    step: 2,
    badge: 'Tactile Priority Testing',
    title: 'The Hero Command Console',
    description:
      'Right at the top, you can test how shifting life priorities changes the outcome. When Career Growth is priority, Startup Alpha wins. When Compensation is priority, Enterprise Beta takes the lead.',
    highlightText: 'Try clicking the "Compensation" or "Work-Life Focus" buttons in the hero preview.',
    targetElementId: 'product',
    icon: Award,
    actionLabel: 'See Interactive Studio',
  },
  {
    step: 3,
    badge: 'Real-Time Calculation Studio',
    title: 'Calibrate Your Weight Sliders',
    description:
      'In the Interactive Decision Studio, you drag sliders to give percentage weights (e.g. 30% Career, 25% Pay). The engine automatically normalizes unlocked sliders so the total sum always equals 100%.',
    highlightText: 'You can also lock non-negotiables with the lock icon.',
    targetElementId: 'simulator',
    icon: Sliders,
    actionLabel: 'View Studio Instruments',
  },
  {
    step: 4,
    badge: '5 Visual Decision Instruments',
    title: 'Deep Multi-Dimensional Analysis',
    description:
      'Switch between 5 specialized visual tools: Score Cards, 5-Axis Radar Polygon, Continuous Breakeven Sensitivity Curve, Physics Torque Scale, and 1,000-pass Monte Carlo Stress-Tester.',
    highlightText: 'Click the studio tabs (Radar, Curve, Torque, Monte Carlo) to see different visual angles.',
    targetElementId: 'simulator',
    icon: Radar,
    actionLabel: 'Learn About Custom Decisions',
  },
  {
    step: 5,
    badge: 'Boardroom-Ready Briefing',
    title: 'Create Your Own Decision Matrix',
    description:
      'Ready to evaluate a real decision in your life? Click "Start a decision" anytime to pick preloaded templates (Job Offers, City Relocations, Frontend Frameworks) and export a 1-click verified briefing.',
    highlightText: 'Generates an airtight, defensible briefing you can share with mentors or partners.',
    icon: Layers,
    actionLabel: 'Open Decision Sandbox Now',
  },
];

export const ProductTour: React.FC<ProductTourProps> = ({
  isOpen,
  onClose,
  onOpenSandbox,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const currentStep = tourSteps[currentStepIndex];
  const Icon = currentStep.icon;

  useEffect(() => {
    if (isOpen && currentStep.targetElementId) {
      const element = document.getElementById(currentStep.targetElementId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [isOpen, currentStepIndex, currentStep.targetElementId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStepIndex]);

  const handleNext = () => {
    sound.playTick(700 + currentStepIndex * 50);
    if (currentStepIndex < tourSteps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    sound.playTick(600);
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  const handleAction = () => {
    if (currentStepIndex === tourSteps.length - 1) {
      onClose();
      onOpenSandbox();
    } else {
      handleNext();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6 bg-background/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ duration: 0.25 }}
          className="relative w-full max-w-lg rounded-3xl bg-surface-card border border-signal/40 shadow-glow-card overflow-hidden"
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between p-5 bg-surface border-b border-border">
            <div className="flex items-center gap-2 text-xs font-mono text-signal">
              <span className="p-1.5 rounded-lg bg-signal/15 border border-signal/30 text-signal">
                <Icon className="w-4 h-4" />
              </span>
              <span className="font-bold uppercase tracking-wider">
                Interactive Guide · Step {currentStep.step} of {tourSteps.length}
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-surface-subtle hover:bg-surface border border-border text-slate-400 hover:text-white transition-all text-xs flex items-center gap-1"
              aria-label="Close walkthrough guide"
            >
              <span>Skip</span>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="p-6 sm:p-7 space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full bg-signal/10 text-signal border border-signal/20 text-[11px] font-mono font-semibold">
                {currentStep.badge}
              </span>

              {/* Progress Dots */}
              <div className="flex items-center gap-1.5">
                {tourSteps.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      sound.playTick();
                      setCurrentStepIndex(i);
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      currentStepIndex === i
                        ? 'w-6 bg-signal'
                        : 'w-1.5 bg-slate-700 hover:bg-slate-500'
                    }`}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>
            </div>

            <h3 className="text-xl sm:text-2xl font-bold text-white leading-snug">
              {currentStep.title}
            </h3>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {currentStep.description}
            </p>

            <div className="p-3.5 rounded-xl bg-background/90 border border-border-subtle text-xs font-mono text-slate-200 flex items-start gap-2.5">
              <span className="text-signal font-bold mt-0.5">💡</span>
              <p className="leading-relaxed text-slate-300">
                {currentStep.highlightText}
              </p>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="p-5 bg-surface border-t border-border flex items-center justify-between gap-3">
            <button
              onClick={handlePrev}
              disabled={currentStepIndex === 0}
              className={`px-3.5 py-2 rounded-xl border text-xs font-mono flex items-center gap-1.5 transition-all ${
                currentStepIndex === 0
                  ? 'opacity-30 cursor-not-allowed border-transparent text-slate-600'
                  : 'bg-surface-subtle border-border text-slate-300 hover:text-white hover:border-slate-500'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handleAction}
                className="px-5 py-2.5 rounded-xl bg-signal hover:bg-signal-light text-background font-bold text-xs sm:text-sm flex items-center gap-2 transition-all shadow-glow-signal-sm"
              >
                <span>
                  {currentStepIndex === tourSteps.length - 1
                    ? 'Launch Sandbox'
                    : 'Next Step'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
