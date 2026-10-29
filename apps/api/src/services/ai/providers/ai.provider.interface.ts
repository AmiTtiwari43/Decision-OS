export interface AIProviderResponse {
  rawText: string;
  model: string;
  provider: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;
  isConfigured(): boolean;
  generateText(
    prompt: string,
    systemPrompt?: string,
    options?: { timeoutMs?: number; model?: string }
  ): Promise<AIProviderResponse>;
}

