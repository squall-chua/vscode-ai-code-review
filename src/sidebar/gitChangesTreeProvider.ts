import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import { ReviewIgnoreManager } from '../review/ignoreManager';

type ChangeType = 'staged' | 'unstaged' | 'lastCommit' | 'file';

export class GitChangeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: ChangeType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly filePath?: string,
    public readonly gitState?: 'staged' | 'unstaged' | 'lastCommit'
  ) {
    super(label, collapsibleState);
    
    if (type === 'file') {
      this.iconPath = new vscode.ThemeIcon('file');
      this.resourceUri = vscode.Uri.file(filePath!);
      this.contextValue = 'gitFileChange';
      
      // Add command to review this specific file change
      this.command = {
        command: 'aiReview.openGitDiff',
        title: 'Open Diff',
        arguments: [filePath, gitState]
      };
    } else {
      if (type === 'staged') this.iconPath = new vscode.ThemeIcon('git-pull-request-create');
      if (type === 'unstaged') this.iconPath = new vscode.ThemeIcon('git-pull-request-draft');
      if (type === 'lastCommit') this.iconPath = new vscode.ThemeIcon('git-commit');
      this.contextValue = `gitGroup_${type}`;
    }
  }
}

export class GitChangesTreeProvider implements vscode.TreeDataProvider<GitChangeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GitChangeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: GitChangeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: GitChangeItem): Promise<GitChangeItem[]> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      if (!element) {
        return [new GitChangeItem('No workspace open', 'unstaged', vscode.TreeItemCollapsibleState.None)];
      }
      return [];
    }

    if (!element) {
      return [
        new GitChangeItem('Staged Changes', 'staged', vscode.TreeItemCollapsibleState.Expanded),
        new GitChangeItem('Unstaged Changes', 'unstaged', vscode.TreeItemCollapsibleState.Expanded),
        new GitChangeItem('Last Commit', 'lastCommit', vscode.TreeItemCollapsibleState.Collapsed),
      ];
    }

    try {
      const ignoreManager = ReviewIgnoreManager.getInstance();

      if (element.type === 'staged') {
        const files = this.getGitFiles('git diff --cached --name-only', workspaceRoot);
        const filtered = [];
        for (const f of files) {
          if (!ignoreManager.shouldIgnore(path.join(workspaceRoot, f))) {
            filtered.push(new GitChangeItem(path.basename(f), 'file', vscode.TreeItemCollapsibleState.None, path.join(workspaceRoot, f), 'staged'));
          }
        }
        return filtered;
      }
      if (element.type === 'unstaged') {
        const modified = this.getGitFiles('git diff --name-only', workspaceRoot);
        const untracked = this.getGitFiles('git ls-files --others --exclude-standard', workspaceRoot);
        const all = Array.from(new Set([...modified, ...untracked]));
        const filtered = [];
        for (const f of all) {
          if (!ignoreManager.shouldIgnore(path.join(workspaceRoot, f))) {
            filtered.push(new GitChangeItem(path.basename(f), 'file', vscode.TreeItemCollapsibleState.None, path.join(workspaceRoot, f), 'unstaged'));
          }
        }
        return filtered;
      }
      if (element.type === 'lastCommit') {
        const files = this.getGitFiles('git show --name-only --pretty="" HEAD', workspaceRoot);
        const filtered = [];
        for (const f of files) {
          if (!ignoreManager.shouldIgnore(path.join(workspaceRoot, f))) {
            filtered.push(new GitChangeItem(path.basename(f), 'file', vscode.TreeItemCollapsibleState.None, path.join(workspaceRoot, f), 'lastCommit'));
          }
        }
        return filtered;
      }
    } catch (err) {
      return [new GitChangeItem('Error loading git changes', 'unstaged', vscode.TreeItemCollapsibleState.None)];
    }

    return [];
  }

  private getGitFiles(command: string, cwd: string): string[] {
    try {
      const output = execSync(command, { cwd, encoding: 'utf8' });
      return output.split('\n').filter(f => f.trim().length > 0);
    } catch {
      return [];
    }
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  }
}
