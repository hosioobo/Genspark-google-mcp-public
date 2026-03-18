import { z } from 'zod';
import type { AppConfig } from './types.js';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  BASE_URL: z.string().url(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),
  GOOGLE_OAUTH_SCOPES: z.string().default('https://www.googleapis.com/auth/drive'),
  FIRESTORE_COLLECTION_USERS: z.string().default('users'),
  FIRESTORE_COLLECTION_TOKENS: z.string().default('oauthTokens'),
  KMS_KEY_NAME: z.string().min(1),
  TOKEN_HASH_PEPPER: z.string().min(16),
  ADMIN_KEY: z.string().min(16),
  ADMIN_SESSION_SECRET: z.string().min(16).optional(),
  ADMIN_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  GOOGLE_TOKEN_REVOKE_ENDPOINT: z.string().url().default('https://oauth2.googleapis.com/revoke'),
  ENABLE_DEBUG_UI: z.enum(['true', 'false']).default('false'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const p = envSchema.parse(env);
  return {
    port: p.PORT,
    baseUrl: p.BASE_URL,
    googleOAuthClientId: p.GOOGLE_OAUTH_CLIENT_ID,
    googleOAuthClientSecret: p.GOOGLE_OAUTH_CLIENT_SECRET,
    googleOAuthRedirectUri: p.GOOGLE_OAUTH_REDIRECT_URI,
    googleOAuthScopes: p.GOOGLE_OAUTH_SCOPES.split(',').map(s => s.trim()).filter(Boolean),
    firestoreCollectionUsers: p.FIRESTORE_COLLECTION_USERS,
    firestoreCollectionTokens: p.FIRESTORE_COLLECTION_TOKENS,
    kmsKeyName: p.KMS_KEY_NAME,
    tokenHashPepper: p.TOKEN_HASH_PEPPER,
    adminKey: p.ADMIN_KEY,
    adminSessionSecret: p.ADMIN_SESSION_SECRET ?? p.ADMIN_KEY,
    adminSessionMaxAgeSeconds: p.ADMIN_SESSION_MAX_AGE_SECONDS,
    rateLimitPerMinute: p.RATE_LIMIT_PER_MINUTE,
    googleTokenRevokeEndpoint: p.GOOGLE_TOKEN_REVOKE_ENDPOINT,
    enableDebugUi: p.ENABLE_DEBUG_UI === 'true',
  };
}
