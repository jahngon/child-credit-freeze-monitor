import { Resend } from 'resend';
import type { DiffResult } from './diff.js';
import { formatDiff } from './diff.js';

/**
 * Sender used for Resend's free tier (no domain verification needed).
 * Only delivers to the email address registered on the Resend account.
 * If we ever need to send to other recipients, we'd need to verify a custom
 * domain and switch this to `alerts@<yourdomain>`.
 */
const FROM_ADDRESS = 'Bureau Monitor <onboarding@resend.dev>';

interface NotifyConfig {
	apiKey: string;
	toEmail: string;
}

function loadConfig(): NotifyConfig {
	const apiKey = process.env.RESEND_API_KEY;
	const toEmail = process.env.ALERT_EMAIL;
	if (!apiKey) throw new Error('RESEND_API_KEY is not set');
	if (!toEmail) throw new Error('ALERT_EMAIL is not set');
	return { apiKey, toEmail };
}

function getRepoUrl(): string | null {
	const repo = process.env.GITHUB_REPOSITORY;
	const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
	return repo ? `${server}/${repo}` : null;
}

function getActionsRunUrl(): string | null {
	const repo = process.env.GITHUB_REPOSITORY;
	const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
	const runId = process.env.GITHUB_RUN_ID;
	return repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null;
}

/**
 * Email the operator that the daily check found a real content change in one
 * or more bureaus. Includes a human-readable diff and a pointer to the repo.
 * No-op if diff.hasChanges is false.
 */
export async function sendChangeAlert(diff: DiffResult): Promise<void> {
	if (!diff.hasChanges) return;

	const config = loadConfig();
	const resend = new Resend(config.apiKey);

	const date = new Date().toISOString().slice(0, 10);
	const repoUrl = getRepoUrl();
	const diffText = formatDiff(diff);

	const bureaus = [
		...diff.bureauChanges.map((b) => b.bureau),
		...diff.bureausAdded.map((b) => b.bureau),
		...diff.bureausRemoved.map((b) => b.bureau),
	];

	const subject =
		bureaus.length === 1
			? `[Bureau Monitor] Requirements changed at ${bureaus[0]}`
			: `[Bureau Monitor] Requirements changed at ${bureaus.length} bureaus (${bureaus.join(', ')})`;

	const bodyLines = [
		`The daily check on ${date} detected changes${bureaus.length === 1 ? ` at ${bureaus[0]}` : ''}.`,
		'',
		'Changes:',
		diffText,
		'',
		'The state file has been updated automatically.',
	];
	if (repoUrl) {
		bodyLines.push(`Recent commits: ${repoUrl}/commits/main`);
	}
	bodyLines.push(
		'',
		'If the change looks wrong (e.g., the LLM misread the page), use data/manual_overrides.json to patch it.'
	);

	const result = await resend.emails.send({
		from: FROM_ADDRESS,
		to: config.toEmail,
		subject,
		text: bodyLines.join('\n'),
	});

	if (result.error) {
		throw new Error(`Resend returned error: ${JSON.stringify(result.error)}`);
	}
}

/**
 * High-priority email: a bureau's mailing address changed. This is the single
 * highest-stakes data in the tool, so it gets its own dedicated email distinct
 * from the regular change digest. The subject prefix uppercases ADDRESS so it's
 * visible in any inbox triage view.
 *
 * No-op if no address changed.
 */
export async function sendAddressChangeAlert(diff: DiffResult): Promise<void> {
	if (!diff.hasAddressChanges) return;

	const config = loadConfig();
	const resend = new Resend(config.apiKey);

	const date = new Date().toISOString().slice(0, 10);
	const repoUrl = getRepoUrl();

	const changedBureaus = diff.bureauChanges.filter((b) => b.mailingAddressChange);

	const subject =
		changedBureaus.length === 1
			? `[Bureau Monitor — ADDRESS CHANGE] ${changedBureaus[0].bureau} mailing address changed`
			: `[Bureau Monitor — ADDRESS CHANGE] ${changedBureaus.length} bureau mailing addresses changed`;

	const bodyLines = [
		`HIGH PRIORITY — a bureau mailing address changed on ${date}.`,
		'',
		'A wrong address means a parent\'s request goes nowhere. Verify the new address against the bureau\'s own page before letting this change propagate to the live site. If wrong, patch data/manual_overrides.json — overrides take precedence.',
		'',
	];

	for (const bc of changedBureaus) {
		const a = bc.mailingAddressChange!;
		bodyLines.push(`Bureau: ${bc.bureau}`);
		bodyLines.push('  From:');
		for (const ln of a.from.lines) bodyLines.push(`    ${ln}`);
		if (a.from.notes) bodyLines.push(`    (notes: ${a.from.notes})`);
		bodyLines.push('  To:');
		for (const ln of a.to.lines) bodyLines.push(`    ${ln}`);
		if (a.to.notes) bodyLines.push(`    (notes: ${a.to.notes})`);
		bodyLines.push('');
	}

	if (repoUrl) {
		bodyLines.push(`Recent commits: ${repoUrl}/commits/main`);
	}

	const result = await resend.emails.send({
		from: FROM_ADDRESS,
		to: config.toEmail,
		subject,
		text: bodyLines.join('\n'),
	});

	if (result.error) {
		throw new Error(`Resend returned error: ${JSON.stringify(result.error)}`);
	}
}

/**
 * Email the operator that the daily check itself failed (fetch error, LLM
 * error, schema validation failure, etc.). Best-effort — if email also fails,
 * we log to stderr and move on; we never throw from this function.
 */
export async function sendFailureAlert(step: string, error: unknown): Promise<void> {
	let config: NotifyConfig;
	try {
		config = loadConfig();
	} catch (e) {
		console.error(`[notify] cannot send failure alert: ${(e as Error).message}`);
		return;
	}

	const resend = new Resend(config.apiKey);
	const date = new Date().toISOString().slice(0, 10);
	const errorMsg = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : null;
	const runUrl = getActionsRunUrl();

	const subject = `[Bureau Monitor] Daily check FAILED on ${date}`;

	const bodyLines = [
		`The daily check failed.`,
		`Step: ${step}`,
		`Error: ${errorMsg}`,
		'',
	];
	if (stack) {
		bodyLines.push('Stack trace:', stack, '');
	}
	bodyLines.push(
		'The state file was NOT updated. Re-run manually or wait for tomorrow\'s check.'
	);
	if (runUrl) {
		bodyLines.push(`Logs: ${runUrl}`);
	}

	try {
		const result = await resend.emails.send({
			from: FROM_ADDRESS,
			to: config.toEmail,
			subject,
			text: bodyLines.join('\n'),
		});
		if (result.error) {
			console.error(`[notify] failure alert returned error: ${JSON.stringify(result.error)}`);
		}
	} catch (e) {
		console.error(`[notify] failed to send failure alert: ${(e as Error).message}`);
	}
}
