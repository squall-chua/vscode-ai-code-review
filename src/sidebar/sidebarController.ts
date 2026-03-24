import * as vscode from 'vscode';
import type { ProfileManager } from '../profiles/profileManager';
import type { SecretsManager } from '../providers/secretsManager';
import type { ReviewIssue } from '../types';
import { ProfilesTreeProvider, ConfigTreeProvider } from './sidebarTreeProvider';
import { IssuesTreeProvider, IssueTreeItem } from './issuesTreeProvider';
import { ProfileFormPanel } from './profileFormPanel';

export class SidebarController implements vscode.Disposable {
  readonly profilesTree: ProfilesTreeProvider;
  readonly configTree: ConfigTreeProvider;
  readonly issuesTree: IssuesTreeProvider;
  readonly profileForm: ProfileFormPanel;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly secrets: SecretsManager,
    private readonly context: vscode.ExtensionContext
  ) {
    this.profilesTree = new ProfilesTreeProvider(profileManager);
    this.configTree = new ConfigTreeProvider();
    this.issuesTree = new IssuesTreeProvider(context);
    this.profileForm = new ProfileFormPanel(profileManager, secrets, () => {
      this.profilesTree.refresh();
    });

    this.register();
  }

  private register(): void {
    const { context: ctx } = this;

    // ── Tree providers ────────────────────────────────────────────────────────
    this.disposables.push(
      vscode.window.registerTreeDataProvider('aiReview.issuesTree', this.issuesTree),
      vscode.window.registerTreeDataProvider('aiReview.profilesTree', this.profilesTree),
      vscode.window.registerTreeDataProvider('aiReview.configTree', this.configTree)
    );

    // ── Webview form ──────────────────────────────────────────────────────────
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(ProfileFormPanel.viewId, this.profileForm)
    );

    // ── Commands ──────────────────────────────────────────────────────────────
    this.disposables.push(
      // Profile form — new
      vscode.commands.registerCommand('aiReview.sidebar.newProfile', () => {
        this.profileForm.open(undefined);
      }),

      // Profile form — edit (called with profile id from tree item context menu)
      vscode.commands.registerCommand('aiReview.sidebar.editProfile', (profileId: string) => {
        const profile = this.profileManager.listProfiles().find((p) => p.id === profileId);
        if (profile) this.profileForm.open(profile);
      }),

      // Activate a profile by clicking its tree item
      vscode.commands.registerCommand('aiReview.sidebar.activateProfile', async (profileId: string) => {
        await this.profileManager.setActiveProfile(profileId);
        this.profilesTree.refresh();
        vscode.commands.executeCommand('aiReview.sidebar.updateStatusBar');
      }),

      // Delete profile (from tree context menu)
      vscode.commands.registerCommand('aiReview.sidebar.deleteProfile', async (profileId: string) => {
        const profile = this.profileManager.listProfiles().find((p) => p.id === profileId);
        if (!profile) return;
        const confirm = await vscode.window.showWarningMessage(
          `Delete profile "${profile.name}"?`,
          { modal: true },
          'Delete'
        );
        if (confirm !== 'Delete') return;
        await this.profileManager.deleteProfile(profileId);
        await this.secrets.deleteApiKey(profileId);
        this.profilesTree.refresh();
        vscode.window.showInformationMessage(`Profile "${profile.name}" deleted.`);
      }),

      // Go to issue line in editor
      vscode.commands.registerCommand('aiReview.sidebar.goToIssue', async (issue: ReviewIssue) => {
        if (!issue.filePath || issue.filePath === 'Git Diff') return;
        const uri = vscode.Uri.file(issue.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const line = Math.max(0, issue.line - 1);
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }),

      // Clear issues tree
      vscode.commands.registerCommand('aiReview.sidebar.clearIssues', () => {
        this.issuesTree.clearHistory();
      }),

      // Refresh all trees
      vscode.commands.registerCommand('aiReview.sidebar.refreshTree', () => {
        this.profilesTree.refresh();
        this.configTree.refresh();
        this.issuesTree.refresh();
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

    // ── Config change listener — refresh Settings tree ────────────────────────
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('aiReview')) {
          this.configTree.refresh();
        }
      })
    );

    ctx.subscriptions.push(...this.disposables);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
