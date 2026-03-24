import * as vscode from 'vscode';

const SECRET_PREFIX = 'aiReview.key.';

/**
 * Thin wrapper around VSCode's SecretStorage.
 * Keys are scoped per profile ID so multiple profiles can coexist.
 */
export class SecretsManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async setApiKey(profileId: string, apiKey: string): Promise<void> {
    await this.secrets.store(`${SECRET_PREFIX}${profileId}`, apiKey);
  }

  async getApiKey(profileId: string): Promise<string | undefined> {
    return this.secrets.get(`${SECRET_PREFIX}${profileId}`);
  }

  async deleteApiKey(profileId: string): Promise<void> {
    await this.secrets.delete(`${SECRET_PREFIX}${profileId}`);
  }
}
