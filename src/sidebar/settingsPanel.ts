import * as vscode from 'vscode';
import { ProfileManager } from '../profiles/profileManager';
import { SecretsManager } from '../providers/secretsManager';
import { PROVIDER_REGISTRY } from '../providers/providerRegistry';
import { DEFAULT_PERSONA } from '../review/promptBuilder';
import type { ReviewProfile } from '../types';

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly profileManager: ProfileManager,
    private readonly secrets: SecretsManager
  ) {
    this._panel = panel;
    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'saveProfile':
            await this.handleSaveProfile(message.data);
            break;
          case 'deleteProfile':
            await this.handleDeleteProfile(message.profileId);
            break;
          case 'activateProfile':
            await this.profileManager.setActiveProfile(message.profileId);
            this._update();
            vscode.commands.executeCommand('aiReview.sidebar.updateStatusBar');
            break;
          case 'updateConfig':
            await this.handleUpdateConfig(message.key, message.value);
            break;
          case 'refresh':
            this._update();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    profileManager: ProfileManager,
    secrets: SecretsManager
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel._panel.reveal(column);
      SettingsPanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiReviewSettings',
      'AI Code Review — Settings',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true
      }
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri, profileManager, secrets);
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private async handleSaveProfile(data: any) {
    const profile: ReviewProfile = {
      id: data.id || `profile_${Date.now()}`,
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      ...(data.customBaseUrl && { customBaseUrl: data.customBaseUrl }),
      ...(data.customPersonaPrompt && { customPersonaPrompt: data.customPersonaPrompt }),
    };

    await this.profileManager.saveProfile(profile);
    if (data.apiKey) {
      await this.secrets.setApiKey(profile.id, data.apiKey);
    }

    // Auto-activate if it's the first profile
    if (!this.profileManager.getActiveProfile()) {
      await this.profileManager.setActiveProfile(profile.id);
    }

    vscode.window.showInformationMessage(`Profile "${profile.name}" saved.`);
    this._update();
    vscode.commands.executeCommand('aiReview.sidebar.refreshTree');
  }

  private async handleDeleteProfile(profileId: string) {
    const profile = this.profileManager.listProfiles().find(p => p.id === profileId);
    if (!profile) return;

    const confirm = await vscode.window.showWarningMessage(
      `Delete profile "${profile.name}"?`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') return;

    await this.profileManager.deleteProfile(profileId);
    await this.secrets.deleteApiKey(profileId);
    vscode.window.showInformationMessage(`Profile "${profile.name}" deleted.`);
    this._update();
    vscode.commands.executeCommand('aiReview.sidebar.refreshTree');
  }

  private async handleUpdateConfig(key: string, value: any) {
    await vscode.workspace.getConfiguration('aiReview').update(key, value, vscode.ConfigurationTarget.Global);
    this._update();
  }

  public dispose() {
    SettingsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }
  private _getHtmlForWebview() {
    const webview = this._panel.webview;
    const nonce = getNonce();
    const profiles = this.profileManager.listProfiles();
    const activeProfile = this.profileManager.getActiveProfile();
    const config = vscode.workspace.getConfiguration('aiReview');

    const providersJson = JSON.stringify(PROVIDER_REGISTRY.map(p => ({
      id: p.id,
      label: p.label,
      requiresApiKey: p.requiresApiKey,
      requiresBaseUrl: p.requiresBaseUrl,
      defaultModels: p.defaultModels,
    })));

    const defaultPersonaJson = JSON.stringify(DEFAULT_PERSONA.trim());
    const profilesJson = JSON.stringify(profiles);
    const activeProfileId = activeProfile?.id || '';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settings</title>
  <style nonce="${nonce}">
    :root {
      --container-width: 800px;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 40px;
      line-height: 1.5;
    }
    .container {
      max-width: var(--container-width);
      margin: 0 auto;
    }
    h1 { font-size: 24px; font-weight: normal; margin-bottom: 30px; }
    h2 { font-size: 18px; font-weight: normal; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; margin: 40px 0 20px; }
    
    .section { margin-bottom: 30px; }
    
    .profile-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .profile-card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 16px;
      cursor: pointer;
      position: relative;
    }
    .profile-card:hover { border-color: var(--vscode-focusBorder); }
    .profile-card.active { border-color: var(--vscode-button-background); border-width: 2px; }
    .profile-card .name { font-weight: bold; margin-bottom: 4px; }
    .profile-card .details { font-size: 12px; opacity: 0.7; }
    .profile-card .badge {
      position: absolute; top: 12px; right: 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 10px; padding: 2px 6px; border-radius: 10px;
    }
    
    .btn-add {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; padding: 8px 16px; border-radius: 2px; cursor: pointer;
      font-size: 13px;
    }
    .btn-add:hover { background: var(--vscode-button-hoverBackground); }
    
    .form-group { margin-bottom: 15px; }
    label { display: block; font-size: 12px; margin-bottom: 5px; opacity: 0.8; }
    input, select, textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 6px 10px;
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
      font-size: 13px;
      outline: none;
    }
    textarea {
      resize: vertical;
      min-height: 100px;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
    input[type="checkbox"] { width: auto; cursor: pointer; }
    
    .modal {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
      z-index: 100;
    }
    .modal-content {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      width: 500px; padding: 24px; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .modal-title { font-size: 18px; margin-bottom: 20px; }
    .modal-actions { display: flex; gap: 10px; margin-top: 30px; }
    .btn { padding: 8px 20px; border-radius: 2px; border: none; cursor: pointer; font-size: 13px; }
    .btn-save { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-save:hover { background: var(--vscode-button-hoverBackground); }
    .btn-cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-cancel:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-delete { background: var(--vscode-errorForeground); color: white; margin-left: auto; }
    
    .settings-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .settings-info { flex: 1; }
    .settings-title { font-weight: bold; margin-bottom: 2px; }
    .settings-desc { font-size: 12px; opacity: 0.7; }
    .settings-control { width: 160px; }
    
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Settings</h1>
    
    <div class="section">
      <h2>Review Profiles</h2>
      <div class="profile-list" id="profile-list">
        ${profiles.map(p => 
          '<div class="profile-card ' + (p.id === activeProfileId ? 'active' : '') + '" onclick="editProfile(\'' + p.id + '\')">' +
            '<div class="name">' + p.name + '</div>' +
            '<div class="details">' + p.provider + ' · ' + p.modelId + '</div>' +
            (p.id === activeProfileId ? '<div class="badge">ACTIVE</div>' : '') +
          '</div>'
        ).join('')}
      </div>
      <button class="btn-add" onclick="createNewProfile()">+ Create Profile</button>
    </div>

    <div class="section">
      <h2>General Settings</h2>
      
      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Max Context Files</div>
          <div class="settings-desc">Number of relevant files to include based on imports and mentions.</div>
        </div>
        <div class="settings-control">
          <input type="number" min="0" max="20" value="${config.get('maxContextFiles')}" onchange="updateConfig('maxContextFiles', parseInt(this.value))">
        </div>
      </div>
      
      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Enable Context Expansion</div>
          <div class="settings-desc">Automatically read related files to provide better review context.</div>
        </div>
        <div class="settings-control">
          <input type="checkbox" ${config.get('enableContextExpansion') ? 'checked' : ''} onchange="updateConfig('enableContextExpansion', this.checked)">
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Max Files per Review</div>
          <div class="settings-desc">Maximum number of files allowed in a single recursive or multi-item review.</div>
        </div>
        <div class="settings-control">
          <input type="number" min="1" max="100" value="${config.get('maxFilesPerReview')}" onchange="updateConfig('maxFilesPerReview', parseInt(this.value))">
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Suppression Scope</div>
          <div class="settings-desc">Where to store suppressed issues (ignore-list).</div>
        </div>
        <div class="settings-control">
          <select onchange="updateConfig('suppressionScope', this.value)">
            <option value="workspace" ${config.get('suppressionScope') === 'workspace' ? 'selected' : ''}>Workspace</option>
            <option value="global" ${config.get('suppressionScope') === 'global' ? 'selected' : ''}>Global</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <div id="modal" class="modal hidden">
    <div class="modal-content">
      <div class="modal-title" id="modal-title">Create Profile</div>
      <form id="profile-form">
        <input type="hidden" id="p-id">
        
        <div class="form-group">
          <label>Profile Name</label>
          <input type="text" id="p-name" required placeholder="e.g. GPT-4o Standard">
        </div>
        
        <div class="form-group">
          <label>Provider</label>
          <select id="p-provider" onchange="onProviderChange()">
            <!-- Populated by JS -->
          </select>
        </div>

        <div id="p-baseUrl-field" class="form-group hidden">
          <label>Base URL / Endpoint</label>
          <input type="text" id="p-baseUrl" placeholder="https://api.openai.com/v1">
        </div>

        <div class="form-group">
          <label>API Key</label>
          <input type="password" id="p-apiKey" placeholder="Leave blank to keep existing key">
        </div>

        <div class="form-group">
          <label>Model ID</label>
          <input type="text" list="p-model-list" id="p-modelId" required placeholder="gpt-4o">
          <datalist id="p-model-list"></datalist>
        </div>

        <div class="form-group">
          <label>Custom Persona Prompt (Optional)</label>
          <textarea id="p-persona" rows="3" placeholder="Custom instructions for the AI..."></textarea>
        </div>

        <div class="modal-actions">
          <button type="submit" class="btn btn-save">Save Profile</button>
          <button type="button" class="btn btn-cancel" onclick="closeModal()">Cancel</button>
          <button type="button" id="btn-delete" class="btn btn-delete hidden" onclick="deleteProfile()">Delete</button>
          <button type="button" id="btn-activate" class="btn btn-save hidden" onclick="activateProfile()">Activate</button>
        </div>
      </form>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const providers = ${providersJson};
    const profiles = ${profilesJson};
    const activeProfileId = "${activeProfileId}";

    const modal = document.getElementById('modal');
    const form = document.getElementById('profile-form');

    function initProviders() {
      const select = document.getElementById('p-provider');
      select.innerHTML = providers.map(p => '<option value="' + p.id + '">' + p.label + '</option>').join('');
    }

    initProviders();

    function createNewProfile() {
      form.reset();
      document.getElementById('p-id').value = '';
      document.getElementById('p-persona').value = ${defaultPersonaJson};
      document.getElementById('modal-title').innerText = 'Create Profile';
      document.getElementById('btn-delete').classList.add('hidden');
      document.getElementById('btn-activate').classList.add('hidden');
      modal.classList.remove('hidden');
      onProviderChange();
    }

    function editProfile(id) {
      const p = profiles.find(x => x.id === id);
      if (!p) return;
      document.getElementById('modal-title').innerText = 'Edit Profile';
      document.getElementById('p-id').value = p.id;
      document.getElementById('p-name').value = p.name;
      document.getElementById('p-provider').value = p.provider;
      document.getElementById('p-apiKey').value = '';
      document.getElementById('p-modelId').value = p.modelId;
      document.getElementById('p-baseUrl').value = p.customBaseUrl || '';
      document.getElementById('p-persona').value = p.customPersonaPrompt || ${defaultPersonaJson};
      
      document.getElementById('btn-delete').classList.remove('hidden');
      document.getElementById('btn-activate').classList.toggle('hidden', p.id === activeProfileId);
      
      modal.classList.remove('hidden');
      onProviderChange();
    }

    function onProviderChange() {
      const providerId = document.getElementById('p-provider').value;
      const provider = providers.find(p => p.id === providerId);
      if (!provider) return;

      const baseUrlField = document.getElementById('p-baseUrl-field');
      baseUrlField.classList.toggle('hidden', !provider.requiresBaseUrl);

      const modelList = document.getElementById('p-model-list');
      modelList.innerHTML = provider.defaultModels.map(m => '<option value="' + m + '">').join('');
    }

    function closeModal() {
      modal.classList.add('hidden');
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {
        id: document.getElementById('p-id').value,
        name: document.getElementById('p-name').value,
        provider: document.getElementById('p-provider').value,
        apiKey: document.getElementById('p-apiKey').value,
        modelId: document.getElementById('p-modelId').value,
        customBaseUrl: document.getElementById('p-baseUrl').value,
        customPersonaPrompt: document.getElementById('p-persona').value
      };
      vscode.postMessage({ type: 'saveProfile', data });
      closeModal();
    });

    function deleteProfile() {
      const id = document.getElementById('p-id').value;
      if (id) {
        vscode.postMessage({ type: 'deleteProfile', profileId: id });
        closeModal();
      }
    }

    function activateProfile() {
      const id = document.getElementById('p-id').value;
      if (id) {
        vscode.postMessage({ type: 'activateProfile', profileId: id });
        closeModal();
      }
    }

    function updateConfig(key, value) {
      vscode.postMessage({ type: 'updateConfig', key, value });
    }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
