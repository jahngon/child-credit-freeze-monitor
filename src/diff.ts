import type { State, BureauData, CategoryData } from './state.js';
import type { z } from 'zod';
import type { DocumentOption } from './schema.js';

type DocumentData = z.infer<typeof DocumentOption>;

const CATEGORY_KEYS = ['authority', 'parentId', 'address', 'childId'] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface CategoryChange {
	logicChange?: { from: string; to: string };
	optionsAdded: string[];
	optionsRemoved: string[];
	notesChange?: { from: string | null; to: string | null };
}

export interface DocumentChange {
	id: string;
	labelChange?: { from: string; to: string };
	descriptionChange?: { from: string | null; to: string | null };
}

export interface MailingAddressChange {
	from: { lines: string[]; notes?: string };
	to: { lines: string[]; notes?: string };
	/** True if the actual address lines differ. False = only the LLM's notes field changed
	 * (often just commentary rephrasing). Only `linesChanged: true` triggers the high-priority
	 * address alert; notes-only changes ride in the regular digest. */
	linesChanged: boolean;
}

export interface BureauChange {
	bureau: string;
	sourceUrlChange?: { from: string; to: string };
	documentsAdded: DocumentData[];
	documentsRemoved: DocumentData[];
	documentsChanged: DocumentChange[];
	categoryChanges: Partial<Record<CategoryKey, CategoryChange>>;
	mailingAddressChange?: MailingAddressChange;
}

export interface DiffResult {
	hasChanges: boolean;
	bureauChanges: BureauChange[];
	bureausAdded: BureauData[];
	bureausRemoved: BureauData[];
	/** Convenience flag: true if any bureau's mailing address changed.
	 * Used to route the high-priority address alert separately from the regular digest. */
	hasAddressChanges: boolean;
}

/**
 * Compare prior state to current. Ignores lastChecked/lastChanged. Treats
 * options arrays as sets (reordering = no change). Returns a structured
 * description of every change.
 *
 * If prior is null (first run), every bureau in current is reported as added.
 */
export function computeDiff(prior: State | null, current: State): DiffResult {
	const result: DiffResult = {
		hasChanges: false,
		bureauChanges: [],
		bureausAdded: [],
		bureausRemoved: [],
		hasAddressChanges: false,
	};

	if (!prior) {
		if (current.bureaus.length > 0) {
			result.hasChanges = true;
			result.bureausAdded = [...current.bureaus];
			// Treat first-run as "everything new" — the digest covers it.
			// We don't flag address-changes because no prior baseline existed.
		}
		return result;
	}

	const priorByKey = new Map(prior.bureaus.map((b) => [b.bureau, b]));
	const currentByKey = new Map(current.bureaus.map((b) => [b.bureau, b]));

	for (const [key, currentBureau] of currentByKey) {
		const priorBureau = priorByKey.get(key);
		if (!priorBureau) {
			result.bureausAdded.push(currentBureau);
			result.hasChanges = true;
		} else {
			const change = diffBureau(priorBureau, currentBureau);
			if (change) {
				result.bureauChanges.push(change);
				result.hasChanges = true;
				if (change.mailingAddressChange?.linesChanged) result.hasAddressChanges = true;
			}
		}
	}
	for (const [key, priorBureau] of priorByKey) {
		if (!currentByKey.has(key)) {
			result.bureausRemoved.push(priorBureau);
			result.hasChanges = true;
		}
	}

	return result;
}

function diffBureau(prior: BureauData, current: BureauData): BureauChange | null {
	const change: BureauChange = {
		bureau: current.bureau,
		documentsAdded: [],
		documentsRemoved: [],
		documentsChanged: [],
		categoryChanges: {},
	};
	let dirty = false;

	if (prior.sourceUrl !== current.sourceUrl) {
		change.sourceUrlChange = { from: prior.sourceUrl, to: current.sourceUrl };
		dirty = true;
	}

	const priorDocs = new Map(prior.documents.map((d) => [d.id, d]));
	const currentDocs = new Map(current.documents.map((d) => [d.id, d]));

	for (const [id, doc] of currentDocs) {
		const priorDoc = priorDocs.get(id);
		if (!priorDoc) {
			change.documentsAdded.push(doc);
			dirty = true;
		} else {
			const dc: DocumentChange = { id };
			let docDirty = false;
			if (priorDoc.label !== doc.label) {
				dc.labelChange = { from: priorDoc.label, to: doc.label };
				docDirty = true;
			}
			const priorDesc = priorDoc.description ?? null;
			const currentDesc = doc.description ?? null;
			if (priorDesc !== currentDesc) {
				dc.descriptionChange = { from: priorDesc, to: currentDesc };
				docDirty = true;
			}
			if (docDirty) {
				change.documentsChanged.push(dc);
				dirty = true;
			}
		}
	}
	for (const [id, doc] of priorDocs) {
		if (!currentDocs.has(id)) {
			change.documentsRemoved.push(doc);
			dirty = true;
		}
	}
	change.documentsAdded.sort((a, b) => a.id.localeCompare(b.id));
	change.documentsRemoved.sort((a, b) => a.id.localeCompare(b.id));
	change.documentsChanged.sort((a, b) => a.id.localeCompare(b.id));

	for (const cat of CATEGORY_KEYS) {
		const catChange = diffCategory(prior.categories[cat], current.categories[cat]);
		if (catChange) {
			change.categoryChanges[cat] = catChange;
			dirty = true;
		}
	}

	const addrChange = diffMailingAddress(prior.mailingAddress, current.mailingAddress);
	if (addrChange) {
		change.mailingAddressChange = addrChange;
		dirty = true;
	}

	return dirty ? change : null;
}

function diffMailingAddress(
	prior: BureauData['mailingAddress'],
	current: BureauData['mailingAddress']
): MailingAddressChange | null {
	const priorLines = prior.lines.map((l) => l.trim());
	const currentLines = current.lines.map((l) => l.trim());
	const linesDiffer =
		priorLines.length !== currentLines.length ||
		priorLines.some((l, i) => l !== currentLines[i]);
	const priorNotes = (prior.notes ?? '').trim();
	const currentNotes = (current.notes ?? '').trim();
	const notesDiffer = priorNotes !== currentNotes;

	if (!linesDiffer && !notesDiffer) return null;

	return {
		from: { lines: prior.lines, ...(prior.notes !== undefined ? { notes: prior.notes } : {}) },
		to: {
			lines: current.lines,
			...(current.notes !== undefined ? { notes: current.notes } : {}),
		},
		linesChanged: linesDiffer,
	};
}

function diffCategory(prior: CategoryData, current: CategoryData): CategoryChange | null {
	const change: CategoryChange = { optionsAdded: [], optionsRemoved: [] };
	let dirty = false;

	if (prior.logic !== current.logic) {
		change.logicChange = { from: prior.logic, to: current.logic };
		dirty = true;
	}

	const priorSet = new Set(prior.options);
	const currentSet = new Set(current.options);

	for (const opt of current.options) {
		if (!priorSet.has(opt)) {
			change.optionsAdded.push(opt);
			dirty = true;
		}
	}
	for (const opt of prior.options) {
		if (!currentSet.has(opt)) {
			change.optionsRemoved.push(opt);
			dirty = true;
		}
	}
	change.optionsAdded.sort();
	change.optionsRemoved.sort();

	const priorNotes = prior.notes ?? null;
	const currentNotes = current.notes ?? null;
	if (priorNotes !== currentNotes) {
		change.notesChange = { from: priorNotes, to: currentNotes };
		dirty = true;
	}

	return dirty ? change : null;
}

/**
 * Render a DiffResult as a human-readable plain-text summary for logs / email.
 */
export function formatDiff(diff: DiffResult): string {
	if (!diff.hasChanges) return 'No changes detected.';

	const lines: string[] = [];

	for (const b of diff.bureausAdded) {
		lines.push(`+ Bureau added: ${b.bureau} (${b.documents.length} documents)`);
	}
	for (const b of diff.bureausRemoved) {
		lines.push(`- Bureau removed: ${b.bureau}`);
	}

	for (const bureauChange of diff.bureauChanges) {
		lines.push(`\nBureau: ${bureauChange.bureau}`);

		if (bureauChange.sourceUrlChange) {
			lines.push(
				`  Source URL: ${bureauChange.sourceUrlChange.from} → ${bureauChange.sourceUrlChange.to}`
			);
		}

		for (const doc of bureauChange.documentsAdded) {
			lines.push(`  + Document added: ${doc.id} ("${doc.label}")`);
		}
		for (const doc of bureauChange.documentsRemoved) {
			lines.push(`  − Document removed: ${doc.id} ("${doc.label}")`);
		}
		for (const dc of bureauChange.documentsChanged) {
			if (dc.labelChange) {
				lines.push(
					`  ~ Document ${dc.id} label: "${dc.labelChange.from}" → "${dc.labelChange.to}"`
				);
			}
			if (dc.descriptionChange) {
				lines.push(
					`  ~ Document ${dc.id} description: "${dc.descriptionChange.from ?? ''}" → "${dc.descriptionChange.to ?? ''}"`
				);
			}
		}

		if (bureauChange.mailingAddressChange) {
			const a = bureauChange.mailingAddressChange;
			lines.push('  Mailing address changed:');
			lines.push('    From:');
			for (const ln of a.from.lines) lines.push(`      ${ln}`);
			if (a.from.notes) lines.push(`      (notes: ${a.from.notes})`);
			lines.push('    To:');
			for (const ln of a.to.lines) lines.push(`      ${ln}`);
			if (a.to.notes) lines.push(`      (notes: ${a.to.notes})`);
		}

		for (const [cat, catChange] of Object.entries(bureauChange.categoryChanges)) {
			if (!catChange) continue;
			lines.push(`  Category: ${cat}`);
			if (catChange.logicChange) {
				lines.push(`    logic: ${catChange.logicChange.from} → ${catChange.logicChange.to}`);
			}
			for (const opt of catChange.optionsAdded) {
				lines.push(`    + option added: ${opt}`);
			}
			for (const opt of catChange.optionsRemoved) {
				lines.push(`    − option removed: ${opt}`);
			}
			if (catChange.notesChange) {
				lines.push(
					`    notes: "${catChange.notesChange.from ?? ''}" → "${catChange.notesChange.to ?? ''}"`
				);
			}
		}
	}

	return lines.join('\n');
}
