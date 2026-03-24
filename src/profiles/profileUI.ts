import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { ReviewProfile, ProviderId } from '../types';
import type { ProfileManager } from './profileManager';
import type { SecretsManager } from '../providers/secretsManager';
import { PROVIDER_REGISTRY } from '../providers/providerRegistry';

const DEFAULT_PERSONA =
  'You are a senior software engineer and expert code reviewer. Your reviews are thorough, constructive, and actionable.';

/**
 * Multi-step interactive UI for creating and editing review profiles.
 */
export class ProfileUI {
  constructor(
    private readonly profileManager: ProfileManager,
    private readonly secrets: SecretsManager
  ) {}

  /** Full create/edit flow. Returns the saved profile, or undefined if cancelled. */
  async runCreateOrEdit(existing?: ReviewProfile): Promise<ReviewProfile | undefined> {
    const profile = existing ? { ...existing } : this.profileManager.createEmptyProfile();
    const isNew = !existing;

    // Step 1 — Profile name
    const name = await vscode.window.showInputBox({
      title: isNew ? 'New Profile (1/5): Name' : 'Edit Profile (1/5): Name',
      prompt: 'Enter a descriptive name, e.g. "Work - GPT-4o" or "Local Ollama"',
      value: profile.name,
      validateInput: (v) => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (name === undefined) return undefined;
    profile.name = name.trim();

    // Step 2 — Provider
    const providerItems = PROVIDER_REGISTRY.map((p) => ({
      label: p.label,
      description: p.description,
      detail: `Package: ${p.packageName}`,
      id: p.id as ProviderId,
    }));

    const pickedProvider = await vscode.window.showQuickPick(providerItems, {
      title: isNew ? 'New Profile (2/5): Provider' : 'Edit Profile (2/5): Provider',
      placeHolder: `Current: ${profile.provider}`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!pickedProvider) return undefined;
    profile.provider = pickedProvider.id;

    const meta = PROVIDER_REGISTRY.find((p) => p.id === profile.provider)!;

    // Step 3 — API key (skip if not required, offer to keep existing)
    if (meta.requiresApiKey) {
      const existingKey = await this.secrets.getApiKey(profile.id);
      const keyPrompt = existingKey
        ? `Current key is set. Enter new key to replace, or leave blank to keep existing.`
        : `Enter your ${meta.label} API key`;

      const apiKey = await vscode.window.showInputBox({
        title: isNew ? 'New Profile (3/5): API Key' : 'Edit Profile (3/5): API Key',
        prompt: keyPrompt,
        password: true,
        ignoreFocusOut: true,
      });
      if (apiKey === undefined) return undefined; // Cancelled
      if (apiKey.trim()) {
        await this.secrets.setApiKey(profile.id, apiKey.trim());
      }
    }

    // Step 4 — Model ID
    const modelSuggestions = meta.defaultModels.map((m) => ({
      label: m,
      description: m === meta.defaultModels[0] ? '(recommended)' : undefined,
    }));

    const modelResult = await vscode.window.showQuickPick(
      [
        ...modelSuggestions,
        { label: '$(edit) Enter custom model ID...', description: undefined },
      ],
      {
        title: isNew ? 'New Profile (4/5): Model' : 'Edit Profile (4/5): Model',
        placeHolder: `Current: ${profile.modelId || meta.defaultModels[0]}`,
      }
    );
    if (!modelResult) return undefined;

    if (modelResult.label.startsWith('$(edit)')) {
      const customModel = await vscode.window.showInputBox({
        title: 'Custom Model ID',
        prompt: 'Enter the exact model ID (e.g. gpt-4o, claude-3-5-sonnet-20241022)',
        value: profile.modelId || meta.defaultModels[0],
        validateInput: (v) => (v.trim() ? undefined : 'Model ID cannot be empty'),
      });
      if (!customModel) return undefined;
      profile.modelId = customModel.trim();
    } else {
      profile.modelId = modelResult.label;
    }

    // Step 4b — Custom base URL (for providers that need it)
    if (meta.requiresBaseUrl) {
      const defaultUrl = meta.id === 'ollama' ? 'http://localhost:11434' : '';
      const url = await vscode.window.showInputBox({
        title: 'Profile: Custom Base URL',
        prompt: `Enter base URL for ${meta.label}`,
        value: profile.customBaseUrl ?? defaultUrl,
        validateInput: (v) => {
          try {
            if (v.trim()) new URL(v.trim());
            return undefined;
          } catch {
            return 'Enter a valid URL (e.g. http://localhost:11434)';
          }
        },
      });
      if (url === undefined) return undefined;
      profile.customBaseUrl = url.trim() || undefined;
    }

    // Step 5 — Custom persona prompt
    const personaItems = [
      { label: '$(check) Use default persona', id: 'default' },
      { label: '$(edit) Customize persona prompt...', id: 'custom' },
    ];
    const personaPick = await vscode.window.showQuickPick(personaItems, {
      title: isNew ? 'New Profile (5/5): Persona Prompt' : 'Edit Profile (5/5): Persona Prompt',
      placeHolder: `Default: "${DEFAULT_PERSONA.slice(0, 60)}..."`,
    });
    if (!personaPick) return undefined;

    if (personaPick.id === 'custom') {
      const persona = await vscode.window.showInputBox({
        title: 'Custom Persona Prompt',
        prompt:
          'Describe the AI reviewer role. This is prepended before the fixed operational instructions.',
        value: profile.customPersonaPrompt ?? DEFAULT_PERSONA,
        ignoreFocusOut: true,
      });
      if (persona === undefined) return undefined;
      profile.customPersonaPrompt = persona.trim() || undefined;
    } else {
      profile.customPersonaPrompt = undefined;
    }

    const saved = await this.profileManager.saveProfile(profile);
    vscode.window.showInformationMessage(`Profile "${saved.name}" saved.`);
    return saved;
  }

  /** QuickPick to switch the active profile. */
  async runSwitchProfile(): Promise<void> {
    const profiles = this.profileManager.listProfiles();
    if (profiles.length === 0) {
      const action = await vscode.window.showWarningMessage(
        'No profiles configured. Create one now?',
        'Create Profile',
        'Cancel'
      );
      if (action === 'Create Profile') await this.runCreateOrEdit();
      return;
    }

    const active = this.profileManager.getActiveProfile();
    const items = profiles.map((p) => ({
      label: p.name,
      description: `${p.provider} · ${p.modelId}`,
      detail: p.id === active?.id ? '$(check) Active' : undefined,
      id: p.id,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Switch AI Review Profile',
      placeHolder: 'Select a profile to activate',
      matchOnDescription: true,
    });
    if (!picked) return;

    await this.profileManager.setActiveProfile(picked.id);
    vscode.window.showInformationMessage(`Switched to profile: ${picked.label}`);
  }

  /** Manage profiles: create, edit, delete. */
  async runManageProfiles(): Promise<void> {
    const profiles = this.profileManager.listProfiles();

    const actions = [
      { label: '$(add) Create New Profile', action: 'create' as const },
      ...profiles.map((p) => ({
        label: p.name,
        description: `${p.provider} · ${p.modelId}`,
        action: 'select' as const,
        profile: p,
      })),
    ];

    const picked = await vscode.window.showQuickPick(actions, {
      title: 'Manage AI Review Profiles',
      placeHolder: profiles.length === 0 ? 'No profiles yet — create one' : 'Select a profile to edit or delete',
    });
    if (!picked) return;

    if (picked.action === 'create') {
      const newProfile = await this.runCreateOrEdit();
      if (newProfile && profiles.length === 0) {
        await this.profileManager.setActiveProfile(newProfile.id);
      }
      return;
    }

    // Edit or delete
    const profileAction = await vscode.window.showQuickPick(
      [
        { label: '$(edit) Edit Profile', id: 'edit' },
        { label: '$(trash) Delete Profile', id: 'delete' },
      ],
      { title: `Profile: ${picked.profile.name}`, placeHolder: 'Choose action' }
    );
    if (!profileAction) return;

    if (profileAction.id === 'edit') {
      await this.runCreateOrEdit(picked.profile);
    } else {
      const confirm = await vscode.window.showWarningMessage(
        `Delete profile "${picked.profile.name}"? This cannot be undone.`,
        { modal: true },
        'Delete'
      );
      if (confirm === 'Delete') {
        await this.profileManager.deleteProfile(picked.profile.id);
        await this.secrets.deleteApiKey(picked.profile.id);
        vscode.window.showInformationMessage(`Profile "${picked.profile.name}" deleted.`);
      }
    }
  }
}
