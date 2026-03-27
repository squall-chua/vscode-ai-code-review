import * as vscode from 'vscode';
import * as path from 'path';
import { marked } from 'marked';
import type { ReviewResult } from '../types';

interface WebviewMessage {
  type: 'openIssue' | 'suppressIssue' | 'copyFix';
  issueId: string;
}

interface IssueStats {
  CRITICAL: number;
  WARNING: number;
  INFO: number;
  TOTAL: number;
}

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
    void vscode.commands.executeCommand('aiReview.showResultsPanel', this._result);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, result: ReviewResult) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._result = result;

    this._update(result);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.type) {
          case 'openIssue': {
            const issue = result.issues.find((i) => i.id === message.issueId);
            if (issue) {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.filePath));
              const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preview: true
              });

              const startLine = Math.max(0, issue.line - 1);
              const endLine = issue.endLine ? Math.max(0, issue.endLine - 1) : startLine;
              const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);

              editor.selection = new vscode.Selection(range.start, range.end);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
            break;
          }
          case 'suppressIssue':
            void vscode.commands.executeCommand('aiReview.suppressIssue', message.issueId);
            break;
          case 'copyFix':
            void vscode.commands.executeCommand('aiReview.copyFixPrompt', message.issueId);
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
    this._panel.title = `${result.label || 'Results'}`;
    this._panel.webview.html = this._getHtmlForWebview(result);
  }

  private _getHtmlForWebview(result: ReviewResult): string {
    const stats = result.issues.reduce((acc, iss) => {
      if (iss.isSuppressed) { return acc; }
      const sev = (iss.severity || 'info').toUpperCase() as keyof Omit<IssueStats, 'TOTAL'>;
      acc[sev] = (acc[sev] || 0) + 1;
      acc.TOTAL++;
      return acc;
    }, { CRITICAL: 0, WARNING: 0, INFO: 0, TOTAL: 0 } as IssueStats);

    const issuesListHtml = result.issues.map((issue) => {
      const displayPath = vscode.workspace.asRelativePath(issue.filePath, false).replace(/\\/g, '/');
      const lineDisplay = issue.endLine ? `${issue.line}-${issue.endLine}` : (issue.lineNumbers ? issue.lineNumbers.join(', ') : issue.line);

      return `
      <div class="issue-card ${issue.severity} ${issue.isSuppressed ? 'suppressed' : ''}" onclick="openIssue('${issue.id}')">
        <div class="issue-header">
          <div class="issue-header-left">
            <span class="severity-badge ${issue.isSuppressed ? 'suppressed' : issue.severity}">${issue.isSuppressed ? 'SUPPRESSED' : issue.severity.toUpperCase()}</span>
            <span class="issue-file">${displayPath} : Line ${lineDisplay}</span>
          </div>
          <div class="issue-header-actions" onclick="event.stopPropagation()">
            ${!issue.isSuppressed ? `
              <button class="copy-fix" onclick="copyFix('${issue.id}')" title="Copy Fix Prompt">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                Copy
              </button>
              <button onclick="suppress('${issue.id}')" title="Suppress Issue">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                Suppress
              </button>
            ` : `
              <button onclick="suppress('${issue.id}')" title="Unsuppress Issue">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                Unsuppress
              </button>
            `}
          </div>
        </div>
        <div class="issue-body">
          <div class="issue-message markdown-content">${marked.parse(issue.message)}</div>
          ${issue.suggestion ? `<div class="issue-suggestion"><strong>Suggestion:</strong><div class="markdown-content">${marked.parse(issue.suggestion)}</div></div>` : ''}
        </div>

      </div>
    `;
    }).join('');

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
          --card-bg: rgba(255, 255, 255, 0.03);
          --card-hover: rgba(255, 255, 255, 0.05);
          --border-radius: 12px;
          --accent-primary: var(--vscode-button-background, #3794ef);
          --critical: #f44336;
          --warning: #ff9800;
          --info: #3794ef;
          --suppressed: #777;
        }
        
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          border: 2px solid var(--vscode-editor-background);
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        
        body { 
          font-family: var(--vscode-font-family); 
          color: var(--vscode-editor-foreground); 
          padding: 12px 20px; 
          background: var(--vscode-editor-background); 
          line-height: 1.6;
          max-width: 1000px;
          margin: 0 auto;
        }
        h1, h2, h3 { color: var(--vscode-editor-foreground); margin-top: 0; font-weight: 700; }
        .hidden { display: none !important; }
        
        .tabs { 
          display: flex; 
          gap: 12px; 
          margin-bottom: 20px; 
          border-bottom: 1px solid var(--vscode-widget-border); 
          padding-bottom: 12px; 
        }
        .tab { 
          padding: 8px 20px; 
          cursor: pointer; 
          border-radius: 8px; 
          border: 1px solid transparent; 
          opacity: 0.7; 
          font-weight: 600; 
          font-size: 13px;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .tab:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
        .tab.active { 
          opacity: 1; 
          background: var(--vscode-button-background); 
          color: var(--vscode-button-foreground); 
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .dashboard-header { 
          display: flex; 
          align-items: center; 
          justify-content: space-between; 
          margin-bottom: 4px; 
        }

        .stats { 
          display: grid; 
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); 
          gap: 12px; 
          margin-bottom: 24px; 
        }
        .stat-box { 
          padding: 24px 16px; 
          border-radius: var(--border-radius); 
          text-align: center; 
          border: 1px solid rgba(255, 255, 255, 0.05);
          background: rgba(255, 255, 255, 0.02);
          transition: transform 0.2s;
        }
        .stat-box:hover { transform: translateY(-2px); background: rgba(255, 255, 255, 0.04); }
        .stat-box.critical { border-top: 4px solid var(--critical); }
        .stat-box.warning { border-top: 4px solid var(--warning); }
        .stat-box.info { border-top: 4px solid var(--info); }
        .stat-box.suppressed { border-top: 4px solid var(--suppressed); }
        .stat-val { font-size: 36px; font-weight: 800; display: block; margin-bottom: 4px; line-height: 1; }
        .stat-label { font-size: 10px; opacity: 0.5; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
        
        .issue-card { 
          margin-bottom: 12px; 
          padding: 12px 16px; 
          border-radius: var(--border-radius); 
          background: var(--card-bg);
          border: 1px solid rgba(255, 255, 255, 0.05);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }
        .issue-card::after {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: #ccc;
          transition: width 0.2s;
        }
        .issue-card:hover { 
          transform: translateY(-2px); 
          background: var(--card-hover);
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .issue-card:hover::after { width: 6px; }
        
        .issue-card.critical::after { background: var(--critical); }
        .issue-card.warning::after { background: var(--warning); }
        .issue-card.info::after { background: var(--info); }
        .issue-card.suppressed { opacity: 0.6; filter: grayscale(0.5); }
        .issue-card.suppressed::after { background: var(--suppressed) !important; }
        .issue-card.suppressed .issue-body { display: none; }
        .issue-card.suppressed:hover { opacity: 0.9; filter: grayscale(0); }
        
        .issue-header { 
          display: flex; 
          align-items: center; 
          justify-content: space-between;
          gap: 12px; 
          margin-bottom: 12px; 
          flex-wrap: nowrap;
        }
        .issue-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1;
        }
        .issue-header-actions {
          display: flex;
          gap: 6px;
        }
        .severity-badge { 
          font-size: 8px; 
          font-weight: 850; 
          padding: 2px 8px; 
          border-radius: 20px; 
          color: #fff; 
          letter-spacing: 0.5px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .severity-badge.critical { background: var(--critical); box-shadow: 0 2px 8px rgba(244, 67, 54, 0.3); }
        .severity-badge.warning { background: var(--warning); box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3); }
        .severity-badge.info { background: var(--info); box-shadow: 0 2px 8px rgba(55, 148, 239, 0.3); }
        .severity-badge.suppressed { background: var(--suppressed); }
        
        .issue-file { 
          font-size: 11px; 
          opacity: 0.7; 
          font-family: var(--vscode-editor-font-family); 
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .issue-message { font-size: 13px; margin-bottom: 8px; }
        
        .issue-header-actions button { 
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--vscode-button-secondaryBackground); 
          color: var(--vscode-button-secondaryForeground); 
          border: 1px solid rgba(255, 255, 255, 0.1); 
          padding: 2px 8px; 
          border-radius: 4px; 
          cursor: pointer;
          font-size: 10px; 
          font-weight: 600;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          letter-spacing: 0.1px;
        }
        .issue-header-actions button:hover { 
          background: var(--vscode-button-secondaryHoverBackground); 
          transform: translateY(-1px);
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          border-color: rgba(255, 255, 255, 0.2);
        }
        .issue-header-actions button:active { transform: translateY(0); }
        
        .issue-header-actions button.copy-fix {
          background: rgba(55, 148, 239, 0.1);
          color: var(--info);
          border: 1px solid rgba(55, 148, 239, 0.3);
        }
        .issue-header-actions button.copy-fix:hover {
          background: var(--info);
          color: #fff;
          border-color: var(--info);
        }
        
        .issue-header-actions svg {
          width: 12px;
          height: 12px;
          stroke-width: 2.5px;
        }
        
        .issue-suggestion { 
          margin-top: 8px; 
          padding: 12px; 
          border-radius: 8px; 
          background: rgba(255, 255, 255, 0.02); 
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-left: 3px solid var(--accent-primary);
          font-size: 13px;
        }
        .issue-suggestion strong { 
          color: var(--accent-primary); 
          display: block; 
          margin-bottom: 6px; 
          text-transform: uppercase; 
          font-size: 11px; 
          letter-spacing: 1px;
        }

        .markdown-content p { margin: 0 0 8px 0; }
        .markdown-content *:last-child { margin-bottom: 0 !important; }

        .markdown-content pre { 
          background: rgba(0, 0, 0, 0.2); 
          padding: 16px; 
          border-radius: 8px; 
          overflow-x: auto; 
          border: 1px solid rgba(255, 255, 255, 0.05); 
          margin: 12px 0;
        }
        .markdown-content code { 
          font-family: var(--vscode-editor-font-family); 
          background: rgba(255, 255, 255, 0.05); 
          padding: 2px 6px; 
          border-radius: 4px; 
          font-size: 0.9em; 
        }
        .markdown-content blockquote { 
          border-left: 4px solid var(--vscode-textBlockQuote-border); 
          padding-left: 16px; 
          margin: 16px 0; 
          opacity: 0.8; 
          font-style: italic;
        }
        
        #full-report h2 { 
          margin-bottom: 24px; 
          border-bottom: 1px solid var(--vscode-widget-border); 
          padding-bottom: 12px; 
          font-size: 24px;
        }
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
