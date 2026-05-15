/**
 * Routes Finance — onglet "Creances Fournisseur".
 *
 * Adaptation FRANCHISE (multi-PV) du module Finance Maas. Scope:
 *   - GET /api/finance/creances?dateDebut=&dateFin=&pointVente=
 *       Renvoie { local: {...calcul commission 3% local avec resolver
 *                          + historique temporel...},
 *                 cdb:   {...solde MataBanq...} | null,
 *                 cdb_per_label: {...detail par label si cumul multi-PV...} }
 *   - GET /api/finance/paiements?dateDebut=&dateFin=&pointVente=
 *   - POST /api/finance/paiements
 *   - DELETE /api/finance/paiements/:id
 *   - GET /api/finance/prix       (catalogue fournisseur_prix)
 *   - PUT /api/finance/prix       (upsert + historise)
 *   - DELETE /api/finance/prix/:produit
 *   - GET /api/finance/alias
 *   - PUT /api/finance/alias
 *   - DELETE /api/finance/alias/:alias
 *   - GET /api/finance/config
 *
 * Logique calcul (mirror Maas):
 *   resolverMaps = (catalog, aliases) cache 60s
 *   pour chaque vente:
 *     resolved = resolveProduit(vente.produit, resolverMaps)
 *     prixVenteEff = lookup point-in-time dans prix_vente_history a vente.date,
 *                    fallback resolved.value.prix_vente
 *     dette += (commission_pct / 100) * prixVenteEff * vente.nombre
 *   Les ventes dont le produit n'est PAS resolu sont silencieusement ignorees
 *   (cf. Maas, voir doc resolver).
 */

'use strict';

const express = require('express');
const { Op } = require('sequelize');
const {
    Vente,
    FournisseurPaiement,
    FournisseurPrix,
    ProduitAlias,
    PrixVenteHistory,
    PrixAchatHistory
} = require('../db/models');
const {
    fetchCreanceCdb,
    labelForPointVente,
    PV_TO_MATABANQ_LABEL,
    allLabels
} = require('../lib/depenses-creance-client');
const { resolveProduit, buildResolverMaps } = require('../lib/produit-resolver');
const financeCache = require('../lib/finance-cache');

const router = express.Router();

// ============================================================
// Auth
// ============================================================
function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: 'Non authentifie' });
    }
    next();
}
function requireWrite(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: 'Non authentifie' });
    }
    if (!req.session.user.canWrite) {
        return res.status(403).json({ success: false, error: 'Droits d\'ecriture requis' });
    }
    next();
}
function requireAdvanced(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: 'Non authentifie' });
    }
    const role = req.session.user.role;
    if (!['admin', 'superutilisateur', 'superviseur'].includes(role)) {
        return res.status(403).json({ success: false, error: 'Droits avances requis' });
    }
    next();
}

// ============================================================
// Helpers
// ============================================================
function toISO(input) {
    if (!input) return null;
    const s = String(input).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;
    m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}
function defaultPeriode() {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return { dateDebut: `${yyyy}-${mm}-01`, dateFin: `${yyyy}-${mm}-${dd}` };
}
function generateDateRange(startISO, endISO) {
    const parse = (s) => new Date(`${s}T00:00:00Z`);
    const fmt = (d) => {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    };
    const list = [];
    for (let t = parse(startISO).getTime(); t <= parse(endISO).getTime(); t += 86400000) {
        list.push(fmt(new Date(t)));
    }
    return list;
}
function round2(n) { return Math.round(n * 100) / 100; }

// ============================================================
// Resolver temporel des prix (port verbatim de Maas)
// ============================================================
/**
 * Construit un lookup point-in-time generique pour les history tables
 * (prix_vente_history, prix_achat_history). Retourne une fonction
 * (produitLower, dateISO) -> prix_effectif|null.
 */
function buildTemporalResolver(historyRows, prixField) {
    const byProduit = new Map();
    for (const h of historyRows) {
        const key = h.produit.toLowerCase();
        if (!byProduit.has(key)) byProduit.set(key, []);
        byProduit.get(key).push({
            ts: new Date(h.created_at).getTime(),
            prix: parseFloat(h[prixField])
        });
    }
    for (const arr of byProduit.values()) {
        arr.sort((a, b) => a.ts - b.ts);
    }
    function lastIndexBefore(arr, cutoffMs) {
        let lo = 0, hi = arr.length - 1, ans = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (arr[mid].ts <= cutoffMs) { ans = mid; lo = mid + 1; }
            else { hi = mid - 1; }
        }
        return ans;
    }
    return function getPrixAtDate(produitNomLower, dateISO) {
        const arr = byProduit.get(produitNomLower);
        if (!arr || arr.length === 0) return null;
        const cutoffMs = new Date(dateISO + 'T23:59:59.999Z').getTime();
        const i = lastIndexBefore(arr, cutoffMs);
        return i < 0 ? null : arr[i].prix;
    };
}

// ============================================================
// Configuration commission (env-overridable)
// ============================================================
const COMMISSION_PCT = parseFloat(process.env.FINANCE_COMMISSION_PCT) || 3.0;
const CATEGORIES_ELIGIBLES = (process.env.FINANCE_CATEGORIES_ELIGIBLES
    || 'Bovin,Ovin,Caprin,Volaille,Poisson').split(',').map(s => s.trim()).filter(Boolean);

// ============================================================
// Calcul local: commission 3% via resolver + temporal pricing
// ============================================================
async function computeCreancesLocal({ dateDebut, dateFin, pointVente }) {
    const dDeb = toISO(dateDebut) || defaultPeriode().dateDebut;
    const dFin = toISO(dateFin) || defaultPeriode().dateFin;
    const dateList = generateDateRange(dDeb, dFin);

    // 1. Catalogue + aliases (cache 60s)
    const { catalog: prixRows, aliases: aliasRows } = await financeCache.getCatalogAndAliases();
    const resolverMaps = buildResolverMaps(prixRows, aliasRows);

    // 2. Historiques temporels (prix vente + prix achat)
    const [pvHistory, paHistory] = await Promise.all([
        PrixVenteHistory.findAll({ order: [['created_at', 'ASC']] }),
        PrixAchatHistory.findAll({ order: [['created_at', 'ASC']] })
    ]);
    const prixVenteAtDate = buildTemporalResolver(pvHistory, 'prix_vente');
    const prixAchatAtDate = buildTemporalResolver(paHistory, 'prix_achat');

    // Resout le prix_vente catalogue effectif pour (produit_vente, date).
    // Cascade: history point-in-time -> catalog courant -> null si unmapped.
    const lookupPrixVenteAtDate = (produitVenteNom, venteDateISO) => {
        const r = resolveProduit(produitVenteNom, resolverMaps);
        if (!r.resolved) return null;
        const fromHistory = prixVenteAtDate(r.resolved.toLowerCase(), venteDateISO);
        if (fromHistory != null) return fromHistory;
        return r.value ? r.value.prix_vente : null;
    };

    // 3. Ventes de la periode (filtre PV si specifie)
    const venteWhere = {
        date: { [Op.in]: dateList },
        categorie: { [Op.in]: CATEGORIES_ELIGIBLES }
    };
    if (pointVente && pointVente !== 'tous') {
        venteWhere.pointVente = pointVente;
    }
    const ventes = await Vente.findAll({
        where: venteWhere,
        attributes: ['date', 'produit', 'categorie', 'pointVente', 'nombre', 'prixUnit']
    });

    // 4. Calcul commission 3% via resolver + point-in-time
    const detail = new Map();
    let totalDette = 0;
    let ventesNonResolues = 0;
    let qteNonResolue = 0;

    for (const v of ventes) {
        const qte = parseFloat(v.nombre) || 0;
        if (qte <= 0) continue;

        const resolved = resolveProduit(v.produit, resolverMaps);
        if (!resolved.resolved) {
            // Vente d'un produit non present dans le catalogue (ni alias).
            // On l'ignore pour le calcul mais on l'agrege en "non resolu"
            // pour faciliter le diagnostic cote UI.
            ventesNonResolues++;
            qteNonResolue += qte;
            continue;
        }

        const prixVenteEff = lookupPrixVenteAtDate(v.produit, v.date);
        if (prixVenteEff == null || prixVenteEff <= 0) {
            // Catalog n'a pas (encore) de prix_vente: skip silencieux,
            // cote Maas c'est le meme comportement.
            continue;
        }

        const detteLigne = (COMMISSION_PCT / 100) * prixVenteEff * qte;
        totalDette += detteLigne;

        // Agreger par produit resolu (= entree catalogue)
        const key = resolved.resolved;
        const agg = detail.get(key) || {
            produit: key,
            produit_vente_originaux: new Set(),
            quantite: 0,
            prix_vente_courant: resolved.value ? resolved.value.prix_vente : null,
            dette: 0,
            statut: resolved.statut
        };
        agg.produit_vente_originaux.add(v.produit);
        agg.quantite += qte;
        agg.dette += detteLigne;
        detail.set(key, agg);
    }

    // 5. Paiements (filtre PV optionnel)
    const paiementWhere = { date: { [Op.gte]: dDeb, [Op.lte]: dFin } };
    if (pointVente && pointVente !== 'tous') {
        paiementWhere.point_vente = pointVente;
    }
    const paiements = await FournisseurPaiement.findAll({
        where: paiementWhere,
        order: [['date', 'ASC']]
    });
    const totalPaiements = paiements.reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);

    return {
        periode: { dateDebut: dDeb, dateFin: dFin },
        commission_pct: COMMISSION_PCT,
        categories_eligibles: CATEGORIES_ELIGIBLES,
        point_vente: pointVente || 'tous',
        ce_que_je_dois: round2(totalDette),
        paiements_effectues: round2(totalPaiements),
        reste_a_payer: round2(totalDette - totalPaiements),
        ventes_non_resolues: ventesNonResolues,
        quantite_non_resolue: round2(qteNonResolue),
        catalog_size: prixRows.length,
        alias_size: aliasRows.length,
        detail: Array.from(detail.values())
            .map(d => ({
                produit: d.produit,
                produit_vente_originaux: Array.from(d.produit_vente_originaux),
                quantite: round2(d.quantite),
                prix_vente_courant: d.prix_vente_courant == null ? null : round2(d.prix_vente_courant),
                dette: round2(d.dette),
                statut: d.statut
            }))
            .sort((a, b) => b.dette - a.dette)
    };
}

// ============================================================
// GET /api/finance/creances
// ============================================================
router.get('/creances', requireAuth, async (req, res) => {
    try {
        const { dateDebut, dateFin, pointVente } = req.query;

        let labelsToFetch;
        if (pointVente && pointVente !== 'tous') {
            const lbl = labelForPointVente(pointVente);
            labelsToFetch = lbl ? [lbl] : [];
        } else {
            labelsToFetch = allLabels();
        }

        const [localResult, ...remoteResults] = await Promise.allSettled([
            computeCreancesLocal({ dateDebut, dateFin, pointVente }),
            ...labelsToFetch.map(label => fetchCreanceCdb({ dateDebut, dateFin, label }))
        ]);

        if (localResult.status === 'rejected') throw localResult.reason;

        const cdbPerLabel = {};
        labelsToFetch.forEach((label, idx) => {
            const r = remoteResults[idx];
            cdbPerLabel[label] = r.status === 'fulfilled' ? r.value : { _error: r.reason && r.reason.message };
        });

        // Format MataBanq verifie au 2026-05-15 (api_version 1.2):
        //   summary.totals.current_balance       -> total agrege tous portfolios
        //   summary.portfolios[].current_balance -> par portfolio
        //   details[].status[].solde_final       -> par client
        // On essaie dans l'ordre de specificite (specifique -> agrege).
        function extractSolde(payload) {
            if (!payload || typeof payload !== 'object') return null;
            if (payload._disabled || payload._error) return null;
            const candidates = [
                // Par client (cas le plus specifique pour un label donne)
                payload.details && payload.details[0] && payload.details[0].status
                    && payload.details[0].status[0] && payload.details[0].status[0].solde_final,
                payload.details && payload.details[0] && payload.details[0].status
                    && payload.details[0].status[0] && payload.details[0].status[0].solde,
                // Agrege total
                payload.summary && payload.summary.totals && payload.summary.totals.current_balance,
                // Premier portfolio
                payload.summary && payload.summary.portfolios && payload.summary.portfolios[0]
                    && payload.summary.portfolios[0].current_balance,
                // Cles plates (anciennes versions API)
                payload.solde,
                payload.solde_creance,
                payload.total,
                payload.balance,
                payload.details && payload.details[0] && payload.details[0].solde
            ];
            for (const c of candidates) {
                const n = parseFloat(c);
                if (Number.isFinite(n)) return n;
            }
            return null;
        }

        let cdbAgrege = null;
        let cdbDisabledReason = null;
        let cdbHasData = false;
        let cdbSum = 0;
        for (const label of labelsToFetch) {
            const payload = cdbPerLabel[label];
            if (payload && payload._disabled) {
                cdbDisabledReason = cdbDisabledReason || payload._reason;
                continue;
            }
            const s = extractSolde(payload);
            if (s != null) { cdbHasData = true; cdbSum += s; }
        }
        if (cdbHasData) {
            cdbAgrege = { solde: round2(cdbSum), labels: labelsToFetch };
        } else if (cdbDisabledReason) {
            cdbAgrege = { _disabled: true, _reason: cdbDisabledReason };
        }

        res.json({
            success: true,
            data: {
                local: localResult.value,
                cdb: cdbAgrege,
                cdb_per_label: cdbPerLabel,
                pv_to_label: PV_TO_MATABANQ_LABEL
            }
        });
    } catch (e) {
        console.error('GET /api/finance/creances:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================
// PAIEMENTS
// ============================================================
router.get('/paiements', requireAuth, async (req, res) => {
    try {
        const where = {};
        if (req.query.dateDebut) where.date = { [Op.gte]: req.query.dateDebut };
        if (req.query.dateFin) {
            where.date = where.date || {};
            where.date[Op.lte] = req.query.dateFin;
        }
        if (req.query.pointVente && req.query.pointVente !== 'tous') {
            where.point_vente = req.query.pointVente;
        }
        const rows = await FournisseurPaiement.findAll({
            where,
            order: [['date', 'DESC'], ['id', 'DESC']]
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/paiements:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/paiements', requireWrite, async (req, res) => {
    try {
        const { date, montant, mode, reference, commentaire, pointVente } = req.body;
        if (!date || montant == null) {
            return res.status(400).json({ success: false, error: 'date et montant requis' });
        }
        const mt = parseFloat(montant);
        if (!Number.isFinite(mt) || mt <= 0) {
            return res.status(400).json({ success: false, error: 'montant doit etre un nombre > 0' });
        }
        const created = await FournisseurPaiement.create({
            date,
            montant: mt,
            mode: mode || null,
            reference: reference || null,
            commentaire: commentaire || null,
            point_vente: (pointVente && pointVente !== 'tous') ? pointVente : null,
            created_by: (req.session.user && req.session.user.username) || null
        });
        res.json({ success: true, data: created });
    } catch (e) {
        console.error('POST /api/finance/paiements:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/paiements/:id', requireWrite, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ success: false, error: 'id invalide' });
        }
        const rows = await FournisseurPaiement.destroy({ where: { id } });
        if (rows === 0) {
            return res.status(404).json({ success: false, error: 'Paiement introuvable' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/finance/paiements/:id:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================
// PRIX FOURNISSEUR (catalogue)
// ============================================================
router.get('/prix', requireAuth, async (req, res) => {
    try {
        const rows = await FournisseurPrix.findAll({ order: [['produit', 'ASC']] });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/prix:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/finance/prix
// Body: { produit, prix_vente, prix_achat? }
// Upsert + insert into prix_vente_history / prix_achat_history pour le
// point-in-time. Reservé aux roles avances (admin / super*).
router.put('/prix', requireAdvanced, async (req, res) => {
    try {
        const { produit, prix_vente, prix_achat } = req.body;
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const pv = parseFloat(prix_vente);
        if (!Number.isFinite(pv) || pv < 0) {
            return res.status(400).json({ success: false, error: 'prix_vente doit etre un nombre >= 0' });
        }
        let pa = null;
        if (prix_achat !== undefined && prix_achat !== null && prix_achat !== '') {
            pa = parseFloat(prix_achat);
            if (!Number.isFinite(pa) || pa < 0) {
                return res.status(400).json({ success: false, error: 'prix_achat doit etre un nombre >= 0' });
            }
        }
        const changedBy = (req.session.user && req.session.user.username) || null;

        // Upsert catalog
        const existing = await FournisseurPrix.findByPk(produit);
        if (existing) {
            const updates = { prix_vente: pv, updated_at: new Date() };
            if (pa != null) updates.prix_achat = pa;
            await existing.update(updates);
        } else {
            await FournisseurPrix.create({
                produit,
                prix_vente: pv,
                prix_achat: pa,
                updated_at: new Date()
            });
        }

        // Historiser
        await PrixVenteHistory.create({
            produit, prix_vente: pv, changed_by: changedBy, created_at: new Date()
        });
        if (pa != null) {
            await PrixAchatHistory.create({
                produit, prix_achat: pa, changed_by: changedBy, created_at: new Date()
            });
        }

        financeCache.invalidate();
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/finance/prix:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/prix/:produit', requireAdvanced, async (req, res) => {
    try {
        const produit = req.params.produit;
        const rows = await FournisseurPrix.destroy({ where: { produit } });
        if (rows === 0) {
            return res.status(404).json({ success: false, error: 'Produit catalogue introuvable' });
        }
        financeCache.invalidate();
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/finance/prix/:produit:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================
// ALIAS PRODUITS
// ============================================================
router.get('/alias', requireAuth, async (req, res) => {
    try {
        const rows = await ProduitAlias.findAll({ order: [['alias_produit', 'ASC']] });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/alias', requireAdvanced, async (req, res) => {
    try {
        const { alias_produit, produit_catalog } = req.body;
        if (!alias_produit || !produit_catalog) {
            return res.status(400).json({ success: false, error: 'alias_produit et produit_catalog requis' });
        }
        // Verifier que produit_catalog existe vraiment
        const catalogExists = await FournisseurPrix.findByPk(produit_catalog);
        if (!catalogExists) {
            return res.status(400).json({ success: false, error: `produit_catalog "${produit_catalog}" inexistant dans fournisseur_prix` });
        }
        const existing = await ProduitAlias.findByPk(alias_produit);
        if (existing) {
            await existing.update({ produit_catalog, updated_at: new Date() });
        } else {
            await ProduitAlias.create({ alias_produit, produit_catalog, updated_at: new Date() });
        }
        financeCache.invalidate();
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/finance/alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/alias/:alias', requireAdvanced, async (req, res) => {
    try {
        const alias = req.params.alias;
        const rows = await ProduitAlias.destroy({ where: { alias_produit: alias } });
        if (rows === 0) {
            return res.status(404).json({ success: false, error: 'Alias introuvable' });
        }
        financeCache.invalidate();
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/finance/alias/:alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================
// GET /api/finance/config — expose mapping PV<->label pour le front
// ============================================================
router.get('/config', requireAuth, (req, res) => {
    res.json({
        success: true,
        data: {
            pv_to_label: PV_TO_MATABANQ_LABEL,
            commission_pct: COMMISSION_PCT,
            categories_eligibles: CATEGORIES_ELIGIBLES
        }
    });
});

module.exports = router;
