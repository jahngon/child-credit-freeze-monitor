export type BureauKey = 'equifax' | 'experian' | 'transunion';

export interface BureauConfig {
	key: BureauKey;
	name: string;
	url: string;
	format: 'html' | 'pdf';
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
		notes: 'PDF request form. Extract text via pdf-parse before sending to LLM.',
	},
	{
		key: 'experian',
		name: 'Experian',
		url: 'https://www.experian.com/help/minor-request.html',
		format: 'html',
		notes: 'HTML page. May 403 on direct fetch; uses realistic User-Agent header.',
	},
	{
		key: 'transunion',
		name: 'TransUnion',
		url: 'https://www.transunion.com/credit-freeze/credit-freeze-faq',
		format: 'html',
		useBrowser: true,
		notes: 'HTML page protected by bot detection (returns 403 to plain HTTP). Uses Playwright/Chromium to render. Requirements inside accordions.',
	},
];

export function getBureauConfig(key: BureauKey): BureauConfig {
	const config = BUREAUS.find((b) => b.key === key);
	if (!config) throw new Error(`Unknown bureau: ${key}`);
	return config;
}
