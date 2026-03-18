import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { EncryptedSecretRecord } from '../types.js';

export class EncryptionService {
  constructor(
    private readonly kmsClient: KeyManagementServiceClient,
    private readonly kmsKeyName: string,
  ) {}

  async encryptRefreshToken(token: string): Promise<EncryptedSecretRecord> {
    const dek = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const [wrapResult] = await this.kmsClient.encrypt({ name: this.kmsKeyName, plaintext: dek });
    if (!wrapResult.ciphertext) throw new Error('Failed to wrap data encryption key');

    return {
      encryptedToken: encrypted.toString('base64'),
      wrappedDek: Buffer.from(wrapResult.ciphertext).toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      alg: 'aes-256-gcm',
      kekResource: this.kmsKeyName,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
      refreshTokenLastFour: token.slice(-4),
    };
  }

  async decryptRefreshToken(record: Pick<EncryptedSecretRecord, 'encryptedToken' | 'wrappedDek' | 'iv' | 'authTag'>): Promise<string> {
    const [unwrapResult] = await this.kmsClient.decrypt({
      name: this.kmsKeyName,
      ciphertext: Buffer.from(record.wrappedDek, 'base64'),
    });
    if (!unwrapResult.plaintext) throw new Error('Failed to unwrap data encryption key');

    const dek = Buffer.from(unwrapResult.plaintext);
    const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.encryptedToken, 'base64')), decipher.final()]).toString('utf8');
  }
}
