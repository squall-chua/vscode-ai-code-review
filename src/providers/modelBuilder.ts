// ai v6 uses LanguageModelV2 as its primary model interface.
// We keep LanguageModelV1 as an alias for compatibility with the rest of the codebase.
type LanguageModelV1 = import('@ai-sdk/provider').LanguageModelV2;
import type { ReviewProfile } from '../types';

/**
 * Dynamically resolves the Vercel AI SDK LanguageModelV1 for the given profile.
 * Providers are imported lazily to keep the bundle manageable.
 *
 * NOTE: `baseten` and `elevenlabs` are removed from ProviderId — they are
 * text-gen providers but do not have stable @ai-sdk/* packages yet.
 */
export async function buildModel(profile: ReviewProfile, apiKey: string | undefined): Promise<LanguageModelV1> {
  const { provider, modelId, customBaseUrl } = profile;

  switch (provider) {
    // ── Official @ai-sdk/* providers ────────────────────────────────────────
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'azure': {
      const { createAzure } = await import('@ai-sdk/azure');
      return createAzure({ apiKey, baseURL: customBaseUrl })(modelId) as unknown as LanguageModelV1;
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'google-vertex': {
      const { createVertex } = await import('@ai-sdk/google-vertex');
      return createVertex({})(modelId) as unknown as LanguageModelV1;
    }
    case 'amazon-bedrock': {
      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
      return createAmazonBedrock({})(modelId) as unknown as LanguageModelV1;
    }
    case 'mistral': {
      const { createMistral } = await import('@ai-sdk/mistral');
      return createMistral({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'groq': {
      const { createGroq } = await import('@ai-sdk/groq');
      return createGroq({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek');
      return createDeepSeek({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai');
      return createXai({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'cohere': {
      const { createCohere } = await import('@ai-sdk/cohere');
      return createCohere({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'perplexity': {
      const { createPerplexity } = await import('@ai-sdk/perplexity');
      return createPerplexity({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'fireworks': {
      const { createFireworks } = await import('@ai-sdk/fireworks');
      return createFireworks({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'togetherai': {
      const { createTogetherAI } = await import('@ai-sdk/togetherai');
      return createTogetherAI({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'deepinfra': {
      const { createDeepInfra } = await import('@ai-sdk/deepinfra');
      return createDeepInfra({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'cerebras': {
      const { createCerebras } = await import('@ai-sdk/cerebras');
      return createCerebras({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    // ── Community providers ────────────────────────────────────────────────
    case 'ollama': {
      const { createOllama } = await import('ollama-ai-provider');
      const baseURL = customBaseUrl || 'http://localhost:11434/api';
      return createOllama({ baseURL })(modelId) as unknown as LanguageModelV1;
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
      return createOpenRouter({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'portkey': {
      // @portkey-ai/vercel-provider exports createPortkey()
      const portkey = await import('@portkey-ai/vercel-provider');
      const client = portkey.createPortkey({ apiKey });
      // portkey client is a provider — call it as a function with modelId
      return (client as unknown as (m: string) => LanguageModelV1)(modelId);
    }
    case 'friendliai': {
      // @friendliai/ai-provider exports createFriendli (not createFriendliAI)
      const { createFriendli } = await import('@friendliai/ai-provider');
      // FriendliAI uses `apiKey` in their settings
      return createFriendli({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'anthropic-vertex': {
      const { createAnthropicVertex } = await import('anthropic-vertex-ai');
      return createAnthropicVertex({})(modelId) as unknown as LanguageModelV1;
    }
    case 'langdb': {
      const { createLangDB } = await import('@langdb/vercel-provider');
      return createLangDB({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'zhipu': {
      const { createZhipu } = await import('zhipu-ai-provider');
      return createZhipu({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'spark': {
      // spark-ai-provider exports createSparkProvider (not createSpark)
      const { createSparkProvider } = await import('spark-ai-provider');
      return createSparkProvider({ apiKey })(modelId) as unknown as LanguageModelV1;
    }
    case 'sarvam': {
      // sarvam-ai-provider exports createSarvam — modelId must be a literal enum
      const { createSarvam } = await import('sarvam-ai-provider');
      // Cast modelId to any to bypass enum restriction since user provides it at runtime
      return createSarvam({ apiKey })(modelId as never) as unknown as LanguageModelV1;
    }
    case 'claude-code': {
      // ai-sdk-provider-claude-code exports createClaudeCode
      const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
      return createClaudeCode({})(modelId) as unknown as LanguageModelV1;
    }
    case 'gemini-cli': {
      // ai-sdk-provider-gemini-cli uses ESM-only exports — access via default
      const mod = await import('ai-sdk-provider-gemini-cli');
      const factory = (mod as unknown as { createGeminiCLI?: (o: object) => (m: string) => unknown }).createGeminiCLI
        ?? (mod as unknown as { default?: { createGeminiCLI?: (o: object) => (m: string) => unknown } }).default?.createGeminiCLI;
      if (!factory) throw new Error('ai-sdk-provider-gemini-cli: createGeminiCLI not found in module exports. Ensure the package is up-to-date.');
      return factory({})(modelId) as unknown as LanguageModelV1;
    }
    case 'opencode': {
      // ai-sdk-provider-opencode-sdk exports createOpencode
      const { createOpencode } = await import('ai-sdk-provider-opencode-sdk');
      return createOpencode({})(modelId) as unknown as LanguageModelV1;
    }
    case 'codex-cli': {
      // ai-sdk-provider-codex-cli: broken zod v4 compat in current version, throw descriptive error
      throw new Error(
        'ai-sdk-provider-codex-cli is not currently compatible with zod v4. Use the openai-compat provider with a local Codex endpoint instead.'
      );
    }
    case 'openai-compat': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const baseURL = customBaseUrl || 'http://localhost:11434/v1';
      // `compatibility` is not in the type but is a valid runtime option
      return createOpenAI({
        apiKey: apiKey || 'not-required',
        baseURL,
      })(modelId) as unknown as LanguageModelV1;
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}
