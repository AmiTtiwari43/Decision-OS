import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { exportService } from '../src/services/export.service';
import { decisionRepository } from '../src/repositories/index.js';

// Mock all external dependencies to ensure fast, isolated, zero-database execution
vi.mock('../src/repositories/index.js', () => ({
  decisionRepository: {
    findById: vi.fn(),
  },
  evidenceRepository: {
    list: vi.fn().mockResolvedValue([]),
  },
  contributionRepository: {
    listByDecision: vi.fn().mockResolvedValue([]),
  },
  disagreementRepository: {
    listByDecision: vi.fn().mockResolvedValue([]),
  },
  predictionRepository: {
    listByDecision: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../src/services/authorization.service.js', () => ({
  authorizeDecisionAction: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/services/audit.service.js', () => ({
  auditService: {
    verifyChainIntegrity: vi.fn().mockResolvedValue({
      isValid: true,
      totalEventsChecked: 3,
      rootHash: 'test-root-hash',
      headHash: 'test-head-hash',
    }),
    recordEvent: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../src/services/calibration.service.js', () => ({
  calibrationService: {
    getDecisionCalibration: vi.fn().mockResolvedValue(null),
  },
}));

describe('ExportService HTML Export Score Rendering Regression Suite', () => {
  const dummyDecisionId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders valid zero weightedScore as "0.00" and missing/non-numeric weightedScore as "N/A"', async () => {
    const mockDecision = {
      _id: new mongoose.Types.ObjectId(dummyDecisionId),
      title: 'Score Formatting Test Decision',
      description: 'Testing missing vs zero score formatting in HTML export',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      criteria: [
        { id: 'crit-1', name: 'Reliability', weight: 100, isLocked: false },
      ],
      options: [
        { id: 'opt-zero', name: 'Option Zero Score' },
        { id: 'opt-valid', name: 'Option Valid Score' },
        { id: 'opt-missing', name: 'Option Missing Score' },
        { id: 'opt-null', name: 'Option Null Score' },
        { id: 'opt-nan', name: 'Option NaN Score' },
      ],
      scores: {},
      analysis: {
        engineVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
        winnerId: 'opt-valid',
        evaluations: [
          {
            optionId: 'opt-valid',
            optionName: 'Option Valid Score',
            rank: 1,
            weightedScore: 92.4,
            scoreDifferenceToLeader: 0,
          },
          {
            optionId: 'opt-zero',
            optionName: 'Option Zero Score',
            rank: 2,
            weightedScore: 0,
            scoreDifferenceToLeader: 92.4,
          },
          {
            optionId: 'opt-missing',
            optionName: 'Option Missing Score',
            rank: null,
            weightedScore: undefined as unknown as number,
            scoreDifferenceToLeader: null as unknown as number,
          },
          {
            optionId: 'opt-null',
            optionName: 'Option Null Score',
            rank: null,
            weightedScore: null as unknown as number,
            scoreDifferenceToLeader: null as unknown as number,
          },
          {
            optionId: 'opt-nan',
            optionName: 'Option NaN Score',
            rank: null,
            weightedScore: NaN,
            scoreDifferenceToLeader: NaN,
          },
        ],
      },
    };

    (decisionRepository.findById as any).mockResolvedValue(mockDecision);

    const result = await exportService.generateExport(dummyDecisionId, 'html');
    expect(result.contentType).toBe('text/html');
    const html = result.content;

    // 1. Valid positive score must be formatted with two decimal places
    expect(html).toContain('<td>92.40</td>');

    // 2. Valid score of exactly 0 must be preserved and rendered as "0.00"
    expect(html).toContain('<td>0.00</td>');

    // 3. Missing (undefined), null, and NaN scores must render as "N/A" and NOT as "0.00"
    expect(html).toContain('<td>N/A</td>');

    // Count occurrences of <td>N/A</td>: opt-missing, opt-null, and opt-nan should each produce one
    const naCount = (html.match(/<td>N\/A<\/td>/g) || []).length;
    expect(naCount).toBe(3);

    // Ensure opt-zero row has <td>0.00</td> and not N/A
    expect(html).toMatch(/<td>Option Zero Score<\/td>\s*<td>0\.00<\/td>/);

    // Ensure opt-valid row has <td>92.40</td>
    expect(html).toMatch(/<td>Option Valid Score<\/td>\s*<td>92\.40<\/td>/);

    // Ensure opt-missing row has <td>N/A</td>
    expect(html).toMatch(/<td>Option Missing Score<\/td>\s*<td>N\/A<\/td>/);

    // Ensure opt-null row has <td>N/A</td>
    expect(html).toMatch(/<td>Option Null Score<\/td>\s*<td>N\/A<\/td>/);

    // Ensure opt-nan row has <td>N/A</td>
    expect(html).toMatch(/<td>Option NaN Score<\/td>\s*<td>N\/A<\/td>/);
  });
});
