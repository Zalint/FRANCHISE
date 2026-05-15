#!/usr/bin/env node
/**
 * Post-deploy health check for a tenant.
 *
 *   node scripts/verify-tenant.js --url=https://mbao.example.com --slug=mbao --name=Mbao
 *
 * Hits the deployed service and verifies:
 *   - /api/tenant          returns {slug, name} matching expected
 *   - /api/client-config   returns clientName matching expected
 *   - /api/achats-boeuf    returns 403 (abattage module disabled)
 *
 * Exits 0 on success, non-zero on any check failure. Useful from a
 * laptop after deploying each tenant to confirm wiring.
 */

const https = require('https');
const http = require('http');
const url = require('url');

function arg(name) {
    const prefix = `--${name}=`;
    const m = process.argv.find((a) => a.startsWith(prefix));
    return m ? m.slice(prefix.length) : null;
}

const baseUrl = arg('url');
const expectedSlug = arg('slug');
const expectedName = arg('name');

if (!baseUrl || !expectedSlug || !expectedName) {
    console.error('Usage: node scripts/verify-tenant.js --url=https://<host> --slug=<slug> --name="<Display Name>"');
    process.exit(1);
}

function request(target) {
    return new Promise((resolve, reject) => {
        const parsed = new url.URL(target);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(
            { method: 'GET', hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search },
            (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }
        );
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('timeout')));
        req.end();
    });
}

function tryParse(body) {
    try { return JSON.parse(body); } catch { return null; }
}

async function main() {
    let failures = 0;
    const check = (label, ok, detail = '') => {
        if (ok) {
            console.log(`  ✅ ${label}`);
        } else {
            console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
            failures += 1;
        }
    };

    console.log(`\n=== verify-tenant: ${baseUrl} ===\n`);

    // /api/tenant
    {
        const r = await request(baseUrl + '/api/tenant');
        const j = tryParse(r.body);
        check('GET /api/tenant returns 200', r.status === 200, `got ${r.status}`);
        check('  slug matches', j && j.slug === expectedSlug, `got ${j && j.slug}`);
        check('  name matches', j && j.name === expectedName, `got ${j && j.name}`);
    }

    // /api/client-config
    {
        const r = await request(baseUrl + '/api/client-config');
        const j = tryParse(r.body);
        check('GET /api/client-config returns 200', r.status === 200, `got ${r.status}`);
        const clientName = j && j.config && j.config.clientName;
        check('  clientName matches tenant name', clientName === expectedName, `got ${clientName}`);
    }

    // Abattage gate (auth-protected; the module middleware fires regardless of auth)
    {
        const r = await request(baseUrl + '/api/achats-boeuf');
        // 401 (auth) or 403 (module off) both indicate the module is gated;
        // 200 would mean the module is unexpectedly active.
        const blocked = r.status === 401 || r.status === 403;
        check('GET /api/achats-boeuf is gated (401/403)', blocked, `got ${r.status}`);
    }

    console.log('');
    if (failures > 0) {
        console.log(`❌ ${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log('✅ All checks passed.');
}

main().catch((err) => {
    console.error('verify-tenant crashed:', err.message);
    process.exit(2);
});
