import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder } from '../review/promptBuilder';
import type { ReviewProfile } from '../types';
import type { ReviewContext } from '../types';

const MOCK_PROFILE: ReviewProfile = {
  id: 'test-id',
  name: 'Test',
  provider: 'openai',
  modelId: 'gpt-4o',
};

const MOCK_CTX: ReviewContext = {
  code: 'const x = 1;',
  language: 'typescript',
  filePath: 'src/foo.ts',
  reviewType: 'activeFile',
  relatedFiles: [],
};

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('uses default persona when no custom prompt set', () => {
    const system = builder.buildSystemPrompt(MOCK_PROFILE, []);
    expect(system).toContain('expert AI code reviewer');
  });

  it('uses custom persona when set', () => {
    const profile = { ...MOCK_PROFILE, customPersonaPrompt: 'You are a security expert.' };
    const system = builder.buildSystemPrompt(profile, []);
    expect(system).toContain('security expert');
    expect(system).not.toContain('senior software engineer');
  });

  it('always includes operational instructions', () => {
    const system = builder.buildSystemPrompt(MOCK_PROFILE, []);
    expect(system).toContain('## Critical Issues');
    expect(system).toContain('[FILEPATH:LINE]');
  });

  it('appends suppression list when provided', () => {
    const system = builder.buildSystemPrompt(MOCK_PROFILE, ['SQL injection in login']);
    expect(system).toContain('Suppressed Issues');
    expect(system).toContain('SQL injection in login');
  });

  it('builds user message with code block', () => {
    const msg = builder.buildUserMessage(MOCK_CTX);
    expect(msg).toContain('```typescript');
    expect(msg).toContain('const x = 1;');
    expect(msg).toContain('src/foo.ts');
  });

  it('includes related files in user message', () => {
    const ctxWithRelated: ReviewContext = {
      ...MOCK_CTX,
      relatedFiles: [{ filePath: 'src/types.ts', content: 'export type Foo = string;', reason: 'Imported by reviewed file' }],
    };
    const msg = builder.buildUserMessage(ctxWithRelated);
    expect(msg).toContain('Context File: src/types.ts');
    expect(msg).toContain('Imported by reviewed file');
  });
});
