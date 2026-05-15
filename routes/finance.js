/**
 * Routes Finance — onglet "Creances Fournisseur".
 *
 * Adaptation FRANCHISE (multi-PV) du module Finance Maas. Scope reduit:
 *   - GET /api/finance/creances?dateDebut=&dateFin=&pointVente=
 *       Renvoie { local: {...calcul commission 3% local...},
 *                 cdb:   {...solde MataBanq...} | null,
 *                 cdb_per_label: {...detail par label si cumul multi-PV...} }
 *   - GET /api/finance/paiements?dateDebut=&dateFin=&pointVente=
 *   - POST /api/finance/paiements
 *   - DELETE /api/finance/paiements/:id
 *
 * NB: pas de centre de decoupe, pas d'alias produits, pas d'historique
 * temporel des prix, pas de FinanceConfig — simplifie par rapport a Maas
 * (cf. demande utilisateur "pas de commande centre de decoupe pour l'instant").
 */

'use strict';

const express = require('express');
const { Op } = require('sequelize');
const { Vente, FournisseurPaiement } = require('../db/models');
const {
    fetchCreanceCdb,
    labelForPointVente,
    PV_TO_MATABANQ_LABEL,
    allLabels
} = require('../lib/depenses-creance-client');

const router = express.Router();

// ============================================================
// Auth: tout utilisateur connecte peut LIRE; seuls les utilisateurs
// avec droits d'ecriture peuvent CREER/SUPPRIMER des paiements.
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

// ============================================================
// Helpers periode
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
    return {
        dateDebut: `${yyyy}-${mm}-01`,
        dateFin: `${yyyy}-${mm}-${dd}`
    };
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

function round2(n) {
    return Math.round(n * 100) / 100;
}

// ============================================================
// Configuration commission (override possible via env)
// ============================================================
const COMMISSION_PCT = parseFloat(process.env.FINANCE_COMMISSION_PCT) || 3.0;
const CATEGORIES_ELIGIBLES = (process.env.FINANCE_CATEGORIES_ELIGIBLES
    || 'Bovin,Ovin,Caprin,Volaille,Poisson').split(',').map(s => s.trim()).filter(Boolean);

// ============================================================
// Calcul local: commission COMMISSION_PCT % sur les ventes eligibles
// ============================================================
async function computeCreancesLocal({ dateDebut, dateFin, pointVente }) {
    const dDeb = toISO(dateDebut) || defaultPeriode().dateDebut;
    const dFin = toISO(dateFin) || defaultPeriode().dateFin;
    const dateList = generateDateRange(dDeb, dFin);

    const where = {
        date: { [Op.in]: dateList },
        categorie: { [Op.in]: CATEGORIES_ELIGIBLES }
    };
    if (pointVente && pointVente !== 'tous') {
        where.pointVente = pointVente;
    }

    const ventes = await Vente.findAll({
        where,
        attributes: ['date', 'produit', 'categorie', 'pointVente', 'nombre', 'prixUnit']
    });

    const detail = new Map(); // produit -> agg
    let totalDette = 0;

    for (const v of ventes) {
        const qte = parseFloat(v.nombre) || 0;
        const prix = parseFloat(v.prixUnit) || 0;
        if (qte <= 0 || prix <= 0) continue;
        const detteLigne = (COMMISSION_PCT / 100) * prix * qte;
        totalDette += detteLigne;

        const key = v.produit;
        const agg = detail.get(key) || { produit: key, quantite: 0, dette: 0 };
        agg.quantite += qte;
        agg.dette += detteLigne;
        detail.set(key, agg);
    }

    // Paiements de la periode (filtre PV optionnel)
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
        detail: Array.from(detail.values())
            .map(d => ({ produit: d.produit, quantite: round2(d.quantite), dette: round2(d.dette) }))
            .sort((a, b) => b.dette - a.dette)
    };
}

// ============================================================
// GET /api/finance/creances
// ============================================================
router.get('/creances', requireAuth, async (req, res) => {
    try {
        const { dateDebut, dateFin, pointVente } = req.query;

        // Determiner les labels MataBanq a interroger:
        //   - filtre PV explicite => 1 seul label
        //   - sinon (cumul) => tous les labels mappes (Liberte 5 + Almadies 2)
        let labelsToFetch;
        if (pointVente && pointVente !== 'tous') {
            const lbl = labelForPointVente(pointVente);
            labelsToFetch = lbl ? [lbl] : [];
        } else {
            labelsToFetch = allLabels();
        }

        // Local + remote en parallele
        const [localResult, ...remoteResults] = await Promise.allSettled([
            computeCreancesLocal({ dateDebut, dateFin, pointVente }),
            ...labelsToFetch.map(label => fetchCreanceCdb({ dateDebut, dateFin, label }))
        ]);

        if (localResult.status === 'rejected') throw localResult.reason;

        // Construire le payload CDB:
        //   - cdb_per_label: dict label -> reponse MataBanq (ou null/disabled)
        //   - cdb: agregat (sum des soldes) si plusieurs labels, sinon = unique
        const cdbPerLabel = {};
        labelsToFetch.forEach((label, idx) => {
            const r = remoteResults[idx];
            cdbPerLabel[label] = r.status === 'fulfilled' ? r.value : { _error: r.reason && r.reason.message };
        });

        // Agregation simple: somme des soldes numeriques si presents.
        // Le format MataBanq exact peut varier; on tente plusieurs cles communes.
        function extractSolde(payload) {
            if (!payload || typeof payload !== 'object') return null;
            if (payload._disabled || payload._error) return null;
            // Essais successifs de la cle "solde"
            const candidates = [
                payload.solde,
                payload.solde_creance,
                payload.total,
                payload.balance,
                payload.details && payload.details[0] && payload.details[0].solde,
                payload.details && payload.details[0] && payload.details[0].status
                    && payload.details[0].status[0] && payload.details[0].status[0].solde
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
            if (s != null) {
                cdbHasData = true;
                cdbSum += s;
            }
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
// GET /api/finance/paiements
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

// ============================================================
// POST /api/finance/paiements
// ============================================================
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

// ============================================================
// DELETE /api/finance/paiements/:id
// ============================================================
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
