import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OAuth2Client } from 'google-auth-library';
import type { drive_v3 } from 'googleapis';
import type { Context } from 'hono';
import type { Logger } from './logger.js';

// ── App Config ──

export interface AppConfig {
  port: number;
  baseUrl: string;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  googleOAuthRedirectUri: string;
  googleOAuthScopes: string[];
  firestoreCollectionUsers: string;
  firestoreCollectionTokens: string;
  kmsKeyName: string;
  tokenHashPepper: string;
  adminKey: string;
  adminSessionSecret: string;
  adminSessionMaxAgeSeconds: number;
  rateLimitPerMinute: number;
  googleTokenRevokeEndpoint: string;
  enableDebugUi: boolean;
}

// ── User / Auth ──

export interface UserBearerRecord {
  userId: string;
  bearerHash: string;
  status: 'active' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
  rotatedAt?: Date;
}

export interface AuthenticatedUser {
  userId: string;
  bearerHash: string;
  status: 'active' | 'revoked';
}

export interface UserSummary {
  userId: string;
  status: 'active' | 'revoked';
  hasBearer: boolean;
  bearerStatus: 'active' | 'revoked' | null;
  updatedAt: string | null;
}

export interface AdminSessionPayload {
  role: 'admin';
  exp: number;
}

export interface OAuthStatePayload {
  nonce: string;
  userId: string;
  issuedAt: number;
}

export interface OAuthStartTicketRecord {
  ticketHash: string;
  userId: string;
  status: 'active' | 'used' | 'expired';
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  usedAt?: Date | null;
}

export type McpTraceSource = 'synthetic' | 'external';

export interface McpRequestAuthContext {
  userId: string;
  bearerToken: string;
  traceId?: string;
  source?: McpTraceSource;
}

export interface McpHttpTraceContext {
  traceId: string;
  requestId: string;
  userId: string;
  source: McpTraceSource;
}

// ── Encryption ──

export interface EncryptedSecretRecord {
  encryptedToken: string;
  wrappedDek: string;
  iv: string;
  authTag: string;
  alg: 'aes-256-gcm';
  kekResource: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'revoked';
  refreshTokenLastFour: string;
}

export interface OAuthTokenDocument extends EncryptedSecretRecord {
  scopes: string[];
  tokenType?: string;
  expiryDate?: number | null;
  accessTokenEncrypted?: string;
  accessTokenIv?: string;
  accessTokenAuthTag?: string;
  accessTokenWrappedDek?: string;
}

// ── MCP Tools ──

export type ToolResult = CallToolResult;

export interface AuthorizationRequiredPayload {
  status: 'authorization_required';
  provider: 'google';
  userId: string;
  authUrl: string;
  actionLabel: string;
  message: string;
  retryInstruction: string;
  retryable: true;
}

export interface LinkPromptPayload {
  status: 'authorization_link_ready' | 'authorized';
  provider: 'google';
  userId: string;
  title: string;
  message: string;
  authUrl?: string;
  markdownLink?: string;
  nextStep?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolContext {
  userId: string;
  oauthClient: OAuth2Client;
  drive: drive_v3.Drive;
  logger: Logger;
  requestId: string;
}

export interface AuthStatusInfo {
  authorized: boolean;
  provider: 'google';
  userId: string;
  authUrl?: string;
  actionLabel?: string;
  message: string;
  retryInstruction?: string;
}

// ── Hono ──

export interface RequestContextVariables {
  requestId: string;
  logger: Logger;
  authUser?: AuthenticatedUser;
}

export type HonoEnv = { Variables: RequestContextVariables };
export type AppContext = Context<HonoEnv>;
