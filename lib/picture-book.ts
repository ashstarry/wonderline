import { z } from 'zod';
import type { ArtStyle, Scene } from './scene';
import type { ConversationEntry } from './conversation';
import { sceneSchema } from './scene-validation';

export const PICTURE_BOOK_KEY = 'wonderline-picture-book-v1';
export const PICTURE_BOOK_LIMIT = 12;
// Count UTF-16 storage bytes conservatively, including thumbnails. Saving never
// evicts a child's previous picture to make room for a new one.
export const PICTURE_BOOK_MAX_BYTES = 3 * 1024 * 1024;
export const PICTURE_BOOK_THUMBNAIL_LIMIT = 384 * 1024;

export type PictureBookDraft = { scene: Scene; style: ArtStyle; conversation: ConversationEntry[]; thumbnail: string };
export type PictureBookEntry = PictureBookDraft & { id: string; createdAt: number };
export type PictureBookFailure = 'invalid' | 'full' | 'too-large' | 'unavailable' | 'changed';
export class PictureBookError extends Error {
  constructor(public readonly reason: PictureBookFailure) { super(`Picture book: ${reason}`); this.name = 'PictureBookError'; }
}

const conversationSchema = z.object({
  id: z.string().min(1).max(200), kind: z.enum(['voice', 'text']),
  text: z.string().max(120000), partial: z.string().max(12000),
  status: z.enum(['listening', 'saved', 'unconfirmed']),
  createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(),
  sessionId: z.string().max(200).optional(), revision: z.number().int().nonnegative().optional(),
  omittedRanges: z.array(z.object({ start: z.number().int().min(0).max(12000), end: z.number().int().min(1).max(12000) }).strict().refine(range => range.end > range.start)).max(12000).optional(),
}).strict();

/** Accept only small raster thumbnails, never remote URLs or active SVG. */
export function validPictureThumbnail(value: string): boolean {
  const prefix = 'data:image/png;base64,';
  if (!value.startsWith(prefix) || value.length > PICTURE_BOOK_THUMBNAIL_LIMIT) return false;
  const encoded = value.slice(prefix.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  try {
    const bytes = atob(encoded.slice(0, 44));
    if (bytes.length < 33 || bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || bytes.slice(12, 16) !== 'IHDR') return false;
    const uint32 = (offset: number) => ((bytes.charCodeAt(offset) * 2 ** 24) + (bytes.charCodeAt(offset + 1) << 16) + (bytes.charCodeAt(offset + 2) << 8) + bytes.charCodeAt(offset + 3));
    const width = uint32(16), height = uint32(20);
    return uint32(8) === 13 && width >= 1 && width <= 320 && height >= 1 && height <= 320;
  } catch { return false; }
}

const entrySchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/), createdAt: z.number().finite().nonnegative().max(8.64e15),
  scene: sceneSchema, style: z.enum(['crayon', 'pencil', 'watercolor']),
  conversation: z.array(conversationSchema).max(400).refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length),
  thumbnail: z.string().max(PICTURE_BOOK_THUMBNAIL_LIMIT).refine(validPictureThumbnail),
}).strict();
const bookSchema = z.object({
  version: z.literal(1), entries: z.array(entrySchema).max(PICTURE_BOOK_LIMIT).refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length),
}).strict();

/** null means corrupt/unsupported storage, not an empty book to overwrite. */
export function readPictureBook(raw: string | null): PictureBookEntry[] | null {
  if (raw === null) return [];
  if (!raw || raw.length * 2 > PICTURE_BOOK_MAX_BYTES) return null;
  try {
    const checked = bookSchema.safeParse(JSON.parse(raw));
    return checked.success ? checked.data.entries as PictureBookEntry[] : null;
  } catch { return null; }
}

export function serializePictureBook(entries: PictureBookEntry[]): string {
  if (entries.length > PICTURE_BOOK_LIMIT) throw new PictureBookError('full');
  const checked = bookSchema.safeParse({ version: 1, entries });
  if (!checked.success) throw new PictureBookError('invalid');
  const raw = JSON.stringify(checked.data);
  if (raw.length * 2 > PICTURE_BOOK_MAX_BYTES) throw new PictureBookError('too-large');
  return raw;
}

export function addPicture(entries: PictureBookEntry[], draft: PictureBookDraft, id: string, now = Date.now()): PictureBookEntry[] {
  // Validation also clones the snapshot; later live drawing cannot change it.
  const next = [{ ...draft, id, createdAt: now }, ...entries];
  return readPictureBook(serializePictureBook(next))!;
}

export type PictureBookStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type PictureBookState = { entries: PictureBookEntry[]; raw: string | null };
export function loadPictureBook(storage: PictureBookStorage): PictureBookState {
  let raw: string | null;
  try { raw = storage.getItem(PICTURE_BOOK_KEY); } catch { throw new PictureBookError('unavailable'); }
  const entries = readPictureBook(raw);
  if (!entries) throw new PictureBookError('invalid');
  return { entries, raw };
}

/** Atomic single-key write; quota failures leave the previous book untouched.
 * Recheck the read version so another tab's newly kept picture is not clobbered. */
export function storePictureBook(storage: PictureBookStorage, entries: PictureBookEntry[], expectedRaw: string | null): PictureBookState {
  if (readPictureBook(expectedRaw) === null) throw new PictureBookError('invalid');
  const raw = serializePictureBook(entries);
  try {
    if (storage.getItem(PICTURE_BOOK_KEY) !== expectedRaw) throw new PictureBookError('changed');
    storage.setItem(PICTURE_BOOK_KEY, raw);
  } catch (error) {
    if (error instanceof PictureBookError) throw error;
    throw new PictureBookError('unavailable');
  }
  return { entries: readPictureBook(raw)!, raw };
}
