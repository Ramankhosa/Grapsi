// @ts-nocheck
import crypto from 'crypto';
import fs from 'fs';
import formidable, { type File } from 'formidable';
import type { NextApiRequest } from 'next';

const MAX_TEMPLATE_ASSET_BYTES = 20 * 1024 * 1024;
const TEMPLATE_ASSET_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export async function readJsonBody<T>(req: NextApiRequest): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}') as T;
}

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function parseTemplateAssetForm(req: NextApiRequest): Promise<{
  fields: formidable.Fields;
  file: File;
}> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_TEMPLATE_ASSET_BYTES,
    filter: () => true,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      const incoming = (files as any).file;
      const file = Array.isArray(incoming) ? incoming[0] : incoming;
      if (!file) {
        reject(new Error('No file received'));
        return;
      }

      if (file.size > MAX_TEMPLATE_ASSET_BYTES) {
        reject(new Error('Template asset is too large'));
        return;
      }

      if (!TEMPLATE_ASSET_MIME.has(String(file.mimetype || ''))) {
        reject(new Error('Unsupported template asset type'));
        return;
      }

      resolve({ fields, file });
    });
  });
}
