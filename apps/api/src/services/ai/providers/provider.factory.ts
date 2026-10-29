import type { AIProvider } from './ai.provider.interface.js';
import { MockAIProvider } from './mock.provider.js';
import { HttpAIProvider } from './http.provider.js';
import { env } from '../../../config/env.js';

let customProviderInstance: AIProvider | null = null;

export function setCustomAIProvider(provider: AIProvider | null): void {
  customProviderInstance = provider;
}

export function getAIProvider(): AIProvider {
  if (customProviderInstance) {
    return customProviderInstance;
  }

  const providerType = env.AI_PROVIDER;

  if (providerType === 'mock') {
    return new MockAIProvider(true);
  }

  if (providerType === 'gemini' || providerType === 'openai' || providerType === 'anthropic') {
    return new HttpAIProvider(providerType, env.AI_API_KEY, env.AI_MODEL);
  }

  return new MockAIProvider(true);
}

