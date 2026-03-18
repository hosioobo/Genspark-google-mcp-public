import { google } from 'googleapis';
import type { OAuthService } from './services/oauthService.js';

export class GoogleWorkspaceClientFactory {
  constructor(private readonly oauthService: OAuthService) {}

  async issueOAuthStartTicket(userId: string) {
    return this.oauthService.issueOAuthStartTicket(userId);
  }

  async createAuthorizationUrl(userId: string) {
    return this.oauthService.createAuthorizationUrl(userId);
  }

  async getAuthorizationStatus(userId: string) {
    return this.oauthService.getAuthorizationStatus(userId);
  }

  async createOAuthClient(userId: string) {
    return this.oauthService.getAuthorizedClient(userId);
  }

  async createDriveClient(userId: string) {
    const auth = await this.oauthService.getAuthorizedClient(userId);
    return google.drive({ version: 'v3', auth });
  }
}
