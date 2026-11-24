import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ShowcaseSection } from '../components/ShowcaseSection.js';
import {
  generateShowcaseJson,
  generateShowcaseCsv,
  generateShowcaseHtml,
  generateShowcaseExport,
  sanitizeCsvCell,
} from '../utils/showcaseExport.js';

describe('Showcase Boardroom Defense Export Suite', () => {
  describe('Formula Injection Sanitization (CSV)', () => {
    it('prepends single quote to dangerous spreadsheet formula characters', () => {
      expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeCsvCell('+1234')).toBe("'+1234");
      expect(sanitizeCsvCell('-cmd|calc')).toBe("'-cmd|calc");
      expect(sanitizeCsvCell('@admin')).toBe("'@admin");
      expect(sanitizeCsvCell('\tTabbed')).toBe("'\tTabbed");
      expect(sanitizeCsvCell('\rReturn')).toBe('"\'\rReturn"');
    });

    it('wraps fields with commas or quotes according to RFC 4180', () => {
      expect(sanitizeCsvCell('Hello, World')).toBe('"Hello, World"');
      expect(sanitizeCsvCell('He said "yes"')).toBe('"He said ""yes"""');
    });

    it('handles empty or null values cleanly', () => {
      expect(sanitizeCsvCell(null)).toBe('');
      expect(sanitizeCsvCell(undefined)).toBe('');
      expect(sanitizeCsvCell(100)).toBe('100');
    });
  });

  describe('11 Guaranteed Audit Components Integrity', () => {
    it('contains all 11 guaranteed audit components in JSON export', () => {
      const pkg = generateShowcaseJson(false);
      expect(pkg.filename).toMatch(/^decision_os_boardroom_defense_showcase_\d{4}-\d{2}-\d{2}\.json$/);
      expect(pkg.contentType).toContain('application/json');

      const data = JSON.parse(pkg.content);

      // Component 1: Decision Metadata
      expect(data.decisionMetadata.title).toBe('Enterprise Frontend Framework & Fullstack Architecture');
      expect(data.decisionMetadata.engineVersion).toBe('canonical-mcda-v1.0.0');

      // Component 2: Alternatives
      expect(data.alternatives).toHaveLength(3);
      expect(data.alternatives[0].name).toBe('React + Vite + Fastify');

      // Component 3: Criteria & Weights
      expect(data.criteriaAndWeights).toHaveLength(4);
      const weightSum = data.criteriaAndWeights.reduce((acc: number, c: any) => acc + c.normalizedWeight, 0);
      expect(weightSum).toBeCloseTo(1.0, 5);

      // Component 4: Score Matrix
      expect(data.scoreMatrix['opt-vite-react']['crit-velocity']).toBe(92);

      // Component 5: Final Rankings
      expect(data.finalRankings[0].rank).toBe(1);
      expect(data.finalRankings[0].optionName).toBe('React + Vite + Fastify');
      expect(data.finalRankings[0].weightedScore).toBe(87.4);

      // Component 6: Sensitivity Findings
      expect(data.sensitivityFindings[0].criterionId).toBe('crit-cost');
      expect(data.sensitivityFindings[0].tippingPointWeight).toBe(50.0);

      // Component 7: Expert Contributions
      expect(data.expertContributions).toHaveLength(3);
      expect(data.expertContributions[0].name).toBe('Elena Rostova');

      // Component 8: Advisory Suggestions (Rule #14)
      expect(data.advisorySuggestions.ruleGuarantee).toContain('Rule #14 Guarantee');
      expect(data.advisorySuggestions.recommendationRanking[0].title).toBe('Proposed Criterion: Security Compliance');

      // Component 9: Evidence References & Missing Safeguards (Rule #15)
      expect(data.evidence[0].verificationStatus).toBe('unverified_citation');
      expect(data.missingEvidenceGaps.uncoveredCriteria).toContain('Type Safety & Full-Stack Contracts');

      // Component 10: Audit History Timeline
      expect(data.auditHistory).toHaveLength(6);
      expect(data.auditHistory[0].action).toBe('decision.created');
      expect(data.auditHistory[5].action).toBe('decision.analyzed');

      // Component 11: Integrity Verification Result
      expect(data.integrityVerification.isValid).toBe(true);
      expect(data.integrityVerification.status).toBe('100% Intact');
      expect(data.integrityVerification.merkleHead).toContain('sha256-');
    });

    it('dynamically reflects tamper violations when tamper simulation is active', () => {
      const tamperedJson = generateShowcaseJson(true);
      const data = JSON.parse(tamperedJson.content);

      expect(data.integrityVerification.isValid).toBe(false);
      expect(data.integrityVerification.status).toContain('Integrity Violation');
      expect(data.auditHistory[2].hash).toBe('sha256-tampered-corrupted-hash');
      expect(data.auditHistory[3].prevHash).toContain('(MISMATCH)');
    });
  });

  describe('CSV & HTML Export Generators', () => {
    it('generates valid RFC 4180 CSV matrix with all major sections', () => {
      const pkg = generateShowcaseCsv(false);
      expect(pkg.filename).toMatch(/^decision_os_boardroom_defense_showcase_\d{4}-\d{2}-\d{2}\.csv$/);
      expect(pkg.contentType).toContain('text/csv');

      expect(pkg.content).toContain('# DECISION OS — BOARDROOM DEFENSE EXPORT');
      expect(pkg.content).toContain('# ALTERNATIVES (OPTIONS)');
      expect(pkg.content).toContain('# CRITERIA & WEIGHTS');
      expect(pkg.content).toContain('# OPTIONS & SCORES MATRIX');
      expect(pkg.content).toContain('# SENSITIVITY & TIPPING POINTS');
      expect(pkg.content).toContain('# STAKEHOLDER EXPERT WEIGHT PROFILES');
      expect(pkg.content).toContain('# AI ADVISORY RECOMMENDATIONS (RULE #14 NON-AUTHORITATIVE)');
      expect(pkg.content).toContain('# EVIDENCE REFERENCES & CITATIONS (RULE #15 GROUNDING INVARIANT)');
      expect(pkg.content).toContain('# CRYPTOGRAPHIC AUDIT TIMELINE (NODES #001 - #006)');
      expect(pkg.content).toContain('# AUDIT INTEGRITY VERIFICATION RESULT');
      expect(pkg.content).toContain('React + Vite + Fastify');
      expect(pkg.content).toContain('100% Intact');
    });

    it('generates standalone executive HTML briefing with dark-mode executive styling and print support', () => {
      const pkg = generateShowcaseHtml(false);
      expect(pkg.filename).toMatch(/^decision_os_boardroom_defense_showcase_\d{4}-\d{2}-\d{2}\.html$/);
      expect(pkg.contentType).toContain('text/html');

      expect(pkg.content).toContain('<!DOCTYPE html>');
      expect(pkg.content).toContain('Boardroom Defense Briefing');
      expect(pkg.content).toContain('Enterprise Frontend Framework & Fullstack Architecture');
      expect(pkg.content).toContain('React + Vite + Fastify');
      expect(pkg.content).toContain('87.40 / 100');
      expect(pkg.content).toContain('Elena Rostova');
      expect(pkg.content).toContain('Marcus Vance');
      expect(pkg.content).toContain('Sarah Chen');
      expect(pkg.content).toContain('Rule #14 Isolation Guarantee');
      expect(pkg.content).toContain('Rule #15 Grounding');
      expect(pkg.content).toContain('SHA-256 Hash Chaining');
      expect(pkg.content).toContain('@media print');
    });

    it('correctly dispatches export by format', () => {
      expect(generateShowcaseExport('json').filename).toContain('.json');
      expect(generateShowcaseExport('csv').filename).toContain('.csv');
      expect(generateShowcaseExport('html').filename).toContain('.html');
    });
  });

  describe('ShowcaseSection UI Integration', () => {
    it('renders interactive export buttons in Cryptographic Audit Chain tab', () => {
      const html = renderToString(React.createElement(ShowcaseSection, { defaultTab: 'audit' }));

      expect(html).toContain('Boardroom Defense Export Formats');
      expect(html).toContain('JSON Package');
      expect(html).toContain('CSV Matrix');
      expect(html).toContain('Printable HTML');
      expect(html).toContain('aria-label="Export Boardroom Defense JSON Package"');
      expect(html).toContain('aria-label="Export Boardroom Defense CSV Matrix"');
      expect(html).toContain('aria-label="Export Boardroom Defense Printable HTML"');
    });
  });
});
