import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { State as StateSchema, BureauRequirements, RequirementCategory } from './schema.js';
import type { BureauKey } from './bureaus.js';

export type State = z.infer<typeof StateSchema>;
export type BureauData = z.infer<typeof BureauRequirements>;
export type CategoryData = z.infer<typeof RequirementCategory>;

export const STATE_PATH = 'data/state.json';
export const PUBLIC_STATE_PATH = 'data/state.public.json';
export const SNAPSHOTS_DIR = 'data/snapshots';

/**
 * Read data/state.json. Returns null if the file doesn't exist (first run).
 * Throws on read or parse error so the operator notices.
 */
export async function readState(): Promise<State | null> {
	try {
		const text = await fs.readFile(STATE_PATH, 'utf8');
		const parsed = JSON.parse(text);
		return StateSchema.parse(parsed);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

/**
 * Write the given State to disk with a stable normalized ordering so that
 * cosmetic reorderings (LLM output shuffling, etc.) never produce noisy git
 * diffs. Sorts: bureaus by key, documents by id, options by id.
 */
export async function writeState(state: State, filePath: string = STATE_PATH): Promise<void> {
	const normalized = normalizeState(state);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(normalized, null, 2) + '\n');
}

/**
 * Save the raw fetched content to data/snapshots/{bureau}/{YYYY-MM-DD}.{html|pdf}.
 * Per the brief, snapshots are only written when an actual content change is detected.
 */
export async function writeSnapshot(
	bureau: BureauKey,
	content: string | Buffer,
	format: 'html' | 'pdf'
): Promise<string> {
	const date = new Date().toISOString().slice(0, 10);
	const dir = path.join(SNAPSHOTS_DIR, bureau);
	await fs.mkdir(dir, { recursive: true });
	const ext = format === 'html' ? 'html' : 'pdf';
	const fullPath = path.join(dir, `${date}.${ext}`);
	await fs.writeFile(fullPath, content);
	return fullPath;
}

export function normalizeState(state: State): State {
	return {
		...state,
		bureaus: [...state.bureaus]
			.map(normalizeBureau)
			.sort((a, b) => a.bureau.localeCompare(b.bureau)),
	};
}

function normalizeBureau(b: BureauData): BureauData {
	return {
		...b,
		documents: [...b.documents].sort((a, b) => a.id.localeCompare(b.id)),
		categories: {
			authority: normalizeCategory(b.categories.authority),
			parentId: normalizeCategory(b.categories.parentId),
			address: normalizeCategory(b.categories.address),
			childId: normalizeCategory(b.categories.childId),
		},
	};
}

function normalizeCategory(c: CategoryData): CategoryData {
	return { ...c, options: [...c.options].sort() };
}
