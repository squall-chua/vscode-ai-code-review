import * as path from 'path';
import { createHash } from 'crypto';
import type { ReviewIssue, ReviewResult, IssueSeverity } from '../types';

const SECTION_PATTERNS: { severity: IssueSeverity; pattern: RegExp }[] = [
  { severity: 'critical', pattern: /^##\s+Critical Issues?\s*$/im },
  { severity: 'warning', pattern: /^##\s+Warnings?\s*$/im },
  { severity: 'info', pattern: /^##\s+Suggestions?\s*$/im },
];

const SUMMARY_PATTERN = /^##\s+Summary\s*$/im;

export class ReviewParser {
  private readonly ISSUE_HEADER_PATTERN = /\*\*\[([^\]]+)\]\*\*\s+([^\r\n]+)/;
  private readonly SUGGESTION_PATTERN = /💡\s*Suggestion:\s*([\s\S]+)/m;

  public parse(
    markdown: string, 
    primaryFilePath: string, 
    contextFiles: string[], 
    suppressedCount: number, 
    startLine?: number
  ): ReviewResult {
    const issues: ReviewIssue[] = [];

    for (const { severity, pattern } of SECTION_PATTERNS) {
      const sectionMatch = pattern.exec(markdown);
      if (!sectionMatch) continue;

      const sectionStart = sectionMatch.index + sectionMatch[0].length;
      const nextHeadingMatch = /^##\s+/im.exec(markdown.slice(sectionStart));
      const sectionText = nextHeadingMatch
        ? markdown.slice(sectionStart, sectionStart + nextHeadingMatch.index)
        : markdown.slice(sectionStart);

      // Split into blocks that start with optional dash + marker
      // Using a capture group for start-of-line issue markers
      const blocks = sectionText.split(/(?:\r?\n|^)\s*(?:[-*]\s*)?\*\*\[/);
      
      for (const block of blocks) {
        if (!block.trim() || !block.includes(']**')) continue;
        
        // Since we split by the start of marker, we need to prefix the marker back if we want to reuse patterns
        // Or just parse the already split block. 
        // Actually, splitting by the marker means the marker IS at the start of the block (minus the parts we split on).
        // Let's re-join the marker part or use a better regex for each entry.
        
        // Better: just find all matches in the section text
        const matches = [...sectionText.matchAll(/(?:\r?\n|^)\s*(?:[-*]\s*)?\*\*\[([^\]]+)\]\*\*\s+([^\r\n]+)([\s\S]*?)(?=(?:\r?\n\s*(?:[-*]\s*)?\*\*\[)|$)/g)];
        
        for (const match of matches) {
          const locationStr = match[1];
          const message = match[2].trim();
          const contentAfter = match[3];

          const suggestionMatch = this.SUGGESTION_PATTERN.exec(contentAfter);
          const suggestion = suggestionMatch ? suggestionMatch[1].trim() : undefined;

          const parts = locationStr.split(':');
          const lineStr = parts.pop()?.trim() || '0';
          const rawPath = parts.join(':').trim();

          let line = parseInt(lineStr, 10);
          if (isNaN(line)) line = 0;

          const resolvedPath = this.resolvePath(rawPath, primaryFilePath, contextFiles);
          
          const isPrimary = resolvedPath === primaryFilePath;
          const offset = (startLine && startLine > 1) ? startLine - 1 : 0;
          const finalLine = (isPrimary && offset > 0 && line < startLine!) ? line + offset : line;

          issues.push({
            id: this.hashIssue(resolvedPath, finalLine, message),
            severity,
            filePath: resolvedPath,
            line: finalLine,
            message,
            suggestion
          });
        }
        break; // Only run matchAll once per section
      }
    }

    const summary = this.extractSummary(markdown);
    
    return { 
        issues, 
        summary, 
        markdownReport: markdown, 
        contextFilesRead: contextFiles, 
        suppressedCount 
    };
  }

  private resolvePath(reportedPath: string, primaryFilePath: string, contextFiles: string[]): string {
    const normalizedReported = reportedPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const bPrimary = path.basename(primaryFilePath).replace(/\\/g, '/');
    const bPrimaryFull = primaryFilePath.replace(/\\/g, '/');
    
    if (normalizedReported === bPrimary || normalizedReported === bPrimaryFull || bPrimaryFull.endsWith(normalizedReported)) {
      return primaryFilePath;
    }

    for (const contextPath of contextFiles) {
      const bContext = path.basename(contextPath).replace(/\\/g, '/');
      const bContextFull = contextPath.replace(/\\/g, '/');
      if (normalizedReported === bContext || normalizedReported === bContextFull || bContextFull.endsWith(normalizedReported)) {
        return contextPath;
      }
    }

    return reportedPath;
  }

  private extractSummary(markdown: string): string {
    const match = SUMMARY_PATTERN.exec(markdown);
    if (!match) return '';
    const start = match.index + match[0].length;
    const nextHeading = /^##\s+/im.exec(markdown.slice(start));
    return nextHeading 
        ? markdown.slice(start, start + nextHeading.index).trim() 
        : markdown.slice(start).trim();
  }

  private hashIssue(filePath: string, line: number, message: string): string {
    return createHash('sha256')
      .update(`${filePath}:${line}:${message}`)
      .digest('hex')
      .slice(0, 16);
  }
}
