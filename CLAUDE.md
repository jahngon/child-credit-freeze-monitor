# child-credit-freeze-monitor

Daily monitor that checks the three credit bureaus' (Equifax, Experian, TransUnion) published requirements for placing a freeze on a minor's credit. Detects changes vs. the prior snapshot and emails the owner (Jess) when something moves. The monitor's output is also the data source for the interactive widget on jessahn.com.

## Audience and tone

The owner is a first-time coder. When making changes, prefer the simpler path. Explain trade-offs in plain language before adding new abstractions.

## How it runs

- **Schedule:** GitHub Actions daily at 13:00 UTC
- **Entry point:** `npm run check` → `tsx src/index.ts`
- **Tests:** `npm run test` (vitest)
- **Environment:** `ANTHROPIC_API_KEY` and `RESEND_API_KEY` in `.env` locally; GH secrets in CI

## Repo layout

- `src/index.ts` — orchestrator: fetch → extract → diff → notify → write state
- `src/bureaus.ts` — config per bureau (URLs, form type, addressSourceUrl, useBrowser flag)
- `src/fetch.ts` — HTTP fetch + Playwright/Chromium fallback for bot-protected pages (TransUnion)
- `src/extract.ts` — Claude Sonnet 4.6 call with **tool-use forced JSON** (`tool_choice: { type: 'tool', name: 'submit_requirements' }`). Sonnet 4.6 does NOT support assistant-message prefilling — do not switch back.
- `src/schema.ts` — Zod schemas (`BureauRequirements`, `MailingAddress`, `Form`, `State`)
- `src/diff.ts` — change detection. Normalizes order so cosmetic shuffles don't cause noise. Sets `hasAddressChanges` ONLY when address LINES change, not when notes-only change.
- `src/notify.ts` — Resend email. Two channels: regular digest + HIGH-PRIORITY address change alert.
- `src/state.ts` — `data/state.json` (canonical) and `data/state.public.json` (subset served to the website). `readState()` is graceful: on schema mismatch it logs and returns null (treat as first run).
- `src/overrides.ts` — `data/manual_overrides.json` always wins over LLM extraction
- `data/snapshots/{bureau}/{date}.{html|pdf}` — only written when a real content change is detected

## Hard rules

1. **LLM extraction is the source of truth.** Never hard-code bureau requirements. If extraction fails, the script must fail loudly — never silently fall back to stale or guessed data.
2. **Manual overrides win.** If `data/manual_overrides.json` specifies a value, it overrides the LLM. This is the escape hatch when the LLM is wrong about something we've verified.
3. **Address line changes are P0.** They get a separate HIGH-PRIORITY email (subject prefix). Notes-only changes go in the regular digest. Never collapse the two.
4. **State serves the website.** `data/state.public.json` is the file the jessahn-website widget reads. Schema changes break the widget — coordinate.
5. **Snapshots only on real change.** Don't write a snapshot every run; only when `diff.hasChanges` is true.

## Bureau-specific notes

- **Equifax:** PDF form. Use Claude's **native PDF support** (document content block) — do NOT switch to `pdf-parse`, which strips the italicized category headers needed for extraction.
- **Experian:** Plain HTML, no special handling.
- **TransUnion:** 403s on plain HTTP. Uses Playwright/Chromium (`useBrowser: true`). Also fetches a secondary `addressSourceUrl` (`/credit-freeze/mail-or-phone`) because the FAQ page alone is ambiguous between the regular freeze address (P.O. Box 160) and the Protected Consumer Freeze address (P.O. Box 380). The minor freeze uses **P.O. Box 380**.

## Common pitfalls

- **CI failing with `node: .env not found`:** use `--env-file-if-exists=.env` (Node 22.7+), not `--env-file=.env`. The CI `node-version` must be `22` or higher.
- **`state.public.json` schema mismatch after a schema change:** that's expected; `readState()` returns null and the next run repopulates. Don't add a forced migration.
- **Cosmetic LLM variability:** mitigated by `temperature: 0` plus normalized ordering in `diff.ts`. If a diff looks weird, check whether it's a real change or a key reorder.

## Cross-repo handoff

After this repo records a change to addresses or requirements, run `npm run sync-monitor-data` in the **jessahn-website** repo (`C:\Users\jahn7\Projects\jessahn-website`) to pull the new `state.public.json` into the website. The widget reads only from same-origin static files.
