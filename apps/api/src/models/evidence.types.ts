import type { Types } from 'mongoose';

export type EvidenceTargetType = 'decision' | 'option' | 'criterion' | 'contribution';
export type EvidenceType = 'url' | 'document' | 'excerpt';
export type EvidenceCapturedVia = 'manual_entry' | 'web_link' | 'document_citation';

export interface IEvidenceProvenance {
  createdByName: string;
  createdByEmail: string;
  capturedVia: EvidenceCapturedVia;
}

export interface IDecisionEvidence {
  decisionId: Types.ObjectId;
  targetType: EvidenceTargetType;
  targetId: string;
  createdById: Types.ObjectId;
  type: EvidenceType;
  title: string;
  sourceUrl?: string | null;
  documentReference?: string | null;
  sourceExcerpt?: string | null;
  userSummary?: string | null;
  publicationDate?: Date | null;
  provenance: IEvidenceProvenance;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionEvidenceDocument extends IDecisionEvidence {
  _id: Types.ObjectId;
}

export interface CreateEvidenceInput {
  targetType: EvidenceTargetType;
  targetId: string;
  type: EvidenceType;
  title: string;
  sourceUrl?: string | null;
  documentReference?: string | null;
  sourceExcerpt?: string | null;
  userSummary?: string | null;
  publicationDate?: Date | null;
}

export interface UpdateEvidenceInput {
  title?: string;
  sourceUrl?: string | null;
  documentReference?: string | null;
  sourceExcerpt?: string | null;
  userSummary?: string | null;
  publicationDate?: Date | null;
}

export interface ListEvidenceFilter {
  decisionId: string;
  targetType?: EvidenceTargetType;
  targetId?: string;
}

