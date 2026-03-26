import * as path from 'path';
import type { ReviewCategory, ReviewContext, ReviewProfile } from '../types';

export const DEFAULT_PERSONA = `
You are an expert AI code reviewer. Your task is to meticulously analyze the provided code and offer insightful, actionable feedback.
`;

const CATEGORY_INSTRUCTIONS: Record<string, string> = {
  'general': `Conduct a multi-dimensional review covering all aspects of the code:
- Focus exclusively on finding logic errors, edge cases, race conditions, and potential runtime crashes.
- Evaluate the use of design patterns, SOLID principles, DRY, and industry-standard best practices.
- Focus on code structure, naming conventions, complexity, and how easy the code is to understand and maintain.
- Identify performance bottlenecks, inefficient algorithms, and resource leaks.
- Evaluate how easy it is to unit test this code and suggest improvements for testability.
- Strictly check for consistency with common style guides and idiomatic language usage.
- Analyze the code for security vulnerabilities, such as injection, data leaks, and improper authentication.
- Evaluate the quality and necessity of comments and documentation strings.`,
  'potential bugs': 'Focus exclusively on finding logic errors, edge cases, race conditions, and potential runtime crashes.',
  'best practices & design patterns': 'Evaluate the use of design patterns, SOLID principles, DRY, and industry-standard best practices.',
  'readability & maintainability': 'Focus on code structure, naming conventions, complexity, and how easy the code is to understand and maintain.',
  'performance': 'Identify performance bottlenecks, inefficient algorithms, and resource leaks.',
  'testability': 'Evaluate how easy it is to unit test this code and suggest improvements for testability.',
  'style guide adherence': 'Strictly check for consistency with common style guides and idiomatic language usage.',
  'security considerations': 'Analyze the code for security vulnerabilities, such as injection, data leaks, and improper authentication.',
  'clarity of comments': 'Evaluate the quality and necessity of comments and documentation strings.'
};

/** Fixed operational instructions — not editable by user. */
const OPERATIONAL_INSTRUCTIONS = `
## Your Task

Provide feedback in a clear, concise, and constructive manner. Use markdown for formatting.

## Code Format

Code snippets provided to you may have line numbers prepended in the format \`N: code line\`. 
ALWAYS use these line numbers when referencing specific lines in your feedback.

## Output Format (MANDATORY)

Your response MUST follow this exact structure:

## Critical Issues
List bugs, security vulnerabilities, data loss risks, or breaking changes.
Format each item as:
- **[FILEPATH:LINE_SPEC]** Description of the issue.
  - 💡 Suggestion: (optional fix suggestion)

## Warnings
List code smells, performance issues, maintainability concerns.
Format each item as:
- **[FILEPATH:LINE_SPEC]** Description of the issue.
  - 💡 Suggestion: (optional fix suggestion)

## Suggestions
List stylistic improvements, refactoring opportunities, best practice recommendations.
Format each item as:
- **[FILEPATH:LINE_SPEC]** Description of the suggestion.

## Summary
A concise 2-4 sentence summary of the overall code quality and main themes found.

## Rules
- Skip generated files (e.g. lock files, build outputs).
- ALWAYS use the **[FILEPATH:LINE_SPEC]** format for every issue. 
- LINE_SPEC can be:
  - A single line: **[src/auth.ts:42]**
  - A range of lines: **[src/lib/utils.ts:10-25]**
  - A list of specific lines: **[src/main.ts:5,12,18]**
- For selections, use the provided absolute line numbers.
- If no issues are found in a section, write "No issues found."
- Do NOT invent issues. Only report genuine problems.
- Be specific and actionable.
- Structure your feedback logically.
`.trim();

/**
 * Builds the system and user prompts for the review request.
 */
export class PromptBuilder {
  buildSystemPrompt(profile: ReviewProfile, suppressedIssueDescriptions: string[], category?: ReviewCategory): string {
    const focusCategory = category || profile.defaultCategory;
    let persona = (profile.customPersonaPrompt?.trim() || DEFAULT_PERSONA).trim();

    if (focusCategory && CATEGORY_INSTRUCTIONS[focusCategory]) {
      persona += `\n\n**Category Focus:** ${CATEGORY_INSTRUCTIONS[focusCategory]}`;
    } else if (!profile.customPersonaPrompt) {
      // If no category and using default persona, add some general guidance
      persona += ` Focus on potential bugs, best practices, readability, performance, testability, style, security, and comment clarity.`;
    }

    let suppressionNote = '';
    if (suppressedIssueDescriptions.length > 0) {
      const list = suppressedIssueDescriptions.map((d) => `- ${d}`).join('\n');
      suppressionNote = `\n\n## Suppressed Issues (DO NOT REPORT THESE)\nThe following issues have been acknowledged and suppressed by the developer. Do NOT raise them again:\n${list}`;
    }

    return `${persona}\n\n${OPERATIONAL_INSTRUCTIONS}${suppressionNote}`;
  }

  buildUserMessage(ctx: ReviewContext): string {
    const formattedFilePath = this.relativizePath(ctx.filePath, ctx.workspaceRoot);
    const header = this.buildReviewHeader(ctx, formattedFilePath);
    const contextSection = this.buildContextSection(ctx);

    // Prepend line numbers to the code if it's not a diff
    const isDiff = ctx.language === 'diff';
    const displayCode = isDiff
      ? ctx.code
      : this.formatCodeWithLineNumbers(ctx.code, ctx.startLine || 1);

    const startLineNote = ctx.startLine ? `\n(Note: This selection starts at line ${ctx.startLine} of the file)` : '';
    return `${header}${startLineNote}\n\n\`\`\`${ctx.language}\n${displayCode}\n\`\`\`\n\n${contextSection}`.trim();
  }

  private buildReviewHeader(ctx: ReviewContext, formattedFilePath: string): string {
    const typeLabel: Record<string, string> = {
      gitDiff: 'Git Diff Review',
      activeFile: `File Review: ${formattedFilePath}`,
      selection: `Selection Review (from ${formattedFilePath})`,
      selectedFiles: `Multi-File Review: ${formattedFilePath}`,
    };

    const lines = ctx.code.split('\n').length;
    const startNum = ctx.startLine || 1;
    const endNum = startNum + lines - 1;
    const startLineInfo = ctx.reviewType === 'selection' || ctx.reviewType === 'activeFile'
      ? ` at lines ${startNum}-${endNum}`
      : '';

    return `Please review the following code (${typeLabel[ctx.reviewType]}${startLineInfo}):`;
  }

  private buildContextSection(ctx: ReviewContext): string {
    if (ctx.relatedFiles.length === 0) return '';

    const sections = ctx.relatedFiles.map(
      (f) => {
        const formattedContent = this.formatCodeWithLineNumbers(f.content, 1);
        const rel = this.relativizePath(f.filePath, ctx.workspaceRoot);
        return `### Context File: ${rel}\n(${f.reason})\n\`\`\`\n${formattedContent}\n\`\`\``;
      }
    );

    return `---\n## Additional Context Files\nThe following files were read to provide context for the review:\n\n${sections.join('\n\n')}`;
  }

  private formatCodeWithLineNumbers(code: string, startLine: number = 1): string {
    return code
      .split('\n')
      .map((line, idx) => `${startLine + idx}: ${line}`)
      .join('\n');
  }

  private relativizePath(fullPath: string, root?: string): string {
    if (!root || !path.isAbsolute(fullPath)) return fullPath;
    return path.relative(root, fullPath).replace(/\\/g, '/');
  }
}
