import * as vscode from 'vscode';
import type { ReviewResult, ReviewIssue } from '../types';

// ── Item model ────────────────────────────────────────────────────────────────

/** Discriminated union for file-group vs individual-issue tree nodes. */
type IssueItemData =
  | { kind: 'history'; timestamp: number; result: ReviewResult; isLatest: boolean }
  | { kind: 'file'; filePath: string; issues: ReviewIssue[]; result: ReviewResult; timestamp: number; }
  | { kind: 'issue'; issue: ReviewIssue }
  | { kind: 'empty'; text: string };

export class IssueTreeItem extends vscode.TreeItem {
  public readonly data: IssueItemData;

  constructor(data: IssueItemData) {
    if (data.kind === 'history') {
      const date = new Date(data.timestamp);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const displayTime = `${yyyy}-${mm}-${dd} ${time}`;
      const totalIssues = data.result.issues.length;
      const criticalCount = data.result.issues.filter(i => i.severity === 'critical').length;
      
      let label = data.result.label || 'Review';
      if (data.result.reviewCategory && data.result.reviewCategory !== 'general') {
        const cat = data.result.reviewCategory;
        // Capitalize first letter of each word
        label = cat.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      }
      
      const isPending = data.result.status === 'pending';
      let title = isPending ? `⏳ ${label} (${displayTime})` : `${label} (${displayTime})`;

      let desc = '';
      if (isPending) {
        desc = data.result.summary || 'In progress...';
      } else {
        desc = totalIssues === 0 ? '✅ Clean' : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} (${criticalCount} crit)`;
      }

      super(title, data.isLatest || isPending ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      this.data = data;
      this.description = desc;
      this.iconPath = new vscode.ThemeIcon('history');
      this.contextValue = 'reviewHistory';
      if (data.result.markdownReport && data.result.status !== 'pending') {
        this.command = {
          command: 'aiReview.openHistoryReport',
          title: 'Open Report',
          arguments: [data.result, data.timestamp]
        };
      }
    } else if (data.kind === 'file') {
      const basename = data.filePath.split(/[/\\]/).pop() ?? data.filePath;
      super(basename, vscode.TreeItemCollapsibleState.Expanded);
      this.data = data;
      const isGenerating = data.result.status === 'pending' && data.filePath === Object.keys(data.result.fileReports || {}).pop();
      if (isGenerating) {
        this.description = '⏳ Processing...';
        this.iconPath = new vscode.ThemeIcon('loading~spin');
      } else {
        this.description = data.issues.length === 0 ? '✅ Clean' : `${data.issues.length} issue${data.issues.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('file-code');
      }
      this.tooltip = data.filePath;
      this.contextValue = 'issueFile';

      if (data.result && data.result.fileReports && data.result.fileReports[data.filePath]) {
        this.command = {
          command: 'aiReview.openFileReport',
          title: 'Open File Report',
          arguments: [data.result, data.timestamp, data.filePath]
        };
      }
    } else if (data.kind === 'issue') {
      const { issue } = data;
      const lineStr = issue.line > 0 ? `[L${issue.line}] ` : '';
      super(`${lineStr}${issue.message}`, vscode.TreeItemCollapsibleState.None);
      this.data = data;
      this.description = issue.severity;
      this.tooltip = issue.suggestion
        ? `${issue.message}\n\nSuggestion: ${issue.suggestion}`
        : issue.message;
      this.iconPath = severityIcon(issue.severity);
      this.contextValue = 'issue';
      this.command = {
        command: 'aiReview.sidebar.goToIssue',
        title: 'Go to Issue',
        arguments: [issue],
      };
    } else {
      super(data.text, vscode.TreeItemCollapsibleState.None);
      this.data = data;
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}

function severityIcon(severity: ReviewIssue['severity']): vscode.ThemeIcon {
  switch (severity) {
    case 'critical': return new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
    case 'warning':  return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    case 'info':     return new vscode.ThemeIcon('info');
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class IssuesTreeProvider implements vscode.TreeDataProvider<IssueTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IssueTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private history: { timestamp: number; result: ReviewResult }[] = [];
  private static readonly STORAGE_KEY = 'aiReview.history';

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored = this.context.workspaceState.get<{ timestamp: number; result: ReviewResult }[]>(IssuesTreeProvider.STORAGE_KEY);
    if (stored && Array.isArray(stored)) {
      this.history = stored.filter(h => h.result.status !== 'pending');
    }
  }

  private saveHistory(): void {
    this.context.workspaceState.update(IssuesTreeProvider.STORAGE_KEY, this.history);
  }

  startReview(label: string, category?: string): void {
    this.history.unshift({
      timestamp: Date.now(),
      result: {
        issues: [],
        summary: 'Starting review...',
        contextFilesRead: [],
        suppressedCount: 0,
        status: 'pending',
        label: label,
        reviewCategory: category as any
      }
    });
    if (this.history.length > 50) {
      this.history.pop();
    }
    this._onDidChangeTreeData.fire();
  }

  updateReview(partialResult: Partial<ReviewResult>): void {
    if (this.history.length === 0 || this.history[0].result.status !== 'pending') return;
    const current = this.history[0].result;
    this.history[0].result = { ...current, ...partialResult };
    this._onDidChangeTreeData.fire();
  }

  /** Called by ReviewEngine after each completed run (or update). */
  setResult(result: ReviewResult | undefined): void {
    if (result) {
      if (this.history.length > 0 && this.history[0].result.status === 'pending') {
         // Replace pending review
         this.history[0].result = { ...result, status: 'completed' } as ReviewResult;
      } else {
         this.history.unshift({ timestamp: Date.now(), result: { ...result, status: 'completed' } as ReviewResult });
      }
      if (this.history.length > 50) {
        this.history.pop();
      }
    } else {
      this.history = [];
    }
    this.saveHistory();
    this._onDidChangeTreeData.fire();
  }

  deleteHistoryEntry(timestamp: number): void {
    this.history = this.history.filter(h => h.timestamp !== timestamp);
    this.saveHistory();
    this._onDidChangeTreeData.fire();
  }

  clearHistory(): void {
    this.history = [];
    this.saveHistory();
    this._onDidChangeTreeData.fire();
  }

  getResult(): ReviewResult | undefined {
    return this.history.length > 0 ? this.history[0].result : undefined;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: IssueTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: IssueTreeItem): IssueTreeItem[] {
    if (!element) {
      // Root: display history entries
      if (this.history.length === 0) {
        return [
          new IssueTreeItem({
            kind: 'empty',
            text: 'No reviews yet — run a review',
          }),
        ];
      }
      return this.history.map((entry, index) => 
        new IssueTreeItem({
          kind: 'history',
          timestamp: entry.timestamp,
          result: entry.result,
          isLatest: index === 0
        })
      );
    }

    if (element.data.kind === 'history') {
      return this.buildFileGroups(element.data.result, element.data.timestamp);
    }

    if (element.data.kind === 'file') {
      // Children of a file group: sorted critical → warning → info
      const sorted = [...element.data.issues].sort(
        (a, b) => severityOrder(a.severity) - severityOrder(b.severity)
      );
      return sorted.map((issue) => new IssueTreeItem({ kind: 'issue', issue }));
    }

    return [];
  }

  private buildFileGroups(result: ReviewResult, timestamp: number): IssueTreeItem[] {
    const filePaths = new Set<string>();
    
    // Add files that have issues
    for (const issue of result.issues) {
      filePaths.add(issue.filePath);
    }
    
    // Add files that were reviewed even if they have 0 issues
    if (result.fileReports) {
      for (const filePath of Object.keys(result.fileReports)) {
        filePaths.add(filePath);
      }
    }

    if (filePaths.size === 0) {
      const isPending = result.status === 'pending';
      const placeholder = new IssueTreeItem({ 
        kind: 'empty', 
        text: isPending ? '⏳ Reviewing files...' : '✅ No issues found in this review' 
      });
      placeholder.iconPath = isPending ? new vscode.ThemeIcon('loading~spin') : new vscode.ThemeIcon('pass');
      return [placeholder];
    }

    const byFile = new Map<string, ReviewIssue[]>();
    for (const path of filePaths) {
      byFile.set(path, []);
    }
    
    for (const issue of result.issues) {
      byFile.get(issue.filePath)!.push(issue);
    }

    return Array.from(byFile.entries()).map(
      ([filePath, issues]) => new IssueTreeItem({ kind: 'file', filePath, issues, result, timestamp })
    );
  }
}
function severityOrder(s: ReviewIssue['severity']): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
}
