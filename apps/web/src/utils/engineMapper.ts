import type { EngineResult as CanonicalEngineResult } from '@decision-os/decision-engine';
import type {
  Option,
  Criterion,
  OptionEvaluation,
  SensitivityAnalysis,
  ExplainabilitySummary,
  DeltaDriver,
  EngineResult,
} from '../types/decision.js';

/**
 * Maps authoritative server-side MCDA calculations from the Canonical Decision Engine
 * into the frontend's EngineResult format, ensuring zero client math overrides server truth.
 */
export function mapServerAnalysisToEngineResult(
  serverAnalysis: CanonicalEngineResult,
  options: Option[],
  criteria: Criterion[]
): EngineResult {
  const optionsMap = new Map<string, Option>(options.map(o => [o.id, o]));
  const criteriaMap = new Map<string, Criterion>(criteria.map(c => [c.id, c]));

  // 1. Map option evaluations from server results
  const evaluations: OptionEvaluation[] = serverAnalysis.evaluations.map((evalResult) => {
    const existingOpt = optionsMap.get(evalResult.optionId);
    const option: Option = existingOpt ?? {
      id: evalResult.optionId,
      name: evalResult.optionName,
      tagline: '',
      description: '',
      color: '#B8FF5A',
      accentBorder: 'border-signal',
      scores: {},
      strengths: [],
      vulnerabilities: [],
    };

    // Calculate raw average score
    const scores = Object.values(option.scores);
    const rawScoreAvg = scores.length > 0
      ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))
      : 0;

    return {
      option,
      weightedScore: evalResult.weightedScore,
      rawScoreAvg,
      rank: evalResult.rank,
      scoreDifferenceToLeader: evalResult.scoreDifferenceToLeader,
      contributions: evalResult.contributions.map((c) => {
        const crit = criteriaMap.get(c.criterionId);
        return {
          criterionId: c.criterionId,
          criterionName: crit?.name ?? c.criterionId,
          shortName: crit?.shortName ?? c.criterionId,
          rawScore: c.rawScore,
          weight: c.weight,
          weightedPoints: c.weightedPoints,
          percentageOfTotal: c.percentageOfTotal,
        };
      }),
    };
  });

  // Sort evaluations by rank ascending, then weightedScore descending
  evaluations.sort((a, b) => a.rank - b.rank || b.weightedScore - a.weightedScore);

  const winner = evaluations[0] ?? {
    option: options[0],
    weightedScore: 0,
    rawScoreAvg: 0,
    rank: 1,
    scoreDifferenceToLeader: 0,
    contributions: [],
  };

  const runnerUp = evaluations.length > 1 ? evaluations[1] : null;

  // 2. Map sensitivity tipping points
  const sensitivity: SensitivityAnalysis[] = serverAnalysis.sensitivity.map((s) => {
    const crit = criteriaMap.get(s.criterionId);
    const flipOpt = s.wouldFlipToOptionId ? optionsMap.get(s.wouldFlipToOptionId) : null;

    return {
      criterionId: s.criterionId,
      criterionName: crit?.name ?? s.criterionId,
      shortName: crit?.shortName ?? s.criterionId,
      currentWeight: s.currentWeight,
      tippingPointWeight: s.tippingPointWeight,
      weightDeltaNeeded: s.weightDeltaNeeded,
      wouldFlipToOptionId: s.wouldFlipToOptionId,
      wouldFlipToOptionName: flipOpt?.name ?? null,
      feasibility: s.feasibility,
      summary: s.summary,
    };
  });

  // 3. Construct explainability summary
  const pointLead = serverAnalysis.pointLead;
  const winnerOpt = winner.option;
  const runnerUpOpt = runnerUp ? runnerUp.option : null;

  let headline = '';
  if (serverAnalysis.isTie) {
    headline = runnerUpOpt
      ? `Mathematical Tie: ${winnerOpt.name} and ${runnerUpOpt.name} share rank #1 with identical scores (${winner.weightedScore} pts).`
      : `Mathematical Tie detected across leading options (${winner.weightedScore} pts).`;
  } else if (runnerUpOpt) {
    if (pointLead > 8) {
      headline = `${winnerOpt.name} holds a decisive +${pointLead.toFixed(1)} pt lead over ${runnerUpOpt.name}.`;
    } else if (pointLead >= 3) {
      headline = `${winnerOpt.name} fits your current priorities better (+${pointLead.toFixed(1)} pts).`;
    } else {
      headline = `${winnerOpt.name} narrowly leads ${runnerUpOpt.name} by +${pointLead.toFixed(1)} pts in a close contest.`;
    }
  } else {
    headline = `${winnerOpt.name} evaluated at ${winner.weightedScore} pts.`;
  }

  // Calculate drivers between winner and runner-up
  const primaryDrivers: DeltaDriver[] = [];
  const concededAreas: DeltaDriver[] = [];

  if (runnerUpOpt) {
    criteria.forEach((c) => {
      const w = serverAnalysis.normalizedWeights[c.id] ?? 0;
      const wScore = winnerOpt.scores[c.id] ?? 0;
      const rScore = runnerUpOpt.scores[c.id] ?? 0;
      const rawDiff = wScore - rScore;
      const pointAdvantage = Number(((rawDiff * w) / 100).toFixed(2));

      const driver: DeltaDriver = {
        criterionId: c.id,
        criterionName: c.name,
        shortName: c.shortName,
        weight: w,
        winnerScore: wScore,
        runnerUpScore: rScore,
        pointAdvantage,
        rawDiff,
      };

      if (pointAdvantage > 0) {
        primaryDrivers.push(driver);
      } else if (pointAdvantage < 0) {
        concededAreas.push(driver);
      }
    });

    primaryDrivers.sort((a, b) => b.pointAdvantage - a.pointAdvantage);
    concededAreas.sort((a, b) => a.pointAdvantage - b.pointAdvantage);
  }

  let dynamicRationale = '';
  if (serverAnalysis.isTie) {
    dynamicRationale = `The decision resulted in an exact tie under canonical Hare-Niemeyer normalization. Neither option holds a mathematically decisive advantage.`;
  } else {
    const topAdvantageNames = primaryDrivers.slice(0, 2).map(d => `${d.criterionName} (+${d.rawDiff} raw)`).join(' and ');
    dynamicRationale = `${winnerOpt.name} ranks highest because your current weights favor its strengths in ${topAdvantageNames || 'core metrics'}.`;
    if (concededAreas.length > 0 && runnerUpOpt) {
      const topConcededNames = concededAreas.slice(0, 2).map(d => `${d.criterionName} (-${Math.abs(d.rawDiff)} raw)`).join(' and ');
      dynamicRationale += ` This effectively offsets ${runnerUpOpt.name}'s advantage in ${topConcededNames}.`;
    }
  }

  let sensitivityStatement = '';
  const accessibleTippingPoint = sensitivity
    .filter(s => s.feasibility === 'low-threshold' && s.weightDeltaNeeded !== null && s.weightDeltaNeeded > 0)
    .sort((a, b) => (a.weightDeltaNeeded || 999) - (b.weightDeltaNeeded || 999))[0];

  if (accessibleTippingPoint && accessibleTippingPoint.tippingPointWeight !== null && runnerUpOpt) {
    sensitivityStatement = `If ${accessibleTippingPoint.criterionName} weight increases from ${accessibleTippingPoint.currentWeight}% to ${accessibleTippingPoint.tippingPointWeight}%, ${accessibleTippingPoint.wouldFlipToOptionName || runnerUpOpt.name} becomes the stronger choice.`;
  } else {
    sensitivityStatement = `The current ranking is robust against moderate single-criterion adjustments.`;
  }

  const explainability: ExplainabilitySummary = {
    winningOption: winnerOpt,
    runnerUpOption: runnerUpOpt,
    pointLead,
    headline,
    primaryDrivers,
    concededAreas,
    dynamicRationale,
    sensitivityStatement,
  };

  return {
    evaluations,
    winner,
    runnerUp,
    normalizedWeights: { ...serverAnalysis.normalizedWeights },
    totalWeight: serverAnalysis.totalWeight,
    sensitivity,
    explainability,
    isAuthoritative: true,
    engineVersion: serverAnalysis.engineVersion,
    evaluatedAt: serverAnalysis.evaluatedAt,
    isTie: serverAnalysis.isTie,
    tiedWinnerIds: serverAnalysis.tiedWinnerIds,
    decisionOutcome: serverAnalysis.decisionOutcome,
  };
}
