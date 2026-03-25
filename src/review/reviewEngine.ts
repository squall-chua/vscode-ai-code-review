import { streamText } from 'ai';
import type { ReviewContext, ReviewResult, ReviewProfile } from '../types';
import { buildModel } from '../providers/modelBuilder';
import { PromptBuilder } from './promptBuilder';
import { ReviewParser } from './reviewParser';
import { SuppressionStore } from './suppressionStore';

export interface ReviewEngineCallbacks {
  onChunk: (chunk: string) => void;
  onError: (error: Error) => void;
  onComplete: (result: ReviewResult) => void;
}

/**
 * Core review engine — streams the AI response and resolves structured ReviewResult.
 */
export class ReviewEngine {
  private readonly promptBuilder = new PromptBuilder();
  private readonly parser = new ReviewParser();

  constructor(private readonly suppressionStore: SuppressionStore) {}

  async review(
    ctx: ReviewContext,
    profile: ReviewProfile,
    apiKey: string | undefined,
    callbacks: ReviewEngineCallbacks
  ): Promise<void> {
    const suppressedDescriptions = this.suppressionStore.getAllSuppressedDescriptions();
    const systemPrompt = this.promptBuilder.buildSystemPrompt(profile, suppressedDescriptions, ctx.reviewCategory);
    const userMessage = this.promptBuilder.buildUserMessage(ctx);

    let model;
    try {
      model = await buildModel(profile, apiKey);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let fullText = '';

    try {
      const result = streamText({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        maxOutputTokens: 4096,
      });

      for await (const chunk of result.textStream) {
        fullText += chunk;
        callbacks.onChunk(chunk);
      }
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Parse and filter suppressed issues
    const contextFilesRead = ctx.relatedFiles.map((f) => f.filePath);
    const rawResult = this.parser.parse(
      fullText,
      ctx.filePath,
      contextFilesRead,
      0,
      ctx.startLine
    );

    const { passing, suppressedCount } = this.suppressionStore.filterIssues(
      rawResult.issues,
      ctx.filePath
    );

    callbacks.onComplete({
      ...rawResult,
      issues: passing,
      suppressedCount,
    });
  }
}
