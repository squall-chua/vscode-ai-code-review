import * as path from 'path';
import { createHash } from 'crypto';
import type { ReviewIssue, ReviewResult, IssueSeverity } from '../types';

const SECTION_PATTERNS: { severity: IssueSeverity; pattern: RegExp }[] = [
  { severity: 'critical', pattern: /^##\s+Critical Issues?\s*$/im },
  { severity: 'warning', pattern: /^##\s+Warnings?\s*$/im },
  { severity: 'info', pattern: /^##\s+Suggestions?\s*$/im },
];

const SUMMARY_PATTERN = /^##\s+Summary\s*$/im;

/**
 * Parses the Markdown output from the AI into a structured ReviewResult.
 * Handles path resolution and line number offsets for selected code fragments.
 */
export class ReviewParser {
  /**
   * Reference pattern for issues in AI output: **[FILEPATH:LINE]** Description
   * Uses a regex that captures the entire bracket content to handle paths with colons.
   */
  private readonly ISSUE_PATTERN = /\*\*\[([^\]]+)\]\*\*\s+(.+?)(?:\n\s+[-*]\s+💡\s+Suggestion:\s*([\s\S]+?))?(?=\n\s*[-*]|\n\n|$)/g;

  parse(markdown: string, primaryFilePath: string, contextFiles: string[], suppressedCount: number, startLine?: number): ReviewResult {
    const issues = this.extractIssues(markdown, primaryFilePath, contextFiles, startLine);
    const summary = this.extractSummary(markdown);
    return { issues, summary, contextFilesRead: contextFiles, suppressedCount };
  }

  private extractIssues(markdown: string, primaryFilePath: string, contextFiles: string[], startLine?: number): ReviewIssue[] {
    const issues: ReviewIssue[] = [];

    for (const { severity, pattern } of SECTION_PATTERNS) {
      const sectionMatch = pattern.exec(markdown);
      if (!sectionMatch) continue;

      const nextHeadingMatch = /^##\s+/im.exec(markdown.slice(sectionMatch.index + sectionMatch[0].length));
      const sectionText = nextHeadingMatch
        ? markdown.slice(sectionMatch.index + sectionMatch[0].length, sectionMatch.index + sectionMatch[0].length + nextHeadingMatch.index)
        : markdown.slice(sectionMatch.index + sectionMatch[0].length);

      const re = new RegExp(this.ISSUE_PATTERN.source, this.ISSUE_PATTERN.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(sectionText)) !== null) {
        const bracketText = match[1];
        const message = match[2];
        const suggestion = match[3];

        const lastColonIdx = bracketText.lastIndexOf(':');
        if (lastColonIdx === -1) continue;

        const rawPath = bracketText.substring(0, lastColonIdx).trim();
        const lineStr = bracketText.substring(lastColonIdx + 1).trim();
        let line = parseInt(lineStr, 10);

        if (isNaN(line)) continue;

        const resolvedPath = this.resolvePath(rawPath, primaryFilePath, contextFiles);

        // Adjust line number if this was a selection (relative to selection start)
        if (resolvedPath === primaryFilePath && startLine && startLine > 1 && line < startLine) {
          line = startLine + (line - 1);
        }

        issues.push({
          id: this.hashIssue(resolvedPath, line, message.trim()),
          severity,
          filePath: resolvedPath,
          line,
          message: message.trim(),
          suggestion: suggestion?.trim()
        });
      }
    }

    return issues;
  }

  private resolvePath(reportedPath: string, primaryFilePath: string, contextFiles: string[]): string {
    const normalizedReported = reportedPath.replace(/\\/g, '/');
    const bPrimary = path.basename(primaryFilePath);
    
    if (normalizedReported === bPrimary || normalizedReported === primaryFilePath || primaryFilePath.endsWith(normalizedReported)) {
      return primaryFilePath;
    }

    for (const contextPath of contextFiles) {
      const bContext = path.basename(contextPath);
      if (normalizedReported === bContext || normalizedReported === contextPath || contextPath.endsWith(normalizedReported)) {
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
    return nextHeading ? markdown.slice(start, start + nextHeading.index).trim() : markdown.slice(start).trim();
  }

  private hashIssue(filePath: string, line: number, message: string): string {
    return createHash('sha256')
      .update(`${filePath}:${line}:${message}`)
      .digest('hex')
      .slice(0, 16);
  }
}
