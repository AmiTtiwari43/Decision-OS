import type { Types } from 'mongoose';
import type { EngineResult } from '@decision-os/decision-engine';

export type CriterionDirection = 'benefit' | 'cost';

export interface DecisionCriterion {
  id: string;
  name: string;
  shortName?: string;
  weight: number;
  direction: CriterionDirection;
  isLocked?: boolean;
}

export interface DecisionOption {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  color?: string;
}

/**
 * Nested map of optionId -> criterionId -> score (0..100).
 */
export type ScoreMatrix = Record<string, Record<string, number>>;

export interface IDecision {
  title: string;
  description: string;
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  scores: ScoreMatrix;
  analysis: EngineResult | null;
  calculationVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionDocument extends IDecision {
  _id: Types.ObjectId;
}

export interface CreateDecisionInput {
  title: string;
  description?: string;
  criteria?: DecisionCriterion[];
  options?: DecisionOption[];
  scores?: ScoreMatrix;
  analysis?: EngineResult | null;
  calculationVersion?: number;
}

export interface UpdateDecisionInput {
  title?: string;
  description?: string;
  criteria?: DecisionCriterion[];
  options?: DecisionOption[];
  scores?: ScoreMatrix;
  analysis?: EngineResult | null;
  calculationVersion?: number;
}
