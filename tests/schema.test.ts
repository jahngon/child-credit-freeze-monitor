import { describe, it, expect } from 'vitest';
import {
	DocumentOption,
	RequirementCategory,
	BureauRequirements,
	State,
} from '../src/schema.js';

/** A valid BureauRequirements fixture; tests mutate copies of this. */
const validBureau = {
	bureau: 'experian' as const,
	sourceUrl: 'https://www.experian.com/help/minor-request.html',
	documents: [
		{ id: 'birth_child', label: "Child's birth certificate" },
		{ id: 'ssn_child', label: "Child's Social Security card", description: 'Original or copy' },
	],
	categories: {
		authority: { logic: 'or' as const, options: ['birth_child'] },
		parentId: { logic: 'or' as const, options: ['id_parent'] },
		address: { logic: 'or' as const, options: ['utility'], notes: 'Within last 60 days' },
		childId: { logic: 'or' as const, options: ['ssn_child', 'birth_child'] },
	},
};

describe('DocumentOption', () => {
	it('accepts a valid document', () => {
		expect(() => DocumentOption.parse({ id: 'birth_child', label: 'Birth certificate' })).not.toThrow();
	});

	it('accepts an optional description', () => {
		const parsed = DocumentOption.parse({
			id: 'birth_child',
			label: 'Birth certificate',
			description: 'Certified copy preferred',
		});
		expect(parsed.description).toBe('Certified copy preferred');
	});

	it('rejects an empty id', () => {
		expect(() => DocumentOption.parse({ id: '', label: 'Birth certificate' })).toThrow();
	});

	it('rejects an empty label', () => {
		expect(() => DocumentOption.parse({ id: 'birth_child', label: '' })).toThrow();
	});

	it('rejects a missing id', () => {
		expect(() => DocumentOption.parse({ label: 'Birth certificate' })).toThrow();
	});

	it('drops unknown extra fields silently', () => {
		const parsed = DocumentOption.parse({
			id: 'birth_child',
			label: 'Birth certificate',
			unexpectedField: 'should be dropped',
		});
		expect(parsed).not.toHaveProperty('unexpectedField');
	});
});

describe('RequirementCategory', () => {
	it("accepts a valid category with logic 'or'", () => {
		expect(() =>
			RequirementCategory.parse({ logic: 'or', options: ['birth_child', 'ssn_child'] })
		).not.toThrow();
	});

	it("accepts logic 'and'", () => {
		expect(() => RequirementCategory.parse({ logic: 'and', options: ['utility'] })).not.toThrow();
	});

	it("accepts logic 'na' with empty options", () => {
		expect(() => RequirementCategory.parse({ logic: 'na', options: [] })).not.toThrow();
	});

	it('rejects an invalid logic value', () => {
		expect(() =>
			RequirementCategory.parse({ logic: 'xor', options: ['birth_child'] })
		).toThrow();
	});

	it('rejects non-string options', () => {
		expect(() => RequirementCategory.parse({ logic: 'or', options: [42] })).toThrow();
	});

	it('accepts an optional notes field', () => {
		const parsed = RequirementCategory.parse({
			logic: 'or',
			options: ['birth_child'],
			notes: 'FAQ disagrees with form',
		});
		expect(parsed.notes).toBe('FAQ disagrees with form');
	});
});

describe('BureauRequirements', () => {
	it('accepts a valid bureau payload', () => {
		expect(() => BureauRequirements.parse(validBureau)).not.toThrow();
	});

	it('rejects an unknown bureau name', () => {
		expect(() => BureauRequirements.parse({ ...validBureau, bureau: 'mystery_bureau' })).toThrow();
	});

	it('rejects an invalid sourceUrl', () => {
		expect(() => BureauRequirements.parse({ ...validBureau, sourceUrl: 'not-a-url' })).toThrow();
	});

	it('rejects when a required category is missing', () => {
		const broken = {
			...validBureau,
			categories: {
				authority: validBureau.categories.authority,
				parentId: validBureau.categories.parentId,
				address: validBureau.categories.address,
				// childId is intentionally missing
			},
		};
		expect(() => BureauRequirements.parse(broken)).toThrow();
	});

	it('accepts an empty documents array', () => {
		expect(() => BureauRequirements.parse({ ...validBureau, documents: [] })).not.toThrow();
	});
});

describe('State', () => {
	it('accepts a valid state with one bureau', () => {
		expect(() =>
			State.parse({
				lastChecked: '2026-05-19T13:00:00.000Z',
				lastChanged: '2026-05-19T13:00:00.000Z',
				bureaus: [validBureau],
			})
		).not.toThrow();
	});

	it('accepts a state with all three bureaus', () => {
		const allThree = {
			lastChecked: '2026-05-19T13:00:00.000Z',
			lastChanged: '2026-05-19T13:00:00.000Z',
			bureaus: [
				validBureau,
				{ ...validBureau, bureau: 'equifax' as const, sourceUrl: 'https://assets.equifax.com/x.pdf' },
				{
					...validBureau,
					bureau: 'transunion' as const,
					sourceUrl: 'https://www.transunion.com/credit-freeze/credit-freeze-faq',
				},
			],
		};
		expect(() => State.parse(allThree)).not.toThrow();
	});

	it('rejects a state with missing lastChecked', () => {
		expect(() =>
			State.parse({
				lastChanged: '2026-05-19T13:00:00.000Z',
				bureaus: [validBureau],
			})
		).toThrow();
	});
});
