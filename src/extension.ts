import * as path from 'path';
import * as vscode from 'vscode';
import type { ReviewProfile, ReviewIssue, ReviewContext, ReviewCategory, ReviewResult } from './types';

// Core
import { ProfileManager } from './profiles/profileManager';
import { ProfileUI } from './profiles/profileUI';
import { SecretsManager } from './providers/secretsManager';

// Review pipeline
import { ScopeCollector } from './review/scopeCollector';
import { ContextExpander } from './review/contextExpander';
import { ReviewEngine } from './review/reviewEngine';
import { SuppressionStore } from './review/suppressionStore';
import { ReviewIgnoreManager } from './review/ignoreManager';

// Output
import { ReportDocumentProvider, prepareReviewReport } from './output/reportDocument';
import { DecorationsManager } from './output/decorationsManager';
import { HoverProvider } from './output/hoverProvider';
import { CodeLensProvider } from './output/codeLensProvider';
import { SuppressedIssuesPanel } from './output/suppressedIssuesPanel';

// Fix
import { FixEngine } from './fix/fixEngine';

// UI
import { GitContentProvider } from './providers/gitContentProvider';

import { StatusBarController } from './ui/statusBarController';
import { GitChangeItem } from './sidebar/gitChangesTreeProvider';
import { SidebarController } from './sidebar/sidebarController';
import { ReviewResultsPanel } from './results/reviewResultsPanel';

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
  const statusBar = new StatusBarController(profileManager, context);
  context.subscriptions.push(statusBar);

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const gitContentProvider = new GitContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GitContentProvider.SCHEME, gitContentProvider)
  );

  const sidebar = new SidebarController(profileManager, secrets, context, decorations, suppressionStore, fixEngine);


  // ── Helpers ───────────────────────────────────────────────────────────────
  const workspaceRoot = (): string =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  // ── .reviewignore watcher ──────────────────────────────────────────────────
  const reviewIgnoreWatcher = vscode.workspace.createFileSystemWatcher('**/.reviewignore');
  context.subscriptions.push(reviewIgnoreWatcher);

  const refreshOnIgnoreChange = () => {
    ReviewIgnoreManager.getInstance().clearCache();
    void vscode.commands.executeCommand('aiReview.sidebar.refreshTree');
  };

  context.subscriptions.push(
    reviewIgnoreWatcher.onDidChange(refreshOnIgnoreChange),
    reviewIgnoreWatcher.onDidCreate(refreshOnIgnoreChange),
    reviewIgnoreWatcher.onDidDelete(refreshOnIgnoreChange)
  );

  async function ensureActiveProfile(): Promise<{ profile: ReviewProfile; apiKey: string | undefined } | undefined> {
    const profile = profileManager.getActiveProfile();
    if (!profile) {
      const action = await vscode.window.showWarningMessage(
        'AI Code Review: No profile configured. Create one now?',
        'Open Sidebar',
        'Cancel'
      );
      if (action !== 'Open Sidebar') return undefined;
      // Focus the sidebar and open the new-profile form
      await vscode.commands.executeCommand('aiReviewSidebar.focus');
      await vscode.commands.executeCommand('aiReview.openSettings');
      return undefined;  // User will submit form and re-trigger review
    }
    const apiKey = await secrets.getApiKey(profile.id);
    return { profile, apiKey };
  }

  const runReview = async (
    label: string,
    collector: () => Promise<ReviewContext | ReviewContext[]> | ReviewContext | ReviewContext[],
    categoryOverride?: ReviewCategory
  ) => {
    if (isReviewing) {
      await vscode.window.showWarningMessage('A review is already in progress. Please wait.');
      return;
    }

    const profileData = await ensureActiveProfile();
    if (!profileData) return;
    const { profile, apiKey } = profileData;

    let ctxResult;
    try {
      ctxResult = await collector();
    } catch (err) {
      await vscode.window.showErrorMessage(`AI Code Review: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const contexts: ReviewContext[] = Array.isArray(ctxResult) ? ctxResult : [ctxResult];
    if (contexts.length === 0) return;

    // Check for ignored files early to give accurate count in confirm
    const ignoreManager = ReviewIgnoreManager.getInstance();
    const filteredContexts = contexts.filter(ctx => !ignoreManager.shouldIgnore(ctx.filePath));

    if (filteredContexts.length === 0) {
      await vscode.window.showInformationMessage('AI Code Review: All selected files are ignored via .reviewignore');
      return;
    }

    let focusCategory: ReviewCategory | undefined;
    if (typeof categoryOverride === 'string') {
      focusCategory = categoryOverride;
    } else {
      focusCategory = profile.defaultCategory;
    }

    // Prompt for focus area if no default is set
    if (!focusCategory) {
      const items: (vscode.QuickPickItem & { category: ReviewCategory })[] = [
        { label: '$(check) General Review', description: 'Comprehensive code analysis', category: 'general' },
        { label: '$(shield) Security & Vulnerabilities', description: 'Focus on OWASP Top 10 and common pitfalls', category: 'security considerations' },
        { label: '$(bug) Bugs & Logical Errors', description: 'Find potential crashes or incorrect logic', category: 'potential bugs' },
        { label: '$(zap) Performance & Scalability', description: 'Identify bottlenecks and resource leaks', category: 'performance' },
        { label: '$(symbol-class) Best Practices & Design Patterns', description: 'Evaluate SOLID, DRY, and design patterns', category: 'best practices & design patterns' },
        { label: '$(symbol-text) Maintainability & Readability', description: 'Focus on code cleaniness and structure', category: 'readability & maintainability' },
        { label: '$(test-view-icon) Testability', description: 'Evaluate how easy the code is to unit test', category: 'testability' },
        { label: '$(paintcan) Style Guide Adherence', description: 'Check consistency with style guides', category: 'style guide adherence' },
        { label: '$(comment) Clarity of Comments', description: 'Evaluate quality of documentation', category: 'clarity of comments' }
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select focus area to start review for ${filteredContexts.length} item(s)`,
        title: `AI Code Review: ${label}`
      });

      if (!selected) return;
      focusCategory = selected.category;
    }

    // Assign the determined focusCategory to all filtered contexts
    filteredContexts.forEach(c => c.reviewCategory = focusCategory);

    const ignoredCount = contexts.length - filteredContexts.length;
    const reviewContexts = filteredContexts; // Aligning with user's snippet variable name

    const reviewMsg = reviewContexts.length === 0 && ignoredCount === 0
      ? 'AI Code Review: No files to review.'
      : `AI Code Review: Reviewing ${reviewContexts.length} file(s) (Skipped ${ignoredCount} files ignored via .reviewignore)`;

    await vscode.window.showInformationMessage(reviewMsg);

    if (reviewContexts.length === 0) {
      return; // No files to review after filtering and showing message
    }

    const reportUri = prepareReviewReport(docProvider, label);

    isReviewing = true;
    statusBar.setReviewing(label);

    let fullMarkdownReport = '';
    const allIssues: ReviewIssue[] = [];
    let allSuppressedCount = 0;
    const allContextFilesRead = new Set<string>();
    const fileReports: Record<string, string> = {};
    let hasError = false;

    sidebar.issuesTree.startReview(label, focusCategory);
    docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\nReviewing ${filteredContexts.length} file(s)...`);

    await vscode.window.withProgress(
      { location: { viewId: 'aiReview.issuesTree' }, title: `AI Code Review: ${label}` },
      async (progress) => {
        for (let i = 0; i < filteredContexts.length; i++) {
          const rawCtx = filteredContexts[i];
          const ctx = await contextExpander.expand(rawCtx);
          const fileLabel = filteredContexts.length > 1 ? (ctx.filePath.split(/[/\\]/).pop() || ctx.filePath) : label;

          progress.report({ message: `Reviewing ${fileLabel}... (${i + 1}/${filteredContexts.length})` });

          fileReports[ctx.filePath] = '';
          sidebar.issuesTree.updateReview({
            fileReports: { ...fileReports },
            summary: `Reviewing ${fileLabel}... (${i + 1}/${filteredContexts.length})`
          });

          let fileMarkdown = '';
          if (filteredContexts.length > 1) {
            fullMarkdownReport += `## File: ${fileLabel}\n\n`;
            docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\n${fullMarkdownReport}`);
          }

          await new Promise<void>((resolve) => {
            void reviewEngine.review(ctx, profile, apiKey, {
              onChunk: (chunk) => {
                fileMarkdown += chunk;
                fullMarkdownReport += chunk;
                docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\n${fullMarkdownReport}`);
              },
              onError: (err) => {
                fullMarkdownReport += `\n\n---\n> ❌ **Review failed for ${fileLabel}:** ${err.message}\n\n`;
                docProvider.updateContent(reportUri, `# AI Code Review — ${label}\n\n${fullMarkdownReport}`);
                void vscode.window.showErrorMessage(`AI Code Review failed for ${fileLabel}: ${err.message}`);
                hasError = true;
                resolve();
              },
              onComplete: (result) => {
                result.issues.forEach((iss: ReviewIssue) => iss.filePath = ctx.filePath);
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

          if (filteredContexts.length > 1) {
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
      reviewCategory: focusCategory,
      status: 'completed' as const
    };

    docProvider.finalizeContent(reportUri, finalResult);

    // Explicitly add markdownReport for compatibility with sidebar setting result
    finalResult.markdownReport = docProvider.provideTextDocumentContent(reportUri);

    // Apply decorations only for non-suppressed issues
    const unsuppressedIssues = finalResult.issues.filter(i => !suppressionStore.isSuppressed(i.id));
    decorations.applyResult({ ...finalResult, issues: unsuppressedIssues }, workspaceRoot());
    codeLensProvider.refresh();
    sidebar.issuesTree.setResult(finalResult);

    // Auto-show rich results panel
    await vscode.commands.executeCommand('aiReview.showResultsPanel', finalResult);

    await vscode.window.showInformationMessage(`AI Code Review complete: ${summary}`);
  };

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('aiReview.showResultsPanel', (result: ReviewResult) => {
      // Refresh suppression status for each issue
      if (result && result.issues) {
        result.issues = result.issues.map(iss => ({
          ...iss,
          isSuppressed: suppressionStore.isSuppressed(iss.id)
        }));

        // Update suppressedCount for accuracy
        result.suppressedCount = result.issues.filter(i => i.isSuppressed).length;
      }
      ReviewResultsPanel.createOrShow(context.extensionUri, result);
    }),
    vscode.commands.registerCommand('aiReview.openReviewHistoryReport', async (result: ReviewResult) => {
      if (result) {
        // Show rich panel by default for history
        await vscode.commands.executeCommand('aiReview.showResultsPanel', result);
      } else {
        await vscode.window.showInformationMessage('No report available for this history entry.');
      }
    }),

    vscode.commands.registerCommand('aiReview.openFileReport', async (result: ReviewResult, _timestamp: number, filePath: string) => {
      if (result && result.fileReports && result.fileReports[filePath]) {
        // Show only the results panel filtered for this file
        const basename = path.basename(filePath);
        const fileIssues = (result.issues || []).filter((i: ReviewIssue) => i.filePath === filePath);

        const filteredResult: ReviewResult = {
          ...result,
          issues: fileIssues,
          markdownReport: result.fileReports[filePath],
          label: `${result.label || 'Review'} - ${basename}`,
          suppressedCount: fileIssues.filter((i: ReviewIssue) => suppressionStore.isSuppressed(i.id)).length
        };
        await vscode.commands.executeCommand('aiReview.showResultsPanel', filteredResult);
      } else {
        await vscode.window.showInformationMessage('No specific report found for this file.');
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
            label: '$(git-pull-request) Review All Uncommitted Changes',
            description: 'Review both staged and unstaged changes',
            value: 'currentChanges',
          },
          {
            label: '$(git-stage) Review Staged Only',
            description: 'Review only changes staged for commit',
            value: 'staged',
          },
        ],
        { placeHolder: 'Select what to review in git diff' }
      );

      if (!selection) return;

      const label = `Git: ${selection.label.split(') ')[1]}`;
      return runReview(label, async () => scopeCollector.collectGitChanges(selection.value as "staged" | "unstaged" | "lastCommit" | "currentChanges"));
    }),

    vscode.commands.registerCommand('aiReview.reviewGitFile', async (item: GitChangeItem, selectedItems?: GitChangeItem[]) => {
      const items = selectedItems || (item ? [item] : []);
      if (items.length === 0) {
        await vscode.window.showInformationMessage('Select one or more files in the Git Changes view to review.');
        return;
      }

      // Check for mixed groups -- we only support reviewing files from the same group for now
      // Or we can just collect them all. 
      const reviewContexts: ReviewContext[] = [];
      for (const it of items) {
        if (it?.type === 'file' && it.filePath && it.gitState) {
          const uri = vscode.Uri.file(it.filePath);
          const contexts = await scopeCollector.collectFileDiff(uri, it.gitState);
          reviewContexts.push(...contexts);
        }
      }

      if (reviewContexts.length === 0) return;
      const label = items.length === 1 ? `File: ${items[0].label}` : `Git: ${items.length} selected files`;
      return runReview(label, () => reviewContexts);
    }),

    vscode.commands.registerCommand('aiReview.reviewGitGroup', async (item: GitChangeItem, selectedItems?: GitChangeItem[]) => {
      const items = selectedItems || (item ? [item] : []);
      const groups = items.filter(it => it.type !== 'file');

      if (groups.length === 0) return;

      const allContexts: ReviewContext[] = [];
      for (const group of groups) {
        const groupId = group.type as "staged" | "unstaged" | "lastCommit";
        const contexts = await scopeCollector.collectGitChanges(groupId);
        allContexts.push(...contexts);
      }

      const label = groups.length === 1 ? `Git: ${groups[0].label}` : `Git: ${groups.length} groups`;
      return runReview(label, () => allContexts);
    }),

    vscode.commands.registerCommand('aiReview.openGitDiff', async (filePath: string, gitState: string) => {
      if (!filePath) return;
      const uri = vscode.Uri.file(filePath);

      // Original vs New URIs
      let leftUri: vscode.Uri;
      let rightUri: vscode.Uri = uri;
      let title: string;

      if (gitState === 'staged') {
        // Compare HEAD vs Index
        leftUri = vscode.Uri.parse(`${GitContentProvider.SCHEME}:${filePath}?HEAD`);
        rightUri = vscode.Uri.parse(`${GitContentProvider.SCHEME}:${filePath}`);
        title = `${path.basename(filePath)} (Staged Changes)`;
      } else if (gitState === 'unstaged') {
        // Compare Index vs Disk
        leftUri = vscode.Uri.parse(`${GitContentProvider.SCHEME}:${filePath}`);
        rightUri = uri; // Disk URI
        title = `${path.basename(filePath)} (Unstaged Changes)`;
      } else if (gitState === 'lastCommit') {
        // Compare HEAD~1 vs HEAD
        leftUri = vscode.Uri.parse(`${GitContentProvider.SCHEME}:${filePath}?HEAD~1`);
        rightUri = vscode.Uri.parse(`${GitContentProvider.SCHEME}:${filePath}?HEAD`);
        title = `${path.basename(filePath)} (Last Commit)`;
      } else {
        return;
      }

      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }),

    vscode.commands.registerCommand('aiReview.reviewFolder', async (uri: vscode.Uri, category?: ReviewCategory) => {
      const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folderPath) {
        await vscode.window.showErrorMessage('AI Code Review: No folder selected or workspace open.');
        return;
      }

      const basename = folderPath.split(/[/\\]/).pop() ?? 'Folder';
      return runReview(`Folder: ${basename}`, () => scopeCollector.collectFolder(folderPath), category);
    }),

    vscode.commands.registerCommand('aiReview.reviewFile', (category?: ReviewCategory) => {
      const activeEditor = vscode.window.activeTextEditor;
      const basename = activeEditor?.document.uri.fsPath.split(/[/\\]/).pop() ?? 'Active File';
      void runReview(`File: ${basename}`, () => scopeCollector.collectActiveFile(), category);
    }),

    vscode.commands.registerCommand('aiReview.reviewSelection', (category?: ReviewCategory) =>
      void runReview('Editor Selection', () => scopeCollector.collectSelection(), category)
    ),

    vscode.commands.registerCommand('aiReview.reviewSelectedFiles', (_: ReviewResult, uris: vscode.Uri[], category?: ReviewCategory) =>
      void runReview(`Review: ${uris?.length ?? 0} selected items`, () => scopeCollector.collectSelectedFiles(uris), category)
    ),

    vscode.commands.registerCommand('aiReview.manageProfiles', () => profileUI.runManageProfiles()),

    vscode.commands.registerCommand('aiReview.switchProfile', async () => {
      await profileUI.runSwitchProfile();
      statusBar.update();
    }),

    vscode.commands.registerCommand('aiReview.manageSuppressed', () =>
      suppressedPanel.show(context)
    ),

    vscode.commands.registerCommand('aiReview.clearDecorations', async () => {
      decorations.clearAll();
      codeLensProvider.refresh();
      await vscode.window.showInformationMessage('AI Code Review annotations cleared.');
    })
  );

  context.subscriptions.push(decorations);
}

export function deactivate(): void {
  // Cleanup is handled via context.subscriptions
}
