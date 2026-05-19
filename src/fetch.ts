import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const FETCH_TIMEOUT_MS = 30_000;
const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;
const BROWSER_NETWORKIDLE_TIMEOUT_MS = 10_000;

const REALISTIC_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
	Accept:
		'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
	'Accept-Encoding': 'gzip, deflate, br',
	'Accept-Language': 'en-US,en;q=0.9',
	'Cache-Control': 'no-cache',
	Pragma: 'no-cache',
	'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="121", "Google Chrome";v="121"',
	'Sec-Ch-Ua-Mobile': '?0',
	'Sec-Ch-Ua-Platform': '"Windows"',
	'Sec-Fetch-Dest': 'document',
	'Sec-Fetch-Mode': 'navigate',
	'Sec-Fetch-Site': 'none',
	'Sec-Fetch-User': '?1',
	'Upgrade-Insecure-Requests': '1',
};

/**
 * Fetch a URL as text. Times out after 30 seconds.
 * Throws on non-2xx response or network failure.
 */
export async function fetchUrl(url: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: REALISTIC_HEADERS,
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Fetch ${url} returned HTTP ${response.status} ${response.statusText}`);
		}

		return await response.text();
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Fetch an HTML URL using a real Chromium browser via Playwright.
 * Use this for bureaus that block plain HTTP clients (e.g. TransUnion).
 * Returns the fully-rendered HTML after navigation settles.
 */
export async function fetchUrlWithBrowser(url: string): Promise<string> {
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			userAgent: REALISTIC_HEADERS['User-Agent'],
			viewport: { width: 1280, height: 720 },
			locale: 'en-US',
		});
		const page = await context.newPage();
		await page.goto(url, {
			waitUntil: 'domcontentloaded',
			timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
		});
		// Allow client-side rendering / JS challenges to complete. Silent on timeout —
		// some pages keep long-polling connections open and never reach networkidle.
		await page
			.waitForLoadState('networkidle', { timeout: BROWSER_NETWORKIDLE_TIMEOUT_MS })
			.catch(() => {});
		const html = await page.content();
		return html;
	} finally {
		await browser.close();
	}
}

/**
 * Fetch a URL that returns a PDF, and return its bytes as a base64-encoded string.
 * The base64 string is sent directly to Claude as a `document` content block — Claude
 * reads the PDF natively (preserving layout, italics, visual hierarchy) rather than
 * relying on text-only extraction that loses structure.
 * Times out after 30 seconds. Throws on non-2xx response.
 */
export async function fetchPdfBase64(url: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: REALISTIC_HEADERS,
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Fetch ${url} returned HTTP ${response.status} ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer).toString('base64');
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Strip an HTML document down to the meaningful textual content.
 * Removes scripts, styles, nav/header/footer, iframes, etc. Returns
 * line-broken text so block-level structure (lists, headings) is preserved
 * for the LLM without sending the raw HTML markup overhead.
 */
export function cleanHtml(html: string): string {
	const $ = cheerio.load(html);

	$('script, style, nav, header, footer, iframe, noscript, svg, link, meta').remove();

	$('br').each((_, el) => {
		$(el).replaceWith('\n');
	});

	const blockSelectors = 'p, div, li, h1, h2, h3, h4, h5, h6, td, tr, dt, dd, blockquote, section, article, ul, ol, summary, details';
	$(blockSelectors).each((_, el) => {
		$(el).prepend('\n');
	});

	const raw = $('body').text();
	return raw
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter((line) => line.length > 0)
		.join('\n');
}
