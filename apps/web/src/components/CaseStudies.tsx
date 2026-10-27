import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Layers, CheckCircle2, TrendingUp, Building2, Cpu, MousePointerClick } from 'lucide-react';
import { sound } from '../utils/audioFx';

interface CaseStudiesProps {
  onOpenSandbox: () => void;
}

const caseStudies = [
  {
    id: 'career',
    category: 'Career Velocity',
    title: 'Startup Ownership vs. Big Tech Cash',
    description: 'A 28-year-old staff engineer evaluates a fast-paced Series B AI startup offering heavy equity against a Tier-1 public enterprise offering top base pay.',
    image: '/images/career.jpg',
    winner: 'Company Alpha',
    winnerScore: '84.0',
    keyTradeoff: 'Career Growth (+18 pts) outweighs Base Comp (-14 pts)',
    icon: TrendingUp,
    accentColor: '#B8FF5A',
  },
  {
    id: 'city',
    category: 'Urban Relocation',
    title: 'Austin vs. NYC vs. Lisbon',
    description: 'Evaluating relocation based on zero state income tax, dense tech ecosystems, cost of living, transit walkability, and Atlantic coastal culture.',
    image: '/images/city.jpg',
    winner: 'Austin, Texas',
    winnerScore: '77.2',
    keyTradeoff: 'Tax savings and housing affordance beat NYC cultural density',
    icon: Building2,
    accentColor: '#38BDF8',
  },
  {
    id: 'architecture',
    category: 'Engineering Leadership',
    title: 'Vite + React SPA vs. Next.js Server Components',
    description: 'A technical lead selects the frontend foundation for 2026, balancing sub-50ms HMR velocity and talent hiring against built-in SSR caching.',
    image: '/images/architecture.jpg',
    winner: 'Vite + React',
    winnerScore: '89.4',
    keyTradeoff: 'Instant developer iteration velocity beats framework complexity',
    icon: Cpu,
    accentColor: '#F59E0B',
  },
];

export const CaseStudies: React.FC<CaseStudiesProps> = ({ onOpenSandbox }) => {
  return (
    <section className="py-24 md:py-32 relative border-t border-border-subtle bg-surface-subtle/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-border text-xs font-mono font-medium text-slate-300 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-signal" />
              <span>Real Decision Models</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Structured decisions in the wild.
            </h2>
            <p className="mt-4 text-base sm:text-lg text-slate-400 max-w-xl">
              See how leaders and engineers use Decision OS to evaluate multi-million dollar career moves, city relocations, and technical architecture choices.
            </p>
          </div>

          <button
            onClick={() => {
              sound.playTick();
              onOpenSandbox();
            }}
            className="px-5 py-2.5 rounded-xl bg-surface hover:bg-surface-hover border border-border text-xs sm:text-sm font-mono text-slate-200 hover:text-white flex items-center gap-2 transition-all self-start md:self-auto cursor-pointer"
          >
            <Layers className="w-4 h-4 text-signal" />
            <span>Click to browse all templates</span>
          </button>
        </div>

        {/* 3 Case Study Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {caseStudies.map((cs, idx) => {
            const Icon = cs.icon;
            return (
              <motion.div
                key={cs.id}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.12 }}
                className="group rounded-3xl bg-surface-card border border-border overflow-hidden hover:border-border-strong hover:shadow-glow-card transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  {/* Image Container with Ambient Gradient Overlay */}
                  <div className="relative h-52 sm:h-56 w-full overflow-hidden bg-surface">
                    <img
                      src={cs.image}
                      alt={cs.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-85 group-hover:opacity-100"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-surface-card via-surface-card/30 to-transparent" />
                    
                    {/* Category Pill */}
                    <div className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1 rounded-full bg-background/80 backdrop-blur-md border border-border text-[11px] font-mono text-slate-200">
                      <Icon className="w-3.5 h-3.5 text-signal" />
                      <span>{cs.category}</span>
                    </div>

                    {/* Winner Badge on Image */}
                    <div className="absolute bottom-3 right-4 px-2.5 py-1 rounded-lg bg-background/90 backdrop-blur-md border border-signal/40 text-[11px] font-mono font-bold text-signal flex items-center gap-1.5 shadow-sm">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{cs.winner} ({cs.winnerScore})</span>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-6">
                    <h3 className="text-lg font-bold text-white group-hover:text-signal transition-colors line-clamp-2 mb-2">
                      {cs.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-4">
                      {cs.description}
                    </p>

                    {/* Tradeoff Highlight Box */}
                    <div className="p-3 rounded-xl bg-surface/70 border border-border-subtle text-xs text-slate-300">
                      <span className="font-mono text-[10px] text-slate-500 uppercase block mb-0.5">
                        Key Trade-off Driver
                      </span>
                      <p className="font-medium text-slate-200">
                        {cs.keyTradeoff}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer Action */}
                <div className="p-6 pt-0 border-t border-border-subtle/50 mt-4 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-500">
                    Preloaded Template
                  </span>
                  <button
                    onClick={() => {
                      sound.playTick();
                      onOpenSandbox();
                    }}
                    className="text-xs font-mono font-semibold text-signal hover:underline flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover border border-border cursor-pointer transition-all"
                  >
                    <MousePointerClick className="w-3.5 h-3.5" />
                    <span>Click to simulate</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
