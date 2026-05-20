export type BureauKey = 'equifax' | 'experian' | 'transunion';

export type FormType = 'pdf_form' | 'online_form' | 'letter';

export interface BureauConfig {
	key: BureauKey;
	name: string;
	url: string;
	format: 'html' | 'pdf';
	/** What kind of submission the bureau accepts. Powers the matrix widget's
	 * Step 4 column and the monitor's `form.type`. */
	formType: FormType;
	/** Optional override URL for the form. Defaults to `url` if omitted.
	 * For TransUnion (which has no bureau form), the form URL is the FAQ
	 * source page — see `formType: 'letter'`. */
	formUrl?: string;
	/** Optional separate URL where the mailing address lives, if it isn't on
	 * the primary requirements page. When set, the monitor fetches BOTH pages
	 * and concatenates their content for the LLM extraction call. Currently
	 * only TransUnion needs this — their FAQ page lists requirements, but the
	 * mailing addresses live on a separate "mail-or-phone" page. */
	addressSourceUrl?: string;
	/** If true (HTML bureaus only), use a real Chromium browser to fetch.
	 * Needed when the bureau blocks plain HTTP clients (e.g. via Akamai). */
	useBrowser?: boolean;
	notes: string;
}

export const BUREAUS: BureauConfig[] = [
	{
		key: 'equifax',
		name: 'Equifax',
		url: 'https://assets.equifax.com/assets/personal/Minor_Freeze_Request_Form.pdf',
		format: 'pdf',
		formType: 'pdf_form',
		notes: 'PDF request form. Sent directly to Claude as a document content block (native PDF reading).',
	},
	{
		key: 'experian',
		name: 'Experian',
		url: 'https://www.experian.com/help/minor-request.html',
		format: 'html',
		formType: 'online_form',
		notes: 'HTML page with online form. Plain fetch with realistic User-Agent works.',
	},
	{
		key: 'transunion',
		name: 'TransUnion',
		url: 'https://www.transunion.com/credit-freeze/credit-freeze-faq',
		addressSourceUrl: 'https://www.transunion.com/credit-freeze/mail-or-phone',
		format: 'html',
		formType: 'letter',
		useBrowser: true,
		notes: 'HTML page protected by bot detection (returns 403 to plain HTTP). Uses Playwright/Chromium. No bureau form — requires written letter (template lives in the website repo). Requirements come from the FAQ page (`url`); the protected consumer freeze mailing address lives on a separate page (`addressSourceUrl`) because the FAQ also lists the standard adult freeze address and the LLM otherwise picks the wrong one.',
	},
];

export function getBureauConfig(key: BureauKey): BureauConfig {
	const config = BUREAUS.find((b) => b.key === key);
	if (!config) throw new Error(`Unknown bureau: ${key}`);
	return config;
}
