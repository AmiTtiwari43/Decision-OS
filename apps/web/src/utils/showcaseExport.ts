/**
 * Showcase Boardroom Defense Export Generator
 * Produces portable, verifiable decision export packages for the landing showcase
 * with all 11 guaranteed audit components & SHA-256 hash chain proofs.
 */

export interface ExportPackage {
  filename: string;
  contentType: string;
  content: string;
}

/**
 * Mitigates Spreadsheet Formula Injection (CSV Injection)
 * Prefixes dangerous characters (=, +, -, @, \t, \r) with a single quote
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);

  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Triggers a browser file download using a Blob and temporary link
 */
export function triggerFileDownload(filename: string, contentType: string, content: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: contentType });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

/**
 * Builds the complete showcase data containing 11 guaranteed audit components
 */
export function getShowcaseAuditData(isTampered = false) {
  const dateStamp = new Date().toISOString().split('T')[0];
  const timestamp = new Date().toISOString();

  const metadata = {
    id: 'decision-showcase-arch-001',
    title: 'Enterprise Frontend Framework & Fullstack Architecture',
    description:
      'Strategic MCDA evaluation of enterprise-tier fullstack web frameworks for mission-critical core systems.',
    scope: 'Production Architecture Evaluation',
    methodology: 'Multi-Criteria Decision Analysis (MCDA) Weighted Linear Combination',
    engineVersion: 'canonical-mcda-v1.0.0',
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: timestamp,
  };

  const alternatives = [
    {
      id: 'opt-vite-react',
      name: 'React + Vite + Fastify',
      tagline: 'Decoupled SPA client with high-throughput Fastify API gateway',
      description:
        'High developer velocity, explicit REST/RPC boundary, granular state control, and verified full-stack TypeScript safety.',
    },
    {
      id: 'opt-nextjs',
      name: 'Next.js Fullstack',
      tagline: 'Unified React Server Components & hybrid SSR pipeline',
      description:
        'Single vendor deployment ecosystem, fast initial page load, and integrated API routing.',
    },
    {
      id: 'opt-remix',
      name: 'Remix + Express',
      tagline: 'Web standards & progressive enhancement architecture',
      description:
        'Native form data handling, nested routes, and predictable HTTP cache semantics.',
    },
  ];

  const criteriaAndWeights = [
    {
      id: 'crit-velocity',
      name: 'Velocity & Developer Experience',
      shortName: 'Velocity',
      weight: 35,
      normalizedWeight: 0.35,
      direction: 'benefit',
      isLocked: false,
    },
    {
      id: 'crit-typesafety',
      name: 'Type Safety & Full-Stack Contracts',
      shortName: 'TypeSafety',
      weight: 25,
      normalizedWeight: 0.25,
      direction: 'benefit',
      isLocked: false,
    },
    {
      id: 'crit-ecosystem',
      name: 'Ecosystem & UI Component Breadth',
      shortName: 'Ecosystem',
      weight: 20,
      normalizedWeight: 0.20,
      direction: 'benefit',
      isLocked: false,
    },
    {
      id: 'crit-cost',
      name: 'Infrastructure TCO & Hosting Predictability',
      shortName: 'Cost',
      weight: 20,
      normalizedWeight: 0.20,
      direction: 'cost',
      isLocked: true,
    },
  ];

  const scoreMatrix: Record<string, Record<string, number>> = {
    'opt-vite-react': {
      'crit-velocity': 92,
      'crit-typesafety': 88,
      'crit-ecosystem': 85,
      'crit-cost': 80,
    },
    'opt-nextjs': {
      'crit-velocity': 82,
      'crit-typesafety': 84,
      'crit-ecosystem': 90,
      'crit-cost': 76,
    },
    'opt-remix': {
      'crit-velocity': 75,
      'crit-typesafety': 80,
      'crit-ecosystem': 72,
      'crit-cost': 70,
    },
  };

  const finalRankings = [
    {
      rank: 1,
      optionId: 'opt-vite-react',
      optionName: 'React + Vite + Fastify',
      weightedScore: 87.4,
      marginToLeader: 0.0,
      isWinner: true,
    },
    {
      rank: 2,
      optionId: 'opt-nextjs',
      optionName: 'Next.js Fullstack',
      weightedScore: 83.2,
      marginToLeader: -4.2,
      isWinner: false,
    },
    {
      rank: 3,
      optionId: 'opt-remix',
      optionName: 'Remix + Express',
      weightedScore: 74.5,
      marginToLeader: -12.9,
      isWinner: false,
    },
  ];

  const sensitivityFindings = [
    {
      criterionId: 'crit-cost',
      criterionName: 'Infrastructure TCO & Hosting Predictability',
      currentWeight: 20.0,
      tippingPointWeight: 50.0,
      weightDeltaNeeded: 30.0,
      wouldFlipToOptionId: 'opt-nextjs',
      wouldFlipToOptionName: 'Next.js Fullstack',
      stability: 'robust',
      finding:
        'Cost Efficiency weight must exceed 50.0% (delta of +30.0% from current 20.0%) for Next.js Fullstack to flip into Rank #1.',
    },
  ];

  const expertContributions = [
    {
      role: 'Chief Technology Officer',
      name: 'Elena Rostova',
      email: 'elena@lead.org',
      topPriority: 'Velocity & Type Safety (45%)',
      leadPick: 'React + Vite + Fastify',
      weights: { Velocity: 45, TypeSafety: 30, Ecosystem: 15, Cost: 10 },
      consensusDelta: '+4.2 pts',
      signOff: 'Strongest API developer velocity. Team has verified type coverage across full stack.',
      status: 'adopted',
    },
    {
      role: 'Chief Financial Officer',
      name: 'Marcus Vance',
      email: 'marcus@lead.org',
      topPriority: 'Cost Efficiency & Infra TCO (40%)',
      leadPick: 'Next.js Fullstack',
      weights: { Velocity: 20, TypeSafety: 15, Ecosystem: 25, Cost: 40 },
      consensusDelta: '-1.8 pts',
      signOff: 'Single vendor cloud deployment minimizes auxiliary monitoring subscriptions.',
      status: 'submitted',
    },
    {
      role: 'Chief Product Officer',
      name: 'Sarah Chen',
      email: 'sarah@lead.org',
      topPriority: 'Time to Market & Ecosystem (40%)',
      leadPick: 'React + Vite + Fastify',
      weights: { Velocity: 35, TypeSafety: 15, Ecosystem: 40, Cost: 10 },
      consensusDelta: '+2.6 pts',
      signOff: 'Rich client-side dashboard ecosystem gives product designers maximum flexibility.',
      status: 'adopted',
    },
  ];

  const advisorySuggestions = {
    isAiGenerated: true,
    ruleGuarantee:
      'Rule #14 Guarantee: No LLM ever calculates or alters authoritative scores, weights, or sensitivity points.',
    executiveSummary:
      'Option Alpha (React + Vite + Fastify) holds a decisive +4.2 pt utility advantage driven by technical velocity (92.0) and developer ecosystem adoption.',
    cognitiveBiasAlerts: [
      'Single-Metric Anchoring: Risk of over-weighting initial compute pricing while discounting developer friction.',
      'Loss Aversion: Migration hesitation accounts for -3.2 pt conservative bias in raw team scoring.',
    ],
    recommendationRanking: [
      {
        rank: 1,
        title: 'Proposed Criterion: Security Compliance',
        score: 84.5,
        rationale: 'Incorporate FedRAMP and SOC2 Type II certifications to mitigate enterprise regulatory exposure.',
        boundary: 'Human Authority Boundary: Requires explicit owner adoption before entering decision model.',
      },
      {
        rank: 2,
        title: 'Alternative Option: Hybrid Multi-Cloud',
        score: 78.0,
        rationale: 'Deploy core stateless workloads across both providers to prevent single-vendor lock-in.',
        boundary: 'Missing Information: Benchmark egress pricing under multi-region failover spike load.',
      },
    ],
  };

  const evidence = [
    {
      id: 'ev-001',
      targetType: 'criterion',
      targetName: 'Velocity & Developer Experience',
      title: 'State of JS Build Tools Benchmark 2026',
      type: 'benchmark',
      verificationStatus: 'unverified_citation',
      notice: 'Citation provided for reference context. Not independently third-party verified (Rule #15).',
      submittedBy: 'Elena Rostova',
    },
    {
      id: 'ev-002',
      targetType: 'criterion',
      targetName: 'Infrastructure TCO & Hosting Predictability',
      title: 'Enterprise Cloud Hosting TCO Projections Q4',
      type: 'financial_model',
      verificationStatus: 'unverified_citation',
      notice: 'Citation provided for reference context. Not independently third-party verified (Rule #15).',
      submittedBy: 'Marcus Vance',
    },
  ];

  const missingEvidenceGaps = {
    rule: 'Rule #15 Grounding Invariant',
    description:
      'Export packages and deliberation modals actively compute coverage gaps. Decision makers are warned when options or high-sensitivity criteria lack supporting empirical citations.',
    uncoveredCriteria: ['Type Safety & Full-Stack Contracts'],
  };

  const auditHistory = [
    {
      sequence: 1,
      block: '#001 (Genesis)',
      action: 'decision.created',
      actor: 'elena@lead.org',
      hash: 'sha256-a1b2c3d4e5f60001',
      prevHash: 'GENESIS',
      timestamp: '2026-11-20T08:00:00.000Z',
    },
    {
      sequence: 2,
      block: '#002',
      action: 'criteria.weight_updated',
      actor: 'elena@lead.org',
      hash: 'sha256-b2c3d4e5f6a10002',
      prevHash: 'sha256-a1b2c3d4e5f60001',
      timestamp: '2026-11-21T09:30:00.000Z',
    },
    {
      sequence: 3,
      block: '#003',
      action: 'evidence.created',
      actor: 'marcus@lead.org',
      hash: isTampered ? 'sha256-tampered-corrupted-hash' : 'sha256-c3d4e5f6a1b20003',
      prevHash: 'sha256-b2c3d4e5f6a10002',
      timestamp: '2026-11-22T14:15:00.000Z',
    },
    {
      sequence: 4,
      block: '#004',
      action: 'contribution.adopted',
      actor: 'elena@lead.org',
      hash: 'sha256-d4e5f6a1b2c30004',
      prevHash: isTampered ? 'sha256-c3d4e5f6... (MISMATCH)' : 'sha256-c3d4e5f6a1b20003',
      timestamp: '2026-11-23T11:00:00.000Z',
    },
    {
      sequence: 5,
      block: '#005',
      action: 'ai.analysis_generated',
      actor: 'system.ai_analyst',
      hash: 'sha256-e5f6a1b2c3d40005',
      prevHash: 'sha256-d4e5f6a1b2c30004',
      timestamp: '2026-11-24T10:20:00.000Z',
    },
    {
      sequence: 6,
      block: '#006 (Head)',
      action: 'decision.analyzed',
      actor: 'system.engine_v1',
      hash: 'sha256-f6a1b2c3d4e50006',
      prevHash: 'sha256-e5f6a1b2c3d40005',
      timestamp: '2026-11-24T16:45:00.000Z',
    },
  ];

  const integrityVerification = {
    isValid: !isTampered,
    status: !isTampered ? '100% Intact' : 'Integrity Violation (Broken at Node #003)',
    eventsChecked: 6,
    rootHash: 'sha256-a1b2c3d4e5f60001',
    headHash: 'sha256-f6a1b2c3d4e50006',
    merkleHead: 'sha256-d5e6f1a238b901fc4e2c90a18742bca0d39e8471b023f9821456aef192847a11',
    verifiedAt: timestamp,
    reason: isTampered ? 'Out-of-band record mutation detected at Block #003 (evidence.created).' : null,
  };

  return {
    dateStamp,
    timestamp,
    metadata,
    alternatives,
    criteriaAndWeights,
    scoreMatrix,
    finalRankings,
    sensitivityFindings,
    expertContributions,
    advisorySuggestions,
    evidence,
    missingEvidenceGaps,
    auditHistory,
    integrityVerification,
  };
}

/**
 * Generates JSON package export
 */
export function generateShowcaseJson(isTampered = false): ExportPackage {
  const data = getShowcaseAuditData(isTampered);

  const payload = {
    exportVersion: '1.0.0',
    exportedAt: data.timestamp,
    certification: {
      isAuthoritative: true,
      status: 'authoritative',
      reasons: [],
    },
    decisionMetadata: data.metadata,
    alternatives: data.alternatives,
    criteriaAndWeights: data.criteriaAndWeights,
    scoreMatrix: data.scoreMatrix,
    finalRankings: data.finalRankings,
    sensitivityFindings: data.sensitivityFindings,
    expertContributions: data.expertContributions,
    advisorySuggestions: data.advisorySuggestions,
    evidence: data.evidence,
    missingEvidenceGaps: data.missingEvidenceGaps,
    auditHistory: data.auditHistory,
    integrityVerification: data.integrityVerification,
  };

  return {
    filename: `decision_os_boardroom_defense_showcase_${data.dateStamp}.json`,
    contentType: 'application/json;charset=utf-8;',
    content: JSON.stringify(payload, null, 2),
  };
}

/**
 * Generates RFC 4180 CSV Matrix export
 */
export function generateShowcaseCsv(isTampered = false): ExportPackage {
  const data = getShowcaseAuditData(isTampered);
  const lines: string[] = [];

  // 1. Header & Metadata
  lines.push('# DECISION OS — BOARDROOM DEFENSE EXPORT');
  lines.push(`Decision Title,${sanitizeCsvCell(data.metadata.title)}`);
  lines.push(`Decision ID,${sanitizeCsvCell(data.metadata.id)}`);
  lines.push(`Scope,${sanitizeCsvCell(data.metadata.scope)}`);
  lines.push(`Methodology,${sanitizeCsvCell(data.metadata.methodology)}`);
  lines.push(`Engine Version,${sanitizeCsvCell(data.metadata.engineVersion)}`);
  lines.push(`Exported At,${sanitizeCsvCell(data.timestamp)}`);
  lines.push(`Winner,${sanitizeCsvCell(data.finalRankings[0].optionName)}`);
  lines.push(`Integrity Status,${sanitizeCsvCell(data.integrityVerification.status)}`);
  lines.push('');

  // 2. Alternatives
  lines.push('# ALTERNATIVES (OPTIONS)');
  lines.push('Option ID,Option Name,Tagline,Description');
  for (const opt of data.alternatives) {
    lines.push([
      sanitizeCsvCell(opt.id),
      sanitizeCsvCell(opt.name),
      sanitizeCsvCell(opt.tagline),
      sanitizeCsvCell(opt.description),
    ].join(','));
  }
  lines.push('');

  // 3. Criteria & Weights
  lines.push('# CRITERIA & WEIGHTS');
  lines.push('Criterion ID,Name,Weight,Normalized Weight,Direction,Locked');
  for (const c of data.criteriaAndWeights) {
    lines.push([
      sanitizeCsvCell(c.id),
      sanitizeCsvCell(c.name),
      sanitizeCsvCell(`${c.weight}%`),
      sanitizeCsvCell(c.normalizedWeight),
      sanitizeCsvCell(c.direction),
      sanitizeCsvCell(c.isLocked ? 'TRUE' : 'FALSE'),
    ].join(','));
  }
  lines.push('');

  // 4. Score Matrix
  lines.push('# OPTIONS & SCORES MATRIX');
  const critNames = data.criteriaAndWeights.map(c => `Score: ${c.shortName}`);
  lines.push(['Option ID', 'Option Name', ...critNames, 'Weighted Score', 'Rank'].map(sanitizeCsvCell).join(','));
  for (const r of data.finalRankings) {
    const optScores = data.scoreMatrix[r.optionId] || {};
    const scores = data.criteriaAndWeights.map(c => sanitizeCsvCell(optScores[c.id] ?? ''));
    lines.push([
      sanitizeCsvCell(r.optionId),
      sanitizeCsvCell(r.optionName),
      ...scores,
      sanitizeCsvCell(r.weightedScore.toFixed(2)),
      sanitizeCsvCell(`#${r.rank}`),
    ].join(','));
  }
  lines.push('');

  // 5. Sensitivity Findings
  lines.push('# SENSITIVITY & TIPPING POINTS');
  lines.push('Criterion,Current Weight,Tipping Point Weight,Delta Needed,Would Flip To Option,Stability Finding');
  for (const s of data.sensitivityFindings) {
    lines.push([
      sanitizeCsvCell(s.criterionName),
      sanitizeCsvCell(`${s.currentWeight}%`),
      sanitizeCsvCell(`${s.tippingPointWeight}%`),
      sanitizeCsvCell(`+${s.weightDeltaNeeded}%`),
      sanitizeCsvCell(s.wouldFlipToOptionName),
      sanitizeCsvCell(s.finding),
    ].join(','));
  }
  lines.push('');

  // 6. Stakeholder Contributions
  lines.push('# STAKEHOLDER EXPERT WEIGHT PROFILES');
  lines.push('Role,Stakeholder Name,Top Priority,Lead Pick,Consensus Delta,Weights,Sign-Off Statement');
  for (const exp of data.expertContributions) {
    lines.push([
      sanitizeCsvCell(exp.role),
      sanitizeCsvCell(exp.name),
      sanitizeCsvCell(exp.topPriority),
      sanitizeCsvCell(exp.leadPick),
      sanitizeCsvCell(exp.consensusDelta),
      sanitizeCsvCell(JSON.stringify(exp.weights)),
      sanitizeCsvCell(exp.signOff),
    ].join(','));
  }
  lines.push('');

  // 7. AI Advisory Intelligence (Rule #14)
  lines.push('# AI ADVISORY RECOMMENDATIONS (RULE #14 NON-AUTHORITATIVE)');
  lines.push(`Rule Guarantee,${sanitizeCsvCell(data.advisorySuggestions.ruleGuarantee)}`);
  lines.push(`Synthesis,${sanitizeCsvCell(data.advisorySuggestions.executiveSummary)}`);
  for (const b of data.advisorySuggestions.cognitiveBiasAlerts) {
    lines.push(`Cognitive Bias Flag,${sanitizeCsvCell(b)}`);
  }
  lines.push('Rank,Proposal Title,Score,Rationale,Boundary Notice');
  for (const p of data.advisorySuggestions.recommendationRanking) {
    lines.push([
      sanitizeCsvCell(p.rank),
      sanitizeCsvCell(p.title),
      sanitizeCsvCell(p.score),
      sanitizeCsvCell(p.rationale),
      sanitizeCsvCell(p.boundary),
    ].join(','));
  }
  lines.push('');

  // 8. Evidence Provenance & Missing Citations (Rule #15)
  lines.push('# EVIDENCE REFERENCES & CITATIONS (RULE #15 GROUNDING INVARIANT)');
  lines.push('Evidence ID,Target,Title,Evidence Type,Verification Status,Submitted By,Notice');
  for (const ev of data.evidence) {
    lines.push([
      sanitizeCsvCell(ev.id),
      sanitizeCsvCell(ev.targetName),
      sanitizeCsvCell(ev.title),
      sanitizeCsvCell(ev.type),
      sanitizeCsvCell(ev.verificationStatus),
      sanitizeCsvCell(ev.submittedBy),
      sanitizeCsvCell(ev.notice),
    ].join(','));
  }
  lines.push('');

  // 9. Cryptographic Audit Chain Timeline
  lines.push('# CRYPTOGRAPHIC AUDIT TIMELINE (NODES #001 - #006)');
  lines.push('Sequence,Node Block,Timestamp,Action,Actor,Current Event Hash,Previous Hash');
  for (const h of data.auditHistory) {
    lines.push([
      sanitizeCsvCell(h.sequence),
      sanitizeCsvCell(h.block),
      sanitizeCsvCell(h.timestamp),
      sanitizeCsvCell(h.action),
      sanitizeCsvCell(h.actor),
      sanitizeCsvCell(h.hash),
      sanitizeCsvCell(h.prevHash),
    ].join(','));
  }
  lines.push('');

  // 10. Integrity Verification
  lines.push('# AUDIT INTEGRITY VERIFICATION RESULT');
  lines.push(`Verification Status,${sanitizeCsvCell(data.integrityVerification.status)}`);
  lines.push(`Chain Valid,${sanitizeCsvCell(data.integrityVerification.isValid ? 'YES (100% Intact)' : 'NO (Violation Detected)')}`);
  lines.push(`Head Hash,${sanitizeCsvCell(data.integrityVerification.headHash)}`);
  lines.push(`Merkle Head,${sanitizeCsvCell(data.integrityVerification.merkleHead)}`);
  lines.push(`Verified At,${sanitizeCsvCell(data.integrityVerification.verifiedAt)}`);
  if (!data.integrityVerification.isValid) {
    lines.push(`Tamper Reason,${sanitizeCsvCell(data.integrityVerification.reason || 'Hash mismatch')}`);
  }

  return {
    filename: `decision_os_boardroom_defense_showcase_${data.dateStamp}.csv`,
    contentType: 'text/csv;charset=utf-8;',
    content: lines.join('\r\n'),
  };
}

/**
 * Generates Printable Executive HTML Briefing export
 */
export function generateShowcaseHtml(isTampered = false): ExportPackage {
  const data = getShowcaseAuditData(isTampered);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Boardroom Defense Briefing — ${data.metadata.title}</title>
  <style>
    :root {
      --bg: #0b0f17;
      --surface: #111827;
      --card: #1f2937;
      --border: #374151;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --signal: #d4ff8a;
      --sky: #38bdf8;
      --indigo: #818cf8;
      --emerald: #34d399;
      --rose: #fb7185;
      --amber: #fbbf24;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem 1rem;
    }
    .container { max-width: 1040px; margin: 0 auto; }
    .header {
      border-bottom: 2px solid var(--border);
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-family: monospace;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-signal { background: rgba(212, 255, 138, 0.15); color: var(--signal); border: 1px solid rgba(212, 255, 138, 0.3); }
    .badge-emerald { background: rgba(52, 211, 153, 0.15); color: var(--emerald); border: 1px solid rgba(52, 211, 153, 0.3); }
    .badge-rose { background: rgba(251, 113, 133, 0.15); color: var(--rose); border: 1px solid rgba(251, 113, 133, 0.3); }
    .title { font-size: 1.875rem; font-weight: 800; margin: 0.5rem 0 0.25rem; color: #ffffff; }
    .subtitle { font-size: 0.875rem; color: var(--text-muted); }
    .actions { display: flex; gap: 0.5rem; }
    .btn {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn:hover { background: var(--card); }
    .section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .section-title {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #ffffff;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
    }
    .winner-card {
      background: linear-gradient(135deg, rgba(212, 255, 138, 0.1) 0%, rgba(56, 189, 248, 0.05) 100%);
      border: 1px solid rgba(212, 255, 138, 0.4);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .winner-title { font-size: 1.25rem; font-weight: 800; color: var(--signal); }
    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; margin-top: 0.75rem; }
    th { text-align: left; padding: 0.625rem; background: var(--card); color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 0.625rem; border-bottom: 1px solid rgba(55, 65, 81, 0.5); }
    tr:last-child td { border-bottom: none; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; }
    .card-label { font-size: 0.7rem; color: var(--text-muted); font-family: monospace; text-transform: uppercase; }
    .card-value { font-size: 0.95rem; font-weight: 700; color: #fff; margin-top: 0.25rem; }
    .footer { text-align: center; font-size: 0.75rem; color: var(--text-muted); margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    @media print {
      body { background: #fff; color: #000; padding: 0; }
      .actions, .btn { display: none; }
      .section { border-color: #ddd; background: #fff; color: #000; break-inside: avoid; }
      .winner-card { border-color: #000; background: #f9f9f9; }
      .title, .winner-title, .section-title, .card-value { color: #000; }
      th { background: #f0f0f0; color: #000; }
      td { border-color: #eee; color: #000; }
      .badge { border: 1px solid #000; color: #000; background: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <span class="badge badge-signal">Decision OS • Boardroom Briefing</span>
        <h1 class="title">${data.metadata.title}</h1>
        <p class="subtitle">${data.metadata.description}</p>
        <p class="subtitle mono" style="margin-top: 0.25rem;">
          ID: ${data.metadata.id} • Engine: ${data.metadata.engineVersion} • Exported: ${data.dateStamp}
        </p>
      </div>
      <div class="actions">
        <button class="btn" onclick="window.print()">🖨️ Print / Save PDF</button>
      </div>
    </div>

    <!-- 01 & 05: Outcome & Final Rankings -->
    <div class="section">
      <div class="section-title">01 • Executive MCDA Decision Outcome</div>
      <div class="winner-card">
        <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted);">
          Deterministic Mathematical Winner
        </div>
        <div class="winner-title">🏆 ${data.finalRankings[0].optionName}</div>
        <div style="font-size: 0.875rem; margin-top: 0.25rem;">
          Final Authoritative Weighted Score: <strong class="mono" style="color: var(--signal);">${data.finalRankings[0].weightedScore.toFixed(2)} / 100</strong>
          (Lead Margin: +4.20 pts over runner-up)
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Candidate Option</th>
            <th>Velocity (35%)</th>
            <th>TypeSafety (25%)</th>
            <th>Ecosystem (20%)</th>
            <th>Cost (20%)</th>
            <th>Final Score</th>
            <th>Margin</th>
          </tr>
        </thead>
        <tbody>
          ${data.finalRankings
            .map(
              r => `<tr>
            <td class="mono"><strong>#${r.rank}</strong></td>
            <td><strong>${r.optionName}</strong></td>
            <td class="mono">${data.scoreMatrix[r.optionId]['crit-velocity']}</td>
            <td class="mono">${data.scoreMatrix[r.optionId]['crit-typesafety']}</td>
            <td class="mono">${data.scoreMatrix[r.optionId]['crit-ecosystem']}</td>
            <td class="mono">${data.scoreMatrix[r.optionId]['crit-cost']}</td>
            <td class="mono"><strong>${r.weightedScore.toFixed(2)}</strong></td>
            <td class="mono">${r.marginToLeader === 0 ? 'Leader' : `${r.marginToLeader.toFixed(2)} pts`}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- 03 & 06: Criteria & Sensitivity -->
    <div class="section">
      <div class="section-title">02 • Criteria Weights & Sensitivity Tipping Points</div>
      <div class="grid-3">
        ${data.criteriaAndWeights
          .map(
            c => `<div class="card">
          <div class="card-label">${c.direction} Criterion</div>
          <div class="card-value">${c.name}</div>
          <div class="mono" style="font-size: 0.8rem; color: var(--signal); margin-top: 0.25rem;">
            Weight: ${c.weight}% (${c.normalizedWeight * 100}%)
          </div>
        </div>`
          )
          .join('')}
      </div>

      <div style="margin-top: 1rem; padding: 1rem; background: var(--card); border-radius: 0.5rem; font-size: 0.8125rem;">
        <strong style="color: var(--amber);">Analytical Flip Boundary:</strong>
        <p style="margin-top: 0.25rem; color: var(--text-muted);">${data.sensitivityFindings[0].finding}</p>
      </div>
    </div>

    <!-- 07: Stakeholder Contributions -->
    <div class="section">
      <div class="section-title">03 • Multi-Stakeholder Calibration (Consensus Alignment: 88.4%)</div>
      <div class="grid-3">
        ${data.expertContributions
          .map(
            exp => `<div class="card">
          <div class="card-label">${exp.role}</div>
          <div class="card-value">${exp.name}</div>
          <div style="font-size: 0.75rem; color: var(--signal); margin: 0.25rem 0;">Primary: ${exp.topPriority}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">"${exp.signOff}"</div>
          <div class="mono" style="font-size: 0.7rem; color: var(--emerald); margin-top: 0.5rem;">Pick: ${exp.leadPick} • Status: ${exp.status.toUpperCase()}</div>
        </div>`
          )
          .join('')}
      </div>
    </div>

    <!-- 08: Advisory Intelligence (Rule #14) -->
    <div class="section">
      <div class="section-title">04 • Advisory Intelligence (Rule #14 Isolation Guarantee)</div>
      <div style="margin-bottom: 0.75rem; font-size: 0.75rem; color: var(--indigo); font-family: monospace;">
        ${data.advisorySuggestions.ruleGuarantee}
      </div>
      <p style="font-size: 0.8125rem; color: var(--text); margin-bottom: 0.75rem;">
        ${data.advisorySuggestions.executiveSummary}
      </p>
      <div class="grid-3">
        ${data.advisorySuggestions.recommendationRanking
          .map(
            rec => `<div class="card">
          <div class="card-label">Rank #${rec.rank} Advisory Proposal</div>
          <div class="card-value">${rec.title}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${rec.rationale}</div>
          <div class="mono" style="font-size: 0.7rem; color: var(--indigo); margin-top: 0.5rem;">${rec.boundary}</div>
        </div>`
          )
          .join('')}
      </div>
    </div>

    <!-- 09: Evidence Provenance & Missing Safeguards (Rule #15) -->
    <div class="section">
      <div class="section-title">05 • Evidence Provenance & Missing Safeguards (Rule #15 Grounding)</div>
      <table>
        <thead>
          <tr>
            <th>Evidence ID</th>
            <th>Associated Target</th>
            <th>Citation Title</th>
            <th>Type</th>
            <th>Verification Status</th>
            <th>Submitter</th>
          </tr>
        </thead>
        <tbody>
          ${data.evidence
            .map(
              ev => `<tr>
            <td class="mono">${ev.id}</td>
            <td><strong>${ev.targetName}</strong></td>
            <td>${ev.title}</td>
            <td class="mono">${ev.type}</td>
            <td><span class="badge badge-signal">Unverified Citation</span></td>
            <td>${ev.submittedBy}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <div style="margin-top: 0.75rem; font-size: 0.75rem; color: var(--amber);">
        ⚠️ <strong>Missing Evidence Gap Detected:</strong> "Type Safety & Full-Stack Contracts" criterion has 0 empirical citations.
      </div>
    </div>

    <!-- 10 & 11: Cryptographic Audit Stream & Tamper Proof -->
    <div class="section">
      <div class="section-title">
        06 • SHA-256 Hash Chaining & Cryptographic Tamper Evidence
        <span class="badge ${data.integrityVerification.isValid ? 'badge-emerald' : 'badge-rose'}" style="margin-left: auto;">
          ${data.integrityVerification.status}
        </span>
      </div>
      <p class="subtitle mono" style="margin-bottom: 0.75rem;">
        Merkle Head: ${data.integrityVerification.merkleHead} • Total Verified: ${data.integrityVerification.eventsChecked} blocks
      </p>

      <table>
        <thead>
          <tr>
            <th>Block</th>
            <th>Action</th>
            <th>Actor</th>
            <th>SHA-256 Event Hash</th>
            <th>Previous Block Hash</th>
          </tr>
        </thead>
        <tbody>
          ${data.auditHistory
            .map(
              h => `<tr>
            <td class="mono"><strong>${h.block}</strong></td>
            <td class="mono">${h.action}</td>
            <td>${h.actor}</td>
            <td class="mono" style="font-size: 0.75rem; color: var(--sky);">${h.hash}</td>
            <td class="mono" style="font-size: 0.75rem; color: var(--text-muted);">${h.prevHash}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <div class="footer">
      Generated deterministically by <strong>Decision OS</strong>. Authoritative MCDA Engine v1.0.0. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  return {
    filename: `decision_os_boardroom_defense_showcase_${data.dateStamp}.html`,
    contentType: 'text/html;charset=utf-8;',
    content: html,
  };
}

/**
 * Dispatcher to generate export package by format
 */
export function generateShowcaseExport(format: 'json' | 'csv' | 'html', isTampered = false): ExportPackage {
  switch (format) {
    case 'json':
      return generateShowcaseJson(isTampered);
    case 'csv':
      return generateShowcaseCsv(isTampered);
    case 'html':
      return generateShowcaseHtml(isTampered);
  }
}
