#!/usr/bin/env node
/**
 * Migrate a legacy Silo tenant DB onto the shared cluster as a schema.
 *
 *   node scripts/migrate-tenant-to-shared.js \
 *     --slug=mbao \
 *     --source-url=postgres://user:pw@host/old_tenant_db \
 *     --shared-url=postgres://user:pw@shared-host/shared_db
 *
 * Pass --dry-run to write the rewritten SQL to stdout without applying.
 *
 * What it does:
 *   1. Spawns pg_dump on the source DB (public schema only, plain SQL,
 *      no owners/priv/tablespaces).
 *   2. Rewrites the dump in-memory:
 *        public.<obj>          → <slug>.<obj>
 *        CREATE SCHEMA public  → CREATE SCHEMA IF NOT EXISTS <slug>
 *        SCHEMA public (in COMMENT) → SCHEMA <slug>
 *      The dump's `SELECT pg_catalog.set_config('search_path','',false)`
 *      line is left intact — it forces fully-qualified names, which is
 *      exactly what we want after the rewrite.
 *   3. Pipes the rewritten SQL to psql against the shared DB.
 *
 * Idempotent only insofar as IF NOT EXISTS handles the schema; tables
 * inside will conflict if the schema already has data. Run on a fresh
 * <slug> schema.
 *
 * Tested locally migrating maas_db's public schema into
 * maas_shared_dev as a "legacy_test" schema.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

function arg(name) {
    const prefix = `--${name}=`;
    const m = process.argv.find((a) => a.startsWith(prefix));
    return m ? m.slice(prefix.length) : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

const slug = arg('slug');
const sourceUrl = arg('source-url');
const sharedUrl = arg('shared-url');
const dryRun = flag('dry-run');

if (!slug || !sourceUrl || (!sharedUrl && !dryRun)) {
    console.error(
        'Usage: node scripts/migrate-tenant-to-shared.js \\\n' +
        '         --slug=<slug> \\\n' +
        '         --source-url=<old-tenant-db-url> \\\n' +
        '         --shared-url=<shared-cluster-url>  [--dry-run]'
    );
    process.exit(1);
}

if (!/^[a-z0-9_]+$/.test(slug)) {
    console.error(
        `--slug must be lowercase alphanumeric/underscore (got "${slug}"). ` +
        `Hyphens in tenant slugs map to underscores in schema names: ` +
        `e.g. tenant slug "keur-massar" → DB_SCHEMA / --slug "keur_massar".`
    );
    process.exit(1);
}

// On Windows, pg_dump / psql aren't on PATH by default. Allow override.
const PG_BIN = process.env.PG_BIN || '';
const pgDumpBin = PG_BIN ? path.join(PG_BIN, 'pg_dump') : 'pg_dump';
const psqlBin = PG_BIN ? path.join(PG_BIN, 'psql') : 'psql';

console.error(`[migrate] dumping public schema from source...`);
const dump = spawnSync(
    pgDumpBin,
    [
        '-n', 'public',
        '--no-owner', '--no-privileges', '--no-tablespaces',
        '-Fp',
        '--dbname', sourceUrl,
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }
);

if (dump.status !== 0) {
    console.error('[migrate] pg_dump failed:', dump.stderr);
    process.exit(1);
}

let sql = dump.stdout;
console.error(`[migrate] dump size: ${sql.length} bytes`);

// Rewrite. Order matters: do the SCHEMA-level replacements before the
// dotted-qualifier replacement so we don't accidentally double-rewrite.
const before = sql.length;
sql = sql
    .replace(/CREATE SCHEMA public;/g, `CREATE SCHEMA IF NOT EXISTS "${slug}";`)
    .replace(/SCHEMA public IS/g, `SCHEMA "${slug}" IS`)
    .replace(/SCHEMA public;/g, `SCHEMA "${slug}";`)
    .replace(/\bpublic\./g, `"${slug}".`);

// Sanity check — there should be zero remaining "public." references
// to non-pg_catalog objects.
const remaining = (sql.match(/(?<![A-Za-z_])public\./g) || []).length;
console.error(`[migrate] rewrote dump (${before} → ${sql.length} bytes; remaining "public." refs: ${remaining})`);

if (dryRun) {
    process.stdout.write(sql);
    process.exit(0);
}

console.error(`[migrate] applying to shared DB as schema "${slug}"...`);
const restore = spawn(psqlBin, ['--dbname', sharedUrl, '-v', 'ON_ERROR_STOP=1'], {
    stdio: ['pipe', 'inherit', 'inherit'],
});
restore.stdin.write(sql);
restore.stdin.end();

restore.on('close', (code) => {
    if (code === 0) {
        console.error(`[migrate] ✅ schema "${slug}" populated. Run npm run tenant:verify next.`);
        process.exit(0);
    } else {
        console.error(`[migrate] ❌ psql exited ${code}.`);
        process.exit(code);
    }
});
