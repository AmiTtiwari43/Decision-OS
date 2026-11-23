import { describe, it, expect, vi } from 'vitest';
import { FailoverAIProvider } from '../src/services/ai/providers/failover.provider.js';
import type { AIProvider, AIProviderResponse } from '../src/services/ai/providers/ai.provider.interface.js';
import { HttpAIProvider } from '../src/services/ai/providers/http.provider.js';
import { AIRateLimitError, AIProviderUnavailableError } from '../src/errors/domain.errors.js';

describe('FailoverAIProvider & Multi-Provider Resilience', () => {
  it('returns primary provider response when primary succeeds', async () => {
    const primaryMock: AIProvider = {
      name: 'gemini',
      defaultModel: 'gemini-1.5-flash',
      isConfigured: () => true,
      generateText: vi.fn().mockResolvedValue({
        rawText: '{"executiveSummary": "Primary success"}',
        model: 'gemini-1.5-flash',
        provider: 'gemini',
      } satisfies AIProviderResponse),
    };

    const fallbackMock: AIProvider = {
      name: 'openrouter',
      defaultModel: 'google/gemini-2.0-flash-exp:free',
      isConfigured: () => true,
      generateText: vi.fn(),
    };

    const failover = new FailoverAIProvider([primaryMock, fallbackMock]);
    expect(failover.isConfigured()).toBe(true);

    const result = await failover.generateText('test prompt');
    expect(result.provider).toBe('gemini');
    expect(result.rawText).toContain('Primary success');
    expect(primaryMock.generateText).toHaveBeenCalledTimes(1);
    expect(fallbackMock.generateText).not.toHaveBeenCalled();
  });

  it('fails over to secondary provider (e.g. OpenRouter) when primary fails with RateLimitError', async () => {
    const primaryMock: AIProvider = {
      name: 'gemini',
      defaultModel: 'gemini-1.5-flash',
      isConfigured: () => true,
      generateText: vi.fn().mockRejectedValue(new AIRateLimitError('Gemini 429 quota exhausted')),
    };

    const fallbackMock: AIProvider = {
      name: 'openrouter',
      defaultModel: 'google/gemini-2.0-flash-exp:free',
      isConfigured: () => true,
      generateText: vi.fn().mockResolvedValue({
        rawText: '{"executiveSummary": "Fallback OpenRouter response"}',
        model: 'google/gemini-2.0-flash-exp:free',
        provider: 'openrouter',
      } satisfies AIProviderResponse),
    };

    const failover = new FailoverAIProvider([primaryMock, fallbackMock]);
    const result = await failover.generateText('test prompt');

    expect(primaryMock.generateText).toHaveBeenCalledTimes(1);
    expect(fallbackMock.generateText).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('openrouter');
    expect(result.rawText).toContain('Fallback OpenRouter response');
  });

  it('throws AIProviderUnavailableError summarizing all failures when all providers fail', async () => {
    const primaryMock: AIProvider = {
      name: 'gemini',
      defaultModel: 'gemini-1.5-flash',
      isConfigured: () => true,
      generateText: vi.fn().mockRejectedValue(new Error('Network connection timeout')),
    };

    const fallbackMock: AIProvider = {
      name: 'openrouter',
      defaultModel: 'google/gemini-2.0-flash-exp:free',
      isConfigured: () => true,
      generateText: vi.fn().mockRejectedValue(new Error('OpenRouter 503 Bad Gateway')),
    };

    const failover = new FailoverAIProvider([primaryMock, fallbackMock]);

    await expect(failover.generateText('test prompt')).rejects.toThrow(
      /All providers in failover chain failed:.*\[gemini\].*\[openrouter\]/
    );
  });

  it('correctly configures HttpAIProvider for OpenRouter with custom headers', () => {
    const openrouterProvider = new HttpAIProvider(
      'openrouter',
      'sk-or-v1-testkey',
      'meta-llama/llama-3.3-70b-instruct'
    );

    expect(openrouterProvider.name).toBe('openrouter');
    expect(openrouterProvider.defaultModel).toBe('meta-llama/llama-3.3-70b-instruct');
    expect(openrouterProvider.isConfigured()).toBe(true);
  });
});
