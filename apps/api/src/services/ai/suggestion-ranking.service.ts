import type {
  AiAnalystOutput,
  AiRankedSuggestion,
  AiSuggestionScoreBreakdown,
  AiSuggestionCategory,
  ApplyProposalPayload,
} from '../../models/ai.types.js';
import type { DecisionDocument } from '../../models/index.js';

export interface RawCandidateSuggestion {
  id: string;
  category: AiSuggestionCategory;
  title: string;
  explanation: string;
  targetCriteriaIds: string[];
  targetOptionIds: string[];
  confidence: number;
  uncertaintyLevel: 'low' | 'medium' | 'high';
  missingInformation: string[];
  assumptionsMade: string[];
  potentialBiasOrLimitations: string[];
  whatCouldChangeRecommendation: string;
  actionablePayload?: ApplyProposalPayload;
}

export class SuggestionRankingService {
  /**
   * Deterministically scores, explains, and ranks AI advisory suggestions.
   *
   * GUARANTEES:
   * 1. 100% Deterministic: Identical decision state + identical suggestions produces identical scores & ranks.
   * 2. Transparent Multi-Factor Advisory Ranking (MDAR v1): Explains exact math and inputs.
   * 3. Sole Authority Rule: Canonical MCDA engine calculations are read, never modified.
   * 4. Zero Hallucinated Citations: Supporting evidence strictly references stored records.
   * 5. Non-Probabilistic Framing: Ranking score is explicitly an advisory priority index, not an objective probability.
   */
  rankSuggestions(params: {
    decision: DecisionDocument;
    evidence: Array<{
      _id?: unknown;
      targetType?: string;
      targetId?: string;
      title?: string;
      sourceExcerpt?: string | null;
      userSummary?: string | null;
    }>;
    contributions: Array<{
      status?: string;
      recommendation?: { preferredOptionId?: string; rationale?: string };
    }>;
    output: AiAnalystOutput;
  }): AiRankedSuggestion[] {
    const { decision, evidence = [], output } = params;

    const candidates = this.collectCandidates(output, decision);
    if (candidates.length === 0) {
      return [];
    }

    // Deduplicate candidates by id
    const seenIds = new Set<string>();
    const uniqueCandidates: RawCandidateSuggestion[] = [];
    for (const c of candidates) {
      const normalizedId = c.id.toLowerCase().trim();
      if (!seenIds.has(normalizedId)) {
        seenIds.add(normalizedId);
        uniqueCandidates.push(c);
      }
    }

    // Pre-calculate decision criteria weights and sensitivity map
    const totalCriteriaWeight = decision.criteria.reduce((sum, c) => sum + (c.weight || 0), 0) || 100;
    const criteriaWeightMap = new Map<string, number>();
    const criteriaNameMap = new Map<string, string>();
    for (const c of decision.criteria) {
      criteriaWeightMap.set(c.id.toLowerCase(), c.weight || 0);
      criteriaNameMap.set(c.id.toLowerCase(), c.name);
    }

    // Build sensitivity tipping points map
    const sensitivityMap = new Map<string, number>();
    if (decision.analysis?.sensitivity && Array.isArray(decision.analysis.sensitivity)) {
      for (const s of decision.analysis.sensitivity) {
        if (s && s.criterionId) {
          const delta = Math.abs(s.weightChangeRequired ?? 100);
          const existing = sensitivityMap.get(s.criterionId.toLowerCase());
          if (existing === undefined || delta < existing) {
            sensitivityMap.set(s.criterionId.toLowerCase(), delta);
          }
        }
      }
    }

    // Build sanitized evidence map
    const safeEvidence = (evidence || []).filter(e => e && typeof e === 'object');

    // Score each candidate deterministically
    const scoredList: Array<{
      candidate: RawCandidateSuggestion;
      score: number;
      breakdown: AiSuggestionScoreBreakdown;
      relevantCriteria: Array<{ id: string; name: string }>;
      supportingEvidence: Array<{ id: string; title: string }>;
      criteriaInfluence: string;
      evidenceSupport: string;
      whyThisRankDraft: string;
    }> = [];

    for (const item of uniqueCandidates) {
      // 1. Resolve relevant criteria
      const resolvedCriteria: Array<{ id: string; name: string }> = [];
      let criteriaWeightSum = 0;

      for (const cid of item.targetCriteriaIds) {
        const lower = typeof cid === 'string' ? cid.toLowerCase() : String(cid || '').toLowerCase();
        if (criteriaWeightMap.has(lower)) {
          const name = criteriaNameMap.get(lower) || cid;
          resolvedCriteria.push({ id: cid, name });
          criteriaWeightSum += criteriaWeightMap.get(lower) || 0;
        }
      }

      // Criterion relevance score (0 - 100)
      let criteriaRelevance = 50; // default for general decision-level suggestions
      if (item.targetCriteriaIds.length > 0) {
        criteriaRelevance = Math.min(100, Math.round((criteriaWeightSum / totalCriteriaWeight) * 100));
      }

      // 2. Resolve supporting evidence
      const matchedEvidence: Array<{ id: string; title: string }> = [];
      for (const ev of safeEvidence) {
        const evTargetId = typeof ev.targetId === 'string' ? ev.targetId.toLowerCase() : String(ev.targetId || '').toLowerCase();
        const evTargetType = typeof ev.targetType === 'string' ? ev.targetType : String(ev.targetType || '');
        const evTitle = typeof ev.title === 'string' ? ev.title : 'Attached Evidence';
        const evId = ev._id ? String(ev._id) : evTargetId;

        const matchesCriterion =
          evTargetType === 'criterion' &&
          item.targetCriteriaIds.some(cid => (typeof cid === 'string' ? cid.toLowerCase() : String(cid).toLowerCase()) === evTargetId);

        const matchesOption =
          evTargetType === 'option' &&
          item.targetOptionIds.some(oid => (typeof oid === 'string' ? oid.toLowerCase() : String(oid).toLowerCase()) === evTargetId);

        const matchesDecision = evTargetType === 'decision' && item.category === 'evidence';

        if (matchesCriterion || matchesOption || matchesDecision) {
          if (!matchedEvidence.some(m => m.id === evId)) {
            matchedEvidence.push({ id: evId, title: evTitle });
          }
        }
      }

      // Evidence grounding score (0 - 100)
      let evidenceGrounding = 25;
      if (matchedEvidence.length > 0) {
        evidenceGrounding = Math.min(100, 40 + matchedEvidence.length * 20);
      }

      // 3. Sensitivity & Urgency factor (0 - 100)
      let minDelta: number | null = null;
      for (const cid of item.targetCriteriaIds) {
        const d = sensitivityMap.get(cid.toLowerCase());
        if (d !== undefined) {
          if (minDelta === null || d < minDelta) {
            minDelta = d;
          }
        }
      }

      let sensitivityUrgency = 40;
      let sensitivityNote = 'Stable under sensitivity analysis';
      if (minDelta !== null) {
        if (minDelta <= 15) {
          sensitivityUrgency = 90;
          sensitivityNote = `Critical tipping point: Weight shift of ≤${minDelta.toFixed(1)}% alters authoritative winner`;
        } else if (minDelta <= 30) {
          sensitivityUrgency = 70;
          sensitivityNote = `Moderate tipping point: Weight shift of ≤${minDelta.toFixed(1)}% alters authoritative winner`;
        } else {
          sensitivityUrgency = 50;
          sensitivityNote = `Low sensitivity tipping point (Δ = ${minDelta.toFixed(1)}%)`;
        }
      }

      // 4. Stated confidence factor (0 - 100)
      const confidenceScore = Math.min(100, Math.max(0, Math.round(item.confidence * 100)));

      // 5. Missing information / penalty factor (0 - 25)
      const penalties = Math.min(25, item.missingInformation.length * 5);

      // Deterministic Multi-Factor Formula
      const rawComposite =
        0.35 * criteriaRelevance +
        0.25 * evidenceGrounding +
        0.25 * sensitivityUrgency +
        0.15 * confidenceScore -
        penalties;

      const rankingScore = Math.max(0, Math.min(100, Math.round(rawComposite * 10) / 10));

      const breakdown: AiSuggestionScoreBreakdown = {
        criteriaRelevance,
        evidenceGrounding,
        sensitivityUrgency,
        confidenceScore,
        penalties,
        formula: '0.35*Relevance + 0.25*Evidence + 0.25*Sensitivity + 0.15*Confidence - Penalties',
      };

      const criteriaInfluence =
        resolvedCriteria.length > 0
          ? `Influenced by criteria: ${resolvedCriteria.map(c => `"${c.name}" (${criteriaWeightMap.get(c.id.toLowerCase()) ?? 0}% weight)`).join(', ')}.`
          : 'Applies broadly to overall decision structure and trade-offs rather than a single criterion.';

      const evidenceSupport =
        matchedEvidence.length > 0
          ? `Backed by ${matchedEvidence.length} verified evidence item(s): ${matchedEvidence.map(e => `"${e.title}"`).join(', ')}.`
          : 'No empirical evidence attached for this recommendation on file.';

      const whyThisRankDraft = `Targeted criteria represent ${criteriaRelevance}% relative weight; ${sensitivityNote}; ${evidenceSupport}`;

      scoredList.push({
        candidate: item,
        score: rankingScore,
        breakdown,
        relevantCriteria: resolvedCriteria,
        supportingEvidence: matchedEvidence,
        criteriaInfluence,
        evidenceSupport,
        whyThisRankDraft,
      });
    }

    // Deterministic Sort Order:
    // 1. Highest rankingScore
    // 2. Highest supportingEvidence count
    // 3. Lowest missingInformation count
    // 4. Lexicographical tie-break by candidate.id
    scoredList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.supportingEvidence.length !== a.supportingEvidence.length) {
        return b.supportingEvidence.length - a.supportingEvidence.length;
      }
      if (a.candidate.missingInformation.length !== b.candidate.missingInformation.length) {
        return a.candidate.missingInformation.length - b.candidate.missingInformation.length;
      }
      return a.candidate.id.localeCompare(b.candidate.id);
    });

    const methodologyDescription =
      'Multi-Factor Deterministic Advisory Ranking (MDAR v1): Evaluates 35% Criterion Relevance + 25% Evidence Grounding + 25% Sensitivity Urgency + 15% Heuristic Confidence, minus Missing Information Penalties. Strict deterministic tie-breaking. Non-probabilistic advisory prioritization.';

    // Construct final explainable output
    return scoredList.map((entry, index) => {
      const rank = index + 1;
      const c = entry.candidate;

      const whyThisRank = `Ranked #${rank} with an advisory score of ${entry.score}/100. ${entry.whyThisRankDraft}`;

      return {
        id: c.id,
        rank,
        category: c.category,
        title: c.title,
        explanation: c.explanation,
        relevantCriteria: entry.relevantCriteria,
        supportingEvidence: entry.supportingEvidence,
        confidence: c.confidence,
        uncertaintyLevel: c.uncertaintyLevel,
        rankingScore: entry.score,
        rankingMethodology: methodologyDescription,
        scoreBreakdown: entry.breakdown,
        missingInformation: c.missingInformation,
        potentialBiasOrLimitations: c.potentialBiasOrLimitations,
        whyThisRank,
        criteriaInfluence: entry.criteriaInfluence,
        evidenceSupport: entry.evidenceSupport,
        assumptionsMade: c.assumptionsMade,
        whatCouldChangeRecommendation: c.whatCouldChangeRecommendation,
        actionablePayload: c.actionablePayload,
      };
    });
  }

  /**
   * Harvests candidate suggestions from the raw analytical output.
   */
  private collectCandidates(
    output: AiAnalystOutput,
    decision: DecisionDocument
  ): RawCandidateSuggestion[] {
    const list: RawCandidateSuggestion[] = [];

    // 1. Suggested Missing Criteria Proposals
    if (output.suggestedCriteria && Array.isArray(output.suggestedCriteria)) {
      for (const crit of output.suggestedCriteria) {
        if (!crit || !crit.id || !crit.name) continue;

        const alreadyExists = decision.criteria.some(
          c => c.id.toLowerCase() === crit.id.toLowerCase()
        );

        list.push({
          id: `criterion-${crit.id}`,
          category: 'criterion',
          title: `Proposed Criterion: ${crit.name}`,
          explanation: crit.description || crit.rationale || `Advisory proposal to incorporate "${crit.name}" into the decision model.`,
          targetCriteriaIds: [crit.id],
          targetOptionIds: [],
          confidence: 0.85,
          uncertaintyLevel: 'low',
          missingInformation: [
            `Scoring calibration needed across all ${decision.options.length} options for criterion "${crit.name}"`,
          ],
          assumptionsMade: [
            `Assumes "${crit.name}" represents an independent utility dimension not captured by existing criteria.`,
          ],
          potentialBiasOrLimitations: [
            'Adding criteria dilutes the relative weights of existing criteria unless locked.',
          ],
          whatCouldChangeRecommendation:
            'If existing criteria already account for this dimension, or if stakeholders prefer a streamlined evaluation matrix.',
          actionablePayload: alreadyExists
            ? undefined
            : {
                type: 'add_criterion',
                criterion: {
                  id: crit.id,
                  name: crit.name,
                  weight: crit.suggestedWeight || 10,
                  direction: crit.direction || 'benefit',
                  isLocked: false,
                },
              },
        });
      }
    }

    // 2. Suggested Alternative Options
    if (output.suggestedAlternatives && Array.isArray(output.suggestedAlternatives)) {
      for (const alt of output.suggestedAlternatives) {
        if (!alt || !alt.id || !alt.name) continue;

        const alreadyExists = decision.options.some(
          o => o.id.toLowerCase() === alt.id.toLowerCase()
        );

        list.push({
          id: `alt-${alt.id}`,
          category: 'alternative',
          title: `Alternative Option: ${alt.name}`,
          explanation: alt.description || alt.rationale || `Explore alternative option "${alt.name}".`,
          targetCriteriaIds: [],
          targetOptionIds: [alt.id],
          confidence: 0.8,
          uncertaintyLevel: 'medium',
          missingInformation: [
            `Detailed performance and cost benchmarks for option "${alt.name}"`,
            'Implementation lead time and operational prerequisite assessment',
          ],
          assumptionsMade: [
            `Assumes option "${alt.name}" is technically viable within organizational constraints.`,
          ],
          potentialBiasOrLimitations: [
            'New alternative lacks historical production metrics in this environment.',
          ],
          whatCouldChangeRecommendation:
            'If preliminary vendor evaluation reveals disqualifying technical or licensing hurdles.',
          actionablePayload: alreadyExists
            ? undefined
            : {
                type: 'add_option',
                option: {
                  id: alt.id,
                  name: alt.name,
                  description: alt.description || '',
                },
              },
        });
      }
    }

    // 3. Evidence Gaps
    if (output.evidenceGaps && Array.isArray(output.evidenceGaps)) {
      for (const gap of output.evidenceGaps) {
        if (!gap || !gap.targetId || !gap.gapDescription) continue;

        const targetCriteria = gap.targetType === 'criterion' ? [gap.targetId] : [];
        const targetOptions = gap.targetType === 'option' ? [gap.targetId] : [];

        list.push({
          id: `evidence-${gap.targetType}-${gap.targetId}`,
          category: 'evidence',
          title: `Empirical Evidence Gap: ${gap.targetName}`,
          explanation: `${gap.gapDescription} ${gap.recommendation}`,
          targetCriteriaIds: targetCriteria,
          targetOptionIds: targetOptions,
          confidence: 0.9,
          uncertaintyLevel: 'low',
          missingInformation: [
            gap.gapDescription,
            'Third-party benchmark, published audit report, or verifiable test data',
          ],
          assumptionsMade: [
            'Current scores rely on qualitative or unverified assertions.',
          ],
          potentialBiasOrLimitations: [
            'Evaluator subjective bias may skew scoring without empirical anchoring.',
          ],
          whatCouldChangeRecommendation:
            'Attaching verified empirical citations or measurement data to substantiate current scores.',
        });
      }
    }

    // 4. Expert Recommendations
    if (output.expertRecommendations && Array.isArray(output.expertRecommendations)) {
      for (const exp of output.expertRecommendations) {
        if (!exp || !exp.domain) continue;

        const cleanDomain = exp.domain.toLowerCase().replace(/[^a-z0-9]/g, '-');
        list.push({
          id: `expert-${cleanDomain}`,
          category: 'expert',
          title: `Engage Expert: ${exp.domain}`,
          explanation: `${exp.rationale} Expected contribution: ${exp.expectedContribution}`,
          targetCriteriaIds: exp.targetCriteria || [],
          targetOptionIds: [],
          confidence: 0.8,
          uncertaintyLevel: 'medium',
          missingInformation: [
            `Independent domain evaluation for: ${(exp.targetCriteria || []).join(', ') || 'overall decision'}`,
          ],
          assumptionsMade: [
            'External subject-matter expertise will resolve score divergence and validate critical trade-offs.',
          ],
          potentialBiasOrLimitations: [
            'Individual domain experts may exhibit specialization bias toward their familiar stacks.',
          ],
          whatCouldChangeRecommendation:
            'If internal consensus is already substantiated by empirical benchmarks.',
        });
      }
    }

    // 5. Risks and Mitigations from Tradeoff Analysis
    if (output.tradeoffAnalysis?.risks && Array.isArray(output.tradeoffAnalysis.risks)) {
      for (const risk of output.tradeoffAnalysis.risks) {
        if (!risk || !risk.risk) continue;

        const cleanRisk = risk.risk.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
        const confidence =
          risk.severity === 'critical' ? 0.95 : risk.severity === 'high' ? 0.85 : 0.7;

        list.push({
          id: `risk-${cleanRisk}`,
          category: 'risk_mitigation',
          title: `Risk Mitigation: ${risk.risk}`,
          explanation: `Severity: ${risk.severity.toUpperCase()}. Mitigation: ${risk.mitigation}`,
          targetCriteriaIds: [],
          targetOptionIds: risk.affectedOptionIds || [],
          confidence,
          uncertaintyLevel: risk.severity === 'critical' || risk.severity === 'high' ? 'low' : 'medium',
          missingInformation: [
            `Quantified exposure probability and mitigation implementation cost`,
          ],
          assumptionsMade: [
            'Risk estimates reflect standard operational scenarios and failure modes.',
          ],
          potentialBiasOrLimitations: [
            'Risk severity may vary depending on existing internal architecture mitigations.',
          ],
          whatCouldChangeRecommendation:
            'Executing the recommended mitigation strategy or establishing contractual SLAs.',
        });
      }
    }

    return list;
  }
}

export const suggestionRankingService = new SuggestionRankingService();
