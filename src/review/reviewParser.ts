import { createHash } from 'crypto';
import type { ReviewIssue, ReviewResult, IssueSeverity } from '../types';

const SECTION_PATTERNS: { severity: IssueSeverity; pattern: RegExp }[] = [
  { severity: 'critical', pattern: /^##\s+Critical Issues?\s*$/im },
  { severity: 'warning', pattern: /^##\s+Warnings?\s*$/im },
  { severity: 'info', pattern: /^##\s+Suggestions?\s*$/im },
];

const SUMMARY_PATTERN = /^##\s+Summary\s*$/im;

/**
 * Reference format in AI output: **[src/foo.ts:42]** Description
 */
const ISSUE_LINE_PATTERN = /\*\*\[([^:\]]+):(\d+)\]\*\*\s+(.+?)(?:\n\s+[-*]\s+💡\s+Suggestion:\s*([\s\S]+?))?(?=\n\s*[-*]|\n\n|$)/g;

export class ReviewParser {
  parse(markdown: string, contextFilesRead: string[], suppressedCount: number): ReviewResult {
    const issues = this.extractIssues(markdown);
    const summary = this.extractSummary(markdown);
    return { issues, summary, contextFilesRead, suppressedCount };
  }

  private extractIssues(markdown: string): ReviewIssue[] {
    const issues: ReviewIssue[] = [];

    for (const { severity, pattern } of SECTION_PATTERNS) {
      const sectionMatch = pattern.exec(markdown);
      if (!sectionMatch) continue;

      const sectionStart = sectionMatch.index + sectionMatch[0].length;
      // Section ends at the next ## heading
      const nextHeadingMatch = /^##\s+/im.exec(markdown.slice(sectionStart));
      const sectionText = nextHeadingMatch
        ? markdown.slice(sectionStart, sectionStart + nextHeadingMatch.index)
        : markdown.slice(sectionStart);

      const re = new RegExp(ISSUE_LINE_PATTERN.source, ISSUE_LINE_PATTERN.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(sectionText)) !== null) {
        const [, filePath, lineStr, message, suggestion] = match;
        const line = parseInt(lineStr, 10);

        const issue: ReviewIssue = {
          id: this.hashIssue(filePath, line, message.trim()),
          severity,
          filePath: filePath.trim(),
          line,
          message: message.trim(),
          suggestion: suggestion?.trim(),
        };
        issues.push(issue);
      }
    }

    return issues;
  }

  private extractSummary(markdown: string): string {
    const match = SUMMARY_PATTERN.exec(markdown);
    if (!match) return '';
    const after = markdown.slice(match.index + match[0].length).trim();
    // Take text until next ## heading
    const next = /^##\s+/im.exec(after);
    return (next ? after.slice(0, next.index) : after).trim();
  }

  private hashIssue(filePath: string, line: number, message: string): string {
    return createHash('sha256')
      .update(`${filePath}:${line}:${message}`)
      .digest('hex')
      .slice(0, 16);
  }
}
