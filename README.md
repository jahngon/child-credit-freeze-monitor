# child-credit-freeze-monitor

Daily monitoring of the document requirements that the three major credit bureaus (Equifax, Experian, TransUnion) ask parents to submit when freezing a minor child's credit. When requirements change, the operator gets an email with a diff.

Powers the [Child Credit Freeze Tool](https://jessahn.com/artifacts/child-credit-freeze-tool) on jessahn.com.

## How it works

A GitHub Actions workflow runs once per day at 13:00 UTC (~6am PT). On each run, the script:

1. Fetches each bureau's source page (PDF for Equifax, HTML for Experian, HTML via real Chromium for TransUnion's bot-protected page)
2. Sends the content to Claude (Anthropic's Sonnet 4.6) for structured extraction into a fixed schema
3. Validates the extraction against the Zod schema in `src/schema.ts`
4. Compares against `data/state.json` (the prior day's extraction). Reorders arrays and ignores timestamps so reorderings and cosmetic timestamp changes don't trigger alerts.
5. If anything changed, writes a per-bureau snapshot, updates state, and emails the operator
6. Commits the updated state file back to the repo

The widget on jessahn.com reads `data/state.public.json`, which is `state.json` with any patches from `data/manual_overrides.json` merged on top. Overrides always win.

## Repo layout

```
.
├── .github/workflows/
│   └── daily-check.yml          # cron + manual trigger
├── src/
│   ├── index.ts                 # main entry — orchestrates everything
│   ├── bureaus.ts               # bureau URLs and per-bureau notes
│   ├── fetch.ts                 # HTTP, Playwright, and PDF download helpers
│   ├── extract.ts               # Claude API call (tool-use forced JSON output)
│   ├── diff.ts                  # semantic diff between two State objects
│   ├── overrides.ts             # merge manual_overrides.json into state
│   ├── notify.ts                # Resend email alerts
│   ├── state.ts                 # state.json read/write/normalize
│   └── schema.ts                # Zod schemas
├── tests/
│   ├── schema.test.ts
│   └── diff.test.ts
├── data/
│   ├── state.json               # canonical extracted state (committed)
│   ├── state.public.json        # state + overrides; what the widget reads
│   ├── manual_overrides.json    # operator-authored patches
│   └── snapshots/{bureau}/{date}.{html|pdf}  # raw content on change
└── README.md
```

## Local development

1. Clone this repo
2. `npm install`
3. `npx playwright install chromium` (downloads the Chromium binary used for TransUnion)
4. Create a `.env` file in the repo root with:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-...
   RESEND_API_KEY=re_...
   ALERT_EMAIL=you@example.com
   ```
   (see `.env.example`)
5. `npm test` — run the schema + diff tests
6. `npm run check` — run one full extraction cycle against all three bureaus

## GitHub Actions secrets

The workflow at `.github/workflows/daily-check.yml` needs three repository secrets. Add them at **Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `RESEND_API_KEY` | https://resend.com/api-keys |
| `ALERT_EMAIL` | The email address that receives alerts (must match the address that signed up for Resend on the free `onboarding@resend.dev` sender) |

Once the secrets are set, you can manually trigger the workflow from **Actions → Daily bureau check → Run workflow**.

## Manual overrides

When the LLM's reading of a page is technically correct but misleading (e.g., the bureau's wording is ambiguous and the LLM picked the wrong interpretation), patch `data/manual_overrides.json`. Example:

```json
{
  "bureaus": {
    "equifax": {
      "categories": {
        "parentId": {
          "notes": "Verified manually 2026-05-20 — phone support says any one of the three is sufficient."
        }
      }
    }
  }
}
```

Every override field is optional. You can patch `sourceUrl`, individual documents (by id), category `logic` / `options` / `notes`, etc. The widget reads `state.public.json`, so overrides take effect on the next run (or you can run `npm run check` locally to regenerate `state.public.json` immediately).

## Known limitations

- **LLM extraction is non-deterministic.** Even with `temperature: 0`, minor wording variations across runs can trigger cosmetic notes-text diffs. The script alerts on every change for V1; over time we may suppress notes-only changes.
- **Bureau URLs can move.** The script fails loudly on 404s and emails the operator, but the failed bureau is skipped until fixed.
- **TransUnion uses Akamai-grade bot detection** that requires a real browser to bypass. Playwright/Chromium handles this today; if TransUnion adds JavaScript challenges, this monitor may need stealth plugins or a different fetching strategy.

## Anti-patterns to avoid

- Don't hard-code requirements anywhere in the script. The whole point is that requirements come from live extraction. If the LLM call fails, the script fails loudly — it does not fall back to stale defaults.
- Don't write hand-rolled HTML parsers to pull requirements from bureau pages. The structure is too inconsistent and brittle. Cheerio is used only to strip away nav/scripts/footers before sending content to the LLM.
- Don't commit secrets. The `.env` file is gitignored; in CI, secrets come from GitHub Actions secrets.
