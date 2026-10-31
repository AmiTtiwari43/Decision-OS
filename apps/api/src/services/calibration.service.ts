import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {
  calculateExpertCalibration,
  type CalibrationPredictionInput,
  type ExpertCalibrationResult,
} from '@decision-os/decision-engine';
import {
  decisionRepository,
  predictionRepository,
  contributionRepository,
  userRepository,
} from '../repositories/index.js';
import { authorizeDecisionAction } from './authorization.service.js';
import { auditService } from './audit.service.js';
import type { RequesterContext } from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
  PredictionNotFoundError,
  RetrospectivePredictionError,
  InvalidOutcomeDateError,
} from '../errors/domain.errors.js';
import type {
  CreatePredictionInput,
  RecordOutcomeInput,
  DisputeOutcomeInput,
  ExpertPredictionDocument,
} from '../models/index.js';

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
  status: string;
  submittedAt: string;
  outcome?: {
    outcomeId: string;
    observedOutcome: number;
    verificationStatus: string;
    verificationSource: string;
    outcomeDate: string;
    verifiedById?: string;
    verifiedByName?: string;
    verifiedAt?: string;
    disputeReason?: string;
    disputedById?: string;
    disputedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
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
  domainBreakdown: Array<{
    domain: string;
    count: number;
    brierScore: number;
    expectedCalibrationError: number;
  }>;
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

export interface DecisionCalibrationDto extends ExpertCalibrationResult {
  decisionId: string;
  calculatedAt: string;
  totalPredictions: number;
  verifiedCount: number;
  awaitingOutcomeCount: number;
  disputedCount: number;
  expertProfiles: ExpertCalibrationProfileDto[];
  formulaDocumentation: {
    brierScore: string;
    ece: string;
    bss: string;
  };
}

function predictionToDto(doc: ExpertPredictionDocument): PredictionDto {
  return {
    id: doc._id.toString(),
    decisionId: doc.decisionId.toString(),
    contributorId: doc.contributorId.toString(),
    contributorName: doc.contributorName,
    predictionId: doc.predictionId,
    statement: doc.statement,
    probability: doc.probability,
    domain: doc.domain,
    targetDate: doc.targetDate.toISOString(),
    evidenceReferences: doc.evidenceReferences || [],
    status: doc.status,
    submittedAt: doc.submittedAt.toISOString(),
    outcome: doc.outcome
      ? {
          outcomeId: doc.outcome.outcomeId,
          observedOutcome: doc.outcome.observedOutcome,
          verificationStatus: doc.outcome.verificationStatus,
          verificationSource: doc.outcome.verificationSource,
          outcomeDate: doc.outcome.outcomeDate.toISOString(),
          verifiedById: doc.outcome.verifiedById?.toString(),
          verifiedByName: doc.outcome.verifiedByName,
          verifiedAt: doc.outcome.verifiedAt ? doc.outcome.verifiedAt.toISOString() : undefined,
          disputeReason: doc.outcome.disputeReason,
          disputedById: doc.outcome.disputedById?.toString(),
          disputedAt: doc.outcome.disputedAt ? doc.outcome.disputedAt.toISOString() : undefined,
        }
      : undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class CalibrationService {
  async listPredictions(
    decisionId: string,
    filter?: { contributorId?: string; status?: string; domain?: string },
    requester?: RequesterContext
  ): Promise<PredictionDto[]> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const docs = await predictionRepository.listByDecision(decisionId, filter);
    return docs.map(predictionToDto);
  }

  async createPrediction(
    decisionId: string,
    input: CreatePredictionInput,
    requester?: RequesterContext
  ): Promise<PredictionDto> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    // Enforce contributor permission
    await authorizeDecisionAction(decision, 'contribute', requester);

    const targetDate = new Date(input.targetDate);
    if (isNaN(targetDate.getTime())) {
      throw new RetrospectivePredictionError('Invalid target date provided');
    }

    // Prospective enforcement: target date must be in the future
    if (targetDate.getTime() <= Date.now()) {
      throw new RetrospectivePredictionError(
        'Prediction target date must be in the future. Retrospective forecasts are strictly prohibited.'
      );
    }

    const predictionId = `pred_${crypto.randomUUID().slice(0, 8)}`;
    const contributorId = requester?.id ? new mongoose.Types.ObjectId(requester.id) : new mongoose.Types.ObjectId();
    const contributorName = requester?.name || requester?.email || 'Expert Contributor';

    const doc = await predictionRepository.create({
      decisionId: new mongoose.Types.ObjectId(decisionId),
      contributorId,
      contributorName,
      predictionId,
      statement: input.statement.trim(),
      probability: Math.max(0, Math.min(1, input.probability)),
      domain: (input.domain || 'general').trim().toLowerCase(),
      targetDate,
      evidenceReferences: input.evidenceReferences || [],
      status: 'awaiting_outcome',
      submittedAt: new Date(),
    });

    const resultDto = predictionToDto(doc);

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'prediction.created',
      entityType: 'prediction',
      entityId: predictionId,
      summary: `Submitted prediction: "${doc.statement}" (${(doc.probability * 100).toFixed(0)}%)`,
      diff: {
        after: {
          probability: doc.probability,
          domain: doc.domain,
          targetDate: doc.targetDate.toISOString(),
        },
      },
    });

    return resultDto;
  }

  async recordOutcome(
    decisionId: string,
    predictionId: string,
    input: RecordOutcomeInput,
    requester?: RequesterContext
  ): Promise<PredictionDto> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    // Only decision owner or editor can record and verify outcomes
    await authorizeDecisionAction(decision, 'edit', requester);

    const prediction = await predictionRepository.findByPredictionId(decisionId, predictionId);
    if (!prediction) {
      throw new PredictionNotFoundError(`Prediction with ID "${predictionId}" not found for this decision.`);
    }

    const outcomeDate = new Date(input.outcomeDate);
    if (isNaN(outcomeDate.getTime())) {
      throw new InvalidOutcomeDateError('Invalid outcome date provided');
    }

    // Outcome date cannot precede prediction submission
    if (outcomeDate.getTime() < prediction.submittedAt.getTime()) {
      throw new InvalidOutcomeDateError(
        `Outcome date (${outcomeDate.toISOString()}) cannot precede prediction submission date (${prediction.submittedAt.toISOString()}).`
      );
    }

    const isVerified = input.verificationStatus !== 'unverified';
    const outcomeId = `outc_${crypto.randomUUID().slice(0, 8)}`;

    const updated = await predictionRepository.updateOutcome(
      decisionId,
      predictionId,
      {
        outcomeId,
        observedOutcome: input.observedOutcome >= 0.5 ? 1 : 0,
        verificationStatus: isVerified ? 'verified' : 'unverified',
        verificationSource: input.verificationSource.trim(),
        outcomeDate,
        verifiedById: isVerified && requester?.id ? new mongoose.Types.ObjectId(requester.id) : undefined,
        verifiedByName: isVerified ? requester?.name || requester?.email || 'Authorized Verifier' : undefined,
        verifiedAt: isVerified ? new Date() : undefined,
      },
      isVerified ? 'verified' : 'outcome_recorded'
    );

    if (!updated) {
      throw new PredictionNotFoundError(`Failed to update outcome for prediction "${predictionId}".`);
    }

    const resultDto = predictionToDto(updated);

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'prediction.outcome_verified',
      entityType: 'prediction',
      entityId: predictionId,
      summary: `Recorded verified outcome (${input.observedOutcome >= 0.5 ? 1 : 0}) for prediction "${prediction.statement}"`,
      diff: {
        after: {
          observedOutcome: input.observedOutcome >= 0.5 ? 1 : 0,
          verificationStatus: isVerified ? 'verified' : 'outcome_recorded',
        },
      },
    });

    return resultDto;
  }

  async disputeOutcome(
    decisionId: string,
    predictionId: string,
    input: DisputeOutcomeInput,
    requester?: RequesterContext
  ): Promise<PredictionDto> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const prediction = await predictionRepository.findByPredictionId(decisionId, predictionId);
    if (!prediction) {
      throw new PredictionNotFoundError(`Prediction with ID "${predictionId}" not found for this decision.`);
    }

    const updated = await predictionRepository.updateDispute(
      decisionId,
      predictionId,
      input.disputeReason.trim(),
      requester?.id
    );

    if (!updated) {
      throw new PredictionNotFoundError(`Failed to dispute outcome for prediction "${predictionId}".`);
    }

    const resultDto = predictionToDto(updated);

    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'prediction.disputed',
      entityType: 'prediction',
      entityId: predictionId,
      summary: `Disputed prediction outcome: "${input.disputeReason.trim()}"`,
    });

    return resultDto;
  }

  async getDecisionCalibration(
    decisionId: string,
    requester?: RequesterContext
  ): Promise<DecisionCalibrationDto> {
    if (!decisionId || !mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    const allPredictions = await predictionRepository.listByDecision(decisionId);

    // Sync any predictions embedded in submitted expert contributions if not already tracked
    const contributions = await contributionRepository.listByDecision(decisionId);
    const submittedContributions = contributions.filter(c => c.status === 'submitted');

    // Separate verified predictions from pending, unverified, and disputed
    const verifiedPredictions = allPredictions.filter(
      p => p.status === 'verified' && p.outcome?.verificationStatus === 'verified'
    );
    const awaitingCount = allPredictions.filter(
      p => p.status === 'submitted' || p.status === 'awaiting_outcome' || p.status === 'outcome_recorded'
    ).length;
    const disputedCount = allPredictions.filter(p => p.status === 'disputed').length;

    // Map verified predictions to calibration inputs
    const eligibleInputs: CalibrationPredictionInput[] = verifiedPredictions.map(p => ({
      id: p.predictionId,
      probability: p.probability,
      observedOutcome: p.outcome!.observedOutcome,
      domain: p.domain,
      submittedAt: p.submittedAt,
      outcomeDate: p.outcome!.outcomeDate,
    }));

    const rawCalibration = calculateExpertCalibration(eligibleInputs);

    // Build per-expert profile metrics with strictly separated dimensions
    const expertMap = new Map<string, ExpertPredictionDocument[]>();
    for (const p of allPredictions) {
      const uid = p.contributorId.toString();
      if (!expertMap.has(uid)) {
        expertMap.set(uid, []);
      }
      expertMap.get(uid)!.push(p);
    }

    // Also include contributors who submitted contributions even if they made no separate prediction
    for (const c of submittedContributions) {
      const uid = c.contributorId.toString();
      if (!expertMap.has(uid)) {
        expertMap.set(uid, []);
      }
    }

    // Pre-calculate popularity consensus across submitted contributions
    const recMap = new Map<string, number>();
    for (const c of submittedContributions) {
      if (c.recommendation?.preferredOptionId) {
        recMap.set(c.recommendation.preferredOptionId, (recMap.get(c.recommendation.preferredOptionId) || 0) + 1);
      }
    }

    // Resolve contributor user details
    const expertProfiles: ExpertCalibrationProfileDto[] = [];
    for (const [uid, preds] of expertMap.entries()) {
      let contributorName = preds[0]?.contributorName;
      if (!contributorName && mongoose.isValidObjectId(uid)) {
        const u = await userRepository.findById(uid);
        if (u) contributorName = u.name || u.email;
      }
      contributorName = contributorName || 'Expert Contributor';

      const contribDoc = submittedContributions.find(c => c.contributorId.toString() === uid);
      const userContribCount = submittedContributions.filter(c => c.contributorId.toString() === uid).length;

      // Filter verified predictions for this expert
      const userVerified = preds.filter(p => p.status === 'verified' && p.outcome?.verificationStatus === 'verified');
      const userEligibleInputs: CalibrationPredictionInput[] = userVerified.map(p => ({
        id: p.predictionId,
        probability: p.probability,
        observedOutcome: p.outcome!.observedOutcome,
        domain: p.domain,
        submittedAt: p.submittedAt,
        outcomeDate: p.outcome!.outcomeDate,
      }));

      const userCal = calculateExpertCalibration(userEligibleInputs);

      // Citations count
      let totalCitations = 0;
      for (const p of preds) {
        totalCitations += p.evidenceReferences?.length || 0;
      }
      if (contribDoc?.evidenceReferences) {
        totalCitations += contribDoc.evidenceReferences.length;
      }

      // Recency
      const lastPred = preds.length > 0 ? preds[0].submittedAt.toISOString() : null;
      const lastOutc = userVerified.length > 0 && userVerified[0].outcome?.outcomeDate
        ? userVerified[0].outcome.outcomeDate.toISOString()
        : null;

      // Popularity (Social Signal only)
      let agreementRate: number | null = null;
      if (contribDoc?.recommendation?.preferredOptionId && submittedContributions.length > 0) {
        const peersVotingSame = recMap.get(contribDoc.recommendation.preferredOptionId) || 0;
        agreementRate = Math.round((peersVotingSame / submittedContributions.length) * 100) / 100;
      }

      expertProfiles.push({
        contributorId: uid,
        contributorName,
        calibration: {
          hasSufficientSample: userCal.hasSufficientSample,
          eligibleCount: userCal.eligibleCount,
          brierScore: userCal.brierScore,
          expectedCalibrationError: userCal.expectedCalibrationError,
          climatologyBss: userCal.climatologyBss,
        },
        domainBreakdown: [...userCal.domainBreakdown],
        experience: {
          totalContributions: userContribCount,
          totalPredictions: preds.length,
          verifiedPredictions: userVerified.length,
          awaitingOutcome: preds.filter(p => p.status === 'awaiting_outcome' || p.status === 'submitted').length,
        },
        evidenceQuality: {
          citationsProvided: totalCitations,
          verifiedReferences: userVerified.filter(p => p.outcome?.verificationSource).length,
        },
        recency: {
          lastPredictionAt: lastPred,
          lastOutcomeAt: lastOutc,
        },
        popularity: {
          label: 'Social consensus signal (display-only, not an accuracy or calibration metric)',
          preferredOptionAgreementRate: agreementRate,
        },
      });
    }

    expertProfiles.sort((a, b) => b.experience.verifiedPredictions - a.experience.verifiedPredictions);

    return {
      decisionId,
      calculatedAt: new Date().toISOString(),
      methodologyVersion: rawCalibration.methodologyVersion,
      totalPredictions: allPredictions.length,
      verifiedCount: verifiedPredictions.length,
      awaitingOutcomeCount: awaitingCount,
      disputedCount,
      hasSufficientSample: rawCalibration.hasSufficientSample,
      minimumSampleThreshold: rawCalibration.minimumSampleThreshold,
      brierScore: rawCalibration.brierScore,
      climatologyBss: rawCalibration.climatologyBss,
      expectedCalibrationError: rawCalibration.expectedCalibrationError,
      calibrationBins: rawCalibration.calibrationBins,
      domainBreakdown: rawCalibration.domainBreakdown,
      summary: rawCalibration.summary,
      eligibleCount: rawCalibration.eligibleCount,
      excludedCount: rawCalibration.excludedCount,
      expertProfiles,
      formulaDocumentation: {
        brierScore: 'BS = (1/N) * sum((p_i - o_i)^2)',
        ece: 'ECE = sum((N_b / N) * |p_bar_b - o_bar_b|)',
        bss: 'BSS = 1 - (BS / BS_ref) where BS_ref = bar_o * (1 - bar_o)',
      },
    };
  }

  async getUserCalibration(
    userId: string,
    _requester?: RequesterContext
  ): Promise<ExpertCalibrationProfileDto> {
    if (!userId || !mongoose.isValidObjectId(userId)) {
      throw new InvalidDecisionIdError(userId);
    }

    const user = await userRepository.findById(userId);
    const contributorName = user?.name || user?.email || 'Expert Contributor';

    const allUserPredictions = await predictionRepository.listByContributor(userId);
    const verifiedUserPredictions = allUserPredictions.filter(
      p => p.status === 'verified' && p.outcome?.verificationStatus === 'verified'
    );

    const eligibleInputs: CalibrationPredictionInput[] = verifiedUserPredictions.map(p => ({
      id: p.predictionId,
      probability: p.probability,
      observedOutcome: p.outcome!.observedOutcome,
      domain: p.domain,
      submittedAt: p.submittedAt,
      outcomeDate: p.outcome!.outcomeDate,
    }));

    const userCal = calculateExpertCalibration(eligibleInputs);

    let totalCitations = 0;
    for (const p of allUserPredictions) {
      totalCitations += p.evidenceReferences?.length || 0;
    }

    const lastPred = allUserPredictions.length > 0 ? allUserPredictions[0].submittedAt.toISOString() : null;
    const lastOutc = verifiedUserPredictions.length > 0 && verifiedUserPredictions[0].outcome?.outcomeDate
      ? verifiedUserPredictions[0].outcome.outcomeDate.toISOString()
      : null;

    return {
      contributorId: userId,
      contributorName,
      calibration: {
        hasSufficientSample: userCal.hasSufficientSample,
        eligibleCount: userCal.eligibleCount,
        brierScore: userCal.brierScore,
        expectedCalibrationError: userCal.expectedCalibrationError,
        climatologyBss: userCal.climatologyBss,
      },
      domainBreakdown: [...userCal.domainBreakdown],
      experience: {
        totalContributions: 0,
        totalPredictions: allUserPredictions.length,
        verifiedPredictions: verifiedUserPredictions.length,
        awaitingOutcome: allUserPredictions.filter(
          p => p.status === 'awaiting_outcome' || p.status === 'submitted'
        ).length,
      },
      evidenceQuality: {
        citationsProvided: totalCitations,
        verifiedReferences: verifiedUserPredictions.length,
      },
      recency: {
        lastPredictionAt: lastPred,
        lastOutcomeAt: lastOutc,
      },
      popularity: {
        label: 'Social consensus signal (display-only, not an accuracy or calibration metric)',
        preferredOptionAgreementRate: null,
      },
    };
  }
}

export const calibrationService = new CalibrationService();

