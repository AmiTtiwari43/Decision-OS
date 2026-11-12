import { useState, useEffect, Suspense, lazy } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ProblemSection } from './components/ProblemSection';
import { HowItWorks } from './components/HowItWorks';
import { DecisionDemo } from './components/DecisionDemo';
import { InstrumentsShowcase } from './components/InstrumentsShowcase';
import { ShowcaseSection } from './components/ShowcaseSection';
import { DecisionTicket } from './components/DecisionTicket';
import { DecisionTicker } from './components/DecisionTicker';
import { CaseStudies } from './components/CaseStudies';
import { DecisionHistoryTimeline } from './components/DecisionHistoryTimeline';
import { TransparencySection } from './components/TransparencySection';
import { Principles } from './components/Principles';
import { FinalCTA } from './components/FinalCTA';
import { Footer } from './components/Footer';
import { ScrollToTop } from './components/ScrollToTop';
import { Logo } from './components/Logo';
import { Dashboard } from './components/Dashboard';
import { AuthProvider } from './context/AuthContext';
import { useDecisionModel } from './hooks/useDecisionModel';
import { useAuth } from './hooks/useAuth';

// Lazy-loaded modal components for bundle splitting and faster initial page paint
const InteractiveModal = lazy(() => import('./components/InteractiveModal').then(m => ({ default: m.InteractiveModal })));
const EasterEgg = lazy(() => import('./components/EasterEgg').then(m => ({ default: m.EasterEgg })));
const AuthModal = lazy(() => import('./components/AuthModal').then(m => ({ default: m.AuthModal })));
const AcceptInvitationModal = lazy(() => import('./components/AcceptInvitationModal').then(m => ({ default: m.AcceptInvitationModal })));
const WorkspaceAnalyticsModal = lazy(() => import('./components/WorkspaceAnalyticsModal').then(m => ({ default: m.WorkspaceAnalyticsModal })));

function AppContent() {
  const { user, isAuthenticated, isInitializing, sessionError, retrySession, logout } = useAuth();
  const [activeView, setActiveView] = useState<'app' | 'marketing'>('app');
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
    lockedIds,
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

  // Prevent flash of unauthenticated or authenticated content before session validation completes
  if (isInitializing) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background text-slate-100 font-sans antialiased">
        <div className="flex flex-col items-center gap-4">
          <Logo size="lg" />
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span className="w-2 h-2 rounded-full bg-signal animate-pulse" />
            <span>Verifying Decision OS session...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-background text-slate-100 selection:bg-signal selection:text-background font-sans antialiased">
      {/* Top sticky navigation */}
      <Navbar
        onOpenSandbox={() => setIsSandboxOpen(true)}
        onOpenAudit={() => setIsAuditOpen(true)}
        onOpenAnalytics={() => setIsWorkspaceAnalyticsOpen(true)}
        activeView={activeView}
        onSelectView={setActiveView}
      />

      {/* Main Content Area */}
      <main className="w-full max-w-full overflow-x-hidden">
        {/* Recoverable Session Connection Alert Banner */}
        {sessionError && !isAuthenticated && (
          <div className="pt-20 px-4 max-w-7xl mx-auto">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="font-mono">{sessionError}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <button
                  onClick={() => retrySession()}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-mono font-semibold transition-all cursor-pointer text-xs"
                >
                  Retry Connection
                </button>
                <button
                  onClick={() => logout()}
                  className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 font-mono transition-colors cursor-pointer text-xs"
                  title="Clear saved session"
                >
                  Clear Session
                </button>
              </div>
            </div>
          </div>
        )}

        {isAuthenticated && activeView === 'app' ? (
          <Dashboard
            onOpenStudio={async (decision) => {
              await loadDecision(decision._id);
              setIsSandboxOpen(true);
            }}
            onOpenAudit={() => setIsAuditOpen(true)}
            onViewProductTour={() => setActiveView('marketing')}
          />
        ) : (
          <>
            {/* Public Marketing Landing View */}
            {isAuthenticated && (
              <div className="pt-20 px-4 max-w-7xl mx-auto flex items-center justify-between pb-2">
                <span className="text-xs font-mono text-slate-400">
                  Viewing Public Overview as <strong className="text-white">{user?.name}</strong>
                </span>
                <button
                  onClick={() => setActiveView('app')}
                  className="px-3 py-1 rounded-lg bg-surface border border-signal/40 text-signal text-xs font-mono hover:bg-surface-subtle transition-all cursor-pointer"
                >
                  ← Return to Workspace Hub
                </button>
              </div>
            )}
            <Hero onOpenSandbox={() => setIsSandboxOpen(true)} />

            {/* Live Telemetry Ticker Ribbon */}
            <DecisionTicker
              leaderName={
                engineResult.isIncomplete
                  ? 'Pending Complete Scores'
                  : engineResult.isInvalid
                  ? (engineResult.invalidReason === 'scores' ? 'Invalid Scores' : 'Invalid Weights')
                  : winner
                  ? winner.option.name
                  : 'No Leader'
              }
              leaderScore={
                engineResult.isIncomplete || engineResult.isInvalid
                  ? 0
                  : winner
                  ? winner.weightedScore
                  : 0
              }
              scoreLead={
                engineResult.isIncomplete || engineResult.isInvalid
                  ? 0
                  : explainability.pointLead
              }
              tippingInfo={
                engineResult.isIncomplete || engineResult.isInvalid
                  ? (engineResult.isInvalid
                      ? (engineResult.invalidReason === 'scores' ? 'Invalid Score Values' : 'Weights Exceed 100%')
                      : 'Scores Incomplete')
                  : tippingStr
              }
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
                lockedIds={lockedIds}
                activeOptionIds={activeOptionIds}
                evaluations={evaluations}
                sensitivity={sensitivity}
                onSelectWeight={(cId, targetWeight) => setCriterionWeight(cId, targetWeight)}
              />
            </div>

            {/* Batch 03: Collaboration, AI Advisory & Cryptographic Audit Showcase */}
            <div id="governance-showcase">
              <ShowcaseSection
                onOpenStudio={() => setIsSandboxOpen(true)}
                onOpenAudit={() => setIsAuditOpen(true)}
              />
            </div>

            {/* Verified Boardroom Decision Briefing Pass */}
            {winner && !engineResult.isIncomplete && !engineResult.isInvalid && (
              <DecisionTicket
                winner={winner}
                runnerUp={runnerUp}
                criteria={criteria}
                weights={weights}
                question={dataset.question}
                decisionId={decisionId}
                isAuthoritative={isAuthoritative}
              />
            )}

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
          </>
        )}
      </main>

      {/* Honest Footer */}
      <Footer
        onOpenSandbox={() => setIsSandboxOpen(true)}
        onOpenAudit={() => setIsAuditOpen(true)}
      />

      {/* Floating Scroll To Top / Start Navigation Arrow */}
      <ScrollToTop />

      {/* Code-split and lazy-loaded on-demand modals */}
      <Suspense fallback={null}>
        {isSandboxOpen && (
          <InteractiveModal
            isOpen={isSandboxOpen}
            onClose={() => setIsSandboxOpen(false)}
            model={decisionModel}
          />
        )}

        {isAuditOpen && (
          <EasterEgg
            isOpen={isAuditOpen}
            onClose={() => setIsAuditOpen(false)}
          />
        )}

        <AuthModal />

        {incomingInviteToken != null && (
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
        )}

        {isWorkspaceAnalyticsOpen && (
          <WorkspaceAnalyticsModal
            isOpen={isWorkspaceAnalyticsOpen}
            onClose={() => setIsWorkspaceAnalyticsOpen(false)}
          />
        )}
      </Suspense>
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
