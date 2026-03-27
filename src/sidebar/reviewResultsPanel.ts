import * as vscode from 'vscode';
import type { ReviewResult, ReviewIssue } from '../types';

interface WebviewMessage {
  type: 'openFile' | 'suppressIssue' | 'copyFixPrompt' | 'refresh';
  issue?: ReviewIssue;
  issueId?: string;
}

export class ReviewResultsPanel {
  public static currentPanel: ReviewResultsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private _result: ReviewResult
  ) {
    this._panel = panel;
    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.type) {
          case 'openFile':
            if (message.issue) {
              await this.handleOpenFile(message.issue);
            }
            break;
          case 'suppressIssue':
            if (message.issue) {
              await vscode.commands.executeCommand('aiReview.suppressIssue', message.issue);
            }
            break;
          case 'copyFixPrompt':
            if (message.issueId) {
              await vscode.commands.executeCommand('aiReview.copyFixPrompt', { issueId: message.issueId });
            }
            break;
          case 'refresh':
            this._update();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri, result: ReviewResult) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReviewResultsPanel.currentPanel) {
      ReviewResultsPanel.currentPanel._result = result;
      ReviewResultsPanel.currentPanel._panel.reveal(column);
      ReviewResultsPanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiReviewResults',
      `AI Review — ${result.label || 'Results'}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true
      }
    );

    ReviewResultsPanel.currentPanel = new ReviewResultsPanel(panel, extensionUri, result);
  }

  private async handleOpenFile(issue: ReviewIssue) {
    if (!issue.filePath || issue.filePath === 'Git Diff') return;
    const uri = vscode.Uri.file(issue.filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    const line = Math.max(0, issue.line - 1);
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  public dispose() {
    ReviewResultsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _getHtmlForWebview() {
    const nonce = getNonce();
    const result = this._result;
    const issues = result.issues;

    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Results</title>
  <style nonce="${nonce}">
    :root {
      --accent-blue: #007acc;
      --accent-cyan: #4cc9f0;
      --accent-teal: #4895ef;
      --severity-critical: #f72585;
      --severity-warning: #ffbe0b;
      --severity-info: #4361ee;
      --bg-dark: var(--vscode-editor-background);
      --card-bg: var(--vscode-sideBar-background);
      --border-color: var(--vscode-panel-border);
      --glass-bg: rgba(255, 255, 255, 0.03);
    }

    body {
      font-family: var(--vscode-font-family), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--bg-dark);
      margin: 0;
      padding: 0;
      line-height: 1.6;
      overflow-x: hidden;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 60px 30px;
      animation: fadeIn 0.8s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    header {
      margin-bottom: 50px;
      text-align: center;
    }

    h1 {
      font-size: 3.5rem;
      font-weight: 800;
      margin: 0;
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-info));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -1px;
    }

    .meta {
      display: flex;
      gap: 20px;
      margin-top: 10px;
      opacity: 0.7;
      font-size: 0.9rem;
    }

    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 25px;
      margin-bottom: 50px;
    }

    .card {
      background: var(--glass-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 35px;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, transparent, var(--accent-cyan), transparent);
      opacity: 0.3;
      transition: opacity 0.3s;
    }

    .card:hover {
      transform: translateY(-8px);
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.06);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    }

    .card:hover::before {
      opacity: 1;
    }

    .card h3 {
      margin: 0 0 10px 0;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      opacity: 0.6;
    }

    .card .value {
      font-size: 2rem;
      font-weight: bold;
    }

    .severity-dot {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 8px;
    }

    .critical { background-color: var(--severity-critical); }
    .warning { background-color: var(--severity-warning); }
    .info { background-color: var(--severity-info); }

    .issue-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .issue-item {
      background: var(--glass-bg);
      backdrop-filter: blur(5px);
      border-left: 6px solid transparent;
      border-radius: 12px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      position: relative;
      margin-bottom: 10px;
      transition: transform 0.2s ease;
      animation: slideUp 0.5s ease-out forwards;
      opacity: 0;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .issue-item.critical-border { 
      border-left-color: var(--severity-critical);
      box-shadow: -10px 0 20px -10px rgba(247, 37, 133, 0.3);
    }
    .issue-item.warning-border { border-left-color: var(--severity-warning); }
    .issue-item.info-border { border-left-color: var(--severity-info); }

    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .issue-location {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85rem;
      color: var(--accent-cyan);
      cursor: pointer;
      text-decoration: underline;
    }

    .issue-location:hover {
      color: var(--accent-blue);
    }

    .issue-message {
      font-size: 1.1rem;
      margin-bottom: 15px;
    }

    .suggestion {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      padding: 15px;
      margin-top: 8px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9rem;
      border: 1px dashed var(--border-color);
    }

    .suggestion h4 {
      margin: 0 0 8px 0;
      font-size: 0.75rem;
      text-transform: uppercase;
      opacity: 0.5;
    }

    .actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }

    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 0.8rem;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .filters {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }

    .filter-btn {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--vscode-foreground);
      padding: 4px 12px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.8rem;
    }

    .filter-btn.active {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
      color: white;
    }

    .hidden { display: none; }

    .summary-text {
      font-size: 1.1rem;
      margin-bottom: 30px;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Review Results</h1>
      <div class="meta">
        <span>${result.label || 'Individual Review'}</span>
        <span>${new Date().toLocaleString()}</span>
      </div>
    </header>

    <div class="summary-text">
      ${result.summary || 'AI has completed the review of your code.'}
    </div>

    <div class="summary-cards">
      <div class="card">
        <h3>Critical Issues</h3>
        <div class="value" style="color: var(--severity-critical)">${criticalCount}</div>
      </div>
      <div class="card">
        <h3>Warnings</h3>
        <div class="value" style="color: var(--severity-warning)">${warningCount}</div>
      </div>
      <div class="card">
        <h3>Total Issues</h3>
        <div class="value">${issues.length}</div>
      </div>
    </div>

    <div class="filters">
      <button class="filter-btn active" onclick="filterIssues('all')">All</button>
      <button class="filter-btn" onclick="filterIssues('critical')">Critical</button>
      <button class="filter-btn" onclick="filterIssues('warning')">Warnings</button>
      <button class="filter-btn" onclick="filterIssues('info')">Info</button>
    </div>

    <div class="issue-list" id="issue-list">
      ${issues.map(issue => `
        <div class="issue-item ${issue.severity}-border" data-severity="${issue.severity}">
          <div class="issue-header">
            <div class="issue-location" onclick="openFile(${JSON.stringify(issue).replace(/"/g, '&quot;')})">
              ${issue.filePath}:${issue.line}
            </div>
            <div class="badge ${issue.severity}">${issue.severity.toUpperCase()}</div>
          </div>
          <div class="issue-message">
            ${issue.message}
          </div>
          ${issue.suggestion ? `
            <div class="suggestion">
              <h4>Suggested Fix</h4>
              <code>${issue.suggestion.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>
            </div>
          ` : ''}
          <div class="actions">
            <button class="btn" onclick="copyFixPrompt('${issue.id}')">Apply Fix</button>
            <button class="btn btn-secondary" onclick="suppressIssue(${JSON.stringify(issue).replace(/"/g, '&quot;')})">Suppress</button>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function openFile(issue) {
      vscode.postMessage({ type: 'openFile', issue });
    }

    function suppressIssue(issue) {
      vscode.postMessage({ type: 'suppressIssue', issue });
    }

    function copyFixPrompt(issueId) {
      vscode.postMessage({ type: 'copyFixPrompt', issueId });
    }

    function filterIssues(severity) {
      const items = document.querySelectorAll('.issue-item');
      const btns = document.querySelectorAll('.filter-btn');
      
      btns.forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase() === severity || (severity === 'all' && btn.innerText.toLowerCase() === 'all'));
      });

      items.forEach(item => {
        if (severity === 'all' || item.getAttribute('data-severity') === severity) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
