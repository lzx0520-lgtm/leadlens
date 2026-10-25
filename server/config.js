import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.LEADLENS_PORT ?? 8787);

export const DATA_DIR = process.env.LEADLENS_DATA_DIR ?? join(ROOT, 'data');
export const DB_FILE = join(DATA_DIR, 'leadlens.db');
export const WEB_DIR = join(ROOT, 'web');

/** 低于此分的采集内容不会进入线索池 */
export const DEFAULT_MIN_SCORE = Number(process.env.LEADLENS_MIN_SCORE ?? 45);

export const maxBodyBytes = 2 * 1024 * 1024;
