/**
 * Client HTTP pour appeler l'endpoint
 *   GET /external/api/creance?dateDebut=&dateFin=&label=
 * expose par mata-depenses-management (l'app MataBanq).
 *
 * Adapte de Maas App pour FRANCHISE multi-PV: au lieu de lire un label
 * unique depuis brand-config.json, on prend le label en parametre et on
 * fournit un mapping pointVente -> label cote routes/finance.js.
 *
 * Configuration via env vars:
 *   - DEPENSES_API_BASE_URL  ex: https://mata-depenses-management.onrender.com
 *   - DEPENSES_API_KEY       token partage (header x-api-key)
 *
 * Comportement:
 *   - Cache memoire LRU (TTL 60s, max 50 entrees) par cle {label, dates}.
 *   - Stale-while-revalidate: si l'API down, on sert l'ancien cache.
 *   - Echec gracieux: retourne null si pas configure ou erreur reseau
 *     sans cache. L'UI Finance affiche alors un message clair.
 *   - Timeout 8s (Render free tier peut etre lent).
 */

'use strict';

const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_AGE_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const REQUEST_TIMEOUT_MS = 8000;

const _cache = new Map();
const _inflight = new Map();

function cacheKey(dateDebut, dateFin, label) {
    return `${label}::${dateDebut || ''}::${dateFin || ''}`;
}

function readCacheLRU(key, now) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if ((now - entry.fetchedAt) > MAX_CACHE_AGE_MS) {
        _cache.delete(key);
        return null;
    }
    _cache.delete(key);
    _cache.set(key, entry);
    return entry;
}

function writeCacheLRU(key, value) {
    _cache.set(key, value);
    while (_cache.size > MAX_CACHE_ENTRIES) {
        const oldest = _cache.keys().next().value;
        if (oldest === undefined) break;
        _cache.delete(oldest);
    }
}

/**
 * Appelle l'API depenses externe pour recuperer la creance pour un label.
 *
 * @param {object} opts
 * @param {string} opts.label          REQUIS — ex "MaaS Keur Bally Liberte 5"
 * @param {string} [opts.dateDebut]    YYYY-MM-DD
 * @param {string} [opts.dateFin]      YYYY-MM-DD
 * @param {boolean} [opts.bypassCache=false]
 * @returns {Promise<object | null>}
 */
async function fetchCreanceCdb(opts) {
    opts = opts || {};
    const baseUrl = (process.env.DEPENSES_API_BASE_URL || '').trim();
    const apiKey = (process.env.DEPENSES_API_KEY || '').trim();
    const label = (opts.label || '').trim();

    if (!baseUrl || !apiKey) {
        return { _disabled: true, _reason: 'env DEPENSES_API_BASE_URL / DEPENSES_API_KEY non configures' };
    }
    if (!label) {
        return { _disabled: true, _reason: 'label MataBanq manquant pour ce point de vente' };
    }

    const key = cacheKey(opts.dateDebut, opts.dateFin, label);
    const now = Date.now();
    if (!opts.bypassCache) {
        const cached = readCacheLRU(key, now);
        if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
            return cached.data;
        }
    }

    if (_inflight.has(key)) return _inflight.get(key);

    const qs = new URLSearchParams();
    if (opts.dateDebut) qs.set('dateDebut', opts.dateDebut);
    if (opts.dateFin) qs.set('dateFin', opts.dateFin);
    qs.set('label', label);

    const url = baseUrl.replace(/\/+$/, '') + '/external/api/creance?' + qs.toString();

    const promise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            if (!res.ok) {
                console.warn(`[finance] depenses creance HTTP ${res.status} (${url})`);
                const stale = _cache.get(key);
                return stale ? stale.data : null;
            }
            const json = await res.json();
            if (!json || typeof json !== 'object') {
                const stale = _cache.get(key);
                return stale ? stale.data : null;
            }
            writeCacheLRU(key, { data: json, fetchedAt: Date.now() });
            return json;
        } catch (err) {
            console.warn('[finance] depenses creance fetch echoue:', err.message);
            const stale = _cache.get(key);
            return stale ? stale.data : null;
        } finally {
            clearTimeout(timeoutId);
            _inflight.delete(key);
        }
    })();

    _inflight.set(key, promise);
    return promise;
}

/**
 * Mapping FRANCHISE: pointVente -> label MataBanq.
 * Source de verite cote backend pour eviter une divergence frontend.
 */
const PV_TO_MATABANQ_LABEL = {
    'Keur Bali': 'MaaS Keur Bally Liberte 5',
    'Almadie 2': 'Maas Keur Bally Almadies 2',
    // Tolerance orthographique
    'Almadies 2': 'Maas Keur Bally Almadies 2'
};

function labelForPointVente(pv) {
    if (!pv) return null;
    return PV_TO_MATABANQ_LABEL[pv] || null;
}

function allLabels() {
    // Dedup au cas ou plusieurs PV mappent au meme label
    return Array.from(new Set(Object.values(PV_TO_MATABANQ_LABEL)));
}

function clearCache() {
    _cache.clear();
    _inflight.clear();
}

module.exports = {
    fetchCreanceCdb,
    labelForPointVente,
    allLabels,
    PV_TO_MATABANQ_LABEL,
    clearCache,
    CACHE_TTL_MS,
    REQUEST_TIMEOUT_MS
};
