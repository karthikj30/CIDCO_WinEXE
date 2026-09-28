import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export const ALLOWED_CSV_TYPES = [
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream',
];

export type StoredFile = {
  storedName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export async function saveUpload(file: File): Promise<StoredFile> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || '';
  // Store under a random name so a caller cannot influence the path on disk.
  const storedName = `${randomUUID()}${ext.toLowerCase()}`;
  await writeFile(path.join(UPLOAD_DIR, storedName), buffer);
  return {
    storedName,
    fileName: path.basename(file.name),
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: buffer.length,
  };
}

export async function readUpload(storedName: string) {
  // Guard against traversal: only a bare file name is ever acceptable.
  if (storedName !== path.basename(storedName)) throw new Error('Invalid file reference');
  return readFile(path.join(UPLOAD_DIR, storedName));
}

export function assertFileAllowed(file: File, allowedTypes: string[], label: string) {
  if (file.size === 0) throw new Error(`${label} "${file.name}" is empty`);
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${label} "${file.name}" exceeds the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit`);
  }
  const type = file.type || 'application/octet-stream';
  if (!allowedTypes.includes(type)) {
    throw new Error(`${label} "${file.name}" has unsupported type "${type}". Allowed: ${allowedTypes.join(', ')}`);
  }
}
