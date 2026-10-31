import mongoose from 'mongoose';
import {
  decisionRepository,
  evidenceRepository,
  contributionRepository,
  disagreementRepository,
  predictionRepository,
} from '../repositories/index.js';
import { authorizeDecisionAction } from './authorization.service.js';
import { auditService } from './audit.service.js';
import { calibrationService } from './calibration.service.js';
import type { RequesterContext } from './decision.service.js';
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

    // Fetch related records in parallel
    const [evidenceList, contributionsList, disagreementsList, predictionsList, chainCheck] =
      await Promise.all([
        evidenceRepository.list({ decisionId }),
        contributionRepository.listByDecision(decisionId),
        disagreementRepository.listByDecision(decisionId),
        predictionRepository.listByDecision(decisionId),
        auditService.verifyChainIntegrity(decisionId, requester),
      ]);

    // Privacy filter: Only show submitted contributions, or contributor's own draft
    const sanitizedContributions = contributionsList.filter(
      (c: { status: string; contributorId: { toString(): string } }) =>
        c.status === 'submitted' || (requester && c.contributorId.toString() === requester.id)
    );

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
          mcdaAnalysis: decision.analysis || null,
          evidence: evidenceList.map(e => ({
            id: e._id.toString(),
            targetType: e.targetType,
            targetId: e.targetId,
            title: e.title,
            sourceUrl: e.sourceUrl,
            summary: e.userSummary,
            createdAt: e.createdAt,
          })),
          expertContributions: sanitizedContributions.map(c => ({
            id: c._id.toString(),
            contributorId: c.contributorId.toString(),
            status: c.status,
            preferredOptionId: c.recommendation?.preferredOptionId,
            rationale: c.recommendation?.rationale,
            criterionScores: c.criterionScores,
            confidence: c.confidence,
            revision: c.revision,
            submittedAt: c.submittedAt,
          })),
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
          auditChain: {
            isValid: chainCheck.isValid,
            totalEvents: chainCheck.totalEventsChecked,
            rootHash: chainCheck.rootHash,
            headHash: chainCheck.headHash,
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

        // Header section
        lines.push('# DECISION OS — AUTHORITATIVE DECISION EXPORT');
        lines.push(`Decision Title,${sanitizeCsvCell(decision.title)}`);
        lines.push(`Decision ID,${sanitizeCsvCell(decision._id.toString())}`);
        lines.push(`Description,${sanitizeCsvCell(decision.description || '')}`);
        lines.push(`Exported At,${sanitizeCsvCell(new Date().toISOString())}`);
        const winnerOpt = decision.options?.find(o => o.id === decision.analysis?.winnerId);
        const winnerName = winnerOpt?.name || (decision.analysis?.isTie ? 'Tie' : 'Uncalculated');
        lines.push(`MCDA Winner,${sanitizeCsvCell(winnerName)}`);
        lines.push(`Engine Version,${sanitizeCsvCell(decision.analysis?.engineVersion || 'canonical-v1')}`);
        lines.push('');

        // Criteria table
        lines.push('# CRITERIA');
        lines.push('Criterion ID,Name,Short Name,Weight,Direction,Locked');
        for (const c of decision.criteria || []) {
          lines.push(
            [
              sanitizeCsvCell(c.id),
              sanitizeCsvCell(c.name),
              sanitizeCsvCell(c.shortName || ''),
              sanitizeCsvCell(c.weight),
              sanitizeCsvCell(c.direction || 'benefit'),
              sanitizeCsvCell(c.isLocked ? 'TRUE' : 'FALSE'),
            ].join(',')
          );
        }
        lines.push('');

        // Options and Score Matrix Table
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
              sanitizeCsvCell(finalScore !== undefined ? Math.round(finalScore * 100) / 100 : ''),
              sanitizeCsvCell(rank ?? ''),
            ].join(',')
          );
        }
        lines.push('');

        // Sensitivity Analysis Table
        if (decision.analysis?.sensitivity) {
          lines.push('# SENSITIVITY & TIPPING POINTS');
          lines.push('Criterion,Current Weight,Tipping Point Weight,Direction,Feasibility,Flips To Option,Summary');
          for (const s of decision.analysis.sensitivity) {
            const critName = decision.criteria.find(c => c.id === s.criterionId)?.name || s.criterionId;
            const flipsTo = decision.options.find(o => o.id === s.wouldFlipToOptionId)?.name || s.wouldFlipToOptionId || 'N/A';
            lines.push(
              [
                sanitizeCsvCell(critName),
                sanitizeCsvCell(s.currentWeight),
                sanitizeCsvCell(s.tippingPointWeight !== null ? Math.round(s.tippingPointWeight * 100) / 100 : 'N/A'),
                sanitizeCsvCell(s.direction),
                sanitizeCsvCell(s.feasibility),
                sanitizeCsvCell(flipsTo),
                sanitizeCsvCell(s.summary),
              ].join(',')
            );
          }
          lines.push('');
        }

        // Audit Trail Chain
        lines.push('# AUDIT INTEGRITY');
        lines.push(`Chain Valid,${sanitizeCsvCell(chainCheck.isValid ? 'YES' : 'NO')}`);
        lines.push(`Total Events,${sanitizeCsvCell(chainCheck.totalEventsChecked)}`);
        lines.push(`Chain Root Hash,${sanitizeCsvCell(chainCheck.rootHash || 'None')}`);
        lines.push(`Chain Head Hash,${sanitizeCsvCell(chainCheck.headHash || 'None')}`);

        return {
          filename: `${safeTitle}_export_${dateStamp}.csv`,
          contentType: 'text/csv',
          content: lines.join('\r\n'),
        };
      }

      case 'html': {
        const htmlWinnerOpt = decision.options?.find(o => o.id === decision.analysis?.winnerId);
        const htmlWinnerName = htmlWinnerOpt?.name || (decision.analysis?.isTie ? 'Tie' : 'Calculation Pending');
        const evaluations = decision.analysis?.evaluations || [];

        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Decision Briefing: ${escapeHtml(decision.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b132b; color: #e2e8f0; margin: 0; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; background: #1c2541; padding: 32px; border-radius: 12px; border: 1px solid #3a506b; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #ffffff; margin-top: 0; font-size: 26px; border-bottom: 2px solid #3a506b; padding-bottom: 12px; }
    h2 { color: #60a5fa; font-size: 18px; margin-top: 28px; border-bottom: 1px solid #3a506b; padding-bottom: 6px; }
    p { line-height: 1.6; color: #cbd5e1; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .badge-winner { background: #059669; color: #ecfdf5; }
    .badge-chain { background: #3b82f6; color: #eff6ff; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #2d3748; }
    th { background: #0f172a; color: #94a3b8; font-weight: 600; }
    tr:nth-child(even) { background: #1e293b; }
    .footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #3a506b; font-size: 12px; color: #64748b; text-align: center; }
    @media print {
      body { background: #ffffff; color: #000000; padding: 0; }
      .container { background: #ffffff; border: none; box-shadow: none; padding: 0; color: #000000; }
      h1, h2 { color: #000000; border-color: #cccccc; }
      th { background: #eeeeee; color: #333333; }
      td, th { border-color: #dddddd; }
      tr:nth-child(even) { background: #f9f9f9; }
      .badge-winner { border: 1px solid #059669; color: #059669; background: transparent; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div style="display: flex; justify-content: space-between; align-items: baseline;">
      <h1>${escapeHtml(decision.title)}</h1>
      <span class="badge badge-winner">Winner: ${escapeHtml(htmlWinnerName)}</span>
    </div>
    <p><strong>Description:</strong> ${escapeHtml(decision.description || 'No description provided.')}</p>
    <p style="font-size: 13px; color: #94a3b8;">
      <strong>Evaluation Engine:</strong> ${escapeHtml(decision.analysis?.engineVersion || 'canonical-v1')} &nbsp;|&nbsp;
      <strong>Evaluated At:</strong> ${escapeHtml(decision.analysis?.evaluatedAt || new Date().toISOString())} &nbsp;|&nbsp;
      <strong>Verification:</strong> <span class="badge badge-chain">${chainCheck.isValid ? 'SHA-256 Chain Verified' : 'Unverified'}</span>
    </p>

    <h2>Rankings &amp; Authoritative MCDA Scores</h2>
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Option</th>
          <th>Deterministic Score</th>
          <th>Margin to Leader</th>
        </tr>
      </thead>
      <tbody>
        ${
          evaluations.length > 0
            ? evaluations
                .map(
                  (e: { rank: number; optionName: string; weightedScore: number; scoreDifferenceToLeader: number }) => `
            <tr>
              <td><strong>#${e.rank}</strong></td>
              <td>${escapeHtml(e.optionName)}</td>
              <td>${(e.weightedScore).toFixed(2)}</td>
              <td>${e.rank === 1 ? '— (Leader)' : `-${(e.scoreDifferenceToLeader).toFixed(2)}`}</td>
            </tr>`
                )
                .join('')
            : '<tr><td colspan="4">No scores calculated yet.</td></tr>'
        }
      </tbody>
    </table>

    <h2>Criteria &amp; Assigned Weights</h2>
    <table>
      <thead>
        <tr>
          <th>Criterion</th>
          <th>Direction</th>
          <th>Raw Weight</th>
          <th>Normalized Weight</th>
        </tr>
      </thead>
      <tbody>
        ${(decision.criteria || [])
          .map((c: { name: string; direction?: string; weight: number; id: string }) => {
            const norm = decision.analysis?.normalizedWeights?.[c.id];
            return `
            <tr>
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${escapeHtml(c.direction || 'benefit')}</td>
              <td>${c.weight}</td>
              <td>${norm !== undefined ? `${(norm * 100).toFixed(1)}%` : '—'}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>

    <h2>Audit &amp; Integrity Proof</h2>
    <p style="font-size: 13px;">
      Total audit records: <strong>${chainCheck.totalEventsChecked}</strong><br>
      Chain Head Hash: <code style="color: #38bdf8;">${chainCheck.headHash || 'N/A'}</code>
    </p>

    <div class="footer">
      Decision OS Authoritative Export Briefing &bull; Engine: CANONICAL_DECISION_ENGINE_V1 &bull; Generated on ${new Date().toUTCString()}
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

