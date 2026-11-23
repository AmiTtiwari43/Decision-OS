import type { AIProvider } from './ai.provider.interface.js';
import { MockAIProvider } from './mock.provider.js';
import { HttpAIProvider } from './http.provider.js';
import { FailoverAIProvider } from './failover.provider.js';
import { env } from '../../../config/env.js';

let customProviderInstance: AIProvider | null = null;

export function setCustomAIProvider(provider: AIProvider | null): void {
  customProviderInstance = provider;
}

export function createSingleProvider(
  providerType: 'mock' | 'gemini' | 'openai' | 'anthropic' | 'openrouter',
  apiKey?: string,
  model?: string
): AIProvider {
  if (providerType === 'mock') {
    return new MockAIProvider(true);
  }

  if (
    providerType === 'gemini' ||
    providerType === 'openai' ||
    providerType === 'anthropic' ||
    providerType === 'openrouter'
  ) {
    return new HttpAIProvider(providerType, apiKey, model);
  }

  return new MockAIProvider(true);
}

export function getAIProvider(): AIProvider {
  if (customProviderInstance) {
    return customProviderInstance;
  }

  const primary = createSingleProvider(env.AI_PROVIDER, env.AI_API_KEY, env.AI_MODEL);

  if (env.FALLBACK_AI_PROVIDER && env.FALLBACK_AI_PROVIDER !== 'none') {
    const fallback = createSingleProvider(
      env.FALLBACK_AI_PROVIDER,
      env.FALLBACK_AI_API_KEY || env.AI_API_KEY,
      env.FALLBACK_AI_MODEL
    );
    return new FailoverAIProvider([primary, fallback]);
  }

  return primary;
}

