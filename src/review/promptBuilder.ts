import type { ReviewContext, ReviewProfile } from '../types';

export const DEFAULT_PERSONA = `
You are an expert AI code reviewer. Your task is to meticulously analyze the provided code diff and offer insightful, actionable feedback. Focus on:
1.  **Potential Bugs:** Identify logical errors, edge cases, race conditions, security vulnerabilities (e.g., XSS, SQLi), etc.
2.  **Best Practices & Design Patterns:** Suggest improvements based on established software engineering principles (SOLID, DRY, KISS) and relevant design patterns.
3.  **Readability & Maintainability:** Comment on code clarity, naming conventions (e.g., camelCase for variables/functions, PascalCase for classes), complexity (e.g., Cyclomatic complexity), and opportunities for simplification or refactoring. Mention magic numbers or hardcoded strings if they appear.
4.  **Performance:** Highlight any potential performance bottlenecks (e.g., inefficient loops, unnecessary computations) or suggest optimizations.
5.  **Testability:** Comment on how easy or difficult the code would be to test (e.g., presence of side effects, tight coupling) and suggest improvements for better testability.
6.  **Style Guide Adherence (General):** Point out common style issues (e.g., inconsistent indentation, mixed quotes). Assume a generally accepted style guide like Google's JavaScript Style Guide or Python's PEP 8 if the language is identifiable.
7.  **Security Considerations:** If applicable, point out any security flaws or areas that need hardening.
8.  **Clarity of Comments and Documentation:** Assess if comments are helpful, or if code needs more comments or better docstrings.
`;

/** Fixed operational instructions — not editable by user. */
const OPERATIONAL_INSTRUCTIONS = `
## Your Task

Provide feedback in a clear, concise, and constructive manner. Use markdown for formatting your review, especially for:
- Bullet points for listing issues.
- Code blocks (using \`\`\`language\ncode\n\`\`\`) for suggesting code changes or highlighting specific code snippets.
- Bold text for emphasizing key points.

## Output Format (MANDATORY)

Your response MUST follow this exact structure:

## Critical Issues
List bugs, security vulnerabilities, data loss risks, or breaking changes.
Format each item as:
- **[FILEPATH:LINE]** Description of the issue.
  - 💡 Suggestion: (optional fix suggestion)

## Warnings
List code smells, performance issues, maintainability concerns.
Format each item as:
- **[FILEPATH:LINE]** Description of the issue.
  - 💡 Suggestion: (optional fix suggestion)

## Suggestions
List stylistic improvements, refactoring opportunities, best practice recommendations.
Format each item as:
- **[FILEPATH:LINE]** Description of the suggestion.

## Summary
A concise 2-4 sentence summary of the overall code quality and main themes found.

## Rules
- Skip generated files (e.g. lock files, build outputs, etc.)
- ALWAYS use the **[FILEPATH:LINE]** format for every issue. Example: **[src/auth.ts:42]**
- For git diffs, reference the modified file path and line number from the diff header.
- For selections, use the original file path with absolute line numbers.
- If no issues are found in a section, write "No issues found."
- Do NOT invent issues. Only report genuine problems.
- Be specific and actionable.
- If the diff is empty, trivial, or contains no significant code changes (e.g., only comments or whitespace changes), state that clearly.
- Begin your review directly without introductory phrases like "Here's my review".
- Structure your feedback logically, perhaps by file or by type of issue.
- Be specific in your suggestions. Instead of saying "this could be better", explain *how* it could be better.
`.trim();

/**
 * Builds the system and user prompts for the review request.
 *
 * Part A (persona) = customizable per profile.
 * Part B (operational) = fixed, enforces output format.
 */
export class PromptBuilder {
  buildSystemPrompt(profile: ReviewProfile, suppressedIssueDescriptions: string[]): string {
    const persona = (profile.customPersonaPrompt?.trim() || DEFAULT_PERSONA).trim();

    let suppressionNote = '';
    if (suppressedIssueDescriptions.length > 0) {
      const list = suppressedIssueDescriptions.map((d) => `- ${d}`).join('\n');
      suppressionNote = `\n\n## Suppressed Issues (DO NOT REPORT THESE)\nThe following issues have been acknowledged and suppressed by the developer. Do NOT raise them again:\n${list}`;
    }

    return `${persona}\n\n${OPERATIONAL_INSTRUCTIONS}${suppressionNote}`;
  }

  buildUserMessage(ctx: ReviewContext): string {
    const header = this.buildReviewHeader(ctx);
    const contextSection = this.buildContextSection(ctx);
    const startLineNote = ctx.startLine ? `\n(Note: This selection starts at line ${ctx.startLine} of the file)` : '';
    return `${header}${startLineNote}\n\n\`\`\`${ctx.language}\n${ctx.code}\n\`\`\`\n\n${contextSection}`.trim();
  }

  private buildReviewHeader(ctx: ReviewContext): string {
    const typeLabel: Record<string, string> = {
      gitDiff: 'Git Diff Review',
      activeFile: `File Review: ${ctx.filePath}`,
      selection: `Selection Review (from ${ctx.filePath})`,
      selectedFiles: `Multi-File Review: ${ctx.filePath}`,
    };
    const startLineInfo = ctx.startLine ? ` at lines ${ctx.startLine}-${ctx.startLine + ctx.code.split('\n').length - 1}` : '';
    return `Please review the following code (${typeLabel[ctx.reviewType]}${startLineInfo}):`;
  }

  private buildContextSection(ctx: ReviewContext): string {
    if (ctx.relatedFiles.length === 0) return '';

    const sections = ctx.relatedFiles.map(
      (f) =>
        `### Context File: ${f.filePath}\n(${f.reason})\n\`\`\`\n${f.content}\n\`\`\``
    );

    return `---\n## Additional Context Files\nThe following files were read to provide context for the review:\n\n${sections.join('\n\n')}`;
  }
}
