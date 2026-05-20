import crypto from 'node:crypto';
import { BUREAUS } from './bureaus.js';
import type { BureauKey } from './bureaus.js';
import { fetchUrl, fetchUrlWithBrowser, fetchPdfBase64, cleanHtml } from './fetch.js';
import { extractRequirements } from './extract.js';
import type { ExtractContent } from './extract.js';
import {
	readState,
	writeState,
	writeSnapshot,
	PUBLIC_STATE_PATH,
	type State,
	type BureauData,
} from './state.js';
import { computeDiff, formatDiff } from './diff.js';
import { readOverrides, applyOverrides } from './overrides.js';
import { sendChangeAlert, sendAddressChangeAlert, sendFailureAlert } from './notify.js';

interface FetchedContent {
	html?: string;
	pdfBase64?: string;
}

function sha256(content: string): string {
	return crypto.createHash('sha256').update(content).digest('hex');
}

async function main() {
	// 1. Read prior state (null on first run)
	const prior = await readState();
	if (prior) {
		console.error(`[state] loaded prior state — lastChanged ${prior.lastChanged}`);
	} else {
		console.error(`[state] no prior state found — this is the first run`);
	}

	// 2. Fetch + extract from every bureau in turn
	const results: BureauData[] = [];
	const fetchedByBureau = new Map<BureauKey, FetchedContent>();

	for (const bureau of BUREAUS) {
		const fetcherLabel =
			bureau.format === 'pdf' ? 'pdf' : bureau.useBrowser ? 'html via browser' : 'html';
		console.error(`\n--- ${bureau.name} (${fetcherLabel}) ---`);
		console.error(`[fetch] ← ${bureau.url}`);

		let content: ExtractContent;
		let hashInput: string;
		if (bureau.format === 'pdf') {
			const base64 = await fetchPdfBase64(bureau.url);
			console.error(
				`[fetch] received PDF (${((base64.length * 0.75) / 1024).toFixed(1)} KB)`
			);
			content = { kind: 'pdf', base64 };
			fetchedByBureau.set(bureau.key, { pdfBase64: base64 });
			hashInput = base64;
		} else if (bureau.useBrowser) {
			const rawHtml = await fetchUrlWithBrowser(bureau.url);
			console.error(`[browser] received ${rawHtml.length.toLocaleString()} bytes`);
			let cleaned = cleanHtml(rawHtml);
			console.error(`[clean] reduced to ${cleaned.length.toLocaleString()} chars`);

			// Optionally fetch a secondary page (e.g. TransUnion's mail-or-phone page
			// where the protected-consumer-freeze address lives) and concatenate.
			if (bureau.addressSourceUrl) {
				console.error(`[browser] also fetching address page ← ${bureau.addressSourceUrl}`);
				const addrHtml = await fetchUrlWithBrowser(bureau.addressSourceUrl);
				const addrCleaned = cleanHtml(addrHtml);
				console.error(
					`[clean] address page reduced to ${addrCleaned.length.toLocaleString()} chars`
				);
				cleaned =
					cleaned +
					'\n\n--- ADDRESS-SOURCE PAGE (' +
					bureau.addressSourceUrl +
					') ---\n\n' +
					addrCleaned;
			}

			content = { kind: 'text', value: cleaned };
			fetchedByBureau.set(bureau.key, { html: rawHtml });
			hashInput = cleaned;
		} else {
			const rawHtml = await fetchUrl(bureau.url);
			console.error(`[fetch] received ${rawHtml.length.toLocaleString()} bytes`);
			const cleaned = cleanHtml(rawHtml);
			console.error(`[clean] reduced to ${cleaned.length.toLocaleString()} chars`);
			content = { kind: 'text', value: cleaned };
			fetchedByBureau.set(bureau.key, { html: rawHtml });
			hashInput = cleaned;
		}

		console.error(`[extract] calling Claude...`);
		const extracted = await extractRequirements({ bureau, content });
		console.error(`[extract] success`);

		// Assemble the full BureauData. The LLM returned everything except `form`;
		// we compute `form` here from bureau config + the fetch result.
		const fullBureau: BureauData = {
			...extracted,
			form: {
				url: bureau.formUrl ?? bureau.url,
				type: bureau.formType,
				resolves: true, // we got content back, so the URL resolved
				contentHash: sha256(hashInput),
			},
		};
		results.push(fullBureau);
	}

	// 3. Build candidate new state. lastChanged carries from prior unless content actually changed.
	const now = new Date().toISOString();
	const candidate: State = {
		lastChecked: now,
		lastChanged: prior?.lastChanged ?? now,
		bureaus: results,
	};

	// 4. Diff against prior
	const diff = computeDiff(prior, candidate);
	console.error(`\n--- diff vs prior ---`);
	console.error(formatDiff(diff));

	// 5. If there are changes, update lastChanged and write per-bureau snapshots
	if (diff.hasChanges) {
		candidate.lastChanged = now;

		const changedBureaus = new Set<string>([
			...diff.bureauChanges.map((b) => b.bureau),
			...diff.bureausAdded.map((b) => b.bureau),
		]);

		for (const bureauKey of changedBureaus) {
			const bureau = BUREAUS.find((b) => b.key === bureauKey);
			const fetched = fetchedByBureau.get(bureauKey as BureauKey);
			if (!bureau || !fetched) continue;
			if (fetched.html !== undefined) {
				const path = await writeSnapshot(bureau.key, fetched.html, 'html');
				console.error(`[snapshot] ${path}`);
			} else if (fetched.pdfBase64 !== undefined) {
				const path = await writeSnapshot(
					bureau.key,
					Buffer.from(fetched.pdfBase64, 'base64'),
					'pdf'
				);
				console.error(`[snapshot] ${path}`);
			}
		}
	}

	// 6. Write state.json
	await writeState(candidate);
	console.error(`[state] wrote data/state.json`);

	// 7. Apply manual overrides and write state.public.json (the widget's source)
	const overrides = await readOverrides();
	const publicState = applyOverrides(candidate, overrides);
	await writeState(publicState, PUBLIC_STATE_PATH);
	console.error(`[state] wrote ${PUBLIC_STATE_PATH}`);

	// 8. Email the operator if anything changed.
	// Address changes are high-priority — they get their own dedicated email in addition
	// to (not instead of) the regular digest, so they're impossible to miss in a busy inbox.
	if (diff.hasAddressChanges) {
		try {
			await sendAddressChangeAlert(diff);
			console.error(`[notify] HIGH-PRIORITY address change alert sent`);
		} catch (err) {
			console.error(
				`[notify] failed to send address change alert: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}
	if (diff.hasChanges) {
		try {
			await sendChangeAlert(diff);
			console.error(`[notify] change alert sent`);
		} catch (err) {
			console.error(
				`[notify] failed to send change alert: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	console.error(`\n[done] ${diff.hasChanges ? 'changes detected' : 'no changes'}`);
}

main().catch(async (err) => {
	console.error(`\n[FATAL] ${err instanceof Error ? err.message : String(err)}`);
	if (err instanceof Error && err.stack) {
		console.error(err.stack);
	}
	await sendFailureAlert('main', err);
	process.exit(1);
});
