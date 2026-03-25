import * as vscode from 'vscode';
import * as path from 'path';
import type { ReviewIssue, ReviewResult } from '../types';

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

const GUTTER_ICON_COLORS: Record<string, string> = {
  critical: 'errorForeground',
  warning: 'editorWarning.foreground',
  info: 'editorInfo.foreground',
};

export class DecorationsManager {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

  /** Map from issueId -> ReviewIssue for CodeLens/Hover resolution. */
  private issueMap: Map<string, ReviewIssue> = new Map();

  constructor() {
    this.diagnostics = vscode.languages.createDiagnosticCollection('AI Code Review');
    this.initDecorationTypes();
  }

  private initDecorationTypes(): void {
    for (const severity of ['critical', 'warning', 'info'] as const) {
      const type = vscode.window.createTextEditorDecorationType({
        gutterIconPath: undefined, // Use built-in diagnostic icons
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        overviewRulerColor: new vscode.ThemeColor(GUTTER_ICON_COLORS[severity]),
      });
      this.decorationTypes.set(severity, type);
    }
  }

  applyResult(result: ReviewResult, workspaceRoot: string): void {
    this.issueMap.clear();
    const byFile = this.groupByFile(result.issues, workspaceRoot);

    // Clear old diagnostics
    this.diagnostics.clear();

    for (const [fsPath, issues] of byFile.entries()) {
      const uri = vscode.Uri.file(fsPath);
      const diags: vscode.Diagnostic[] = [];

      for (const issue of issues) {
        this.issueMap.set(issue.id, issue);
        const line = Math.max(0, issue.line - 1); // 0-indexed
        const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
        const diag = new vscode.Diagnostic(
          range,
          issue.message,
          SEVERITY_MAP[issue.severity]
        );
        diag.source = 'AI Code Review';
        diag.code = issue.id;
        if (issue.suggestion) {
          diag.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(uri, range),
              `💡 ${issue.suggestion}`
            ),
          ];
        }
        diags.push(diag);
      }

      this.diagnostics.set(uri, diags);
    }
  }

  getIssue(issueId: string): ReviewIssue | undefined {
    return this.issueMap.get(issueId);
  }

  getIssuesForFile(fsPath: string): ReviewIssue[] {
    const resolvedPath = path.resolve(fsPath);
    return [...this.issueMap.values()].filter((i) => {
      const issuePath = path.isAbsolute(i.filePath) ? i.filePath : i.filePath; // Minimal change for now
      return issuePath === resolvedPath || i.filePath === fsPath;
    });
  }

  removeIssue(issueId: string): void {
    const issue = this.issueMap.get(issueId);
    if (!issue) return;

    this.issueMap.delete(issueId);
    
    // Refresh diagnostics for that file
    const fsPath = issue.filePath;
    const remainingIssues = this.getIssuesForFile(fsPath);
    this.setFileDiagnostics(fsPath, remainingIssues);
  }

  clearFile(fsPath: string): void {
    const uri = vscode.Uri.file(fsPath);
    this.diagnostics.delete(uri);
    // Remove issues for this file from the map
    for (const [id, issue] of this.issueMap.entries()) {
      if (issue.filePath === fsPath || path.resolve(issue.filePath) === path.resolve(fsPath)) {
        this.issueMap.delete(id);
      }
    }
  }

  setFileDiagnostics(fsPath: string, issues: ReviewIssue[], workspaceRoot?: string): void {
    const uri = vscode.Uri.file(fsPath);
    const diags: vscode.Diagnostic[] = [];

    for (const issue of issues) {
      this.issueMap.set(issue.id, issue);
      const line = Math.max(0, issue.line - 1); // 0-indexed
      const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
      const diag = new vscode.Diagnostic(
        range,
        issue.message,
        SEVERITY_MAP[issue.severity]
      );
      diag.source = 'AI Code Review';
      diag.code = issue.id;
      if (issue.suggestion) {
        diag.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(uri, range),
            `💡 ${issue.suggestion}`
          ),
        ];
      }
      diags.push(diag);
    }

    this.diagnostics.set(uri, diags);
  }

  clearAll(): void {
    this.diagnostics.clear();
    this.issueMap.clear();
  }

  dispose(): void {
    this.diagnostics.dispose();
    for (const type of this.decorationTypes.values()) type.dispose();
  }

  private groupByFile(issues: ReviewIssue[], workspaceRoot: string): Map<string, ReviewIssue[]> {
    const map = new Map<string, ReviewIssue[]>();
    for (const issue of issues) {
      // Resolve relative paths against workspace root
      const resolved = path.isAbsolute(issue.filePath)
        ? issue.filePath
        : path.resolve(workspaceRoot, issue.filePath);

      if (!map.has(resolved)) map.set(resolved, []);
      map.get(resolved)!.push(issue);
    }
    return map;
  }
}
