import * as vscode from 'vscode';
import type { ReviewResult } from '../types';

const SCHEME = 'ai-review';

/**
 * Virtual document content provider.
 * Streams the AI review Markdown into a virtual editor tab.
 */
export class ReportDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly content = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? '';
  }

  /** Called per-chunk during streaming. */
  updateContent(uri: vscode.Uri, text: string): void {
    this.content.set(uri.toString(), text);
    this.onDidChangeEmitter.fire(uri);
  }

  /** Appends the suppression footer after streaming completes. */
  finalizeContent(uri: vscode.Uri, result: ReviewResult): void {
    let current = this.content.get(uri.toString()) ?? '';

    if (result.contextFilesRead.length > 0) {
      const fileList = result.contextFilesRead.map((f) => `- \`${f}\``).join('\n');
      current += `\n\n---\n> **Context files read:** ${result.contextFilesRead.length}\n${fileList}`;
    }

    if (result.suppressedCount > 0) {
      current += `\n\n---\n> ⚠️ **${result.suppressedCount} issue${result.suppressedCount > 1 ? 's' : ''} suppressed.** [Manage Suppressed Issues](command:aiReview.manageSuppressed)`;
    }

    this.content.set(uri.toString(), current);
    this.onDidChangeEmitter.fire(uri);
  }

  clearContent(uri: vscode.Uri): void {
    this.content.delete(uri.toString());
  }

  static makeUri(label: string): vscode.Uri {
    const safe = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    return vscode.Uri.parse(`${SCHEME}:AI Review — ${safe}.md`);
  }

  static get scheme(): string {
    return SCHEME;
  }
}

/** Prepares the review report URI but does not open it in the editor. */
export function prepareReviewReport(
  provider: ReportDocumentProvider,
  label: string
): vscode.Uri {
  const uri = ReportDocumentProvider.makeUri(label);
  provider.updateContent(uri, `# AI Code Review\n\n_Reviewing ${label}…_\n`);
  return uri;
}
