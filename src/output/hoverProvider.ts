import * as vscode from 'vscode';
import type { ReviewIssue } from '../types';
import type { DecorationsManager } from './decorationsManager';

/**
 * Shows the full review comment as a rich hover card.
 * Includes [Suppress] and [Fix this] action links.
 */
export class HoverProvider implements vscode.HoverProvider {
  constructor(private readonly decorations: DecorationsManager) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const issues: ReviewIssue[] = this.decorations.getIssuesForFile(document.uri.fsPath);
    const lineIssues = issues.filter((i) => i.line - 1 === position.line);

    if (lineIssues.length === 0) return undefined;

    const contents = new vscode.MarkdownString('', true);
    contents.isTrusted = true;
    contents.supportThemeIcons = true;

    for (const issue of lineIssues) {
      const icon = issue.severity === 'critical' ? '$(error)' : issue.severity === 'warning' ? '$(warning)' : '$(info)';
      contents.appendMarkdown(`**${icon} AI Code Review**\n\n`);
      contents.appendMarkdown(`${issue.message}\n\n`);

      if (issue.suggestion) {
        contents.appendMarkdown(`> 💡 **Suggestion:** ${issue.suggestion}\n\n`);
      }

      const suppressCmd = vscode.Uri.parse(
        `command:aiReview.suppressIssue?${encodeURIComponent(JSON.stringify({ issueId: issue.id }))}`
      );
      const fixCmd = vscode.Uri.parse(
        `command:aiReview.copyFixPrompt?${encodeURIComponent(JSON.stringify({ issueId: issue.id }))}`
      );

      contents.appendMarkdown(`[$(mute) Suppress](${suppressCmd.toString()}) | [📋 Copy Prompt](${fixCmd.toString()})\n\n---\n\n`);
    }

    const range = new vscode.Range(position.line, 0, position.line, Number.MAX_SAFE_INTEGER);
    return new vscode.Hover(contents, range);
  }
}
