import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { ReviewProfile } from '../types';

const STATE_KEY = 'aiReview.profiles';
const ACTIVE_KEY = 'aiReview.activeProfileId';

/**
 * Manages named review profiles persisted in VSCode's globalState.
 * Non-sensitive data only — API keys are in SecretsManager.
 */
export class ProfileManager {
  constructor(private readonly state: vscode.Memento) {}

  listProfiles(): ReviewProfile[] {
    return this.state.get<ReviewProfile[]>(STATE_KEY, []);
  }

  getProfile(id: string): ReviewProfile | undefined {
    return this.listProfiles().find((p) => p.id === id);
  }

  getActiveProfile(): ReviewProfile | undefined {
    const activeId = this.state.get<string>(ACTIVE_KEY, '');
    return this.getProfile(activeId);
  }

  async setActiveProfile(id: string): Promise<void> {
    await this.state.update(ACTIVE_KEY, id);
  }

  async saveProfile(profile: ReviewProfile): Promise<ReviewProfile> {
    const profiles = this.listProfiles();
    const idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push({ ...profile, id: profile.id || randomUUID() });
    }
    await this.state.update(STATE_KEY, profiles);
    return profiles[idx >= 0 ? idx : profiles.length - 1];
  }

  async deleteProfile(id: string): Promise<void> {
    const profiles = this.listProfiles().filter((p) => p.id !== id);
    await this.state.update(STATE_KEY, profiles);

    // If deleted profile was active, clear active
    const activeId = this.state.get<string>(ACTIVE_KEY, '');
    if (activeId === id) {
      await this.state.update(ACTIVE_KEY, profiles[0]?.id ?? '');
    }
  }

  createEmptyProfile(): ReviewProfile {
    return {
      id: randomUUID(),
      name: '',
      provider: 'openai',
      modelId: 'gpt-4o',
      defaultCategory: 'general',
    };
  }
}
