/**
 * Named review profile — stored in globalState (non-sensitive).
 * API key is stored separately in SecretStorage keyed by profileId.
 */
export interface ReviewProfile {
  id: string;
  name: string;
  provider: ProviderId;
  modelId: string;
  customBaseUrl?: string;
  /** Overrides the persona section (Part A) of the system prompt. */
  customPersonaPrompt?: string;
}

/** All supported provider identifiers. */
export type ProviderId =
  // Official @ai-sdk/* providers
  | 'openai'
  | 'azure'
  | 'anthropic'
  | 'amazon-bedrock'
  | 'google'
  | 'google-vertex'
  | 'mistral'
  | 'togetherai'
  | 'cohere'
  | 'fireworks'
  | 'deepinfra'
  | 'deepseek'
  | 'cerebras'
  | 'groq'
  | 'perplexity'
  | 'xai'
  // Community providers
  | 'ollama'
  | 'openrouter'
  | 'portkey'
  | 'friendliai'
  | 'anthropic-vertex'
  | 'langdb'
  | 'zhipu'
  | 'spark'
  | 'sarvam'
  | 'claude-code'
  | 'gemini-cli'
  | 'opencode'
  | 'codex-cli'
  // Generic OpenAI-compatible (Ollama/LM Studio via customBaseUrl)
  | 'openai-compat';

export type ReviewType = 'gitDiff' | 'activeFile' | 'selection' | 'selectedFiles';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export type SuppressionScope = 'file' | 'workspace' | 'global';

export interface ReviewIssue {
  /** Stable hash of filePath + line + message for suppression tracking. */
  id: string;
  severity: IssueSeverity;
  filePath: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  issues: ReviewIssue[];
  markdownReport?: string;
  fileReports?: Record<string, string>;
  summary: string;
  /** Files read as additional context by the agentic expander. */
  contextFilesRead: string[];
  suppressedCount: number;
  status?: 'pending' | 'completed' | 'error';
  label?: string;
  reviewCategory?: ReviewCategory;
}

export type ReviewCategory = 
  | 'general'
  | 'potential bugs'
  | 'best practices & design patterns'
  | 'readability & maintainability'
  | 'performance'
  | 'testability'
  | 'style guide adherence'
  | 'security considerations'
  | 'clarity of comments';

export interface ReviewContext {
  code: string;
  language: string;
  /** Primary file path (or "Git Diff" for diff reviews). */
  filePath: string;
  reviewType: ReviewType;
  /** Optional start line if this is a fragment of a larger file. 1-indexed. */
  startLine?: number;
  /** Additional file contents injected for context. */
  relatedFiles: RelatedFile[];
  /** Optional category to focus the review on. */
  reviewCategory?: ReviewCategory;
}

export interface RelatedFile {
  filePath: string;
  content: string;
  /** Why this file was included (e.g., "imported by reviewed file"). */
  reason: string;
}

export interface SuppressedEntry {
  issueId: string;
  message: string;
  filePath: string;
  scope: SuppressionScope;
  suppressedAt: string;
  reason?: string;
}
