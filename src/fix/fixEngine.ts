import * as vscode from 'vscode';
import type { ReviewIssue } from '../types';

/**
 * Generates a prompt for fixing a single issue and copies it to the clipboard.
 */
/**
 * Generates a prompt for fixing code review issues and copies it to the clipboard.
 * Supports multiple issues across one or more files.
 */
export class FixEngine {
  /**
   * Generates a fix prompt and copies it to the clipboard.
   * @param items Array of issue-document pairs to include in the prompt.
   */
  async copyPrompt(items: Array<{ issue: ReviewIssue; document: vscode.TextDocument }>): Promise<void> {
    if (items.length === 0) return;

    const issueCount = items.length;
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '💬 Chat AI',
          description: 'Optimized for chat interfaces (outputs corrected code snippets)',
          type: 'chat',
        },
        {
          label: '🤖 Agentic AI',
          description: 'Optimized for autonomous agents (includes file paths and editing instructions)',
          type: 'agent',
        },
      ],
      { placeHolder: `Fix ${issueCount} selected ${issueCount === 1 ? 'issue' : 'issues'}` }
    );

    if (!choice) return;

    let prompt = '';

    if (choice.type === 'chat') {
      prompt = `You are an expert developer. Please fix the following code review issues. For each fix, output the file name and line number followed by the corrected code block using markdown fences (e.g., \`\`\`typescript ... \`\`\`). No lengthy explanations.\n\n`;

      // Group by file
      const fileMap = new Map<string, { doc: vscode.TextDocument | null; issues: ReviewIssue[] }>();
      for (const { issue, document } of items) {
        const key = issue.filePath || 'Unknown File';
        if (!fileMap.has(key)) {
          fileMap.set(key, { doc: document, issues: [] });
        }
        fileMap.get(key)!.issues.push(issue);
      }

      for (const [filePath, { doc, issues }] of fileMap) {
        prompt += `### FILE: ${filePath}\n`;
        prompt += `ISSUES:\n`;
        for (const issue of issues) {
          prompt += `- Line ${issue.line}: ${issue.message}\n`;
          if (issue.suggestion) prompt += `  Suggested: ${issue.suggestion}\n`;
        }

        if (doc) {
          const lines = doc.getText().split('\n');
          const contextIndices = new Set<number>();
          for (const issue of issues) {
            const targetLine = Math.max(0, issue.line - 1);
            const start = Math.max(0, targetLine - 10);
            const end = Math.min(lines.length, targetLine + 11);
            for (let i = start; i < end; i++) contextIndices.add(i);
          }

          const ranges = this.getContiguousRanges(Array.from(contextIndices));
          prompt += `\nORIGINAL CODE:\n`;
          for (const range of ranges) {
            prompt += `Lines ${range.start + 1} to ${range.end}:\n`;
            prompt += `\`\`\`${doc.languageId}\n`;
            prompt += lines.slice(range.start, range.end).join('\n') + '\n';
            prompt += `\`\`\`\n`;
          }
        } else {
          prompt += `\n(Original code not available in editor session. Refer to the file path above.)\n`;
        }
        prompt += `\n`;
      }
    } else {
      prompt = `Task: Fix the following code review issues across the project. Use your file editing tools to apply the fixes while maintaining code quality and patterns.\n\n`;
      for (const { issue } of items) {
        prompt += `- FILE: ${issue.filePath || 'Unknown File'}\n`;
        prompt += `  ISSUE: ${issue.message} (Line ${issue.line})\n`;
        if (issue.suggestion) prompt += `  SUGGESTED FIX: ${issue.suggestion}\n`;
        prompt += `\n`;
      }
    }

    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage(`Fix prompt for ${issueCount} ${issueCount === 1 ? 'issue' : 'issues'} copied to clipboard!`);
  }

  private getContiguousRanges(indices: number[]): Array<{ start: number; end: number }> {
    if (indices.length === 0) return [];
    indices.sort((a, b) => a - b);

    const ranges: Array<{ start: number; end: number }> = [];
    let start = indices[0];
    let current = start;

    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === current + 1) {
        current = indices[i];
      } else {
        ranges.push({ start, end: current + 1 });
        start = indices[i];
        current = start;
      }
    }
    ranges.push({ start, end: current + 1 });
    return ranges;
  }
}

