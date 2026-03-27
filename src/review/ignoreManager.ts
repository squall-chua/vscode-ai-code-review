import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Manages .reviewignore file patterns.
 */
export class ReviewIgnoreManager {
  private static instance: ReviewIgnoreManager;
  private ignorePatterns: string[] = [];
  private lastModified: number = 0;

  private constructor() {}

  public static getInstance(): ReviewIgnoreManager {
    if (!ReviewIgnoreManager.instance) {
      ReviewIgnoreManager.instance = new ReviewIgnoreManager();
    }
    return ReviewIgnoreManager.instance;
  }

  /**
   * Checks if a file should be ignored.
   * Path should be absolute fsPath.
   */
  public shouldIgnore(filePath: string): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return false;

    const rootPath = workspaceFolders[0].uri.fsPath;
    const ignoreFile = path.join(rootPath, '.reviewignore');

    // Simple refresh if needed
    if (fs.existsSync(ignoreFile)) {
      const stats = fs.statSync(ignoreFile);
      if (stats.mtimeMs > this.lastModified) {
        const content = fs.readFileSync(ignoreFile, 'utf8');
        this.ignorePatterns = content
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        this.lastModified = stats.mtimeMs;
      }
    } else {
      this.ignorePatterns = [];
      this.lastModified = 0;
    }

    if (this.ignorePatterns.length === 0) return false;

    const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');

    for (const pattern of this.ignorePatterns) {
      if (this.match(relativePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  public clearCache(): void {
    this.ignorePatterns = [];
    this.lastModified = 0;
  }

  private match(filePath: string, pattern: string): boolean {
    // 1. Exact match
    if (filePath === pattern) return true;
    
    // 2. Directory match
    if (pattern.endsWith('/')) {
      if (filePath.startsWith(pattern)) return true;
    } else {
      // If it's a directory name without trailing slash, check if it's a prefix of a path component
      if (filePath.startsWith(pattern + '/')) return true;
    }

    // 3. Extension match (*.js, etc)
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (filePath.endsWith(ext)) return true;
    }

    // 4. Multi-level wildcard (**/temp)
    if (pattern.startsWith('**/')) {
      const subPattern = pattern.slice(3);
      if (filePath === subPattern || filePath.startsWith(subPattern + '/') || filePath.endsWith('/' + subPattern) || filePath.includes('/' + subPattern + '/')) {
        return true;
      }
    }

    // 5. Basename match
    if (!pattern.includes('/')) {
      const basename = path.basename(filePath).replace(/\\/g, '/');
      if (basename === pattern) return true;
    }

    return false;
  }
}
