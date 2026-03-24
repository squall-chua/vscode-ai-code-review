import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ReviewContext, RelatedFile } from '../types';

const IMPORT_PATTERNS: RegExp[] = [
  // JS/TS: import ... from '...'  or  require('...')
  /(?:import|from)\s+['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Python: import ... / from ... import
  /^(?:import|from)\s+([\w./]+)/gm,
  // Go: import "..."
  /import\s+"([^"]+)"/g,
];

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.py', '.go', '.rs'];

/**
 * Resolves imports referenced in the reviewed code and returns their content
 * as RelatedFile entries for additional context. Capped at maxContextFiles.
 */
export class ContextExpander {
  private readonly maxContextFiles: number;

  constructor() {
    const config = vscode.workspace.getConfiguration('aiReview');
    this.maxContextFiles = config.get<number>('maxContextFiles', 5);
  }

  async expand(ctx: ReviewContext): Promise<ReviewContext> {
    if (this.maxContextFiles === 0 || ctx.reviewType === 'gitDiff') {
      return ctx;
    }

    const baseDir = ctx.reviewType === 'selectedFiles' || ctx.filePath === 'Git Diff'
      ? this.workspaceRoot()
      : path.dirname(ctx.filePath);

    const importPaths = this.extractImports(ctx.code);
    const resolved = await this.resolveFiles(importPaths, baseDir);

    return { ...ctx, relatedFiles: resolved };
  }

  private extractImports(code: string): string[] {
    const found = new Set<string>();
    for (const pattern of IMPORT_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(code)) !== null) {
        const imp = match[1];
        // Only local imports (starts with . or /)
        if (imp && (imp.startsWith('.') || imp.startsWith('/'))) {
          found.add(imp);
        }
      }
    }
    return [...found];
  }

  private async resolveFiles(importPaths: string[], baseDir: string): Promise<RelatedFile[]> {
    const results: RelatedFile[] = [];

    for (const imp of importPaths) {
      if (results.length >= this.maxContextFiles) break;

      const resolved = this.tryResolve(imp, baseDir);
      if (!resolved) continue;

      try {
        const content = fs.readFileSync(resolved, 'utf8');
        results.push({
          filePath: resolved,
          content: this.truncate(content, 200),
          reason: `Imported by reviewed file`,
        });
      } catch {
        // File unreadable — skip silently
      }
    }

    return results;
  }

  private tryResolve(importPath: string, baseDir: string): string | undefined {
    const abs = path.resolve(baseDir, importPath);

    // Exact match
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;

    // Try with extensions
    for (const ext of RESOLVABLE_EXTENSIONS) {
      const p = abs + ext;
      if (fs.existsSync(p)) return p;
    }

    // Try index file
    for (const ext of RESOLVABLE_EXTENSIONS) {
      const p = path.join(abs, `index${ext}`);
      if (fs.existsSync(p)) return p;
    }

    return undefined;
  }

  /** Keep only the first N lines to avoid token explosion. */
  private truncate(content: string, maxLines: number): string {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n') + `\n// ... (truncated at ${maxLines} lines)`;
  }

  private workspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }
}
