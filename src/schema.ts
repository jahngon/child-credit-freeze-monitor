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
 * Where the parent mails their request. Extracted by the LLM from each bureau's
 * source page. Stored as lines (e.g. ["Equifax Information Services LLC",
 * "P.O. Box 105788", "Atlanta, GA 30348-5788"]) so the widget can format flexibly.
 */
export const MailingAddress = z.object({
	lines: z.array(z.string().min(1)).min(1),
	notes: z.string().optional(),
});

/**
 * The bureau's submission form (Equifax PDF, Experian online form, or "letter"
 * for TransUnion which has no form). `url`, `type`, `resolves`, and `contentHash`
 * are computed during the monitor run, not by the LLM.
 */
export const Form = z.object({
	url: z.string().url(),
	type: z.enum(['pdf_form', 'online_form', 'letter']),
	resolves: z.boolean(),
	contentHash: z.string().optional(),
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
	mailingAddress: MailingAddress,
	form: Form,
});

/**
 * The shape Claude returns from the extraction step — same as BureauRequirements
 * minus `form`. `form` is computed by the monitor script after extraction (URL
 * resolution check, content hash, formType from bureau config).
 */
export const ExtractedBureauRequirements = BureauRequirements.omit({ form: true });

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
