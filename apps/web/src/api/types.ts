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
