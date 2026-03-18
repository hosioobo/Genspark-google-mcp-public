import { Firestore, FieldValue, Transaction } from '@google-cloud/firestore';
import type { OAuthStartTicketRecord, OAuthTokenDocument, UserBearerRecord, UserSummary } from '../types.js';

export class ActiveUserAlreadyExistsError extends Error {
  constructor(userId: string) {
    super(`Active user already exists: ${userId}`);
    this.name = 'ActiveUserAlreadyExistsError';
  }
}

export class FirestoreUserRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly usersCollection: string,
    private readonly tokensCollection: string,
  ) {}

  private userRef(userId: string) {
    return this.firestore.collection(this.usersCollection).doc(userId);
  }

  private bearerRef(userId: string) {
    return this.userRef(userId).collection('bearers').doc('current');
  }

  private oauthRef(userId: string) {
    return this.userRef(userId).collection(this.tokensCollection).doc('current');
  }

  private oauthStartTicketRef(ticketHash: string) {
    return this.firestore.collection('oauthStartTickets').doc(ticketHash);
  }

  async upsertBearer(record: UserBearerRecord): Promise<void> {
    await this.bearerRef(record.userId).set({
      ...record,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revokedAt: record.revokedAt ?? null,
      rotatedAt: record.rotatedAt ?? null,
    }, { merge: true });
  }

  async getBearer(userId: string): Promise<UserBearerRecord | null> {
    const snapshot = await this.bearerRef(userId).get();
    if (!snapshot.exists) return null;
    return snapshot.data() as UserBearerRecord;
  }

  async saveOAuthToken(userId: string, record: OAuthTokenDocument): Promise<void> {
    await this.oauthRef(userId).set({
      ...record,
      updatedAt: new Date(),
    }, { merge: true });
  }

  async getOAuthToken(userId: string): Promise<OAuthTokenDocument | null> {
    const snapshot = await this.oauthRef(userId).get();
    if (!snapshot.exists) return null;
    return snapshot.data() as OAuthTokenDocument;
  }

  async deactivateOAuthToken(userId: string): Promise<void> {
    await this.oauthRef(userId).set({
      status: 'revoked',
      updatedAt: new Date(),
      revokedAt: new Date(),
    }, { merge: true });
  }

  async saveOAuthStartTicket(record: OAuthStartTicketRecord): Promise<void> {
    await this.oauthStartTicketRef(record.ticketHash).set({
      ...record,
      usedAt: record.usedAt ?? null,
    }, { merge: true });
  }

  async consumeOAuthStartTicket(ticketHash: string, now = new Date()): Promise<OAuthStartTicketRecord | null> {
    return this.firestore.runTransaction(async (transaction) => {
      const ticketRef = this.oauthStartTicketRef(ticketHash);
      const snapshot = await transaction.get(ticketRef);
      if (!snapshot.exists) return null;

      const data = snapshot.data() as Record<string, any>;
      const status = data.status === 'active' || data.status === 'used' || data.status === 'expired'
        ? data.status
        : 'active';
      const expiresAt = coerceDate(data.expiresAt);

      if (status !== 'active') {
        return null;
      }

      if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
        transaction.set(ticketRef, {
          status: 'expired',
          updatedAt: now,
        }, { merge: true });
        return null;
      }

      transaction.set(ticketRef, {
        status: 'used',
        updatedAt: now,
        usedAt: now,
      }, { merge: true });

      return {
        ticketHash,
        userId: typeof data.userId === 'string' ? data.userId : '',
        status: 'used',
        createdAt: coerceDate(data.createdAt) ?? now,
        updatedAt: now,
        expiresAt,
        usedAt: now,
      } satisfies OAuthStartTicketRecord;
    });
  }

  async revokeUser(userId: string): Promise<void> {
    await this.firestore.runTransaction(async (transaction) => {
      const bearerRef = this.bearerRef(userId);
      const oauthRef = this.oauthRef(userId);

      transaction.set(bearerRef, {
        status: 'revoked',
        updatedAt: new Date(),
        revokedAt: new Date(),
      }, { merge: true });

      transaction.set(oauthRef, {
        status: 'revoked',
        updatedAt: new Date(),
        revokedAt: new Date(),
      }, { merge: true });

      transaction.set(this.userRef(userId), {
        status: 'revoked',
        updatedAt: new Date(),
      }, { merge: true });
    });
  }

  async createOrReactivateUser(userId: string): Promise<void> {
    await this.withTransaction(async (transaction) => {
      const userRef = this.userRef(userId);
      const snapshot = await transaction.get(userRef);
      const data = snapshot.exists ? snapshot.data() as Record<string, any> : null;
      const status = data?.status === 'revoked' ? 'revoked' : data ? 'active' : null;

      if (status === 'active') {
        throw new ActiveUserAlreadyExistsError(userId);
      }

      if (!snapshot.exists) {
        transaction.create(userRef, {
          status: 'active',
          updatedAt: new Date(),
          createdAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      transaction.set(userRef, {
        status: 'active',
        updatedAt: new Date(),
        revokedAt: null,
      }, { merge: true });
    });
  }

  async markUserActive(userId: string): Promise<void> {
    await this.userRef(userId).set({
      status: 'active',
      updatedAt: new Date(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async listUsers(): Promise<UserSummary[]> {
    const snapshot = await this.firestore.collection(this.usersCollection).orderBy('updatedAt', 'desc').get();
    const results = await Promise.all(snapshot.docs.map(async (doc) => {
      const data = doc.data() as Record<string, any>;
      const bearer = await this.getBearer(doc.id);
      return {
        userId: doc.id,
        status: data.status === 'revoked' ? 'revoked' : 'active',
        hasBearer: !!bearer,
        bearerStatus: bearer?.status ?? null,
        updatedAt: typeof data.updatedAt?.toDate === 'function' ? data.updatedAt.toDate().toISOString() : null,
      } satisfies UserSummary;
    }));

    return results;
  }

  async withTransaction<T>(handler: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(handler);
  }
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}
