import * as path from 'path';
import * as vscode from 'vscode';
import { ProfileManager } from '../profiles/profileManager';
import { SecretsManager } from '../providers/secretsManager';
import type { ReviewIssue } from '../types';
import { IssuesTreeProvider, IssueTreeItem } from './issuesTreeProvider';
import { GitChangesTreeProvider, GitChangeItem } from './gitChangesTreeProvider';
import { SuppressedTreeProvider } from './suppressedTreeProvider';
import { SettingsPanel } from './settingsPanel';
import { DecorationsManager } from '../output/decorationsManager';
import { SuppressionStore } from '../review/suppressionStore';

export class SidebarController implements vscode.Disposable {
  readonly issuesTree: IssuesTreeProvider;
  readonly gitChangesTree: GitChangesTreeProvider;
  readonly suppressedTree: SuppressedTreeProvider;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly secrets: SecretsManager,
    private readonly context: vscode.ExtensionContext,
    private readonly decorations: DecorationsManager,
    private readonly suppressionStore: SuppressionStore
  ) {
    this.issuesTree = new IssuesTreeProvider(context, suppressionStore);
    this.gitChangesTree = new GitChangesTreeProvider();
    this.suppressedTree = new SuppressedTreeProvider(suppressionStore);
    this.register();
  }

  private register(): void {
    const { context: ctx } = this;

    // ── Tree providers ────────────────────────────────────────────────────────
    this.disposables.push(
      vscode.window.registerTreeDataProvider('aiReview.issuesTree', this.issuesTree),
      vscode.window.registerTreeDataProvider('aiReview.suppressedTree', this.suppressedTree),
      vscode.window.createTreeView('aiReview.gitChanges', {
        treeDataProvider: this.gitChangesTree,
        canSelectMany: true,
      })
    );

    // ── Commands ──────────────────────────────────────────────────────────────
    this.disposables.push(
      // Open main settings page
      vscode.commands.registerCommand('aiReview.openSettings', () => {
        SettingsPanel.createOrShow(this.context.extensionUri, this.profileManager, this.secrets);
      }),

      // Refresh trees (called from settings or elsewhere)
      vscode.commands.registerCommand('aiReview.sidebar.refreshTree', () => {
        this.issuesTree.refresh();
        this.gitChangesTree.refresh();
        this.suppressedTree.refresh();
      }),

      // Go to issue line in editor
      vscode.commands.registerCommand('aiReview.sidebar.goToIssue', async (issue: ReviewIssue) => {
        if (!issue.filePath || issue.filePath === 'Git Diff') return;
        const uri = vscode.Uri.file(issue.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const line = Math.max(0, issue.line - 1);
        const pos = new vscode.Position(line, 1);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }),

      // Clear issues tree
      vscode.commands.registerCommand('aiReview.sidebar.clearIssues', () => {
        this.issuesTree.clearHistory();
      }),

      vscode.commands.registerCommand('aiReview.sidebar.unsuppress', async (item: any) => {
        if (!item || !item.entry) return;
        await this.suppressionStore.unsuppress(item.entry.issueId);
        this.issuesTree.refresh();
        this.suppressedTree.refresh();
        this.refreshCurrentDecorations();
        vscode.window.setStatusBarMessage(`Unsuppressed: ${item.entry.message}`, 3000);
      }),

      // Clear all suppressed issues
      vscode.commands.registerCommand('aiReview.sidebar.clearSuppressed', async () => {
        const confirm = await vscode.window.showWarningMessage(
          'Really clear ALL suppressed issues? This cannot be undone.',
          { modal: true },
          'Clear All'
        );
        if (confirm === 'Clear All') {
          await this.suppressionStore.clearAll();
          this.issuesTree.refresh();
          this.suppressedTree.refresh();
          this.refreshCurrentDecorations();
          vscode.window.showInformationMessage('All suppressed issues cleared.');
        }
      }),

      // Save review summary
      vscode.commands.registerCommand('aiReview.sidebar.saveReviewSummary', async (item: IssueTreeItem) => {
        if (!item || item.data.kind !== 'history') return;
        const result = item.data.result;
        if (!result.summary) {
          vscode.window.showInformationMessage('No summary available for this review.');
          return;
        }

        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('review-summary.md'),
          filters: { 'Markdown': ['md'], 'Text': ['txt'] }
        });

        if (saveUri) {
          const content = result.markdownReport || result.summary;
          await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content));
          vscode.window.showInformationMessage(`Review summary saved to ${saveUri.fsPath}`);
        }
      }),

      // Toggle grouping by severity
      vscode.commands.registerCommand('aiReview.sidebar.toggleGrouping', () => {
        this.issuesTree.toggleGrouping();
      }),

      // Consolidate suppressIssue command here for better control over sidebar refresh
      vscode.commands.registerCommand('aiReview.suppressIssue', async (args: any) => {
        let issueId: string | undefined;
        let issue: ReviewIssue | undefined;

        if (args && typeof args.issueId === 'string') {
          issueId = args.issueId;
        } else if (args && args.data && args.data.kind === 'issue' && args.data.issue) {
          issue = args.data.issue;
          issueId = (issue as ReviewIssue).id;
        }

        if (!issueId) {
          vscode.window.showErrorMessage('Could not find issue to suppress.');
          return;
        }

        if (!issue) {
          issue = this.issuesTree.getIssueById(issueId);
        }

        if (!issue) {
          // Fallback to decorations manager if not found in sidebar history
          issue = this.decorations.getIssue(issueId);
        }

        if (!issue) {
          vscode.window.showErrorMessage('Could not find issue details.');
          return;
        }

        const config = vscode.workspace.getConfiguration('aiReview');
        const defaultScope = config.get<string>('suppressionScope', 'workspace');

        const scopePick = await vscode.window.showQuickPick(
          [
            { label: '$(file) This File', scope: 'file' },
            { label: '$(folder) This Workspace', scope: 'workspace' },
            { label: '$(globe) Global (all workspaces)', scope: 'global' },
          ],
          {
            title: 'Suppress Issue — Choose Scope',
            placeHolder: `Default: ${defaultScope}`,
          }
        );
        if (!scopePick) return;

        // At this point issue is guaranteed to be defined because of the checks above
        const issueToSuppress = issue as ReviewIssue;

        await this.suppressionStore.suppress(issueToSuppress, scopePick.scope as any);
        
        // Refresh all relevant parts
        this.decorations.removeIssue(issueToSuppress.id);
        this.issuesTree.refresh();
        this.suppressedTree.refresh();
        
        // Notify user
        vscode.window.setStatusBarMessage(`Issue suppressed (${scopePick.scope})`, 4000);
      }),

      // Delete history entry
      vscode.commands.registerCommand('aiReview.sidebar.deleteHistoryEntry', async (item: IssueTreeItem) => {
        if (!item || item.data.kind !== 'history') return;
        const confirm = await vscode.window.showWarningMessage(
          `Delete review history for "${item.label}"?`,
          { modal: true },
          'Delete'
        );
        if (confirm === 'Delete') {
          this.issuesTree.deleteHistoryEntry(item.data.timestamp);
        }
      }),

      // Re-apply decorations for a file
      vscode.commands.registerCommand('aiReview.sidebar.reapplyFileDecorations', async (item: IssueTreeItem) => {
        if (!item || item.data.kind !== 'file') return;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const fsPath = path.isAbsolute(item.data.filePath) 
          ? item.data.filePath 
          : path.resolve(workspaceRoot, item.data.filePath);
        
        this.decorations.setFileDiagnostics(fsPath, item.data.issues);
        vscode.window.setStatusBarMessage(`Re-applied ${item.data.issues.length} decorations to ${path.basename(fsPath)}`, 3000);
      }),

      // Clear decorations for a file
      vscode.commands.registerCommand('aiReview.sidebar.clearFileDecorations', async (item: IssueTreeItem) => {
        if (!item || item.data.kind !== 'file') return;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const fsPath = path.isAbsolute(item.data.filePath) 
          ? item.data.filePath 
          : path.resolve(workspaceRoot, item.data.filePath);
        
        this.decorations.clearFile(fsPath);
        vscode.window.setStatusBarMessage(`Cleared decorations from ${path.basename(fsPath)}`, 3000);
      })
    );

    ctx.subscriptions.push(...this.disposables);
  }

  private refreshCurrentDecorations() {
    const result = this.issuesTree.getVisibleResult();
    if (!result) return;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const unsuppressed = result.issues.filter(i => !this.suppressionStore.isSuppressed(i.id));
    this.decorations.applyResult({ ...result, issues: unsuppressed }, workspaceRoot);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
