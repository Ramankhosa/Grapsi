// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from 'next';
import { getReviewerSession as getServerSession, requireGrantReviewFeature } from '@/lib/reviewer-auth-api';
import prisma from '../../../../lib/prisma';
import formidable, { File } from 'formidable';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
// Broaden MIME acceptance to handle Windows/legacy browsers and fall back to extension check
const ALLOWED_MIME = new Set([
	'image/png', 'image/x-png',
	'image/jpeg', 'image/jpg', 'image/pjpeg',
	'image/webp',
	'application/pdf'
]);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']);

function computeSha256(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
		stream.on('error', reject);
	});
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files; }>{
	// Create uploads directory if it doesn't exist
	const uploadDir = './public/uploads';
	try {
		if (!fs.existsSync(uploadDir)) {
			fs.mkdirSync(uploadDir, { recursive: true });
		}
	} catch (e) {
		console.error("Error creating upload directory:", e);
	}

	const form = formidable({ 
		multiples: false, 
		maxFileSize: MAX_BYTES,
		// Most importantly, allow all file types and handle validation ourselves
		filter: () => true,
		// Set explicit uploadDir to prevent temp directory issues
		uploadDir, 
		keepExtensions: true
	});

	return new Promise((resolve, reject) => {
		form.parse(req, (err, fields, files) => {
			if (err) {
				console.error("Formidable parse error:", err);
				return reject(err);
			}
			
			// Log received files for debugging (handle arrays)
			const fileKeys = Object.keys(files);
			console.log(`Formidable parsed ${fileKeys.length} files:`, 
				fileKeys.map(k => {
					const f = (files as any)[k];
					const first: any = Array.isArray(f) ? f[0] : f;
					return { key: k, name: first?.originalFilename, size: first?.size };
				})
			);
			
			resolve({ fields, files });
		});
	});
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', ['POST']);
		return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
	}

	const session = await getServerSession(req, res);
	if (!session?.user?.id) return res.status(401).json({ error: 'Not authenticated' });
  if (!(await requireGrantReviewFeature(session, res))) return;

	try {
		const { fields, files } = await parseForm(req);
		
		// Accept both File and File[]
		const incoming: any = (files as any).file;
		if (!incoming) {
			console.error("File missing in files object", { keys: Object.keys(files) });
			return res.status(400).json({ 
				error: 'No file received', 
				debug: { fileKeys: Object.keys(files) }
			});
		}
		const file: File = Array.isArray(incoming) ? incoming[0] : incoming;
		
		console.log("File received:", { 
			name: (file as any)?.originalFilename,
			size: file?.size,
			path: (file as any)?.filepath,
			mimetype: (file as any)?.mimetype
		});
		
		// Extract fields with robust fallbacks
		const project_id = String(Array.isArray((fields as any).project_id) ? (fields as any).project_id[0] : (fields as any).project_id || '');
		const review_version_id = (fields as any).review_version_id ? String(Array.isArray((fields as any).review_version_id) ? (fields as any).review_version_id[0] : (fields as any).review_version_id) : undefined;
		const section_type = (fields as any).section_type ? String(Array.isArray((fields as any).section_type) ? (fields as any).section_type[0] : (fields as any).section_type) : undefined;

		if (!file || !file.filepath || !project_id) {
			return res.status(400).json({ 
				error: 'File and project_id are required', 
				details: { 
					hasFile: !!file,
					filePath: (file as any)?.filepath,
					hasProjectId: !!project_id 
				}
			});
		}

		// Accept all files and check extension only
		const originalName = String((file as any).originalFilename || 'upload').toLowerCase();
		const ext = path.extname(originalName);
		const size = file.size || 0;
		
		console.log('Upload debug:', { 
			mimetype: (file as any).mimetype || 'none', 
			size, 
			original: (file as any).originalFilename, 
			tmpPath: (file as any).filepath,
			ext
		});
		
		// Just go based on extension now
		if (!ALLOWED_EXT.has(ext)) {
			return res.status(415).json({ 
				error: `Unsupported file type: must be PNG, JPG, WEBP, or PDF. Got: ${ext || 'unknown'}`,
				details: {
					ext,
					original: (file as any).originalFilename,
					mimetype: (file as any).mimetype
				}
			});
		}
		
		// Normalize mime from extension so downstream logic stays consistent
		let mime;
		if (ext === '.png') mime = 'image/png';
		else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
		else if (ext === '.webp') mime = 'image/webp';
		else if (ext === '.pdf') mime = 'application/pdf';
		else mime = 'application/octet-stream'; // fallback
		if (size > MAX_BYTES) return res.status(400).json({ error: 'File too large' });

		const tmpPath = (file as any).filepath as string;
		console.log('Upload debug:', { mime, size, original: (file as any).originalFilename, tmpPath });
		const sha256 = await computeSha256(tmpPath);

		// Deduplicate per project
		const existing = await prisma.reviewAsset.findFirst({ where: { project_id, sha256 } });
		if (existing) {
			// Optionally auto-link if provided
			if (review_version_id && section_type) {
				try {
					// Enforce max 3 per section
					const count = await prisma.reviewAssetLink.count({ where: { review_version_id, section_type } });
					if (count >= 3) return res.status(409).json({ error: 'Max 3 assets per section' });
					await prisma.reviewAssetLink.create({ data: { review_version_id, section_type: section_type as any, asset_id: existing.id } });
				} catch {}
			}
			return res.status(200).json({ asset_id: existing.id, deduped: true, preview_url: existing.gcs_preview_uri || existing.gcs_uri });
		}

		// Store to local public/uploads for now; in prod, upload to GCS and set gcs_uri
		const uploadDir = 'public/uploads';
		if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
		const safeFileName = ((file as any).originalFilename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
		const destPath = `${uploadDir}/${Date.now()}_${safeFileName}`;
		await fs.promises.copyFile(tmpPath, destPath);

		const asset = await prisma.reviewAsset.create({
			data: {
				project_id,
				gcs_uri: `/${destPath}`,
				gcs_preview_uri: `/${destPath}`,
				mime,
				bytes: size as number,
				sha256,
				original_name: originalName,
				created_by_user_id: session.user.id as string,
			},
		});

		if (review_version_id && section_type) {
			const count = await prisma.reviewAssetLink.count({ where: { review_version_id, section_type } });
			if (count >= 3) return res.status(409).json({ error: 'Max 3 assets per section' });
			await prisma.reviewAssetLink.create({ data: { review_version_id, section_type: section_type as any, asset_id: asset.id } });
		}

		return res.status(201).json({ asset_id: asset.id, deduped: false, preview_url: asset.gcs_preview_uri || asset.gcs_uri });
	} catch (e: any) {
		console.error('Upload error', e);
		return res.status(500).json({ error: 'Upload failed' });
	}
}



