import * as vscode from 'vscode';
import type { SuppressedEntry } from '../types';
import type { SuppressionStore } from '../review/suppressionStore';

/**
 * Webview panel listing all suppressed issues with the ability to remove individual entries.
 */
export class SuppressedIssuesPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly store: SuppressionStore) {}

  show(_context: vscode.ExtensionContext): void {
    if (this.panel) {
      this.panel.reveal();
      this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'aiReview.suppressed',
      'AI Review: Suppressed Issues',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(async (msg: { command: string; issueId: string }) => {
      if (msg.command === 'remove') {
        await this.store.unsuppress(msg.issueId);
        this.refresh();
      }
    });

    this.refresh();
  }

  private refresh(): void {
    if (!this.panel) return;
    const entries = this.store.getAllEntries();
    this.panel.webview.html = this.buildHtml(entries);
  }

  private buildHtml(entries: SuppressedEntry[]): string {
    const rows = entries.length === 0
      ? `<tr><td colspan="5" style="text-align:center;color:#888;padding:32px">No suppressed issues</td></tr>`
      : entries.map((e) => `
          <tr>
            <td>${this.esc(e.message)}</td>
            <td><code>${this.esc(e.filePath)}</code></td>
            <td><span class="scope scope-${e.scope}">${e.scope}</span></td>
            <td>${new Date(e.suppressedAt).toLocaleString()}</td>
            <td><button class="remove-btn" data-id="${this.esc(e.issueId)}">Remove</button></td>
          </tr>`).join('');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suppressed Issues</title>
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h2 { margin: 0 0 16px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 12px; font-weight: 600; color: var(--vscode-descriptionForeground); }
    td { padding: 8px 12px; border-bottom: 1px solid var(--vscode-list-hoverBackground); vertical-align: top; }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    .scope { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .scope-file { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .scope-workspace { background: var(--vscode-statusBarItem-warningBackground); color: var(--vscode-statusBarItem-warningForeground); }
    .scope-global { background: var(--vscode-statusBarItem-errorBackground); color: var(--vscode-statusBarItem-errorForeground); }
    .remove-btn { background: transparent; border: 1px solid var(--vscode-input-border); color: var(--vscode-foreground); padding: 3px 10px; cursor: pointer; border-radius: 3px; font-size: 12px; }
    .remove-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
  </style>
</head>
<body>
  <h2>Suppressed Issues (${entries.length})</h2>
  <table>
    <thead><tr><th>Issue</th><th>File</th><th>Scope</th><th>Suppressed At</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelector('tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('.remove-btn');
      if (btn) vscode.postMessage({ command: 'remove', issueId: btn.dataset.id });
    });
  </script>
</body>
</html>`;
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
