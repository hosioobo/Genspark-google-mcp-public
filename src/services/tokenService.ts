import { ActiveUserAlreadyExistsError } from '../repositories/firestoreUserRepository.js';
import type { FirestoreUserRepository } from '../repositories/firestoreUserRepository.js';
import type { AppConfig, AuthenticatedUser, UserBearerRecord } from '../types.js';
import { createOpaqueToken, hashBearerToken, verifyBearerToken } from '../http.js';
import type { OAuthService } from './oauthService.js';

export class ActiveUserExistsError extends Error {
  constructor(userId: string) {
    super(`Active user already exists: ${userId}`);
    this.name = 'ActiveUserExistsError';
  }
}

export class TokenService {
  constructor(
    public readonly repository: FirestoreUserRepository,
    private readonly config: AppConfig,
    private readonly oauthService?: OAuthService,
  ) {}

  async issueUserToken(userId: string): Promise<{ userId: string; bearerToken: string }> {
    const bearerToken = createOpaqueToken();

    try {
      await this.repository.createOrReactivateUser(userId);
    } catch (error) {
      if (error instanceof ActiveUserAlreadyExistsError) {
        throw new ActiveUserExistsError(userId);
      }
      throw error;
    }

    await this.saveBearerToken(userId, bearerToken, new Date(), false, false);
    return { userId, bearerToken };
  }

  async rotateUserToken(userId: string): Promise<{ userId: string; bearerToken: string }> {
    const existing = await this.repository.getBearer(userId);
    if (!existing) {
      throw new Error(`User not found: ${userId}`);
    }
    const bearerToken = createOpaqueToken();
    await this.saveBearerToken(userId, bearerToken, existing?.createdAt ?? new Date(), true, true);
    return { userId, bearerToken };
  }

  private async saveBearerToken(
    userId: string,
    bearerToken: string,
    createdAt = new Date(),
    rotated = false,
    ensureUserActive = true,
  ): Promise<void> {
    const bearerHash = await hashBearerToken(bearerToken, this.config.tokenHashPepper);
    const now = new Date();
    if (ensureUserActive) {
      await this.repository.markUserActive(userId);
    }
    await this.repository.upsertBearer({
      userId,
      bearerHash,
      status: 'active',
      createdAt,
      updatedAt: now,
      rotatedAt: rotated ? now : undefined,
    });
  }

  async authenticate(token: string, userIdHint?: string): Promise<AuthenticatedUser | null> {
    if (!userIdHint) return null;
    const bearer = await this.repository.getBearer(userIdHint);
    if (!bearer || bearer.status !== 'active') return null;
    const verified = await verifyBearerToken(token, this.config.tokenHashPepper, bearer.bearerHash);
    if (!verified) return null;
    return { userId: bearer.userId, bearerHash: bearer.bearerHash, status: bearer.status };
  }

  async revokeUserAccess(userId: string): Promise<{ googleRevokeStatus: string | null }> {
    const googleRevokeStatus = this.oauthService
      ? await this.oauthService.revokeStoredGoogleToken(userId).catch(() => 'revoke_failed')
      : null;
    await this.repository.revokeUser(userId);
    return { googleRevokeStatus };
  }
}
