import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  createPaperFigureImageAccessToken,
  getImageContentType,
  getPaperFigureImageCandidates,
  resolvePaperFigureImageUrl,
  verifyPaperFigureImageAccessToken
} from '../paper-figure-image';

describe('paper figure image helpers', () => {
  it('rewrites local upload paths to the paper figure image API', () => {
    const url = resolvePaperFigureImageUrl('paper123', 'figure456', '/uploads/figures/example.png', 'v1');

    expect(url).toContain('/api/papers/paper123/figures/figure456/image?');
    expect(url).toContain('token=');
    expect(url).toContain('v=v1');
  });

  it('creates and verifies signed access tokens', () => {
    const token = createPaperFigureImageAccessToken({
      sessionId: 'paper123',
      figureId: 'figure456',
      version: 'checksum-1',
      now: 1_700_000_000_000,
    });

    expect(
      verifyPaperFigureImageAccessToken({
        token,
        sessionId: 'paper123',
        figureId: 'figure456',
        version: 'checksum-1',
        now: 1_700_000_100_000,
      })
    ).toBe(true);

    expect(
      verifyPaperFigureImageAccessToken({
        token,
        sessionId: 'paper123',
        figureId: 'figure456',
        version: 'checksum-2',
        now: 1_700_000_100_000,
      })
    ).toBe(false);
  });

  it('returns candidate filesystem paths for public uploads', () => {
    const candidates = getPaperFigureImageCandidates('/uploads/paper-sketches/paper123/sketch.png');

    expect(candidates).toContain(
      path.join(process.cwd(), 'public', 'uploads', 'paper-sketches', 'paper123', 'sketch.png')
    );
  });

  it('infers content type from image extension', () => {
    expect(getImageContentType('chart.svg')).toBe('image/svg+xml');
    expect(getImageContentType('plot.jpg')).toBe('image/jpeg');
    expect(getImageContentType('default.png')).toBe('image/png');
  });
});
