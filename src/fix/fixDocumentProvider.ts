import * as vscode from 'vscode';

/**
 * Provides a virtual document containing the proposed fix content.
 * Used to compare against the original file in a diff view.
 */
export class FixDocumentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'ai-review-fix';
  private fixMap = new Map<string, string>();

  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.fixMap.get(uri.toString()) || 'Fix content not found.';
  }

  registerFix(uri: vscode.Uri, content: string) {
    this.fixMap.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  clearFix(uri: vscode.Uri) {
    this.fixMap.delete(uri.toString());
  }
}
