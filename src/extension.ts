import * as vscode from 'vscode';
import type { SuppressionScope } from './types';

// Core
import { ProfileManager } from './profiles/profileManager';
import { ProfileUI } from './profiles/profileUI';
import { SecretsManager } from './providers/secretsManager';

// Review pipeline
import { ScopeCollector } from './review/scopeCollector';
import { ContextExpander } from './review/contextExpander';
import { ReviewEngine } from './review/reviewEngine';
import { SuppressionStore } from './review/suppressionStore';

// Output
import { ReportDocumentProvider, prepareReviewReport } from './output/reportDocument';
import { DecorationsManager } from './output/decorationsManager';
import { HoverProvider } from './output/hoverProvider';
import { CodeLensProvider } from './output/codeLensProvider';
import { SuppressedIssuesPanel } from './output/suppressedIssuesPanel';

// Fix
import { FixEngine } from './fix/fixEngine';

// UI
import { StatusBarController } from './ui/statusBarController';
import { SidebarController } from './sidebar/sidebarController';

let isReviewing = false;

export function activate(context: vscode.ExtensionContext): void {
  // ── Service instantiation ─────────────────────────────────────────────────
  const secrets = new SecretsManager(context.secrets);
  const profileManager = new ProfileManager(context.globalState);
  const profileUI = new ProfileUI(profileManager, secrets);
  const suppressionStore = new SuppressionStore(context.workspaceState, context.globalState);
  const scopeCollector = new ScopeCollector();
  const contextExpander = new ContextExpander();
  const reviewEngine = new ReviewEngine(suppressionStore);
  const decorations = new DecorationsManager();
  const fixEngine = new FixEngine();
  const suppressedPanel = new SuppressedIssuesPanel(suppressionStore);

  // ── Virtual document provider ─────────────────────────────────────────────
  const docProvider = new ReportDocumentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(ReportDocumentProvider.scheme, docProvider)
  );

  // ── Output providers ──────────────────────────────────────────────────────
  const codeLensProvider = new CodeLensProvider(decorations);
  const hoverProvider = new HoverProvider(decorations);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
  );

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = new StatusBarController(profileManager);
  context.subscriptions.push(statusBar);

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const sidebar = new SidebarController(profileManager, secrets, context);

  // Allow sidebar profile activation to refresh the status bar
  context.subscriptions.push(
    vscode.commands.registerCommand('aiReview.sidebar.updateStatusBar', () => statusBar.update())
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  const workspaceRoot = (): string =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  async function ensureActiveProfile(): Promise<{ profile: vscode.Disposable & { id: string; name: string; provider: any; modelId: string }; apiKey: string | undefined } | undefined> {
    let profile = profileManager.getActiveProfile();
    if (!profile) {
      const action = await vscode.window.showWarningMessage(
        'AI Code Review: No profile configured. Create one now?',
        'Open Sidebar',
        'Cancel'
      );
      if (action !== 'Open Sidebar') return undefined;
      // Focus the sidebar and open the new-profile form
      await vscode.commands.executeCommand('aiReviewSidebar.focus');
      sidebar.profileForm.open(undefined);
      return undefined;  // User will submit form and re-trigger review
    }
    const apiKey = await secrets.getApiKey(profile.id);
    return { profile: profile as any, apiKey };
  }

  const runReview = async (
    label: string,
    collector: () => Promise<any | any[]>
  ) => {
    if (isReviewing) {
      vscode.window.showWarningMessage('A review is already in progress. Please wait.');
      return;
    }

    const confirm = await vscode.window.showInformationMessage(
      `Start AI Code Review for: ${label}?`,
      { modal: true },
      'Start Review'
    );
    if (confirm !== 'Start Review') {
      return;
    }

    const profileData = await ensureActiveProfile();
    if (!profileData) return;
    const { profile, apiKey } = profileData;

    let ctxResult;
    try {
      ctxResult = await collector();
    } catch (err) {
      vscode.window.showErrorMessage(`AI Code Review: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const contexts: any[] = Array.isArray(ctxResult) ? ctxResult : [ctxResult];
    const reportUri = prepareReviewReport(docProvider, label);

    isReviewing = true;
    statusBar.setReviewing(label);

    let fullMarkdownReport = '';
    const allIssues: any[] = [];
    let allSuppressedCount = 0;
    const allContextFilesRead = new Set<string>();
    const fileReports: Record<string, string> = {};
    let hasError = false;

    sidebar.issuesTree.startReview(label);
    docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\nReviewing ${contexts.length} file(s)...`);

    await vscode.window.withProgress(
      { location: { viewId: 'aiReview.issuesTree' }, title: `AI Code Review: ${label}` },
      async (progress) => {
        for (let i = 0; i < contexts.length; i++) {
          const rawCtx = contexts[i];
          const ctx = await contextExpander.expand(rawCtx);
          const fileLabel = contexts.length > 1 ? (ctx.filePath.split(/[/\\]/).pop() || ctx.filePath) : label;

          progress.report({ message: `Reviewing ${fileLabel}... (${i + 1}/${contexts.length})` });
          
          fileReports[ctx.filePath] = '';
          sidebar.issuesTree.updateReview({ 
            fileReports: { ...fileReports },
            summary: `Reviewing ${fileLabel}... (${i + 1}/${contexts.length})`
          });

          let fileMarkdown = '';
          if (contexts.length > 1) {
            fullMarkdownReport += `## File: ${fileLabel}\n\n`;
            docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\n${fullMarkdownReport}`);
          }

          await new Promise<void>((resolve) => {
            reviewEngine.review(ctx, profile as any, apiKey, {
              onChunk: (chunk) => {
                fileMarkdown += chunk;
                fullMarkdownReport += chunk;
                docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\n${fullMarkdownReport}`);
              },
              onError: (err) => {
                fullMarkdownReport += `\n\n---\n> ❌ **Review failed for ${fileLabel}:** ${err.message}\n\n`;
                docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\n${fullMarkdownReport}`);
                vscode.window.showErrorMessage(`AI Code Review failed for ${fileLabel}: ${err.message}`);
                hasError = true;
                resolve();
              },
              onComplete: (result) => {
                result.issues.forEach((iss: any) => iss.filePath = ctx.filePath);
                allIssues.push(...result.issues);
                allSuppressedCount += result.suppressedCount;
                result.contextFilesRead.forEach((f: string) => allContextFilesRead.add(f));
                fileReports[ctx.filePath] = fileMarkdown;
                
                sidebar.issuesTree.updateReview({ 
                  issues: [...allIssues],
                  fileReports: { ...fileReports },
                  contextFilesRead: Array.from(allContextFilesRead),
                  suppressedCount: allSuppressedCount
                });
                
                resolve();
              }
            });
          });

          if (contexts.length > 1) {
            fullMarkdownReport += '\n\n---\n\n';
          }
        }
      }
    );

    isReviewing = false;
    statusBar.setIdle();

    const criticalCount = allIssues.filter((i) => i.severity === 'critical').length;
    const total = allIssues.length;
    let summary = total === 0
      ? '✅ No issues found'
      : `Found ${total} issue${total > 1 ? 's' : ''} (${criticalCount} critical)`;

    if (hasError && total === 0) summary = '❌ Review finished with errors';

    const finalResult = {
      issues: allIssues,
      markdownReport: docProvider.provideTextDocumentContent(reportUri),
      fileReports,
      summary,
      contextFilesRead: Array.from(allContextFilesRead),
      suppressedCount: allSuppressedCount,
      label,
      status: 'completed' as const
    };

    docProvider.finalizeContent(reportUri, finalResult);
    
    // Explicitly add markdownReport for compatibility with sidebar setting result
    finalResult.markdownReport = docProvider.provideTextDocumentContent(reportUri);
    decorations.applyResult(finalResult, workspaceRoot());
    codeLensProvider.refresh();
    sidebar.issuesTree.setResult(finalResult);

    vscode.window.showInformationMessage(`AI Code Review complete: ${summary}`);
  };

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('aiReview.openHistoryReport', async (result: any, timestamp: number) => {
      if (result && result.markdownReport) {
        const date = new Date(timestamp);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const time = date.toLocaleTimeString(vscode.env.language, { hour: '2-digit', minute: '2-digit' });
        const label = `History (${yyyy}-${mm}-${dd} ${time})`;
        const uri = ReportDocumentProvider.makeUri(label);
        docProvider.updateContent(uri, result.markdownReport);
        try {
          await vscode.commands.executeCommand('markdown.showPreview', uri);
        } catch (e) {
          // fallback
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }
      } else {
        vscode.window.showInformationMessage('No markdown report available for this history entry.');
      }
    }),

    vscode.commands.registerCommand('aiReview.openFileReport', async (result: any, timestamp: number, filePath: string) => {
      if (result && result.fileReports && result.fileReports[filePath]) {
        const date = new Date(timestamp);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const time = date.toLocaleTimeString(vscode.env.language, { hour: '2-digit', minute: '2-digit' });
        
        const basename = filePath.split(/[/\\]/).pop() || filePath;
        const label = `${basename} (${yyyy}-${mm}-${dd} ${time})`;
        const uri = ReportDocumentProvider.makeUri(label);
        
        const markdown = `# AI Code Review — ${basename}\n\n${result.fileReports[filePath]}`;
        docProvider.updateContent(uri, markdown);
        
        try {
          await vscode.commands.executeCommand('markdown.showPreview', uri);
        } catch (e) {
          // fallback
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }
      } else {
        vscode.window.showInformationMessage('No specific report found for this file.');
      }
    }),

    vscode.commands.registerCommand('aiReview.reviewGitDiff', async () => {
      const selection = await vscode.window.showQuickPick(
        [
          {
            label: '$(git-commit) Review Last Commit',
            description: 'Review the changes in the most recent git commit',
            value: 'lastCommit',
          },
          {
            label: '$(git-pull-request) Review Current Changes',
            description: 'Review staged and unstaged git changes',
            value: 'currentChanges',
          },
        ],
        { placeHolder: 'Select what to review in git diff' }
      );

      if (!selection) return;

      if (selection.value === 'lastCommit') {
        return runReview('Git: Last Commit', () => scopeCollector.collectGitDiff(true));
      } else {
        return runReview('Git: Staged Changes', () => scopeCollector.collectGitDiff(false));
      }
    }),

    vscode.commands.registerCommand('aiReview.reviewFile', () => {
      const activeEditor = vscode.window.activeTextEditor;
      const basename = activeEditor?.document.uri.fsPath.split(/[/\\]/).pop() ?? 'Active File';
      return runReview(`File: ${basename}`, () => scopeCollector.collectActiveFile());
    }),

    vscode.commands.registerCommand('aiReview.reviewSelection', () =>
      runReview('Editor Selection', () => scopeCollector.collectSelection())
    ),

    vscode.commands.registerCommand('aiReview.reviewSelectedFiles', (_: any, uris: vscode.Uri[]) =>
      runReview(`${uris?.length ?? 0} selected files`, () => scopeCollector.collectSelectedFiles(uris))
    ),

    vscode.commands.registerCommand('aiReview.manageProfiles', () => profileUI.runManageProfiles()),

    vscode.commands.registerCommand('aiReview.switchProfile', async () => {
      await profileUI.runSwitchProfile();
      statusBar.update();
    }),

    vscode.commands.registerCommand('aiReview.suppressIssue', async (args: { issueId: string }) => {
      const issue = decorations.getIssue(args.issueId);
      if (!issue) {
        vscode.window.showErrorMessage('Could not find issue to suppress.');
        return;
      }

      const config = vscode.workspace.getConfiguration('aiReview');
      const defaultScope = config.get<string>('suppressionScope', 'workspace');

      const scopePick = await vscode.window.showQuickPick(
        [
          { label: '$(file) This File', scope: 'file' as SuppressionScope },
          { label: '$(folder) This Workspace', scope: 'workspace' as SuppressionScope },
          { label: '$(globe) Global (all workspaces)', scope: 'global' as SuppressionScope },
        ],
        {
          title: 'Suppress Issue — Choose Scope',
          placeHolder: `Default: ${defaultScope}`,
        }
      );
      if (!scopePick) return;

      await suppressionStore.suppress(issue, scopePick.scope);
      decorations.clearAll();
      codeLensProvider.refresh();
      vscode.window.showInformationMessage(
        `Issue suppressed (${scopePick.scope}). It will not appear in future reviews.`
      );
    }),

    vscode.commands.registerCommand('aiReview.manageSuppressed', () =>
      suppressedPanel.show(context)
    ),

    vscode.commands.registerCommand('aiReview.applyFix', async (args: { issueId: string }) => {
      const issue = decorations.getIssue(args.issueId);
      if (!issue) {
        vscode.window.showErrorMessage('Could not find issue to fix.');
        return;
      }

      const profileData = await ensureActiveProfile();
      if (!profileData) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor to apply fix to.');
        return;
      }

      await fixEngine.suggestFix(issue, editor.document, profileData.profile as any, profileData.apiKey);
    }),

    vscode.commands.registerCommand('aiReview.clearDecorations', () => {
      decorations.clearAll();
      codeLensProvider.refresh();
      vscode.window.showInformationMessage('AI Code Review annotations cleared.');
    })
  );

  context.subscriptions.push(decorations);
}

export function deactivate(): void {
  // Cleanup is handled via context.subscriptions
}
