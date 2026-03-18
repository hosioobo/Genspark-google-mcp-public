import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import argon2 from 'argon2';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function hashBearerToken(token: string, pepper: string): Promise<string> {
  return argon2.hash(`${token}${pepper}`, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyBearerToken(token: string, pepper: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, `${token}${pepper}`);
}

export function createOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

export function parseBearerToken(headerValue?: string | null): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}
