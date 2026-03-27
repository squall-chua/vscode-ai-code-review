import * as vscode from 'vscode';
import { ProfileManager } from '../profiles/profileManager';
import { SecretsManager } from '../providers/secretsManager';
import { PROVIDER_REGISTRY } from '../providers/providerRegistry';
import { DEFAULT_PERSONA } from '../review/promptBuilder';
import type { ReviewProfile, ProviderId } from '../types';

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
      async (message: { type: string; data?: Record<string, unknown>; profileId?: string; key?: string; value?: unknown }) => {
        switch (message.type) {
          case 'saveProfile':
            if (message.data) {
              await this.handleSaveProfile(message.data);
            }
            break;
          case 'deleteProfile':
            if (message.profileId) {
              await this.handleDeleteProfile(message.profileId);
            }
            break;
          case 'activateProfile':
            if (message.profileId) {
              await this.profileManager.setActiveProfile(message.profileId);
              this._update();
              await vscode.commands.executeCommand('aiReview.sidebar.updateStatusBar');
            }
            break;
          case 'updateConfig':
            if (message.key !== undefined && message.value !== undefined) {
              await this.handleUpdateConfig(message.key, message.value);
            }
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

  private async handleSaveProfile(data: Record<string, unknown>) {
    const d = data as { 
      id?: string; 
      name: string; 
      provider: ProviderId; 
      modelId: string; 
      apiKey?: string; 
      customBaseUrl?: string; 
      customPersonaPrompt?: string; 
    };

    const profile: ReviewProfile = {
      id: d.id || `profile_${Date.now()}`,
      name: d.name || 'Unnamed Profile',
      provider: d.provider,
      modelId: d.modelId,
      ...(d.customBaseUrl && { customBaseUrl: d.customBaseUrl }),
      ...(d.customPersonaPrompt && { customPersonaPrompt: d.customPersonaPrompt }),
    };

    await this.profileManager.saveProfile(profile);
    if (d.apiKey) {
      await this.secrets.setApiKey(profile.id, d.apiKey);
    }

    // Auto-activate if it's the first profile
    if (!this.profileManager.getActiveProfile()) {
      await this.profileManager.setActiveProfile(profile.id);
    }

    await vscode.window.showInformationMessage(`Profile "${profile.name}" saved.`);
    this._update();
    await vscode.commands.executeCommand('aiReview.sidebar.refreshTree');
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
    await vscode.window.showInformationMessage(`Profile "${profile.name}" deleted.`);
    this._update();
    await vscode.commands.executeCommand('aiReview.sidebar.refreshTree');
  }

  private async handleUpdateConfig(key: string, value: unknown) {
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
      --container-width: 900px;
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --bg-card: var(--vscode-sideBar-background);
      --bg-active: rgba(var(--vscode-button-background-rgb, 0, 122, 204), 0.08);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
      --text-muted: var(--vscode-descriptionForeground);
      --transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.1);
      --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.2);
    }
    
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
      margin: 0;
      line-height: 1.5;
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    /* Layout */
    .app-sidebar {
      width: 240px;
      border-right: 1px solid var(--border);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      padding: 32px 0;
    }

    .app-main {
      flex: 1;
      overflow-y: auto;
      background: var(--vscode-editor-background);
      padding: 64px 48px;
    }

    /* Navigation */
    .nav-item {
      padding: 10px 24px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      transition: var(--transition);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-item:hover {
      color: var(--vscode-foreground);
      background: rgba(255, 255, 255, 0.03);
    }

    .nav-item.active {
      color: var(--accent);
      background: var(--bg-active);
      border-right: 2px solid var(--accent);
    }

    .nav-icon { opacity: 0.6; }
    .nav-item.active .nav-icon { opacity: 1; color: var(--accent); }

    /* Header */
    .section-header {
      margin-bottom: 40px;
    }

    .section-header h1 {
      font-size: 32px;
      font-weight: 200;
      margin: 0;
      letter-spacing: -0.03em;
    }

    .section-header p {
      margin: 8px 0 0;
      color: var(--text-muted);
      font-size: 14px;
    }

    /* Cards */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
    }

    .profile-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      cursor: pointer;
      transition: var(--transition);
      position: relative;
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .profile-card:hover {
      border-color: var(--vscode-focusBorder);
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }

    .profile-card.active {
      border-color: var(--accent);
      background: var(--bg-active);
    }

    .provider-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }

    .profile-info {
      flex: 1;
      min-width: 0;
    }

    .profile-name {
      font-weight: 600;
      font-size: 15px;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .profile-meta {
      font-size: 12px;
      color: var(--text-muted);
    }

    .active-pill {
      position: absolute;
      top: 12px;
      right: 12px;
      background: var(--accent);
      color: var(--vscode-button-foreground);
      font-size: 10px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 100px;
      text-transform: uppercase;
    }

    /* Settings Row */
    .settings-list {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
    }

    .setting-item {
      padding: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 32px;
    }

    .setting-item:not(:last-child) {
      border-bottom: 1px solid var(--border);
    }

    .setting-text { flex: 1; }
    .setting-label { font-weight: 600; font-size: 14px; margin-bottom: 4px; display: block; }
    .setting-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; }

    /* Controls */
    .control-wrap { width: 140px; }

    /* Custom Switch */
    .switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
    }

    .switch input { opacity: 0; width: 0; height: 0; }

    .slider {
      position: absolute; cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: var(--border);
      transition: .4s;
      border-radius: 34px;
    }

    .slider:before {
      position: absolute; content: "";
      height: 16px; width: 16px;
      left: 3px; bottom: 3px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }

    input:checked + .slider { background-color: var(--accent); }
    input:checked + .slider:before { transform: translateX(18px); }

    /* Inputs */
    input[type="number"], select, textarea, input[type="text"], input[type="password"] {
      background: var(--input-bg);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: var(--transition);
      width: 100%;
      box-sizing: border-box;
    }

    input:focus, select:focus, textarea:focus {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 2px var(--bg-active);
    }

    /* Modal Overlay */
    .modal-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(12px);
      z-index: 2000;
      opacity: 0; pointer-events: none;
      transition: opacity 0.3s ease;
      display: flex; align-items: center; justify-content: center;
    }

    .modal-overlay.visible { opacity: 1; pointer-events: auto; }

    .modal-pnl {
      background: var(--vscode-editor-background);
      border: 1px solid var(--border);
      width: 560px;
      border-radius: 24px;
      padding: 48px;
      box-shadow: var(--shadow-md);
      transform: scale(0.95) translateY(20px);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .modal-overlay.visible .modal-pnl { transform: scale(1) translateY(0); }

    .modal-head h2 { font-size: 24px; font-weight: 200; margin: 0 0 32px; letter-spacing: -0.03em; }

    .btn-row { display: flex; gap: 12px; margin-top: 40px; padding-top: 32px; border-top: 1px solid var(--border); }
    
    .btn {
      padding: 12px 24px; border-radius: 10px; cursor: pointer; border: none; font-size: 13px; font-weight: 600; transition: var(--transition);
    }

    .btn-main { background: var(--accent); color: var(--vscode-button-foreground); }
    .btn-main:hover { background: var(--accent-hover); transform: translateY(-1px); }

    .btn-ghost { background: transparent; color: var(--text-muted); }
    .btn-ghost:hover { background: rgba(255,255,255,0.05); color: var(--vscode-foreground); }

    .btn-danger { color: #f85149; background: transparent; margin-left: auto; }
    .btn-danger:hover { background: rgba(248, 81, 73, 0.1); }

    .hidden { display: none !important; }

    /* Custom Transitions */
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.4s ease; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <nav class="app-sidebar">
    <div class="nav-item active" data-tab="profiles">
      <span class="nav-icon">👤</span>
      Review Profiles
    </div>
    <div class="nav-item" data-tab="engine">
      <span class="nav-icon">⚙️</span>
      Engine Config
    </div>
  </nav>

  <main class="app-main">
    <!-- Profiles Tab -->
    <div id="tab-profiles" class="tab-content active">
      <div class="section-header">
        <h1>Review Profiles</h1>
        <p>Manage model endpoints and personas. Toggle active profile from the sidebar tree.</p>
      </div>

      <div class="grid">
        ${profiles.map(p => {
          return `
          <div class="profile-card ${p.id === activeProfileId ? 'active' : ''}" data-id="${p.id}">
            <div class="provider-icon">${p.provider === 'openai' ? '◎' : p.provider === 'anthropic' ? '▲' : p.provider === 'google' ? '◈' : '◌'}</div>
            <div class="profile-info">
              <div class="profile-name">${p.name}</div>
              <div class="profile-meta">${p.provider} · ${p.modelId}</div>
            </div>
            ${p.id === activeProfileId ? '<div class="active-pill">Active</div>' : ''}
          </div>`;
        }).join('')}
        
        <div id="btn-create-profile" class="profile-card" style="border-style: dashed; justify-content: center; opacity: 0.6;">
          <div class="profile-name">+ New Profile</div>
        </div>
      </div>
    </div>

    <!-- Engine Tab -->
    <div id="tab-engine" class="tab-content">
      <div class="section-header">
        <h1>Engine Config</h1>
        <p>Control the core logic of the review process.</p>
      </div>

      <div class="settings-list">
        <div class="setting-item">
          <div class="setting-text">
            <label class="setting-label">Context Window Expansion</label>
            <span class="setting-desc">Read imports and related files to provide better cross-file analysis.</span>
          </div>
          <div class="control-wrap" style="width: auto;">
            <label class="switch">
              <input type="checkbox" id="check-context-expansion" ${config.get<boolean>('enableContextExpansion') ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-text">
            <label class="setting-label">Max Context Files</label>
            <span class="setting-desc">limit the number of extra files requested by the AI.</span>
          </div>
          <div class="control-wrap">
            <input type="number" id="input-max-context" min="0" max="50" value="${config.get<number>('maxContextFiles') ?? 0}">
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-text">
            <label class="setting-label">Sampling Temperature</label>
            <span class="setting-desc">Higher for creative insights, lower for literal correctness. Recommended: 0.2</span>
          </div>
          <div class="control-wrap">
            <input type="number" id="input-temperature" min="0" max="1" step="0.1" value="${config.get<number>('temperature') ?? 0.2}">
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-text">
            <label class="setting-label">Suppression Logic</label>
            <span class="setting-desc">Where to store issue ignore-rules.</span>
          </div>
          <div class="control-wrap">
            <select id="select-suppression-scope">
              <option value="workspace" ${config.get<string>('suppressionScope') === 'workspace' ? 'selected' : ''}>Local Workspace</option>
              <option value="global" ${config.get<string>('suppressionScope') === 'global' ? 'selected' : ''}>Machine Global</option>
            </select>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-text">
            <label class="setting-label">Response Token Limit</label>
            <span class="setting-desc">Maximum tokens for the AI's explanation. Increase for longer files.</span>
          </div>
          <div class="control-wrap">
            <input type="number" id="input-max-tokens" min="500" max="64000" step="500" value="${config.get<number>('maxOutputTokens') ?? 4000}">
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-text">
            <label class="setting-label">Multi-file Batch Limit</label>
            <span class="setting-desc">How many files can be reviewed in a single "Review Selected" action.</span>
          </div>
          <div class="control-wrap">
            <input type="number" id="input-max-files" min="1" max="500" value="${config.get<number>('maxFilesPerReview') ?? 20}">
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- Modal Overlay -->
  <div id="modal-overlay" class="modal-overlay">
    <div class="modal-pnl">
      <div class="modal-head">
        <h2 id="modal-title">Edit Profile</h2>
      </div>
      
      <form id="profile-form">
        <input type="hidden" id="p-id">
        
        <div style="display: flex; gap: 24px; margin-bottom: 24px;">
           <div style="flex: 1;">
            <label class="setting-label">Profile Name</label>
            <input type="text" id="p-name" required placeholder="e.g. My Custom Claude">
          </div>
          <div style="width: 140px;">
            <label class="setting-label">Provider</label>
            <select id="p-provider"></select>
          </div>
        </div>

        <div style="margin-bottom: 24px;">
          <label class="setting-label">Model Selection</label>
          <select id="p-modelId-select" required></select>
        </div>

        <div id="p-modelId-custom-container" class="hidden" style="margin-bottom: 24px;">
          <label class="setting-label">Custom Model ID</label>
          <input type="text" id="p-modelId-custom" placeholder="e.g. o3-mini">
        </div>

        <div id="p-baseUrl-field" class="hidden" style="margin-bottom: 24px;">
          <label class="setting-label">Base URL</label>
          <input type="text" id="p-baseUrl" placeholder="https://api.openai.com/v1">
        </div>

        <div style="margin-bottom: 24px;">
          <label class="setting-label">API Secret Key</label>
          <input type="password" id="p-apiKey" placeholder="••••••••••••••••••••">
        </div>

        <div style="margin-bottom: 24px;">
          <label class="setting-label">Custom Persona Prompt</label>
          <textarea id="p-persona" rows="5" placeholder="Define model behavior..."></textarea>
        </div>

        <div class="btn-row">
          <button type="submit" class="btn btn-main">Save Profile</button>
          <button type="button" id="btn-cancel-modal" class="btn btn-ghost">Cancel</button>
          <button type="button" id="btn-activate" class="btn btn-main hidden" style="background: transparent; border: 1px solid var(--accent); color: var(--accent);">Activate</button>
          <button type="button" id="btn-delete" class="btn btn-danger hidden">Delete</button>
        </div>
      </form>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const providers = ${providersJson};
    const profiles = ${profilesJson};
    const activeProfileId = "${activeProfileId}";

    // Navigation Logic
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        
        item.classList.add('active');
        document.getElementById('tab-' + item.dataset.tab).classList.add('active');
      });
    });

    // Profile Logic
    const overlay = document.getElementById('modal-overlay');
    const form = document.getElementById('profile-form');
    
    function initProviders() {
      const select = document.getElementById('p-provider');
      select.innerHTML = providers.map(p => \`<option value="\${p.id}">\${p.label}</option>\`).join('');
    }
    initProviders();

    document.getElementById('btn-create-profile').addEventListener('click', createNewProfile);
    document.querySelectorAll('.profile-card[data-id]').forEach(card => {
      card.addEventListener('click', () => editProfile(card.dataset.id));
    });

    document.getElementById('p-provider').addEventListener('change', onProviderChange);
    document.getElementById('p-modelId-select').addEventListener('change', onModelSelectChange);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    document.getElementById('btn-activate').addEventListener('click', activateProfile);
    document.getElementById('btn-delete').addEventListener('click', deleteProfile);

    // Dynamic Updates
    ['input-max-context', 'input-max-files', 'input-max-tokens', 'input-temperature'].forEach(id => {
      document.getElementById(id).addEventListener('change', (e) => {
        const key = {
          'input-max-context': 'maxContextFiles',
          'input-max-files': 'maxFilesPerReview',
          'input-max-tokens': 'maxOutputTokens',
          'input-temperature': 'temperature'
        }[id];
        updateConfig(key, parseFloat(e.target.value));
      });
    });

    document.getElementById('check-context-expansion').addEventListener('change', (e) => updateConfig('enableContextExpansion', e.target.checked));
    document.getElementById('select-suppression-scope').addEventListener('change', (e) => updateConfig('suppressionScope', e.target.value));

    function createNewProfile() {
      form.reset();
      document.getElementById('p-id').value = '';
      document.getElementById('p-persona').value = ${defaultPersonaJson};
      document.getElementById('modal-title').innerText = 'New AI Profile';
      document.getElementById('btn-delete').classList.add('hidden');
      document.getElementById('btn-activate').classList.add('hidden');
      overlay.classList.add('visible');
      onProviderChange();
    }

    function editProfile(id) {
      const p = profiles.find(x => x.id === id);
      if (!p) return;
      document.getElementById('modal-title').innerText = 'Configure Profile';
      document.getElementById('p-id').value = p.id;
      document.getElementById('p-name').value = p.name;
      document.getElementById('p-provider').value = p.provider;
      document.getElementById('p-baseUrl').value = p.customBaseUrl || '';
      document.getElementById('p-persona').value = p.customPersonaPrompt || ${defaultPersonaJson};
      
      onProviderChange();

      const modelSelect = document.getElementById('p-modelId-select');
      const isDefault = Array.from(modelSelect.options).some(o => o.value === p.modelId);
      if (isDefault) {
        modelSelect.value = p.modelId;
        toggleCustomModel(false);
      } else {
        modelSelect.value = 'custom';
        document.getElementById('p-modelId-custom').value = p.modelId;
        toggleCustomModel(true);
      }
      
      document.getElementById('btn-delete').classList.remove('hidden');
      document.getElementById('btn-activate').classList.toggle('hidden', p.id === activeProfileId);
      overlay.classList.add('visible');
    }

    function onProviderChange() {
      const providerId = document.getElementById('p-provider').value;
      const provider = providers.find(p => p.id === providerId);
      if (!provider) return;

      document.getElementById('p-baseUrl-field').classList.toggle('hidden', !provider.requiresBaseUrl);
      const modelSelect = document.getElementById('p-modelId-select');
      let html = provider.defaultModels.map(m => \`<option value="\${m}">\${m}</option>\`).join('');
      html += '<option value="custom">Manual Specify...</option>';
      modelSelect.innerHTML = html;
      onModelSelectChange();
    }

    function onModelSelectChange() {
      toggleCustomModel(document.getElementById('p-modelId-select').value === 'custom');
    }

    function toggleCustomModel(show) {
      document.getElementById('p-modelId-custom-container').classList.toggle('hidden', !show);
    }

    function closeModal() { overlay.classList.remove('visible'); }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const modelSelectVal = document.getElementById('p-modelId-select').value;
      const data = {
        id: document.getElementById('p-id').value,
        name: document.getElementById('p-name').value,
        provider: document.getElementById('p-provider').value,
        apiKey: document.getElementById('p-apiKey').value,
        modelId: modelSelectVal === 'custom' ? document.getElementById('p-modelId-custom').value : modelSelectVal,
        customBaseUrl: document.getElementById('p-baseUrl').value,
        customPersonaPrompt: document.getElementById('p-persona').value
      };
      vscode.postMessage({ type: 'saveProfile', data });
      closeModal();
    });

    function deleteProfile() {
      const id = document.getElementById('p-id').value;
      if (id) { vscode.postMessage({ type: 'deleteProfile', profileId: id }); closeModal(); }
    }

    function activateProfile() {
      const id = document.getElementById('p-id').value;
      if (id) { vscode.postMessage({ type: 'activateProfile', profileId: id }); closeModal(); }
    }

    function updateConfig(key, value) { vscode.postMessage({ type: 'updateConfig', key, value }); }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
