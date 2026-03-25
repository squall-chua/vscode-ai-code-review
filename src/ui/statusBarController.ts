import * as vscode from 'vscode';
import type { ProfileManager } from '../profiles/profileManager';

/**
 * Status bar item showing the active profile + model, spinner during review.
 */
export class StatusBarController {
  private readonly item: vscode.StatusBarItem;
  private isReviewing = false;

  constructor(private readonly profileManager: ProfileManager) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'aiReview.openSettings';
    this.item.tooltip = 'Click to open AI review settings';
    this.update();
    this.item.show();
    vscode.commands.registerCommand('aiReview.sidebar.updateStatusBar', () => this.update());
  }

  update(): void {
    if (this.isReviewing) return;
    const profile = this.profileManager.getActiveProfile();
    if (!profile) {
      this.item.text = '$(beaker) AI Review: No profile';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(beaker) ${profile.name} · ${profile.modelId}`;
      this.item.backgroundColor = undefined;
    }
  }

  setReviewing(label: string): void {
    this.isReviewing = true;
    this.item.text = `$(sync~spin) Reviewing ${label}…`;
    this.item.backgroundColor = undefined;
  }

  setIdle(): void {
    this.isReviewing = false;
    this.update();
  }

  dispose(): void {
    this.item.dispose();
  }
}
