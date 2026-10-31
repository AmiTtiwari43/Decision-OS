import type { Types } from 'mongoose';
import type { DecisionCriterion, DecisionOption, ScoreMatrix } from './decision.types.js';
import type { EngineResult } from '@decision-os/decision-engine';

export interface IDecisionSnapshot {
  snapshotId: string;
  decisionId: Types.ObjectId;
  version: number;
  title: string;
  description: string;
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  scores: ScoreMatrix;
  analysis: EngineResult | null;
  metadata: {
    evidenceCount: number;
    contributionCount: number;
    predictionCount: number;
    disagreementCount: number;
  };
  snapshotReason: 'calculation' | 'milestone' | 'manual' | 'round_lock';
  snapshotNote?: string;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
}

export interface DecisionSnapshotDocument extends IDecisionSnapshot {
  _id: Types.ObjectId;
}

export interface DecisionSnapshotDto {
  snapshotId: string;
  decisionId: string;
  version: number;
  title: string;
  description: string;
  criteria: DecisionCriterion[];
  options: DecisionOption[];
  scores: ScoreMatrix;
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

