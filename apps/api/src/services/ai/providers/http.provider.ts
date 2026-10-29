import type { AIProvider, AIProviderResponse } from './ai.provider.interface.js';
import {
  AIProviderUnavailableError,
  AITimeoutError,
  AIRateLimitError,
} from '../../../errors/domain.errors.js';

export class HttpAIProvider implements AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  private readonly apiKey?: string;

  constructor(providerName: 'gemini' | 'openai' | 'anthropic', apiKey?: string, model?: string) {
    this.name = providerName;
    this.apiKey = apiKey;
    if (providerName === 'gemini') {
      this.defaultModel = model || 'gemini-1.5-flash';
    } else if (providerName === 'anthropic') {
      this.defaultModel = model || 'claude-3-5-sonnet-latest';
    } else {
      this.defaultModel = model || 'gpt-4o-mini';
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: { timeoutMs?: number; model?: string }
  ): Promise<AIProviderResponse> {
    if (!this.isConfigured()) {
      throw new AIProviderUnavailableError(`AI provider '${this.name}' is not configured with an API key.`);
    }

    const timeoutMs = options?.timeoutMs || 15000;
    const model = options?.model || this.defaultModel;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (this.name === 'gemini') {
        return await this.callGemini(prompt, systemPrompt, model, controller.signal);
      } else {
        return await this.callOpenAICompatible(prompt, systemPrompt, model, controller.signal);
      }
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new AITimeoutError(`AI request timed out after ${timeoutMs}ms.`);
      }
      if (err instanceof AIRateLimitError || err instanceof AIProviderUnavailableError) {
        throw err;
      }
      throw new AIProviderUnavailableError(`AI Provider communication failure: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async callGemini(
    prompt: string,
    systemPrompt: string | undefined,
    model: string,
    signal: AbortSignal
  ): Promise<AIProviderResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const payload: {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      systemInstruction?: { parts: Array<{ text: string }> };
      generationConfig: { temperature: number; responseMimeType: string };
    } = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    };

    if (systemPrompt) {
      payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (res.status === 429) {
      throw new AIRateLimitError('Gemini API rate limit exceeded.');
    }
    if (!res.ok) {
      throw new AIProviderUnavailableError(`Gemini API returned status ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new AIProviderUnavailableError('Gemini API returned an empty response.');
    }

    return {
      rawText: text,
      model,
      provider: 'gemini',
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  private async callOpenAICompatible(
    prompt: string,
    systemPrompt: string | undefined,
    model: string,
    signal: AbortSignal
  ): Promise<AIProviderResponse> {
    const url = 'https://api.openai.com/v1/chat/completions';
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal,
    });

    if (res.status === 429) {
      throw new AIRateLimitError('OpenAI API rate limit exceeded.');
    }
    if (!res.ok) {
      throw new AIProviderUnavailableError(`OpenAI API returned status ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new AIProviderUnavailableError('OpenAI API returned an empty response.');
    }

    return {
      rawText: text,
      model,
      provider: this.name,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  }
}

