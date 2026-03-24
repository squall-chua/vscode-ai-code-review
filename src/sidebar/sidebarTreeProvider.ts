import * as vscode from 'vscode';
import type { ProfileManager } from '../profiles/profileManager';

// ── Item types ────────────────────────────────────────────────────────────────

export class SidebarItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    options: {
      iconId?: string;
      description?: string;
      tooltip?: string;
      command?: vscode.Command;
      contextValue?: string;
    } = {}
  ) {
    super(label, collapsibleState);
    if (options.iconId) this.iconPath = new vscode.ThemeIcon(options.iconId);
    if (options.description) this.description = options.description;
    if (options.tooltip) this.tooltip = options.tooltip;
    if (options.command) this.command = options.command;
    if (options.contextValue) this.contextValue = options.contextValue;
  }
}

// ── Section roots ─────────────────────────────────────────────────────────────

function makeSettingsSection(): SidebarItem[] {
  const config = vscode.workspace.getConfiguration('aiReview');
  const maxFiles = config.get<number>('maxContextFiles', 5);
  const scope = config.get<string>('suppressionScope', 'workspace');
  return [
    new SidebarItem('Max Context Files', vscode.TreeItemCollapsibleState.None, {
      iconId: 'symbol-number',
      description: String(maxFiles),
      tooltip: 'aiReview.maxContextFiles — edit in Settings',
      command: { command: 'workbench.action.openSettings', title: 'Open Settings', arguments: ['aiReview.maxContextFiles'] },
    }),
    new SidebarItem('Suppression Scope', vscode.TreeItemCollapsibleState.None, {
      iconId: 'mute',
      description: scope,
      tooltip: 'aiReview.suppressionScope — edit in Settings',
      command: { command: 'workbench.action.openSettings', title: 'Open Settings', arguments: ['aiReview.suppressionScope'] },
    }),
    new SidebarItem('Manage Suppressed Issues', vscode.TreeItemCollapsibleState.None, {
      iconId: 'list-unordered',
      command: { command: 'aiReview.manageSuppressed', title: 'Manage Suppressed Issues' },
    }),
    new SidebarItem('Clear Inline Annotations', vscode.TreeItemCollapsibleState.None, {
      iconId: 'clear-all',
      command: { command: 'aiReview.clearDecorations', title: 'Clear Inline Annotations' },
    }),
  ];
}

// ── Profiles Tree ─────────────────────────────────────────────────────────────

export class ProfilesTreeProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly profileManager: ProfileManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SidebarItem[] {
    const profiles = this.profileManager.listProfiles();
    const active = this.profileManager.getActiveProfile();

    if (profiles.length === 0) {
      return [
        new SidebarItem('No profiles — click + to create one', vscode.TreeItemCollapsibleState.None, {
          iconId: 'info',
        }),
      ];
    }

    return profiles.map((p) => {
      const isActive = p.id === active?.id;
      return new SidebarItem(p.name, vscode.TreeItemCollapsibleState.None, {
        iconId: isActive ? 'check' : 'account',
        description: `${p.provider} · ${p.modelId}`,
        tooltip: isActive ? `Active profile: ${p.name}` : `Click to activate ${p.name}`,
        contextValue: isActive ? 'profile-active' : 'profile-inactive',
        command: isActive
          ? undefined
          : {
              command: 'aiReview.sidebar.activateProfile',
              title: 'Activate Profile',
              arguments: [p.id],
            },
      });
    });
  }
}

// ── Settings Tree ─────────────────────────────────────────────────────────────

export class ConfigTreeProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SidebarItem[] {
    return makeSettingsSection();
  }
}
