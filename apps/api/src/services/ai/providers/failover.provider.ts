import type { AIProvider, AIProviderResponse } from './ai.provider.interface.js';
import { AIProviderUnavailableError } from '../../../errors/domain.errors.js';

export class FailoverAIProvider implements AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  private readonly providers: AIProvider[];

  constructor(providers: AIProvider[]) {
    this.providers = providers.filter(p => p && p.isConfigured());
    this.name = this.providers.map(p => p.name).join(' -> ') || 'failover(none)';
    this.defaultModel = this.providers[0]?.defaultModel || 'unknown';
  }

  isConfigured(): boolean {
    return this.providers.length > 0;
  }

  get configuredProviders(): AIProvider[] {
    return this.providers;
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: { timeoutMs?: number; model?: string }
  ): Promise<AIProviderResponse> {
    if (!this.isConfigured()) {
      throw new AIProviderUnavailableError('No configured AI providers available in failover chain.');
    }

    const errors: Array<{ provider: string; error: string }> = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        const response = await provider.generateText(prompt, systemPrompt, options);
        return {
          ...response,
          provider: response.provider || provider.name,
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ provider: provider.name, error: errMsg });
        console.warn(
          `[AI Failover] Provider '${provider.name}' failed: ${errMsg}. ${
            i < this.providers.length - 1 ? `Falling back to '${this.providers[i + 1].name}'...` : 'No more fallbacks available.'
          }`
        );
      }
    }

    const failureSummary = errors.map(e => `[${e.provider}]: ${e.error}`).join('; ');
    throw new AIProviderUnavailableError(`All providers in failover chain failed: ${failureSummary}`);
  }
}
