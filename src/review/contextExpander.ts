import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ReviewContext, RelatedFile } from '../types';

/**
 * Detects import/require paths in different languages.
 */
const IMPORT_RE = /(?:import|from|require)\s*\(?['"]([^'"]+)['"]\)?/g;

/**
 * Resolves imports referenced in the reviewed code and returns their content
 * as RelatedFile entries for additional context. Capped at maxContextFiles.
 */
export class ContextExpander {
  async expand(ctx: ReviewContext): Promise<ReviewContext> {
    const config = vscode.workspace.getConfiguration('aiReview');
    const enabled = config.get<boolean>('enableContextExpansion', true);
    const maxFiles = config.get<number>('maxContextFiles', 5);

    if (!enabled || maxFiles === 0 || ctx.reviewType === 'gitDiff' || !ctx.filePath) {
      return ctx;
    }

    const imports = this.extractImports(ctx.code);
    const baseDir = path.dirname(ctx.filePath);
    const relatedFiles = await this.resolveFiles(imports, baseDir, maxFiles);

    return { ...ctx, relatedFiles };
  }

  private extractImports(code: string): string[] {
    const results: string[] = [];
    const matches = code.matchAll(IMPORT_RE);
    for (const match of matches) {
      if (match[1]) {
        results.push(match[1]);
      }
    }
    return results;
  }

  private async resolveFiles(importPaths: string[], baseDir: string, maxFiles: number): Promise<RelatedFile[]> {
    const resolved: RelatedFile[] = [];
    const seen = new Set<string>();

    for (const importPath of importPaths) {
      if (resolved.length >= maxFiles) break;
      if (!importPath.startsWith('.')) continue; // Only local files

      const absPath = path.resolve(baseDir, importPath);
      
      // Try with common extensions if none
      const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
      let foundPath = '';
      
      for (const ext of extensions) {
        const p = absPath + ext;
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          foundPath = p;
          break;
        }
      }

      if (foundPath && !seen.has(foundPath)) {
        try {
          const uri = vscode.Uri.file(foundPath);
          const uint8Array = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(uint8Array).toString('utf8');
          // Basic truncation if file is too large
          const truncated = content.length > 10000 ? content.substring(0, 10000) + '\n... [truncated]' : content;
          
          resolved.push({
            filePath: foundPath,
            content: truncated,
            reason: `Imported by reviewed file: ${importPath}`
          });
          seen.add(foundPath);
        } catch {
          // ignore
        }
      }
    }
    return resolved;
  }
}
