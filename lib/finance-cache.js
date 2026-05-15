/**
 * Cache mémoire (TTL 60s) pour catalogue prix + aliases.
 *
 * Utilisé par routes/finance.js#computeCreancesLocal qui charge ces
 * données à chaque requête `/api/finance/creances`. Économise 2
 * round-trips Postgres par appel.
 *
 * Invalidation manuelle requise sur toute mutation :
 *   - PUT /prix / DELETE /prix/:produit
 *   - PUT /alias / DELETE /alias/:alias
 */

'use strict';

const { FournisseurPrix, ProduitAlias } = require('../db/models');

const TTL_MS = 60 * 1000;

let _cache = null;
let _cacheAt = 0;
let _inflight = null;

/**
 * Renvoie { catalog, aliases } depuis le cache ou refetch si expiré.
 * @returns {Promise<{catalog: Array, aliases: Array}>}
 */
async function getCatalogAndAliases() {
    const now = Date.now();
    if (_cache && (now - _cacheAt) < TTL_MS) {
        return _cache;
    }
    if (_inflight) {
        return _inflight;
    }
    _inflight = (async () => {
        try {
            const [catalog, aliases] = await Promise.all([
                FournisseurPrix.findAll(),
                ProduitAlias.findAll()
            ]);
            _cache = { catalog, aliases };
            _cacheAt = Date.now();
            return _cache;
        } finally {
            _inflight = null;
        }
    })();
    return _inflight;
}

/** Invalide le cache après toute mutation catalogue ou alias. */
function invalidate() {
    _cache = null;
    _cacheAt = 0;
}

module.exports = {
    getCatalogAndAliases,
    invalidate,
    TTL_MS
};
