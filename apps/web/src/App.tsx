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
import { ScrollToTop } from './components/ScrollToTop';
import { AuthModal } from './components/AuthModal';
import { AcceptInvitationModal } from './components/AcceptInvitationModal';
import { WorkspaceAnalyticsModal } from './components/WorkspaceAnalyticsModal';
import { AuthProvider } from './context/AuthContext';
import { useDecisionModel } from './hooks/useDecisionModel';

function AppContent() {
  const [isSandboxOpen, setIsSandboxOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isWorkspaceAnalyticsOpen, setIsWorkspaceAnalyticsOpen] = useState(false);
  const [incomingInviteToken, setIncomingInviteToken] = useState<string | null>(null);

  const decisionModel = useDecisionModel();

  const {
    dataset,
    criteria,
    options,
    weights,
    activeOptionIds,
    engineResult,
    setCriterionWeight,
    decisionId,
    isAuthoritative,
    loadDecision,
  } = decisionModel;

  const { winner, runnerUp, explainability, sensitivity, evaluations } = engineResult;

  const accessibleTipping = sensitivity.find(
    (s) => s.tippingPointWeight !== null && s.weightDeltaNeeded !== null && s.wouldFlipToOptionId !== null
  );

  const tippingStr = accessibleTipping
    ? `TIPPING: ${accessibleTipping.criterionName} > ${accessibleTipping.tippingPointWeight}% flips to ${accessibleTipping.wouldFlipToOptionName}`
    : 'LEAD IS MATHEMATICALLY STABLE';

  // Support direct URL retrieval via ?decisionId=<mongoId> or ?inviteToken=<token>
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get('decisionId');
      if (urlId && urlId.trim()) {
        loadDecision(urlId.trim()).then((doc) => {
          if (doc) {
            setIsSandboxOpen(true);
          }
        });
      }

      const inviteToken = params.get('inviteToken') || params.get('token');
      if (inviteToken && inviteToken.trim()) {
        setIncomingInviteToken(inviteToken.trim());
      }
    } catch {
      // URL parsing failed safely
    }
  }, [loadDecision]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsAuditOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsSandboxOpen(false);
        setIsAuditOpen(false);
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
        onOpenAnalytics={() => setIsWorkspaceAnalyticsOpen(true)}
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
          decisionId={decisionId}
          isAuthoritative={isAuthoritative}
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
      />

      {/* Floating Scroll To Top / Start Navigation Arrow */}
      <ScrollToTop />

      {/* Interactive Sandbox Modal */}
      <InteractiveModal
        isOpen={isSandboxOpen}
        onClose={() => setIsSandboxOpen(false)}
        model={decisionModel}
      />

      {/* Mathematical Audit Terminal Easter Egg */}
      <EasterEgg
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
      />

      {/* Centralized Authentication Modal */}
      <AuthModal />

      {/* Phase 6 Accept Invitation Modal */}
      <AcceptInvitationModal
        isOpen={incomingInviteToken != null}
        onClose={() => setIncomingInviteToken(null)}
        token={incomingInviteToken}
        onAccepted={async (newDecisionId) => {
          setIncomingInviteToken(null);
          await loadDecision(newDecisionId);
          setIsSandboxOpen(true);
        }}
      />
      {/* Phase 10 Workspace Analytics Modal */}
      <WorkspaceAnalyticsModal
        isOpen={isWorkspaceAnalyticsOpen}
        onClose={() => setIsWorkspaceAnalyticsOpen(false)}
      />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
