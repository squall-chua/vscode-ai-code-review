import * as vscode from 'vscode';
import * as path from 'path';
import { marked } from 'marked';
import type { ReviewResult, ReviewIssue } from '../types';

export class ReviewResultsPanel {
  public static currentPanel: ReviewResultsPanel | undefined;
  public static readonly viewType = 'aiReviewResults';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _result: ReviewResult;

  public static createOrShow(extensionUri: vscode.Uri, result: ReviewResult) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReviewResultsPanel.currentPanel) {
      ReviewResultsPanel.currentPanel._panel.reveal(column);
      ReviewResultsPanel.currentPanel._update(result);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReviewResultsPanel.viewType,
      'AI Review Results',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.join(extensionUri.fsPath, 'media'))],
        retainContextWhenHidden: true,
      }
    );

    ReviewResultsPanel.currentPanel = new ReviewResultsPanel(panel, extensionUri, result);
  }

  public static refreshCurrent() {
    if (ReviewResultsPanel.currentPanel) {
      ReviewResultsPanel.currentPanel.refresh();
    }
  }

  public refresh() {
    // Re-run the showResultsPanel command with our current result object.
    // This will re-calculate isSuppressed etc. in extension.ts and then call createOrShow/update here.
    vscode.commands.executeCommand('aiReview.showResultsPanel', this._result);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, result: ReviewResult) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._result = result;

    this._update(result);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'openIssue':
            const issue = result.issues.find((i) => i.id === message.issueId);
            if (issue) {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.filePath));
              const editor = await vscode.window.showTextDocument(doc, { 
                viewColumn: vscode.ViewColumn.One,
                preview: true 
              });
              const pos = new vscode.Position(issue.line - 1, 0);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
            break;
          case 'suppressIssue':
            vscode.commands.executeCommand('aiReview.suppressIssue', message.issueId);
            break;
          case 'copyFix':
            vscode.commands.executeCommand('aiReview.copyFixPrompt', message.issueId);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    ReviewResultsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update(result: ReviewResult) {
    this._result = result;
    this._panel.title = `Review: ${result.label || 'Results'}`;
    this._panel.webview.html = this._getHtmlForWebview(result);
  }

  private _getHtmlForWebview(result: ReviewResult): string {
    const stats = result.issues.reduce((acc, iss) => {
      if (iss.isSuppressed) return acc;
      const sev = (iss.severity || 'info').toUpperCase();
      acc[sev] = (acc[sev] || 0) + 1;
      acc.TOTAL++;
      return acc;
    }, { CRITICAL: 0, WARNING: 0, INFO: 0, TOTAL: 0 } as any);

    const issuesListHtml = result.issues.map((issue) => `
      <div class="issue-card ${issue.severity} ${issue.isSuppressed ? 'suppressed' : ''}" onclick="openIssue('${issue.id}')">
        <div class="issue-header">
          <span class="severity-badge ${issue.isSuppressed ? 'suppressed' : issue.severity}">${issue.isSuppressed ? 'SUPPRESSED' : issue.severity.toUpperCase()}</span>
          <span class="issue-file">${issue.filePath} : Line ${issue.line}</span>
        </div>
        <div class="issue-body">
          <div class="issue-message markdown-content">${marked.parse(issue.message)}</div>
          ${issue.suggestion ? `<div class="issue-suggestion"><strong>Suggestion:</strong><div class="markdown-content">${marked.parse(issue.suggestion)}</div></div>` : ''}
        </div>
        <div class="issue-actions" onclick="event.stopPropagation()">
          ${!issue.isSuppressed ? `
            <button onclick="copyFix('${issue.id}')">Copy Fix Prompt</button>
            <button onclick="suppress('${issue.id}')">Suppress</button>
          ` : `
            <button onclick="suppress('${issue.id}')">Unsuppress</button>
          `}
        </div>
      </div>
    `).join('');

    const markdownReportHtml = result.markdownReport ? `
      <div id="full-report" class="report-section hidden">
        <h2>Full Analysis Report</h2>
        <div class="markdown-content">${marked.parse(result.markdownReport)}</div>
      </div>
    ` : '';

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Review Results</title>
      <style>
        :root {
          --card-bg: var(--vscode-editor-inactiveSelectionBackground);
          --card-hover: var(--vscode-editor-selectionBackground);
          --border-radius: 8px;
          --accent-primary: var(--vscode-button-background, #3794ef);
        }
        body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); padding: 24px; background: var(--vscode-editor-background); line-height: 1.6; }
        h1, h2, h3 { color: var(--vscode-editor-foreground); margin-top: 0; }
        .hidden { display: none !important; }
        
        .tabs { display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 12px; }
        .tab { 
          padding: 10px 20px; cursor: pointer; border-radius: 4px; border: 1px solid transparent; 
          opacity: 0.7; font-weight: 600; font-size: 13px;
          transition: all 0.2s;
        }
        .tab:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
        .tab.active { opacity: 1; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

        .dashboard-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }

        .stats { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
        .stat-box { 
          flex: 1; min-width: 120px; padding: 20px; border-radius: var(--border-radius); text-align: center; 
          border: 1px solid var(--vscode-widget-border);
          background: rgba(255,255,255,0.03);
        }
        .stat-box.critical { border-top: 4px solid #f44336; }
        .stat-box.warning { border-top: 4px solid #ff9800; }
        .stat-box.info { border-top: 4px solid #3794ef; }
        .stat-box.suppressed { border-top: 4px solid #777; }
        .stat-val { font-size: 32px; font-weight: 800; display: block; margin-bottom: 4px; }
        .stat-label { font-size: 11px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; }
        
        .issue-card { 
          margin-bottom: 16px; padding: 20px; border-radius: var(--border-radius); 
          background: var(--card-bg);
          border-left: 5px solid #ccc;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .issue-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); background: var(--card-hover); }
        .issue-card.critical { border-left-color: #f44336; }
        .issue-card.warning { border-left-color: #ff9800; }
        .issue-card.info { border-left-color: #3794ef; }
        .issue-card.suppressed { opacity: 0.5; border-left-color: #777 !important; filter: grayscale(0.5); }
        .issue-card.suppressed .issue-body { display: none; }
        .issue-card.suppressed:hover { opacity: 0.8; filter: grayscale(0); }
        
        .severity-badge { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; color: #fff; margin-right: 12px; }
        .severity-badge.critical { background: #f44336; }
        .severity-badge.warning { background: #ff9800; }
        .severity-badge.info { background: #3794ef; }
        .severity-badge.suppressed { background: #777; }
        
        .issue-file { font-size: 11px; opacity: 0.6; font-family: var(--vscode-editor-font-family); }
        .issue-message { margin-top: 12px; font-size: 14px; }
        
        .issue-actions { margin-top: 20px; display: flex; gap: 8px; }
        .issue-actions button { 
          background: var(--vscode-button-secondaryBackground); 
          color: var(--vscode-button-secondaryForeground); 
          border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;
          font-size: 11px; font-weight: 600;
        }
        .issue-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
        
        .issue-suggestion { 
          margin-top: 16px; padding: 16px; border-radius: 6px; 
          background: rgba(0,0,0,0.1); border-left: 2px solid var(--accent-primary);
          font-size: 13px;
        }
        .issue-suggestion strong { color: var(--accent-primary); display: block; margin-bottom: 8px; text-transform: uppercase; font-size: 10px; }

        .markdown-content pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; overflow-x: auto; border: 1px solid var(--vscode-widget-border); }
        .markdown-content code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
        .markdown-content blockquote { border-left: 4px solid var(--vscode-textBlockQuote-border); padding-left: 16px; margin-left: 0; opacity: 0.8; }
        
        #full-report h2 { margin-bottom: 24px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 12px; }
      </style>
    </head>
    <body>
      <div class="dashboard-header">
        <h1>Review Insights</h1>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="showTab('issues', event)">Detected Issues (${stats.TOTAL})</div>
        ${result.markdownReport ? `<div class="tab" onclick="showTab('report', event)">Full Analysis</div>` : ''}
      </div>

      <div id="issues-tab-content">
        <div class="stats">
          <div class="stat-box critical"><span class="stat-val">${stats.CRITICAL}</span><span class="stat-label">Critical</span></div>
          <div class="stat-box warning"><span class="stat-val">${stats.WARNING}</span><span class="stat-label">Warning</span></div>
          <div class="stat-box info"><span class="stat-val">${stats.INFO}</span><span class="stat-label">Info</span></div>
          <div class="stat-box suppressed"><span class="stat-val">${result.suppressedCount ?? 0}</span><span class="stat-label">Suppressed</span></div>
        </div>

        <div id="issues-list">
          ${issuesListHtml}
        </div>
      </div>

      ${markdownReportHtml}

      <script>
        const vscode = acquireVsCodeApi();
        
        function showTab(tab, event) {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          event.target.classList.add('active');
          
          if (tab === 'issues') {
            document.getElementById('issues-tab-content').classList.remove('hidden');
            const report = document.getElementById('full-report');
            if (report) report.classList.add('hidden');
          } else {
            document.getElementById('issues-tab-content').classList.add('hidden');
            const report = document.getElementById('full-report');
            if (report) report.classList.remove('hidden');
          }
        }

        function openIssue(issueId) {
          vscode.postMessage({ type: 'openIssue', issueId });
        }

        function suppress(issueId) {
          vscode.postMessage({ type: 'suppressIssue', issueId });
        }

        function copyFix(issueId) {
          vscode.postMessage({ type: 'copyFix', issueId });
        }
      </script>
    </body>
    </html>`;
  }
}
