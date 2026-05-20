import { describe, it, expect } from 'vitest';
import { computeDiff, formatDiff } from '../src/diff.js';
import type { State, BureauData } from '../src/state.js';

const baseBureau: BureauData = {
	bureau: 'experian',
	sourceUrl: 'https://www.experian.com/help/minor-request.html',
	documents: [
		{ id: 'birth_child', label: "Child's birth certificate" },
		{ id: 'ssn_child', label: "Child's Social Security card" },
		{ id: 'id_parent', label: "Driver's license" },
		{ id: 'utility', label: 'Proof of address' },
		{ id: 'court', label: 'Proof of guardianship' },
	],
	categories: {
		authority: { logic: 'or', options: ['birth_child', 'court'] },
		parentId: { logic: 'or', options: ['id_parent'] },
		address: { logic: 'or', options: ['utility'] },
		childId: { logic: 'and', options: ['birth_child', 'ssn_child'] },
	},
	mailingAddress: {
		lines: ['Experian Security Freeze', 'P.O. Box 9554', 'Allen, TX 75013'],
	},
	form: {
		url: 'https://www.experian.com/help/minor-request.html',
		type: 'online_form',
		resolves: true,
		contentHash: 'a'.repeat(64),
	},
};

const baseState: State = {
	lastChecked: '2026-05-19T13:00:00.000Z',
	lastChanged: '2026-05-19T13:00:00.000Z',
	bureaus: [baseBureau],
};

/** Deep-clone helper for safe mutation in tests. */
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

describe('computeDiff', () => {
	it('reports no changes when current is identical to prior', () => {
		const diff = computeDiff(baseState, baseState);
		expect(diff.hasChanges).toBe(false);
		expect(diff.bureauChanges).toEqual([]);
		expect(diff.bureausAdded).toEqual([]);
		expect(diff.bureausRemoved).toEqual([]);
	});

	it('reports hasChanges true and bureausAdded on first run (prior is null)', () => {
		const diff = computeDiff(null, baseState);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureausAdded).toHaveLength(1);
		expect(diff.bureausAdded[0].bureau).toBe('experian');
	});

	it('returns hasChanges false on the empty first run (no bureaus extracted)', () => {
		const diff = computeDiff(null, { ...baseState, bureaus: [] });
		expect(diff.hasChanges).toBe(false);
	});

	it('ignores lastChecked timestamp changes', () => {
		const current = clone(baseState);
		current.lastChecked = '2099-01-01T00:00:00.000Z';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(false);
	});

	it('ignores lastChanged timestamp differences', () => {
		const current = clone(baseState);
		current.lastChanged = '2099-01-01T00:00:00.000Z';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(false);
	});

	it('treats reordered options arrays as no-change', () => {
		const current = clone(baseState);
		current.bureaus[0].categories.childId.options = ['ssn_child', 'birth_child']; // reversed
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(false);
	});

	it('treats reordered documents as no-change', () => {
		const current = clone(baseState);
		current.bureaus[0].documents.reverse();
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(false);
	});

	it('detects a logic change inside a category', () => {
		const current = clone(baseState);
		current.bureaus[0].categories.childId.logic = 'or';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].categoryChanges.childId?.logicChange).toEqual({
			from: 'and',
			to: 'or',
		});
	});

	it('detects an added document', () => {
		const current = clone(baseState);
		current.bureaus[0].documents.push({ id: 'poa', label: 'Power of attorney' });
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].documentsAdded).toHaveLength(1);
		expect(diff.bureauChanges[0].documentsAdded[0].id).toBe('poa');
	});

	it('detects a removed document', () => {
		const current = clone(baseState);
		current.bureaus[0].documents = current.bureaus[0].documents.filter((d) => d.id !== 'court');
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].documentsRemoved).toHaveLength(1);
		expect(diff.bureauChanges[0].documentsRemoved[0].id).toBe('court');
	});

	it('detects an added option within a category', () => {
		const current = clone(baseState);
		current.bureaus[0].categories.authority.options.push('poa');
		current.bureaus[0].documents.push({ id: 'poa', label: 'Power of attorney' });
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].categoryChanges.authority?.optionsAdded).toEqual(['poa']);
	});

	it('detects a removed option within a category', () => {
		const current = clone(baseState);
		current.bureaus[0].categories.childId.options = ['birth_child']; // ssn_child removed
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].categoryChanges.childId?.optionsRemoved).toEqual(['ssn_child']);
	});

	it('detects a document label change', () => {
		const current = clone(baseState);
		current.bureaus[0].documents[0].label = 'New label text';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].documentsChanged).toHaveLength(1);
		expect(diff.bureauChanges[0].documentsChanged[0].labelChange).toBeDefined();
	});

	it('detects a notes field change', () => {
		const current = clone(baseState);
		current.bureaus[0].categories.address.notes = 'Updated note';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].categoryChanges.address?.notesChange).toBeDefined();
	});

	it('detects a mailing address change and sets hasAddressChanges', () => {
		const current = clone(baseState);
		current.bureaus[0].mailingAddress.lines = [
			'Experian Security Freeze',
			'PO Box 9999',
			'Allen, TX 75013',
		];
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.hasAddressChanges).toBe(true);
		expect(diff.bureauChanges[0].mailingAddressChange).toBeDefined();
		expect(diff.bureauChanges[0].mailingAddressChange?.to.lines).toContain('PO Box 9999');
	});

	it('does not flag hasAddressChanges when only requirements change', () => {
		const current = clone(baseState);
		current.bureaus[0].categories.childId.logic = 'or';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.hasAddressChanges).toBe(false);
	});

	it('detects an address-notes-only change but does NOT flag it high-priority', () => {
		const current = clone(baseState);
		current.bureaus[0].mailingAddress.notes = 'Updated note';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		// Notes-only address changes show in the diff, but they shouldn't trigger
		// the high-priority address alert — that's reserved for real line changes.
		expect(diff.hasAddressChanges).toBe(false);
		expect(diff.bureauChanges[0].mailingAddressChange?.linesChanged).toBe(false);
	});

	it('detects a sourceUrl change', () => {
		const current = clone(baseState);
		current.bureaus[0].sourceUrl = 'https://www.experian.com/new-url';
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureauChanges[0].sourceUrlChange).toBeDefined();
	});

	it('detects a bureau added when not in prior', () => {
		const current = clone(baseState);
		current.bureaus.push({
			...baseBureau,
			bureau: 'transunion' as const,
			sourceUrl: 'https://www.transunion.com/credit-freeze/credit-freeze-faq',
		});
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureausAdded.map((b) => b.bureau)).toEqual(['transunion']);
	});

	it('detects a bureau removed', () => {
		const current = clone(baseState);
		current.bureaus = [];
		const diff = computeDiff(baseState, current);
		expect(diff.hasChanges).toBe(true);
		expect(diff.bureausRemoved.map((b) => b.bureau)).toEqual(['experian']);
	});
});

describe('formatDiff', () => {
	it('returns "No changes detected." when there are no changes', () => {
		const diff = computeDiff(baseState, baseState);
		expect(formatDiff(diff)).toBe('No changes detected.');
	});

	it('includes the bureau name and category section when a category changes', () => {
		const current = clone(baseState);
		current.bureaus[0].categories.childId.logic = 'or';
		const diff = computeDiff(baseState, current);
		const text = formatDiff(diff);
		expect(text).toContain('experian');
		expect(text).toContain('childId');
		expect(text).toContain('logic: and → or');
	});
});
