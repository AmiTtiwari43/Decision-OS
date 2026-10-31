import type { Types } from 'mongoose';
import type { DisagreementCategory } from '@decision-os/decision-engine';

export type DisagreementResolutionStatus = 'open' | 'acknowledged' | 'resolved';

export interface IDisagreementResolution {
  decisionId: Types.ObjectId;
  disagreementId: string;
  category?: DisagreementCategory;
  criterionId?: string;
  optionId?: string;
  status: DisagreementResolutionStatus;
  resolutionExplanation?: string;
  resolvedById?: Types.ObjectId;
  resolvedByName?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisagreementResolutionDocument extends IDisagreementResolution {
  _id: Types.ObjectId;
}

export interface UpdateDisagreementResolutionInput {
  status: DisagreementResolutionStatus;
  resolutionExplanation?: string;
}

