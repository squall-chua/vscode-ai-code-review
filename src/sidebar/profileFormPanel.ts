import * as vscode from 'vscode';
import type { ProfileManager } from '../profiles/profileManager';
import type { SecretsManager } from '../providers/secretsManager';
import type { ReviewProfile, ReviewCategory } from '../types';
import { PROVIDER_REGISTRY } from '../providers/providerRegistry';
import { DEFAULT_PERSONA } from '../review/promptBuilder';

interface ProfileFormData {
  id?: string;
  name: string;
  provider: string;
  apiKey: string;
  modelId: string;
  customBaseUrl: string;
  customPersonaPrompt: string;
  defaultCategory: string;
  maxOutputTokens: string;
}

export class ProfileFormPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aiReview.profileForm';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly profileManager: ProfileManager,
    private readonly secrets: SecretsManager,
    private readonly onSaved: () => void
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: { type: string; data?: ProfileFormData & { profileId?: string } }) => {
      switch (msg.type) {
        case 'submit': await this.handleSubmit(msg.data!); break;
        case 'delete': await this.handleDelete(msg.data!.profileId!); break;
        case 'cancel': void webviewView.webview.postMessage({ type: 'reset' }); break;
      }
    });
  }

  /** Open the form for a new profile (undefined) or existing profile (profile). */
  async open(profile: ReviewProfile | undefined): Promise<void> {
    if (!this._view) {
      await vscode.commands.executeCommand(`${ProfileFormPanel.viewId}.focus`);
    }

    const hasApiKey = profile ? !!(await this.secrets.getApiKey(profile.id)) : false;

    void this._view?.webview.postMessage({
      type: 'load',
      data: {
        profile: profile ?? null,
        providers: PROVIDER_REGISTRY.map((p) => ({
          id: p.id,
          label: p.label,
          requiresApiKey: p.requiresApiKey,
          requiresBaseUrl: p.requiresBaseUrl,
          defaultModels: p.defaultModels,
        })),
        hasApiKey,
        defaultPersona: DEFAULT_PERSONA.trim(),
        categories: [
          'general',
          'potential bugs',
          'best practices & design patterns',
          'readability & maintainability',
          'performance',
          'testability',
          'style guide adherence',
          'security considerations',
          'clarity of comments'
        ],
      },
    });
  }

  private async handleSubmit(data: ProfileFormData): Promise<void> {
    if (!data.name.trim()) {
      void this._view?.webview.postMessage({ type: 'error', data: { field: 'name', message: 'Profile name is required.' } });
      return;
    }
    if (!data.modelId.trim()) {
      void this._view?.webview.postMessage({ type: 'error', data: { field: 'modelId', message: 'Model ID is required.' } });
      return;
    }

    const profile: ReviewProfile = {
      id: data.id ?? `profile_${Date.now()}`,
      name: data.name.trim(),
      provider: data.provider as ReviewProfile['provider'],
      modelId: data.modelId.trim(),
      ...(data.customBaseUrl.trim() && { customBaseUrl: data.customBaseUrl.trim() }),
      ...(data.customPersonaPrompt.trim() && { customPersonaPrompt: data.customPersonaPrompt.trim() }),
      defaultCategory: data.defaultCategory as ReviewCategory,
      ...(data.maxOutputTokens && { maxOutputTokens: parseInt(data.maxOutputTokens) }),
    };

    await this.profileManager.saveProfile(profile);

    if (data.apiKey.trim()) {
      await this.secrets.setApiKey(profile.id, data.apiKey.trim());
    }

    // Auto-activate if it's the first profile
    if (!this.profileManager.getActiveProfile()) {
      await this.profileManager.setActiveProfile(profile.id);
    }

    void this._view?.webview.postMessage({ type: 'saved', data: { profile } });
    this.onSaved();
    void vscode.window.showInformationMessage(`Profile "${profile.name}" saved.`);
  }

  private async handleDelete(profileId: string): Promise<void> {
    const profile = this.profileManager.listProfiles().find((p) => p.id === profileId);
    if (!profile) return;

    const confirm = await vscode.window.showWarningMessage(
      `Delete profile "${profile.name}"?`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') return;

    await this.profileManager.deleteProfile(profileId);
    await this.secrets.deleteApiKey(profileId);
    void this._view?.webview.postMessage({ type: 'reset' });
    this.onSaved();
    void vscode.window.showInformationMessage(`Profile "${profile.name}" deleted.`);
  }

  private buildHtml(_webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="${csp}"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Profile Editor</title>
  <style nonce="${nonce}">
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 8px 12px;
      margin: 0;
    }
    h3 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; }
    .field { display: flex; flex-direction: column; margin-bottom: 10px; }
    label { font-size: 11px; margin-bottom: 4px; opacity: 0.8; }
    input, select, textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 4px 6px;
      font-family: inherit;
      font-size: inherit;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    textarea {
      resize: vertical;
      min-height: 120px;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--vscode-focusBorder);
    }
    textarea { resize: vertical; min-height: 60px; }
    .error-msg { color: var(--vscode-errorForeground); font-size: 11px; margin-top: 3px; }
    .hidden { display: none !important; }
    .actions { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
    button {
      padding: 5px 10px;
      font-size: 12px;
      font-family: inherit;
      border: none;
      border-radius: 2px;
      cursor: pointer;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-errorForeground);
      margin-left: auto;
    }
    .key-hint { font-size: 10px; opacity: 0.5; margin-top: 2px; }
    .empty-state { text-align: center; opacity: 0.5; padding: 20px 0; font-size: 12px; }
  </style>
</head>
<body>
  <div id="empty-state" class="empty-state">
    <p>Click <strong>+</strong> in the Profiles panel toolbar to create a profile.</p>
  </div>

  <form id="form" class="hidden" autocomplete="off">
    <h3 id="form-title">New Profile</h3>

    <div class="field">
      <label for="name">Profile Name *</label>
      <input id="name" type="text" placeholder="e.g. Work — Claude Sonnet"/>
      <span class="error-msg hidden" id="err-name"></span>
    </div>

    <div class="field">
      <label for="provider">Provider *</label>
      <select id="provider"></select>
    </div>

    <div class="field">
      <label for="apiKey">API Key</label>
      <input id="apiKey" type="password" placeholder="sk-…"/>
      <span class="key-hint" id="key-hint"></span>
    </div>

    <div class="field" id="baseUrl-field">
      <label for="baseUrl">Base URL</label>
      <input id="baseUrl" type="url" placeholder="http://localhost:11434"/>
    </div>

    <div class="field">
      <label for="modelId">Model ID *</label>
      <input id="modelId" type="text" list="model-suggestions"/>
      <datalist id="model-suggestions"></datalist>
      <span class="error-msg hidden" id="err-modelId"></span>
    </div>

    <div class="field">
      <label for="persona">Custom Persona (optional)</label>
      <textarea id="persona" placeholder="You are a senior software engineer…"></textarea>
    </div>
    
    <div class="field">
      <label for="defaultCategory">Default Focus Category</label>
      <select id="defaultCategory"></select>
    </div>

    <div class="field">
      <label for="maxOutputTokens">Response Token Limit (Leave blank for default)</label>
      <input id="maxOutputTokens" type="number" min="500" max="128000" step="500" placeholder="e.g. 4000"/>
    </div>

    <div class="actions">
      <button type="submit" class="btn-primary">Save</button>
      <button type="button" id="cancel-btn" class="btn-secondary">Cancel</button>
      <button type="button" id="delete-btn" class="btn-danger hidden">Delete</button>
    </div>
  </form>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentProfileId = null;
    let providers = [];

    const form = document.getElementById('form');
    const emptyState = document.getElementById('empty-state');

    function showForm() { form.classList.remove('hidden'); emptyState.classList.add('hidden'); }
    function showEmpty() { form.classList.add('hidden'); emptyState.classList.remove('hidden'); }

    function populateProviders(list) {
      providers = list;
      const sel = document.getElementById('provider');
      sel.innerHTML = list.map(p => \`<option value="\${p.id}">\${p.label}</option>\`).join('');
      onProviderChange();
    }

    function onProviderChange() {
      const id = document.getElementById('provider').value;
      const p = providers.find(x => x.id === id);
      if (!p) return;
      const baseField = document.getElementById('baseUrl-field');
      baseField.classList.toggle('hidden', !p.requiresBaseUrl);
      const dl = document.getElementById('model-suggestions');
      dl.innerHTML = (p.defaultModels || []).map(m => \`<option value="\${m}">\`).join('');
      if (p.defaultModels?.length && !document.getElementById('modelId').value) {
        document.getElementById('modelId').value = p.defaultModels[0];
      }
    }

    document.getElementById('provider').addEventListener('change', onProviderChange);

    form.addEventListener('submit', e => {
      e.preventDefault();
      clearErrors();
      vscode.postMessage({
        type: 'submit',
        data: {
          id: currentProfileId,
          name: document.getElementById('name').value,
          provider: document.getElementById('provider').value,
          apiKey: document.getElementById('apiKey').value,
          modelId: document.getElementById('modelId').value,
          customBaseUrl: document.getElementById('baseUrl').value,
          customPersonaPrompt: document.getElementById('persona').value,
          defaultCategory: document.getElementById('defaultCategory').value,
          maxOutputTokens: document.getElementById('maxOutputTokens').value,
        }
      });
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
      showEmpty();
    });

    document.getElementById('delete-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'delete', data: { profileId: currentProfileId } });
    });

    function clearErrors() {
      document.querySelectorAll('.error-msg').forEach(el => {
        el.textContent = ''; el.classList.add('hidden');
      });
    }

    window.addEventListener('message', ({ data: msg }) => {
      switch (msg.type) {
        case 'load': {
          const { profile, providers: list, hasApiKey, categories } = msg.data;
          populateProviders(list);
          currentProfileId = profile?.id ?? null;
          document.getElementById('form-title').textContent = profile ? 'Edit Profile' : 'New Profile';
          document.getElementById('name').value = profile?.name ?? '';
          if (profile?.provider) document.getElementById('provider').value = profile.provider;
          onProviderChange();
          document.getElementById('modelId').value = profile?.modelId ?? '';
          document.getElementById('baseUrl').value = profile?.customBaseUrl ?? '';
          document.getElementById('persona').value = profile?.customPersonaPrompt ?? msg.data.defaultPersona;
          
          const catSel = document.getElementById('defaultCategory');
          catSel.innerHTML = categories.map(c => \`<option value="\${c}" \${profile?.defaultCategory === c ? 'selected' : ''}>\${c}</option>\`).join('');
          
          document.getElementById('maxOutputTokens').value = profile?.maxOutputTokens ?? '';
          document.getElementById('apiKey').value = '';
          document.getElementById('key-hint').textContent = hasApiKey ? '(API key already set — leave blank to keep)' : '';
          document.getElementById('delete-btn').classList.toggle('hidden', !profile);
          clearErrors();
          showForm();
          break;
        }
        case 'error': {
          const el = document.getElementById('err-' + msg.data.field);
          if (el) { el.textContent = msg.data.message; el.classList.remove('hidden'); }
          break;
        }
        case 'saved':
        case 'reset':
          currentProfileId = null;
          showEmpty();
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
