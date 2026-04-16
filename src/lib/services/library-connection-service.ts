import { prisma } from '../prisma';
import { encryptToken, decryptToken } from '../auth';
import { refreshMendeleyToken } from '../library-oauth-config';

export type LibraryProvider = 'mendeley' | 'zotero';

export interface ConnectionInfo {
  provider: LibraryProvider;
  displayName: string | null;
  email: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  totalImported: number;
  isActive: boolean;
  createdAt: string;
}

interface SaveConnectionInput {
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  providerUserId?: string;
  displayName?: string;
  email?: string;
}

interface DecryptedTokens {
  accessToken: string | null;
  refreshToken: string | null;
  providerUserId: string | null;
  tokenExpiresAt: Date | null;
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before actual expiry

class LibraryConnectionService {
  async getConnection(userId: string, provider: LibraryProvider) {
    return prisma.libraryConnection.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  }

  async saveConnection(userId: string, provider: LibraryProvider, input: SaveConnectionInput) {
    const accessTokenEnc = input.accessToken ? encryptToken(input.accessToken) : undefined;
    const refreshTokenEnc = input.refreshToken ? encryptToken(input.refreshToken) : undefined;
    const tokenExpiresAt = input.expiresInSeconds
      ? new Date(Date.now() + input.expiresInSeconds * 1000)
      : undefined;

    return prisma.libraryConnection.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        accessTokenEnc: accessTokenEnc ?? null,
        refreshTokenEnc: refreshTokenEnc ?? null,
        tokenExpiresAt: tokenExpiresAt ?? null,
        providerUserId: input.providerUserId ?? null,
        displayName: input.displayName ?? null,
        email: input.email ?? null,
        isActive: true,
      },
      update: {
        accessTokenEnc: accessTokenEnc ?? undefined,
        refreshTokenEnc: refreshTokenEnc ?? undefined,
        tokenExpiresAt: tokenExpiresAt ?? undefined,
        providerUserId: input.providerUserId ?? undefined,
        displayName: input.displayName ?? undefined,
        email: input.email ?? undefined,
        isActive: true,
      },
    });
  }

  async removeConnection(userId: string, provider: LibraryProvider) {
    const existing = await this.getConnection(userId, provider);
    if (!existing) return null;

    return prisma.libraryConnection.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
      },
    });
  }

  async getActiveConnections(userId: string): Promise<ConnectionInfo[]> {
    const connections = await prisma.libraryConnection.findMany({
      where: { userId, isActive: true },
    });

    return connections.map((c) => ({
      provider: c.provider as LibraryProvider,
      displayName: c.displayName,
      email: c.email,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: c.lastSyncStatus,
      lastSyncMessage: c.lastSyncMessage,
      totalImported: c.totalImported,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  private decryptTokens(connection: {
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    providerUserId: string | null;
    tokenExpiresAt: Date | null;
  }): DecryptedTokens {
    return {
      accessToken: connection.accessTokenEnc ? decryptToken(connection.accessTokenEnc) : null,
      refreshToken: connection.refreshTokenEnc ? decryptToken(connection.refreshTokenEnc) : null,
      providerUserId: connection.providerUserId,
      tokenExpiresAt: connection.tokenExpiresAt,
    };
  }

  /**
   * For Mendeley: checks token expiry, auto-refreshes if needed, returns valid access token.
   * For Zotero: keys don't expire, just decrypt and return.
   */
  async ensureValidToken(userId: string, provider: LibraryProvider): Promise<{
    accessToken: string;
    providerUserId: string | null;
  }> {
    const connection = await this.getConnection(userId, provider);
    if (!connection || !connection.isActive) {
      throw new Error(`No active ${provider} connection found. Please connect your ${provider} account first.`);
    }

    const tokens = this.decryptTokens(connection);

    if (provider === 'zotero') {
      if (!tokens.accessToken) {
        throw new Error('Zotero API key is missing. Please reconnect your Zotero account.');
      }
      return { accessToken: tokens.accessToken, providerUserId: tokens.providerUserId };
    }

    // Mendeley: check if token is still valid
    const now = Date.now();
    const isExpired = tokens.tokenExpiresAt
      ? tokens.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < now
      : true;

    if (!isExpired && tokens.accessToken) {
      return { accessToken: tokens.accessToken, providerUserId: tokens.providerUserId };
    }

    // Token is expired or about to expire -- refresh
    if (!tokens.refreshToken) {
      throw new Error('Mendeley session expired and no refresh token available. Please reconnect your Mendeley account.');
    }

    const refreshed = await refreshMendeleyToken(tokens.refreshToken);

    await this.saveConnection(userId, 'mendeley', {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresInSeconds: refreshed.expires_in,
    });

    return { accessToken: refreshed.access_token, providerUserId: tokens.providerUserId };
  }

  async updateSyncStatus(
    userId: string,
    provider: LibraryProvider,
    status: 'success' | 'partial' | 'failed',
    message: string,
    totalImported: number
  ) {
    const connection = await this.getConnection(userId, provider);
    if (!connection) return;

    await prisma.libraryConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncMessage: message,
        totalImported,
      },
    });
  }
}

export const libraryConnectionService = new LibraryConnectionService();
