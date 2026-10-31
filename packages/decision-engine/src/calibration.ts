import type {
  CalibrationPredictionInput,
  CalibrationBin,
  DomainCalibrationMetrics,
  ExpertCalibrationResult,
} from './types';

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

const MINIMUM_SAMPLE_THRESHOLD = 3;

/**
 * Calculates the Brier score for probabilistic forecasts:
 * BS = (1 / N) * sum((p_i - o_i)^2)
 * Range: [0.0, 1.0]. Lower values indicate superior calibration and accuracy.
 */
export function calculateBrierScore(
  items: ReadonlyArray<{ probability: number; observedOutcome: number }>
): number | null {
  if (items.length === 0) return null;

  let sumSquaredError = 0;
  for (const item of items) {
    const p = Math.max(0, Math.min(1, item.probability));
    const o = item.observedOutcome >= 0.5 ? 1 : 0;
    sumSquaredError += Math.pow(p - o, 2);
  }

  return round4(sumSquaredError / items.length);
}

/**
 * Calculates Brier Skill Score (BSS) relative to the sample climatological base rate:
 * BSS = 1 - (BS / BS_ref)
 * where BS_ref = bar_o * (1 - bar_o)
 */
export function calculateClimatologyBss(
  items: ReadonlyArray<{ probability: number; observedOutcome: number }>
): number | null {
  if (items.length === 0) return null;

  const bs = calculateBrierScore(items);
  if (bs === null) return null;

  const baseRate = items.reduce((sum, it) => sum + (it.observedOutcome >= 0.5 ? 1 : 0), 0) / items.length;
  const refBrier = baseRate * (1 - baseRate);

  if (refBrier < 1e-6) {
    // All outcomes are identical (all 0 or all 1); reference variance is zero
    return null;
  }

  const bss = 1.0 - bs / refBrier;
  return round3(bss);
}

/**
 * Partitions predictions into 5 standard calibration probability intervals:
 * [0.0, 0.2), [0.2, 0.4), [0.4, 0.6), [0.6, 0.8), [0.8, 1.0]
 */
export function calculateCalibrationBins(
  items: ReadonlyArray<{ probability: number; observedOutcome: number }>
): CalibrationBin[] {
  const binRanges = [
    { index: 0, range: '[0.0, 0.2)', min: 0.0, max: 0.2 },
    { index: 1, range: '[0.2, 0.4)', min: 0.2, max: 0.4 },
    { index: 2, range: '[0.4, 0.6)', min: 0.4, max: 0.6 },
    { index: 3, range: '[0.6, 0.8)', min: 0.6, max: 0.8 },
    { index: 4, range: '[0.8, 1.0]', min: 0.8, max: 1.0001 },
  ];

  return binRanges.map(b => {
    const inBin = items.filter(it => {
      const p = Math.max(0, Math.min(1, it.probability));
      return p >= b.min && p < b.max;
    });

    if (inBin.length === 0) {
      return {
        binIndex: b.index,
        range: b.range,
        count: 0,
        meanPredictedProbability: round3((b.min + Math.min(1.0, b.max)) / 2.0),
        observedFrequency: 0,
        calibrationError: 0,
      };
    }

    const meanP = inBin.reduce((s, it) => s + it.probability, 0) / inBin.length;
    const obsFreq = inBin.reduce((s, it) => s + (it.observedOutcome >= 0.5 ? 1 : 0), 0) / inBin.length;
    const calError = Math.abs(meanP - obsFreq);

    return {
      binIndex: b.index,
      range: b.range,
      count: inBin.length,
      meanPredictedProbability: round3(meanP),
      observedFrequency: round3(obsFreq),
      calibrationError: round3(calError),
    };
  });
}

/**
 * Calculates Expected Calibration Error (ECE) across probability bins:
 * ECE = sum_b ((N_b / N) * |p_bar_b - o_bar_b|)
 */
export function calculateExpectedCalibrationError(
  bins: ReadonlyArray<CalibrationBin>,
  totalEligible: number
): number | null {
  if (totalEligible === 0) return null;

  let weightedError = 0;
  for (const b of bins) {
    if (b.count > 0) {
      weightedError += (b.count / totalEligible) * b.calibrationError;
    }
  }

  return round4(weightedError);
}

/**
 * Evaluates comprehensive expert calibration against empirical verified outcomes.
 * Guarantees that only valid prospective forecasts (submitted before outcome date) are eligible.
 */
export function calculateExpertCalibration(
  predictions: ReadonlyArray<CalibrationPredictionInput>
): ExpertCalibrationResult {
  const totalPredictions = predictions.length;

  // Filter eligible prospective forecasts
  const eligible: CalibrationPredictionInput[] = [];
  let excludedCount = 0;

  for (const p of predictions) {
    if (
      typeof p.probability !== 'number' ||
      !Number.isFinite(p.probability) ||
      p.probability < 0 ||
      p.probability > 1
    ) {
      excludedCount++;
      continue;
    }

    if (typeof p.observedOutcome !== 'number' || (p.observedOutcome !== 0 && p.observedOutcome !== 1)) {
      excludedCount++;
      continue;
    }

    // Prospective enforcement: if timestamps are present, submission must precede outcome
    if (p.submittedAt && p.outcomeDate) {
      const subTime = new Date(p.submittedAt).getTime();
      const outTime = new Date(p.outcomeDate).getTime();
      if (Number.isFinite(subTime) && Number.isFinite(outTime) && subTime > outTime) {
        // Retrospective submission after outcome occurred is ineligible
        excludedCount++;
        continue;
      }
    }

    eligible.push(p);
  }

  const eligibleCount = eligible.length;
  const hasSufficientSample = eligibleCount >= MINIMUM_SAMPLE_THRESHOLD;

  if (eligibleCount === 0) {
    return {
      methodologyVersion: '1.0.0',
      totalPredictions,
      eligibleCount: 0,
      excludedCount,
      hasSufficientSample: false,
      minimumSampleThreshold: MINIMUM_SAMPLE_THRESHOLD,
      brierScore: null,
      climatologyBss: null,
      expectedCalibrationError: null,
      calibrationBins: calculateCalibrationBins([]),
      domainBreakdown: [],
      summary:
        totalPredictions === 0
          ? 'No predictions recorded for calibration analysis.'
          : `All ${totalPredictions} predictions were excluded from calibration (awaiting verified outcome or retrospective).`,
    };
  }

  const brierScore = calculateBrierScore(eligible);
  const climatologyBss = calculateClimatologyBss(eligible);
  const bins = calculateCalibrationBins(eligible);
  const ece = calculateExpectedCalibrationError(bins, eligibleCount);

  // Domain-specific breakdown
  const domainMap = new Map<string, CalibrationPredictionInput[]>();
  for (const it of eligible) {
    const d = it.domain?.trim().toLowerCase() || 'general';
    if (!domainMap.has(d)) {
      domainMap.set(d, []);
    }
    domainMap.get(d)!.push(it);
  }

  const domainBreakdown: DomainCalibrationMetrics[] = [];
  for (const [dom, domItems] of domainMap.entries()) {
    const domBs = calculateBrierScore(domItems) ?? 0;
    const domBins = calculateCalibrationBins(domItems);
    const domEce = calculateExpectedCalibrationError(domBins, domItems.length) ?? 0;
    domainBreakdown.push({
      domain: dom,
      count: domItems.length,
      brierScore: domBs,
      expectedCalibrationError: domEce,
    });
  }
  domainBreakdown.sort((a, b) => b.count - a.count);

  let summary = '';
  if (!hasSufficientSample) {
    summary = `Preliminary sample size (N = ${eligibleCount} < ${MINIMUM_SAMPLE_THRESHOLD}). Statistical calibration cannot be reliably concluded without at least ${MINIMUM_SAMPLE_THRESHOLD} verified outcomes. Brier Score: ${brierScore}.`;
  } else {
    const bssText = climatologyBss !== null ? `, Climatological BSS: ${climatologyBss}` : '';
    summary = `Evaluated across ${eligibleCount} verified prospective predictions. Brier Score: ${brierScore} (Expected Calibration Error: ${ece}${bssText}).`;
  }

  return {
    methodologyVersion: '1.0.0',
    totalPredictions,
    eligibleCount,
    excludedCount,
    hasSufficientSample,
    minimumSampleThreshold: MINIMUM_SAMPLE_THRESHOLD,
    brierScore,
    climatologyBss,
    expectedCalibrationError: ece,
    calibrationBins: bins,
    domainBreakdown,
    summary,
  };
}

