# Multi-tenant deployment runbook

This branch (`maas-app`) is a fork of the Mata app set up to be deployed
**once per tenant** on Render — one Render Web Service + one Render Postgres
per tenant. There is no cross-tenant data path inside the application; each
tenant runs as its own isolated Node process talking to its own database.

Three tenants are pre-configured: **Mbao**, **Keur Massar**, **Sacre Coeur**.
All have abattage (Suivi Achat Boeuf) disabled by default.

---

## Architecture in one paragraph

A single shared codebase with no in-app tenancy logic. At deploy time, the
`tenant:apply` build step reads the `TENANT_SLUG` env var and copies the
matching files from `config/tenants/<slug>/` over the runtime config files
(`nomDuClient.json`, `brand-config.json`, `config/modules-state.json`,
`config/client-config.json`). The frontend reads the tenant identity from
`/api/tenant` and prefixes the page title with the tenant name.

---

## Per-tenant resources to create on Render

For **each** of `mbao`, `keur-massar`, `sacre-coeur`:

### 1. Create a Render Postgres

- Dashboard → New → Postgres
- Name: `maas-<slug>-db` (e.g. `maas-mbao-db`)
- Region: same region as the web service (latency)
- Plan: Starter is fine to begin with
- After creation, copy the **Internal Database URL** — you'll paste it as
  `DATABASE_URL` in the web service env vars.

### 2. Create a Render Web Service

- Dashboard → New → Web Service
- Connect this Git repo and pick branch `maas-app`
- Name: `maas-<slug>` (e.g. `maas-mbao`)
- Runtime: Node
- Build command:
  ```
  npm install && npm run tenant:apply
  ```
- Start command:
  ```
  npm start
  ```

### 3. Set the env vars on the web service

Open `config/tenants/<slug>/.env.tenant` for the matching tenant and paste
each line as an environment variable in the Render dashboard.

The file already has a randomly generated `SESSION_SECRET` and
`EXTERNAL_API_KEY` — keep those values, do not regenerate them per deploy.

> ⚠️ **Never commit `.env.tenant` files.** They contain plaintext secrets.
> They are gitignored (`config/tenants/*/.env.tenant`); regenerate them
> locally with `npm run tenant:create -- --slug=<x> --force` if you lose
> the originals (and update Render env vars to the new values).

You must additionally set:
- `DATABASE_URL` → the **Internal Database URL** from the Postgres you
  created in step 1.

Optional, only if the corresponding module is enabled for that tenant:
- `OPENAI_API_KEY`, `OPENAI_MODEL` — for AI features
- `BICTORYS_API_KEY`, `BICTORYS_BASE_URL` — for the payment-links module
- `BASE_URL` — for absolute URLs in generated invoices

### 4. Initialize the tenant's database

After the first deploy succeeds, open the Render shell on the web service
and run **once**:

```
npm run tenant:init
```

This:
- Verifies the DB connection and creates all tables (`sequelize.sync()`).
- **Seeds the default product catalog** from `db/seeds/default-catalog.json`
  (9 categories + 260 produits — derived from Mata's production catalog
  with legacy "Import OCR" merged into "Autres"). Skip with
  `SEED_DEFAULT_CATALOG=false` if the tenant brings their own catalog.
- Seeds a default `ADMIN` user with temp password `ChangeMe123!`.
- Seeds a single point of sale named after `TENANT_NAME`.
- Links the admin user to that point of sale.
- **On first run only**, wipes the Mata-specific JSON files that ship in
  the repo so the new tenant starts clean:
  - `data/stock-matin.json`, `data/stock-soir.json`, `data/transferts.json`
  - `data/by-date/` snapshots
  - `acheteur.json` (Mata's buyers list — only used by abattage, off here)
  - `livreurs_actifs.json` (Mata's drivers list)

The script is idempotent — re-running on an already-initialized tenant
won't duplicate users, won't reset POS, and won't wipe accumulated data.
The wipe is gated on `User.count() === 0` so it only fires the very first
time `tenant:init` runs against a fresh DB.

You can override the temp password by setting `DEFAULT_ADMIN_PASSWORD` in
the env before running, but in practice the simpler flow is: log in with
the default, change the password from the user-management screen, then
create real staff accounts there.

> **Security note:** the temp password is intentionally shared across
> tenants for runbook simplicity. **Change it on every tenant on first
> login** before letting anyone else in.

### 5. (Optional) Add a per-tenant cron for daily stock copy

If the tenant uses the Stock module and wants automated overnight copy
("stock soir" → next-day "stock matin"):

- Dashboard → New → Cron Job
- Name: `maas-<slug>-stock-copy`
- Branch: `maas-app`
- Schedule: `0 5 * * *` (daily 5am UTC — adjust per tenant timezone)
- Build command: `npm install && npm run tenant:apply`
- Start command: `node scripts/copy-stock-cron.js`
- Env vars: same as the web service (`TENANT_SLUG`, `TENANT_NAME`,
  `TENANT_BRAND_KEY`, `DATABASE_URL`, plus `LOG_LEVEL=info`,
  `DATA_PATH=./data/by-date`).

Skip this entirely if the tenant doesn't run an end-of-day stock workflow.

### 6. Set the custom domain

- Web service → Settings → Custom Domains → Add
  - `mbao.yourdomain.com` for `maas-mbao`
  - `keur-massar.yourdomain.com` for `maas-keur-massar`
  - `sacre-coeur.yourdomain.com` for `maas-sacre-coeur`
- Add the matching CNAME records at your DNS provider.
- Render auto-provisions SSL.

---

## Onboarding a new tenant after these three

```bash
npm run tenant:create -- --slug=<slug> --name="<Display Name>"
```

This generates `config/tenants/<slug>/` with `nomDuClient.json`,
`brand-config.json`, `modules-state.json` (abattage off by default),
and `.env.tenant` containing freshly generated secrets.

Then:
1. Edit `config/tenants/<slug>/brand-config.json` — fill `telephones`,
   `adresse_siege`, `points_vente_codes`.
2. Commit the bundle.
3. Repeat the Render steps above for the new tenant.

---

## Verifying a deployment

The fastest check is the bundled script — run it from your laptop after
the service is up:

```
npm run tenant:verify -- --url=https://mbao.yourdomain.com --slug=mbao --name=Mbao
```

It hits `/api/tenant`, `/api/client-config`, and the abattage gate, and
exits non-zero on any mismatch. Run it for each of the three tenants
after deploying.

For a manual quick check, hit `https://<slug>.yourdomain.com/api/tenant`.
You should see:
```json
{ "slug": "mbao", "name": "Mbao", "brandKey": "MBAO" }
```

The login page title bar will read **"Mbao — Connexion - Gestion des Ventes"**.

The Suivi Achat Boeuf menu item / API will return 403 (`Module
"suivi-achat-boeuf" désactivé`) — this is expected.

To enable abattage for a specific tenant later, log in as admin on that
tenant and toggle the module from `/config-admin`, **or** edit
`config/tenants/<slug>/modules-state.json` and redeploy.

### Boot-time self-check

Every process logs its tenant identity at startup, e.g.
`[tenant] slug=mbao name="Mbao" brandKey=MBAO`.

If you see a warning like:

```
[tenant] ⚠️  brand-config.json has no entry for "MBAO". Did the
buildCommand run "npm run tenant:apply"? Available keys: KEUR_BALLI
```

…that means the `buildCommand` field on the Render service is wrong (or
missing) — fix it to `npm install && npm run tenant:apply` and redeploy.

---

## What this setup does NOT do

This is the **process-per-tenant** model. It satisfies "no cross-tenant
impact at all" because each tenant is a separate process. It does
**not** scale economically past ~15–20 tenants if you also keep one
Postgres per tenant — the per-tenant Postgres bill becomes the dominant
line item.

The supported next step is **schema-per-tenant on a shared Postgres**
(per-tenant process kept, per-tenant DB collapsed to one cluster with
one schema per tenant). The wiring is already in place — see below.
The further step (single-process multi-tenant, hostname-based tenant
resolution) is **not** supported by this codebase and would require a
significant refactor.

## Schema-per-tenant mode (shared Postgres)

Set `DB_SCHEMA=<slug>` on each tenant's web service env vars (in
addition to `TENANT_SLUG`, `TENANT_NAME`, `TENANT_BRAND_KEY`). When set:

- `db/index.js` runs `SET search_path TO "<schema>"` on every new
  connection, so all queries (Sequelize and raw SQL) resolve to that
  schema only — no cross-tenant fallback.
- `npm run tenant:init` runs `CREATE SCHEMA IF NOT EXISTS "<schema>"`
  before `sequelize.sync()`, so models land in the tenant's schema.

When `DB_SCHEMA` is unset, behavior is unchanged (search_path stays at
`public`, sync runs in the public schema) — so existing DB-per-tenant
deploys keep working.

### Migrating an existing tenant from its own DB to a shared cluster

```bash
# 1. From the source tenant DB, dump just the schema + data
pg_dump --no-owner --no-privileges -Fp \
  --dbname=<old-tenant-database-url> > tenant.sql

# 2. On the shared cluster, create the schema
psql --dbname=<shared-database-url> -c 'CREATE SCHEMA "<slug>"'

# 3. Restore into that schema by setting search_path before piping
psql --dbname=<shared-database-url> -c \
  "SET search_path TO \"<slug>\"; \i tenant.sql"

# 4. On Render, swap the tenant's web service env:
#    DATABASE_URL  →  shared cluster URL
#    DB_SCHEMA     →  <slug>
#    Redeploy. The afterConnect hook constrains all queries to the schema.

# 5. Verify with npm run tenant:verify, then decommission the old DB.
```

Tested locally with three tenants (mbao, keur-massar, sacre-coeur) on a
single `maas_shared_dev` database — see commit history.

---

## File reference

- `config/tenant.js` — exposes the current process's tenant identity from
  `TENANT_SLUG` / `TENANT_NAME` / `TENANT_BRAND_KEY` env vars; warns on
  boot if the brand-config doesn't match.
- `scripts/apply-tenant-config.js` — runs in `buildCommand`; copies
  `config/tenants/<slug>/*` over the live config files.
- `scripts/setup-tenant.js` — generator for new tenant bundles
  (`npm run tenant:create -- --slug=<x> --name="<X>"`).
- `scripts/init-tenant-db.js` — first-deploy DB seed (admin user + POS).
  Run via `npm run tenant:init` from the Render shell.
- `scripts/verify-tenant.js` — post-deploy health check
  (`npm run tenant:verify -- --url=<host> --slug=<x> --name=<X>`).
- `config/tenants/<slug>/` — per-tenant config bundles. Each contains:
  - `nomDuClient.json`
  - `brand-config.json`
  - `modules-state.json`
  - `client-config.json`
  - `.env.tenant` (env vars to paste into Render — never commit secrets
    if you regenerate this file).
- `public/js/tenant-branding.js` — frontend snippet that reads
  `/api/tenant` and applies the tenant name to page titles.
- `render.yaml.tenant.template` — Render blueprint template per tenant
  (web service + optional cron).
- `GET /api/tenant` — returns `{slug, name, brandKey}`. Public endpoint.

## npm script reference

```
npm run tenant:create -- --slug=<x> --name="<X>"   # generate bundle
npm run tenant:apply                               # build-time copier (Render)
npm run tenant:init                                # first-time DB seed (Render shell)
npm run tenant:verify -- --url=<host> --slug=<x> --name=<X>   # post-deploy QA
```
