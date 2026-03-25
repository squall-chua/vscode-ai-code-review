import * as vscode from 'vscode';
import { ProfileManager } from '../profiles/profileManager';
import { SecretsManager } from '../providers/secretsManager';
import type { ReviewIssue } from '../types';
import { IssuesTreeProvider, IssueTreeItem } from './issuesTreeProvider';
import { SettingsPanel } from './settingsPanel';

export class SidebarController implements vscode.Disposable {
  readonly issuesTree: IssuesTreeProvider;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly secrets: SecretsManager,
    private readonly context: vscode.ExtensionContext
  ) {
    this.issuesTree = new IssuesTreeProvider(context);
    this.register();
  }

  private register(): void {
    const { context: ctx } = this;

    // ── Tree providers ────────────────────────────────────────────────────────
    this.disposables.push(
      vscode.window.registerTreeDataProvider('aiReview.issuesTree', this.issuesTree)
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
      })
    );

    ctx.subscriptions.push(...this.disposables);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
