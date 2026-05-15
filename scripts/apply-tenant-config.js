#!/usr/bin/env node
/**
 * Apply per-tenant config files at deploy time.
 *
 * Render runs this in buildCommand. It reads TENANT_SLUG and copies the
 * matching files from config/tenants/<slug>/ over the live config files
 * at the project root.
 *
 *   nomDuClient.json        -> nomDuClient.json
 *   brand-config.json       -> brand-config.json
 *   modules-state.json      -> config/modules-state.json
 *
 * If TENANT_SLUG is unset, the existing files are left untouched (this
 * is the fallback for the legacy Mata service running on `main`).
 *
 * Exits non-zero only on hard errors so a misconfigured tenant fails the
 * deploy instead of silently shipping the wrong client's branding.
 */

const fs = require('fs');
const path = require('path');

const slug = process.env.TENANT_SLUG;

if (!slug) {
    console.log('[apply-tenant-config] TENANT_SLUG not set — leaving existing config files in place.');
    process.exit(0);
}

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'config', 'tenants', slug);

if (!fs.existsSync(sourceDir)) {
    console.error(`[apply-tenant-config] FATAL: tenant config dir not found: ${sourceDir}`);
    console.error('Run: npm run tenant:create -- --slug=' + slug + ' --name="<Display Name>"');
    process.exit(1);
}

const mappings = [
    ['nomDuClient.json', 'nomDuClient.json'],
    ['brand-config.json', 'brand-config.json'],
    ['modules-state.json', path.join('config', 'modules-state.json')],
    ['client-config.json', path.join('config', 'client-config.json')],
];

let copied = 0;
for (const [src, dst] of mappings) {
    const srcPath = path.join(sourceDir, src);
    if (!fs.existsSync(srcPath)) {
        console.warn(`[apply-tenant-config] missing source ${src} — skipping`);
        continue;
    }
    const dstPath = path.join(root, dst);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
    console.log(`[apply-tenant-config] ${src} -> ${dst}`);
    copied += 1;
}

console.log(`[apply-tenant-config] tenant=${slug} files=${copied} ✅`);
