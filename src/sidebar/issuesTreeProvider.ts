import * as vscode from 'vscode';
import type { ReviewResult, ReviewIssue, ReviewCategory } from '../types';
import type { SuppressionStore } from '../review/suppressionStore';

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
      if (data.result.reviewCategory && typeof data.result.reviewCategory === 'string' && data.result.reviewCategory !== 'general') {
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
  private groupBySeverity: boolean = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly suppressionStore: SuppressionStore
  ) {
    const stored = this.context.workspaceState.get<{ timestamp: number; result: ReviewResult }[]>(IssuesTreeProvider.STORAGE_KEY);
    if (stored && Array.isArray(stored)) {
      this.history = stored.filter(h => h.result.status !== 'pending');
    }
  }

  private saveHistory(): void {
    this.context.workspaceState.update(IssuesTreeProvider.STORAGE_KEY, this.history);
  }

  startReview(label: string, category?: ReviewCategory): void {
    this.history.unshift({
      timestamp: Date.now(),
      result: {
        issues: [],
        summary: 'Starting review...',
        contextFilesRead: [],
        suppressedCount: 0,
        status: 'pending',
        label: label,
        reviewCategory: category
      }
    });
    if (this.history.length > 50) {
      this.history.pop();
    }
    this._onDidChangeTreeData.fire();
  }

  getIssueById(issueId: string): ReviewIssue | undefined {
    for (const h of this.history) {
      const issue = h.result.issues.find((i) => i.id === issueId);
      if (issue) return issue;
    }
    return undefined;
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

  getVisibleResult(): ReviewResult | undefined {
    return this.history[0]?.result;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  toggleGrouping(): void {
    this.groupBySeverity = !this.groupBySeverity;
    this.refresh();
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
      if (this.groupBySeverity) {
        return this.buildSeverityGroups(element.data.result, element.data.timestamp);
      }
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
    
    // 1. Identify all files involved in the review
    if (result.fileReports) {
      Object.keys(result.fileReports).forEach(p => filePaths.add(p));
    }
    result.issues.forEach(i => filePaths.add(i.filePath));

    // 2. Group non-suppressed issues by file
    const byFile = new Map<string, ReviewIssue[]>();
    filePaths.forEach(p => byFile.set(p, []));

    for (const issue of result.issues) {
      if (this.suppressionStore.isSuppressed(issue.id)) continue;
      byFile.get(issue.filePath)?.push(issue);
    }

    // 3. Filter out files that have no unsuppressed issues AND were not explicitly coached as having 0 issues
    // Actually, usually we show all reviewed files if they are in result.fileReports
    const items = Array.from(byFile.entries())
      .map(([filePath, issues]) => new IssueTreeItem({ kind: 'file', filePath, issues, result, timestamp }))
      .filter(item => {
          if (item.data.kind === 'file') {
              return item.data.issues.length > 0 || (!!result.fileReports && !!result.fileReports[item.data.filePath]);
          }
          return true;
      });

    if (items.length === 0) {
      const isPending = result.status === 'pending';
      const placeholder = new IssueTreeItem({ 
        kind: 'empty', 
        text: isPending ? '⏳ Reviewing files...' : '✅ No issues found in this review' 
      });
      placeholder.iconPath = isPending ? new vscode.ThemeIcon('loading~spin') : new vscode.ThemeIcon('pass');
      return [placeholder];
    }

    return items;
  }

  private buildSeverityGroups(result: ReviewResult, timestamp: number): IssueTreeItem[] {
    const severities: ReviewIssue['severity'][] = ['critical', 'warning', 'info'];
    const groups: Map<string, ReviewIssue[]> = new Map();

    for (const sev of severities) groups.set(sev, []);

    for (const issue of result.issues) {
      if (this.suppressionStore.isSuppressed(issue.id)) continue;
      groups.get(issue.severity)?.push(issue);
    }

    return severities
      .filter((sev) => groups.get(sev)!.length > 0)
      .map((sev) => {
        const issues = groups.get(sev)!;
        const item = new IssueTreeItem({ 
           kind: 'file', 
           filePath: `[${sev.toUpperCase()}]`, 
           issues, 
           result, 
           timestamp 
        });
        item.label = sev.toUpperCase();
        item.description = `${issues.length} issue${issues.length !== 1 ? 's' : ''}`;
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        item.contextValue = 'severityGroup';
        item.iconPath = severityIcon(sev);
        return item;
      });
  }
}
function severityOrder(s: ReviewIssue['severity']): number {
  return s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
}
