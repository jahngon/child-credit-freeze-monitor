import { promises as fs } from 'node:fs';
import type { State, BureauData, CategoryData } from './state.js';

export const OVERRIDES_PATH = 'data/manual_overrides.json';

interface OverrideCategory {
	logic?: 'or' | 'and' | 'na';
	options?: string[];
	notes?: string | null;
}

interface OverrideDocument {
	id: string;
	label?: string;
	description?: string;
}

interface OverrideBureau {
	sourceUrl?: string;
	documents?: OverrideDocument[];
	categories?: Partial<{
		authority: OverrideCategory;
		parentId: OverrideCategory;
		address: OverrideCategory;
		childId: OverrideCategory;
	}>;
}

export interface Overrides {
	bureaus?: Record<string, OverrideBureau>;
}

/**
 * Read data/manual_overrides.json. Returns an empty object if the file doesn't exist.
 * Validates only loosely — overrides are user-authored and may be partial.
 */
export async function readOverrides(): Promise<Overrides> {
	try {
		const text = await fs.readFile(OVERRIDES_PATH, 'utf8');
		const parsed = JSON.parse(text);
		return parsed as Overrides;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw err;
	}
}

/**
 * Apply manual overrides on top of the State. Returns a new State; does not mutate
 * the input. Overrides patch fields shallowly within each bureau/category — only
 * fields present in the override file are touched.
 */
export function applyOverrides(state: State, overrides: Overrides): State {
	if (!overrides.bureaus) return structuredClone(state);

	const merged = structuredClone(state);
	for (const bureau of merged.bureaus) {
		const override = overrides.bureaus[bureau.bureau];
		if (!override) continue;

		if (override.sourceUrl !== undefined) {
			bureau.sourceUrl = override.sourceUrl;
		}

		if (override.documents) {
			for (const overrideDoc of override.documents) {
				const existing = bureau.documents.find((d) => d.id === overrideDoc.id);
				if (existing) {
					if (overrideDoc.label !== undefined) existing.label = overrideDoc.label;
					if (overrideDoc.description !== undefined) {
						existing.description = overrideDoc.description;
					}
				} else {
					// New document added entirely via override
					bureau.documents.push({
						id: overrideDoc.id,
						label: overrideDoc.label ?? overrideDoc.id,
						...(overrideDoc.description !== undefined
							? { description: overrideDoc.description }
							: {}),
					});
				}
			}
		}

		if (override.categories) {
			const cats: Array<keyof typeof bureau.categories> = [
				'authority',
				'parentId',
				'address',
				'childId',
			];
			for (const catKey of cats) {
				const catOverride = override.categories[catKey];
				if (!catOverride) continue;
				const target = bureau.categories[catKey];
				applyCategoryOverride(target, catOverride);
			}
		}
	}

	return merged;
}

function applyCategoryOverride(target: CategoryData, override: OverrideCategory): void {
	if (override.logic !== undefined) target.logic = override.logic;
	if (override.options !== undefined) target.options = [...override.options];
	if (override.notes !== undefined) {
		if (override.notes === null) {
			delete target.notes;
		} else {
			target.notes = override.notes;
		}
	}
}
