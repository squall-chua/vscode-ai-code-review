import * as vscode from 'vscode';
import type { DecorationsManager } from './decorationsManager';

/**
 * Shows ⚡ Fix this and 🚫 Suppress CodeLens above every annotated line.
 */
export class CodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(private readonly decorations: DecorationsManager) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const issues = this.decorations.getIssuesForFile(document.uri.fsPath);
    const lenses: vscode.CodeLens[] = [];

    for (const issue of issues) {
      const line = Math.max(0, issue.line - 1);
      const range = new vscode.Range(line, 0, line, 0);

      lenses.push(
        new vscode.CodeLens(range, {
          title: '📋 Copy fix prompt',
          command: 'aiReview.copyFixPrompt',
          arguments: [{ issueId: issue.id }],
          tooltip: 'Copy a prompt to the clipboard to fix this issue with an AI',
        }),
        new vscode.CodeLens(range, {
          title: '🚫 Suppress',
          command: 'aiReview.suppressIssue',
          arguments: [{ issueId: issue.id }],
          tooltip: 'Suppress this issue and hide it from future reviews',
        })
      );
    }

    return lenses;
  }

  refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }
}
