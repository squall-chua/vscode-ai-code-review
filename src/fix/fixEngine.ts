import * as vscode from 'vscode';
import type { ReviewIssue, ReviewProfile } from '../types';
import { buildModel } from '../providers/modelBuilder';
import { streamText } from 'ai';
import { FixDocumentProvider } from './fixDocumentProvider';

/**
 * Generates an AI-powered fix for a single issue.
 * Previews the fix in the native VSCode diff editor before applying.
 */
export class FixEngine {
  constructor(private readonly provider: FixDocumentProvider) {}

  async apply(
    issue: ReviewIssue,
    document: vscode.TextDocument,
    profile: ReviewProfile,
    apiKey: string | undefined
  ): Promise<void> {
    const originalContent = document.getText();
    const targetLine = Math.max(0, issue.line - 1);

    // Extract context: 10 lines around the issue
    const lines = originalContent.split('\n');
    const contextStart = Math.max(0, targetLine - 10);
    const contextEnd = Math.min(lines.length, targetLine + 10);
    const context = lines.slice(contextStart, contextEnd).join('\n');

    let model;
    try {
      model = await buildModel(profile, apiKey);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load model: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const prompt = `You are a code fixer. Given this issue and surrounding code, produce ONLY the corrected code block — no explanation.

Issue: ${issue.message}
${issue.suggestion ? `Suggestion: ${issue.suggestion}` : ''}
Language: ${document.languageId}

Surrounding code (lines ${contextStart + 1}–${contextEnd}):
\`\`\`${document.languageId}
${context}
\`\`\`

Output only the corrected version of the surrounding code block (same range, same language), with the fix applied. No markdown fences in your response.`;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AI Code Review: Generating fix…', cancellable: false },
      async () => {
        let fixedBlock = '';
        try {
          const result = streamText({ model, messages: [{ role: 'user', content: prompt }], maxOutputTokens: 2048 });
          for await (const chunk of result.textStream) {
            fixedBlock += chunk;
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Fix generation failed: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }

        // Splice the fix into the document
        const fixedLines = fixedBlock.trim().split('\n');
        const fixedContent = [
          ...lines.slice(0, contextStart),
          ...fixedLines,
          ...lines.slice(contextEnd),
        ].join('\n');

        await this.showDiffAndApply(document, originalContent, fixedContent);
      }
    );
  }

  private async showDiffAndApply(
    document: vscode.TextDocument,
    original: string,
    proposed: string
  ): Promise<void> {
    const tempUri = document.uri.with({
      scheme: FixDocumentProvider.scheme,
      path: document.uri.path + '.fixed',
    });

    this.provider.registerFix(tempUri, proposed);

    // Use native diff editor
    await vscode.commands.executeCommand(
      'vscode.diff',
      document.uri,
      tempUri,
      `AI Fix Preview ↔ ${document.uri.fsPath.split('/').pop()}`
    );

    const action = await vscode.window.showInformationMessage(
      'Apply the AI-suggested fix?',
      'Apply',
      'Dismiss'
    );

    if (action === 'Apply') {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = document.validateRange(new vscode.Range(0, 0, Infinity, Infinity));
      edit.replace(document.uri, fullRange, proposed);
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) vscode.window.showErrorMessage('Failed to apply fix.');
    }

    this.provider.clearFix(tempUri);
  }
}
