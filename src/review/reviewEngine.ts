import * as vscode from 'vscode';
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
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      callbacks.onComplete({
        issues: [
          {
            id: `error-${Date.now()}`,
            severity: 'critical',
            filePath: ctx.filePath,
            line: 1,
            message: `Review setup failed: ${error.message}`,
            suggestion: 'Check your API key and provider configuration.',
          },
        ],
        summary: `❌ Setup Error: ${error.message}`,
        contextFilesRead: [],
        suppressedCount: 0,
        status: 'error',
      });
      return;
    }

    let fullText = '';

    try {
      const config = vscode.workspace.getConfiguration('aiReview');
      const maxOutputTokens = config.get<number>('maxOutputTokens', 4096);
      const temperature = config.get<number>('temperature', 0.1);

      const result = streamText({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        maxOutputTokens,
        temperature,
      });

      for await (const chunk of result.textStream) {
        fullText += chunk;
        callbacks.onChunk(chunk);
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      callbacks.onComplete({
        issues: [
          {
            id: `error-${Date.now()}`,
            severity: 'critical',
            filePath: ctx.filePath,
            line: 1,
            message: `AI Review failed: ${error.message}`,
            suggestion: 'Check your internet connection or model availability.',
          },
        ],
        summary: `❌ AI Error: ${error.message}`,
        contextFilesRead: [],
        suppressedCount: 0,
        status: 'error',
      });
      return;
    }

    // Parse and get suppression stats
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
