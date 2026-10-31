import type { Types } from 'mongoose';

export type PredictionStatus =
  | 'submitted'
  | 'awaiting_outcome'
  | 'outcome_recorded'
  | 'verified'
  | 'disputed'
  | 'invalidated';

export type OutcomeVerificationStatus = 'unverified' | 'verified' | 'disputed';

export interface IPredictionOutcome {
  outcomeId: string;
  observedOutcome: number; // 0 or 1
  verificationStatus: OutcomeVerificationStatus;
  verificationSource: string;
  outcomeDate: Date;
  verifiedById?: Types.ObjectId;
  verifiedByName?: string;
  verifiedAt?: Date;
  disputeReason?: string;
  disputedById?: Types.ObjectId;
  disputedAt?: Date;
}

export interface IExpertPrediction {
  decisionId: Types.ObjectId;
  contributorId: Types.ObjectId;
  contributorName: string;
  predictionId: string;
  statement: string;
  probability: number; // 0..1
  domain: string;
  targetDate: Date;
  evidenceReferences?: string[];
  status: PredictionStatus;
  submittedAt: Date;
  outcome?: IPredictionOutcome;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpertPredictionDocument extends IExpertPrediction {
  _id: Types.ObjectId;
}

export interface CreatePredictionInput {
  statement: string;
  probability: number;
  targetDate: string | Date;
  domain?: string;
  evidenceReferences?: string[];
}

export interface RecordOutcomeInput {
  observedOutcome: number;
  outcomeDate: string | Date;
  verificationSource: string;
  verificationStatus?: 'verified' | 'unverified';
}

export interface DisputeOutcomeInput {
  disputeReason: string;
}

