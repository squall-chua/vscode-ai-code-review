import type { ProviderId, ReviewProfile } from '../types';

/** Metadata displayed in the provider selection QuickPick. */
export interface ProviderMeta {
  id: ProviderId;
  label: string;
  description: string;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  defaultModels: string[];
  packageName: string;
}

export const PROVIDER_REGISTRY: ProviderMeta[] = [
  // ── Official providers ────────────────────────────────────────────────────
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT-4o, GPT-4 Turbo, o1, o3',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['gpt-4o', 'gpt-4-turbo', 'gpt-4o-mini', 'o1', 'o3-mini'],
    packageName: '@ai-sdk/openai',
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    description: 'OpenAI models via Azure',
    requiresApiKey: true,
    requiresBaseUrl: true,
    defaultModels: ['gpt-4o', 'gpt-4-turbo'],
    packageName: '@ai-sdk/azure',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude 3.5 Sonnet, Claude 3 Opus',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-5-haiku-20241022'],
    packageName: '@ai-sdk/anthropic',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini 2.0 Flash, Gemini 1.5 Pro',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    packageName: '@ai-sdk/google',
  },
  {
    id: 'google-vertex',
    label: 'Google Vertex AI',
    description: 'Gemini via Google Cloud Vertex AI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    packageName: '@ai-sdk/google-vertex',
  },
  {
    id: 'amazon-bedrock',
    label: 'Amazon Bedrock',
    description: 'Claude, Llama, Titan and more via AWS',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'meta.llama3-70b-instruct-v1:0'],
    packageName: '@ai-sdk/amazon-bedrock',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    description: 'Mistral Large, Codestral',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['mistral-large-latest', 'codestral-latest', 'mistral-small-latest'],
    packageName: '@ai-sdk/mistral',
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Ultra-fast inference: Llama, Mixtral',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'llama3-8b-8192'],
    packageName: '@ai-sdk/groq',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek V3, DeepSeek Coder',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['deepseek-chat', 'deepseek-coder'],
    packageName: '@ai-sdk/deepseek',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    description: 'Grok-2 Beta',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['grok-2', 'grok-2-mini'],
    packageName: '@ai-sdk/xai',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    description: 'Command R+',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['command-r-plus', 'command-r'],
    packageName: '@ai-sdk/cohere',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    description: 'Sonar Pro, Sonar',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['sonar-pro', 'sonar'],
    packageName: '@ai-sdk/perplexity',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    description: 'Fast open-source model hosting',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
    packageName: '@ai-sdk/fireworks',
  },
  {
    id: 'togetherai',
    label: 'Together AI',
    description: 'Open models via Together',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    packageName: '@ai-sdk/togetherai',
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    description: 'Serverless inference for open models',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['meta-llama/Meta-Llama-3.3-70B-Instruct'],
    packageName: '@ai-sdk/deepinfra',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    description: 'Ultra-fast Llama inference',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['llama3.1-70b'],
    packageName: '@ai-sdk/cerebras',
  },
  // ── Community providers ───────────────────────────────────────────────────
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    description: 'Self-hosted models via Ollama',
    requiresApiKey: false,
    requiresBaseUrl: true,
    defaultModels: ['llama3.3', 'qwen2.5-coder', 'deepseek-coder-v2', 'mistral'],
    packageName: 'ollama-ai-provider',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '300+ models via unified API',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-2.0-flash'],
    packageName: '@openrouter/ai-sdk-provider',
  },
  {
    id: 'portkey',
    label: 'Portkey',
    description: 'AI gateway with routing and fallbacks',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['gpt-4o', 'claude-3-5-sonnet-20241022'],
    packageName: '@portkey-ai/vercel-provider',
  },
  {
    id: 'friendliai',
    label: 'FriendliAI',
    description: 'Fast LLM inference cloud',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['meta-llama-3.1-70b-instruct'],
    packageName: '@friendliai/ai-provider',
  },
  {
    id: 'anthropic-vertex',
    label: 'Anthropic on Vertex AI',
    description: 'Claude models via Google Vertex AI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['claude-3-5-sonnet@20241022', 'claude-3-opus@20240229'],
    packageName: 'anthropic-vertex-ai',
  },
  {
    id: 'langdb',
    label: 'LangDB',
    description: 'Unified access with SQL-like analytics',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['gpt-4o', 'claude-3-5-sonnet-20241022'],
    packageName: '@langdb/vercel-provider',
  },
  {
    id: 'zhipu',
    label: 'Zhipu AI (Z.AI)',
    description: 'GLM-4 models',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['glm-4-plus', 'glm-4-flash'],
    packageName: 'zhipu-ai-provider',
  },
  {
    id: 'spark',
    label: 'Spark AI',
    description: 'Xunfei Spark models',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['spark-4.0-ultra'],
    packageName: 'spark-ai-provider',
  },
  {
    id: 'sarvam',
    label: 'Sarvam AI',
    description: 'Indic language models',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['sarvam-2b'],
    packageName: 'sarvam-ai-provider',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Use running Claude Code instance as provider',
    requiresApiKey: false,
    requiresBaseUrl: false,
    defaultModels: ['claude-sonnet-4-5', 'claude-opus-4-5'],
    packageName: 'ai-sdk-provider-claude-code',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    description: 'Use local Gemini CLI as provider',
    requiresApiKey: false,
    requiresBaseUrl: false,
    defaultModels: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    packageName: 'ai-sdk-provider-gemini-cli',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode SDK provider',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModels: ['gpt-4o', 'claude-3-5-sonnet-20241022'],
    packageName: 'ai-sdk-provider-opencode-sdk',
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    description: 'Use running Codex CLI as provider',
    requiresApiKey: false,
    requiresBaseUrl: false,
    defaultModels: ['o3', 'o4-mini'],
    packageName: 'ai-sdk-provider-codex-cli',
  },
  {
    id: 'openai-compat',
    label: 'OpenAI-Compatible (Custom)',
    description: 'Any OpenAI-compatible API (LM Studio, vLLM, etc.)',
    requiresApiKey: false,
    requiresBaseUrl: true,
    defaultModels: ['local-model'],
    packageName: '@ai-sdk/openai',
  },
];

export const PROVIDER_MAP = new Map<ProviderId, ProviderMeta>(
  PROVIDER_REGISTRY.map((p) => [p.id, p])
);

export function getProviderMeta(id: ProviderId): ProviderMeta | undefined {
  return PROVIDER_MAP.get(id);
}

export function getDefaultModel(profile: ReviewProfile): string {
  const meta = getProviderMeta(profile.provider);
  return meta?.defaultModels[0] ?? 'gpt-4o';
}
