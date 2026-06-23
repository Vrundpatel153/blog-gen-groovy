// ============================================================================
// AI Provider Abstraction
// Swap-friendly: supports OpenAI now, designed so Claude/Gemini can be added.
// ============================================================================

import OpenAI from 'openai';
import { config } from '../config.js';
import type { AIMessage, AICompletionOptions, AICompletionResult } from '../types/index.js';

// ---------------------------------------------------------------------------
// Abstract Interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  name: string;
  complete(messages: AIMessage[], options?: AICompletionOptions): Promise<AICompletionResult>;
  embed(input: string | string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// OpenAI Implementation
// ---------------------------------------------------------------------------

class OpenAIProvider implements AIProvider {
  name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(input: string | string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input,
    });
    return response.data.map((d) => d.embedding);
  }

  async complete(messages: AIMessage[], options: AICompletionOptions = {}): Promise<AICompletionResult> {
    const model = options.model || config.ai.modelGeneration;
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens || 4096;

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
    };

    if (options.responseFormat === 'json') {
      requestParams.response_format = { type: 'json_object' };
    }

    const start = Date.now();
    const response = await this.client.chat.completions.create(requestParams);
    const latency = Date.now() - start;

    const choice = response.choices[0];
    const content = choice?.message?.content || '';
    const tokensUsed = response.usage?.total_tokens || 0;
    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;

    return {
      content,
      model: response.model,
      tokensUsed,
      promptTokens,
      completionTokens,
      finishReason: choice?.finish_reason || 'unknown',
    };
  }
}

// ---------------------------------------------------------------------------
// Azure OpenAI Implementation
// ---------------------------------------------------------------------------

class AzureOpenAIProvider implements AIProvider {
  name = 'azure';
  private apiKey: string;
  private endpoint: string;

  constructor(apiKey: string, endpoint: string) {
    if (!apiKey) throw new Error('Azure OpenAI API Key is missing. Set OPENAI_API_KEY or AZURE_OPENAI_API_KEY.');
    if (!endpoint) throw new Error('Azure OpenAI Endpoint is missing. Set AZURE_OPENAI_ENDPOINT.');
    this.apiKey = apiKey;
    this.endpoint = endpoint.replace(/\/openai\/v1\/?$/, '').replace(/\/+$/, '');
  }

  private buildDeploymentCandidates(modelOrDeployment: string): string[] {
    const raw = [
      modelOrDeployment,
      process.env.AZURE_OPENAI_DEPLOYMENT_CHAT,
      process.env.AZURE_OPENAI_DEPLOYMENT,
    ]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);

    const normalized = modelOrDeployment.toLowerCase();
    if (normalized.includes('codex')) raw.push('codex');
    if (normalized.includes('gpt-5.3-codex')) raw.push('gpt-5.3', 'gpt-5');
    if (normalized === 'gpt-5.3') raw.push('gpt-5');

    return [...new Set(raw)];
  }

  private parseResponse(data: any, fallbackModel: string): AICompletionResult {
    const choice = data.output?.find((o: any) => o.type === 'message' && o.role === 'assistant');
    const content = choice?.content?.find((c: any) => c.type === 'output_text')?.text || '';
    const tokensUsed = data.usage?.total_tokens || 0;
    const promptTokens = data.usage?.input_tokens || data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.output_tokens || data.usage?.completion_tokens || 0;

    return {
      content,
      model: data.model || fallbackModel,
      tokensUsed,
      promptTokens,
      completionTokens,
      finishReason: 'stop',
    };
  }

  async complete(messages: AIMessage[], options: AICompletionOptions = {}): Promise<AICompletionResult> {
    const deployment = options.model || config.ai.modelGeneration;
    const temperature = options.temperature ?? 0.7;
    const url = `${this.endpoint}/openai/v1/responses`;
    const deploymentsToTry = this.buildDeploymentCandidates(deployment);
    let lastError = '';

    for (const candidate of deploymentsToTry) {
      const baseBody: Record<string, any> = {
        model: candidate,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: temperature,
      };

      const requestVariants: Array<{ body: Record<string, any>; label: string }> = [];
      if (options.responseFormat === 'json') {
        requestVariants.push({
          body: {
            ...baseBody,
            text: {
              format: {
                type: 'json_object',
              },
            },
          },
          label: 'json_object',
        });
      }
      requestVariants.push({ body: baseBody, label: 'default' });

      for (const variant of requestVariants) {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.apiKey,
          },
          body: JSON.stringify(variant.body),
        });

        if (res.ok) {
          const data = await res.json() as any;
          return this.parseResponse(data, candidate);
        }

        const errorText = await res.text();
        lastError = `Azure OpenAI Responses API error (Status ${res.status}) for deployment "${candidate}" (${variant.label}): ${errorText}`;
        const notFoundDeployment =
          res.status === 404 && /deployment|does not exist|not found/i.test(errorText);
        const unsupportedFormat =
          variant.label === 'json_object' &&
          res.status >= 400 &&
          /format|json_object|text\.format|unsupported|invalid/i.test(errorText);

        if (unsupportedFormat) {
          continue;
        }

        if (!notFoundDeployment) {
          throw new Error(lastError);
        }
      }
    }

    throw new Error(lastError || 'Azure OpenAI Responses API failed for all deployment candidates.');
  }

  async embed(input: string | string[]): Promise<number[][]> {
    const url = `${this.endpoint}/openai/v1/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input,
      }),
    });
    if (!res.ok) {
      throw new Error(`Azure Model Inference Embeddings failed (Status ${res.status}): ${await res.text()}`);
    }
    const data = await res.json() as any;
    return data.data.map((d: any) => d.embedding);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let providerInstance: AIProvider | null = null;

export function setAIProvider(provider: AIProvider | null): void {
  providerInstance = provider;
}

export function getAIProvider(): AIProvider {
  if (!providerInstance) {
    const providerName = config.ai.provider;
    switch (providerName) {
      case 'openai':
        providerInstance = new OpenAIProvider(config.openaiApiKey);
        break;
      case 'azure':
        providerInstance = new AzureOpenAIProvider(
          config.openaiApiKey,
          config.azureOpenaiEndpoint
        );
        break;
      default:
        throw new Error(`Unknown AI provider: ${providerName}`);
    }
  }
  return providerInstance;
}
