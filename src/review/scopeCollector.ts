import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import type { ReviewContext, ReviewType, RelatedFile } from '../types';

/**
 * Collects the source code to review for each trigger type.
 */
export class ScopeCollector {
  async collectGitDiff(lastCommit = false): Promise<ReviewContext[]> {
    const workspaceRoot = this.requireWorkspaceRoot();
    let diff: string;

    try {
      if (lastCommit) {
        diff = execSync('git show HEAD', { cwd: workspaceRoot, encoding: 'utf8' });
      } else {
        diff = execSync('git diff --staged', { cwd: workspaceRoot, encoding: 'utf8' });
        if (!diff.trim()) {
          // Fallback to unstaged changes
          diff = execSync('git diff HEAD', { cwd: workspaceRoot, encoding: 'utf8' });
        }
      }
    } catch {
      throw new Error('No git repository found in workspace, or git is not installed.');
    }

    if (!diff.trim()) {
      throw new Error(
        lastCommit
          ? 'No commit found at HEAD.'
          : 'No changes detected in git diff (staged or HEAD). Stage your changes and try again.'
      );
    }

    const fileDiffs = this.splitDiffByFile(diff);
    if (fileDiffs.length === 0) {
      throw new Error('Could not parse any file diffs from git output.');
    }

    return fileDiffs.map((fileDiff) => ({
      code: fileDiff.content,
      language: 'diff',
      filePath: path.join(workspaceRoot, fileDiff.filePath),
      reviewType: 'gitDiff',
      relatedFiles: [],
    }));
  }

  private splitDiffByFile(fullDiff: string): { filePath: string; content: string }[] {
    const results: { filePath: string; content: string }[] = [];
    const diffLines = fullDiff.split('\n');

    let currentFile: string | null = null;
    let currentContent: string[] = [];

    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      // Match diff header for new file context: "diff --git a/path/to/file b/path/to/file"
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);

      if (match) {
        if (currentFile && currentContent.length > 0) {
          results.push({ filePath: currentFile, content: currentContent.join('\n') });
        }
        currentFile = match[2]; // Use b/ path as destination
        currentContent = [line];
      } else if (currentFile) {
        currentContent.push(line);
      }
    }

    if (currentFile && currentContent.length > 0) {
      results.push({ filePath: currentFile, content: currentContent.join('\n') });
    }

    return results;
  }

  async collectActiveFile(): Promise<ReviewContext> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('No active file. Open a file to review.');

    return {
      code: editor.document.getText(),
      language: editor.document.languageId,
      filePath: editor.document.uri.fsPath,
      reviewType: 'activeFile',
      relatedFiles: [],
    };
  }

  async collectSelection(): Promise<ReviewContext> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('No active editor.');
    if (editor.selection.isEmpty) throw new Error('Please select some code before running a review.');

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    return {
      code: selectedText,
      language: editor.document.languageId,
      filePath: editor.document.uri.fsPath,
      reviewType: 'selection',
      relatedFiles: [],
    };
  }

  async collectSelectedFiles(uris: vscode.Uri[]): Promise<ReviewContext[]> {
    if (!uris || uris.length === 0) throw new Error('No files selected. Select files in the Explorer.');

    const contexts: ReviewContext[] = [];
    for (const uri of uris) {
      const doc = await vscode.workspace.openTextDocument(uri);
      contexts.push({
        code: doc.getText(),
        language: doc.languageId,
        filePath: uri.fsPath,
        reviewType: 'selectedFiles',
        relatedFiles: [],
      });
    }

    return contexts;
  }

  private requireWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) throw new Error('No workspace folder open.');
    return folders[0].uri.fsPath;
  }
}
