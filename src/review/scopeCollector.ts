import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import * as path from 'path';
import type { ReviewContext } from '../types';
import { ReviewIgnoreManager } from './ignoreManager';

/**
 * Collects the source code to review for each trigger type.
 */
export class ScopeCollector {
  async collectGitChanges(source: 'staged' | 'unstaged' | 'lastCommit' | 'currentChanges'): Promise<ReviewContext[]> {
    const workspaceRoot = this.requireWorkspaceRoot();
    let diff: string;

    try {
      if (source === 'lastCommit') {
        const { stdout } = await execAsync('git show HEAD', { cwd: workspaceRoot });
        diff = stdout;
      } else if (source === 'staged') {
        const { stdout } = await execAsync('git diff --staged', { cwd: workspaceRoot });
        diff = stdout;
      } else if (source === 'unstaged') {
        const { stdout } = await execAsync('git diff', { cwd: workspaceRoot });
        diff = stdout;
      } else {
        // currentChanges = staged + unstaged
        const { stdout: staged } = await execAsync('git diff --staged', { cwd: workspaceRoot });
        const { stdout: unstaged } = await execAsync('git diff', { cwd: workspaceRoot });
        diff = (staged + '\n' + unstaged).trim();
      }
    } catch {
      throw new Error('No git repository found in workspace, or git is not installed.');
    }

    if (!diff.trim()) {
      throw new Error(`No changes detected in git diff (${source}).`);
    }

    const fileDiffs = this.splitDiffByFile(diff);
    if (fileDiffs.length === 0) {
      throw new Error('Could not parse any file diffs from git output.');
    }

    const ignoreManager = ReviewIgnoreManager.getInstance();
    const results: ReviewContext[] = [];

    for (const fileDiff of fileDiffs) {
      const fullPath = path.isAbsolute(fileDiff.filePath) ? fileDiff.filePath : path.join(workspaceRoot, fileDiff.filePath);
      if (!ignoreManager.shouldIgnore(fullPath)) {
        results.push({
          code: fileDiff.content,
          language: 'diff',
          filePath: fullPath,
          reviewType: 'gitDiff',
          relatedFiles: [],
          workspaceRoot,
        });
      }
    }

    if (results.length === 0 && fileDiffs.length > 0) {
      throw new Error('All modified files are ignored by .reviewignore.');
    }

    return results;
  }

  async collectFileDiff(uri: vscode.Uri, source: 'staged' | 'unstaged' | 'lastCommit'): Promise<ReviewContext[]> {
    const workspaceRoot = this.requireWorkspaceRoot();
    const relPath = path.relative(workspaceRoot, uri.fsPath);
    let diff: string;

    try {
      if (source === 'lastCommit') {
        const { stdout } = await execAsync(`git show HEAD -- "${relPath}"`, { cwd: workspaceRoot });
        diff = stdout;
      } else if (source === 'staged') {
        const { stdout } = await execAsync(`git diff --staged -- "${relPath}"`, { cwd: workspaceRoot });
        diff = stdout;
      } else {
        const { stdout } = await execAsync(`git diff -- "${relPath}"`, { cwd: workspaceRoot });
        diff = stdout;
      }
    } catch {
      throw new Error(`Failed to get git diff for ${relPath}`);
    }

    const fileDiffs = this.splitDiffByFile(diff);
    const ignoreManager = ReviewIgnoreManager.getInstance();
    const results: ReviewContext[] = [];

    for (const fd of fileDiffs) {
      if (!ignoreManager.shouldIgnore(uri.fsPath)) {
        results.push({
          code: fd.content,
          language: 'diff',
          filePath: uri.fsPath,
          reviewType: 'gitDiff',
          relatedFiles: [],
          workspaceRoot,
        });
      }
    }

    if (results.length === 0 && fileDiffs.length > 0) {
      throw new Error(`File ${relPath} is ignored by .reviewignore.`);
    }

    return results;
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

  collectActiveFile(): ReviewContext {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('No active file. Open a file to review.');

    if (ReviewIgnoreManager.getInstance().shouldIgnore(editor.document.uri.fsPath)) {
      throw new Error('This file is ignored by .reviewignore.');
    }

    return {
      code: editor.document.getText(),
      language: editor.document.languageId,
      filePath: editor.document.uri.fsPath,
      reviewType: 'activeFile',
      relatedFiles: [],
      workspaceRoot: this.getWorkspaceRoot(),
    };
  }

  collectSelection(): ReviewContext {
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
      startLine: selection.start.line + 1,
      relatedFiles: [],
      workspaceRoot: this.getWorkspaceRoot(),
    };
  }

  async collectSelectedFiles(uris: vscode.Uri[]): Promise<ReviewContext[]> {
    if (!uris || uris.length === 0) throw new Error('No files selected. Select files in the Explorer.');

    const ignoreManager = ReviewIgnoreManager.getInstance();
    const allFiles: vscode.Uri[] = [];

    // Collect all files recursively from selected folders/files
    for (const uri of uris) {
      const files = await this.getAllFilesRecursive(uri);
      allFiles.push(...files);
    }

    // Deduplicate
    const uniqueFiles = Array.from(new Set(allFiles.map(f => f.fsPath))).map(p => vscode.Uri.file(p));

    const contexts: ReviewContext[] = [];
    const config = vscode.workspace.getConfiguration('aiReview');
    const maxFiles = config.get<number>('maxFilesPerReview', 30);

    for (const uri of uniqueFiles) {
      if (!ignoreManager.shouldIgnore(uri.fsPath)) {
        if (contexts.length >= maxFiles) {
          void vscode.window.showWarningMessage(`Selection exceeds ${maxFiles} files. Some files were skipped.`);
          break;
        }

        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          contexts.push({
            code: doc.getText(),
            language: doc.languageId,
            filePath: uri.fsPath,
            reviewType: 'selectedFiles',
            relatedFiles: [],
            workspaceRoot: this.getWorkspaceRoot(),
          });
        } catch (err) {
          console.warn(`Could not open file ${uri.fsPath}:`, err);
        }
      }
    }

    if (contexts.length === 0 && uris.length > 0) {
      throw new Error('All selected files are ignored by .reviewignore or are non-file artifacts.');
    }

    return contexts;
  }

  private async getAllFilesRecursive(uri: vscode.Uri): Promise<vscode.Uri[]> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File) {
        return [uri];
      } else if (stat.type === vscode.FileType.Directory) {
        const files: vscode.Uri[] = [];
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of entries) {
          const subUri = vscode.Uri.joinPath(uri, name);
          if (type === vscode.FileType.File) {
            files.push(subUri);
          } else if (type === vscode.FileType.Directory) {
            files.push(...(await this.getAllFilesRecursive(subUri)));
          }
        }
        return files;
      }
    } catch (err) {
      console.warn(`Error stating ${uri.fsPath}:`, err);
    }
    return [];
  }

  collectFolder(folderPath: string): Promise<ReviewContext[]> {
    return this.collectSelectedFiles([vscode.Uri.file(folderPath)]);
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
  }

  private requireWorkspaceRoot(): string {
    const root = this.getWorkspaceRoot();
    if (!root) throw new Error('No workspace folder open.');
    return root;
  }
}
