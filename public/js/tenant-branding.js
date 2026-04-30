/**
 * Tenant branding bootstrap.
 *
 * Fetches the current tenant identity from /api/tenant and applies it to
 * the page: prefixes the document title with the tenant name and fills
 * any element marked with data-tenant-name / data-tenant-slug.
 *
 * Loaded on every shell page (login.html, index.html, admin.html, pos.html).
 */
(function () {
    function applyTenant(t) {
        if (!t || !t.name) return;
        try {
            // Prefix the document title with the tenant name unless already there
            if (document.title && document.title.indexOf(t.name) === -1) {
                document.title = `${t.name} — ${document.title}`;
            }
            // Fill any [data-tenant-name] / [data-tenant-slug] placeholders
            document.querySelectorAll('[data-tenant-name]').forEach((el) => {
                el.textContent = t.name;
            });
            document.querySelectorAll('[data-tenant-slug]').forEach((el) => {
                el.textContent = t.slug;
            });
            // Expose globally for any other script that needs it
            window.__tenant = t;
        } catch (e) {
            console.warn('[tenant-branding] apply failed', e);
        }
    }

    fetch('/api/tenant', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then(applyTenant)
        .catch((e) => console.warn('[tenant-branding] fetch failed', e));
})();
