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
    this.item.command = 'aiReview.switchProfile';
    this.item.tooltip = 'Click to switch AI review profile';
    this.update();
    this.item.show();
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
