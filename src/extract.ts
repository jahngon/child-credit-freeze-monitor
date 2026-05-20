import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ExtractedBureauRequirements } from './schema.js';
import type { BureauConfig } from './bureaus.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You extract structured document-requirements data from credit bureau web pages.

A parent who wants to freeze their minor child's credit must submit specific documents to each bureau. Your job is to read a bureau's page content and submit a structured object describing exactly what that bureau requires.

You will be given:
- The bureau name and key
- The source URL
- The cleaned text content of the bureau's page

You will respond by calling the submit_requirements tool with the extracted data.

Category meanings:
- authority: documents proving the parent has legal authority to act for the child (birth certificate naming the parent, court order, power of attorney, foster placement documents)
- parentId: documents proving the parent's own identity (driver's license, passport, state ID, parent's SSN card)
- address: documents proving the parent's current address (utility bill, bank statement, lease, insurance bill)
- childId: documents proving the child's identity (child's SSN card, child's birth certificate, child's ID)

Logic values:
- "or": any one of the listed options is sufficient. THIS IS THE COMMON CASE.
- "and": ALL listed options are required together. This is RARE — use only when the page explicitly says "all of the following", "both", "each of these is required", or lists items with no alternatives.
- "na": this bureau does not require anything in this category (use an empty options array)

Critical disambiguation: many pages say "provide one document from each of the following categories" and then list bullets WITHIN each category. The bullets within a category are almost always OR options — the page is telling you to pick ONE from the bullets, not provide every bullet.

Example: a form says:
  "Provide one document from each category below to verify your identity:
   1. Proof of your identity (driver's license OR Social Security card OR birth certificate)
   2. Proof you are the minor's parent (court order OR power of attorney OR foster certification)"

The correct interpretation for category #1 (parentId in our schema):
  logic: "or", options: ["id_parent", "ssn_parent", "birth_parent"]

NOT: logic: "and", options: [...]. The "one from each category" instruction means each of the TOP-LEVEL categories must be satisfied (which our schema already enforces by requiring all four categories to be filled). It does NOT mean every option within a category is required.

If the page is genuinely ambiguous about OR vs AND, default to "or" and explain the ambiguity in the notes field.

Known stable document IDs — use these whenever a listed document maps to one of them:
- birth_child: child's birth certificate
- ssn_child: child's Social Security card or number
- id_child: child's government-issued ID
- id_parent: parent's government-issued ID (driver's license, passport, state ID)
- ssn_parent: parent's Social Security card or number
- birth_parent: parent's birth certificate
- utility: utility bill or address-proof statement (utility, bank, insurance)
- court: court order or legal guardianship document
- poa: power of attorney
- foster: foster care placement document

You also extract the bureau's mailing address — the postal address where the parent sends their request. This is on the source page (or on the form, for Equifax's PDF). It is the SINGLE highest-stakes piece of data we ship to parents: a wrong address means a parent's request goes nowhere. Extract it carefully, exactly as it appears on the page, as a list of address lines:
- Line 1: organization / department name (e.g. "Equifax Information Services LLC", "Experian Security Freeze", "TransUnion Protected Consumer Freeze")
- Line 2+: street or PO Box
- Last line: city, state, ZIP

CRITICAL — disambiguating which address to pick:
- The address you extract must be for the **Protected Consumer Freeze** (also called "minor freeze" or "freeze for a minor child"). This is the freeze a parent places on their under-16 child's credit.
- Bureau pages frequently list MULTIPLE mailing addresses for different freeze types — standard adult freeze, fraud alert, dispute, etc. Do NOT pick those. The protected-consumer / minor freeze address is the only correct one for this tool.
- If the page provides content from a separate "address-source page" appended at the bottom (delimited by "--- ADDRESS-SOURCE PAGE ---"), prefer the address from that page since it's the dedicated source.
- If two addresses both seem to apply, pick the one explicitly labeled for "protected consumer" / "minor" / "child" and add a notes field explaining the disambiguation.

Rules:
1. Do not invent requirements not explicitly stated on the page.
2. If the page is ambiguous (e.g. the form layout suggests AND but the FAQ text says OR), use the more conservative reading and explain in a "notes" field on the affected category.
3. Use the predefined document IDs whenever a listed document matches. Only invent a new ID if the document type is genuinely novel. New IDs use snake_case_short and the document's description field must explain what it is.
4. The "bureau" and "sourceUrl" fields must exactly match the values supplied by the user.
5. The same document can — and should — appear under multiple categories if the bureau lists it that way (e.g. a child's birth certificate may satisfy both authority and childId). NEVER create distinct document IDs for what is physically the same document just because it serves different purposes in different categories. If a bureau mentions "a birth certificate" in two places (e.g. once to prove parentage, once to prove the child's identity), it is ONE document — list it once in the documents array and reference its ID in both categories' options arrays.`;

const categorySchema = {
	type: 'object',
	properties: {
		logic: {
			type: 'string',
			enum: ['or', 'and', 'na'],
			description: '"or" means any one option is sufficient; "and" means all options are required; "na" means this category does not apply to this bureau.',
		},
		options: {
			type: 'array',
			items: { type: 'string' },
			description: 'Document IDs (referencing items in the documents array) that satisfy this category.',
		},
		notes: {
			type: 'string',
			description: 'Optional note about ambiguity or special handling for this category.',
		},
	},
	required: ['logic', 'options'],
};

const TOOL: Anthropic.Tool = {
	name: 'submit_requirements',
	description:
		"Submit the structured bureau requirements extracted from the page content. Use only the predefined document IDs unless a genuinely new document type appears on the page.",
	input_schema: {
		type: 'object',
		properties: {
			bureau: {
				type: 'string',
				enum: ['equifax', 'experian', 'transunion'],
			},
			sourceUrl: { type: 'string' },
			documents: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string', description: 'Stable snake_case_short ID for this document.' },
						label: { type: 'string', description: 'The human-readable label as it appears on the bureau page.' },
						description: { type: 'string', description: 'Optional description, especially for novel document types.' },
					},
					required: ['id', 'label'],
				},
			},
			categories: {
				type: 'object',
				properties: {
					authority: categorySchema,
					parentId: categorySchema,
					address: categorySchema,
					childId: categorySchema,
				},
				required: ['authority', 'parentId', 'address', 'childId'],
			},
			mailingAddress: {
				type: 'object',
				description:
					"The postal address where the parent mails their request. Extract exactly as printed; the first line is typically the organization/department name and the last line is City, State ZIP.",
				properties: {
					lines: {
						type: 'array',
						items: { type: 'string' },
						description:
							'Address as a list of lines. Example: ["Equifax Information Services LLC", "P.O. Box 105788", "Atlanta, GA 30348-5788"]',
					},
					notes: {
						type: 'string',
						description: 'Optional note about ambiguity (e.g. multiple addresses on the page).',
					},
				},
				required: ['lines'],
			},
		},
		required: ['bureau', 'sourceUrl', 'documents', 'categories', 'mailingAddress'],
	},
};

export type ExtractContent =
	| { kind: 'text'; value: string }
	| { kind: 'pdf'; base64: string };

export interface ExtractInput {
	bureau: BureauConfig;
	content: ExtractContent;
}

export type ExtractedBureauData = z.infer<typeof ExtractedBureauRequirements>;

export async function extractRequirements(input: ExtractInput): Promise<ExtractedBureauData> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error('ANTHROPIC_API_KEY is not set');
	}

	const client = new Anthropic({ apiKey });

	const promptHeader = `Bureau: ${input.bureau.name}
Bureau key: ${input.bureau.key}
Source URL: ${input.bureau.url}

`;

	const userContent: Anthropic.ContentBlockParam[] =
		input.content.kind === 'pdf'
			? [
					{
						type: 'document',
						source: {
							type: 'base64',
							media_type: 'application/pdf',
							data: input.content.base64,
						},
					},
					{
						type: 'text',
						text: `${promptHeader}The PDF above contains the bureau's request form. Read it carefully — pay attention to italicized section headers, bullet groupings, and any "one from each" / "both of the following" phrasing.\n\nCall submit_requirements with the extracted data.`,
					},
				]
			: [
					{
						type: 'text',
						text: `${promptHeader}Cleaned page content:\n---\n${input.content.value}\n---\n\nCall submit_requirements with the extracted data.`,
					},
				];

	const message = await client.messages.create({
		model: MODEL,
		max_tokens: MAX_TOKENS,
		// temperature: 0 minimizes run-to-run wording variability so the diff
		// surfaces real changes, not cosmetic LLM phrasing differences.
		temperature: 0,
		system: SYSTEM_PROMPT,
		tools: [TOOL],
		tool_choice: { type: 'tool', name: 'submit_requirements' },
		messages: [{ role: 'user', content: userContent }],
	});

	const toolUseBlock = message.content.find((b) => b.type === 'tool_use');
	if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
		throw new Error(
			`Claude did not call submit_requirements. Response content: ${JSON.stringify(message.content, null, 2)}`
		);
	}

	const result = ExtractedBureauRequirements.safeParse(toolUseBlock.input);
	if (!result.success) {
		throw new Error(
			`Tool input failed schema validation for ${input.bureau.name}.\n\nIssues:\n${result.error.issues
				.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
				.join('\n')}\n\nRaw tool input:\n${JSON.stringify(toolUseBlock.input, null, 2)}`
		);
	}

	return result.data;
}
