#!/usr/bin/env node
/**
 * Decommission a tenant: DROP SCHEMA "<slug>" CASCADE on the shared
 * cluster. Use this AFTER you've cancelled the tenant's Render Web
 * Service and confirmed there's no longer a need for their data.
 *
 *   node scripts/drop-tenant-schema.js \
 *     --slug=mbao \
 *     --shared-url=postgres://user:pw@shared-host/shared_db \
 *     --yes
 *
 *   --yes      Required. Confirms you're aware this is destructive.
 *
 * Refuses to drop "public" or any unset/empty slug — those are guard
 * rails against fat-fingering during late-night ops.
 *
 * NOT idempotent in the safety sense: re-running on a slug that
 * doesn't exist still requires --yes; the script will report "schema
 * not found" and exit cleanly.
 */

const { spawnSync } = require('child_process');
const path = require('path');

function arg(name) {
    const prefix = `--${name}=`;
    const m = process.argv.find((a) => a.startsWith(prefix));
    return m ? m.slice(prefix.length) : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

const slug = arg('slug');
const sharedUrl = arg('shared-url');
const confirmed = flag('yes');

if (!slug || !sharedUrl) {
    console.error(
        'Usage: node scripts/drop-tenant-schema.js \\\n' +
        '         --slug=<slug> \\\n' +
        '         --shared-url=<shared-cluster-url> \\\n' +
        '         --yes\n\n' +
        'This DROPs the tenant\'s schema and ALL its data. Cannot be undone.'
    );
    process.exit(1);
}

if (!confirmed) {
    console.error(
        `Refusing to drop schema "${slug}" without --yes.\n` +
        `Pass --yes to confirm you understand this destroys all data in the schema.`
    );
    process.exit(1);
}

if (slug === 'public' || slug === 'pg_catalog' || slug === 'information_schema' || slug === '') {
    console.error(`Refusing to drop reserved/empty schema "${slug}".`);
    process.exit(1);
}

if (!/^[a-z0-9_]+$/.test(slug)) {
    console.error(
        `--slug must be lowercase alphanumeric/underscore (got "${slug}"). ` +
        `Tenant slugs with hyphens map to underscored schemas (e.g. "keur-massar" → "keur_massar").`
    );
    process.exit(1);
}

const PG_BIN = process.env.PG_BIN || '';
const psqlBin = PG_BIN ? path.join(PG_BIN, 'psql') : 'psql';

// Pre-check: how much data are we about to vaporize? Nice to log so
// the operator sees the magnitude in their terminal.
const counts = spawnSync(
    psqlBin,
    [
        '--dbname', sharedUrl,
        '-t', '-A',
        '-c', `SELECT count(*) FROM pg_tables WHERE schemaname = '${slug}';`,
    ],
    { encoding: 'utf8' }
);

if (counts.status !== 0) {
    console.error('Failed to query pg_tables:', counts.stderr);
    process.exit(1);
}

const tableCount = parseInt(counts.stdout.trim(), 10) || 0;
if (tableCount === 0) {
    console.log(`Schema "${slug}" not found (or empty) on shared cluster — nothing to drop.`);
    process.exit(0);
}

console.log(`Dropping schema "${slug}" (${tableCount} tables, all data)...`);

const drop = spawnSync(
    psqlBin,
    [
        '--dbname', sharedUrl,
        '-v', 'ON_ERROR_STOP=1',
        '-c', `DROP SCHEMA "${slug}" CASCADE;`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] }
);

if (drop.status === 0) {
    console.log(`✅ Schema "${slug}" dropped.`);
    process.exit(0);
}
console.error(`❌ Drop failed (exit ${drop.status}).`);
process.exit(drop.status);
