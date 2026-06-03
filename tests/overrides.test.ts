import { describe, it, expect } from 'vitest';
import { applyOverrides, type Overrides } from '../src/overrides.js';
import type { State } from '../src/state.js';

/** Minimal State fixture with a TransUnion bureau whose extracted address is a
 * Cloudflare-blocked placeholder — the exact failure this override guards against. */
function baseState(): State {
	return {
		lastChecked: '2026-06-02T13:00:00.000Z',
		lastChanged: '2026-06-02T13:00:00.000Z',
		bureaus: [
			{
				bureau: 'transunion',
				sourceUrl: 'https://www.transunion.com/credit-freeze/credit-freeze-faq',
				documents: [{ id: 'birth_child', label: 'Birth certificate' }],
				categories: {
					authority: { logic: 'or', options: ['birth_child'] },
					parentId: { logic: 'or', options: ['id_parent'] },
					address: { logic: 'na', options: [] },
					childId: { logic: 'or', options: ['birth_child'] },
				},
				mailingAddress: {
					lines: ['TransUnion Protected Consumer Freeze', '<UNKNOWN>', '<UNKNOWN>'],
					notes: 'Blocked by Cloudflare; could not extract.',
				},
				form: {
					url: 'https://www.transunion.com/credit-freeze/credit-freeze-faq',
					type: 'letter',
					resolves: true,
					contentHash: 'a'.repeat(64),
				},
			},
		],
	};
}

describe('applyOverrides — mailingAddress', () => {
	it('replaces a placeholder address with the verified override lines', () => {
		const overrides: Overrides = {
			bureaus: {
				transunion: {
					mailingAddress: {
						lines: ['TransUnion', 'P.O. Box 380', 'Woodlyn, PA 19094'],
						notes: 'Verified minor freeze address.',
					},
				},
			},
		};

		const result = applyOverrides(baseState(), overrides);
		const tu = result.bureaus.find((b) => b.bureau === 'transunion')!;
		expect(tu.mailingAddress.lines).toEqual(['TransUnion', 'P.O. Box 380', 'Woodlyn, PA 19094']);
		expect(tu.mailingAddress.notes).toBe('Verified minor freeze address.');
	});

	it('does not mutate the input state', () => {
		const input = baseState();
		applyOverrides(input, {
			bureaus: { transunion: { mailingAddress: { lines: ['X'] } } },
		});
		expect(input.bureaus[0].mailingAddress.lines).toEqual([
			'TransUnion Protected Consumer Freeze',
			'<UNKNOWN>',
			'<UNKNOWN>',
		]);
	});

	it('leaves the address untouched when no mailingAddress override is given', () => {
		const result = applyOverrides(baseState(), {
			bureaus: { transunion: { sourceUrl: 'https://example.com' } },
		});
		const tu = result.bureaus.find((b) => b.bureau === 'transunion')!;
		expect(tu.mailingAddress.lines[1]).toBe('<UNKNOWN>');
	});

	it('clears notes when override sets notes to null', () => {
		const result = applyOverrides(baseState(), {
			bureaus: { transunion: { mailingAddress: { notes: null } } },
		});
		const tu = result.bureaus.find((b) => b.bureau === 'transunion')!;
		expect(tu.mailingAddress.notes).toBeUndefined();
	});
});
