import * as vscode from 'vscode';
import type { SuppressedEntry, SuppressionScope, ReviewIssue } from '../types';

const WORKSPACE_KEY = 'aiReview.suppressed.workspace';
const GLOBAL_KEY = 'aiReview.suppressed.global';

/**
 * Persists suppressed issues per scope:
 * - 'file'      → workspaceState, scoped to filePath
 * - 'workspace' → workspaceState, all files in workspace
 * - 'global'    → globalState, applies in any workspace
 */
export class SuppressionStore {
  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly globalState: vscode.Memento
  ) {}

  /** Returns suppressed issue IDs that apply to the given filePath. */
  getSuppressedIdsForFile(filePath: string): Set<string> {
    const workspace = this.workspaceState.get<SuppressedEntry[]>(WORKSPACE_KEY, []);
    const global = this.globalState.get<SuppressedEntry[]>(GLOBAL_KEY, []);

    const ids = new Set<string>();
    for (const entry of [...workspace, ...global]) {
      if (entry.scope === 'global' || entry.scope === 'workspace') {
        ids.add(entry.issueId);
      } else if (entry.scope === 'file' && entry.filePath === filePath) {
        ids.add(entry.issueId);
      }
    }
    return ids;
  }

  /** Returns all suppressed issue descriptions for use in the prompt (to tell AI to skip them). */
  getAllSuppressedDescriptions(): string[] {
    const workspace = this.workspaceState.get<SuppressedEntry[]>(WORKSPACE_KEY, []);
    const global = this.globalState.get<SuppressedEntry[]>(GLOBAL_KEY, []);
    return [...workspace, ...global].map((e) => e.message);
  }

  filterIssues(issues: ReviewIssue[], filePath: string): { passing: ReviewIssue[]; suppressedCount: number } {
    const ids = this.getSuppressedIdsForFile(filePath);
    const passing = issues.filter((i) => !ids.has(i.id));
    return { passing, suppressedCount: issues.length - passing.length };
  }

  async suppress(issue: ReviewIssue, scope: SuppressionScope): Promise<void> {
    const entry: SuppressedEntry = {
      issueId: issue.id,
      message: issue.message,
      filePath: issue.filePath,
      scope,
      suppressedAt: new Date().toISOString(),
      line: issue.line,
    };

    if (scope === 'global') {
      await this.appendToState(this.globalState, GLOBAL_KEY, entry);
    } else {
      await this.appendToState(this.workspaceState, WORKSPACE_KEY, entry);
    }
  }

  async unsuppress(issueId: string): Promise<void> {
    await this.filterFromState(this.workspaceState, WORKSPACE_KEY, issueId);
    await this.filterFromState(this.globalState, GLOBAL_KEY, issueId);
  }

  async clearAll(): Promise<void> {
    await this.workspaceState.update(WORKSPACE_KEY, []);
    await this.globalState.update(GLOBAL_KEY, []);
  }

  getAllEntries(): SuppressedEntry[] {
    const workspace = this.workspaceState.get<SuppressedEntry[]>(WORKSPACE_KEY, []);
    const global = this.globalState.get<SuppressedEntry[]>(GLOBAL_KEY, []);
    return [...workspace, ...global];
  }

  isSuppressed(issueId: string): boolean {
    return this.getAllEntries().some(e => e.issueId === issueId);
  }

  private async appendToState(memento: vscode.Memento, key: string, entry: SuppressedEntry): Promise<void> {
    const existing = memento.get<SuppressedEntry[]>(key, []);
    // Deduplicate by issueId
    const filtered = existing.filter((e) => e.issueId !== entry.issueId);
    await memento.update(key, [...filtered, entry]);
  }

  private async filterFromState(memento: vscode.Memento, key: string, issueId: string): Promise<void> {
    const existing = memento.get<SuppressedEntry[]>(key, []);
    await memento.update(key, existing.filter((e) => e.issueId !== issueId));
  }
}
