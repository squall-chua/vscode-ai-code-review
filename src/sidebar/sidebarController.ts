import * as path from 'path';
import * as vscode from 'vscode';
import { ProfileManager } from '../profiles/profileManager';
import { SecretsManager } from '../providers/secretsManager';
import type { ReviewIssue, SuppressionScope } from '../types';
import { IssuesTreeProvider, IssueTreeItem } from './issuesTreeProvider';
import { GitChangesTreeProvider } from './gitChangesTreeProvider';
import { SuppressedTreeProvider, SuppressedTreeItem } from './suppressedTreeProvider';
import { SettingsPanel } from './settingsPanel';
import { DecorationsManager } from '../output/decorationsManager';
import { SuppressionStore } from '../review/suppressionStore';
import { FixEngine } from '../fix/fixEngine';
import { ReviewResultsPanel } from '../results/reviewResultsPanel';


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
    private readonly suppressionStore: SuppressionStore,
    private readonly fixEngine: FixEngine
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
      vscode.window.createTreeView('aiReview.issuesTree', {
        treeDataProvider: this.issuesTree,
        canSelectMany: true,
      }),
      vscode.window.createTreeView('aiReview.suppressedTree', {
        treeDataProvider: this.suppressedTree,
        canSelectMany: true,
      }),
      vscode.window.createTreeView('aiReview.gitChanges', {
        treeDataProvider: this.gitChangesTree,
        canSelectMany: true,
      }),

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

      vscode.commands.registerCommand('aiReview.sidebar.unsuppress', async (firstArg: IssueTreeItem | SuppressedTreeItem | string, allSelected?: (IssueTreeItem | SuppressedTreeItem)[]) => {
        const items = Array.isArray(allSelected) && allSelected.length > 0 ? allSelected : [firstArg];
        const issueIdsToUnsuppress = new Set<string>();
        let lastItemLabel = '';

        for (const item of items) {
          if (!(item instanceof SuppressedTreeItem)) continue;
          const { data } = item;

          if (data.kind === 'issue') {
            issueIdsToUnsuppress.add(data.entry.issueId);
            lastItemLabel = data.entry.message.split('\n')[0];
          } else if (data.kind === 'file' || data.kind === 'scope') {
            for (const entry of data.entries) {
              issueIdsToUnsuppress.add(entry.issueId);
            }
          }
        }

        if (issueIdsToUnsuppress.size === 0) return;

        for (const id of issueIdsToUnsuppress) {
          await this.suppressionStore.unsuppress(id);
        }

        this.issuesTree.refresh();
        this.suppressedTree.refresh();
        this.refreshCurrentDecorations();
        ReviewResultsPanel.refreshCurrent();

        if (issueIdsToUnsuppress.size === 1) {
          vscode.window.setStatusBarMessage(`Unsuppressed: ${lastItemLabel}`, 3000);
        } else {
          vscode.window.setStatusBarMessage(`Unsuppressed ${issueIdsToUnsuppress.size} issues`, 3000);
        }
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
          ReviewResultsPanel.refreshCurrent();
          void vscode.window.showInformationMessage('All suppressed issues cleared.');
        }
      }),

      // Save review summary
      vscode.commands.registerCommand('aiReview.sidebar.saveReviewSummary', async (item: IssueTreeItem) => {
        if (!item || item.data.kind !== 'history') return;
        const result = item.data.result;
        if (!result.summary) {
          void vscode.window.showInformationMessage('No summary available for this review.');
          return;
        }

        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('review-summary.md'),
          filters: { 'Markdown': ['md'], 'Text': ['txt'] }
        });

        if (saveUri) {
          const content = result.markdownReport || result.summary;
          await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content));
          void vscode.window.showInformationMessage(`Review summary saved to ${saveUri.fsPath}`);
        }
      }),

      // Toggle grouping by severity
      vscode.commands.registerCommand('aiReview.sidebar.toggleGrouping', () => {
        this.issuesTree.toggleGrouping();
      }),

      // Consolidate suppressIssue command here for better control over sidebar refresh
      vscode.commands.registerCommand('aiReview.suppressIssue', async (firstArg: IssueTreeItem | string | { issueId: string }, allSelected?: IssueTreeItem[]) => {
        const issuesToSuppress: ReviewIssue[] = [];

        // Helper to collect issues from tree items
        const collectFromItem = (item: IssueTreeItem) => {
          if (!item || !item.data) return;
          if (item.data.kind === 'issue' && item.data.issue) {
            issuesToSuppress.push(item.data.issue);
          } else if (item.data.kind === 'file' && Array.isArray(item.data.issues)) {
            issuesToSuppress.push(...item.data.issues);
          } else if (item.data.kind === 'history' && item.data.result && Array.isArray(item.data.result.issues)) {
            issuesToSuppress.push(...item.data.result.issues);
          }
        };

        // Handle multiple selection from sidebar
        if (Array.isArray(allSelected) && allSelected.length > 0) {
          for (const item of allSelected) {
            collectFromItem(item);
          }
        }
        // Handle single selection from sidebar
        else if (firstArg instanceof IssueTreeItem) {
          collectFromItem(firstArg);
        }
        // Handle direct ID from decorations or webview
        else if (typeof firstArg === 'string') {
          const issue = this.decorations.getIssue(firstArg) || this.issuesTree.getIssueById(firstArg);
          if (issue) {
            issuesToSuppress.push(issue);
          }
        }
        else if (firstArg && typeof firstArg === 'object' && 'issueId' in firstArg) {
          const issue = this.decorations.getIssue(firstArg.issueId) || this.issuesTree.getIssueById(firstArg.issueId);
          if (issue) {
            issuesToSuppress.push(issue);
          }
        }

        // Deduplicate issues by ID
        const uniqueIssues = Array.from(new Map(issuesToSuppress.map(i => [i.id, i])).values());
        issuesToSuppress.length = 0;
        issuesToSuppress.push(...uniqueIssues);

        if (issuesToSuppress.length === 0) {
          void vscode.window.showErrorMessage('Could not find any issues to suppress.');
          return;
        }

        // Handle toggle: if single issue and already suppressed, unsuppress it
        if (issuesToSuppress.length === 1 && this.suppressionStore.isSuppressed(issuesToSuppress[0].id)) {
          await this.suppressionStore.unsuppress(issuesToSuppress[0].id);
          this.issuesTree.refresh();
          this.suppressedTree.refresh();
          ReviewResultsPanel.refreshCurrent();
          this.refreshCurrentDecorations();
          void vscode.window.showInformationMessage(`Unsuppressed: ${issuesToSuppress[0].id}`);
          return;
        }

        const scopePick = await vscode.window.showQuickPick(
          [
            { label: 'File', description: 'Suppress in this specific file', scope: 'file' },
            { label: 'Workspace', description: 'Suppress in this workspace', scope: 'workspace' },
            { label: 'Global', description: 'Suppress for all projects', scope: 'global' },
          ],
          { placeHolder: `Suppress ${issuesToSuppress.length} ${issuesToSuppress.length === 1 ? 'issue' : 'issues'} at which scope?` }
        );

        if (!scopePick) return;

        for (const issueToSuppress of issuesToSuppress) {
          await this.suppressionStore.suppress(issueToSuppress, scopePick.scope as SuppressionScope);
          this.decorations.removeIssue(issueToSuppress.id);
        }

        this.issuesTree.refresh();
        this.suppressedTree.refresh();
        ReviewResultsPanel.refreshCurrent();

        void vscode.window.showInformationMessage(
          `Suppressed ${issuesToSuppress.length} ${issuesToSuppress.length === 1 ? 'issue' : 'issues'}.`
        );
      }),

      // Copy fix prompt for selected issues
      vscode.commands.registerCommand('aiReview.copyFixPrompt', async (firstArg: IssueTreeItem | string | { issueId: string }, allSelected?: IssueTreeItem[]) => {
        const issuesToFix: Array<{ issue: ReviewIssue; document: vscode.TextDocument }> = [];

        // Helper to get document for an issue
        const getDoc = async (issue: ReviewIssue): Promise<vscode.TextDocument | undefined> => {
          if (!issue.filePath || issue.filePath === 'Git Diff') return undefined;
          try {
            return await vscode.workspace.openTextDocument(vscode.Uri.file(issue.filePath));
          } catch (e) {
            console.error('Failed to open document for fix prompt:', e);
            return undefined;
          }
        };

        // Collect all target issues
        const targetIssues: ReviewIssue[] = [];

        const collectFromItem = (item: IssueTreeItem) => {
          if (!item || !item.data) return;
          if (item.data.kind === 'issue' && item.data.issue) {
            targetIssues.push(item.data.issue);
          } else if (item.data.kind === 'file' && Array.isArray(item.data.issues)) {
            targetIssues.push(...item.data.issues);
          } else if (item.data.kind === 'history' && item.data.result && Array.isArray(item.data.result.issues)) {
            targetIssues.push(...item.data.result.issues);
          }
        };

        // Handle multiple selection from sidebar
        if (Array.isArray(allSelected) && allSelected.length > 0) {
          for (const item of allSelected) {
            collectFromItem(item);
          }
        }
        // Handle single selection from sidebar
        else if (firstArg instanceof IssueTreeItem) {
          collectFromItem(firstArg);
        }
        // Handle direct call (e.g. from code action, hover, or webview)
        else if (typeof firstArg === 'string') {
          const issue = this.decorations.getIssue(firstArg) || this.issuesTree.getIssueById(firstArg);
          if (issue) {
            targetIssues.push(issue);
          }
        }
        else if (firstArg && typeof firstArg === 'object' && 'issueId' in firstArg) {
          const issue = this.decorations.getIssue(firstArg.issueId) || this.issuesTree.getIssueById(firstArg.issueId);
          if (issue) {
            targetIssues.push(issue);
          }
        }

        // Deduplicate and process
        const uniqueIssues = Array.from(new Map(targetIssues.map(i => [i.id, i])).values());
        for (const issue of uniqueIssues) {
          const doc = await getDoc(issue);
          if (doc) {
            issuesToFix.push({ issue, document: doc });
          }
        }

        if (issuesToFix.length === 0) {
          void vscode.window.showErrorMessage('No issues selected for fix prompt.');
          return;
        }

        void this.fixEngine.copyPrompt(issuesToFix);
      }),

      // Delete history entry
      vscode.commands.registerCommand('aiReview.sidebar.deleteHistoryEntry', async (item: IssueTreeItem) => {
        if (!item || item.data.kind !== 'history') return;
        const confirm = await vscode.window.showWarningMessage(
          `Delete review history for "${item.label instanceof Object ? item.label.label : (item.label ?? '')}"?`,
          { modal: true },
          'Delete'
        );
        if (confirm === 'Delete') {
          this.issuesTree.deleteHistoryEntry(item.data.timestamp);
        }
      }),

      // Re-apply decorations for a file
      vscode.commands.registerCommand('aiReview.sidebar.reapplyFileDecorations', (item: IssueTreeItem) => {
        if (!item || item.data.kind !== 'file') return;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const fsPath = path.isAbsolute(item.data.filePath)
          ? item.data.filePath
          : path.resolve(workspaceRoot, item.data.filePath);

        this.decorations.setFileDiagnostics(fsPath, item.data.issues);
        vscode.window.setStatusBarMessage(`Re-applied ${item.data.issues.length} decorations to ${path.basename(fsPath)}`, 3000);
      }),

      // Clear decorations for a file
      vscode.commands.registerCommand('aiReview.sidebar.clearFileDecorations', (item: IssueTreeItem) => {
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
