import { describe, it, expect } from 'vitest';
import { ReviewParser } from '../review/reviewParser';

const SAMPLE_MARKDOWN = `
## Critical Issues
- **[src/auth.ts:42]** SQL injection vulnerability: user input is concatenated directly into query.
  - 💡 Suggestion: Use parameterized queries or an ORM.
- **[src/auth.ts:67]** Password stored in plaintext.

## Warnings
- **[src/utils/logger.ts:12]** console.log leaks sensitive data in production.
  - 💡 Suggestion: Use a structured logger with log levels.

## Suggestions
- **[src/models/user.ts:88]** Consider extracting this block into a separate method for readability.

## Summary
The code has critical security vulnerabilities that must be addressed before deployment. The SQL injection and plaintext password issues pose immediate risk.
`;

describe('ReviewParser', () => {
  const parser = new ReviewParser();

  it('parses critical issues', () => {
    const result = parser.parse(SAMPLE_MARKDOWN, 'src/auth.ts', [], 0);
    const criticals = result.issues.filter((i) => i.severity === 'critical');
    expect(criticals).toHaveLength(2);
    expect(criticals[0].filePath).toBe('src/auth.ts');
    expect(criticals[0].line).toBe(42);
    expect(criticals[0].suggestion).toBe('Use parameterized queries or an ORM.');
  });

  it('parses warnings', () => {
    const result = parser.parse(SAMPLE_MARKDOWN, 'src/auth.ts', [], 0);
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].filePath).toBe('src/utils/logger.ts');
    expect(warnings[0].line).toBe(12);
  });

  it('parses suggestions', () => {
    const result = parser.parse(SAMPLE_MARKDOWN, 'src/auth.ts', [], 0);
    const info = result.issues.filter((i) => i.severity === 'info');
    expect(info).toHaveLength(1);
    expect(info[0].line).toBe(88);
  });

  it('extracts summary', () => {
    const result = parser.parse(SAMPLE_MARKDOWN, 'src/auth.ts', [], 0);
    expect(result.summary).toContain('critical security vulnerabilities');
  });

  it('generates stable id from same issue', () => {
    const result1 = parser.parse(SAMPLE_MARKDOWN, 'src/auth.ts', [], 0);
    const result2 = parser.parse(SAMPLE_MARKDOWN, 'src/auth.ts', [], 0);
    expect(result1.issues[0].id).toBe(result2.issues[0].id);
  });

  it('handles empty sections gracefully', () => {
    const emptyMarkdown = `
## Critical Issues
No issues found.

## Warnings
No issues found.

## Suggestions
No issues found.

## Summary
Code looks clean.
`;
    const result = parser.parse(emptyMarkdown, 'src/auth.ts', [], 0);
    expect(result.issues).toHaveLength(0);
    expect(result.summary).toBe('Code looks clean.');
  });
});
