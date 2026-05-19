import { z } from 'zod';

/**
 * A single document that a bureau may accept as proof.
 * `id` is a stable identifier (see KNOWN_DOCUMENT_IDS below).
 * `label` is the human-readable name as the bureau presents it.
 */
export const DocumentOption = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	description: z.string().optional(),
});

/**
 * The bureau's requirement for a category of proof (e.g. proof of address).
 * `logic` describes whether ALL listed options are required, ONE OF them, or N/A.
 * `options` is a list of DocumentOption.id values.
 * `notes` captures LLM-flagged ambiguity (e.g. form layout disagrees with FAQ text).
 */
export const RequirementCategory = z.object({
	logic: z.enum(['or', 'and', 'na']),
	options: z.array(z.string()),
	notes: z.string().optional(),
});

/**
 * The complete extracted state for one bureau.
 */
export const BureauRequirements = z.object({
	bureau: z.enum(['equifax', 'experian', 'transunion']),
	sourceUrl: z.string().url(),
	documents: z.array(DocumentOption),
	categories: z.object({
		authority: RequirementCategory,
		parentId: RequirementCategory,
		address: RequirementCategory,
		childId: RequirementCategory,
	}),
});

/**
 * The top-level state, persisted as data/state.json.
 * `lastChecked` updates every run. `lastChanged` only updates when content actually changed.
 */
export const State = z.object({
	lastChecked: z.string(),
	lastChanged: z.string(),
	bureaus: z.array(BureauRequirements),
});

/**
 * Known stable document IDs. The LLM should prefer these when mapping bureau labels
 * to canonical IDs. Inventing new IDs is allowed when a genuinely new document type
 * appears — the LLM is instructed to use snake_case_short and include a notes field.
 */
export const KNOWN_DOCUMENT_IDS = [
	'birth_child',
	'ssn_child',
	'id_child',
	'id_parent',
	'ssn_parent',
	'birth_parent',
	'utility',
	'court',
	'poa',
	'foster',
] as const;
