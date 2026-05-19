import { BUREAUS } from './bureaus.js';
import type { BureauKey } from './bureaus.js';
import { fetchUrl, fetchUrlWithBrowser, fetchPdfBase64, cleanHtml } from './fetch.js';
import { extractRequirements } from './extract.js';
import type { BureauData, ExtractContent } from './extract.js';
import {
	readState,
	writeState,
	writeSnapshot,
	PUBLIC_STATE_PATH,
	type State,
} from './state.js';
import { computeDiff, formatDiff } from './diff.js';
import { readOverrides, applyOverrides } from './overrides.js';
import { sendChangeAlert, sendFailureAlert } from './notify.js';

interface FetchedContent {
	html?: string;
	pdfBase64?: string;
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
		if (bureau.format === 'pdf') {
			const base64 = await fetchPdfBase64(bureau.url);
			console.error(
				`[fetch] received PDF (${((base64.length * 0.75) / 1024).toFixed(1)} KB)`
			);
			content = { kind: 'pdf', base64 };
			fetchedByBureau.set(bureau.key, { pdfBase64: base64 });
		} else if (bureau.useBrowser) {
			const rawHtml = await fetchUrlWithBrowser(bureau.url);
			console.error(`[browser] received ${rawHtml.length.toLocaleString()} bytes`);
			const cleaned = cleanHtml(rawHtml);
			console.error(`[clean] reduced to ${cleaned.length.toLocaleString()} chars`);
			content = { kind: 'text', value: cleaned };
			fetchedByBureau.set(bureau.key, { html: rawHtml });
		} else {
			const rawHtml = await fetchUrl(bureau.url);
			console.error(`[fetch] received ${rawHtml.length.toLocaleString()} bytes`);
			const cleaned = cleanHtml(rawHtml);
			console.error(`[clean] reduced to ${cleaned.length.toLocaleString()} chars`);
			content = { kind: 'text', value: cleaned };
			fetchedByBureau.set(bureau.key, { html: rawHtml });
		}

		console.error(`[extract] calling Claude...`);
		const result = await extractRequirements({ bureau, content });
		console.error(`[extract] success`);
		results.push(result);
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

	// 8. Email the operator if anything changed. Failure here doesn't fail the run —
	// the state file is already written; an email problem shouldn't roll that back.
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
