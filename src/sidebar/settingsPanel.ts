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
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --bg-card: var(--vscode-sideBar-background);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
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
    h1 { font-size: 24px; font-weight: 300; margin-bottom: 30px; letter-spacing: -0.5px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; opacity: 0.6; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin: 40px 0 20px; }
    
    .section { margin-bottom: 30px; }
    
    .profile-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .profile-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      cursor: pointer;
      position: relative;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .profile-card:hover { 
      border-color: var(--vscode-focusBorder);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .profile-card.active { 
      border-color: var(--accent);
      background: rgba(255, 255, 255, 0.05);
    }
    .profile-card .name { font-weight: 500; margin-bottom: 4px; font-size: 14px; }
    .profile-card .details { font-size: 12px; opacity: 0.6; }
    .profile-card .badge {
      position: absolute; top: 12px; right: 12px;
      background: var(--accent);
      color: var(--vscode-button-foreground);
      font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 4px;
    }
    
    .btn-add {
      background: transparent;
      color: var(--accent);
      border: 1px dashed var(--accent);
      padding: 8px 16px; border-radius: 4px; cursor: pointer;
      font-size: 13px; font-weight: 500;
      transition: all 0.2s ease;
    }
    .btn-add:hover { background: rgba(255, 255, 255, 0.05); border-style: solid; }
    
    .form-group { margin-bottom: 20px; }
    label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; opacity: 0.7; }
    input, select, textarea {
      background: var(--input-bg);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px 12px;
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s ease;
    }
    select {
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='gray' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 10px center;
      background-size: 14px;
      padding-right: 32px;
    }
    textarea {
      resize: vertical;
      min-height: 80px;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
    input[type="checkbox"] { width: auto; cursor: pointer; }
    
    .modal {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
      z-index: 100;
      backdrop-filter: blur(2px);
    }
    .modal-content {
      background: var(--vscode-editor-background);
      border: 1px solid var(--border);
      width: 480px; padding: 32px; border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .modal-title { font-size: 20px; font-weight: 300; margin-bottom: 24px; letter-spacing: -0.5px; }
    .modal-actions { display: flex; gap: 12px; margin-top: 32px; align-items: center; }
    .btn { padding: 8px 20px; border-radius: 4px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.2s ease; }
    .btn-save { background: var(--accent); color: var(--vscode-button-foreground); }
    .btn-save:hover { background: var(--accent-hover); }
    .btn-cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-cancel:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-delete { background: transparent; color: var(--vscode-errorForeground); border: 1px solid transparent; }
    .btn-delete:hover { border-color: var(--vscode-errorForeground); }
    
    .settings-row { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; border-bottom: 1px solid var(--border); }
    .settings-info { flex: 1; padding-right: 20px; }
    .settings-title { font-weight: 500; margin-bottom: 4px; font-size: 14px; }
    .settings-desc { font-size: 12px; opacity: 0.6; }
    .settings-control { width: 140px; }
    
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
          `<div class="profile-card ${p.id === activeProfileId ? 'active' : ''}" data-id="${p.id}">
            <div class="name">${p.name}</div>
            <div class="details">${p.provider} · ${p.modelId}</div>
            ${p.id === activeProfileId ? '<div class="badge">ACTIVE</div>' : ''}
          </div>`
        ).join('')}
      </div>
      <button id="btn-create-profile" class="btn-add">+ Create Profile</button>
    </div>

    <div class="section">
      <h2>General Settings</h2>
      
      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Max Context Files</div>
          <div class="settings-desc">Number of relevant files to include based on imports and mentions.</div>
        </div>
        <div class="settings-control">
          <input type="number" id="input-max-context" min="0" max="20" value="${config.get('maxContextFiles')}">
        </div>
      </div>
      
      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Enable Context Expansion</div>
          <div class="settings-desc">Automatically read related files to provide better review context.</div>
        </div>
        <div class="settings-control">
          <input type="checkbox" id="check-context-expansion" ${config.get('enableContextExpansion') ? 'checked' : ''}>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Max Files per Review</div>
          <div class="settings-desc">Maximum number of files allowed in a single recursive or multi-item review.</div>
        </div>
        <div class="settings-control">
          <input type="number" id="input-max-files" min="1" max="100" value="${config.get('maxFilesPerReview')}">
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-info">
          <div class="settings-title">Suppression Scope</div>
          <div class="settings-desc">Where to store suppressed issues (ignore-list).</div>
        </div>
        <div class="settings-control">
          <select id="select-suppression-scope">
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
          <select id="p-provider">
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
          <label>Model selection</label>
          <select id="p-modelId-select" required>
            <!-- Populated by JS -->
          </select>
        </div>
        
        <div id="p-modelId-custom-container" class="form-group hidden">
          <label>Custom Model ID</label>
          <input type="text" id="p-modelId-custom" placeholder="e.g. gpt-4o-2024-05-13">
        </div>

        <div class="form-group">
          <label>Custom Persona Prompt (Optional)</label>
          <textarea id="p-persona" rows="3" placeholder="Custom instructions for the AI..."></textarea>
        </div>

        <div class="modal-actions">
          <button type="submit" class="btn btn-save">Save Profile</button>
          <button type="button" id="btn-cancel-modal" class="btn btn-cancel">Cancel</button>
          <button type="button" id="btn-activate" class="btn btn-save hidden">Activate</button>
          <div style="flex: 1"></div>
          <button type="button" id="btn-delete" class="btn btn-delete hidden">Delete</button>
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
    
    // Event Listeners
    document.getElementById('btn-create-profile').addEventListener('click', createNewProfile);
    
    document.getElementById('profile-list').addEventListener('click', (e) => {
      const card = e.target.closest('.profile-card');
      if (card) {
        editProfile(card.dataset.id);
      }
    });

    document.getElementById('p-provider').addEventListener('change', onProviderChange);
    document.getElementById('p-modelId-select').addEventListener('change', onModelSelectChange);

    document.getElementById('input-max-context').addEventListener('change', (e) => updateConfig('maxContextFiles', parseInt(e.target.value)));
    document.getElementById('check-context-expansion').addEventListener('change', (e) => updateConfig('enableContextExpansion', e.target.checked));
    document.getElementById('input-max-files').addEventListener('change', (e) => updateConfig('maxFilesPerReview', parseInt(e.target.value)));
    document.getElementById('select-suppression-scope').addEventListener('change', (e) => updateConfig('suppressionScope', e.target.value));

    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    document.getElementById('btn-activate').addEventListener('click', activateProfile);
    document.getElementById('btn-delete').addEventListener('click', deleteProfile);

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
      document.getElementById('p-baseUrl').value = p.customBaseUrl || '';
      document.getElementById('p-persona').value = p.customPersonaPrompt || ${defaultPersonaJson};
      
      onProviderChange(); // This populates model select

      const modelSelect = document.getElementById('p-modelId-select');
      const isDefaultModel = Array.from(modelSelect.options).some(opt => opt.value === p.modelId);
      
      if (isDefaultModel) {
        modelSelect.value = p.modelId;
        toggleCustomModel(false);
      } else {
        modelSelect.value = 'custom';
        document.getElementById('p-modelId-custom').value = p.modelId;
        toggleCustomModel(true);
      }
      
      document.getElementById('btn-delete').classList.remove('hidden');
      document.getElementById('btn-activate').classList.toggle('hidden', p.id === activeProfileId);
      
      modal.classList.remove('hidden');
    }

    function onProviderChange() {
      const providerId = document.getElementById('p-provider').value;
      const provider = providers.find(p => p.id === providerId);
      if (!provider) return;

      const baseUrlField = document.getElementById('p-baseUrl-field');
      baseUrlField.classList.toggle('hidden', !provider.requiresBaseUrl);

      const modelSelect = document.getElementById('p-modelId-select');
      let html = provider.defaultModels.map(m => '<option value="' + m + '">' + m + '</option>').join('');
      html += '<option value="custom">Other (Custom model ID)...</option>';
      modelSelect.innerHTML = html;
      
      onModelSelectChange();
    }

    function onModelSelectChange() {
      const val = document.getElementById('p-modelId-select').value;
      toggleCustomModel(val === 'custom');
    }

    function toggleCustomModel(show) {
      const container = document.getElementById('p-modelId-custom-container');
      container.classList.toggle('hidden', !show);
      const customInput = document.getElementById('p-modelId-custom');
      customInput.required = show;
    }

    function closeModal() {
      modal.classList.add('hidden');
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const modelSelectVal = document.getElementById('p-modelId-select').value;
      const modelId = modelSelectVal === 'custom' 
        ? document.getElementById('p-modelId-custom').value 
        : modelSelectVal;

      const data = {
        id: document.getElementById('p-id').value,
        name: document.getElementById('p-name').value,
        provider: document.getElementById('p-provider').value,
        apiKey: document.getElementById('p-apiKey').value,
        modelId: modelId,
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
