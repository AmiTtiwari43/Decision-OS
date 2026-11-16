import mongoose from 'mongoose';
import {
  decisionRepository,
  evidenceRepository,
  contributionRepository,
  disagreementRepository,
  predictionRepository,
  auditRepository,
} from '../repositories/index.js';
import { authorizeDecisionAction, getDecisionRole } from './authorization.service.js';
import { auditService } from './audit.service.js';
import { calibrationService } from './calibration.service.js';
import {
  getSyntheticScoreCoordinates,
  validateCompleteness,
  type RequesterContext,
} from './decision.service.js';
import {
  DecisionNotFoundError,
  InvalidDecisionIdError,
} from '../errors/domain.errors.js';

export interface DecisionExportPackage {
  filename: string;
  contentType: string;
  content: string;
}

/**
 * Mitigates Spreadsheet Formula Injection (CSV Injection).
 * Any cell value starting with '=', '+', '-', '@', '\t', or '\r' is prefixed with a single quote.
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // If starts with dangerous character, escape with leading single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180 escaping: wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export class ExportService {
  /**
   * Generates a portable decision export in JSON, CSV, or HTML format.
   * Guaranteed to contain:
   * - Decision metadata
   * - Alternatives
   * - Criteria and weights
   * - Score matrix
   * - Final rankings
   * - Sensitivity findings
   * - Expert contributions
   * - Advisory suggestions (clearly labeled non-authoritative)
   * - Evidence references (with unverified citation flags and missing evidence analysis)
   * - Full audit history timeline
   * - Integrity verification result
   */
  async generateExport(
    decisionId: string,
    format: 'json' | 'csv' | 'html',
    requester?: RequesterContext
  ): Promise<DecisionExportPackage> {
    if (!mongoose.isValidObjectId(decisionId)) {
      throw new InvalidDecisionIdError(decisionId);
    }

    const decision = await decisionRepository.findById(decisionId);
    if (!decision) {
      throw new DecisionNotFoundError(decisionId);
    }

    await authorizeDecisionAction(decision, 'read', requester);

    // Collaborator contact details are visible to the owner only (or internal callers).
    const requesterRole = await getDecisionRole(decision, requester);
    const canSeeContactDetails = requesterRole === 'owner';

    // Certification status (F05/F19): an export is an authoritative record only
    // when a stored analysis exists, the matrix is complete, and no synthetic
    // demo values remain. Otherwise it is explicitly marked non-authoritative.
    const syntheticCoordinates = getSyntheticScoreCoordinates(
      decision.criteria || [],
      decision.options || [],
      decision.scoreProvenance
    );
    const missingCoordinates = validateCompleteness(decision.criteria || [], decision.options || [], decision.scores);
    const certificationBlockers: string[] = [];
    if (syntheticCoordinates.length > 0) {
      certificationBlockers.push(`${syntheticCoordinates.length} synthetic demonstration score(s) remain`);
    }
    if (missingCoordinates.length > 0) {
      certificationBlockers.push(`${missingCoordinates.length} score(s) are missing`);
    }
    if (!decision.analysis) {
      certificationBlockers.push('no authoritative analysis has been calculated for the current inputs');
    }
    const certification = {
      isAuthoritative: certificationBlockers.length === 0,
      status: certificationBlockers.length === 0 ? 'authoritative' : 'not_certifiable',
      reasons: certificationBlockers,
      syntheticCoordinates,
      missingCoordinates,
    };
    const isSyntheticCell = (optionId: string, criterionId: string): boolean =>
      syntheticCoordinates.some(c => c.optionId === optionId && c.criterionId === criterionId);

    // Fetch related records in parallel
    const [evidenceList, contributionsList, disagreementsList, predictionsList, chainCheck, rawAuditEvents] =
      await Promise.all([
        evidenceRepository.list({ decisionId }),
        contributionRepository.listByDecision(decisionId, requester?.id),
        disagreementRepository.listByDecision(decisionId),
        predictionRepository.listByDecision(decisionId),
        auditService.verifyChainIntegrity(decisionId, requester),
        auditRepository && typeof auditRepository.getAllForDecision === 'function'
          ? auditRepository.getAllForDecision(decisionId)
          : Promise.resolve([]),
      ]);

    const auditEvents = rawAuditEvents || [];

    // Privacy filter: drafts are private to their author. Submitted, adopted,
    // rejected and withdrawn contributions are part of the decision record.
    const sanitizedContributions = contributionsList.filter(
      (c: { status: string; contributorId: unknown }) => {
        const cId = (c.contributorId as { _id?: { toString(): string } })?._id
          ? (c.contributorId as { _id: { toString(): string } })._id.toString()
          : String(c.contributorId);
        return c.status !== 'draft' || (requester && cId === requester.id);
      }
    );

    // Identify missing evidence targets (criteria or options without any attached evidence)
    const missingEvidenceOptions = (decision.options || []).filter(
      opt => !evidenceList.some(e => e.targetType === 'option' && e.targetId === opt.id)
    ).map(opt => ({ id: opt.id, name: opt.name }));

    const missingEvidenceCriteria = (decision.criteria || []).filter(
      crit => !evidenceList.some(e => e.targetType === 'criterion' && e.targetId === crit.id)
    ).map(crit => ({ id: crit.id, name: crit.name }));

    // Extract AI Advisory events and proposals from audit records
    const appliedAiProposals = auditEvents
      .filter(e => e.action === 'ai.proposal_applied')
      .map(e => ({
        eventId: e.eventId,
        summary: e.summary,
        timestamp: (e.originalTimestamp || e.timestamp),
        actor: e.actorName || e.actorEmail || e.actorId,
        diff: e.diff,
      }));

    const aiAdvisoryEvents = auditEvents
      .filter(e => typeof e.action === 'string' && e.action.startsWith('ai.'))
      .map(e => ({
        eventId: e.eventId,
        action: e.action,
        summary: e.summary,
        timestamp: (e.originalTimestamp || e.timestamp),
        actor: e.actorName || e.actorEmail || e.actorId,
      }));

    const advisorySuggestions = {
      isAiGenerated: true,
      label: 'AI Advisory Intelligence (Strictly Non-Authoritative)',
      disclaimer:
        'This analysis was generated by an AI assistant for advisory purposes. It does not alter or replace authoritative MCDA engine calculations.',
      appliedProposals: appliedAiProposals,
      advisoryEvents: aiAdvisoryEvents,
      hasAdvisoryEvents: aiAdvisoryEvents.length > 0,
      ruleGuarantee: 'Rule #14 Guarantee: No LLM ever calculates or alters authoritative scores, weights, or sensitivity points.',
    };

    // Fetch calibration overview if predictions exist
    let calibrationData = null;
    try {
      if (predictionsList.length > 0) {
        calibrationData = await calibrationService.getDecisionCalibration(decisionId, requester);
      }
    } catch {
      // Non-blocking
    }

    const safeTitle = (decision.title || 'decision')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 50);
    const dateStamp = new Date().toISOString().split('T')[0];

    // Log the export generation audit event
    await auditService.recordEvent({
      decisionId,
      actor: requester,
      action: 'export.generated',
      entityType: 'export',
      entityId: `${decisionId}-${format}`,
      summary: `Exported decision in ${format.toUpperCase()} format`,
      diff: {
        after: {
          format,
          exportedAt: new Date().toISOString(),
        },
      },
    });

    switch (format) {
      case 'json': {
        const jsonPayload = {
          exportVersion: '1.0.0',
          exportedAt: new Date().toISOString(),
          decisionMetadata: {
            id: decision._id.toString(),
            title: decision.title,
            description: decision.description || '',
            createdAt: decision.createdAt,
            updatedAt: decision.updatedAt,
            isContributionRoundLocked: decision.isContributionRoundLocked || false,
            engineVersion: decision.analysis?.engineVersion || 'canonical-v1',
          },
          decision: {
            id: decision._id.toString(),
            title: decision.title,
            description: decision.description || '',
            createdAt: decision.createdAt,
            updatedAt: decision.updatedAt,
            isContributionRoundLocked: decision.isContributionRoundLocked || false,
            criteria: decision.criteria || [],
            options: decision.options || [],
            scores: decision.scores || {},
          },
          alternatives: (decision.options || []).map(o => ({
            id: o.id,
            name: o.name,
            description: o.description || '',
            tagline: o.tagline || '',
          })),
          criteriaAndWeights: (decision.criteria || []).map(c => ({
            id: c.id,
            name: c.name,
            shortName: c.shortName || '',
            weight: c.weight,
            normalizedWeight: decision.analysis?.normalizedWeights?.[c.id] ?? null,
            direction: c.direction || 'benefit',
            isLocked: Boolean(c.isLocked),
          })),
          scoreMatrix: decision.scores || {},
          // Cell-level provenance: coordinates flagged isSynthetic hold demo values, not evidence.
          scoreProvenance: decision.scoreProvenance || {},
          certification,
          finalRankings: (decision.analysis?.evaluations || []).map(e => ({
            rank: e.rank,
            optionId: e.optionId,
            optionName: e.optionName,
            weightedScore: e.weightedScore,
            marginToLeader: e.scoreDifferenceToLeader,
          })),
          sensitivityFindings: decision.analysis?.sensitivity || [],
          mcdaAnalysis: decision.analysis || null,
          evidence: evidenceList.map(e => ({
            id: (e._id || (e as any).id || '').toString(),
            targetType: e.targetType,
            targetId: e.targetId,
            title: e.title,
            type: e.type,
            sourceUrl: e.sourceUrl,
            documentReference: e.documentReference,
            sourceExcerpt: e.sourceExcerpt,
            summary: e.userSummary,
            publicationDate: e.publicationDate,
            provenance: e.provenance,
            verificationStatus: 'unverified_citation',
            verificationNotice: 'Citation provided for reference context. Not independently third-party verified.',
            createdAt: e.createdAt,
          })),
          missingEvidence: {
            options: missingEvidenceOptions,
            criteria: missingEvidenceCriteria,
          },
          expertContributions: sanitizedContributions.map(c => {
            const rawC = c as any;
            const cId = (c.contributorId as { _id?: { toString(): string } })?._id
              ? (c.contributorId as { _id: { toString(): string } })._id.toString()
              : String(c.contributorId);
            return {
              id: c._id.toString(),
              contributorId: cId,
              contributorName: rawC.contributorName,
              contributorEmail: canSeeContactDetails || cId === requester?.id ? rawC.contributorEmail : undefined,
              status: c.status,
              weights: rawC.weights,
              preferredOptionId: c.recommendation?.preferredOptionId,
              rationale: c.recommendation?.rationale || rawC.rationale,
              criterionScores: c.criterionScores,
              confidence: c.confidence,
              revision: c.revision,
              submittedAt: c.submittedAt,
            };
          }),
          advisorySuggestions,
          disagreements: disagreementsList.map(d => ({
            id: d.disagreementId,
            status: d.status,
            resolutionExplanation: d.resolutionExplanation,
          })),
          calibration: calibrationData
            ? {
                brierScore: calibrationData.brierScore,
                expectedCalibrationError: calibrationData.expectedCalibrationError,
                climatologyBss: calibrationData.climatologyBss,
                verifiedCount: calibrationData.verifiedCount,
                hasSufficientSample: calibrationData.hasSufficientSample,
              }
            : null,
          auditHistory: auditEvents.map(e => ({
            sequenceNumber: e.sequenceNumber || 1,
            eventId: e.eventId,
            action: e.action,
            entityType: e.entityType,
            entityId: e.entityId,
            actor: e.actorName || e.actorEmail || e.actorId,
            actorId: e.actorId,
            actorEmail: canSeeContactDetails ? e.actorEmail : undefined,
            summary: e.summary,
            diff: e.diff,
            timestamp: (e.originalTimestamp || e.timestamp),
            previousEventHash: e.previousEventHash,
            eventHash: e.eventHash,
          })),
          auditChain: {
            isValid: chainCheck.isValid,
            totalEvents: chainCheck.totalEventsChecked,
            rootHash: chainCheck.rootHash,
            headHash: chainCheck.headHash,
            brokenAtEventId: chainCheck.brokenAtEventId,
            reason: chainCheck.reason,
          },
          integrityVerificationResult: {
            isValid: chainCheck.isValid,
            totalEventsChecked: chainCheck.totalEventsChecked,
            rootHash: chainCheck.rootHash,
            headHash: chainCheck.headHash,
            verifiedAt: chainCheck.verifiedAt,
            brokenAtEventId: chainCheck.brokenAtEventId || null,
            reason: chainCheck.reason || null,
          },
        };

        return {
          filename: `${safeTitle}_export_${dateStamp}.json`,
          contentType: 'application/json',
          content: JSON.stringify(jsonPayload, null, 2),
        };
      }

      case 'csv': {
        const lines: string[] = [];

        // 1. Header & Metadata Section
        lines.push(
          certification.isAuthoritative
            ? '# DECISION OS — AUTHORITATIVE DECISION EXPORT'
            : '# DECISION OS — DECISION EXPORT (NOT CERTIFIABLE — NON-AUTHORITATIVE)'
        );
        lines.push(`Certification Status,${sanitizeCsvCell(certification.status)}`);
        if (!certification.isAuthoritative) {
          lines.push(`Certification Blockers,${sanitizeCsvCell(certification.reasons.join('; '))}`);
        }
        lines.push(`Decision Title,${sanitizeCsvCell(decision.title)}`);
        lines.push(`Decision ID,${sanitizeCsvCell(decision._id.toString())}`);
        lines.push(`Description,${sanitizeCsvCell(decision.description || '')}`);
        lines.push(`Created At,${sanitizeCsvCell(decision.createdAt ? new Date(decision.createdAt).toISOString() : '')}`);
        lines.push(`Updated At,${sanitizeCsvCell(decision.updatedAt ? new Date(decision.updatedAt).toISOString() : '')}`);
        lines.push(`Exported At,${sanitizeCsvCell(new Date().toISOString())}`);
        const analysis = decision.analysis;
        const isInvalid = (analysis?.decisionOutcome as string) === 'invalid';
        const isIncomplete = (analysis?.decisionOutcome as string) === 'incomplete';
        const isTie = Boolean(analysis?.isTie);
        const winnerOpt = analysis?.winnerId ? decision.options?.find(o => o.id === analysis.winnerId) : null;
        const winnerName = isInvalid
          ? 'Invalid Evaluation'
          : isIncomplete
          ? 'Incomplete Evaluation'
          : winnerOpt?.name || (isTie ? 'Tie' : 'Uncalculated');
        lines.push(`MCDA Winner,${sanitizeCsvCell(winnerName)}`);
        lines.push(`Engine Version,${sanitizeCsvCell(decision.analysis?.engineVersion || 'canonical-v1')}`);
        lines.push('');

        // 2. Alternatives (Options) Section
        lines.push('# ALTERNATIVES (OPTIONS)');
        lines.push('Option ID,Option Name,Tagline,Description');
        for (const opt of decision.options || []) {
          lines.push(
            [
              sanitizeCsvCell(opt.id),
              sanitizeCsvCell(opt.name),
              sanitizeCsvCell(opt.tagline || ''),
              sanitizeCsvCell(opt.description || ''),
            ].join(',')
          );
        }
        lines.push('');

        // 3. Criteria & Weights Section
        lines.push('# CRITERIA & WEIGHTS');
        lines.push('Criterion ID,Name,Short Name,Raw Weight,Normalized Weight,Direction,Locked');
        for (const c of decision.criteria || []) {
          const normWeight = decision.analysis?.normalizedWeights?.[c.id];
          lines.push(
            [
              sanitizeCsvCell(c.id),
              sanitizeCsvCell(c.name),
              sanitizeCsvCell(c.shortName || ''),
              sanitizeCsvCell(c.weight),
              sanitizeCsvCell(normWeight !== undefined ? `${(normWeight * 100).toFixed(1)}%` : 'N/A'),
              sanitizeCsvCell(c.direction || 'benefit'),
              sanitizeCsvCell(c.isLocked ? 'TRUE' : 'FALSE'),
            ].join(',')
          );
        }
        lines.push('');

        // 4. Options and Score Matrix Table
        lines.push('# OPTIONS & SCORES MATRIX');
        const criteriaIds = (decision.criteria || []).map(c => c.id);
        const criteriaHeaders = (decision.criteria || []).map(c => `Score: ${c.name}`);
        lines.push(
          ['Option ID', 'Option Name', ...criteriaHeaders, 'Final Score', 'Rank'].map(sanitizeCsvCell).join(',')
        );

        for (const opt of decision.options || []) {
          const optScores = decision.scores?.[opt.id] || {};
          const scoreValues = criteriaIds.map(cid => sanitizeCsvCell(optScores[cid] ?? ''));
          const evalItem = decision.analysis?.evaluations?.find((e: { optionId: string }) => e.optionId === opt.id);
          const finalScore = evalItem?.weightedScore;
          const rank = evalItem?.rank;

          lines.push(
            [
              sanitizeCsvCell(opt.id),
              sanitizeCsvCell(opt.name),
              ...scoreValues,
              sanitizeCsvCell(typeof finalScore === 'number' && Number.isFinite(finalScore) ? Math.round(finalScore * 100) / 100 : ''),
              sanitizeCsvCell(rank !== null && rank !== undefined ? rank : 'Unranked'),
            ].join(',')
          );
        }
        lines.push('');

        // 4b. Cell-level provenance: lists every synthetic demonstration value
        lines.push('# SCORE PROVENANCE (SYNTHETIC DEMONSTRATION VALUES ARE NOT EVIDENCE)');
        lines.push('Option ID,Criterion ID,Score,Provenance');
        if (syntheticCoordinates.length === 0) {
          lines.push(['', '', '', sanitizeCsvCell('All scores user-entered (no synthetic values)')].join(','));
        }
        for (const coord of syntheticCoordinates) {
          lines.push(
            [
              sanitizeCsvCell(coord.optionId),
              sanitizeCsvCell(coord.criterionId),
              sanitizeCsvCell(decision.scores?.[coord.optionId]?.[coord.criterionId] ?? ''),
              sanitizeCsvCell('SYNTHETIC (demo)'),
            ].join(',')
          );
        }
        lines.push('');

        // 5. Final Rankings Table
        lines.push('# FINAL RANKINGS');
        lines.push('Rank,Option Name,Option ID,Deterministic Weighted Score,Margin to Leader');
        for (const e of decision.analysis?.evaluations || []) {
          lines.push(
            [
              sanitizeCsvCell(e.rank !== null && e.rank !== undefined ? `#${e.rank}` : 'Unranked'),
              sanitizeCsvCell(e.optionName),
              sanitizeCsvCell(e.optionId),
              sanitizeCsvCell(typeof e.weightedScore === 'number' && Number.isFinite(e.weightedScore) ? (e.weightedScore).toFixed(2) : 'N/A'),
              // Server-computed finite number: emitted raw so spreadsheets keep it numeric
              // (sanitizeCsvCell would quote-prefix the leading '-' and turn it into text).
              e.rank === 1
                ? sanitizeCsvCell('0.00 (Leader)')
                : typeof e.scoreDifferenceToLeader === 'number' && Number.isFinite(e.scoreDifferenceToLeader)
                  ? (-Math.abs(e.scoreDifferenceToLeader)).toFixed(2)
                  : sanitizeCsvCell('N/A'),
            ].join(',')
          );
        }
        lines.push('');

        // 6. Sensitivity Analysis Table
        const rawSens = decision.analysis?.sensitivity;
        const sensitivityItems = Array.isArray(rawSens)
          ? rawSens
          : (rawSens as any)?.tippingPoints || [];
        if (sensitivityItems.length > 0) {
          lines.push('# 6. SENSITIVITY FINDINGS & TIPPING POINTS');
          lines.push('Criterion,Current Weight,Tipping Point Weight,Direction,Feasibility,Flips To Option,Summary');
          for (const s of sensitivityItems) {
            const critName = decision.criteria.find(c => c.id === s.criterionId)?.name || s.criterionId;
            const flipsTo = decision.options.find(o => o.id === (s.wouldFlipToOptionId || s.flippingOptionId))?.name || s.wouldFlipToOptionId || s.flippingOptionId || 'N/A';
            lines.push(
              [
                sanitizeCsvCell(critName),
                sanitizeCsvCell(s.currentWeight),
                sanitizeCsvCell(s.tippingPointWeight !== null && s.tippingPointWeight !== undefined ? Math.round(s.tippingPointWeight * 100) / 100 : s.requiredWeightToFlip || 'N/A'),
                sanitizeCsvCell(s.direction || 'increase'),
                sanitizeCsvCell(s.feasibility || s.feasibilityScore || 'N/A'),
                sanitizeCsvCell(flipsTo),
                sanitizeCsvCell(s.summary || 'Tipping boundary flips leading option'),
              ].join(',')
            );
          }
          lines.push('');
        }

        // 7. Expert Contributions Section
        lines.push('# EXPERT CONTRIBUTIONS');
        lines.push('Contributor ID,Status,Preferred Option ID,Confidence,Submitted At,Rationale');
        for (const c of sanitizedContributions) {
          const cId = (c.contributorId as { _id?: { toString(): string } })?._id
            ? (c.contributorId as { _id: { toString(): string } })._id.toString()
            : String(c.contributorId);
          lines.push(
            [
              sanitizeCsvCell(cId),
              sanitizeCsvCell(c.status),
              sanitizeCsvCell(c.recommendation?.preferredOptionId || 'None'),
              sanitizeCsvCell(c.confidence ?? 'N/A'),
              sanitizeCsvCell(c.submittedAt ? new Date(c.submittedAt).toISOString() : 'Draft'),
              sanitizeCsvCell(c.recommendation?.rationale || ''),
            ].join(',')
          );
        }
        lines.push('');

        // 8. AI Advisory Suggestions (Clearly Labeled Non-Authoritative)
        lines.push('# ADVISORY SUGGESTIONS (AI-GENERATED - STRICTLY NON-AUTHORITATIVE)');
        lines.push(`# Notice: ${advisorySuggestions.disclaimer}`);
        lines.push(`# Guarantee: ${advisorySuggestions.ruleGuarantee}`);
        lines.push('Event ID,Action,Actor,Timestamp,Summary');
        for (const aiEv of aiAdvisoryEvents) {
          lines.push(
            [
              sanitizeCsvCell(aiEv.eventId),
              sanitizeCsvCell(aiEv.action),
              sanitizeCsvCell(aiEv.actor),
              sanitizeCsvCell(aiEv.timestamp ? new Date(aiEv.timestamp).toISOString() : ''),
              sanitizeCsvCell(aiEv.summary),
            ].join(',')
          );
        }
        lines.push('');

        // 9. Evidence References & Citations Table
        lines.push('# EVIDENCE REFERENCES & CITATIONS');
        lines.push('# Notice: Citations are self-reported contributor references for empirical context. Not fabricated or third-party verified.');
        lines.push('Evidence ID,Target Type,Target ID,Title,Evidence Type,Source URL,Document Reference,Verification Status,Submitted By,Created At');
        for (const ev of evidenceList) {
          lines.push(
            [
              sanitizeCsvCell(ev._id.toString()),
              sanitizeCsvCell(ev.targetType),
              sanitizeCsvCell(ev.targetId),
              sanitizeCsvCell(ev.title),
              sanitizeCsvCell(ev.type),
              sanitizeCsvCell(ev.sourceUrl || ''),
              sanitizeCsvCell(ev.documentReference || ''),
              sanitizeCsvCell('UNVERIFIED_CITATION'),
              sanitizeCsvCell(ev.provenance?.createdByName || 'User'),
              sanitizeCsvCell(ev.createdAt ? new Date(ev.createdAt).toISOString() : ''),
            ].join(',')
          );
        }
        lines.push('');

        // 10. Missing Evidence Report
        lines.push('# MISSING EVIDENCE REPORT');
        lines.push('Target Type,Target ID,Target Name,Status');
        for (const o of missingEvidenceOptions) {
          lines.push(['option', sanitizeCsvCell(o.id), sanitizeCsvCell(o.name), 'MISSING EVIDENCE (0 citations)'].join(','));
        }
        for (const c of missingEvidenceCriteria) {
          lines.push(['criterion', sanitizeCsvCell(c.id), sanitizeCsvCell(c.name), 'MISSING EVIDENCE (0 citations)'].join(','));
        }
        lines.push('');

        // 11. Full Audit History Timeline
        lines.push('# AUDIT HISTORY TIMELINE');
        lines.push('Sequence,Event ID,Timestamp,Action,Actor,Summary,Current Event Hash,Previous Hash');
        for (const ev of auditEvents) {
          lines.push(
            [
              sanitizeCsvCell(ev.sequenceNumber || 1),
              sanitizeCsvCell(ev.eventId),
              sanitizeCsvCell(ev.timestamp ? new Date(ev.timestamp).toISOString() : ''),
              sanitizeCsvCell(ev.action),
              sanitizeCsvCell(ev.actorName || ev.actorEmail || ev.actorId),
              sanitizeCsvCell(ev.summary),
              sanitizeCsvCell(ev.eventHash),
              sanitizeCsvCell(ev.previousEventHash),
            ].join(',')
          );
        }
        lines.push('');

        // 12. Audit Integrity Verification Result
        lines.push('# AUDIT INTEGRITY VERIFICATION RESULT');
        lines.push(`Chain Valid,${sanitizeCsvCell(chainCheck.isValid ? 'YES (100% Cryptographically Verified)' : 'NO (Compromised or Broken Chain)')}`);
        lines.push(`Total Events Checked,${sanitizeCsvCell(chainCheck.totalEventsChecked)}`);
        lines.push(`Chain Root Hash,${sanitizeCsvCell(chainCheck.rootHash || 'None')}`);
        lines.push(`Chain Head Hash,${sanitizeCsvCell(chainCheck.headHash || 'None')}`);
        lines.push(`Verified At,${sanitizeCsvCell(chainCheck.verifiedAt)}`);
        if (!chainCheck.isValid) {
          lines.push(`Broken At Event ID,${sanitizeCsvCell(chainCheck.brokenAtEventId || 'Unknown')}`);
          lines.push(`Integrity Failure Reason,${sanitizeCsvCell(chainCheck.reason || 'Verification failure')}`);
        }

        return {
          filename: `${safeTitle}_export_${dateStamp}.csv`,
          contentType: 'text/csv',
          content: lines.join('\r\n'),
        };
      }

      case 'html': {
        const htmlAnalysis = decision.analysis;
        const isHtmlInvalid = (htmlAnalysis?.decisionOutcome as string) === 'invalid';
        const isHtmlIncomplete = (htmlAnalysis?.decisionOutcome as string) === 'incomplete';
        const isHtmlTie = Boolean(htmlAnalysis?.isTie);
        const htmlWinnerOpt = htmlAnalysis?.winnerId ? decision.options?.find(o => o.id === htmlAnalysis.winnerId) : null;
        const htmlWinnerName = isHtmlInvalid
          ? 'Invalid Evaluation'
          : isHtmlIncomplete
          ? 'Incomplete Evaluation'
          : htmlWinnerOpt?.name || (isHtmlTie ? 'Tie' : 'Calculation Pending');
        const evaluations = decision.analysis?.evaluations || [];
        const rawHtmlSens = decision.analysis?.sensitivity;
        const sensitivityList = Array.isArray(rawHtmlSens) ? rawHtmlSens : (rawHtmlSens as any)?.tippingPoints || [];

        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Decision Briefing: ${escapeHtml(decision.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b132b; color: #e2e8f0; margin: 0; padding: 40px; }
    .container { max-width: 960px; margin: 0 auto; background: #1c2541; padding: 36px; border-radius: 16px; border: 1px solid #3a506b; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
    h1 { color: #ffffff; margin-top: 0; font-size: 26px; border-bottom: 2px solid #3a506b; padding-bottom: 12px; }
    h2 { color: #60a5fa; font-size: 17px; margin-top: 28px; border-bottom: 1px solid #3a506b; padding-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
    p { line-height: 1.6; color: #cbd5e1; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-winner { background: #059669; color: #ecfdf5; }
    .badge-chain { background: #0284c7; color: #f0f9ff; }
    .badge-broken { background: #dc2626; color: #fef2f2; }
    .badge-ai { background: #7c3aed; color: #f5f3ff; }
    .badge-warn { background: #d97706; color: #fffbeb; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2d3748; }
    th { background: #0f172a; color: #94a3b8; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    tr:nth-child(even) { background: #1e293b; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; }
    .alert-box { padding: 12px 16px; border-radius: 8px; margin: 16px 0; font-size: 12px; line-height: 1.5; }
    .alert-ai { background: rgba(124, 58, 237, 0.12); border: 1px solid rgba(124, 58, 237, 0.35); color: #ddd6fe; }
    .alert-warn { background: rgba(217, 119, 6, 0.12); border: 1px solid rgba(217, 119, 6, 0.35); color: #fde68a; }
    .alert-verified { background: rgba(5, 150, 105, 0.12); border: 1px solid rgba(5, 150, 105, 0.35); color: #a7f3d0; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #3a506b; font-size: 11px; color: #64748b; text-align: center; }
    @media print {
      body { background: #ffffff; color: #000000; padding: 0; }
      .container { background: #ffffff; border: none; box-shadow: none; padding: 0; color: #000000; max-width: 100%; }
      h1, h2 { color: #000000; border-color: #cccccc; }
      th { background: #eeeeee; color: #333333; }
      td, th { border-color: #dddddd; }
      tr:nth-child(even) { background: #f9f9f9; }
      .alert-ai, .alert-warn, .alert-verified { border-color: #cccccc; color: #000000; background: #fafafa; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 10px;">
      <h1>${escapeHtml(decision.title)}</h1>
      <div>
        <span class="badge badge-winner">${isHtmlInvalid || isHtmlIncomplete || !certification.isAuthoritative ? 'Status' : 'Authoritative Winner'}: ${escapeHtml(certification.isAuthoritative ? htmlWinnerName : 'Not certifiable')}</span>
        <span class="badge ${chainCheck.isValid ? 'badge-chain' : 'badge-broken'}">${chainCheck.isValid ? 'SHA-256 Chain Verified' : 'Chain Integrity Error'}</span>
      </div>
    </div>
    <p><strong>Description:</strong> ${escapeHtml(decision.description || 'No description provided.')}</p>
    <p style="font-size: 12px; color: #94a3b8;">
      <strong>Decision ID:</strong> <code>${escapeHtml(decision._id.toString())}</code> &nbsp;|&nbsp;
      <strong>Evaluation Engine:</strong> ${escapeHtml(decision.analysis?.engineVersion || 'canonical-v1')} &nbsp;|&nbsp;
      <strong>Evaluated At:</strong> ${escapeHtml(decision.analysis?.evaluatedAt || 'Not calculated')}
    </p>
    ${
      certification.isAuthoritative
        ? ''
        : `<div class="alert-box alert-warn" role="alert">
      <strong>NOT CERTIFIABLE — NON-AUTHORITATIVE EXPORT.</strong>
      This briefing cannot be used as an authoritative decision record because
      ${escapeHtml(certification.reasons.join('; '))}.
      ${
        syntheticCoordinates.length > 0
          ? 'Cells marked <strong>SYNTHETIC</strong> in the score matrix are demonstration values, not assessments or evidence.'
          : ''
      }
    </div>`
    }

    <h2>1. Final Rankings &amp; Authoritative MCDA Scores</h2>
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Alternative</th>
          <th>Deterministic Score</th>
          <th>Margin to Leader</th>
        </tr>
      </thead>
      <tbody>
        ${
          evaluations.length > 0
            ? evaluations
                .map(
                  (e: { rank?: number | null; optionName: string; weightedScore?: number | null; scoreDifferenceToLeader?: number | null }) => `
            <tr>
              <td><strong>${e.rank !== null && e.rank !== undefined ? `#${e.rank}` : 'Unranked'}</strong></td>
              <td>${escapeHtml(e.optionName)}</td>
              <td>${typeof e.weightedScore === 'number' && Number.isFinite(e.weightedScore) ? (e.weightedScore).toFixed(2) : 'N/A'}</td>
              <td>${e.rank === 1 ? '— (Leader)' : typeof e.scoreDifferenceToLeader === 'number' && Number.isFinite(e.scoreDifferenceToLeader) ? `-${(e.scoreDifferenceToLeader).toFixed(2)}` : '—'}</td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="4">No scores calculated yet.</td></tr>'
        }
      </tbody>
    </table>

    <h2>2. Criteria &amp; Assigned Weights</h2>
    <table>
      <thead>
        <tr>
          <th>Criterion</th>
          <th>Direction</th>
          <th>Raw Weight</th>
          <th>Normalized Weight</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${(decision.criteria || [])
          .map((c: { name: string; direction?: string; weight: number; id: string; isLocked?: boolean }) => {
            const norm = decision.analysis?.normalizedWeights?.[c.id];
            return `
            <tr>
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${escapeHtml(c.direction || 'benefit')}</td>
              <td>${c.weight}</td>
              <td>${norm !== undefined ? `${(norm * 100).toFixed(1)}%` : '—'}</td>
              <td>${c.isLocked ? 'Locked' : 'Adjustable'}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>

    <h2>3. Alternatives (Options) Overview</h2>
    <table>
      <thead>
        <tr>
          <th>Option ID</th>
          <th>Option Name</th>
          <th>Tagline / Summary</th>
        </tr>
      </thead>
      <tbody>
        ${(decision.options || [])
          .map((o: { id: string; name: string; tagline?: string; description?: string }) => `
            <tr>
              <td><code>${escapeHtml(o.id)}</code></td>
              <td><strong>${escapeHtml(o.name)}</strong></td>
              <td>${escapeHtml(o.tagline || o.description || '—')}</td>
            </tr>`)
          .join('')}
      </tbody>
    </table>

    <h2>4. Score Matrix</h2>
    <table>
      <thead>
        <tr>
          <th>Alternative</th>
          ${(decision.criteria || []).map((c: { name: string }) => `<th>${escapeHtml(c.name)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${(decision.options || [])
          .map((opt: { id: string; name: string }) => {
            const rowScores = decision.scores?.[opt.id] || {};
            const cells = (decision.criteria || [])
              .map((c: { id: string }) => {
                if (rowScores[c.id] === undefined) return '<td>—</td>';
                const value = escapeHtml(String(rowScores[c.id]));
                return isSyntheticCell(opt.id, c.id)
                  ? `<td>${value} <span class="badge badge-warn" title="Synthetic demonstration value — not an assessment or evidence">SYNTHETIC</span></td>`
                  : `<td>${value}</td>`;
              })
              .join('');
            return `<tr><td><strong>${escapeHtml(opt.name)}</strong></td>${cells}</tr>`;
          })
          .join('')}
      </tbody>
    </table>

    <h2>5. Sensitivity &amp; Analytical Tipping Points</h2>
    ${
      sensitivityList.length > 0
        ? `<table>
          <thead>
            <tr>
              <th>Criterion</th>
              <th>Current Weight</th>
              <th>Tipping Point</th>
              <th>Direction</th>
              <th>Feasibility</th>
              <th>Flips Outcome To</th>
            </tr>
          </thead>
          <tbody>
            ${sensitivityList
              .map((s: any) => {
                const critName = decision.criteria.find((c: { id: string }) => c.id === s.criterionId)?.name || s.criterionId;
                const flipsTo = decision.options.find((o: { id: string }) => o.id === (s.wouldFlipToOptionId || s.flippingOptionId))?.name || s.wouldFlipToOptionId || s.flippingOptionId || 'N/A';
                const tpDisplay = s.tippingPointWeight !== null && s.tippingPointWeight !== undefined
                  ? `${Number(s.tippingPointWeight).toFixed(1)}%`
                  : s.requiredWeightToFlip !== undefined
                  ? `${Number(s.requiredWeightToFlip).toFixed(1)}%`
                  : 'None';
                return `
                <tr>
                  <td><strong>${escapeHtml(critName)}</strong></td>
                  <td>${s.currentWeight}%</td>
                  <td>${tpDisplay}</td>
                  <td>${escapeHtml(String(s.direction || 'increase'))}</td>
                  <td>${escapeHtml(String(s.feasibility || s.feasibilityScore || 'N/A'))}</td>
                  <td>${escapeHtml(flipsTo)}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
        : '<p style="font-size: 12px; color: #94a3b8;">Sensitivity analysis has not been executed yet.</p>'
    }

    <h2>6. Multi-Expert Deliberation &amp; Stakeholder Contributions</h2>
    ${
      sanitizedContributions.length > 0
        ? `<table>
          <thead>
            <tr>
              <th>Contributor</th>
              <th>Status</th>
              <th>Preferred Option</th>
              <th>Confidence</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            ${sanitizedContributions
              .map((c: { contributorId: unknown; status: string; recommendation?: { preferredOptionId?: string; rationale?: string }; confidence?: number }) => {
                const cId = (c.contributorId as { _id?: { toString(): string } })?._id
                  ? (c.contributorId as { _id: { toString(): string } })._id.toString()
                  : String(c.contributorId);
                const prefOpt = decision.options.find((o: { id: string }) => o.id === c.recommendation?.preferredOptionId)?.name || c.recommendation?.preferredOptionId || '—';
                return `
                <tr>
                  <td><code>${escapeHtml(cId)}</code></td>
                  <td><span class="badge badge-chain">${escapeHtml(c.status)}</span></td>
                  <td><strong>${escapeHtml(prefOpt)}</strong></td>
                  <td>${c.confidence ? `${c.confidence}%` : '—'}</td>
                  <td style="font-size: 11px;">${escapeHtml(c.recommendation?.rationale || '—')}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
        : '<p style="font-size: 12px; color: #94a3b8;">No submitted expert contributions recorded.</p>'
    }

    <h2>7. AI Advisory Suggestions (Clearly Labeled Non-Authoritative)</h2>
    <div class="alert-box alert-ai">
      <strong>Rule #14 Guarantee:</strong> No LLM ever calculates or alters authoritative scores, weights, or sensitivity points.
      The proposals below are strictly advisory intelligence and stress-testing suggestions.
    </div>
    ${
      aiAdvisoryEvents.length > 0
        ? `<table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Timestamp</th>
              <th>Advisory Proposal / Summary</th>
            </tr>
          </thead>
          <tbody>
            ${aiAdvisoryEvents
              .map((aiEv: { action: string; actor: string; timestamp: string | Date; summary: string }) => `
              <tr>
                <td><span class="badge badge-ai">${escapeHtml(aiEv.action)}</span></td>
                <td>${escapeHtml(aiEv.actor)}</td>
                <td style="font-size: 11px;">${new Date(aiEv.timestamp).toLocaleString()}</td>
                <td>${escapeHtml(aiEv.summary)}</td>
              </tr>`)
              .join('')}
          </tbody>
        </table>`
        : '<p style="font-size: 12px; color: #94a3b8;">No AI advisory events recorded for this decision.</p>'
    }

    <h2>8. Evidence References &amp; Missing Evidence Gaps</h2>
    <div class="alert-box alert-warn">
      <strong>Evidence Grounding Notice:</strong> Citations are human-supplied references provided for attribution.
      Decision OS does NOT fabricate verification status or perform automated external fact validation.
    </div>
    ${
      (missingEvidenceOptions.length > 0 || missingEvidenceCriteria.length > 0)
        ? `<div style="margin-bottom: 12px; padding: 10px 14px; background: rgba(220, 38, 38, 0.12); border: 1px solid rgba(220, 38, 38, 0.35); border-radius: 8px; font-size: 12px; color: #fca5a5;">
            <strong>Missing Evidence Gaps:</strong>
            ${missingEvidenceOptions.length > 0 ? ` Options without citations: ${missingEvidenceOptions.map(o => o.name).join(', ')}.` : ''}
            ${missingEvidenceCriteria.length > 0 ? ` Criteria without citations: ${missingEvidenceCriteria.map(c => c.name).join(', ')}.` : ''}
          </div>`
        : ''
    }
    ${
      evidenceList.length > 0
        ? `<table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Title</th>
              <th>Citation / Source</th>
              <th>Status</th>
              <th>Supplied By</th>
            </tr>
          </thead>
          <tbody>
            ${evidenceList
              .map((ev: { targetType: string; targetId: string; title: string; sourceUrl?: string | null; documentReference?: string | null; provenance?: { createdByName?: string } }) => `
              <tr>
                <td><span class="badge badge-chain">${escapeHtml(ev.targetType)}: ${escapeHtml(ev.targetId)}</span></td>
                <td><strong>${escapeHtml(ev.title)}</strong></td>
                <td style="font-size: 11px;">${escapeHtml(ev.sourceUrl || ev.documentReference || 'Excerpt citation')}</td>
                <td><span class="badge badge-warn">Unverified Citation</span></td>
                <td>${escapeHtml(ev.provenance?.createdByName || 'User')}</td>
              </tr>`)
              .join('')}
          </tbody>
        </table>`
        : '<p style="font-size: 12px; color: #94a3b8;">No empirical evidence records attached.</p>'
    }

    <h2>9. Cryptographic Audit History Timeline</h2>
    ${
      auditEvents.length > 0
        ? `<table>
          <thead>
            <tr>
              <th>Seq</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Timestamp</th>
              <th>Summary</th>
              <th>Block Hash</th>
            </tr>
          </thead>
          <tbody>
            ${auditEvents
              .map((ev: { sequenceNumber?: number; action: string; actorName?: string; actorEmail?: string; actorId?: string; timestamp: Date | string; summary: string; eventHash: string }) => `
              <tr>
                <td><code>#${String(ev.sequenceNumber || 1).padStart(3, '0')}</code></td>
                <td><span class="badge badge-chain">${escapeHtml(ev.action)}</span></td>
                <td>${escapeHtml(ev.actorName || ev.actorEmail || ev.actorId || 'system')}</td>
                <td style="font-size: 11px;">${new Date(ev.timestamp).toLocaleString()}</td>
                <td>${escapeHtml(ev.summary)}</td>
                <td><code>${escapeHtml(ev.eventHash ? ev.eventHash.slice(0, 10) + '...' : 'Genesis')}</code></td>
              </tr>`)
              .join('')}
          </tbody>
        </table>`
        : '<p style="font-size: 12px; color: #94a3b8;">No audit history records found.</p>'
    }

    <h2>10. Cryptographic Integrity Verification Result</h2>
    <div class="alert-box ${chainCheck.isValid ? 'alert-verified' : 'alert-warn'}">
      <strong>Chain Status:</strong> ${chainCheck.isValid ? '100% Cryptographically Verified Intact' : 'INTEGRITY ERROR DETECTED'}<br>
      <strong>Total Events Checked:</strong> ${chainCheck.totalEventsChecked}<br>
      <strong>Chain Root Hash:</strong> <code>${chainCheck.rootHash || 'Genesis'}</code><br>
      <strong>Chain Head Hash:</strong> <code>${chainCheck.headHash || 'Genesis'}</code><br>
      <strong>Verified At:</strong> ${chainCheck.verifiedAt}
      ${!chainCheck.isValid ? `<br><strong style="color: #ef4444;">Failure Reason:</strong> ${escapeHtml(chainCheck.reason || 'Hash chain linkage broken')}` : ''}
    </div>

    <div class="footer">
      Decision OS ${certification.isAuthoritative ? 'Authoritative Export Briefing' : 'Export Briefing (Not Certifiable)'} &bull; Canonical MCDA Decision Engine v1 &bull; Generated on ${new Date().toUTCString()}
    </div>
  </div>
</body>
</html>`;

        return {
          filename: `${safeTitle}_briefing_${dateStamp}.html`,
          contentType: 'text/html',
          content: htmlContent,
        };
      }
      default: {
        throw new Error(`Unsupported export format: ${format}. Supported formats are json, csv, and html.`);
      }
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const exportService = new ExportService();

