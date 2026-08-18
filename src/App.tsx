import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ProblemSection } from './components/ProblemSection';
import { HowItWorks } from './components/HowItWorks';
import { DecisionDemo } from './components/DecisionDemo';
import { InstrumentsShowcase } from './components/InstrumentsShowcase';
import { DecisionTicket } from './components/DecisionTicket';
import { DecisionTicker } from './components/DecisionTicker';
import { CaseStudies } from './components/CaseStudies';
import { DecisionHistoryTimeline } from './components/DecisionHistoryTimeline';
import { TransparencySection } from './components/TransparencySection';
import { Principles } from './components/Principles';
import { FinalCTA } from './components/FinalCTA';
import { Footer } from './components/Footer';
import { InteractiveModal } from './components/InteractiveModal';
import { EasterEgg } from './components/EasterEgg';
import { ProductTour } from './components/ProductTour';
import { ScrollToTop } from './components/ScrollToTop';
import { useDecisionModel } from './hooks/useDecisionModel';

export function App() {
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);

  const {
    dataset,
    criteria,
    options,
    weights,
    activeOptionIds,
    engineResult,
    setCriterionWeight,
  } = useDecisionModel();

  const { winner, runnerUp, explainability, sensitivity, evaluations } = engineResult;

  const accessibleTipping = sensitivity.find(
    (s) => s.tippingPointWeight !== null && s.weightDeltaNeeded !== null && s.wouldFlipToOptionId !== null
  );

  const tippingStr = accessibleTipping
    ? `TIPPING: ${accessibleTipping.criterionName} > ${accessibleTipping.tippingPointWeight}% flips to ${accessibleTipping.wouldFlipToOptionName}`
    : 'LEAD IS MATHEMATICALLY STABLE';

  // Check first visit and auto-open tour
  useEffect(() => {
    const hasSeenTour = localStorage.getItem('decision_os_tour_seen');
    if (!hasSeenTour) {
      const timer = setTimeout(() => {
        setIsTourOpen(true);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleCloseTour = () => {
    localStorage.setItem('decision_os_tour_seen', 'true');
    setIsTourOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsAuditOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsSandboxOpen(false);
        setIsAuditOpen(false);
        setIsTourOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-background text-slate-100 selection:bg-signal selection:text-background font-sans antialiased">
      {/* Top sticky navigation */}
      <Navbar
        onOpenSandbox={() => setIsSandboxOpen(true)}
        onOpenAudit={() => setIsAuditOpen(true)}
        onOpenTour={() => setIsTourOpen(true)}
      />

      {/* Main Narrative Structure */}
      <main className="w-full max-w-full overflow-x-hidden">
        <Hero onOpenSandbox={() => setIsSandboxOpen(true)} />

        {/* Live Telemetry Ticker Ribbon */}
        <DecisionTicker
          leaderName={winner.option.name}
          leaderScore={winner.weightedScore}
          scoreLead={explainability.pointLead}
          tippingInfo={tippingStr}
        />

        <ProblemSection />
        <HowItWorks />

        {/* Focused, De-cluttered Interactive Decision Studio */}
        <DecisionDemo onOpenSandbox={() => setIsSandboxOpen(true)} />

        {/* Dedicated Deep Studio Instruments Showcase */}
        <div id="instruments">
          <InstrumentsShowcase
            criteria={criteria}
            options={options}
            weights={weights}
            activeOptionIds={activeOptionIds}
            evaluations={evaluations}
            sensitivity={sensitivity}
            onSelectWeight={(cId, targetWeight) => setCriterionWeight(cId, targetWeight)}
          />
        </div>

        {/* Verified Boardroom Decision Briefing Pass */}
        <DecisionTicket
          winner={winner}
          runnerUp={runnerUp}
          criteria={criteria}
          weights={weights}
          question={dataset.question}
        />

        {/* Real Scenario Case Studies */}
        <CaseStudies onOpenSandbox={() => setIsSandboxOpen(true)} />

        {/* 4-Stage Decision Evolution Timeline */}
        <DecisionHistoryTimeline onOpenSandbox={() => setIsSandboxOpen(true)} />

        {/* Mathematical Transparency Section */}
        <TransparencySection />

        {/* Core Tenet Principles */}
        <Principles />

        {/* Final CTA */}
        <FinalCTA onOpenSandbox={() => setIsSandboxOpen(true)} />
      </main>

      {/* Honest Footer */}
      <Footer
        onOpenSandbox={() => setIsSandboxOpen(true)}
        onOpenAudit={() => setIsAuditOpen(true)}
        onOpenTour={() => setIsTourOpen(true)}
      />

      {/* Floating Scroll To Top / Start Navigation Arrow */}
      <ScrollToTop />

      {/* Interactive Guided Tour / Onboarding Walkthrough */}
      <ProductTour
        isOpen={isTourOpen}
        onClose={handleCloseTour}
        onOpenSandbox={() => setIsSandboxOpen(true)}
      />

      {/* Interactive Sandbox Modal */}
      <InteractiveModal
        isOpen={isSandboxOpen}
        onClose={() => setIsSandboxOpen(false)}
      />

      {/* Mathematical Audit Terminal Easter Egg */}
      <EasterEgg
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
      />
    </div>
  );
}

export default App;
