import * as vscode from 'vscode';
import type { SuppressedEntry } from '../types';
import type { SuppressionStore } from '../review/suppressionStore';

type SuppressedItemData =
  | { kind: 'scope'; scope: SuppressedEntry['scope']; entries: SuppressedEntry[]; }
  | { kind: 'file'; filePath: string; entries: SuppressedEntry[]; }
  | { kind: 'issue'; entry: SuppressedEntry; showPath: boolean; }
  | { kind: 'empty'; text: string; icon?: string; };

export class SuppressedTreeItem extends vscode.TreeItem {
  constructor(public readonly data: SuppressedItemData) {
    if (data.kind === 'scope') {
      const label = data.scope.charAt(0).toUpperCase() + data.scope.slice(1);
      super(label, vscode.TreeItemCollapsibleState.Expanded);
      this.iconPath = new vscode.ThemeIcon(
        data.scope === 'file' ? 'list-flat' : (data.scope === 'workspace' ? 'database' : 'globe')
      );
      this.contextValue = 'suppressionScope';
      this.description = `${data.entries.length} issues`;
      this.id = `suppressed-scope-${data.scope}`;
    } else if (data.kind === 'file') {
      const basename = data.filePath.split(/[/\\]/).pop() ?? data.filePath;
      super(basename, vscode.TreeItemCollapsibleState.Collapsed);
      this.iconPath = new vscode.ThemeIcon('file');
      this.contextValue = 'suppressedFileGroup';
      this.description = `${data.entries.length} issues`;
      this.tooltip = data.filePath;
      this.id = `suppressed-file-${data.filePath}`;
    } else if (data.kind === 'issue') {
      const { entry, showPath } = data;
      const firstLine = entry.message.split('\n')[0].trim();
      const lineStr = entry.line && entry.line > 0 ? `L${entry.line}: ` : '';
      const label = `${lineStr}${firstLine}`;
      
      super(label, vscode.TreeItemCollapsibleState.None);
      this.iconPath = new vscode.ThemeIcon('mute');
      this.contextValue = 'suppressedIssue';
      
      const description = showPath ? vscode.workspace.asRelativePath(entry.filePath) : '';
      this.description = description || undefined;
      
      this.tooltip = `Issue: ${entry.message}\nFile: ${entry.filePath}\nSuppressed: ${new Date(entry.suppressedAt).toLocaleString()}\nScope: ${entry.scope}`;
      
      // Add command to reveal the issue in editor
      const line = entry.line ?? 1;
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [
          vscode.Uri.file(entry.filePath),
          {
            selection: new vscode.Range(
              Math.max(0, line - 1), 0,
              Math.max(0, line - 1), 0
            )
          }
        ]
      };
      // No fixed ID for issues to avoid rendering glitches with dynamic data
    } else {
      super(data.text, vscode.TreeItemCollapsibleState.None);
      this.iconPath = new vscode.ThemeIcon(data.icon || 'info');
      this.contextValue = 'suppressedEmpty';
      this.id = 'suppressed-no-items';
    }
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

  getChildren(element?: SuppressedTreeItem): SuppressedTreeItem[] | Thenable<SuppressedTreeItem[]> {
    if (!element) {
      const entries = this.suppressionStore.getAllEntries();
      if (entries.length === 0) {
        return [new SuppressedTreeItem({ kind: 'empty', text: 'No suppressed issues' })];
      }

      const scopes: SuppressedEntry['scope'][] = ['file', 'workspace', 'global'];
      return scopes
        .map(scope => {
          const scopeEntries = entries.filter(e => e.scope === scope);
          return scopeEntries.length > 0 ? new SuppressedTreeItem({ kind: 'scope', scope, entries: scopeEntries }) : null;
        })
        .filter((item): item is SuppressedTreeItem => item !== null);
    }

    const { data } = element;

    if (data.kind === 'scope') {
      if (data.scope === 'file') {
        const byFile = new Map<string, SuppressedEntry[]>();
        for (const entry of data.entries) {
          if (!byFile.has(entry.filePath)) byFile.set(entry.filePath, []);
          byFile.get(entry.filePath)!.push(entry);
        }
        return Array.from(byFile.entries()).map(([filePath, entries]) => 
          new SuppressedTreeItem({ kind: 'file', filePath, entries })
        );
      }
      return data.entries.map(entry => 
        new SuppressedTreeItem({ kind: 'issue', entry, showPath: true })
      );
    }

    if (data.kind === 'file') {
      return data.entries.map(entry => 
        new SuppressedTreeItem({ kind: 'issue', entry, showPath: false })
      );
    }

    return [];
  }
}
