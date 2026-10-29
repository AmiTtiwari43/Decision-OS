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
