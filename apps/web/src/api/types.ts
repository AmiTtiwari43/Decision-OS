import type { EngineResult, OptionEvaluationResult, TippingPointResult, CriterionContribution } from '@decision-os/decision-engine';

export type { EngineResult, OptionEvaluationResult, TippingPointResult, CriterionContribution };

export type CriterionDirection = 'benefit' | 'cost';

export interface DecisionCriterionDto {
  id: string;
  name: string;
  shortName?: string;
  weight: number;
  direction: CriterionDirection;
  isLocked?: boolean;
}

export interface DecisionOptionDto {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  color?: string;
}

/**
 * Nested map of optionId -> criterionId -> score (0..100).
 */
export type ScoreMatrixDto = Record<string, Record<string, number>>;

export interface DecisionDto {
  _id: string;
  title: string;
  description: string;
  criteria: DecisionCriterionDto[];
  options: DecisionOptionDto[];
  scores: ScoreMatrixDto;
  analysis: EngineResult | null;
  calculationVersion: number;
  currentUserRole?: 'owner' | 'editor' | 'viewer' | 'contributor';
  isContributionRoundLocked?: boolean;
  contributionRoundLockedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDecisionPayload {
  title: string;
  description?: string;
  criteria?: DecisionCriterionDto[];
  options?: DecisionOptionDto[];
  scores?: ScoreMatrixDto;
}

export interface UpdateDecisionPayload {
  title?: string;
  description?: string;
  criteria?: DecisionCriterionDto[];
  options?: DecisionOptionDto[];
  scores?: ScoreMatrixDto;
}

export interface ListDecisionsQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface PaginatedDecisionsDto {
  items: DecisionDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MissingScorePairDto {
  optionId: string;
  criterionId: string;
}

export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
  missingPairs?: MissingScorePairDto[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponseDto {
  user: UserDto;
  token: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

// ─── Sharing & Invitation Types ─────────────────────────────────────────────

export type DecisionCollaboratorRole = 'editor' | 'viewer' | 'contributor';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationDto {
  id: string;
  decisionId: string;
  email: string;
  role: DecisionCollaboratorRole;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitationPayload {
  email: string;
  role: DecisionCollaboratorRole;
}

export interface CreateInvitationResponseDto {
  invitation: InvitationDto;
  token: string;
  invitationLink: string;
}

export interface AccessGrantCollaboratorDto {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  role: DecisionCollaboratorRole;
  createdAt: string;
}

export interface DecisionAccessListDto {
  owner: {
    id: string;
    name: string;
    email: string;
  } | null;
  collaborators: AccessGrantCollaboratorDto[];
}

export interface UpdateAccessGrantPayload {
  role: DecisionCollaboratorRole;
}

export interface AcceptInvitationPayload {
  token: string;
}

export interface AcceptInvitationResponseDto {
  message: string;
  decisionId: string;
  role: DecisionCollaboratorRole;
}

export interface InvitationDetailsDto {
  email: string;
  role: DecisionCollaboratorRole;
  status: string;
  expiresAt: string;
  decisionTitle: string;
  inviterName?: string;
}

export interface PendingInvitationDto {
  id: string;
  decisionId: {
    _id?: string;
    id?: string;
    title: string;
    description?: string;
  };
  inviterId: {
    _id?: string;
    id?: string;
    name: string;
    email: string;
  };
  role: DecisionCollaboratorRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

// ─── Phase 7: Expert Contribution Types ─────────────────────────────────────

export type ContributionStatus = 'draft' | 'submitted' | 'withdrawn';

export interface ContributionPredictionDto {
  statement?: string;
  targetDate?: string;
  probability?: number;
}

export interface ContributionRecommendationDto {
  preferredOptionId: string;
  rationale?: string;
}

export interface ContributionRevisionSnapshotDto {
  revision: number;
  submittedAt: string;
  recommendation: ContributionRecommendationDto;
  criterionScores: Record<string, number>;
  criterionReasoning?: Record<string, string>;
  confidence?: number;
  prediction?: ContributionPredictionDto;
}

export interface DecisionContributionDto {
  id: string;
  decisionId: string;
  contributorId: {
    id: string;
    name: string;
    email: string;
  } | string;
  recommendation: ContributionRecommendationDto;
  criterionScores: Record<string, number>;
  criterionReasoning: Record<string, string>;
  confidence: number;
  prediction?: ContributionPredictionDto;
  evidenceReferences?: string[];
  status: ContributionStatus;
  revision: number;
  history: ContributionRevisionSnapshotDto[];
  submittedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveContributionPayload {
  preferredOptionId: string;
  rationale?: string;
  criterionScores?: Record<string, number>;
  criterionReasoning?: Record<string, string>;
  confidence?: number;
  prediction?: ContributionPredictionDto;
  evidenceReferences?: string[];
}

// ─── Phase 8: Evidence & Provenance Types ───────────────────────────────────

export type EvidenceTargetType = 'decision' | 'option' | 'criterion' | 'contribution';
export type EvidenceType = 'url' | 'document' | 'excerpt';
export type EvidenceCapturedVia = 'manual_entry' | 'web_link' | 'document_citation';

export interface EvidenceProvenanceDto {
  createdByName: string;
  createdByEmail: string;
  capturedVia: EvidenceCapturedVia;
}

export interface DecisionEvidenceDto {
  id: string;
  _id?: string;
  decisionId: string;
  targetType: EvidenceTargetType;
  targetId: string;
  createdById: string;
  type: EvidenceType;
  title: string;
  sourceUrl?: string | null;
  documentReference?: string | null;
  sourceExcerpt?: string | null;
  userSummary?: string | null;
  publicationDate?: string | null;
  provenance: EvidenceProvenanceDto;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEvidencePayload {
  targetType: EvidenceTargetType;
  targetId: string;
  type: EvidenceType;
  title: string;
  sourceUrl?: string | null;
  documentReference?: string | null;
  sourceExcerpt?: string | null;
  userSummary?: string | null;
  publicationDate?: string | null;
}

export interface UpdateEvidencePayload {
  title?: string;
  sourceUrl?: string | null;
  documentReference?: string | null;
  sourceExcerpt?: string | null;
  userSummary?: string | null;
  publicationDate?: string | null;
}

export interface ListEvidenceQuery {
  targetType?: EvidenceTargetType;
  targetId?: string;
}




// ─── Phase 9: AI Analyst Types ──────────────────────────────────────────────

export type AiCapability =
  | 'all'
  | 'executive_summary'
  | 'tradeoff_analysis'
  | 'evidence_gaps'
  | 'expert_perspectives'
  | 'assumptions_questions'
  | 'suggest_criteria';

export interface AiCriterionProposal {
  id: string;
  name: string;
  description: string;
  suggestedWeight: number;
  direction: 'benefit' | 'cost';
  rationale: string;
}

export interface AiEvidenceGap {
  targetType: 'decision' | 'option' | 'criterion' | 'contribution';
  targetId: string;
  targetName: string;
  gapDescription: string;
  recommendation: string;
}

export interface AiExpertPerspectiveSummary {
  totalContributionsAnalyzed: number;
  consensusAreas: string[];
  divergenceAreas: string[];
  keyInsights: string[];
}

export interface AiAnalystOutput {
  executiveSummary: string;
  tradeoffAnalysis?: {
    winnerObservation?: string;
    keyTradeoffs: string[];
    sensitivityNotes: string[];
  };
  evidenceGaps: AiEvidenceGap[];
  expertSummary?: AiExpertPerspectiveSummary;
  assumptions: string[];
  followUpQuestions: string[];
  suggestedCriteria: AiCriterionProposal[];
}

export interface AiAnalystResponseDto {
  decisionId: string;
  analysisType: AiCapability;
  generatedAt: string;
  provider: string;
  model: string;
  isAiGenerated: true;
  disclaimer: string;
  output: AiAnalystOutput;
}

export interface ApplyProposalCriterionInput {
  id: string;
  name: string;
  weight: number;
  direction?: 'benefit' | 'cost';
  isLocked?: boolean;
}

export interface ApplyProposalPayload {
  type: 'add_criterion';
  criterion: ApplyProposalCriterionInput;
}

// ─── Phase 10: Advanced Analytics Types ─────────────────────────────────────

export interface DecisionAnalyticsQueryOptions {
  includeMonteCarlo?: boolean;
  iterations?: number;
  seed?: number;
  sigmaRelative?: number;
}

export interface WorkspaceAnalyticsQueryOptions {
  startDate?: string;
  endDate?: string;
}

export interface DecisionAnalyticsDto {
  decisionId: string;
  title: string;
  description: string;
  evaluatedAt: string | null;
  outcome: 'decisive' | 'tie' | 'unscored';
  isAuthoritative: boolean;
  pointLead: number;
  winner: { id: string; name: string } | null;
  runnerUp: { id: string; name: string } | null;
  criteriaImportance: Array<{
    id: string;
    name: string;
    weight: number;
    isLocked: boolean;
    direction: 'benefit' | 'cost';
    relativeShare: number;
  }>;
  optionsPerformance: Array<{
    id: string;
    name: string;
    rank: number;
    weightedScore: number;
    unroundedScore: number;
    contributions: Array<{
      criterionId: string;
      criterionName: string;
      rawScore: number;
      weightedPoints: number;
      percentageOfTotal: number;
    }>;
  }>;
  sensitivityAnalysis: {
    analyticalTippingPoints: Array<{
      criterionId: string;
      criterionName: string;
      currentWeight: number;
      tippingPointWeight: number | null;
      weightDeltaNeeded: number | null;
      direction: 'increase' | 'decrease' | 'none';
      feasibility: 'low-threshold' | 'medium-threshold' | 'unreachable';
      wouldFlipToOptionId: string | null;
      wouldFlipToOptionName: string | null;
      summary: string;
    }>;
    optionScoreSensitivity: Array<{
      criterionId: string;
      criterionName: string;
      weight: number;
      scoreDeltaNeeded: number | null;
      leaderThresholdScore: number | null;
      challengerThresholdScore: number | null;
      feasibility: 'feasible' | 'unreachable';
      summary: string;
    }>;
    multiParameterCounterfactual: {
      isFeasible: boolean;
      totalWeightShiftL1: number;
      netShiftAmount: number;
      shifts: Array<{
        criterionId: string;
        criterionName: string;
        currentWeight: number;
        counterfactualWeight: number;
        delta: number;
      }>;
      targetOptionId: string | null;
      targetOptionName: string | null;
      summary: string;
    };
  };
  uncertaintyAnalysis: {
    hasMonteCarlo: boolean;
    iterations: number;
    seed: number;
    sigmaRelative: number;
    distributionModel: 'Gaussian Box-Muller on unlocked weights';
    metricInterpretation: 'win probability under the specified uncertainty model';
    robustnessRating: 'robust' | 'moderate' | 'sensitive' | 'unavailable';
    dominantOptionId: string | null;
    dominantWinProbability: number | null;
    optionResults: Array<{
      optionId: string;
      optionName: string;
      winCount: number;
      winProbability: number;
    }>;
  };
  evidenceCoverage: {
    totalEvidenceCount: number;
    byTargetType: {
      decision: number;
      option: number;
      criterion: number;
      contribution: number;
    };
    bySourceType: {
      url: number;
      document: number;
      excerpt: number;
    };
    optionsCoverage: Array<{
      optionId: string;
      optionName: string;
      evidenceCount: number;
      hasEvidence: boolean;
    }>;
    criteriaCoverage: Array<{
      criterionId: string;
      criterionName: string;
      evidenceCount: number;
      hasEvidence: boolean;
    }>;
    missingEvidenceTargets: {
      options: Array<{ id: string; name: string }>;
      criteria: Array<{ id: string; name: string }>;
    };
    methodologyDisclaimer: string;
  };
  expertParticipation: {
    totalContributions: number;
    submittedCount: number;
    draftCount: number;
    withdrawnCount: number;
    isRoundLocked: boolean;
    roundLockedAt: string | null;
    recommendationTally: Array<{
      optionId: string;
      optionName: string;
      count: number;
    }>;
    scoreSpreadByCriterion: Array<{
      criterionId: string;
      criterionName: string;
      minScore: number | null;
      maxScore: number | null;
      averageScore: number | null;
      scoreRange: number | null;
    }>;
    methodologyDisclaimer: string;
  };
}

export interface WorkspaceAnalyticsDto {
  generatedAt: string;
  timeframe: {
    startDate: string | null;
    endDate: string | null;
  };
  decisionMetrics: {
    totalDecisions: number;
    statusDistribution: {
      decisive: number;
      tie: number;
      unscored: number;
    };
    roundLockDistribution: {
      locked: number;
      open: number;
    };
    completionRate: number;
    averagePointLead: number | null;
  };
  activityTrends: Array<{
    period: string;
    createdCount: number;
  }>;
  criteriaAndOptionsMetrics: {
    totalCriteriaDefined: number;
    averageCriteriaPerDecision: number;
    totalOptionsDefined: number;
    averageOptionsPerDecision: number;
    topCriteriaNames: Array<{ name: string; count: number }>;
  };
  evidenceMetrics: {
    totalEvidenceRecords: number;
    decisionsWithEvidenceCount: number;
    decisionEvidenceCoverageRate: number;
    sourceTypeBreakdown: {
      url: number;
      document: number;
      excerpt: number;
    };
    methodologyDisclaimer: string;
  };
  deliberationMetrics: {
    totalContributions: number;
    submittedContributions: number;
    draftContributions: number;
    withdrawnContributions: number;
    decisionsWithContributionsCount: number;
    averageContributionsPerDecision: number;
    methodologyDisclaimer: string;
  };
}

// ─── Phase 11: Disagreement Intelligence Types ────────────────────────────────

export type DisagreementCategory = 'score' | 'priority' | 'evidence' | 'assumption' | 'interpretation';

export type DisagreementResolutionStatus = 'open' | 'acknowledged' | 'resolved';

export interface CriterionDisagreementMetricsDto {
  criterionId: string;
  criterionName: string;
  weight: number;
  sampleCount: number;
  minScore: number | null;
  maxScore: number | null;
  scoreRange: number | null;
  meanScore: number | null;
  sampleStdDev: number | null;
  medianScore: number | null;
  confidenceWeightedMean: number | null;
  isDecisionCritical: boolean;
  tippingDeltaThreshold: number | null;
  criticalReason?: string;
  scenarioResults: {
    minScenarioWinnerId: string | null;
    minScenarioWinnerFlips: boolean;
    medianScenarioWinnerId: string | null;
    medianScenarioWinnerFlips: boolean;
    maxScenarioWinnerId: string | null;
    maxScenarioWinnerFlips: boolean;
  };
}

export interface DisagreementResolutionDto {
  status: DisagreementResolutionStatus;
  explanation?: string;
  resolvedByName?: string;
  resolvedAt?: string;
}

export interface DisagreementItemDto {
  id: string;
  category: DisagreementCategory;
  title: string;
  criterionId?: string;
  criterionName?: string;
  optionId?: string;
  optionName?: string;
  isDecisionCritical: boolean;
  scoreMetrics?: CriterionDisagreementMetricsDto;
  description: string;
  numericalExplanation: string;
  participants: Array<{
    contributorId: string;
    contributorName?: string;
    value: string | number;
    confidence?: number;
    reasoning?: string;
  }>;
  suggestedClarificationQuestions: string[];
  resolution: DisagreementResolutionDto;
}

export interface DecisionDisagreementsDto {
  decisionId: string;
  hasSufficientData: boolean;
  totalContributors: number;
  totalDisagreements: number;
  decisionCriticalCount: number;
  items: DisagreementItemDto[];
  criteriaMetrics: CriterionDisagreementMetricsDto[];
  priorityBreakdown: Array<{
    optionId: string;
    optionName: string;
    recommendationCount: number;
    percentage: number;
  }>;
  summary: string;
}

export interface UpdateDisagreementResolutionPayload {
  status: DisagreementResolutionStatus;
  resolutionExplanation?: string;
}

export interface AiDisagreementExplanationDto {
  disagreementId: string;
  neutralSummary: string;
  underlyingAssumptions: string[];
  suggestedClarificationQuestions: string[];
  disclaimer: string;
}


// ─── Phase 12: Expert Calibration Types ─────────────────────────────────────

export type PredictionStatus =
  | 'submitted'
  | 'awaiting_outcome'
  | 'outcome_recorded'
  | 'verified'
  | 'disputed'
  | 'invalidated';

export interface PredictionOutcomeDto {
  outcomeId: string;
  observedOutcome: number; // 0 or 1
  verificationStatus: string;
  verificationSource: string;
  outcomeDate: string;
  verifiedById?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  disputeReason?: string;
  disputedById?: string;
  disputedAt?: string;
}

export interface PredictionDto {
  id: string;
  decisionId: string;
  contributorId: string;
  contributorName: string;
  predictionId: string;
  statement: string;
  probability: number;
  domain: string;
  targetDate: string;
  evidenceReferences: string[];
  status: PredictionStatus;
  submittedAt: string;
  outcome?: PredictionOutcomeDto;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePredictionPayload {
  statement: string;
  probability: number;
  targetDate: string;
  domain?: string;
  evidenceReferences?: string[];
}

export interface RecordOutcomePayload {
  observedOutcome: number;
  outcomeDate: string;
  verificationSource: string;
  verificationStatus?: 'verified' | 'unverified';
}

export interface DisputeOutcomePayload {
  disputeReason: string;
}

export interface CalibrationBinDto {
  binIndex: number;
  range: string;
  count: number;
  meanPredictedProbability: number;
  observedFrequency: number;
  calibrationError: number;
}

export interface DomainCalibrationMetricsDto {
  domain: string;
  count: number;
  brierScore: number;
  expectedCalibrationError: number;
}

export interface ExpertCalibrationProfileDto {
  contributorId: string;
  contributorName: string;
  calibration: {
    hasSufficientSample: boolean;
    eligibleCount: number;
    brierScore: number | null;
    expectedCalibrationError: number | null;
    climatologyBss: number | null;
  };
  domainBreakdown: DomainCalibrationMetricsDto[];
  experience: {
    totalContributions: number;
    totalPredictions: number;
    verifiedPredictions: number;
    awaitingOutcome: number;
  };
  evidenceQuality: {
    citationsProvided: number;
    verifiedReferences: number;
  };
  recency: {
    lastPredictionAt: string | null;
    lastOutcomeAt: string | null;
  };
  popularity: {
    label: string;
    preferredOptionAgreementRate: number | null;
  };
}

export interface DecisionCalibrationDto {
  decisionId: string;
  methodologyVersion: string;
  calculatedAt: string;
  totalPredictions: number;
  verifiedCount: number;
  awaitingOutcomeCount: number;
  disputedCount: number;
  hasSufficientSample: boolean;
  minimumSampleThreshold: number;
  brierScore: number | null;
  climatologyBss: number | null;
  expectedCalibrationError: number | null;
  calibrationBins: CalibrationBinDto[];
  domainBreakdown: DomainCalibrationMetricsDto[];
  summary: string;
  eligibleCount: number;
  excludedCount: number;
  expertProfiles: ExpertCalibrationProfileDto[];
  formulaDocumentation: {
    brierScore: string;
    ece: string;
    bss: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 13: Audit, History & Export DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditEventDto {
  eventId: string;
  decisionId: string;
  actorId: string;
  actorEmail?: string;
  actorName?: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  diff?: {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    changedFields?: string[];
  } | null;
  timestamp: string;
  eventHash: string;
  previousEventHash: string;
  schemaVersion: number;
}

export interface AuditHistoryResponseDto {
  items: AuditEventDto[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ChainVerificationResultDto {
  decisionId: string;
  isValid: boolean;
  totalEventsChecked: number;
  rootHash: string | null;
  headHash: string | null;
  verifiedAt: string;
  brokenAtEventId?: string;
  reason?: string;
}

export interface DecisionSnapshotDto {
  snapshotId: string;
  decisionId: string;
  version: number;
  title: string;
  description: string;
  criteria: DecisionCriterionDto[];
  options: DecisionOptionDto[];
  scores: Record<string, Record<string, number>>;
  analysis: EngineResult | null;
  metadata: {
    evidenceCount: number;
    contributionCount: number;
    predictionCount: number;
    disagreementCount: number;
  };
  snapshotReason: string;
  snapshotNote?: string;
  createdAt: string;
  createdById: string;
}

export interface DecisionSnapshotsResponseDto {
  items: DecisionSnapshotDto[];
}

export type ExportFormat = 'json' | 'csv' | 'html';

