/**
 * js/finance.js — onglet Finance > Creances Fournisseur (FRANCHISE).
 *
 * Adaptation slim de la version Maas pour FRANCHISE multi-PV. 3 accordeons:
 *   A. Creance Partenaire (MataBanq) — solde par label, cumul si "tous"
 *   B. Calcul Maas (commission 3%) — sur les ventes locales eligibles
 *   C. Paiements faits au fournisseur — CRUD local
 *
 * Contrats backend:
 *   GET  /api/finance/creances?dateDebut=&dateFin=&pointVente=
 *   GET  /api/finance/paiements?dateDebut=&dateFin=&pointVente=
 *   POST /api/finance/paiements
 *   DELETE /api/finance/paiements/:id
 */

(function () {
    'use strict';

    let _initialized = false;
    let _config = null;

    function $(id) { return document.getElementById(id); }
    function fmt(n) {
        if (n == null || !Number.isFinite(Number(n))) return '—';
        return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(n))) + ' FCFA';
    }
    function esc(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ================= SUB-TABS =================
    // Bascule entre les sous-onglets (creances / prix / alias).
    function activateSubTab(tabName) {
        // Onglets nav-link
        document.querySelectorAll('#finance-subnav a[data-fin-tab]').forEach(a => {
            a.classList.toggle('active', a.getAttribute('data-fin-tab') === tabName);
        });
        // Panes
        document.querySelectorAll('[data-fin-pane]').forEach(p => {
            p.style.display = p.getAttribute('data-fin-pane') === tabName ? '' : 'none';
        });
        // Lazy-load: charger les donnees du pane affiche
        if (tabName === 'prix') loadPrix();
        else if (tabName === 'alias') loadAlias();
    }

    // Affiche les onglets avances (Prix, Aliases) si l'user a les droits.
    // Fetch /api/check-session pour etre robuste contre une race condition
    // window.currentUser pas encore set.
    async function showAdvancedSubTabsIfAllowed() {
        let role = null;
        // Priorite a window.currentUser (synchrone, sans round-trip)
        if (window.currentUser && window.currentUser.role) {
            role = window.currentUser.role;
        } else {
            try {
                const res = await fetch('/api/check-session', { credentials: 'include' });
                const j = await res.json();
                if (j.success && j.user) {
                    role = j.user.role;
                    window.currentUser = j.user; // hydrate pour les autres modules
                }
            } catch (_) { /* no-op */ }
        }
        const allowed = role && ['admin', 'superutilisateur', 'superviseur'].includes(role);
        document.querySelectorAll('.fin-advanced-tab').forEach(el => {
            el.style.display = allowed ? '' : 'none';
        });
    }

    // ================= INIT =================
    async function init() {
        if (_initialized) {
            // Re-trigger reload pour rafraichir les donnees
            await loadAll();
            return;
        }
        _initialized = true;

        // Sub-tabs (creances / prix / alias)
        await showAdvancedSubTabsIfAllowed();
        document.querySelectorAll('#finance-subnav a[data-fin-tab]').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                activateSubTab(a.getAttribute('data-fin-tab'));
            });
        });
        // Formulaire Prix
        const formPrix = $('fin-prix-form');
        if (formPrix) formPrix.addEventListener('submit', onSubmitPrix);
        // Formulaire Alias
        const formAlias = $('fin-alias-form');
        if (formAlias) formAlias.addEventListener('submit', onSubmitAlias);
        // Bouton bulk-from-prefix
        const btnBulkScan = $('fin-alias-bulk-scan');
        if (btnBulkScan) btnBulkScan.addEventListener('click', onBulkScanAlias);

        // Defaut periode: 1er du mois -> aujourd'hui
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const firstOfMonth = `${yyyy}-${mm}-01`;
        const todayISO = `${yyyy}-${mm}-${dd}`;
        if ($('fin-creances-date-debut') && !$('fin-creances-date-debut').value) {
            $('fin-creances-date-debut').value = firstOfMonth;
        }
        if ($('fin-creances-date-fin') && !$('fin-creances-date-fin').value) {
            $('fin-creances-date-fin').value = todayISO;
        }
        // Defaut PV: cumul "tous". Si user a un PV unique, on s'aligne dessus.
        try {
            const u = window.currentUser;
            if (u && u.pointVente && u.pointVente !== 'tous'
                && !Array.isArray(u.pointVente) && $('fin-creances-pv')) {
                const opt = Array.from($('fin-creances-pv').options).find(o => o.value === u.pointVente);
                if (opt) $('fin-creances-pv').value = u.pointVente;
            }
        } catch (_) { /* no-op */ }

        // Pre-fill date paiement = aujourd'hui
        const paiementDateInput = document.querySelector('#fin-paiement-form input[name="date"]');
        if (paiementDateInput && !paiementDateInput.value) paiementDateInput.value = todayISO;

        // Listeners
        const btnRefresh = $('fin-creances-refresh');
        if (btnRefresh) btnRefresh.addEventListener('click', loadAll);

        const pvSelect = $('fin-creances-pv');
        if (pvSelect) pvSelect.addEventListener('change', loadAll);

        const formPaiement = $('fin-paiement-form');
        if (formPaiement) formPaiement.addEventListener('submit', onSubmitPaiement);

        // Bouton "Voir tout le detail" (drill-down toutes ventes confondues)
        const btnDetailAll = $('fin-creances-detail-all');
        if (btnDetailAll) btnDetailAll.addEventListener('click', () => openCommissionDetail(null));

        // Charger config + donnees
        try {
            const resCfg = await fetch('/api/finance/config', { credentials: 'include' });
            if (resCfg.ok) {
                const j = await resCfg.json();
                if (j.success) _config = j.data;
            }
        } catch (_) { /* config est optionnelle, on continue */ }

        await loadAll();
    }

    // ================= LOAD =================
    async function loadAll() {
        const dateDebut = $('fin-creances-date-debut').value;
        const dateFin = $('fin-creances-date-fin').value;
        const pointVente = $('fin-creances-pv') ? $('fin-creances-pv').value : 'tous';

        const qs = new URLSearchParams({ dateDebut, dateFin, pointVente });

        try {
            const [creancesRes, paiementsRes] = await Promise.all([
                fetch('/api/finance/creances?' + qs.toString(), { credentials: 'include' }),
                fetch('/api/finance/paiements?' + qs.toString(), { credentials: 'include' })
            ]);
            const creancesJson = await creancesRes.json();
            const paiementsJson = await paiementsRes.json();

            if (!creancesJson.success) throw new Error(creancesJson.error || 'Erreur creances');
            if (!paiementsJson.success) throw new Error(paiementsJson.error || 'Erreur paiements');

            renderCdb(creancesJson.data);
            renderLocal(creancesJson.data.local);
            renderPaiements(paiementsJson.data);
        } catch (e) {
            console.error('[finance] loadAll:', e);
            const status = $('fin-cdb-status');
            if (status) {
                status.textContent = 'Erreur';
                status.className = 'badge bg-danger ms-2';
            }
        }
    }

    // ================= RENDER A: MataBanq =================
    // Affiche pour chaque label MataBanq:
    //   - 4 KPI cards (Solde, Avances, Remb, delta vs veille)
    //   - une table des operations (avance / remboursement)
    // Plus un cumul global tout en haut si plusieurs labels.
    function renderCdb(data) {
        const status = $('fin-cdb-status');
        const totalBadge = $('fin-cre-acc-cdb-total');
        const summary = $('fin-cdb-summary');
        const byLabel = $('fin-cdb-by-label');
        if (!summary || !byLabel) return;

        summary.innerHTML = '';
        byLabel.innerHTML = '';

        const cdb = data.cdb;
        const perLabel = data.cdb_per_label || {};
        const labels = Object.keys(perLabel);

        // Cas 1: feature desactivee (env vars manquantes)
        if (cdb && cdb._disabled) {
            status.textContent = 'Désactivé';
            status.className = 'badge bg-secondary ms-2';
            totalBadge.textContent = '';
            byLabel.innerHTML = `<div class="alert alert-secondary small mb-0">${esc(cdb._reason || 'Configuration MataBanq manquante')}</div>`;
            return;
        }

        // Cas 2: aucun label fetché (PV inconnu)
        if (labels.length === 0) {
            status.textContent = 'Aucun label';
            status.className = 'badge bg-secondary ms-2';
            totalBadge.textContent = '';
            byLabel.innerHTML = `<div class="alert alert-secondary small mb-0">Le point de vente sélectionné n'a pas de label MataBanq mappé.</div>`;
            return;
        }

        // Extraire les blocs status / operations / summary par label
        const perLabelExtracted = labels.map((label) => {
            const payload = perLabel[label];
            if (!payload || payload._disabled || payload._error) {
                return { label, payload, error: payload && (payload._reason || payload._error) };
            }
            const detail = (payload.details && payload.details[0]) || null;
            const clientStatus = (detail && detail.status && detail.status[0]) || null;
            const operations = (detail && detail.operations) || [];
            const sum = payload.summary || null;
            const director = (detail && detail.assigned_director) || '—';
            return {
                label, payload, detail, clientStatus, operations,
                summary: sum, director,
                solde: clientStatus ? parseFloat(clientStatus.solde_final) || 0
                       : (sum ? parseFloat(sum.totals.current_balance) || 0 : 0),
                avances: clientStatus ? parseFloat(clientStatus.total_avances) || 0 : 0,
                remboursements: clientStatus ? parseFloat(clientStatus.total_remboursements) || 0 : 0,
                diff: sum ? parseFloat(sum.totals.total_difference) || 0 : 0,
                dateSelected: sum ? sum.date_selected : ''
            };
        });

        // Cas 3: aucun label a renvoye de donnee exploitable
        const validLabels = perLabelExtracted.filter(e => !e.error);
        if (validLabels.length === 0) {
            status.textContent = 'Indisponible';
            status.className = 'badge bg-warning text-dark ms-2';
            totalBadge.textContent = '';
            const errMsgs = perLabelExtracted.map(e => `<li><code>${esc(e.label)}</code>: ${esc(e.error || 'no data')}</li>`).join('');
            byLabel.innerHTML = `<div class="alert alert-warning small mb-0">Aucune donnée MataBanq exploitable.<ul class="mb-0 mt-2">${errMsgs}</ul></div>`;
            return;
        }

        status.textContent = 'OK';
        status.className = 'badge bg-success ms-2';

        // Cumul global (somme des labels valides)
        const sumSolde = validLabels.reduce((s, e) => s + e.solde, 0);
        const sumAvances = validLabels.reduce((s, e) => s + e.avances, 0);
        const sumRemb = validLabels.reduce((s, e) => s + e.remboursements, 0);
        const sumDiff = validLabels.reduce((s, e) => s + e.diff, 0);
        totalBadge.textContent = 'Solde ' + fmt(sumSolde);

        // KPI cards agreges
        const diffSign = sumDiff > 0 ? '+' : '';
        const trendCls = sumDiff > 0 ? 'text-danger' : sumDiff < 0 ? 'text-success' : 'text-muted';
        const trendIcon = sumDiff > 0 ? 'arrow-up-right' : sumDiff < 0 ? 'arrow-down-right' : 'dash';
        const trendLabel = sumDiff === 0 ? 'Inchangé vs veille' : `${diffSign}${fmt(sumDiff)} vs veille`;

        const kpiCard = (tone, icon, label, value, sub = '') => `
            <div class="col-md-3">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body py-2 px-3">
                        <div class="d-flex align-items-start gap-2">
                            <i class="bi bi-${icon} text-${tone}"></i>
                            <div class="flex-grow-1">
                                <div class="small text-muted">${esc(label)}</div>
                                <div class="fw-bold text-${tone}">${value}</div>
                                ${sub ? `<div class="small mt-1">${sub}</div>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

        summary.innerHTML = [
            kpiCard('warning', 'cash-stack',        'Solde dû au fournisseur', fmt(sumSolde),
                `<span class="${trendCls}"><i class="bi bi-${trendIcon} me-1"></i>${esc(trendLabel)}</span>`),
            kpiCard('danger',  'arrow-down-circle', 'Total avances',           fmt(sumAvances)),
            kpiCard('success', 'arrow-up-circle',   'Total remboursements',    fmt(sumRemb)),
            kpiCard('info',    'graph-up',          'Δ vs veille',             diffSign + fmt(Math.abs(sumDiff)))
        ].join('');

        // Detail par label
        validLabels.forEach((e) => {
            // Operations triees desc (timestamp ou date_operation)
            const opsSorted = e.operations.slice().sort((a, b) => {
                const ta = a.timestamp || a.date_operation || '';
                const tb = b.timestamp || b.date_operation || '';
                return tb.localeCompare(ta);
            });

            const operationsHtml = opsSorted.length === 0
                ? `<tr><td colspan="5" class="text-muted text-center small">Aucune opération sur la période</td></tr>`
                : opsSorted.map((op) => {
                    const isAvance = String(op.type).toLowerCase() === 'avance';
                    const badge = isAvance
                        ? '<span class="badge bg-danger-subtle text-danger border border-danger-subtle"><i class="bi bi-arrow-down-right me-1"></i>Avance</span>'
                        : '<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-arrow-up-right me-1"></i>Remboursement</span>';
                    return `
                        <tr>
                            <td class="small">${esc(op.date_operation || '')}</td>
                            <td>${badge}</td>
                            <td class="text-end fw-semibold">${esc(fmt(op.montant))}</td>
                            <td class="small">${esc(op.description || '')}</td>
                            <td class="small text-muted">${esc(op.created_by || '')}</td>
                        </tr>
                    `;
                }).join('');

            // Card par label
            const section = document.createElement('div');
            section.className = 'card border-0 shadow-sm mb-3';
            section.innerHTML = `
                <div class="card-header bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                        <i class="bi bi-bank me-1"></i>
                        <strong>${esc(e.label)}</strong>
                        <span class="small text-muted ms-2">${esc(e.dateSelected)} · Resp: ${esc(e.director)}</span>
                    </div>
                    <span class="badge bg-warning text-dark">Solde ${esc(fmt(e.solde))}</span>
                </div>
                <div class="card-body py-2 px-3">
                    <div class="row g-2 mb-2 small">
                        <div class="col-md-3"><span class="text-muted">Avances:</span> <strong class="text-danger">${esc(fmt(e.avances))}</strong></div>
                        <div class="col-md-3"><span class="text-muted">Remboursements:</span> <strong class="text-success">${esc(fmt(e.remboursements))}</strong></div>
                        <div class="col-md-3"><span class="text-muted">Solde final:</span> <strong>${esc(fmt(e.solde))}</strong></div>
                        <div class="col-md-3"><span class="text-muted">Δ vs veille:</span> <strong class="${e.diff > 0 ? 'text-danger' : e.diff < 0 ? 'text-success' : ''}">${e.diff > 0 ? '+' : ''}${esc(fmt(e.diff))}</strong></div>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-striped mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th class="text-end">Montant</th>
                                    <th>Description</th>
                                    <th>Saisie par</th>
                                </tr>
                            </thead>
                            <tbody>${operationsHtml}</tbody>
                        </table>
                    </div>
                </div>
            `;
            byLabel.appendChild(section);
        });

        // Labels en erreur (affiche en bas si presents)
        const errored = perLabelExtracted.filter(e => e.error);
        if (errored.length > 0) {
            const errSection = document.createElement('div');
            errSection.className = 'alert alert-warning small mb-0';
            errSection.innerHTML = `Labels en erreur:<ul class="mb-0 mt-1">${errored.map(e => `<li><code>${esc(e.label)}</code>: ${esc(e.error)}</li>`).join('')}</ul>`;
            byLabel.appendChild(errSection);
        }
    }

    // Reference au dernier `local` recu (utilise par le drill-down "Voir tout")
    let _lastLocal = null;

    // Ouvre la modale de drill-down commission. Si `produitFilter` est
    // fourni, on filtre sur cette ligne; sinon on affiche tout.
    function openCommissionDetail(produitFilter) {
        if (!_lastLocal) return;
        const modal = document.getElementById('fin-commission-detail-modal');
        if (!modal) return;
        const tbody = document.querySelector('#fin-commission-detail-table tbody');
        const titleBadge = document.getElementById('fin-commission-detail-title-badge');
        const footQte = document.getElementById('fin-commission-detail-foot-qte');
        const footComm = document.getElementById('fin-commission-detail-foot-comm');

        let ventes = [];
        const details = _lastLocal.detail || [];
        if (produitFilter) {
            const row = details.find(d => d.produit === produitFilter);
            ventes = row ? (row.ventes || []).map(v => ({ ...v, catalog: produitFilter })) : [];
            titleBadge.textContent = produitFilter + ' — ' + fmt(row ? row.dette : 0);
        } else {
            // Cumul: toutes les ventes de tous les produits catalogue
            for (const d of details) {
                for (const v of (d.ventes || [])) {
                    ventes.push({ ...v, catalog: d.produit });
                }
            }
            // Tri global desc par date
            ventes.sort((a, b) => String(b.date).localeCompare(String(a.date)));
            titleBadge.textContent = 'Total — ' + fmt(_lastLocal.ce_que_je_dois);
        }

        tbody.innerHTML = '';
        if (ventes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-muted small text-center">Aucune vente individuelle.</td></tr>`;
        } else {
            let totalQte = 0, totalComm = 0;
            for (const v of ventes) {
                totalQte += v.nombre || 0;
                totalComm += v.commission || 0;
                let statutBadge = '';
                if (v.statut === 'alias') statutBadge = ' <span class="badge bg-info-subtle text-info small">alias</span>';
                else if (v.statut === 'prefix') statutBadge = ' <span class="badge bg-warning-subtle text-warning small">prefix</span>';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="small">${esc(v.date)}</td>
                    <td class="small">${esc(v.point_vente || '—')}</td>
                    <td class="small"><code>${esc(v.produit_vente)}</code>${statutBadge}</td>
                    <td class="small"><strong>${esc(v.catalog)}</strong></td>
                    <td class="text-end small">${new Intl.NumberFormat('fr-FR').format(v.nombre)}</td>
                    <td class="text-end small">${fmt(v.prix_vente_eff)}</td>
                    <td class="text-end fw-semibold">${fmt(v.commission)}</td>
                `;
                tbody.appendChild(tr);
            }
            footQte.textContent = new Intl.NumberFormat('fr-FR').format(Math.round(totalQte * 100) / 100);
            footComm.textContent = fmt(totalComm);
        }

        // Bootstrap 5: bs.Modal API
        if (window.bootstrap && window.bootstrap.Modal) {
            const bsModal = window.bootstrap.Modal.getOrCreateInstance(modal);
            bsModal.show();
        }
    }

    // ================= RENDER B: Calcul Maas =================
    function renderLocal(local) {
        _lastLocal = local;
        const cardsContainer = $('fin-creances-cards');
        const tbody = document.querySelector('#fin-creances-detail tbody');
        const totalBadge = $('fin-cre-acc-maas-total');
        if (!cardsContainer || !tbody) return;

        cardsContainer.innerHTML = '';
        tbody.innerHTML = '';

        if (!local) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-muted small">Aucune donnée</td></tr>`;
            totalBadge.textContent = '';
            return;
        }

        // Cards KPI
        const card = (label, value, color) => `
            <div class="col-md-3">
                <div class="card border-0 shadow-sm">
                    <div class="card-body py-2 px-3">
                        <div class="small text-muted">${esc(label)}</div>
                        <div class="fw-bold ${color}">${fmt(value)}</div>
                    </div>
                </div>
            </div>`;
        cardsContainer.innerHTML = [
            card('Je dois (3%)', local.ce_que_je_dois, 'text-warning'),
            card('Paiements effectués', local.paiements_effectues, 'text-info'),
            card('Reste à payer', local.reste_a_payer, 'text-danger'),
            `<div class="col-md-3">
                <div class="card border-0 shadow-sm">
                    <div class="card-body py-2 px-3">
                        <div class="small text-muted">Période / PV</div>
                        <div class="fw-bold">${esc(local.periode.dateDebut)} → ${esc(local.periode.dateFin)}</div>
                        <div class="small text-muted">${esc(local.point_vente)}</div>
                    </div>
                </div>
            </div>`
        ].join('');

        // Bandeau diagnostic: catalog vide ou ventes non resolues.
        // (Pas un blocage, juste un avertissement pour aider a debugger
        // la config /api/finance/prix + /api/finance/alias.)
        const warnSlot = document.createElement('div');
        warnSlot.className = 'col-12';
        const warnings = [];
        if (local.catalog_size === 0) {
            warnings.push(`<i class="bi bi-exclamation-triangle text-warning me-1"></i>Le catalogue <code>fournisseur_prix</code> est vide → toutes les ventes sont ignorées. Popüle via <code>PUT /api/finance/prix</code>.`);
        }
        if (local.ventes_non_resolues > 0) {
            warnings.push(`<i class="bi bi-info-circle text-info me-1"></i><strong>${local.ventes_non_resolues}</strong> ventes (qte ${local.quantite_non_resolue}) non résolues sur la période (produit absent du catalogue + sans alias). Ces ventes sont exclues du calcul 3%.`);
        }
        if (warnings.length > 0) {
            warnSlot.innerHTML = `<div class="alert alert-light border small mb-0 mt-2">${warnings.join('<br>')}</div>`;
            cardsContainer.appendChild(warnSlot);
        }

        totalBadge.textContent = 'Je dois: ' + fmt(local.ce_que_je_dois);

        // Detail produits (agreges par entree catalogue resolue)
        const detail = local.detail || [];
        if (detail.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-muted small">Aucune vente éligible avec un produit catalogue résolu sur la période.</td></tr>`;
            return;
        }
        for (const d of detail) {
            const tr = document.createElement('tr');
            // Statut badge: exact / alias / prefix
            let statutBadge = '';
            if (d.statut === 'exact') statutBadge = '<span class="badge bg-success ms-1" title="Match exact catalogue">exact</span>';
            else if (d.statut === 'alias') statutBadge = '<span class="badge bg-info ms-1" title="Resolu via alias">alias</span>';
            else if (d.statut === 'prefix') statutBadge = '<span class="badge bg-warning text-dark ms-1" title="Match prefix (legacy)">prefix</span>';

            // Tooltip avec libelles vente originaux si different du nom catalogue
            const originaux = Array.isArray(d.produit_vente_originaux) ? d.produit_vente_originaux : [];
            const sublabel = originaux.length > 0 && !(originaux.length === 1 && originaux[0] === d.produit)
                ? `<div class="small text-muted">${originaux.map(esc).join(', ')}</div>`
                : '';

            const nbVentes = Array.isArray(d.ventes) ? d.ventes.length : 0;
            tr.innerHTML = `
                <td>
                    <strong>${esc(d.produit)}</strong>${statutBadge}
                    ${sublabel}
                </td>
                <td class="text-end">${new Intl.NumberFormat('fr-FR').format(d.quantite)}</td>
                <td class="text-end">${fmt(d.dette)}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-secondary" data-commission-detail="${esc(d.produit)}" title="Voir les ${nbVentes} vente(s) qui composent ${fmt(d.dette)}">
                        <i class="bi bi-zoom-in"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        }
        // Listeners drill-down par ligne
        tbody.querySelectorAll('button[data-commission-detail]').forEach(btn => {
            btn.addEventListener('click', () => openCommissionDetail(btn.getAttribute('data-commission-detail')));
        });
    }

    // ================= RENDER C: Paiements =================
    function renderPaiements(rows) {
        const tbody = document.querySelector('#fin-paiements-list tbody');
        const totalBadge = $('fin-cre-acc-paiements-total');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!rows || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-muted small">Aucun paiement enregistré sur la période.</td></tr>`;
            if (totalBadge) totalBadge.textContent = '0';
            return;
        }

        let total = 0;
        for (const p of rows) {
            const mt = parseFloat(p.montant) || 0;
            total += mt;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${esc(p.date)}</td>
                <td class="text-end">${fmt(mt)}</td>
                <td>${esc(p.mode || '—')}</td>
                <td>${esc(p.reference || '')}</td>
                <td>${esc(p.point_vente || '—')}</td>
                <td>${esc(p.commentaire || '')}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-danger" data-paiement-id="${p.id}" title="Supprimer">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        }
        if (totalBadge) totalBadge.textContent = 'Total: ' + fmt(total);

        // Listeners suppression
        tbody.querySelectorAll('button[data-paiement-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-paiement-id');
                if (!confirm('Supprimer ce paiement ?')) return;
                try {
                    const res = await fetch('/api/finance/paiements/' + id, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Suppression refusée');
                    await loadAll();
                } catch (e) {
                    alert('Erreur: ' + e.message);
                }
            });
        });
    }

    // ================= SUBMIT PAIEMENT =================
    async function onSubmitPaiement(e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const payload = {
            date: fd.get('date'),
            montant: parseFloat(fd.get('montant')),
            mode: fd.get('mode') || null,
            reference: fd.get('reference') || null,
            commentaire: fd.get('commentaire') || null,
            pointVente: fd.get('pointVente') || null
        };
        if (!payload.date || !payload.montant || payload.montant <= 0) {
            alert('Date et montant > 0 sont requis.');
            return;
        }
        try {
            const res = await fetch('/api/finance/paiements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Création refusée');
            // Reset montant + ref + commentaire (on garde date et mode)
            form.querySelector('input[name="montant"]').value = '';
            form.querySelector('input[name="reference"]').value = '';
            form.querySelector('input[name="commentaire"]').value = '';
            await loadAll();
        } catch (e) {
            alert('Erreur: ' + e.message);
        }
    }

    // ================= PRIX FOURNISSEUR (catalogue) =================
    async function loadPrix() {
        const tbody = document.querySelector('#fin-prix-list tbody');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted small">Chargement…</td></tr>`;
        try {
            const res = await fetch('/api/finance/prix', { credentials: 'include' });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur catalogue');
            renderPrix(j.data);
            // Refill le datalist du select alias (produit_catalog)
            const selAlias = document.querySelector('#fin-alias-form select[name="produit_catalog"]');
            if (selAlias) {
                const current = selAlias.value;
                selAlias.innerHTML = '<option value="">— sélectionner —</option>' +
                    j.data.map(r => `<option value="${esc(r.produit)}">${esc(r.produit)}</option>`).join('');
                if (current) selAlias.value = current;
            }
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-danger small">${esc(e.message)}</td></tr>`;
        }
    }

    function renderPrix(rows) {
        const tbody = document.querySelector('#fin-prix-list tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!rows || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-muted small">Catalogue vide. Ajoute un premier produit ci-dessous.</td></tr>`;
            return;
        }
        for (const r of rows) {
            const tr = document.createElement('tr');
            const updated = r.updated_at ? new Date(r.updated_at).toLocaleString('fr-FR') : '—';
            tr.innerHTML = `
                <td><strong>${esc(r.produit)}</strong></td>
                <td class="text-end">${fmt(r.prix_vente)}</td>
                <td class="text-end">${r.prix_achat == null ? '—' : fmt(r.prix_achat)}</td>
                <td class="small text-muted">${esc(updated)}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-secondary me-1" data-prix-edit="${esc(r.produit)}" title="Editer">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" data-prix-del="${esc(r.produit)}" title="Supprimer">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        }
        // Listeners edit (re-fill form)
        tbody.querySelectorAll('button[data-prix-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                const produit = btn.getAttribute('data-prix-edit');
                const r = rows.find(x => x.produit === produit);
                if (!r) return;
                const f = $('fin-prix-form');
                f.querySelector('input[name="produit"]').value = r.produit;
                f.querySelector('input[name="prix_vente"]').value = r.prix_vente;
                f.querySelector('input[name="prix_achat"]').value = r.prix_achat == null ? '' : r.prix_achat;
            });
        });
        // Listeners delete
        tbody.querySelectorAll('button[data-prix-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const produit = btn.getAttribute('data-prix-del');
                if (!confirm(`Supprimer "${produit}" du catalogue ?\n\nLes ventes existantes pour ce produit ne seront plus comptees dans la commission.`)) return;
                try {
                    const res = await fetch('/api/finance/prix/' + encodeURIComponent(produit), {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Suppression refusee');
                    await loadPrix();
                    // Re-calcul si la pane Creances est visible
                    await loadAll();
                } catch (e) {
                    alert('Erreur: ' + e.message);
                }
            });
        });
    }

    async function onSubmitPrix(e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const payload = {
            produit: (fd.get('produit') || '').trim(),
            prix_vente: parseFloat(fd.get('prix_vente')),
            prix_achat: fd.get('prix_achat') ? parseFloat(fd.get('prix_achat')) : null
        };
        if (!payload.produit || !Number.isFinite(payload.prix_vente) || payload.prix_vente < 0) {
            alert('Produit et prix_vente >= 0 sont requis.');
            return;
        }
        try {
            const res = await fetch('/api/finance/prix', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Enregistrement refuse');
            form.reset();
            await loadPrix();
            // Recalcul possible si Creances visible
            await loadAll();
        } catch (e) {
            alert('Erreur: ' + e.message);
        }
    }

    // ================= ALIASES PRODUITS =================
    async function loadAlias() {
        const tbody = document.querySelector('#fin-alias-list tbody');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="4" class="text-muted small">Chargement…</td></tr>`;
        try {
            // S'assurer que le select produit_catalog est rempli
            await loadPrix();
            const res = await fetch('/api/finance/alias', { credentials: 'include' });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur aliases');
            renderAlias(j.data);
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-danger small">${esc(e.message)}</td></tr>`;
        }
    }

    function renderAlias(rows) {
        const tbody = document.querySelector('#fin-alias-list tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!rows || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-muted small">Aucun alias defini.</td></tr>`;
            return;
        }
        for (const r of rows) {
            const tr = document.createElement('tr');
            const updated = r.updated_at ? new Date(r.updated_at).toLocaleString('fr-FR') : '—';
            tr.innerHTML = `
                <td><code>${esc(r.alias_produit)}</code></td>
                <td><strong>${esc(r.produit_catalog)}</strong></td>
                <td class="small text-muted">${esc(updated)}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-danger" data-alias-del="${esc(r.alias_produit)}" title="Supprimer">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        }
        tbody.querySelectorAll('button[data-alias-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const alias = btn.getAttribute('data-alias-del');
                if (!confirm(`Supprimer l'alias "${alias}" ?`)) return;
                try {
                    const res = await fetch('/api/finance/alias/' + encodeURIComponent(alias), {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Suppression refusee');
                    await loadAlias();
                    await loadAll();
                } catch (e) {
                    alert('Erreur: ' + e.message);
                }
            });
        });
    }

    async function onSubmitAlias(e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const payload = {
            alias_produit: (fd.get('alias_produit') || '').trim(),
            produit_catalog: (fd.get('produit_catalog') || '').trim()
        };
        if (!payload.alias_produit || !payload.produit_catalog) {
            alert('Alias et produit catalogue sont requis.');
            return;
        }
        try {
            const res = await fetch('/api/finance/alias', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Enregistrement refuse');
            form.reset();
            await loadAlias();
            await loadAll();
        } catch (e) {
            alert('Erreur: ' + e.message);
        }
    }

    // ================= BULK SCAN ALIASES =================
    async function onBulkScanAlias() {
        const btn = $('fin-alias-bulk-scan');
        if (!confirm('Scanner les ventes des 90 derniers jours et créer un alias pour chaque libellé résolu en fallback prefix ?\n\nIdempotent : les aliases existants ne sont pas écrasés.')) return;
        const oldHtml = btn ? btn.innerHTML : null;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Scan...';
        }
        try {
            const res = await fetch('/api/finance/alias/bulk-from-prefix', {
                method: 'POST',
                credentials: 'include'
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Scan refusé');
            alert(`Scan terminé : ${j.count} alias créé(s) / mis à jour.\n\n${j.created.length === 0 ? 'Aucun libellé en fallback prefix trouvé.' : j.created.slice(0, 10).map(a => `• ${a.alias_produit} → ${a.produit_catalog}`).join('\n') + (j.created.length > 10 ? `\n... et ${j.created.length - 10} de plus` : '')}`);
            await loadAlias();
            await loadAll();
        } catch (e) {
            alert('Erreur: ' + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                if (oldHtml) btn.innerHTML = oldHtml;
            }
        }
    }

    // ================= EXPORT =================
    window.FinanceUI = { init };
})();
