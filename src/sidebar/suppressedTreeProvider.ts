import * as vscode from 'vscode';
import type { SuppressedEntry } from '../types';
import type { SuppressionStore } from '../review/suppressionStore';

export class SuppressedIssueItem extends vscode.TreeItem {
  constructor(public readonly entry: SuppressedEntry, showPath: boolean = true) {
    const lineStr = entry.line && entry.line > 0 ? `L${entry.line}` : '';
    const label = entry.message.split('\n')[0]; // Use first line of message
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = showPath 
        ? vscode.workspace.asRelativePath(entry.filePath) + (lineStr ? `:${lineStr}` : '')
        : lineStr;
    
    this.tooltip = `Issue: ${entry.message}\nFile: ${entry.filePath}\nSuppressed: ${new Date(entry.suppressedAt).toLocaleString()}\nScope: ${entry.scope}`;
    this.contextValue = 'suppressedIssue';
    this.iconPath = new vscode.ThemeIcon('mute');
  }
}

export class SuppressedScopeItem extends vscode.TreeItem {
  constructor(
    public readonly scope: SuppressedEntry['scope'],
    public readonly entries: SuppressedEntry[]
  ) {
    const label = scope.charAt(0).toUpperCase() + scope.slice(1);
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'suppressionScope';
    this.iconPath = this.getScopeIcon(scope);
    this.description = `${entries.length} issues`;
  }

  private getScopeIcon(scope: SuppressedEntry['scope']): vscode.ThemeIcon {
    switch (scope) {
      case 'file': return new vscode.ThemeIcon('list-flat');
      case 'workspace': return new vscode.ThemeIcon('database');
      case 'global': return new vscode.ThemeIcon('globe');
    }
  }
}

export class SuppressedFileGroupItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly entries: SuppressedEntry[]
  ) {
    const label = vscode.workspace.asRelativePath(filePath);
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'suppressedFileGroup';
    this.iconPath = new vscode.ThemeIcon('file');
    this.description = `${entries.length} issues`;
  }
}

export class SuppressedTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly suppressionStore: SuppressionStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const entries = this.suppressionStore.getAllEntries();
      if (entries.length === 0) {
        return [new vscode.TreeItem('No suppressed issues', vscode.TreeItemCollapsibleState.None)];
      }

      const scopes: SuppressedEntry['scope'][] = ['file', 'workspace', 'global'];
      return scopes
        .map(scope => {
          const scopeEntries = entries.filter(e => e.scope === scope);
          return scopeEntries.length > 0 ? new SuppressedScopeItem(scope, scopeEntries) : null;
        })
        .filter((item): item is SuppressedScopeItem => item !== null);
    }

    if (element instanceof SuppressedScopeItem) {
      if (element.scope === 'file') {
        const byFile = new Map<string, SuppressedEntry[]>();
        for (const entry of element.entries) {
          if (!byFile.has(entry.filePath)) byFile.set(entry.filePath, []);
          byFile.get(entry.filePath)!.push(entry);
        }
        return Array.from(byFile.entries()).map(([path, entries]) => new SuppressedFileGroupItem(path, entries));
      }
      return element.entries.map(e => new SuppressedIssueItem(e, true));
    }

    if (element instanceof SuppressedFileGroupItem) {
      return element.entries.map(e => new SuppressedIssueItem(e, false));
    }

    return [];
  }
}
