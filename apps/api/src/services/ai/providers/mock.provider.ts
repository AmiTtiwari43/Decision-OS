import type { AIProvider, AIProviderResponse } from './ai.provider.interface.js';
import { AIProviderUnavailableError, AITimeoutError, AIRateLimitError } from '../../../errors/domain.errors.js';

export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  readonly defaultModel = 'decision-analyst-mock-v1';
  private configured = true;

  constructor(isConfigured = true) {
    this.configured = isConfigured;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async generateText(
    prompt: string,
    _systemPrompt?: string,
    _options?: { timeoutMs?: number; model?: string }
  ): Promise<AIProviderResponse> {
    if (!this.configured) {
      throw new AIProviderUnavailableError('AI Provider is not configured or disabled.');
    }

    // Adversarial & test error triggers
    if (prompt.includes('__TEST_TRIGGER_UNAVAILABLE__')) {
      throw new AIProviderUnavailableError('Simulated provider service unavailable.');
    }
    if (prompt.includes('__TEST_TRIGGER_TIMEOUT__')) {
      throw new AITimeoutError('Simulated provider timeout.');
    }
    if (prompt.includes('__TEST_TRIGGER_RATE_LIMIT__')) {
      throw new AIRateLimitError('Simulated rate limit exceeded.');
    }
    if (prompt.includes('__TEST_TRIGGER_INVALID_JSON__')) {
      return {
        rawText: '<<<INVALID_RAW_NON_JSON_RESPONSE>>>',
        model: this.defaultModel,
        provider: this.name,
      };
    }
    if (prompt.includes('__TEST_TRIGGER_SCHEMA_VIOLATION__')) {
      return {
        rawText: JSON.stringify({ missingExecutiveSummary: true, randomField: 123 }),
        model: this.defaultModel,
        provider: this.name,
      };
    }

    // Extract basic contextual hints from prompt
    const titleMatch = prompt.match(/<decision_title>([\s\S]*?)<\/decision_title>/) || prompt.match(/"title":\s*"([^"]+)"/);
    const decisionTitle = titleMatch ? titleMatch[1].trim() : 'Decision Evaluation';

    const winnerMatch = prompt.match(/<winner_id>([\s\S]*?)<\/winner_id>/) || prompt.match(/"winnerId":\s*"([^"]+)"/);
    const winnerId = winnerMatch ? winnerMatch[1].trim() : null;

    const winnerNameMatch = prompt.match(/<winner_name>([\s\S]*?)<\/winner_name>/);
    const winnerName = winnerNameMatch ? winnerNameMatch[1].trim() : (winnerId || 'Leading alternative');

    const runnerUpMatch = prompt.match(/<runner_up_name>([\s\S]*?)<\/runner_up_name>/);
    const runnerUpName = runnerUpMatch ? runnerUpMatch[1].trim() : 'Secondary alternative';

    const hasContributions = prompt.includes('<expert_contributions>') && !prompt.includes('<expert_contributions>\n  None\n</expert_contributions>');
    const hasEvidence = prompt.includes('<evidence_items>') && !prompt.includes('<evidence_items>\n  None\n</evidence_items>');

    const isInjectionTest = prompt.includes('__TEST_TRIGGER_INJECTION__') || prompt.includes('IGNORE ALL PREVIOUS INSTRUCTIONS');

    const output = {
      executiveSummary: `Advisory analysis for "${decisionTitle}". The decision evaluates competing alternatives using multi-criteria utility weighting. Authoritative backend engine results indicate that ${winnerName} holds the highest overall rank under current normalized weights.${isInjectionTest ? ' [Note: Untrusted context text contained prompt override attempts which were safely quarantined.]' : ''}`,
      tradeoffAnalysis: {
        winnerObservation: `${winnerName} achieved the top rank based on authoritative scoring across prioritized criteria.`,
        keyTradeoffs: [
          `Performance in heavily-weighted dimensions gives ${winnerName} an edge over ${runnerUpName}.`,
          'Trade-offs between top-tier performance and secondary cost or complexity constraints require deliberate executive sign-off.',
        ],
        sensitivityNotes: [
          'Sensitivity tipping-point calculations indicate that moderate adjustments in unlocked weights could alter the final ranking.',
          'Monte Carlo win probabilities show the stability of the current winner under simulated score uncertainties.',
        ],
      },
      evidenceGaps: [
        {
          targetType: 'decision',
          targetId: 'root',
          targetName: decisionTitle,
          gapDescription: hasEvidence
            ? 'Certain secondary criteria rely on qualitative assertions rather than empirical benchmarks.'
            : 'Decision currently has zero attached empirical evidence or published citations.',
          recommendation: 'Attach benchmark whitepapers, third-party audits, or empirical test results to substantiate critical scoring assumptions.',
        },
      ],
      expertSummary: {
        totalContributionsAnalyzed: hasContributions ? 2 : 0,
        consensusAreas: hasContributions
          ? ['General alignment on the strategic necessity of the top-weighted criteria.', 'Agreement on core operational risks.']
          : ['No expert contributions have been submitted yet.'],
        divergenceAreas: hasContributions
          ? ['Diverging assessments regarding long-term maintenance overhead.', 'Different predictions on implementation timelines.']
          : [],
        keyInsights: hasContributions
          ? ['Experts emphasize that cultural adoption and vendor lock-in are critical qualitative differentiators.']
          : ['Deliberation round is currently open for expert submissions.'],
      },
      assumptions: [
        'Criteria weights accurately represent the decision maker’s current utility preferences.',
        'Assigned scores reflect consistent evaluation standards across all evaluated options.',
        ...(isInjectionTest ? ['Untrusted user text included attempted system prompt instructions that were neutralized.'] : []),
      ],
      followUpQuestions: [
        'What unstated regulatory or budgetary constraints might impact the viability of the preferred option?',
        'Under what conditions would the organization be willing to accept the trade-offs of the runner-up alternative?',
      ],
      suggestedCriteria: [
        {
          id: 'compliance',
          name: 'Regulatory & Security Compliance',
          description: 'Evaluates adherence to industry standards, security certifications, and compliance mandates.',
          suggestedWeight: 15,
          direction: 'benefit',
          rationale: 'Mitigates regulatory exposure and verifies enterprise security standards.',
        },
      ],
    };

    return {
      rawText: JSON.stringify(output),
      model: this.defaultModel,
      provider: this.name,
      usage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(JSON.stringify(output).length / 4),
      },
    };
  }
}
