# Deploying

One-time setup, then every push to `main` deploys itself.

Everything here fits inside Cloudflare's free tier. No domain needed — the site
gets a `*.workers.dev` URL you can share in Discord, and a custom domain can be
added later without changing anything else.

---

## 1. Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up>. Free plan is enough.

From the dashboard, copy your **Account ID** (right-hand sidebar on the Workers
& Pages page). You need it in step 5.

## 2. Log wrangler in

```bash
npx wrangler login
```

Opens a browser to authorise. Run it yourself — it needs interaction, so type
`! npx wrangler login` in Claude Code rather than asking me to run it.

## 3. Create the database

```bash
npx wrangler d1 create umaparty
```

It prints a `database_id`. Paste that into `wrangler.jsonc`, replacing
`local-placeholder-replace-after-d1-create`:

```jsonc
"database_id": "the-uuid-it-printed",
```

Then create the tables:

```bash
npm run migrate:remote
```

## 4. Set the secrets

Never committed, set once directly on the Worker:

```bash
npx wrangler secret put CHRONO_TOKEN     # the chronogenesis API token
npx wrangler secret put SESSION_SECRET   # any long random string
```

For `SESSION_SECRET`, generate something with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 5. First deploy

```bash
npm run build
npx wrangler deploy
```

This claims your `workers.dev` subdomain. The site is then at:

```
https://umaparty-fan-tracker.<your-subdomain>.workers.dev
```

Cron triggers are registered automatically from `wrangler.jsonc` — ingestion
starts running daily at 10:15 and 15:15 UTC without further setup.

## 6. Load the history

```bash
npm run backfill -- --remote
```

Pulls every month chronogenesis still holds (14 per club) — around 70 requests
paced at 1.5s, so a few minutes. Safe to re-run.

> **Stop `wrangler dev` before running this.** It holds a lock on the local D1
> file and the backfill will block behind it indefinitely.

## 7. Create your officer account

```bash
npm run seed-admin -- --remote --username ivan --password 'something-long' --name Ivan
```

Then sign in at `/officers` and create accounts for the other officers from
there. There is no self-signup.

## 8. Automatic deploys

In the GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**, add:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Create at [API Tokens](https://dash.cloudflare.com/profile/api-tokens) using the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | From step 1 |

`CHRONO_TOKEN` and `SESSION_SECRET` are **not** needed in GitHub — they live on
the Worker.

After that, every push to `main` runs the tests, applies migrations and
deploys. The workflow is `.github/workflows/deploy.yml`.

---

## Checking it works

```bash
# last successful ingest per club
curl https://<your-worker>.workers.dev/api/meta

# the standings the site is built on
curl https://<your-worker>.workers.dev/api/standings
```

To force an ingest before the cron fires, use the Cloudflare dashboard:
**Workers & Pages → umaparty-fan-tracker → Settings → Trigger Events → Cron
Triggers → Run**.

## Free tier headroom

| | Limit | We use |
|---|---|---|
| Worker requests | 100,000/day | a few hundred |
| D1 storage | 5 GB | a few MB/year |
| D1 rows written | 100,000/day | ~800 |
| D1 rows read | 5,000,000/day | well under, responses are edge-cached for an hour |

## Things that will bite

- **`wrangler dev` locks the local D1 file.** Any `d1 execute --local`, the
  backfill, or `seed-admin --local` will hang until you stop it.
- **The cron runs on UTC.** Chrono publishes a day in arrears, so on the 7th the
  newest data is for the 6th. That is expected, not a bug.
- **Migrations run before deploy in CI**, so an additive migration is safe but a
  destructive one will hit the live database first. Write additive migrations.
