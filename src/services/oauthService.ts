import { createHmac, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import type { Credentials } from 'google-auth-library';
import type { AppConfig, AuthStatusInfo, OAuthStatePayload, OAuthTokenDocument } from '../types.js';
import type { FirestoreUserRepository } from '../repositories/firestoreUserRepository.js';
import { EncryptionService } from './encryptionService.js';
import { createNonce, createOpaqueToken, sha256 } from '../http.js';

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_START_TICKET_MAX_AGE_MS = 60 * 60 * 1000;

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function verifySignedValue(value: string, signature: string, secret: string): boolean {
  const expected = signValue(value, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

export class OAuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: FirestoreUserRepository,
    private readonly encryptionService: EncryptionService,
  ) {}

  createOAuthClient(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.config.googleOAuthClientId,
      clientSecret: this.config.googleOAuthClientSecret,
      redirectUri: this.config.googleOAuthRedirectUri,
    });
  }

  async createAuthorizationUrl(userId: string): Promise<{ authUrl: string; state: string }> {
    const client = this.createOAuthClient();
    const payload: OAuthStatePayload = { nonce: createNonce(), userId, issuedAt: Date.now() };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const signature = signValue(encodedPayload, this.config.adminSessionSecret);
    const state = `${encodedPayload}.${signature}`;

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: this.config.googleOAuthScopes,
      state,
      include_granted_scopes: true,
    });
    return { authUrl, state };
  }

  parseState(state: string): OAuthStatePayload {
    const [encodedPayload, signature] = state.split('.');
    if (!encodedPayload || !signature || !verifySignedValue(encodedPayload, signature, this.config.adminSessionSecret)) {
      throw new Error('Invalid OAuth state');
    }

    const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as OAuthStatePayload;
    if (!parsed.userId || !parsed.nonce || !parsed.issuedAt) throw new Error('Invalid OAuth state');
    if (Date.now() - parsed.issuedAt > OAUTH_STATE_MAX_AGE_MS) {
      throw new Error('OAuth state expired');
    }
    return parsed;
  }

  async issueOAuthStartTicket(userId: string): Promise<{ ticket: string; expiresAt: Date }> {
    const ticket = createOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OAUTH_START_TICKET_MAX_AGE_MS);

    await this.repository.saveOAuthStartTicket({
      ticketHash: sha256(ticket),
      userId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      usedAt: null,
    });

    return { ticket, expiresAt };
  }

  async consumeOAuthStartTicket(ticket: string): Promise<{ userId: string } | null> {
    const record = await this.repository.consumeOAuthStartTicket(sha256(ticket));
    if (!record?.userId) return null;
    return { userId: record.userId };
  }

  async exchangeCodeForTokens(code: string): Promise<Credentials> {
    const client = this.createOAuthClient();
    const { tokens } = await client.getToken(code);
    return tokens;
  }

  async saveUserTokens(userId: string, tokens: Credentials): Promise<void> {
    if (!tokens.refresh_token) throw new Error('Google OAuth response did not include a refresh token');

    const encryptedRefresh = await this.encryptionService.encryptRefreshToken(tokens.refresh_token);
    const record: OAuthTokenDocument = {
      ...encryptedRefresh,
      scopes: this.config.googleOAuthScopes,
      tokenType: tokens.token_type ?? undefined,
      expiryDate: tokens.expiry_date ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
    };

    if (tokens.access_token) {
      const encryptedAccess = await this.encryptionService.encryptRefreshToken(tokens.access_token);
      record.accessTokenEncrypted = encryptedAccess.encryptedToken;
      record.accessTokenIv = encryptedAccess.iv;
      record.accessTokenAuthTag = encryptedAccess.authTag;
      record.accessTokenWrappedDek = encryptedAccess.wrappedDek;
    }

    await this.repository.saveOAuthToken(userId, record);
  }

  async getAuthorizedClient(userId: string): Promise<OAuth2Client> {
    const tokenRecord = await this.repository.getOAuthToken(userId);
    if (!tokenRecord || tokenRecord.status !== 'active') throw new Error('OAuth token not found for user');

    const refreshToken = await this.encryptionService.decryptRefreshToken(tokenRecord);
    const client = this.createOAuthClient();
    client.setCredentials({ refresh_token: refreshToken, expiry_date: tokenRecord.expiryDate ?? undefined });
    return client;
  }

  async getAuthorizationStatus(userId: string): Promise<AuthStatusInfo> {
    const tokenRecord = await this.repository.getOAuthToken(userId);
    if (tokenRecord && tokenRecord.status === 'active') {
      return {
        authorized: true,
        provider: 'google',
        userId,
        message: 'Google authorization is active for this user.',
      };
    }

    const { authUrl } = await this.createAuthorizationUrl(userId);
    return {
      authorized: false,
      provider: 'google',
      userId,
      authUrl,
      actionLabel: 'Sign in with Google',
      message: 'Google authorization is required before using Google Drive or Workspace tools.',
      retryInstruction: 'Open the authUrl, complete sign-in, then retry the previous request.',
    };
  }

  async revokeStoredGoogleToken(userId: string): Promise<string | null> {
    const tokenRecord = await this.repository.getOAuthToken(userId);
    if (!tokenRecord || tokenRecord.status !== 'active') return null;

    const refreshToken = await this.encryptionService.decryptRefreshToken(tokenRecord);
    let status = 'revoked';
    try {
      const response = await fetch(this.config.googleTokenRevokeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      });
      status = response.ok ? 'revoked' : `revoke_failed_${response.status}`;
    } finally {
      await this.repository.deactivateOAuthToken(userId);
    }
    return status;
  }
}
