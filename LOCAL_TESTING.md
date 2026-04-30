# Local testing — multi-tenant fork

This branch (`maas-app`) is a forked version of the Mata app that runs
one Node process per tenant on Render. To test locally you pick **one**
tenant at a time, point the app at a local Postgres DB, and run the
server.

## Prereqs

- Node 18+ and npm (already installed if you cloned this repo).
- A running Postgres instance reachable from your machine. The default
  in `.env.example` assumes `localhost:5432`, user `postgres`, password
  `bonea2024`. Adjust to whatever your local Postgres uses.

## One-time setup

### 1. Install dependencies

```
npm install
```

### 2. Create a fresh Postgres database for the tenant you want to test

The simplest way (replace credentials as needed):

```
psql -U postgres -h localhost -c "CREATE DATABASE ventes_mbao_dev;"
```

You'll create one DB per tenant you want to test (e.g. `ventes_mbao_dev`,
`ventes_keur_massar_dev`, `ventes_sacre_coeur_dev`). They stay isolated
from each other and from any Mata DB you may already have.

### 3. Copy `.env.example` to `.env.local` and edit

```
cp .env.example .env.local
```

Open `.env.local` and set:

- `TENANT_SLUG` / `TENANT_NAME` / `TENANT_BRAND_KEY` to the tenant you
  want to run (`mbao` / `Mbao` / `MBAO`, etc.).
- `DB_NAME` to the database you created in step 2.
- `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` to match your local
  Postgres credentials.

`.env.local` is gitignored — never commit it.

## Running the app for a tenant

The fast path is one command:

```
npm run tenant:dev -- --slug=mbao
```

This:
1. Copies `config/tenants/mbao/*` over the live config files.
2. Reads the tenant name and brand key from the bundle.
3. Starts `nodemon -r dotenv/config server.js` with
   `TENANT_SLUG=mbao TENANT_NAME=Mbao TENANT_BRAND_KEY=MBAO` injected.

Stop with **Ctrl-C**.

To switch tenants, stop and re-run with a different slug:

```
npm run tenant:dev -- --slug=keur-massar
```

(Switching also overwrites the live config files for the new tenant —
that's expected; the tree is meant to be tenant-scoped at any moment.)

## First-time DB seed

Before the first login on a new tenant DB, seed the admin user and the
default point of sale. In a separate terminal (with `.env.local` still
pointing at the same DB):

```
npm run tenant:init
```

This creates:
- `ADMIN` user with password `ChangeMe123!`
- A point of sale named after `TENANT_NAME`
- Wipes Mata's stock JSON files (`data/stock-*.json`,
  `data/transferts.json`, `data/by-date/`, `acheteur.json`,
  `livreurs_actifs.json`) so you don't see Mata's data in the new
  tenant.

The wipe runs only on the very first invocation against an empty DB, so
re-running `tenant:init` is safe.

## What to test in the browser

After `npm run tenant:dev -- --slug=mbao` is up, hit:

| URL                                  | Expect                                          |
|--------------------------------------|--------------------------------------------------|
| http://localhost:3000/api/tenant     | `{"slug":"mbao","name":"Mbao","brandKey":"MBAO"}` |
| http://localhost:3000/login.html     | Title bar reads "Mbao — Connexion …"; client name in the form heading is "Mbao" |
| http://localhost:3000/api/achats-boeuf | 401 (not logged in) or 403 (`Module "suivi-achat-boeuf" désactivé`) — abattage is OFF |
| Login as `ADMIN` / `ChangeMe123!`    | Reaches the main app shell, with the abattage menu item hidden / inactive |

Once logged in, the **Suivi achat boeuf** menu item should not appear (or
should be marked inactive). All other modules behave as in Mata.

## Verifying with the script

Once a tenant is up locally:

```
npm run tenant:verify -- --url=http://localhost:3000 --slug=mbao --name=Mbao
```

Should print three green checkmarks and exit 0.

## Common issues

**`[tenant] ⚠️ brand-config.json has no entry for "MBAO"`**
Run `npm run tenant:apply` (or use `tenant:dev`, which does it for you).
This means the live config files weren't synced to the tenant bundle.

**`Unable to connect to the database`**
Check `DB_HOST` / `DB_PORT` / `DB_NAME` in `.env.local`. Run
`psql -U postgres -h localhost -d <DB_NAME>` to confirm the DB exists.

**Tenant data shows up wrong (e.g. Mata's POS list)**
You're hitting an old DB that still has Mata data. Either drop+recreate
the DB and re-run `tenant:init`, or point at a fresh DB in `.env.local`.
