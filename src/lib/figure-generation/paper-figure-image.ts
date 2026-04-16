import crypto from 'crypto';
import path from 'path';

const PAPER_FIGURE_IMAGE_SECRET = process.env.JWT_SECRET || 'your-super-secure-jwt-secret-change-in-production-min-32-chars';
const PAPER_FIGURE_IMAGE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function encodeBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildPaperFigureImageTokenPayload(params: {
  sessionId: string;
  figureId: string;
  version?: string | null;
  expiresAt: number;
}): string {
  const version = cleanString(params.version);
  return [
    params.sessionId,
    params.figureId,
    version,
    String(params.expiresAt),
  ].join(':');
}

function signPaperFigureImageToken(payload: string): string {
  return encodeBase64Url(
    crypto.createHmac('sha256', PAPER_FIGURE_IMAGE_SECRET).update(payload).digest()
  );
}

export function createPaperFigureImageAccessToken(params: {
  sessionId: string;
  figureId: string;
  version?: string | null;
  now?: number;
}): string {
  const issuedAt = Number.isFinite(params.now) ? Number(params.now) : Date.now();
  const expiresAt = issuedAt + PAPER_FIGURE_IMAGE_TTL_MS;
  const payload = buildPaperFigureImageTokenPayload({
    sessionId: params.sessionId,
    figureId: params.figureId,
    version: params.version,
    expiresAt,
  });
  const signature = signPaperFigureImageToken(payload);
  return `${expiresAt}.${signature}`;
}

export function verifyPaperFigureImageAccessToken(params: {
  token?: string | null;
  sessionId: string;
  figureId: string;
  version?: string | null;
  now?: number;
}): boolean {
  const token = cleanString(params.token);
  if (!token) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }

  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  const now = Number.isFinite(params.now) ? Number(params.now) : Date.now();
  if (expiresAt < now) {
    return false;
  }

  const payload = buildPaperFigureImageTokenPayload({
    sessionId: params.sessionId,
    figureId: params.figureId,
    version: params.version,
    expiresAt,
  });
  const expectedSignature = signPaperFigureImageToken(payload);
  if (parts[1].length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(parts[1], 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );
}

export function resolvePaperFigureImageUrl(
  sessionId: string,
  figureId: string,
  imagePath?: string | null,
  version?: string | null
): string | null {
  if (!imagePath) {
    return null;
  }

  const trimmed = imagePath.trim();
  if (!trimmed) {
    return null;
  }

  if (/^(?:https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  if (trimmed.startsWith('/api/papers/')) {
    return trimmed;
  }

  const normalizedVersion = cleanString(version) || trimmed;
  const token = createPaperFigureImageAccessToken({
    sessionId,
    figureId,
    version: normalizedVersion,
  });
  const params = new URLSearchParams({
    token,
    v: normalizedVersion,
  });

  return `/api/papers/${encodeURIComponent(sessionId)}/figures/${encodeURIComponent(figureId)}/image?${params.toString()}`;
}

export function getPaperFigureImageCandidates(imagePath?: string | null): string[] {
  if (!imagePath) {
    return [];
  }

  const trimmed = imagePath.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace(/^[/\\]+/, '');
  const candidates = new Set<string>();

  if (path.isAbsolute(trimmed)) {
    candidates.add(trimmed);
  }

  if (trimmed.startsWith('/uploads/') || normalized.startsWith('uploads/')) {
    candidates.add(path.join(process.cwd(), 'public', normalized));
  }

  if (normalized.startsWith('public/')) {
    candidates.add(path.join(process.cwd(), normalized));
  }

  if (!path.isAbsolute(trimmed)) {
    candidates.add(path.join(process.cwd(), normalized));
  }

  return Array.from(candidates);
}

export function getImageContentType(imagePath: string): string {
  const lower = imagePath.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}
