import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Provides access to git-stored file contents via a custom URI scheme.
 * URI format: ai-git-file:///path/to/file?ref (e.g. HEAD, HEAD^, or empty for index)
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  static SCHEME = 'ai-git-file';

  provideTextDocumentContent(uri: vscode.Uri): string {
    const ref = uri.query || '';
    const filePath = uri.path;
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath || 
                         vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
      throw new Error('No workspace folder found for git content.');
    }

    // Relative path for git commands
    const relPath = path.relative(workspaceRoot, filePath);

    try {
      let command: string;
      if (ref) {
        // Get content from a specific ref
        command = `git show "${ref}:${relPath}"`;
      } else {
        // Get content from the index (staged)
        command = `git show ":${relPath}"`;
      }

      return execSync(command, { cwd: workspaceRoot, encoding: 'utf8' });
    } catch (err) {
      console.error('Error fetching git content:', err);
      return ''; // Or throw error
    }
  }
}
