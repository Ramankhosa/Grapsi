// @ts-nocheck
import crypto from 'crypto';
import fs from 'fs';
import formidable, { type File } from 'formidable';
import type { NextApiRequest } from 'next';

const MAX_INTAKE_PDF_BYTES = 20 * 1024 * 1024;
const INTAKE_PDF_MIME = new Set(['application/pdf']);

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

export function parseIntakePdfForm(req: NextApiRequest): Promise<{
  fields: formidable.Fields;
  file: File;
}> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_INTAKE_PDF_BYTES,
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
        reject(new Error('No PDF file received'));
        return;
      }

      if (file.size > MAX_INTAKE_PDF_BYTES) {
        reject(new Error('PDF intake file is too large'));
        return;
      }

      if (!INTAKE_PDF_MIME.has(String(file.mimetype || ''))) {
        reject(new Error('Only PDF files are supported for intake uploads'));
        return;
      }

      resolve({ fields, file });
    });
  });
}
