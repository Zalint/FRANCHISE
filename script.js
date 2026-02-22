// Démarrage du script

// Variables globales pour les points de vente (déclarées en premier pour éviter les erreurs de temporal dead zone)
var POINTS_VENTE_PHYSIQUES = [];

document.addEventListener('DOMContentLoaded', function() {
    // Vérifier si le gestionnaire de réconciliation est disponible
    if (typeof ReconciliationManager === 'undefined') {
        console.error('ReconciliationManager non disponible! Assurez-vous que reconciliationManager.js est chargé avant script.js.');
        alert('Erreur: Module de réconciliation non chargé. Veuillez recharger la page.');
        return;
    }
    
    console.log('Initialisation de l\'application avec ReconciliationManager');
    
    // Initialiser les contrôles Proxy Marges
    initialiserControlesProxyMarges();
    
    // Initialiser les tooltips Bootstrap
    initializeTooltips();
    
    // Surcharger la fonction afficherReconciliation pour utiliser ReconciliationManager
    window.afficherReconciliation = function(reconciliation, debugInfo) {
        console.log('Délégation à ReconciliationManager.afficherReconciliation');
        ReconciliationManager.afficherReconciliation(reconciliation, debugInfo);
    };

    // Ensure proper initial state - hide all sections and show saisie section
    console.log('Initial page load - hiding all sections');
    hideAllSections();
    document.getElementById('saisie-section').style.display = 'block';
    console.log('Initial page load - showing saisie section');

    // Initialize all sections
    initTabListeners();
    // initEstimation(); // Function moved to public/js/estimation.js
    initReconciliation();
    initStockAlerte();
    initReconciliationMensuelle();
    initCopierStock();
    initInventaire();
    initFilterStock();
});

// Fonction pour initialiser les tooltips Bootstrap
function initializeTooltips() {
    try {
        // Initialiser tous les tooltips Bootstrap sur la page
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
        console.log(`📊 ${tooltipTriggerList.length} tooltips initialisés`);
    } catch (error) {
        console.warn('Erreur lors de l\'initialisation des tooltips:', error);
    }
}

// Fonction pour mettre à jour les champs "Ratios de Perte (Éditables)" avec les valeurs calculées
function mettreAJourRatiosEditables(ratioBoeuf, ratioVeau) {
    try {
        console.log(`🔄 Mise à jour des champs ratios éditables:`);
        console.log(`   - Boeuf: ${ratioBoeuf !== null ? (ratioBoeuf * 100).toFixed(2) + '%' : 'non calculé'}`);
        console.log(`   - Veau: ${ratioVeau !== null ? (ratioVeau * 100).toFixed(2) + '%' : 'non calculé'}`);
        
        // Récupérer les champs de ratio
        const ratioBoeufInput = document.getElementById('ratio-perte-boeuf');
        const ratioVeauInput = document.getElementById('ratio-perte-veau');
        
        if (ratioBoeufInput && ratioBoeuf !== null && ratioBoeuf !== undefined) {
            const nouveauRatioBoeuf = ratioBoeuf * 100; // Convertir en pourcentage en préservant le signe
            ratioBoeufInput.value = nouveauRatioBoeuf.toFixed(1);
            console.log(`✅ Ratio Boeuf mis à jour: ${nouveauRatioBoeuf.toFixed(1)}%`);
            
            // Mettre à jour la variable globale des contrôles (préserver le signe pour les calculs)
            proxyMargesControls.ratioPerteBoeuf = nouveauRatioBoeuf; // CORRIGÉ: garder le signe
        }
        
        if (ratioVeauInput && ratioVeau !== null && ratioVeau !== undefined) {
            const nouveauRatioVeau = ratioVeau * 100; // Convertir en pourcentage en préservant le signe
            ratioVeauInput.value = nouveauRatioVeau.toFixed(1);
            console.log(`✅ Ratio Veau mis à jour: ${nouveauRatioVeau.toFixed(1)}%`);
            
            // Mettre à jour la variable globale des contrôles (préserver le signe pour les calculs)
            proxyMargesControls.ratioPerteVeau = nouveauRatioVeau; // CORRIGÉ: garder le signe
        }
        
        if ((ratioBoeuf !== null && ratioBoeuf !== undefined) || (ratioVeau !== null && ratioVeau !== undefined)) {
            console.log(`🎯 Champs ratios éditables mis à jour avec les valeurs calculées (restent éditables)`);
        } else {
            console.log(`⚠️ Aucun ratio à mettre à jour`);
        }
        
    } catch (error) {
        console.warn('Erreur lors de la mise à jour des ratios éditables:', error);
    }
}

// Vérification de l'authentification
let currentUser = null;

// Variables globales
let donneesImportees = {
    matin: new Map(),
    soir: new Map(),
    transferts: []
};

// Variable pour activer/désactiver le mode débogage
const isDebugMode = true;

// Cache pour les données de réconciliation mensuelle
const reconciliationCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes en millisecondes

// Fonctions pour gérer le spinner de chargement
function showLoadingSpinner() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('show');
    }
}

function hideLoadingSpinner() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.remove('show');
    }
}

// Fonction pour obtenir le nom d'affichage du rôle utilisateur
function getUserRoleDisplayName(user) {
    if (!user || !user.role) {
        return 'Inconnu';
    }
    
    switch (user.role) {
        case 'admin':
            return 'Administrateur';
        case 'superviseur':
            return 'Superviseur';
        case 'superutilisateur':
            return 'SuperUtilisateur';
        case 'user':
            return 'Utilisateur';
        case 'lecteur':
            return 'Lecteur';
        default:
            return user.role;
    }
}

// Les points de vente sont maintenant gérés depuis la base de données
// Ce mapping n'est plus nécessaire - les noms sont standardisés dans la BDD
const MAPPING_POINTS_VENTE = {};

// Mapping pour standardiser les noms des produits
const MAPPING_PRODUITS = {
    'BOEUF': 'Boeuf',
    'VEAU': 'Veau',
    'POULET': 'Poulet',
    'TETE DE MOUTON': 'Tete De Mouton',
    'TABLETTE': 'Tablette',
    'FOIE': 'Foie',
    'YELL': 'Yell',
    'AGNEAU': 'Agneau'
};

// Fonction globale pour formater les dates d'affichage (DD/MM/YYYY)
function formaterDateAffichage(dateInput) {
    if (!dateInput) return '';
    
    // Si c'est un objet Date, utiliser la fonction existante
    if (dateInput instanceof Date) {
        return formatDateForStockAlerte(dateInput);
    }
    
    // Si c'est une chaîne, la convertir d'abord
    if (typeof dateInput === 'string') {
        let jour, mois, annee;
        
        if (dateInput.includes('/')) {
            [jour, mois, annee] = dateInput.split('/');
            // S'assurer que l'année est sur 4 chiffres
            if (annee.length === 2) {
                annee = '20' + annee;
            }
            return `${jour}/${mois}/${annee}`;
        } else if (dateInput.includes('-')) {
            const parts = dateInput.split('-');
            if (parts.length === 3) {
                // Si c'est au format YYYY-MM-DD, réorganiser en DD/MM/YYYY
                if (parts[0].length === 4) {
                    return `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
                // Si c'est au format DD-MM-YYYY, convertir en DD/MM/YYYY
                return `${parts[0]}/${parts[1]}/${parts[2]}`;
            }
        }
    }
    return dateInput;
}

// Fonction globale pour standardiser les dates
function standardiserDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        // console.warn(`[standardiserDate] Invalid input: '${dateStr}'`);
        return null;
    }

    let jour, mois, annee;

    // Regex pour YYYY-MM-DD
    const ymdRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    const ymdMatch = dateStr.match(ymdRegex);

    if (ymdMatch) {
        annee = parseInt(ymdMatch[1], 10);
        mois = parseInt(ymdMatch[2], 10) - 1; // Mois est 0-indexé en JS
        jour = parseInt(ymdMatch[3], 10);
    } else if (dateStr.includes('/')) { // Format DD/MM/YYYY ou DD/MM/YY
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            jour = parseInt(parts[0], 10);
            mois = parseInt(parts[1], 10) - 1; // Mois est 0-indexé
            annee = parseInt(parts[2], 10);
            if (parts[2].length === 2) {
                annee += 2000; // Convertir YY en YYYY (ex: 24 -> 2024)
            }
        } else {
            // console.warn(`[standardiserDate] Invalid D/M/Y format: '${dateStr}'`);
            return null;
        }
    } else if (dateStr.includes('-')) { // Format DD-MM-YYYY ou DD-MM-YY (après YYYY-MM-DD)
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            jour = parseInt(parts[0], 10);
            mois = parseInt(parts[1], 10) - 1; // Mois est 0-indexé
            annee = parseInt(parts[2], 10);
            if (parts[2].length === 2) {
                annee += 2000; // Convertir YY en YYYY
            }
        } else {
            // console.warn(`[standardiserDate] Invalid D-M-Y format: '${dateStr}'`);
            return null;
        }
    } else {
        // console.warn(`[standardiserDate] Unrecognized date format: '${dateStr}'`);
        return null; // Format non reconnu
    }

    if (isNaN(jour) || isNaN(mois) || isNaN(annee) || annee < 1900 || annee > 2100 || mois < 0 || mois > 11 || jour < 1 || jour > 31) {
        // console.warn(`[standardiserDate] Invalid date components for input: '${dateStr}' -> j:${jour}, m:${mois + 1}, a:${annee}`);
        return null;
    }
    
    const dateObj = new Date(annee, mois, jour);
    // Vérifier si la date construite est valide et correspond aux entrées (évite les dépassements comme 31/02)
    if (dateObj.getFullYear() === annee && dateObj.getMonth() === mois && dateObj.getDate() === jour) {
        return dateObj;
    }
    // console.warn(`[standardiserDate] Constructed date mismatch for input: '${dateStr}' -> j:${jour}, m:${mois + 1}, a:${annee}`);
    return null;
}

function isToday(dateStr) {
    const date = standardiserDate(dateStr);
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
}

function isYesterday(dateStr) {
    const date = standardiserDate(dateStr);
    if (!date) return false;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return date.getDate() === yesterday.getDate() &&
           date.getMonth() === yesterday.getMonth() &&
           date.getFullYear() === yesterday.getFullYear();
}

// Fonction pour mettre à jour la visibilité du bouton de vidage
function updateViderBaseButtonVisibility() {
    const viderBaseBtn = document.getElementById('vider-base');
    if (viderBaseBtn) {
        // Toujours cacher le bouton, peu importe l'utilisateur
        viderBaseBtn.style.display = 'none';
        console.log('Bouton de vidage masqué pour tous les utilisateurs');
    }
}

// Fonction pour cacher toutes les sections
function hideAllSections() {
    document.getElementById('saisie-section').style.display = 'none';
    document.getElementById('precommande-section').style.display = 'none';
    document.getElementById('visualisation-section').style.display = 'none';
    document.getElementById('import-section').style.display = 'none';
    document.getElementById('stock-inventaire-section').style.display = 'none';
    document.getElementById('copier-stock-section').style.display = 'none';
    document.getElementById('suivi-achat-boeuf-section').style.display = 'none';
    document.getElementById('reconciliation-section').style.display = 'none';
    document.getElementById('reconciliation-mois-section').style.display = 'none';
    document.getElementById('stock-alerte-section').style.display = 'none';
    document.getElementById('cash-payment-section').style.display = 'none';
    document.getElementById('estimation-section').style.display = 'none';

    // Ensure content-section elements are also hidden
    const contentSections = document.querySelectorAll('.content-section');
    console.log(`hideAllSections: Found ${contentSections.length} content-section elements to hide`);
    contentSections.forEach(el => {
        console.log(`hideAllSections: Hiding element: ${el.id}`);
        el.style.display = 'none';
    });

    // Nettoyer les graphiques lorsqu'on n'est pas dans la section visualisation
    if (ventesParMoisChart) {
        ventesParMoisChart.destroy();
        ventesParMoisChart = null;
    }
    if (ventesParProduitChart) {
        ventesParProduitChart.destroy();
        ventesParProduitChart = null;
    }
    if (ventesParCategorieChart) {
        ventesParCategorieChart.destroy();
        ventesParCategorieChart = null;
    }
}

// Fonction pour initialiser la section de réconciliation
function initReconciliation() {
    console.log('Initialisation de la section de réconciliation');
    
    // S'assurer que la section est visible
    document.getElementById('reconciliation-section').style.display = 'block';
    
    // Initialiser le sélecteur de date avec flatpickr s'il ne l'est pas déjà
    if (!document.getElementById('date-reconciliation')._flatpickr) {
        flatpickr('#date-reconciliation', {
            dateFormat: 'd/m/Y',
            locale: 'fr',
            defaultDate: new Date(),
            disableMobile: "true",
            onChange: function(selectedDates, dateStr) {
                console.log('Date sélectionnée pour la réconciliation:', dateStr);
                // Rendre le bouton de calcul plus visible après changement de date
                const btnCalculer = document.getElementById('calculer-reconciliation');
                if (btnCalculer) {
                    btnCalculer.classList.add('btn-pulse');
                    setTimeout(() => {
                        btnCalculer.classList.remove('btn-pulse');
                    }, 1500);
                }
            }
        });
    }
    
    // Peupler le filtre de point de vente s'il n'est pas déjà rempli
    const pointVenteSelect = document.getElementById('point-vente-filtre');
    if (pointVenteSelect && pointVenteSelect.options.length <= 1) {
        POINTS_VENTE_PHYSIQUES.forEach(pv => {
            const option = document.createElement('option');
            option.value = pv;
            option.textContent = pv;
            pointVenteSelect.appendChild(option);
        });
        
        // Ajouter un écouteur d'événement au filtre pour réactualiser l'affichage
        pointVenteSelect.addEventListener('change', function() {
            if (window.currentReconciliation) {
                afficherReconciliation(window.currentReconciliation.data, window.currentDebugInfo || {});
            }
        });
    }
    
    // S'assurer que l'indicateur de chargement est masqué
    const loadingIndicator = document.getElementById('loading-indicator-reconciliation');
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
    
    // Vérifier si une date est déjà sélectionnée
    const dateInput = document.getElementById('date-reconciliation');
    if (dateInput && dateInput.value) {
        // Mettre à jour l'affichage de la date
        const dateDisplay = document.getElementById('date-reconciliation-display');
        if (dateDisplay) {
            dateDisplay.textContent = dateInput.value;
        }
    }
}

// Fonction pour vider le tableau de réconciliation quand la date change
function viderTableauReconciliation() {
    console.log('Date changée, vidage du tableau de réconciliation');
    
    // Vider le tableau des résultats
    const tbody = document.querySelector('#reconciliation-table tbody');
    if (tbody) tbody.innerHTML = '';
    
    // Vider également les détails de débogage
    const debugTitle = document.getElementById('debug-title');
    const debugFormule = document.getElementById('debug-formule');
    const debugEcart = document.getElementById('debug-ecart');
    const debugStockSection = document.getElementById('debug-stock-section');
    const debugVentesSection = document.getElementById('debug-ventes-section');
    
    if (debugTitle) debugTitle.innerHTML = '';
    if (debugFormule) debugFormule.innerHTML = '';
    if (debugEcart) debugEcart.innerHTML = '';
    if (debugStockSection) debugStockSection.innerHTML = '';
    if (debugVentesSection) debugVentesSection.innerHTML = '';
    
    // Désactiver le bouton de sauvegarde
    const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
    if (btnSauvegarder) btnSauvegarder.disabled = true;
    
    // Mettre à jour l'affichage de la date sélectionnée
    const dateStr = document.getElementById('date-reconciliation').value;
    const dateDisplay = document.getElementById('date-reconciliation-display');
    if (dateDisplay) dateDisplay.textContent = dateStr || '--/--/----';
    
    // Masquer les sections d'analyse
    const llmContainer = document.getElementById('llm-analyse-container');
    if (llmContainer) llmContainer.style.display = 'none';
    
    const deepseekContainer = document.getElementById('deepseek-analyse-container');
    if (deepseekContainer) deepseekContainer.style.display = 'none';
    
    // Réinitialiser les variables globales
    window.currentReconciliation = null;
    window.currentDebugInfo = null;
}

// Gestion des onglets
document.addEventListener('DOMContentLoaded', function() {
    const saisieTab = document.getElementById('saisie-tab');
    const visualisationTab = document.getElementById('visualisation-tab');
    const importTab = document.getElementById('import-tab');
    const stockInventaireTab = document.getElementById('stock-inventaire-tab');
    const copierStockTab = document.getElementById('copier-stock-tab');
    const reconciliationTab = document.getElementById('reconciliation-tab');
    const reconciliationMoisTab = document.getElementById('reconciliation-mois-tab');
    const stockAlerteTab = document.getElementById('stock-alerte-tab');
    const cashPaymentTab = document.getElementById('cash-payment-tab');
    const cashPaymentSection = document.getElementById('cash-payment-section');
    // Get new elements
    const suiviAchatBoeufTab = document.getElementById('suivi-achat-boeuf-tab');
    const suiviAchatBoeufSection = document.getElementById('suivi-achat-boeuf-section');
    
    const saisieSection = document.getElementById('saisie-section');
    const visualisationSection = document.getElementById('visualisation-section');
    const importSection = document.getElementById('import-section');
    const stockInventaireSection = document.getElementById('stock-inventaire-section');
    const copierStockSection = document.getElementById('copier-stock-section');
    const reconciliationSection = document.getElementById('reconciliation-section');
    const reconciliationMoisSection = document.getElementById('reconciliation-mois-section');
    const stockAlerteSection = document.getElementById('stock-alerte-section');

    // Fonction pour désactiver tous les onglets
    function deactivateAllTabs() {
        if (saisieTab) saisieTab.classList.remove('active');
        if (visualisationTab) visualisationTab.classList.remove('active');
        if (importTab) importTab.classList.remove('active');
        if (stockInventaireTab) stockInventaireTab.classList.remove('active');
        if (copierStockTab) copierStockTab.classList.remove('active');
        if (reconciliationTab) reconciliationTab.classList.remove('active');
        if (reconciliationMoisTab) reconciliationMoisTab.classList.remove('active');
        if (stockAlerteTab) stockAlerteTab.classList.remove('active');
        if (cashPaymentTab) cashPaymentTab.classList.remove('active');
        // Deactivate new tab
        if (suiviAchatBoeufTab) suiviAchatBoeufTab.classList.remove('active');
    }

    if (saisieTab) {
        saisieTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            saisieSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
            
            // S'assurer que les éléments de visualisation sont masqués
            document.querySelectorAll('.visualisation-charts, .visualisation-data, .content-section').forEach(el => {
                el.style.display = 'none';
            });
            
            // Explicitly hide reconciliation sections
            console.log('Explicitly hiding reconciliation sections');
            const reconciliationSection = document.getElementById('reconciliation-section');
            const reconciliationMoisSection = document.getElementById('reconciliation-mois-section');
            if (reconciliationSection) {
                console.log('Hiding reconciliation-section');
                reconciliationSection.style.display = 'none';
            }
            if (reconciliationMoisSection) {
                console.log('Hiding reconciliation-mois-section');
                reconciliationMoisSection.style.display = 'none';
            }
        });
    }

    if (visualisationTab) {
        visualisationTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            visualisationSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
            
            // S'assurer que les éléments de visualisation sont visibles
            document.querySelectorAll('.visualisation-charts, .visualisation-data').forEach(el => {
                el.style.display = 'block';
            });
            
            // Charger les données et créer les graphiques
            chargerVentes();
        });
    }

    if (importTab) {
        importTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            importSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
        });
    }

    if (stockInventaireTab) {
        stockInventaireTab.addEventListener('click', async function(e) {
            e.preventDefault();
            hideAllSections();
            stockInventaireSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
            await initInventaire();
        });
    }

    if (copierStockTab) {
        copierStockTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            copierStockSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
            initCopierStock();
        });
    }

    if (reconciliationTab) {
        reconciliationTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            reconciliationSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
            initReconciliation();
        });
    }

    // Add the event listener for the monthly reconciliation tab
    if (reconciliationMoisTab) {
        reconciliationMoisTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            // Assuming reconciliationMoisSection is the correct ID for the section
            if (reconciliationMoisSection) {
                reconciliationMoisSection.style.display = 'block';
            }
            deactivateAllTabs();
            this.classList.add('active');
            // Assuming initReconciliationMensuelle is the function to call
            initReconciliationMensuelle();
        });
    }

    if (stockAlerteTab) {
        stockAlerteTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            stockAlerteSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
            initStockAlerte();
        });
    }

    if (cashPaymentTab) {
        cashPaymentTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            cashPaymentSection.style.display = 'block';
            deactivateAllTabs();
            this.classList.add('active');
            
            // Charger les données de paiement
            loadCashPaymentData();
            
            // Vérifier les permissions admin pour afficher le bouton "Effacer les données"
            checkCashPaymentAdminPermissions();
            
            // Initialiser le filtre de mois avec le mois en cours
            if (typeof initMonthFilterCashPayment === 'function') {
                initMonthFilterCashPayment();
            }
            
            // Initialiser le datepicker si ce n'est pas déjà fait
            if (typeof initDatepicker === 'function') {
                initDatepicker();
            }
        });
    }

    // Gestionnaire pour le bouton de confirmation d'import
    document.getElementById('confirmImport').addEventListener('click', async function() {
        try {
            // Préparer les données pour l'envoi
            const donneesAEnvoyer = {
                matin: {},
                soir: {},
                transferts: []
            };

            // Traiter les données du matin
            for (const [key, data] of donneesImportees.matin) {
                donneesAEnvoyer.matin[key] = {
                    date: data.date,
                    "Point de Vente": data.pointVente,
                    Produit: data.produit,
                    Nombre: data.quantite.toString(),
                    PU: data.prixUnitaire.toString(),
                    Montant: data.total.toString(),
                    Commentaire: data.commentaire || ''
                };
            }

            // Traiter les données du soir
            for (const [key, data] of donneesImportees.soir) {
                donneesAEnvoyer.soir[key] = {
                    date: data.date,
                    "Point de Vente": data.pointVente,
                    Produit: data.produit,
                    Nombre: data.quantite.toString(),
                    PU: data.prixUnitaire.toString(),
                    Montant: data.total.toString(),
                    Commentaire: data.commentaire || ''
                };
            }

            // Traiter les transferts
            donneesAEnvoyer.transferts = donneesImportees.transferts.map(transfert => ({
                date: transfert.date,
                pointVente: transfert.pointVente,
                produit: transfert.produit,
                impact: transfert.impact,
                quantite: transfert.quantite,
                prixUnitaire: transfert.prixUnitaire,
                total: transfert.total,
                commentaire: transfert.commentaire || ''
            }));

            console.log('Données à envoyer:', donneesAEnvoyer);

            // Envoyer les données du matin
            if (Object.keys(donneesAEnvoyer.matin).length > 0) {
                console.log('Envoi des données du matin:', donneesAEnvoyer.matin);
                const matinResponse = await fetch('/api/stock/matin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(donneesAEnvoyer.matin)
                });
                if (!matinResponse.ok) throw new Error('Erreur lors de l\'enregistrement du stock matin');
            }

            // Envoyer les données du soir
            if (Object.keys(donneesAEnvoyer.soir).length > 0) {
                console.log('Envoi des données du soir:', donneesAEnvoyer.soir);
                const soirResponse = await fetch('/api/stock/soir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(donneesAEnvoyer.soir)
                });
                if (!soirResponse.ok) throw new Error('Erreur lors de l\'enregistrement du stock soir');
            }

            // Envoyer les transferts
            if (donneesAEnvoyer.transferts.length > 0) {
                console.log('Envoi des transferts:', donneesAEnvoyer.transferts);
                const transfertsResponse = await fetch('/api/transferts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(donneesAEnvoyer.transferts)
                });
                if (!transfertsResponse.ok) throw new Error('Erreur lors de l\'enregistrement des transferts');
            }

            // Réinitialiser l'interface
            document.getElementById('previewSection').style.display = 'none';
            document.getElementById('csv-file').value = '';
            donneesImportees = {
                matin: new Map(),
                soir: new Map(),
                transferts: []
            };

            alert('Import réussi !');
            
            // Recharger les données
            await loadStockData();
            await loadTransferts();
            
        } catch (error) {
            console.error('Erreur lors de l\'importation:', error);
            alert('Erreur lors de l\'importation : ' + error.message);
        }
    });

    // Gestionnaire pour le bouton d'annulation d'import
    document.getElementById('cancelImport').addEventListener('click', function() {
        document.getElementById('previewSection').style.display = 'none';
        document.getElementById('csv-file').value = '';
        donneesImportees = {
            matin: new Map(),
            soir: new Map(),
            transferts: []
        };
    });

    // Add listener for the new tab
    if (suiviAchatBoeufTab) {
        suiviAchatBoeufTab.addEventListener('click', function(e) {
            e.preventDefault();
            hideAllSections();
            if (suiviAchatBoeufSection) {
                 suiviAchatBoeufSection.style.display = 'block';
            }
            deactivateAllTabs();
            this.classList.add('active');
            // Call the correct initialization/load function from suiviAchatBoeuf.js
            if (typeof loadAchatsBoeuf === 'function') {
                 loadAchatsBoeuf(); // Load data when tab is clicked
            } else {
                console.error('loadAchatsBoeuf function not found! Ensure public/js/suiviAchatBoeuf.js is loaded.');
            }
        });
    }

    // Add event listener for stock export Excel button
    const exportStockExcelBtn = document.getElementById('export-stock-excel');
    if (exportStockExcelBtn) {
        exportStockExcelBtn.addEventListener('click', exportStockInventaireToExcel);
    }

    // Add event listener for visualization export Excel button
    const exportVisualisationExcelBtn = document.getElementById('export-visualisation-excel');
    if (exportVisualisationExcelBtn) {
        exportVisualisationExcelBtn.addEventListener('click', exportVisualisationToExcel);
    }
});

// Modification de la fonction checkAuth pour gérer l'affichage de l'onglet Stock inventaire
async function checkAuth() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (!data.success) {
            window.location.href = 'login.html';
            return;
        }
        
        // Stocker les informations de l'utilisateur
        currentUser = data.user;
        
        // Stocker l'utilisateur dans la variable window pour l'accès global
        window.currentUser = currentUser;
        
        // Afficher le contenu de la page maintenant que l'authentification est vérifiée
        document.body.classList.remove('auth-pending');
        document.body.classList.add('auth-verified');

        await populatePointVenteDropdowns();
        await initPointsVentePhysiques();
        await initTousPointsVente();
        
        // Afficher les informations de l'utilisateur avec le rôle
        const roleDisplayName = getUserRoleDisplayName(currentUser);
        document.getElementById('user-info').textContent = `Connecté en tant que ${currentUser.username} (${roleDisplayName})`;
        
        // Charger l'état des modules si le gestionnaire est disponible
        if (window.ModulesHandler) {
            await window.ModulesHandler.loadStatus();
            console.log('✅ État des modules chargé dans checkAuth');
        }
        
        // Fonction helper pour vérifier module + permission et appliquer la visibilité
        const setElementVisibility = (element, elementId, hasPermission) => {
            if (!element) return;
            
            // Vérifier d'abord si le module est actif
            const moduleAllowed = window.ModulesHandler ? window.ModulesHandler.isElementAllowed(elementId) : true;
            
            // L'élément est visible si le module est actif ET l'utilisateur a la permission
            const shouldShow = moduleAllowed && hasPermission;
            
            // Retirer la classe module-pending (état initial avant vérification)
            element.classList.remove('module-pending');
            
            if (shouldShow) {
                // Module actif et permission accordée - afficher
                element.classList.remove('module-disabled');
                element.classList.add('module-verified');
            } else {
                // Module désactivé ou pas de permission - masquer
                element.classList.remove('module-verified');
                element.classList.add('module-disabled');
            }
        };
        
        // Gérer la visibilité des onglets selon les permissions ET les modules actifs
        const importTabContainer = document.getElementById('import-tab-container');
        const stockInventaireItem = document.getElementById('stock-inventaire-item');
        const copierStockItem = document.getElementById('copier-stock-item');
        const cashPaymentItem = document.getElementById('cash-payment-item');
        const estimationItem = document.getElementById('estimation-item');
        const suiviAchatBoeufItem = document.getElementById('suivi-achat-boeuf-item');
        const precommandeItem = document.getElementById('precommande-item');
        const paymentLinksItem = document.getElementById('payment-links-item');
        const abonnementsItem = document.getElementById('abonnements-item');
        const reconciliationItem = document.getElementById('reconciliation-item');
        const reconciliationMoisItem = document.getElementById('reconciliation-mois-item');
        const stockAlerteItem = document.getElementById('stock-alerte-item');
        
        // Masquer les onglets selon les permissions de l'utilisateur ET les modules actifs
        
        // Onglet Import - pour utilisateurs avancés (pas de module associé)
        if (importTabContainer) {
            importTabContainer.style.display = currentUser.canManageAdvanced ? 'block' : 'none';
        }
        
        // Onglet Stock inventaire - module stock + accès à tous les points de vente
        setElementVisibility(stockInventaireItem, 'stock-inventaire-item', currentUser.canAccessAllPointsVente);
        
        // Onglet Copier Stock - module stock + permission copier stock
        setElementVisibility(copierStockItem, 'copier-stock-item', currentUser.canCopyStock);
        
        // Onglet Cash Paiement - module cash-paiement + utilisateurs avancés
        setElementVisibility(cashPaymentItem, 'cash-payment-item', currentUser.canManageAdvanced);
        
        // Onglet Suivi achat boeuf - module suivi-achat-boeuf + utilisateurs avancés
        setElementVisibility(suiviAchatBoeufItem, 'suivi-achat-boeuf-item', currentUser.canManageAdvanced);
        
        // Onglet Estimation - module estimation + permission estimation
        setElementVisibility(estimationItem, 'estimation-item', currentUser.canManageEstimation);
        
        // Onglet Pré-commande - module precommande + droits d'écriture
        setElementVisibility(precommandeItem, 'precommande-item', currentUser.canWrite);
        
        // Onglet Générer Paiement - module payment-links + droits d'écriture
        setElementVisibility(paymentLinksItem, 'payment-links-item', currentUser.canWrite);
        
        // Onglet Abonnements - module abonnements + droits d'écriture
        setElementVisibility(abonnementsItem, 'abonnements-item', currentUser.canWrite);
        
        // Onglet Réconciliation - module reconciliation (visible pour tous les authentifiés)
        setElementVisibility(reconciliationItem, 'reconciliation-item', true);
        
        // Onglet Réconciliation du mois - module reconciliation (visible pour tous les authentifiés)
        setElementVisibility(reconciliationMoisItem, 'reconciliation-mois-item', true);
        
        // Onglet Audit/Stock alerte - module audit (visible pour tous les authentifiés)
        setElementVisibility(stockAlerteItem, 'stock-alerte-item', true);
        
        console.log('✅ Visibilité des onglets mise à jour (modules + permissions)');
        
        // Section Analytics des Ventes - visible uniquement pour les superviseurs
        const analyticsSection = document.getElementById('analytics-section');
        const btnAnalyticsPopup = document.getElementById('btn-analytics-popup');
        const analyticsContent = document.getElementById('analytics-content');
        
        if (currentUser.role === 'superviseur') {
            if (analyticsSection) analyticsSection.style.display = 'block';
            if (btnAnalyticsPopup) btnAnalyticsPopup.style.display = 'inline-block';
            
            // Gérer le clic sur le bouton analytics
            if (btnAnalyticsPopup) {
                btnAnalyticsPopup.addEventListener('click', async function() {
                    if (analyticsContent) {
                        if (analyticsContent.style.display === 'none') {
                            analyticsContent.style.display = 'block';
                            btnAnalyticsPopup.innerHTML = '<i class="fas fa-eye-slash me-2"></i>Masquer les Analytics';
                            btnAnalyticsPopup.classList.remove('btn-outline-info');
                            btnAnalyticsPopup.classList.add('btn-info');
                            
                            // Charger les analytics quand on les affiche
                            // Récupérer les ventes actuelles depuis la variable globale
                            await afficherAnalyticsVentes(allVentes || []);
                        } else {
                            analyticsContent.style.display = 'none';
                            btnAnalyticsPopup.innerHTML = '<i class="fas fa-chart-line me-2"></i>Voir les Analytics';
                            btnAnalyticsPopup.classList.remove('btn-info');
                            btnAnalyticsPopup.classList.add('btn-outline-info');
                        }
                    }
                });
            }
            
            // Ajouter les événements pour recalculer les proxy marges
            const prixAchatPoulet = document.getElementById('prix-achat-poulet');
            const prixAchatAgneau = document.getElementById('prix-achat-agneau');
            const prixAchatOeuf = document.getElementById('prix-achat-oeuf');
            
            if (prixAchatPoulet) {
                prixAchatPoulet.addEventListener('input', recalculerProxyMarges);
            }
            if (prixAchatAgneau) {
                prixAchatAgneau.addEventListener('input', recalculerProxyMarges);
            }
            if (prixAchatOeuf) {
                prixAchatOeuf.addEventListener('input', recalculerProxyMarges);
            }
        } else {
            if (analyticsSection) analyticsSection.style.display = 'none';
        }
        
        // Vérifier l'accès au chat Relevance AI
        if (!currentUser.canAccessChat) {
            // Désactiver le chat pour les utilisateurs non autorisés
            // Cette logique est complémentaire à celle dans index.html
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && (
                            node.id && node.id.includes('relevance') || 
                            node.className && node.className.includes('relevance')
                        )) {
                            node.style.display = 'none';
                        }
                    });
                });
            });
            
            // Démarrer l'observation du document
            observer.observe(document.body, { childList: true, subtree: true });
            console.log('Chat Relevance AI désactivé pour l\'utilisateur:', currentUser.username);
        }

        // Mettre à jour la visibilité du bouton de vidage
        updateViderBaseButtonVisibility();
        
        // Initialiser le point de vente selon l'utilisateur
        const userPointsVente = getUserAuthorizedPointsVente();
        if (!userPointsVente.includes("tous") && userPointsVente.length === 1) {
            const pointVenteSelect = document.getElementById('point-vente');
            if (pointVenteSelect) {
                pointVenteSelect.value = userPointsVente[0];
                pointVenteSelect.disabled = true;
            }
        }
        
        // Mettre à jour l'état initial du bouton Enregistrer
        setTimeout(() => {
            updateSubmitButtonState();
            // Mettre à jour l'état initial des boutons de stock si on est sur cette page
            updateStockButtonsState();
        }, 100);
    } catch (error) {
        console.error('Erreur lors de la vérification de la session:', error);
        window.location.href = 'login.html';
    }
}

// Gestion de la déconnexion
document.getElementById('logout-btn').addEventListener('click', async function(e) {
    e.preventDefault();
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        if (data.success) {
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
    }
});

// Vérifier l'authentification au chargement de la page
checkAuth();

/**
 * Initialiser les clients abonnés de manière robuste
 * Attend que le point de vente soit disponible avant de charger les clients
 */
function initializerClientsAbonnes(pointVenteInput) {
    // Fonction d'initialisation
    const chargerClientsAbonnesSiPossible = () => {
        const pointVenteValue = pointVenteInput.value;
        if (pointVenteValue && window.venteAbonnementModule) {
            console.log('🔄 Initialisation des clients abonnés pour:', pointVenteValue);
            window.venteAbonnementModule.chargerClientsAbonnes(pointVenteValue);
            return true; // Succès
        }
        return false; // Pas encore prêt
    };
    
    // Essayer immédiatement
    if (chargerClientsAbonnesSiPossible()) {
        return; // Déjà chargé, terminé
    }
    
    // Sinon, attendre que le point de vente soit disponible
    const attendrePointVenteDisponible = () => {
        return new Promise((resolve) => {
            // Vérifier périodiquement (max 5 secondes)
            let tentatives = 0;
            const maxTentatives = 50; // 50 * 100ms = 5 secondes max
            
            const interval = setInterval(() => {
                tentatives++;
                
                if (chargerClientsAbonnesSiPossible()) {
                    clearInterval(interval);
                    resolve(true);
                } else if (tentatives >= maxTentatives) {
                    clearInterval(interval);
                    console.warn('⚠️ Timeout: Point de vente non disponible après 5s');
                    resolve(false);
                }
            }, 100);
        });
    };
    
    // Lancer l'attente asynchrone
    attendrePointVenteDisponible();
}

// Configuration des dates
flatpickr("#date", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today",
    onChange: function(selectedDates, dateStr) {
        // Mettre à jour l'état du bouton Enregistrer selon la date sélectionnée
        updateSubmitButtonState();
    }
});

// Configuration des dates pour les pré-commandes - exactement comme Saisie
flatpickr("#precommande-date-enregistrement", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today",
    onChange: function(selectedDates, dateStr) {
        // Mettre à jour l'état du bouton Enregistrer selon la date sélectionnée
        updateSubmitButtonState();
    }
});

flatpickr("#precommande-date-reception", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today",
    onChange: function(selectedDates, dateStr) {
        // Mettre à jour l'état du bouton Enregistrer selon la date sélectionnée
        updateSubmitButtonState();
    }
});

// Configuration des dates pour la visualisation
const dateDebutPicker = flatpickr("#date-debut", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today",
    onChange: function(selectedDates, dateStr) {
        console.log('Date de début changée:', dateStr);
        // Recharger immédiatement à chaque changement
        chargerVentes();
    }
});

const dateFinPicker = flatpickr("#date-fin", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today",
    onChange: function(selectedDates, dateStr) {
        console.log('Date de fin changée:', dateStr);
        // Recharger immédiatement à chaque changement
        chargerVentes();
    }
});

// Configuration des dates pour le tableau des ventes par point de vente
const dateDebutPointVentePicker = flatpickr("#dateDebutPointVente", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today",
    onChange: function(selectedDates, dateStr) {
        console.log('Date de début Point de Vente changée:', dateStr);
        // Mettre à jour le tableau si le filtre par dates est actif
        if (document.getElementById('filterTypePointVente').value === 'dates') {
            creerTableauVentesParPointVente();
        }
    }
});

const dateFinPointVentePicker = flatpickr("#dateFinPointVente", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today",
    onChange: function(selectedDates, dateStr) {
        console.log('Date de fin Point de Vente changée:', dateStr);
        // Mettre à jour le tableau si le filtre par dates est actif
        if (document.getElementById('filterTypePointVente').value === 'dates') {
            creerTableauVentesParPointVente();
        }
    }
});

// Configuration des dates pour les filtres des pré-commandes - exactement comme visualisation
const precommandeFilterDateDebutPicker = flatpickr("#filter-precommande-date-debut", {
    locale: "fr",
    dateFormat: "Y-m-d", // Format ISO pour les inputs de type date
    defaultDate: null
});

const precommandeFilterDateFinPicker = flatpickr("#filter-precommande-date-fin", {
    locale: "fr",
    dateFormat: "Y-m-d", // Format ISO pour les inputs de type date
    defaultDate: null
});

// Configuration de la date pour la modal de conversion - exactement comme Saisie
const conversionDatePicker = flatpickr("#conversion-date-vente", {
    locale: "fr",
    dateFormat: "d/m/Y",
    defaultDate: "today"
});

// Fonction pour mettre à jour les dates en fonction de la période sélectionnée
function updateDatesByPeriod(period) {
    const today = new Date();
    let startDate, endDate;
    
    switch(period) {
        case 'jour':
            // Aujourd'hui
            startDate = new Date(today);
            endDate = new Date(today);
            break;
        case 'semaine':
            // Cette semaine (lundi au dimanche)
            const dayOfWeek = today.getDay();
            const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Ajuster quand c'est dimanche
            startDate = new Date(today.setDate(diff));
            endDate = new Date(today);
            endDate.setDate(startDate.getDate() + 6);
            break;
        case 'mois':
            // Ce mois
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            break;
        case 'personnalise':
            // Ne rien faire, laisser les dates telles quelles
            return;
        default:
            return;
    }
    
    dateDebutPicker.setDate(startDate);
    dateFinPicker.setDate(endDate);
    chargerVentes();
}

// Ajouter un écouteur d'événements pour le sélecteur de période
document.addEventListener('DOMContentLoaded', function() {
    const periodeSelect = document.getElementById('periode-select');
    if (periodeSelect) {
        periodeSelect.addEventListener('change', function() {
            updateDatesByPeriod(this.value);
        });
        
        // Initialiser avec la période par défaut (aujourd'hui)
        updateDatesByPeriod(periodeSelect.value);
    }

    // Ajouter un écouteur pour le sélecteur de point de vente dans la section Visualisation
    const pointVenteSelectVisualisation = document.getElementById('point-vente-select');
    if (pointVenteSelectVisualisation) {
        pointVenteSelectVisualisation.addEventListener('change', chargerVentes);
    }
});

// Importer la base de données des produits
// Note: produits est défini dans produits.js et disponible globalement
console.log('Vérification de la disponibilité de l\'objet produits:', typeof produits, produits ? 'disponible' : 'non disponible');

// S'assurer que l'objet produits est disponible
if (typeof produits === 'undefined') {
    console.error('Erreur: L\'objet produits n\'est pas disponible. Vérifiez que produits.js est chargé correctement.');
    alert('Erreur: Base de données des produits non chargée. Veuillez recharger la page.');
}

// Affichage de la catégorie : remplace "Import OCR" par "Superette"
function formatCategorie(cat) {
    if (!cat) return '';
    return cat === 'Import OCR' ? 'Superette' : cat;
}

// Fonction pour peupler les catégories
function populateCategories() {
    // Vérifier la disponibilité de l'objet produits
    if (typeof produits === 'undefined' || !produits) {
        console.error('Erreur: L\'objet produits n\'est pas disponible pour populateCategories');
        return;
    }
    
    // Peupler tous les sélecteurs de catégories (existants et futurs)
    document.querySelectorAll('.categorie-select').forEach(select => {
        // Vérifier si les options sont déjà peuplées
        if (select.children.length <= 1) { // Seulement l'option par défaut
            Object.keys(produits).forEach(categorie => {
                if (typeof produits[categorie] === 'object' && produits[categorie] !== null) {
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    select.appendChild(option);
                }
            });
        }
    });
}

// Gestion des catégories et produits
document.querySelectorAll('.categorie-select').forEach(select => {
    select.addEventListener('change', function() {
        const produitSelect = this.closest('.row').querySelector('.produit-select');
        const categorie = this.value;
        
        produitSelect.innerHTML = '<option value="">Sélectionner un produit</option>';
        
        if (categorie && produits[categorie]) {
            Object.keys(produits[categorie]).forEach(produit => {
                const option = document.createElement('option');
                option.value = produit;
                option.textContent = produit;
                produitSelect.appendChild(option);
            });
        }
    });
});

// Gestion des prix unitaires
document.querySelectorAll('.produit-select').forEach(select => {
    select.addEventListener('change', function() {
        const row = this.closest('.row');
        const produitEntry = this.closest('.produit-entry');
        const categorie = row.querySelector('.categorie-select').value;
        const produit = this.value;
        const prixUnitInput = row.querySelector('.prix-unit');
        const pointVente = document.getElementById('point-vente').value;
        
        // Vérifier si c'est un pack et afficher le bouton de détails
        if (window.PackComposition && produitEntry) {
            window.PackComposition.checkIfPackAndShowButton(produitEntry);
        }
        
        if (categorie && produit && produits[categorie] && produits[categorie][produit]) {
            const prix = produits.getPrixDefaut(categorie, produit, pointVente);
            prixUnitInput.value = prix;
            calculerTotal(row);
        } else {
            prixUnitInput.value = '';
        }
    });
});

// Calcul des totaux
function calculerTotal(row) {
    const quantite = parseFloat(row.querySelector('.quantite').value) || 0;
    const prixUnit = parseFloat(row.querySelector('.prix-unit').value) || 0;
    const total = quantite * prixUnit;
    row.querySelector('.total').value = total.toFixed(2);
    calculerTotalGeneral();
}

document.querySelectorAll('.quantite, .prix-unit').forEach(input => {
    input.addEventListener('input', function() {
        calculerTotal(this.closest('.row'));
    });
});

// Écouter l'événement de chargement des produits depuis l'API
window.addEventListener('produitsLoaded', function() {
    console.log('📦 Événement produitsLoaded reçu - peuplement des catégories');
    populateCategories();
});

// Ajouter un événement pour recalculer le total général quand la date change
document.addEventListener('DOMContentLoaded', function() {
    // Tenter de peupler les catégories (si produits déjà chargés)
    if (typeof produits !== 'undefined' && produits && Object.keys(produits).length > 0) {
        populateCategories();
    }
    
    const dateInput = document.getElementById('date');
    const pointVenteInput = document.getElementById('point-vente');
    
    if (dateInput) {
        dateInput.addEventListener('change', function() {
            // Recalculer le total général quand la date change
            setTimeout(calculerTotalGeneral, 0);
            // Recharger les ventes filtrées par date et point de vente
            chargerDernieresVentes();
            // Mettre à jour l'état du bouton Enregistrer selon la date sélectionnée
            updateSubmitButtonState();
            // Réinitialiser les champs client quand la date change
            resetClientFields();
        });
    }
    
    if (pointVenteInput) {
        pointVenteInput.addEventListener('change', function() {
            // Get the current value
            const pointVenteValue = this.value;
            console.log("[Point Vente Change] Value:", pointVenteValue);
            
            // Charger les clients abonnés pour ce point de vente
            if (window.venteAbonnementModule) {
                window.venteAbonnementModule.chargerClientsAbonnes(pointVenteValue);
            }
            
            // Mettre à jour les prix unitaires pour tous les produits selon le point de vente
            document.querySelectorAll('.produit-select').forEach(select => {
                if (select.value) {
                    select.dispatchEvent(new Event('change'));
                }
            });
            
            // Always calculate total, regardless of selection
            setTimeout(function() {
                console.log("[Point Vente Change] Calling calculerTotalGeneral");
                calculerTotalGeneral();
            }, 100);
            
            // Recharger les ventes filtrées par date et point de vente
            chargerDernieresVentes();
            // Réinitialiser les champs client quand le point de vente change
            resetClientFields();
        });
    }
    
    // Event listener pour le client abonné
    const clientAbonneSelect = document.getElementById('client-abonne');
    if (clientAbonneSelect) {
        clientAbonneSelect.addEventListener('change', function() {
            if (window.venteAbonnementModule) {
                window.venteAbonnementModule.gererSelectionClientAbonne();
            }
        });
    }
    
    // Calculer le total général au chargement de la page
    setTimeout(calculerTotalGeneral, 100);
    
    // Initialiser les clients abonnés de manière robuste
    if (pointVenteInput) {
        initializerClientsAbonnes(pointVenteInput);
    }
    
    // Initialiser le module de gestion des packs
    if (window.PackComposition) {
        window.PackComposition.init();
    }
});

function calculerTotalGeneral() {
    // Récupérer la date sélectionnée
    const dateSelectionnee = document.getElementById('date').value;
    
    // Récupérer le point de vente sélectionné
    const pointVenteSelectionnee = document.getElementById('point-vente').value;
    
    // Fonction pour extraire uniquement les composants jour/mois/année d'une date
    function getComparableDate(dateStr) {
        if (!dateStr) return null;
        let jour, mois, annee;

        // Regex pour détecter YYYY-MM-DD
        const ymdRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
        const ymdMatch = dateStr.match(ymdRegex);

        if (ymdMatch) {
            annee = ymdMatch[1];
            mois = ymdMatch[2];
            jour = ymdMatch[3];
        } else if (dateStr.includes('/')) { // Format DD/MM/YYYY ou DD/MM/YY
            [jour, mois, annee] = dateStr.split('/');
            if (annee.length === 2) {
                annee = '20' + annee;
            }
        } else if (dateStr.includes('-')) { // Format DD-MM-YYYY ou DD-MM-YY
            [jour, mois, annee] = dateStr.split('-');
            if (jour.length === 4) { // Probablement YYYY-MM-DD
                annee = jour;
                jour = dateStr.split('-')[2]; // Réassigner correctement
            } else if (annee.length === 2) {
                annee = '20' + annee;
            }
        } else {
            return null; // Format non reconnu
        }

        return `${String(jour).padStart(2, '0')}-${String(mois).padStart(2, '0')}-${annee}`;
    }
    
    // Conversion de la date sélectionnée au format comparable
    const dateSelectionneeComparable = getComparableDate(dateSelectionnee);
    
    // 1. Calculer le total des lignes en cours de saisie plus efficacement
    const totalSaisie = Array.from(document.querySelectorAll('.total'))
        .reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
    
    // Indiquer le calcul en cours
    document.getElementById('total-general').textContent = 'Calcul en cours...';
    
    // 2. Calculer le total asynchrone pour ne pas bloquer l'UI
    setTimeout(() => {
        try {
            // Obtenir toutes les lignes de vente
            const tbody = document.querySelector('#dernieres-ventes tbody');
            if (!tbody) {
                throw new Error('Table body not found');
            }
            
            const rows = tbody.querySelectorAll('tr');
            let totalDernieresVentes = 0;
            
            // Parcourir les lignes
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                
                // Obtenir les cellules de date et point de vente
                const dateCellElement = row.querySelector('td:nth-child(2)');
                const pointVenteCellElement = row.querySelector('td:nth-child(4)');
                const montantCellElement = row.querySelector('td:nth-child(10)');
                
                if (!dateCellElement || !pointVenteCellElement || !montantCellElement) {
                    continue; // Ignorer les lignes incomplètes
                }
                
                // Extraire les valeurs
                const dateCell = dateCellElement.textContent.trim();
                const dateVenteComparable = getComparableDate(dateCell);
                const pointVenteCell = pointVenteCellElement.textContent.trim();
                
                // Comparer dates et point de vente
                // Si le point de vente est vide, inclure toutes les ventes de la date
                if (dateVenteComparable === dateSelectionneeComparable && 
                    (pointVenteSelectionnee === "" || pointVenteCell === pointVenteSelectionnee)) {
                    
                    // Extraire le montant
                    const montantText = montantCellElement.textContent.trim();
                    const montant = parseFloat(montantText.replace(/\s/g, '').replace(/,/g, '.').replace(/FCFA/g, '')) || 0;
                    totalDernieresVentes += montant;
                }
            }
            
            // 3. Calculer et afficher le total général
            const totalGeneral = totalSaisie + totalDernieresVentes;
            document.getElementById('total-general').textContent = `${totalGeneral.toLocaleString('fr-FR')} FCFA`;
            
        } catch (error) {
            console.error('Erreur lors du calcul du total:', error);
            document.getElementById('total-general').textContent = 'Erreur de calcul';
        }
    }, 50);
    
    return totalSaisie;
}
// Fonction pour créer une nouvelle entrée de produit
function creerNouvelleEntree() {
    const div = document.createElement('div');
    div.className = 'produit-entry mb-3';
    div.innerHTML = `
        <div class="row align-items-end">
            <div class="col-md-2">
                <label class="form-label">Catégorie</label>
                <select class="form-select categorie-select" required>
                    <option value="">Sélectionner...</option>
                </select>
            </div>
            <div class="col-md-4">
                <label class="form-label">Produit</label>
                <div class="d-flex gap-2">
                    <select class="form-select produit-select" required style="flex: 1;">
                        <option value="">Sélectionner...</option>
                    </select>
                    <button type="button" class="btn btn-info btn-pack-details" style="display: none;" title="Détails du pack">
                        <i class="bi bi-box-seam"></i>
                    </button>
                </div>
            </div>
            <div class="col-md-2">
                <label class="form-label">Prix Unit.</label>
                <input type="number" class="form-control prix-unit" required>
            </div>
            <div class="col-md-2">
                <label class="form-label">Quantité</label>
                <input type="number" class="form-control quantite" step="0.001" required>
            </div>
            
            <div class="col-md-2">
                <label class="form-label">Total</label>
                <input type="number" class="form-control total" readonly>
            </div>
            <div class="col-md-1">
                <button type="button" class="btn btn-danger btn-sm supprimer-produit">
                    <i class="fas fa-trash"></i>
                </button>
            </div>

        </div>
    `;

    // Peupler dynamiquement les catégories depuis produits.js
    const categorieSelect = div.querySelector('.categorie-select');
    const produitSelect = div.querySelector('.produit-select');
    
    // Peupler les catégories directement pour ce nouvel élément
    if (typeof produits !== 'undefined' && produits) {
        Object.keys(produits).forEach(categorie => {
            if (typeof produits[categorie] === 'object' && produits[categorie] !== null) {
                // Ignorer les fonctions
                if (typeof produits[categorie] === 'function') return;
                
                const option = document.createElement('option');
                option.value = categorie;
                option.textContent = categorie;
                categorieSelect.appendChild(option);
            }
        });
    } else {
        console.error('Objet produits non disponible lors de la création de la nouvelle entrée');
    }
    categorieSelect.addEventListener('change', function() {
        const categorie = this.value;
        
        produitSelect.innerHTML = '<option value="">Sélectionner...</option>'; // Vider les options précédentes
        
        // Utiliser produits depuis produits.js
        if (categorie && typeof produits !== 'undefined' && produits[categorie]) {
            Object.keys(produits[categorie]).forEach(produit => {
                const option = document.createElement('option');
                option.value = produit;
                option.textContent = produit;
                produitSelect.appendChild(option);
            });
        } else if (categorie) {
            console.error(`Données produits non trouvées pour la catégorie: ${categorie}`);
        }
        
        // Déclencher manuellement l'événement change sur produitSelect pour mettre à jour le prix
        produitSelect.dispatchEvent(new Event('change')); 
    });

    // Mise à jour auto du prix unitaire
    const prixUnitInput = div.querySelector('.prix-unit');
    
    // Fonction pour calculer et appliquer le prix
    const calculerEtAppliquerPrix = function() {
        const selectedProduit = produitSelect.value;
        const categorie = categorieSelect.value;
        const pointVente = document.getElementById('point-vente').value;
        
        if (!selectedProduit) return;
        
        console.log(`🔍 Produit sélectionné - Catégorie: "${categorie}", Produit: "${selectedProduit}"`);
        
        // Utiliser le module d'abonnement qui gère automatiquement prix abonné vs normal
        let prixApplique = null;
        if (window.venteAbonnementModule && categorie && selectedProduit) {
            prixApplique = window.venteAbonnementModule.obtenirPrixProduit(categorie, selectedProduit, pointVente);
            
            // Vérifier si c'est un prix abonné (client abonné sélectionné)
            const clientAbonne = window.venteAbonnementModule.getClientAbonneSelectionne();
            if (clientAbonne && prixApplique !== null) {
                prixUnitInput.style.backgroundColor = '#d4edda'; // Vert clair pour prix abonné
                console.log(`✅ Prix abonné appliqué: ${selectedProduit} = ${prixApplique} FCFA`);
            } else {
                prixUnitInput.style.backgroundColor = ''; // Réinitialiser
                console.log(`✅ Prix normal appliqué: ${selectedProduit} = ${prixApplique} FCFA`);
            }
        }
        
        // Si pas de prix trouvé via le module, utiliser produits directement
        if (prixApplique === null && categorie && selectedProduit && produits[categorie] && produits[categorie][selectedProduit]) {
            prixApplique = produits.getPrixDefaut(categorie, selectedProduit, pointVente) || '';
        }
        
        if (prixApplique !== null) {
            prixUnitInput.value = prixApplique;
        } else {
            console.warn(`Prix non trouvé pour ${categorie} > ${selectedProduit}`);
            prixUnitInput.value = '';
        }
        
        calculerTotal(div); // Recalculer le total ligne quand produit change
    };
    
    // Déclencher lors du changement (sélection d'un nouveau produit)
    produitSelect.addEventListener('change', function() {
        calculerEtAppliquerPrix();
        
        // Vérifier si c'est un pack et afficher le bouton de détails
        if (window.PackComposition) {
            window.PackComposition.checkIfPackAndShowButton(div);
        }
    });
    
    // UNIQUEMENT pour le mode abonnement : listeners supplémentaires
    // Déclencher lors du focus (clic sur le select) UNIQUEMENT si un client abonné est déjà sélectionné
    produitSelect.addEventListener('focus', function() {
        // Vérifier que le module d'abonnement existe ET qu'un client est sélectionné
        if (!window.venteAbonnementModule) return;
        
        const clientAbonne = window.venteAbonnementModule.getClientAbonneSelectionne();
        if (clientAbonne && this.value) {
            console.log('🎯 Focus sur produit avec client abonné, vérification du prix...');
            // Petit délai pour laisser le temps au DOM de se mettre à jour si nécessaire
            setTimeout(calculerEtAppliquerPrix, 50);
        }
    });
    
    // UNIQUEMENT pour le mode abonnement : Déclencher lors du clic
    produitSelect.addEventListener('click', function() {
        // Vérifier que le module d'abonnement existe ET qu'un client est sélectionné
        if (!window.venteAbonnementModule) return;
        
        const clientAbonne = window.venteAbonnementModule.getClientAbonneSelectionne();
        if (clientAbonne && this.value) {
            console.log('👆 Clic sur produit avec client abonné, recalcul du prix...');
            calculerEtAppliquerPrix();
        }
    });

    // Calcul auto du total
    const quantiteInput = div.querySelector('.quantite');
    prixUnitInput.addEventListener('input', () => calculerTotal(div));
    quantiteInput.addEventListener('input', () => calculerTotal(div));

    // Logique de suppression
    const deleteButton = div.querySelector('.supprimer-produit');
    deleteButton.addEventListener('click', function() {
        // Nettoyer la composition du pack si nécessaire
        if (window.PackComposition) {
            window.PackComposition.clearPackComposition(div);
        }
        div.remove();
        calculerTotalGeneral(); // Recalculer le total général après suppression
    });

    return div;
}

// Modifier la gestion du formulaire
document.getElementById('vente-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const date = document.getElementById('date').value;
    const pointVente = document.getElementById('point-vente').value;
    
    // Vérifier si l'utilisateur a accès au point de vente
    const userPointVente = currentUser.pointVente;
    let hasAccess = false;
    
    if (userPointVente === "tous" || (Array.isArray(userPointVente) && userPointVente.includes("tous"))) {
        hasAccess = true;
    } else if (Array.isArray(userPointVente)) {
        hasAccess = userPointVente.includes(pointVente);
    } else {
        hasAccess = userPointVente === pointVente;
    }
    
    if (!hasAccess) {
        alert('Vous n\'avez pas accès à ce point de vente');
        return;
    }
    
    // Vérifier les restrictions temporelles pour l'ajout de ventes
    if (!canAddSaleForDate(date, currentUser.username)) {
        alert('Vous ne pouvez pas ajouter de ventes pour cette date. Les utilisateurs avec accès limité ne peuvent ajouter des ventes que le jour J et jusqu\'au lendemain avant 4h00 du matin. Seuls administrateurs sont exemptés de cette restriction.');
        return;
    }
    
    // Récupérer l'ID de la vente en cours de modification s'il existe
    const venteEnCoursDeModification = document.querySelector('.produit-entry[data-vente-id]');
    const venteId = venteEnCoursDeModification ? venteEnCoursDeModification.dataset.venteId : null;
    const isUpdate = !!venteId;
    
    console.log('Vente en cours de modification:', { venteId, isUpdate });
    
    // Si c'est une mise à jour, on ne traite que la première entrée avec l'ID de vente
    // Si c'est un nouvel enregistrement, on traite toutes les entrées
    const entriesToProcess = isUpdate ? 
        [document.querySelector('.produit-entry[data-vente-id]')] : 
        document.querySelectorAll('.produit-entry');
    
    // Récupérer les informations client de l'en-tête
    const clientNom = document.getElementById('client-nom').value;
    const clientNumero = document.getElementById('client-numero').value;
    const clientAdresse = document.getElementById('client-adresse').value;
    const clientCreanceElement = document.getElementById('client-creance');
    const clientCreanceRawValue = clientCreanceElement ? clientCreanceElement.value : 'undefined';
    const clientCreance = clientCreanceRawValue === 'true';
    
    console.log(`[CREANCE DEBUG] Select element exists: ${!!clientCreanceElement}`);
    console.log(`[CREANCE DEBUG] Raw value from select: "${clientCreanceRawValue}"`);
    console.log(`[CREANCE DEBUG] Final boolean value: ${clientCreance}`);
    
    const entries = [];
    
    entriesToProcess.forEach(entry => {
        const categorie = entry.querySelector('.categorie-select').value;
        const produit = entry.querySelector('.produit-select').value;
        const quantite = entry.querySelector('.quantite').value;
        const prixUnit = entry.querySelector('.prix-unit').value;
        const total = entry.querySelector('.total').value;
        
        // Utiliser les informations client de l'en-tête au lieu des champs individuels
        let nomClient = clientNom;
        
        // Ajouter le préfixe "(A)" si c'est un client abonné
        if (window.venteAbonnementModule && window.venteAbonnementModule.getClientAbonneSelectionne()) {
            nomClient = nomClient ? `(A) ${nomClient}` : '';
            console.log(`✅ Client abonné détecté, nom avec préfixe: ${nomClient}`);
        }
        
        const numeroClient = clientNumero;
        const adresseClient = clientAdresse;
        const creance = clientCreance;
        
        if (categorie && produit && quantite && prixUnit) {
            const mois = new Date(date.split('/').reverse().join('-')).toLocaleString('fr-FR', { month: 'long' });
            const semaine = `S${Math.ceil(new Date(date.split('/').reverse().join('-')).getDate() / 7)}`;
            
            const entryData = {
                id: venteId,
                mois,
                date,
                semaine,
                pointVente,
                categorie,
                produit,
                prixUnit,
                quantite,
                total,
                nomClient,
                numeroClient,
                adresseClient,
                creance
            };
            
            // Ajouter la composition du pack si c'est un pack
            if (window.PackComposition && categorie === 'Pack') {
                const packComposition = window.PackComposition.getPackComposition(entry);
                if (packComposition) {
                    entryData.extension = {
                        pack_type: packComposition.packType,
                        composition: packComposition.composition,
                        modifie: packComposition.modifie,
                        date_composition: new Date().toISOString()
                    };
                    console.log('📦 Composition du pack ajoutée:', entryData.extension);
                }
            }
            
            // Ajouter les données d'abonnement si un client abonné est sélectionné
            if (window.venteAbonnementModule) {
                const clientAbonne = window.venteAbonnementModule.getClientAbonneSelectionne();
                if (clientAbonne) {
                    entryData.client_abonne_id = clientAbonne.id;
                    
                    // Calculer le prix normal (sans rabais) depuis produitsAbonnement
                    if (window.produits && window.produits[categorie] && window.produits[categorie][produit]) {
                        const prixNormal = window.produits.getPrixDefaut(categorie, produit, pointVente);
                        entryData.prix_normal = prixNormal;
                        // Calculer le rabais TOTAL appliqué (rabais par unité × quantité)
                        const rabaisParUnite = prixNormal - parseFloat(prixUnit);
                        entryData.rabais_applique = rabaisParUnite * parseFloat(quantite);
                        
                        console.log(`💰 Rabais calculé: ${entryData.rabais_applique} FCFA (Rabais unitaire: ${rabaisParUnite}, Quantité: ${quantite}, Prix normal: ${prixNormal}, Prix abonné: ${prixUnit})`);
                    }
                }
            }
            
            entries.push(entryData);
        }
    });
    
    if (entries.length === 0) {
        alert('Veuillez ajouter au moins un produit');
        return;
    }
    
    // Afficher le spinner de chargement
    showLoadingSpinner();
    
    try {
        const url = isUpdate ? `/api/ventes/${venteId}` : '/api/ventes';
        const method = isUpdate ? 'PUT' : 'POST';
        
        console.log('Envoi de la requête:', { url, method, isUpdate, venteId });
        console.log('Données envoyées:', isUpdate ? entries[0] : entries);
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(isUpdate ? entries[0] : entries)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(isUpdate ? 'Vente mise à jour avec succès' : 'Ventes enregistrées avec succès');
            
            // Sauvegarder le point de vente actuel
            const pointVenteSelect = document.getElementById('point-vente');
            const currentPointVente = pointVenteSelect.value;
            
            // Réinitialiser le formulaire
            this.reset();
            
            // Réinitialiser complètement le client abonné
            const clientAbonneSelect = document.getElementById('client-abonne');
            if (clientAbonneSelect) {
                clientAbonneSelect.value = '';
                // Déclencher l'événement change pour nettoyer les champs
                if (window.venteAbonnementModule) {
                    window.venteAbonnementModule.gererSelectionClientAbonne();
                }
            }
            
            // Réinitialiser les champs client manuellement
            document.getElementById('client-nom').value = '';
            document.getElementById('client-numero').value = '';
            document.getElementById('client-adresse').value = '';
            document.getElementById('client-creance').value = 'false';
            
            console.log('✅ Formulaire complètement réinitialisé');
            
            // Réinitialiser la date à aujourd'hui
            document.getElementById('date')._flatpickr.setDate(new Date());
            
            // Réappliquer le point de vente selon les droits de l'utilisateur
            const userPointsVente = getUserAuthorizedPointsVente();
            if (!userPointsVente.includes("tous") && userPointsVente.length === 1) {
                pointVenteSelect.value = userPointsVente[0];
                pointVenteSelect.disabled = true;
            } else if (currentPointVente) {
                pointVenteSelect.value = currentPointVente;
            }
            
            // Réinitialiser les compositions de packs
            if (window.PackComposition) {
                window.PackComposition.clearAllPackCompositions();
            }
            
            // Réinitialiser les produits
            document.getElementById('produits-container').innerHTML = '';
            
            // Ajouter une nouvelle entrée vide pour permettre de nouvelles saisies
            document.getElementById('produits-container').appendChild(creerNouvelleEntree());
            
            // Actualiser les dernières ventes
            // La fonction chargerDernieresVentes() va maintenant aussi recalculer le total général
            await chargerDernieresVentes();
            
            // Note: nous ne calculons plus le total ici car chargerDernieresVentes le fait déjà
            
            // Masquer le spinner de chargement
            hideLoadingSpinner();
        } else {
            hideLoadingSpinner();
            throw new Error(data.message || (isUpdate ? 'Erreur lors de la mise à jour de la vente' : 'Erreur lors de l\'enregistrement des ventes'));
        }
    } catch (error) {
        // Masquer le spinner de chargement en cas d'erreur
        hideLoadingSpinner();
        console.error('Erreur:', error);
        alert(error.message || (isUpdate ? 'Erreur lors de la mise à jour de la vente' : 'Erreur lors de l\'enregistrement des ventes'));
    }
});

// Modifier l'ajout de nouveaux produits
document.getElementById('ajouter-produit').addEventListener('click', function() {
    const container = document.getElementById('produits-container');
    const nouvelleEntree = creerNouvelleEntree();
    container.appendChild(nouvelleEntree);
});

// Fonction pour vérifier si une date est aujourd'hui
function isToday(dateStr) {
    // StandardiserDate s'attend à un format avec tirets, ex: "09-05-2025"
    // Assurez-vous que dateStr est dans ce format ou ajustez la logique ici.
    const date = standardiserDate(dateStr); // Ensure standardiserDate is accessible or defined before this block
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
}

function isYesterday(dateStr) {
    const date = standardiserDate(dateStr); // Ensure standardiserDate is accessible or defined before this block
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return date.getDate() === yesterday.getDate() &&
           date.getMonth() === yesterday.getMonth() &&
           date.getFullYear() === yesterday.getFullYear();
}

// Nouvelle fonction pour vérifier si une action est autorisée selon les restrictions temporelles
// Autorise : le jour J et jusqu'au lendemain avant 4h00 du matin
function canPerformActionForDate(dateStr) {
    if (!dateStr) return false;
    
    try {
        let day, month, year;
        
        // Parser la date (formats supportés : DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD)
        const ddmmyyyyRegex = /^(\d{2})[-\/](\d{2})[-\/](\d{4})$/; // DD-MM-YYYY ou DD/MM/YYYY
        const yyyymmddRegex = /^(\d{4})[-\/](\d{2})[-\/](\d{2})$/; // YYYY-MM-DD ou YYYY/MM/DD
        
        let match = dateStr.match(ddmmyyyyRegex);
        if (match) {
            // Format DD-MM-YYYY ou DD/MM/YYYY
            day = parseInt(match[1]);
            month = parseInt(match[2]) - 1; // Mois commence à 0 en JavaScript
            year = parseInt(match[3]);
        } else {
            match = dateStr.match(yyyymmddRegex);
            if (match) {
                // Format YYYY-MM-DD ou YYYY/MM/DD
                year = parseInt(match[1]);
                month = parseInt(match[2]) - 1; // Mois commence à 0 en JavaScript
                day = parseInt(match[3]);
            } else {
                console.warn('Format de date non reconnu:', dateStr);
                return false;
            }
        }
        
        const targetDate = new Date(year, month, day);
        const now = new Date();
        
        // Calculer la date limite : targetDate + 1 jour + 4h
        const deadlineDate = new Date(targetDate);
        deadlineDate.setDate(deadlineDate.getDate() + 1);
        deadlineDate.setHours(4, 0, 0, 0); // 4h00 du matin
        
        // L'action est autorisée si nous sommes avant la date limite
        const result = now <= deadlineDate;
        
        // Debug log pour diagnostiquer
        console.log(`Debug restriction: ${dateStr} -> ${result} (now: ${now}, deadline: ${deadlineDate})`);
        
        return result;
        
    } catch (error) {
        console.error('Erreur lors de la validation de la date:', error);
        return false;
    }
}

// Fonction pour vérifier si un utilisateur peut ajouter des ventes pour une date donnée
function canAddSaleForDate(dateStr, username) {
    if (!username || !dateStr) return false;
    
    const currentUser = window.currentUser;
    if (!currentUser) return false;
    
    // Vérifier si l'utilisateur peut contourner les restrictions temporelles
    // Superviseurs et administrateurs peuvent ajouter des ventes pour n'importe quelle date
    const canBypassTimeRestrictions = currentUser.bypassTimeRestrictions || 
                                    currentUser.canAddSalesAnytime ||
                                    currentUser.role === 'superviseur' || 
                                    currentUser.role === 'admin';
    
    if (canBypassTimeRestrictions) {
        return true;
    }
    
    // Tous les autres utilisateurs sont soumis aux restrictions temporelles
    return canPerformActionForDate(dateStr);
}

// Fonction pour vérifier si un utilisateur peut modifier le stock pour une date donnée
function canModifyStockForDate(dateStr, username) {
    if (!username || !dateStr) return false;
    
    const currentUser = window.currentUser;
    if (!currentUser) return false;
    
    // Vérifier si l'utilisateur peut contourner les restrictions temporelles
    // Superviseurs et administrateurs peuvent modifier le stock pour n'importe quelle date
    const canBypassTimeRestrictions = currentUser.bypassTimeRestrictions || 
                                    currentUser.canModifyStockAnytime ||
                                    currentUser.role === 'superviseur' || 
                                    currentUser.role === 'admin';
    
    if (canBypassTimeRestrictions) {
        return true;
    }
    
    // Tous les autres utilisateurs sont soumis aux restrictions temporelles
    return canPerformActionForDate(dateStr);
}

// Fonction pour vérifier si un utilisateur peut modifier les champs du stock matin
function canModifyStockMatinFields(username) {
    if (!username) return false;
    
    const currentUser = window.currentUser;
    if (!currentUser) return false;
    
    // Vérifier si l'utilisateur a les permissions basées sur le rôle
    // Superviseurs et administrateurs peuvent modifier le stock matin
    const isSuperviseur = currentUser.role === 'superviseur' || currentUser.role === 'admin';
    const hasPermission = currentUser.canModifyStockAnytime || isSuperviseur;
    
    return hasPermission;
}

// Fonction pour vérifier les permissions admin dans la section Cash Payment
function checkCashPaymentAdminPermissions() {
    const currentUser = window.currentUser;
    const clearButton = document.getElementById('clear-cash-payment-data');
    const addManualPaymentButton = document.getElementById('add-manual-payment');
    const cashPaymentTitle = document.getElementById('cash-payment-title');
    
    if (currentUser && currentUser.role) {
        const userRole = currentUser.role.toLowerCase();
        const adminRoles = ['admin', 'superviseur']; // Rôles avec privilèges admin complets
        const superUserRoles = ['superutilisateur']; // Rôles superutilisateur
        
        if (adminRoles.includes(userRole)) {
            // Utilisateur admin/superviseur : permissions différenciées
            if (userRole === 'admin') {
                // ADMIN : accès complet (effacer + ajouter)
                if (clearButton) {
                    clearButton.style.display = 'inline-block';
                }
                if (addManualPaymentButton) {
                    addManualPaymentButton.style.display = 'inline-block';
                }
                if (cashPaymentTitle) {
                    cashPaymentTitle.textContent = 'Importation et Analyse des Paiements en Espèces';
                }
                console.log(`Utilisateur admin (${currentUser.username}) : accès complet - effacer et ajouter`);
            } else if (userRole === 'superviseur') {
                // SUPERVISEUR : ajouter seulement, pas effacer
                if (clearButton) {
                    clearButton.style.display = 'none';
                }
                if (addManualPaymentButton) {
                    addManualPaymentButton.style.display = 'inline-block';
                }
                if (cashPaymentTitle) {
                    cashPaymentTitle.textContent = 'Analyse des Paiements en Espèces';
                }
                console.log(`Utilisateur superviseur (${currentUser.username}) : peut ajouter mais pas effacer`);
            }
        } else if (superUserRoles.includes(userRole)) {
            // Superutilisateur : pas d'accès aux fonctions d'administration des paiements
            if (clearButton) {
                clearButton.style.display = 'none';
            }
            if (addManualPaymentButton) {
                addManualPaymentButton.style.display = 'none';
            }
            if (cashPaymentTitle) {
                cashPaymentTitle.textContent = 'Analyse des Paiements en Espèces';
            }
            console.log(`Superutilisateur (${currentUser.username}) : pas d'accès aux fonctions d'administration des paiements`);
        } else {
            // Utilisateur standard : cacher tous les boutons admin
            if (clearButton) {
                clearButton.style.display = 'none';
            }
            if (addManualPaymentButton) {
                addManualPaymentButton.style.display = 'none';
            }
            if (cashPaymentTitle) {
                cashPaymentTitle.textContent = 'Analyse des Paiements en Espèces';
            }
            console.log(`Utilisateur standard ${userRole} (${currentUser.username}) : tous les boutons admin cachés`);
        }
    } else {
        // Pas d'utilisateur connecté : cacher tous les boutons par sécurité
        if (clearButton) {
            clearButton.style.display = 'none';
        }
        if (addManualPaymentButton) {
            addManualPaymentButton.style.display = 'none';
        }
        if (cashPaymentTitle) {
            cashPaymentTitle.textContent = 'Analyse des Paiements en Espèces';
        }
        console.log('Aucun utilisateur connecté : tous les boutons admin cachés');
    }
}

// Fonction pour mettre à jour l'état des boutons du stock selon la date sélectionnée
function updateStockButtonsState() {
    const addStockButton = document.getElementById('add-stock-row');
    const saveStockButton = document.getElementById('save-stock');
    const dateInput = document.getElementById('date-inventaire');
    const typeStockSelect = document.getElementById('type-stock');
    
    if (!dateInput || !currentUser || !typeStockSelect) return;
    
    const selectedDate = dateInput.value;
    const typeStock = typeStockSelect.value;
    const canModify = canModifyStockForDate(selectedDate, currentUser.username);
    const isStockMatin = typeStock === 'matin';
    const canModifyMatinFields = canModifyStockMatinFields(currentUser.username);
    
    // Mettre à jour le bouton "Ajouter une ligne"
    if (addStockButton) {
        let shouldDisable = !canModify;
        let buttonText = '<i class="fas fa-plus"></i> Ajouter une ligne';
        let tooltipText = '';
        
        // Restrictions spéciales pour le stock matin
        if (isStockMatin && !canModifyMatinFields) {
            shouldDisable = true;
            buttonText = '<i class="fas fa-plus"></i> Ajouter une ligne (Stock matin automatique)';
            tooltipText = 'Le stock matin est rempli automatiquement par le système. Seuls les administrateurs peuvent le modifier manuellement.';
        } else if (!canModify) {
            buttonText = '<i class="fas fa-plus"></i> Ajouter une ligne (Date non autorisée)';
            tooltipText = 'Vous ne pouvez pas modifier le stock pour cette date. Modification autorisée seulement le jour J et jusqu\'au lendemain avant 4h00 du matin.';
        }
        
        if (shouldDisable) {
            addStockButton.disabled = true;
            addStockButton.classList.remove('btn-primary');
            addStockButton.classList.add('btn-secondary');
            addStockButton.innerHTML = buttonText;
            addStockButton.title = tooltipText;
        } else {
            addStockButton.disabled = false;
            addStockButton.classList.remove('btn-secondary');
            addStockButton.classList.add('btn-primary');
            addStockButton.innerHTML = buttonText;
            addStockButton.title = '';
        }
    }
    
    // Mettre à jour le bouton "Sauvegarder le stock"
    if (saveStockButton) {
        if (canModify) {
            saveStockButton.disabled = false;
            saveStockButton.classList.remove('btn-secondary');
            saveStockButton.classList.add('btn-success');
            saveStockButton.innerHTML = '<i class="fas fa-save"></i> Sauvegarder le stock';
            saveStockButton.title = '';
        } else {
            saveStockButton.disabled = true;
            saveStockButton.classList.remove('btn-success');
            saveStockButton.classList.add('btn-secondary');
            saveStockButton.innerHTML = '<i class="fas fa-save"></i> Sauvegarder le stock (Date non autorisée)';
            saveStockButton.title = 'Vous ne pouvez pas sauvegarder le stock pour cette date. Modification autorisée seulement le jour J et jusqu\'au lendemain avant 4h00 du matin.';
        }
    }
    
    // Mettre à jour l'état visuel des boutons de suppression existants
    const deleteButtons = document.querySelectorAll('#stock-table .btn-danger, #stock-table .btn-secondary');
    deleteButtons.forEach(button => {
        let shouldDisable = !canModify;
        let tooltipText = '';
        
        // Restrictions spéciales pour le stock matin
        if (isStockMatin && !canModifyMatinFields) {
            shouldDisable = true;
            tooltipText = 'Le stock matin est rempli automatiquement par le système. Seuls les administrateurs peuvent le modifier manuellement.';
        } else if (!canModify) {
            tooltipText = 'Vous ne pouvez pas supprimer cette ligne pour cette date. Modification autorisée seulement le jour J et jusqu\'au lendemain avant 4h00 du matin.';
        }
        
        if (shouldDisable) {
            button.disabled = true;
            button.classList.remove('btn-danger');
            button.classList.add('btn-secondary');
            button.title = tooltipText;
        } else {
            button.disabled = false;
            button.classList.remove('btn-secondary');
            button.classList.add('btn-danger');
            button.title = '';
        }
    });
    
    // Mettre à jour l'état des champs d'édition pour le stock matin
    if (isStockMatin && !canModifyMatinFields) {
        updateStockMatinFieldsState(false);
    } else {
        updateStockMatinFieldsState(true);
    }
}

// Fonction pour mettre à jour l'état des champs d'édition du stock matin
function updateStockMatinFieldsState(enabled) {
    const stockTableRows = document.querySelectorAll('#stock-table tbody tr');
    
    stockTableRows.forEach(row => {
        // Désactiver/activer les champs de sélection et de saisie
        const pointVenteSelect = row.querySelector('.point-vente-select');
        const produitSelect = row.querySelector('.produit-select');
        const quantiteInput = row.querySelector('.quantite-input');
        const prixUnitaireInput = row.querySelector('.prix-unitaire-input');
        const commentaireInput = row.querySelector('.commentaire-input');
        
        const fields = [pointVenteSelect, produitSelect, quantiteInput, prixUnitaireInput, commentaireInput];
        
        fields.forEach(field => {
            if (field) {
                field.disabled = !enabled;
                if (!enabled) {
                    field.style.backgroundColor = '#f8f9fa';
                    field.style.color = '#6c757d';
                    field.style.cursor = 'not-allowed';
                    field.title = 'Le stock matin est rempli automatiquement par le système. Seuls les administrateurs peuvent le modifier manuellement.';
                } else {
                    field.style.backgroundColor = '';
                    field.style.color = '';
                    field.style.cursor = '';
                    field.title = '';
                }
            }
        });
    });
}

// Fonction pour réinitialiser les champs client
function resetClientFields() {
    console.log('Réinitialisation des champs client');
    
    const clientNomInput = document.getElementById('client-nom');
    const clientNumeroInput = document.getElementById('client-numero');
    const clientAdresseInput = document.getElementById('client-adresse');
    const clientCreanceSelect = document.getElementById('client-creance');
    
    if (clientNomInput) clientNomInput.value = '';
    if (clientNumeroInput) clientNumeroInput.value = '';
    if (clientAdresseInput) clientAdresseInput.value = '';
    if (clientCreanceSelect) clientCreanceSelect.value = 'false'; // Reset à "Non" par défaut
}

// Fonction pour mettre à jour l'état du bouton Enregistrer selon la date sélectionnée
function updateSubmitButtonState() {
    const submitButton = document.querySelector('button[type="submit"]');
    const dateInput = document.getElementById('date');
    
    if (!submitButton || !dateInput || !currentUser) return;
    
    const selectedDate = dateInput.value;
    const canAdd = canAddSaleForDate(selectedDate, currentUser.username);
    
    if (canAdd) {
        submitButton.disabled = false;
        submitButton.classList.remove('btn-secondary');
        submitButton.classList.add('btn-primary');
        submitButton.textContent = 'Enregistrer';
        submitButton.title = '';
    } else {
        submitButton.disabled = true;
        submitButton.classList.remove('btn-primary');
        submitButton.classList.add('btn-secondary');
        submitButton.textContent = 'Enregistrer (Date non autorisée)';
        submitButton.title = 'Vous ne pouvez pas ajouter de ventes pour cette date. Les utilisateurs avec accès limité ne peuvent ajouter des ventes que le jour J et jusqu\'au lendemain avant 4h00 du matin. Seuls administrateurs sont exemptés de cette restriction.';
    }
}

// Ensure standardiserDate is defined before afficherDernieresVentes if it's not globally available
// For example, by moving its definition here or ensuring it's defined earlier in the script.
// Assuming standardiserDate is defined globally or earlier:

/**
 * Affiche la composition d'un pack en mode lecture seule
 */
function afficherCompositionPackReadOnly(nomPack, extensionData) {
    // Ouvrir le modal
    const modal = document.getElementById('packDetailsModal');
    if (!modal) return;
    
    const packModal = new bootstrap.Modal(modal);
    
    // Mettre à jour le titre
    document.getElementById('pack-name').textContent = nomPack;
    
    // Afficher la composition
    const tbody = document.getElementById('pack-composition-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (extensionData && extensionData.composition) {
        extensionData.composition.forEach((item, index) => {
            const row = document.createElement('tr');
            
            // Produit (texte uniquement)
            const tdProduit = document.createElement('td');
            tdProduit.textContent = item.produit;
            row.appendChild(tdProduit);
            
            // Quantité (texte uniquement)
            const tdQuantite = document.createElement('td');
            tdQuantite.textContent = item.quantite;
            row.appendChild(tdQuantite);
            
            // Unité (texte uniquement)
            const tdUnite = document.createElement('td');
            tdUnite.textContent = item.unite;
            if (item.poids_unitaire) {
                tdUnite.innerHTML += `<br><small class="text-muted">(${item.poids_unitaire}kg/pièce)</small>`;
            }
            row.appendChild(tdUnite);
            
            // Prix (informatif)
            const tdPrix = document.createElement('td');
            tdPrix.className = 'text-end';
            if (window.PackComposition) {
                // Utiliser la fonction du module si disponible
                const prix = window.produits ? getPrixProduitGlobal(item.produit) : null;
                tdPrix.textContent = prix ? `${prix.toLocaleString('fr-FR')} FCFA` : '-';
            } else {
                tdPrix.textContent = '-';
            }
            row.appendChild(tdPrix);
            
            // Pas de colonne Action en mode lecture seule
            const tdAction = document.createElement('td');
            tdAction.className = 'text-center text-muted';
            tdAction.innerHTML = '<i class="bi bi-lock"></i>';
            row.appendChild(tdAction);
            
            tbody.appendChild(row);
        });
    }
    
    // Masquer les boutons d'édition
    document.getElementById('add-pack-item').style.display = 'none';
    document.getElementById('reset-pack-composition').style.display = 'none';
    document.getElementById('save-pack-composition').style.display = 'none';
    
    // Afficher seulement le bouton Fermer
    const closeButton = modal.querySelector('[data-bs-dismiss="modal"]');
    if (closeButton) {
        closeButton.textContent = 'Fermer';
    }
    
    // Ajouter un message d'information
    const alertInfo = modal.querySelector('.alert-info');
    if (alertInfo) {
        alertInfo.innerHTML = '<i class="bi bi-info-circle"></i> <strong>Mode consultation</strong> - Cette composition a été enregistrée lors de la vente.';
        if (extensionData.modifie) {
            alertInfo.innerHTML += '<br><small class="text-warning"><i class="bi bi-exclamation-triangle"></i> Composition modifiée par rapport au pack standard</small>';
        }
    }
    
    // Quand le modal se ferme, réactiver les boutons
    modal.addEventListener('hidden.bs.modal', function () {
        document.getElementById('add-pack-item').style.display = '';
        document.getElementById('reset-pack-composition').style.display = '';
        document.getElementById('save-pack-composition').style.display = '';
        if (alertInfo) {
            alertInfo.innerHTML = '<i class="bi bi-info-circle"></i> Vous pouvez modifier les quantités selon les besoins du client.';
        }
    }, { once: true });
    
    packModal.show();
}

/**
 * Fonction helper pour obtenir le prix d'un produit (version globale)
 */
function getPrixProduitGlobal(nomProduit) {
    if (typeof window.produits === 'undefined') return null;
    
    for (const categorie in window.produits) {
        if (typeof window.produits[categorie] === 'object' && window.produits[categorie] !== null) {
            if (window.produits[categorie][nomProduit]) {
                const prixData = window.produits[categorie][nomProduit];
                return prixData.default || null;
            }
        }
    }
    return null;
}

function afficherDernieresVentes(ventes) {
    const tbody = document.querySelector("#dernieres-ventes tbody");
    if (!tbody) {
        console.error("Element tbody introuvable pour #dernieres-ventes");
        return;
    }
    tbody.innerHTML = ""; // Vider le tableau avant d'ajouter de nouvelles lignes

    // Standardiser la date pour la comparaison (definition moved up or assumed global)
    // const standardiserDate = (dateStr) => { ... } // Definition might be here or earlier

    ventes.forEach(vente => {
        const row = tbody.insertRow();
        
        // Distinction visuelle pour les ventes provenant de pré-commandes (en bleu)
        appliquerDistinctionVisuellePrecommande(row, vente);
        
        // Formater la date pour l'affichage en DD/MM/YYYY
        const displayDate = formaterDateAffichage(vente.Date);

        row.insertCell().textContent = vente.Mois || "";
        row.insertCell().textContent = displayDate;
        row.insertCell().textContent = vente.Semaine || "";
        row.insertCell().textContent = vente.PointDeVente || vente['Point de Vente'] || vente.pointVente|| "";
        row.insertCell().textContent = vente.Preparation || "";
        row.insertCell().textContent = formatCategorie(vente.Categorie || vente.Catégorie || vente.categorie || "");
        row.insertCell().textContent = vente.Produit || "";
        row.insertCell().textContent = vente.PU !== undefined && vente.PU !== null ? parseFloat(vente.PU).toLocaleString('fr-FR') : "";
        row.insertCell().textContent = vente.Nombre !== undefined && vente.Nombre !== null ? parseFloat(vente.Nombre).toLocaleString('fr-FR') : "";
        row.insertCell().textContent = vente.Montant !== undefined && vente.Montant !== null ? parseFloat(vente.Montant).toLocaleString('fr-FR') : "";
        row.insertCell().textContent = vente.nomClient || "";
        row.insertCell().textContent = vente.numeroClient || "";
        row.insertCell().textContent = vente.adresseClient || "";
        row.insertCell().textContent = (vente.creance === true || vente.creance === 'true' || vente.Creance === true || vente.Creance === 'true' || vente.Creance === 'Oui') ? 'Oui' : 'Non';

        const actionsCell = row.insertCell();
        actionsCell.style.textAlign = 'center';

        let showDeleteButton = false;
        const currentUser = window.currentUser; 
        const userRole = currentUser ? currentUser.username.toUpperCase() : null;
        const privilegedUsers = ['SALIOU', 'OUSMANE'];

        if (userRole && privilegedUsers.includes(userRole)) {
            // Utilisateurs privilégiés : bouton toujours visible
            showDeleteButton = true;
        } else if (userRole) {
            // Tous les autres utilisateurs (y compris TEST) : vérifier les restrictions temporelles de 4h
            if (canPerformActionForDate(vente.Date)) {
                showDeleteButton = true;
            }
        }

        // Bouton pour afficher la composition du pack (si c'est un pack avec extension)
        const categorie = vente.Categorie || vente.Catégorie || vente.categorie || '';
        if (categorie === 'Pack' && vente.extension) {
            const viewPackButton = document.createElement('button');
            viewPackButton.className = 'btn btn-info btn-sm me-1';
            viewPackButton.innerHTML = '<i class="bi bi-eye"></i>';
            viewPackButton.title = 'Voir composition du pack';
            viewPackButton.addEventListener('click', () => {
                afficherCompositionPackReadOnly(vente.Produit, vente.extension);
            });
            actionsCell.appendChild(viewPackButton);
        }
        
        if (showDeleteButton) {
            const deleteButton = document.createElement('button');
            deleteButton.className = 'btn btn-danger btn-sm delete-vente';
            deleteButton.setAttribute('data-id', vente.id);
            deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
            deleteButton.addEventListener('click', async () => {
                if (confirm('Êtes-vous sûr de vouloir supprimer cette vente ?')) {
                    await supprimerVente(vente.id); 
                }
            });
            actionsCell.appendChild(deleteButton);
        }
    });
}

/**
 * Fetches active points of sale from the server and populates all relevant dropdowns.
 */
// Fonction pour obtenir les points de vente autorisés pour l'utilisateur actuel
function getUserAuthorizedPointsVente() {
    if (!currentUser || !currentUser.pointVente) {
        return [];
    }
    
    // Si c'est un tableau, le retourner tel quel
    if (Array.isArray(currentUser.pointVente)) {
        return currentUser.pointVente;
    }
    
    // Si c'est une chaîne, la convertir en tableau
    return [currentUser.pointVente];
}

async function populatePointVenteDropdowns() {
    console.log('Fetching active points of sale...');
    try {
        const response = await fetch('/api/points-vente');
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        const activePointsVente = await response.json();

        // Mettre à jour POINTS_VENTE_PHYSIQUES avec les points de vente actifs
        POINTS_VENTE_PHYSIQUES = activePointsVente;
        
        // Mettre à jour TOUS_POINTS_VENTE avec les nouveaux points de vente actifs
        await initTousPointsVente();

        // Add the IDs of all point-de-vente dropdowns here
        const dropdownIds = [
            'point-vente', 
            'point-vente-select',
            'estimation-point-vente',
            'point-vente-filtre', 
            'point-vente-filtre-mois',
            'point-vente-filter-cash',
            'filter-point-vente',
            'pointVenteFilter', 
            'pointVenteCopieSource',
            'pointVenteCopieDestination',
            'filtre-point-vente-transfert'
        ];

        dropdownIds.forEach(id => {
            const selectElement = document.getElementById(id);
            if (selectElement) {
                const currentValue = selectElement.value; // Save current value

                // Clear existing options but keep the first one (the placeholder)
                while (selectElement.options.length > 1) {
                    selectElement.remove(1);
                }

                // Filtrer les points de vente selon les droits de l'utilisateur
                const userPointsVente = getUserAuthorizedPointsVente();
                // Add new options from the server (only authorized ones)
                activePointsVente.forEach(pv => {
                    // Montrer le point de vente si l'utilisateur y a accès
                    if (userPointsVente.includes('tous') || userPointsVente.includes(pv)) {
                        const option = document.createElement('option');
                        option.value = pv;
                        option.textContent = pv;
                        selectElement.appendChild(option);
                    }
                });
                
                // Réactiver le dropdown s'il a des options
                if (selectElement.options.length > 1 && selectElement.disabled) {
                    selectElement.disabled = false;
                }
                
                // Restore the old value if it's still valid
                if (activePointsVente.includes(currentValue)) {
                    selectElement.value = currentValue;
                }
            }
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des points de vente:', error);
        alert('Impossible de charger la liste des points de vente. Veuillez vérifier la console.');
    }
}

// Fonction pour charger les dernières ventes
async function chargerDernieresVentes() {
    try {
        console.log('Début du chargement des dernières ventes');
        
        // Récupérer le point de vente et la date sélectionnés dans le formulaire
        const pointVenteSelectionne = document.getElementById('point-vente').value;
        const dateSelectionnee = document.getElementById('date').value;
        
        // Convertir la date sélectionnée dans un format comparable
        function getComparableDate(dateStr) {
            if (!dateStr) return null;
            let jour, mois, annee;
    
            // Regex pour détecter YYYY-MM-DD
            const ymdRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
            const ymdMatch = dateStr.match(ymdRegex);
    
            if (ymdMatch) {
                annee = ymdMatch[1];
                mois = ymdMatch[2];
                jour = ymdMatch[3];
            } else if (dateStr.includes('/')) { // Format DD/MM/YYYY ou DD/MM/YY
                [jour, mois, annee] = dateStr.split('/');
                if (annee.length === 2) {
                    annee = '20' + annee;
                }
            } else if (dateStr.includes('-')) { // Format DD-MM-YYYY ou DD-MM-YY
                 [jour, mois, annee] = dateStr.split('-');
                 // Vérifier si le premier segment est l'année (YYYY-MM-DD incorrectement capturé)
                 if (jour.length === 4) { // Probablement YYYY-MM-DD
                     annee = jour;
                     jour = dateStr.split('-')[2]; // Réassigner correctement
                 } else if (annee.length === 2) {
                    annee = '20' + annee;
                }
            } else {
                return null; // Format non reconnu
            }

            // Vérifier que toutes les parties sont valides après parsing
            if (!jour || !mois || !annee || isNaN(parseInt(jour)) || isNaN(parseInt(mois)) || isNaN(parseInt(annee))) { 
                 console.warn(`[getComparableDate chargerDernieresVentes] Invalid date parts for input: '${dateStr}' -> j:${jour}, m:${mois}, a:${annee}`);
                 return null;
            }
    
            // Return in DD-MM-YYYY format to match database format
            return `${String(jour).padStart(2, '0')}-${String(mois).padStart(2, '0')}-${annee}`;
        }
        
        const dateSelectionneeFmt = getComparableDate(dateSelectionnee);
        
        console.log('Point de vente sélectionné:', pointVenteSelectionne);
        console.log('Date sélectionnée:', dateSelectionnee, '(Format comparable:', dateSelectionneeFmt, ')');
        
        const response = await fetch('/api/dernieres-ventes', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Structure complète des données reçues:', data);
        
        if (data.success && Array.isArray(data.dernieresVentes)) {
            console.log('Premier élément des ventes:', data.dernieresVentes[0]);
            
            // Filtrer les ventes selon:
            // 1. Droits de l'utilisateur
            // 2. Point de vente sélectionné
            // 3. Date sélectionnée
            let ventesAffichees = data.dernieresVentes;
           
            
            // 1. Filtrer selon les droits de l'utilisateur
            if (currentUser && currentUser.pointVente !== "tous" && !(Array.isArray(currentUser.pointVente) && currentUser.pointVente.includes("tous"))) {
                const userPointVente = currentUser.pointVente;
                if (Array.isArray(userPointVente)) {
                    ventesAffichees = ventesAffichees.filter(vente => 
                        userPointVente.includes(vente['Point de Vente'])
                    );
                } else {
                    ventesAffichees = ventesAffichees.filter(vente => 
                        vente['Point de Vente'] === userPointVente
                    );
                }
            }
            
            // 2. Filtrer selon le point de vente sélectionné (si présent)
            if (pointVenteSelectionne) {
                ventesAffichees = ventesAffichees.filter(vente => 
                    vente['Point de Vente'] === pointVenteSelectionne
                );
            }
            
            // 3. Filtrer selon la date sélectionnée (si présente)
            if (dateSelectionneeFmt) {
                console.log(`[Filter Debug] Filtering for date: ${dateSelectionneeFmt}`); // Log the target date
                console.log(`[Filter Debug] Total entries before filtering: ${ventesAffichees.length}`);
                const originalCount = ventesAffichees.length;
                ventesAffichees = ventesAffichees.filter((vente, index) => {
                    const venteDateStr = vente.Date;
                    const venteDateComparable = getComparableDate(venteDateStr);
                    
                    // Compare both formats: DD-MM-YYYY and DD/MM/YYYY
                    const dateSelectionneeFmtSlash = dateSelectionneeFmt.replace(/-/g, '/');
                    const dateSelectionneeFmtDash = dateSelectionneeFmt.replace(/\//g, '-');
                    
                    const match = venteDateComparable === dateSelectionneeFmt || 
                                  venteDateComparable === dateSelectionneeFmtSlash || 
                                  venteDateComparable === dateSelectionneeFmtDash;

                    // Log details for the first 5 entries for debugging
                    if (index < 5) {
                         console.log(`[Filter Debug] Entry ${index + 1} (PV: ${vente['Point de Vente']}): DB Date='${venteDateStr}', Comparable='${venteDateComparable}', Target='${dateSelectionneeFmt}', Slash='${dateSelectionneeFmtSlash}', Dash='${dateSelectionneeFmtDash}', Match=${match}`);
                    }

                    return match;
                });
                 console.log(`[Filter Debug] Date filter removed ${originalCount - ventesAffichees.length} entries.`); // Log how many were removed
            }
            
            // Trier les ventes par date en ordre décroissant (pour celles qui partagent la même date)
            ventesAffichees.sort((a, b) => {
                // Fonction pour parser les dates au format DD/MM/YYYY ou DD-MM-YY
                const parseDate = (dateStr) => {
                    if (!dateStr) return new Date(0); // Date minimum si pas de date
                    
                    let jour, mois, annee;
                    if (dateStr.includes('/')) {
                        [jour, mois, annee] = dateStr.split('/');
                    } else if (dateStr.includes('-')) {
                        [jour, mois, annee] = dateStr.split('-');
                    } else {
                        return new Date(0);
                    }
                    
                    // Convertir l'année à 2 chiffres en 4 chiffres
                    if (annee && annee.length === 2) {
                        annee = '20' + annee;
                    }
                    
                    return new Date(parseInt(annee), parseInt(mois) - 1, parseInt(jour));
                };
                
                const dateA = parseDate(a.Date);
                const dateB = parseDate(b.Date);
                
                // Trier par date décroissante (du plus récent au plus ancien)
                return dateB - dateA;
            });
            
            console.log('Données filtrées et triées, affichage des ventes:', ventesAffichees.length, 'entrées');
            afficherDernieresVentes(ventesAffichees);
            
            // Recalculer le total général après avoir chargé les ventes
            calculerTotalGeneral();
        } else {
            console.error('Format de données invalide pour les dernières ventes:', data);
            const tbody = document.querySelector('#dernieres-ventes tbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="16" class="text-center">Aucune donnée disponible</td></tr>';
        }
    } catch (error) {
        console.error('Erreur lors du chargement des dernières ventes:', error);
        const tbody = document.querySelector('#dernieres-ventes tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="16" class="text-center text-danger">Erreur: ' + error.message + '</td></tr>';
    }
}

// Charger les dernières ventes au démarrage
chargerDernieresVentes();

// Variables pour les graphiques
let ventesParMoisChart = null;
let ventesParProduitChart = null;
let ventesParCategorieChart = null;

// Fonction pour créer le graphique des ventes par mois
function creerGraphiqueVentesParMois(donnees) {
    console.log('Création du graphique par mois avec les données:', donnees);
    const ctx = document.getElementById('ventesParMoisChart');
    if (!ctx) {
        console.error('Canvas ventesParMoisChart non trouvé');
        return;
    }
    console.log('Canvas ventesParMoisChart trouvé');

    // Si le graphique existe déjà, le mettre à jour au lieu de le détruire
    if (ventesParMoisChart) {
        console.log('Mise à jour du graphique existant');
    } else {
        console.log('Création d\'un nouveau graphique');
    }

    // Regrouper les ventes par date
    const ventesParJour = {};
    donnees.forEach(vente => {
        const dateStandard = formaterDateAffichage(vente.Date || '');
        if (!dateStandard) return;
        
        if (!ventesParJour[dateStandard]) {
            ventesParJour[dateStandard] = 0;
        }
        ventesParJour[dateStandard] += parseFloat(vente.Montant || 0);
    });

    console.log('Ventes regroupées par jour:', ventesParJour);

    // Convertir en tableaux et trier par date
    const dates = Object.keys(ventesParJour).sort((a, b) => {
        if (!a.includes('/') || !b.includes('/')) return 0;
        
        const [jourA, moisA, anneeA] = a.split('/');
        const [jourB, moisB, anneeB] = b.split('/');
        
        const dateA = new Date(20 + anneeA, parseInt(moisA) - 1, parseInt(jourA));
        const dateB = new Date(20 + anneeB, parseInt(moisB) - 1, parseInt(jourB));
        
        return dateA - dateB;
    });

    const montants = dates.map(date => ventesParJour[date]);

    // Si le graphique existe déjà, le mettre à jour
    if (ventesParMoisChart) {
        ventesParMoisChart.data.labels = dates;
        ventesParMoisChart.data.datasets[0].data = montants;
        ventesParMoisChart.update('none'); // Mise à jour sans animation
        console.log('Graphique mis à jour avec succès');
        return;
    }

    // Créer le nouveau graphique
    ventesParMoisChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: 'Ventes par jour',
                data: montants,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderWidth: 2,
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('fr-FR') + ' FCFA';
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toLocaleString('fr-FR') + ' FCFA';
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

// Fonction pour créer le graphique des ventes par produit
function creerGraphiqueVentesParProduit(donnees) {
    console.log('Création du graphique par produit avec les données:', donnees);
    const ctx = document.getElementById('ventesParProduitChart');
    if (!ctx) {
        console.error('Canvas ventesParProduitChart non trouvé');
        return;
    }
    console.log('Canvas ventesParProduitChart trouvé');

    // Si le graphique existe déjà, le mettre à jour au lieu de le détruire
    if (ventesParProduitChart) {
        console.log('Mise à jour du graphique existant');
    } else {
        console.log('Création d\'un nouveau graphique');
    }

    // Regrouper les ventes par produit
    const ventesParProduit = {};
    donnees.forEach(vente => {
        const produit = vente.Produit || '';
        if (!ventesParProduit[produit]) {
            ventesParProduit[produit] = 0;
        }
        ventesParProduit[produit] += parseFloat(vente.Montant || 0);
    });

    // Trier les produits par montant décroissant
    const sortedProduits = Object.entries(ventesParProduit)
        .sort(([, a], [, b]) => b - a);

    // Préparer les données pour le graphique
    const labels = sortedProduits.map(([produit]) => produit);
    const montants = sortedProduits.map(([, montant]) => montant);

    // Si le graphique existe déjà, le mettre à jour
    if (ventesParProduitChart) {
        ventesParProduitChart.data.labels = labels;
        ventesParProduitChart.data.datasets[0].data = montants;
        ventesParProduitChart.update('none'); // Mise à jour sans animation
        console.log('Graphique produit mis à jour avec succès');
        
        // Stocker les données globalement pour le filtrage
        donneesVentesGlobales = donnees;
        
        // Créer également le tableau des ventes par point de vente
        creerTableauVentesParPointVente(donnees);
        
        // Ajouter l'event listener pour les filtres si pas encore fait
        ajouterEventListenerFiltreMois();
        
        // Initialiser le tableau avec le filtrage par dates par défaut
        initialiserTableauPointVente();
        return;
    }

    // Créer le nouveau graphique
    ventesParProduitChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ventes par produit',
                data: montants,
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgb(54, 162, 235)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('fr-FR') + ' FCFA';
                        }
                    }
                }
            }
        }
    });
    
    // Stocker les données globalement pour le filtrage
    donneesVentesGlobales = donnees;
    
    // Créer également le tableau des ventes par point de vente
    creerTableauVentesParPointVente(donnees);
    
    // Ajouter l'event listener pour les filtres si pas encore fait
    ajouterEventListenerFiltreMois();
    
    // Initialiser le tableau avec le filtrage par dates par défaut
    initialiserTableauPointVente();
}

// Fonction pour créer le tableau des ventes par point de vente
async function creerTableauVentesParPointVente(donnees = null, moisFiltre = null) {
    console.log('Création du tableau des ventes par point de vente');
    
    try {
        // Déterminer le type de filtrage à utiliser
        const filterType = document.getElementById('filterTypePointVente').value;
        console.log('Type de filtrage sélectionné:', filterType);
        
        let toutesLesVentes;
        
        if (filterType === 'dates') {
            // Utiliser les données filtrées par dates de la fonction chargerVentes
            // Récupérer les dates des filtres principaux
            const dateDebut = document.getElementById('date-debut').value;
            const dateFin = document.getElementById('date-fin').value;
            const pointVente = document.getElementById('point-vente-select').value;
            
            console.log('Filtrage par plage de dates:', { dateDebut, dateFin, pointVente });
            
            // Convertir les dates au format API (YYYY-MM-DD)
            const formatDateForApi = (dateStr, isEndDate = false) => {
                if (!dateStr) return '';
                const [jour, mois, annee] = dateStr.split('/');
                
                let year = parseInt(annee);
                let month = parseInt(mois);
                let day = parseInt(jour);
                
                // Ne pas ajouter de jour supplémentaire pour la date de fin
                // La logique de filtrage côté serveur gère déjà correctement les limites
                
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            };
            
            const debut = formatDateForApi(dateDebut);
            const fin = formatDateForApi(dateFin);
            
            console.log('Dates converties pour API:', { debut, fin });
            
            // Construire l'URL avec les paramètres de filtrage
            const params = new URLSearchParams();
            if (debut) params.append('dateDebut', debut);
            if (fin) params.append('dateFin', fin);
            if (pointVente && pointVente !== '') params.append('pointVente', pointVente);
            
            const ventesResponse = await fetch(`/api/ventes?${params.toString()}`);
            const ventesData = await ventesResponse.json();
            
            if (!ventesData.success) {
                throw new Error('Erreur lors de la récupération des ventes filtrées');
            }
            
            toutesLesVentes = ventesData.ventes;
            console.log('Ventes filtrées par plage de dates:', toutesLesVentes.length);
            console.log('URL utilisée:', `/api/ventes?${params.toString()}`);
            console.log('Premières ventes récupérées:', toutesLesVentes.slice(0, 3));
            console.log('Dates des premières ventes:', toutesLesVentes.slice(0, 3).map(v => v.Date || v.date));
            
            // Mettre à jour le titre du tableau avec la plage de dates
            updateTitreTableauAvecDates(dateDebut, dateFin);
            
        } else {
            // Mode mois (comportement original)
        // Initialiser le filtre de mois si pas encore fait
        if (!moisFiltre) {
            initialiserFiltreDefautMois();
            moisFiltre = document.getElementById('moisFilterPointVente').value;
        }
        
        // Récupérer TOUTES les ventes via l'API dernieres-ventes (pas les données filtrées de chargerVentes)
        const ventesResponse = await fetch('/api/dernieres-ventes');
        const ventesData = await ventesResponse.json();
        
        if (!ventesData.success) {
            throw new Error('Erreur lors de la récupération des ventes');
        }
        
        // Utiliser toutes les ventes disponibles, pas les données partielles
            toutesLesVentes = ventesData.dernieresVentes;
        console.log('Toutes les ventes récupérées pour le tableau:', toutesLesVentes.length);
            
            // Mettre à jour le titre du tableau avec le mois sélectionné
            updateTitreTableauAvecMois(moisFiltre);
        }
        
        // Récupérer la liste des points de vente actifs via l'API
        const response = await fetch('/api/points-vente');
        const pointsVenteActifs = await response.json();
        console.log('Points de vente actifs récupérés:', pointsVenteActifs);
        
        // Filtrer les données par mois si un filtre est spécifié
        let donneesFiltered = toutesLesVentes;
        
        // Appliquer le filtrage par mois seulement si le mode mois est sélectionné
        if (filterType === 'mois' && moisFiltre && moisFiltre !== '') {
            donneesFiltered = toutesLesVentes.filter(vente => {
                const dateVente = vente.Date || vente.date || '';
                if (dateVente) {
                    // Parser la date au format DD-MM-YYYY ou DD/MM/YYYY
                    let dateObj;
                    if (dateVente.includes('-')) {
                        const [jour, mois, annee] = dateVente.split('-');
                        dateObj = new Date(annee, parseInt(mois) - 1, parseInt(jour));
                    } else if (dateVente.includes('/')) {
                        const [jour, mois, annee] = dateVente.split('/');
                        dateObj = new Date(annee, parseInt(mois) - 1, parseInt(jour));
                    } else {
                        dateObj = new Date(dateVente);
                    }
                    
                    const moisVente = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0');
                    return moisVente === moisFiltre;
                }
                return false;
            });
            console.log(`Données filtrées pour le mois ${moisFiltre}:`, donneesFiltered.length, 'ventes');
        }
        
        // Regrouper les ventes par point de vente
        const ventesParPointVente = {};
        const nombreVentesParPointVente = {};
        
        // Initialiser tous les points de vente actifs avec 0
        pointsVenteActifs.forEach(pdv => {
            ventesParPointVente[pdv] = 0;
            nombreVentesParPointVente[pdv] = 0;
        });
        
        // Calculer les totaux par point de vente avec les données filtrées
        donneesFiltered.forEach(vente => {
            const pointVente = vente.pointVente || vente['Point de Vente'] || '';
            const montant = parseFloat(vente.Montant || vente.montant || 0);
            
            if (pointVente) {
                // Initialiser le point de vente s'il n'existe pas encore (même s'il n'est pas dans les actifs)
                if (!ventesParPointVente.hasOwnProperty(pointVente)) {
                    ventesParPointVente[pointVente] = 0;
                    nombreVentesParPointVente[pointVente] = 0;
                }
                
                ventesParPointVente[pointVente] += montant;
                nombreVentesParPointVente[pointVente]++;
            }
        });
        
        // Calculer le total général pour les pourcentages
        const totalGeneral = Object.values(ventesParPointVente).reduce((sum, montant) => sum + montant, 0);
        
        // Trier les points de vente par montant décroissant
        const sortedPointsVente = Object.entries(ventesParPointVente)
            .sort(([, a], [, b]) => b - a);
        
        // Remplir le tableau
        const tableBody = document.getElementById('ventesParPointVenteBody');
        if (!tableBody) {
            console.error('Element ventesParPointVenteBody non trouvé');
            return;
        }
        
        tableBody.innerHTML = '';
        
        sortedPointsVente.forEach(([pointVente, montant]) => {
            const pourcentage = totalGeneral > 0 ? (montant / totalGeneral * 100) : 0;
            const nombreVentes = nombreVentesParPointVente[pointVente];
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="fw-bold">${pointVente}</td>
                <td class="text-end">${montant.toLocaleString('fr-FR')} FCFA</td>
                <td class="text-end">
                    <span class="badge bg-primary">${pourcentage.toFixed(1)}%</span>
                </td>
                <td class="text-end">${nombreVentes}</td>
            `;
            
            // Ajouter une couleur de fond basée sur le pourcentage
            if (pourcentage >= 20) {
                row.classList.add('table-success');
            } else if (pourcentage >= 10) {
                row.classList.add('table-warning');
            } else if (montant > 0) {
                row.classList.add('table-info');
            } else {
                row.classList.add('table-light');
            }
            
            tableBody.appendChild(row);
        });
        
        // Ajouter une ligne de total
        const totalRow = document.createElement('tr');
        totalRow.classList.add('table-dark', 'fw-bold');
        totalRow.innerHTML = `
            <td>TOTAL</td>
            <td class="text-end">${totalGeneral.toLocaleString('fr-FR')} FCFA</td>
            <td class="text-end">100.0%</td>
            <td class="text-end">${Object.values(nombreVentesParPointVente).reduce((sum, nb) => sum + nb, 0)}</td>
        `;
        tableBody.appendChild(totalRow);
        
        console.log('Tableau des ventes par point de vente créé avec succès');
        
        // Activer les boutons d'export après la création du tableau
        activerBoutonsExportPointVente(sortedPointsVente, totalGeneral, Object.values(nombreVentesParPointVente).reduce((sum, nb) => sum + nb, 0));
        
        // Mettre à jour le titre avec le mois sélectionné si un filtre est appliqué
        updateTitreTableauAvecMois(moisFiltre);
        
    } catch (error) {
        console.error('Erreur lors de la création du tableau des ventes par point de vente:', error);
        
        // Afficher un message d'erreur dans le tableau
        const tableBody = document.getElementById('ventesParPointVenteBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-danger">
                        <i class="fas fa-exclamation-triangle"></i>
                        Erreur lors du chargement des données des points de vente
                    </td>
                </tr>
            `;
        }
    }
}

// Fonction pour initialiser le filtre de mois avec le mois en cours
function initialiserFiltreDefautMois() {
    const moisFilter = document.getElementById('moisFilterPointVente');
    if (moisFilter && !moisFilter.value) {
        const maintenant = new Date();
        const moisCourant = maintenant.getFullYear() + '-' + String(maintenant.getMonth() + 1).padStart(2, '0');
        moisFilter.value = moisCourant;
        console.log(`Filtre de mois initialisé au mois en cours: ${moisCourant}`);
    }
}

// Fonction pour mettre à jour le titre du tableau avec le mois sélectionné
function updateTitreTableauAvecMois(moisFiltre) {
    // Chercher spécifiquement le titre du tableau des ventes par point de vente
    const tableCard = document.getElementById('ventesParPointVenteTable')?.closest('.card');
    const titre = tableCard?.querySelector('.card-title');
    
    if (titre && moisFiltre) {
        const [annee, mois] = moisFiltre.split('-');
        const moisNoms = [
            'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
            'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
        ];
        const nomMois = moisNoms[parseInt(mois) - 1];
        titre.textContent = `Ventes par Point de Vente - ${nomMois} ${annee}`;
    } else if (titre) {
        titre.textContent = 'Ventes par Point de Vente';
    }
}

// Fonction pour mettre à jour le titre du tableau avec la plage de dates
function updateTitreTableauAvecDates(dateDebut, dateFin) {
    console.log('Mise à jour du titre avec la plage de dates:', { dateDebut, dateFin });
    const tableCard = document.getElementById('ventesParPointVenteTable')?.closest('.card');
    const titre = tableCard?.querySelector('.card-title');
    
    if (titre && dateDebut && dateFin) {
        // Convertir les dates au format DD/MM/YYYY si nécessaire
        const formatDate = (dateStr) => {
            if (dateStr.includes('/')) {
                return dateStr;
            } else if (dateStr.includes('-')) {
                const [jour, mois, annee] = dateStr.split('-');
                return `${jour}/${mois}/${annee}`;
            }
            return dateStr;
        };
        
        const debutFormate = formatDate(dateDebut);
        const finFormate = formatDate(dateFin);
        titre.textContent = `Ventes par Point de Vente - ${debutFormate} au ${finFormate}`;
    } else if (titre) {
        titre.textContent = 'Ventes par Point de Vente';
    }
}

// Variable globale pour stocker les données des ventes (pour le filtrage)
let donneesVentesGlobales = [];

// Fonction pour initialiser le tableau des ventes par point de vente avec le filtrage par dates par défaut
function initialiserTableauPointVente() {
    const filterTypeSelect = document.getElementById('filterTypePointVente');
    if (filterTypeSelect && !filterTypeSelect.hasAttribute('data-initialized')) {
        // Définir le filtrage par dates comme option par défaut
        filterTypeSelect.value = 'dates';
        
        // Afficher/masquer les contrôles appropriés
        const moisContainer = document.getElementById('moisFilterContainer');
        const datesContainer = document.getElementById('datesFilterContainer');
        
        if (moisContainer && datesContainer) {
            moisContainer.style.display = 'none';
            datesContainer.style.display = 'flex';
        }
        
        // Marquer comme initialisé
        filterTypeSelect.setAttribute('data-initialized', 'true');
        console.log('Tableau des ventes par point de vente initialisé avec le filtrage par dates par défaut');
    }
}

// Fonction pour ajouter les event listeners des filtres du tableau des ventes par point de vente
function ajouterEventListenerFiltreMois() {
    // Event listener pour le filtre de mois
    const moisFilter = document.getElementById('moisFilterPointVente');
    if (moisFilter && !moisFilter.hasAttribute('data-listener-added')) {
        moisFilter.addEventListener('change', function() {
            const moisSelectionne = this.value;
            console.log(`Mois sélectionné: ${moisSelectionne}`);
            
            if (donneesVentesGlobales.length > 0) {
                creerTableauVentesParPointVente(donneesVentesGlobales, moisSelectionne);
            }
        });
        
        // Marquer que l'event listener a été ajouté
        moisFilter.setAttribute('data-listener-added', 'true');
        console.log('Event listener ajouté au filtre de mois');
    }
    
    // Event listener pour le changement de type de filtrage
    const filterTypeSelect = document.getElementById('filterTypePointVente');
    if (filterTypeSelect && !filterTypeSelect.hasAttribute('data-listener-added')) {
        filterTypeSelect.addEventListener('change', function() {
            const filterType = this.value;
            console.log(`Type de filtrage changé: ${filterType}`);
            
            // Afficher/masquer les contrôles appropriés
            const moisContainer = document.getElementById('moisFilterContainer');
            const datesContainer = document.getElementById('datesFilterContainer');
            
            if (filterType === 'dates') {
                moisContainer.style.display = 'none';
                datesContainer.style.display = 'flex';
                
                // Synchroniser les dates avec les filtres principaux
                const dateDebut = document.getElementById('date-debut').value;
                const dateFin = document.getElementById('date-fin').value;
                
                if (dateDebut && dateFin) {
                    dateDebutPointVentePicker.setDate(dateDebut);
                    dateFinPointVentePicker.setDate(dateFin);
                }
                
                // Recharger le tableau avec le filtrage par dates
                creerTableauVentesParPointVente();
                
            } else {
                moisContainer.style.display = 'flex';
                datesContainer.style.display = 'none';
                
                // Recharger le tableau avec le filtrage par mois
                creerTableauVentesParPointVente();
            }
        });
        
        // Marquer que l'event listener a été ajouté
        filterTypeSelect.setAttribute('data-listener-added', 'true');
        console.log('Event listener ajouté au sélecteur de type de filtrage');
    }
}

// Fonction pour activer les boutons d'export du tableau des ventes par point de vente
function activerBoutonsExportPointVente(donneesTriees, totalGeneral, totalVentes) {
    // Bouton d'export Excel
    const btnExcel = document.getElementById('exportExcelPointVente');
    if (btnExcel) {
        // Enlever les anciens event listeners
        btnExcel.replaceWith(btnExcel.cloneNode(true));
        const newBtnExcel = document.getElementById('exportExcelPointVente');
        
        newBtnExcel.addEventListener('click', () => {
            exporterTableauExcel(donneesTriees, totalGeneral, totalVentes);
        });
    }
    
    // Bouton de copie
    const btnCopy = document.getElementById('copyTablePointVente');
    if (btnCopy) {
        // Enlever les anciens event listeners
        btnCopy.replaceWith(btnCopy.cloneNode(true));
        const newBtnCopy = document.getElementById('copyTablePointVente');
        
        newBtnCopy.addEventListener('click', () => {
            copierTableauPointVente(donneesTriees, totalGeneral, totalVentes);
        });
    }
}

// Fonction pour exporter le tableau en Excel
function exporterTableauExcel(donneesTriees, totalGeneral, totalVentes) {
    try {
        // Préparer les données pour Excel
        const donneesExcel = [
            ['Point de Vente', 'Montant Total (FCFA)', 'Pourcentage (%)', 'Nombre de Ventes']
        ];
        
        // Ajouter les données des points de vente
        donneesTriees.forEach(([pointVente, montant]) => {
            const pourcentage = totalGeneral > 0 ? (montant / totalGeneral * 100) : 0;
            const nombreVentes = donneesTriees.find(([pdv]) => pdv === pointVente)?.[2] || 0;
            
            // Chercher le nombre de ventes dans les données originales
            const tableBody = document.getElementById('ventesParPointVenteBody');
            const rows = tableBody.querySelectorAll('tr:not(.table-dark)');
            let nombreVentesActuel = 0;
            
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 4 && cells[0].textContent.trim() === pointVente) {
                    nombreVentesActuel = parseInt(cells[3].textContent.trim()) || 0;
                }
            });
            
            donneesExcel.push([
                pointVente,
                montant,
                parseFloat(pourcentage.toFixed(1)),
                nombreVentesActuel
            ]);
        });
        
        // Ajouter la ligne de total
        donneesExcel.push([
            'TOTAL',
            totalGeneral,
            100.0,
            totalVentes
        ]);
        
        // Créer le workbook
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(donneesExcel);
        
        // Styliser les en-têtes (optionnel, support limité dans SheetJS gratuit)
        ws['!cols'] = [
            { wch: 15 }, // Point de Vente
            { wch: 20 }, // Montant Total
            { wch: 15 }, // Pourcentage
            { wch: 18 }  // Nombre de Ventes
        ];
        
        // Ajouter la feuille au workbook
        XLSX.utils.book_append_sheet(wb, ws, "Ventes par Point de Vente");
        
        // Générer le nom de fichier avec la date
        const maintenant = new Date();
        const dateStr = maintenant.toISOString().split('T')[0];
        const nomFichier = `ventes_par_point_de_vente_${dateStr}.xlsx`;
        
        // Télécharger le fichier
        XLSX.writeFile(wb, nomFichier);
        
        // Afficher un message de succès
        afficherNotification('Export Excel réussi !', 'success');
        
    } catch (error) {
        console.error('Erreur lors de l\'export Excel:', error);
        afficherNotification('Erreur lors de l\'export Excel', 'error');
    }
}

// Fonction pour copier le tableau dans le presse-papiers
async function copierTableauPointVente(donneesTriees, totalGeneral, totalVentes) {
    try {
        // Préparer le texte à copier (format tabulé)
        let texteTablau = 'Point de Vente\tMontant Total (FCFA)\tPourcentage\tNombre de Ventes\n';
        
        // Ajouter les données des points de vente
        const tableBody = document.getElementById('ventesParPointVenteBody');
        const rows = tableBody.querySelectorAll('tr:not(.table-dark)');
        
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
                const pointVente = cells[0].textContent.trim();
                const montant = cells[1].textContent.trim();
                const pourcentage = cells[2].textContent.trim().replace(/[^\d.,]/g, '') + '%';
                const nombreVentes = cells[3].textContent.trim();
                
                texteTablau += `${pointVente}\t${montant}\t${pourcentage}\t${nombreVentes}\n`;
            }
        });
        
        // Ajouter la ligne de total
        texteTablau += `TOTAL\t${totalGeneral.toLocaleString('fr-FR')} FCFA\t100.0%\t${totalVentes}`;
        
        // Copier dans le presse-papiers
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(texteTablau);
            afficherNotification('Tableau copié dans le presse-papiers !', 'success');
        } else {
            // Fallback pour les navigateurs plus anciens
            const textArea = document.createElement('textarea');
            textArea.value = texteTablau;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    afficherNotification('Tableau copié dans le presse-papiers !', 'success');
                } else {
                    throw new Error('Commande copy non supportée');
                }
            } catch (err) {
                console.error('Erreur lors de la copie:', err);
                afficherNotification('Erreur lors de la copie. Veuillez sélectionner manuellement le contenu.', 'error');
            } finally {
                document.body.removeChild(textArea);
            }
        }
        
    } catch (error) {
        console.error('Erreur lors de la copie:', error);
        afficherNotification('Erreur lors de la copie dans le presse-papiers', 'error');
    }
}

// Fonction utilitaire pour afficher des notifications
function afficherNotification(message, type = 'info') {
    // Créer l'élément de notification
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    // Ajouter au DOM
    document.body.appendChild(notification);
    
    // Supprimer automatiquement après 3 secondes
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

// Fonction pour créer le graphique des ventes par catégorie
function creerGraphiqueVentesParCategorie(donnees) {
    console.log('Création du graphique des ventes par catégorie avec les données:', donnees);

    // Check if the ChartDataLabels plugin is loaded
    if (typeof ChartDataLabels === 'undefined') {
        console.error('ChartDataLabels plugin is not loaded!');
        return;
    }

    const categories = {};
    donnees.forEach(vente => {
        const categorie = vente.Catégorie || 'Inconnue';
        const montant = parseFloat(vente.Montant) || 0;
        if (!categories[categorie]) {
            categories[categorie] = 0;
        }
        categories[categorie] += montant;
    });

    const labels = Object.keys(categories);
    const data = Object.values(categories);
    const totalVentes = data.reduce((sum, value) => sum + value, 0);

    // Define a color palette (use more colors if needed)
    const defaultColors = [
        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
        '#FF9F40', '#E7E9ED', '#8D8741', '#659DBD', '#DAAD86'
    ];
    const backgroundColors = labels.map((_, i) => defaultColors[i % defaultColors.length]);
    const borderColors = backgroundColors.map(color => color); // Use same color for border or make it darker

    const ctx = document.getElementById('ventesParCategorieChart').getContext('2d');

    // Si le graphique existe déjà, le mettre à jour
    if (ventesParCategorieChart) {
        console.log('Mise à jour du graphique des ventes par catégorie');
        ventesParCategorieChart.data.labels = labels;
        ventesParCategorieChart.data.datasets[0].data = data;
        ventesParCategorieChart.data.datasets[0].backgroundColor = backgroundColors;
        ventesParCategorieChart.data.datasets[0].borderColor = borderColors;
        
        // Mettre à jour les options du plugin datalabels avec les nouvelles données
        if (ventesParCategorieChart.options.plugins.datalabels) {
            ventesParCategorieChart.options.plugins.datalabels.formatter = (value, ctx) => {
                if (totalVentes === 0) return '0%';
                let percentage = ((value / totalVentes) * 100).toFixed(1);
                // Afficher le pourcentage même s'il est inférieur à 1%
                return percentage + '%';
            };
        }
        
        ventesParCategorieChart.update('none'); // Mise à jour sans animation
        console.log('Graphique catégorie mis à jour avec succès');
        return;
    }

    console.log('Configuration du nouveau graphique Pie avec datalabels');
    ventesParCategorieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors, // Or a slightly darker shade
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top', // Or 'right', 'bottom', 'left'
                },
                title: {
                    display: false, // Title is already outside the canvas in HTML
                    // text: 'Ventes par Catégorie'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += new Intl.NumberFormat('fr-FR', { style: 'decimal' }).format(context.parsed) + ' FCFA';
                                if (totalVentes > 0) {
                                    const percentage = ((context.parsed / totalVentes) * 100).toFixed(1);
                                    label += ` (${percentage}%)`;
                                }
                            }
                            return label;
                        }
                    }
                },
                datalabels: { // Configuration for chartjs-plugin-datalabels
                    display: true,
                    formatter: (value, ctx) => {
                        if (totalVentes === 0) return '0%';
                        let percentage = ((value / totalVentes) * 100).toFixed(1);
                        // Afficher le pourcentage même s'il est inférieur à 1%
                        return percentage + '%';
                    },
                    color: '#fff', // Color of the labels
                    font: {
                        weight: 'bold',
                        size: 12 // Adjust size as needed
                    },
                    // Optional: Add background or padding
                    // backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    // borderRadius: 4,
                    // padding: 6
                }
            }
        },
        plugins: [ChartDataLabels] // Register the plugin instance with the chart
    });
    console.log('Graphique Pie créé:', ventesParCategorieChart);
}

// Variables pour la pagination
let currentPage = 1;
const itemsPerPage = 30;
let allVentes = [];

// Variable pour annuler les requêtes précédentes
let currentVentesRequest = null;

// Fonction pour charger les ventes avec pagination
async function chargerVentes() {
    // Annuler la requête précédente si elle existe
    if (currentVentesRequest) {
        console.log('Annulation de la requête précédente');
        currentVentesRequest.abort();
    }
    
    try {
        // S'assurer que la section de visualisation est visible
        // La visibilité est maintenant gérée par les gestionnaires d'onglets
        // const visualisationSection = document.getElementById('visualisation-section');
        // if (visualisationSection) {
        //     visualisationSection.style.display = 'block'; 
        // }

        const dateDebut = document.getElementById('date-debut').value;
        const dateFin = document.getElementById('date-fin').value;
        const pointVente = document.getElementById('point-vente-select').value;

        console.log('Dates sélectionnées:', { dateDebut, dateFin });

        // Convertir les dates au format YYYY-MM-DD pour l'API
        const formatDateForApi = (dateStr, isEndDate = false) => {
            if (!dateStr) return '';
            const [jour, mois, annee] = dateStr.split('/');
            
            // Formater directement au format YYYY-MM-DD sans passer par toISOString()
            let year = parseInt(annee);
            let month = parseInt(mois);
            let day = parseInt(jour);
            
            // Ne pas ajouter de jour supplémentaire pour la date de fin
            // La logique de filtrage côté serveur gère déjà correctement les limites
            
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        };

        const debut = formatDateForApi(dateDebut);
        const fin = formatDateForApi(dateFin);

        console.log('Chargement des ventes avec les paramètres:', { 
            dateDebut, 
            dateFin, 
            debut, 
            fin, 
            pointVente 
        });

        // Fonction pour comparer les dates en ignorant l'heure
        const compareDates = (date1, date2) => {
            const d1 = new Date(date1);
            const d2 = new Date(date2);
            return d1.getFullYear() === d2.getFullYear() &&
                   d1.getMonth() === d2.getMonth() &&
                   d1.getDate() === d2.getDate();
        };

        // Créer un nouveau AbortController pour cette requête
        const abortController = new AbortController();
        currentVentesRequest = abortController;
        
        const response = await fetch(`/api/ventes?dateDebut=${debut}&dateFin=${fin}&pointVente=${pointVente}`, {
            credentials: 'include',
            signal: abortController.signal
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        if (data.success) {
            console.log('Nombre de ventes reçues:', data.ventes.length);
            
            // Formater les données
            const ventesFormatees = formaterDonneesVentes(data.ventes);
            
            // Stocker toutes les ventes
            allVentes = ventesFormatees;
            
            // Calculer le montant total des ventes
            const montantTotal = ventesFormatees.reduce((total, vente) => {
                return total + (parseFloat(vente.Montant) || 0);
            }, 0);
            
            // Afficher le montant total
            const montantTotalElement = document.getElementById('montant-total');
            if (montantTotalElement) {
                montantTotalElement.textContent = `${montantTotal.toLocaleString('fr-FR')} FCFA`;
            }
            
            // Afficher la première page
            afficherPageVentes(1);
            
            // Mettre à jour les informations de pagination
            updatePaginationInfo();

            // Mettre à jour les graphiques immédiatement
            creerGraphiqueVentesParMois(ventesFormatees);
            creerGraphiqueVentesParProduit(ventesFormatees);
            creerGraphiqueVentesParCategorie(ventesFormatees);
            
            // Mettre à jour les analytics
            await afficherAnalyticsVentes(ventesFormatees);
        } else {
            throw new Error(data.message || 'Erreur lors du chargement des ventes');
        }
    } catch (error) {
        // Ne pas afficher d'erreur si la requête a été annulée
        if (error.name === 'AbortError') {
            console.log('Requête annulée - nouvelle requête en cours');
            return;
        }
        
        console.error('Erreur lors du chargement des ventes:', error);
        const tbody = document.querySelector('#tableau-ventes tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="15" class="text-center text-danger">Erreur lors du chargement des ventes: ${error.message}</td></tr>`;
        }
        // Réinitialiser le montant total en cas d'erreur si l'élément existe
        const montantTotalElement = document.getElementById('montant-total');
        if (montantTotalElement) {
            montantTotalElement.textContent = '0 FCFA';
        }
    } finally {
        // Nettoyer la référence à la requête courante
        if (currentVentesRequest) {
            currentVentesRequest = null;
        }
    }
}

// Fonction pour afficher une page spécifique des ventes
function afficherPageVentes(page) {
    const tbody = document.querySelector('#tableau-ventes tbody');
    if (!tbody) return;

    // Calculer les indices de début et de fin pour la page courante
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    
    // Obtenir les ventes pour la page courante
    const ventesPage = allVentes.slice(startIndex, endIndex);
    
    tbody.innerHTML = '';
    
    ventesPage.forEach(vente => {
        const tr = document.createElement('tr');
        
        // Distinction visuelle pour les ventes provenant de pré-commandes (en bleu)
        appliquerDistinctionVisuellePrecommande(tr, vente);
        
        tr.innerHTML = `
            <td>${vente.Mois || vente.mois || ''}</td>
            <td>${vente.Date || vente.date || ''}</td>
            <td>${vente.Semaine || vente.semaine || ''}</td>
            <td>${vente['Point de Vente'] || vente.pointVente || ''}</td>
            <td>${vente.Preparation || vente.preparation || vente['Point de Vente'] || vente.pointVente || ''}</td>
            <td>${formatCategorie(vente.Catégorie || vente.categorie || '')}</td>
            <td>${vente.Produit || vente.produit || ''}</td>
            <td>${(parseFloat(vente.PU || vente.prixUnit || 0)).toLocaleString('fr-FR')} FCFA</td>
            <td>${vente.Nombre || vente.quantite || 0}</td>
            <td>${(parseFloat(vente.Montant || vente.total || 0)).toLocaleString('fr-FR')} FCFA</td>
                <td>${vente.nomClient || ''}</td>
                <td>${vente.numeroClient || ''}</td>
          
                <td>${vente.adresseClient || ''}</td>
                <td>${vente.creance ? 'Oui' : 'Non'}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Fonction pour mettre à jour les informations de pagination
function updatePaginationInfo() {
    const totalPages = Math.ceil(allVentes.length / itemsPerPage);
    const paginationInfo = document.getElementById('pagination-info');
    const paginationButtons = document.getElementById('pagination-buttons');
    
    if (paginationInfo) {
        paginationInfo.textContent = `Page ${currentPage} sur ${totalPages} (${allVentes.length} ventes au total)`;
    }
    
    if (paginationButtons) {
        paginationButtons.innerHTML = '';
        
        // Bouton précédent
        const prevButton = document.createElement('button');
        prevButton.className = 'btn btn-outline-primary me-2';
        prevButton.textContent = 'Précédent';
        prevButton.disabled = currentPage === 1;
        prevButton.onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                afficherPageVentes(currentPage);
                updatePaginationInfo();
            }
        };
        paginationButtons.appendChild(prevButton);
        
        // Bouton suivant
        const nextButton = document.createElement('button');
        nextButton.className = 'btn btn-outline-primary';
        nextButton.textContent = 'Suivant';
        nextButton.disabled = currentPage === totalPages;
        nextButton.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                afficherPageVentes(currentPage);
                updatePaginationInfo();
            }
        };
        paginationButtons.appendChild(nextButton);
    }
}

// Fonction pour lire un fichier Excel ou CSV
function lireFichier(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                
                // Configuration spécifique pour la lecture
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
                    header: 1,
                    raw: false,
                    defval: ''
                });
                
                // Vérifier et nettoyer les en-têtes
                const headers = jsonData[0].map(h => h.trim());
                const expectedHeaders = [
                    'Mois',
                    'Date',
                    'Semaine',
                    'Point de Vente',
                    'Preparation',
                    'Catégorie',
                    'Produit',
                    'PU',
                    'Nombre',
                    'Montant',
                    'Nom Client',
                    'Numéro Client',
                   
                    'Adresse Client',
                    'Créance'
                ];
                
                // Vérifier que tous les en-têtes attendus sont présents
                const missingHeaders = expectedHeaders.filter(header => 
                    !headers.some(h => h.toLowerCase() === header.toLowerCase())
                );
                
                if (missingHeaders.length > 0) {
                    reject(new Error(`En-têtes manquants : ${missingHeaders.join(', ')}`));
                    return;
                }
                
                // Nettoyer les données
                const cleanedData = jsonData.slice(1).map(row => {
                    // Supprimer les espaces superflus et convertir les valeurs vides en 0
                    return row.map((cell, index) => {
                        if (typeof cell === 'string') {
                            cell = cell.trim();
                        }
                        // Pour les colonnes numériques (PU, Nombre, Montant)
                        if (index >= 7 && cell === '') {
                            return '0';
                        }
                        return cell;
                    });
                });
                
                resolve(cleanedData);
            } catch (error) {
                reject(new Error('Erreur lors de la lecture du fichier : ' + error.message));
            }
        };
        
        reader.onerror = function() {
            reject(new Error('Erreur lors de la lecture du fichier'));
        };
        
        reader.readAsArrayBuffer(file);
    });
}

// Fonction pour afficher l'aperçu des données
function afficherApercu(donnees) {
    const tbody = document.querySelector('#preview-table tbody');
    tbody.innerHTML = '';
    
    donnees.forEach((row, index) => {
        if (row.length >= 14) { // Vérifier que la ligne a toutes les colonnes nécessaires
            const tr = document.createElement('tr');
            tr.dataset.index = index;
            tr.innerHTML = `
                <td>${row[0]}</td>
                <td>${row[1]}</td>
                <td>${row[2]}</td>
                <td>${row[3]}</td>
                <td>${row[4]}</td>
                <td>${row[5]}</td>
                <td>${row[6]}</td>
                <td>${row[7]}</td>
                <td>${row[8]}</td>
                <td>${row[9]}</td>
                <td>${row[10]}</td>
                <td>${row[11]}</td>
                <td>${row[12]}</td>
                <td>${row[13]}</td>
                
                <td>
                    <button type="button" class="btn btn-danger btn-sm delete-row">
                        <i class="fas fa-trash"></i> ×
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });

    // Activer le bouton de sauvegarde si des données sont présentes
    const saveButton = document.getElementById('save-import');
    saveButton.disabled = donnees.length === 0;

    // Ajouter les écouteurs d'événements pour la suppression
    document.querySelectorAll('.delete-row').forEach(button => {
        button.addEventListener('click', function() {
            const row = this.closest('tr');
            const index = parseInt(row.dataset.index);
            donnees.splice(index, 1); // Supprimer la ligne des données
            afficherApercu(donnees); // Réafficher le tableau
        });
    });
}

// Gestion de la sauvegarde
document.getElementById('save-import').addEventListener('click', async function() {
    if (donneesImportees.length === 0) {
        alert('Aucune donnée à sauvegarder');
        return;
    }

    try {
        // Préparer les données pour l'envoi au serveur
        const entries = donneesImportees.map(row => ({
            mois: row[0],
            date: row[1],
            semaine: row[2],
            pointVente: row[3],
            preparation: row[4],
            categorie: row[5],
            produit: row[6],
            prixUnit: row[7],
            quantite: row[8],
            total: row[9],
            nomClient: row[10],
            numeroClient: row[11],
            adresseClient: row[12],
            creance: row[13] === 'Oui' // Assuming 'Oui'/'Non' in import file, convert to boolean
        }));
        
        // Envoyer les données au serveur
        const typeStock = document.getElementById('type-stock').value;
        const response = await fetch(`/api/stock/${typeStock}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(entries)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Données sauvegardées avec succès');
            // Réinitialiser le formulaire
            document.getElementById('file-import').value = '';
            donneesImportees = [];
            document.querySelector('#preview-table tbody').innerHTML = '';
            document.getElementById('save-import').disabled = true;
            // Recharger les dernières ventes
            chargerDernieresVentes();
        } else {
            throw new Error(result.message || 'Erreur lors de la sauvegarde');
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert(error.message || 'Erreur lors de la sauvegarde des données');
    }
});

// Fonction pour charger les transferts
async function chargerTransferts(date) {
    try {
        console.log('Chargement des transferts...');
        
        // Utiliser la date passée en paramètre ou celle de l'interface si disponible
        const dateSelectionnee = date || (document.getElementById('date-inventaire') ? document.getElementById('date-inventaire').value : null);
        if (!dateSelectionnee) {
            console.warn('Aucune date sélectionnée pour charger les transferts');
            return [];
        }
        
        // Utiliser l'API endpoint au lieu du fichier JSON direct
        let transferts = [];
        try {
            const response = await fetch(`/api/transferts?date=${dateSelectionnee}`, {
                method: 'GET',
                credentials: 'include'
            });
            
            if (!response.ok) {
                console.warn(`Aucun transfert disponible pour ${dateSelectionnee}, utilisation d'un tableau vide`);
                transferts = [];
            } else {
                const result = await response.json();
                transferts = result.success && result.transferts ? result.transferts : [];
                console.log('Transferts chargés depuis l\'API:', transferts);
            }
        } catch (fetchError) {
            console.warn('Erreur lors du chargement des transferts:', fetchError);
            transferts = [];
        }
        
        // Si la fonction est appelée depuis la page d'inventaire, mettre à jour l'interface
        const tbody = document.querySelector('#transfertTable tbody');
        if (tbody) {
            // Vider le tableau des transferts
            tbody.innerHTML = '';
            
            // Afficher les transferts existants
            if (Array.isArray(transferts) && transferts.length > 0) {
                transferts.forEach((transfert, index) => {
                    const row = document.createElement('tr');
                    row.dataset.index = index; // Ajouter l'index pour la suppression
                    
                    // Point de vente
                    const tdPointVente = document.createElement('td');
                    const selectPointVente = document.createElement('select');
                    selectPointVente.className = 'form-select form-select-sm point-vente-select';
                    TOUS_POINTS_VENTE.forEach(pv => {
                        const option = document.createElement('option');
                        option.value = pv;
                        option.textContent = pv;
                        if (pv === transfert.pointVente) {
                            option.selected = true;
                        }
                        selectPointVente.appendChild(option);
                    });
                    tdPointVente.appendChild(selectPointVente);
                    
                    // Produit
                    const tdProduit = document.createElement('td');
                    const selectProduit = document.createElement('select');
                    selectProduit.className = 'form-select form-select-sm produit-select';
                    PRODUITS_INVENTAIRE.forEach(prod => {
                        const option = document.createElement('option');
                        option.value = prod;
                        option.textContent = prod;
                        if (prod === transfert.produit) {
                            option.selected = true;
                        }
                        selectProduit.appendChild(option);
                    });
                    tdProduit.appendChild(selectProduit);
                    
                    // Impact
                    const tdImpact = document.createElement('td');
                    const selectImpact = document.createElement('select');
                    selectImpact.className = 'form-select form-select-sm impact-select';
                    [
                        { value: '1', text: '+' },
                        { value: '-1', text: '-' }
                    ].forEach(({ value, text }) => {
                        const option = document.createElement('option');
                        option.value = value;
                        option.textContent = text;
                        if (value === transfert.impact.toString()) {
                            option.selected = true;
                        }
                        selectImpact.appendChild(option);
                    });
                    tdImpact.appendChild(selectImpact);
                    
                    // Quantité
                    const tdQuantite = document.createElement('td');
                    const inputQuantite = document.createElement('input');
                    inputQuantite.type = 'number';
                    inputQuantite.className = 'form-control form-control-sm quantite-input';
                    inputQuantite.value = transfert.quantite;
                    tdQuantite.appendChild(inputQuantite);
                    
                    // Prix unitaire
                    const tdPrixUnitaire = document.createElement('td');
                    const inputPrixUnitaire = document.createElement('input');
                    inputPrixUnitaire.type = 'number';
                    inputPrixUnitaire.className = 'form-control form-control-sm prix-unitaire-input';
                    inputPrixUnitaire.value = transfert.prixUnitaire;
                    tdPrixUnitaire.appendChild(inputPrixUnitaire);
                    
                    // Total
                    const tdTotal = document.createElement('td');
                    tdTotal.className = 'total-cell';
                    tdTotal.textContent = transfert.total.toLocaleString('fr-FR');
                    
                    // Commentaire
                    const tdCommentaire = document.createElement('td');
                    const inputCommentaire = document.createElement('input');
                    inputCommentaire.type = 'text';
                    inputCommentaire.className = 'form-control form-control-sm commentaire-input';
                    inputCommentaire.value = transfert.commentaire || '';
                    tdCommentaire.appendChild(inputCommentaire);
                    
                    // Actions
                    const tdActions = document.createElement('td');
                    const btnSupprimer = document.createElement('button');
                    btnSupprimer.className = 'btn btn-danger btn-sm';
                    btnSupprimer.innerHTML = '<i class="fas fa-trash"></i>';
                    btnSupprimer.addEventListener('click', async (e) => {
                        e.preventDefault();
                        if (confirm('Voulez-vous vraiment supprimer ce transfert ?')) {
                            try {
                                // Supprimer le transfert via l'API
                                const response = await fetch(`/api/transferts`, {
                                    method: 'DELETE',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    credentials: 'include',
                                    body: JSON.stringify({
                                        date: transfert.date,
                                        pointVente: transfert.pointVente,
                                        produit: transfert.produit,
                                        impact: transfert.impact,
                                        quantite: transfert.quantite,
                                        prixUnitaire: transfert.prixUnitaire
                                    })
                                });
                                
                                if (response.ok) {
                                    row.remove();
                                    console.log('Transfert supprimé avec succès');
                                } else {
                                    throw new Error('Erreur lors de la suppression du transfert');
                                }
                            } catch (error) {
                                console.error('Erreur lors de la suppression:', error);
                                alert('Erreur lors de la suppression : ' + error.message);
                            }
                        }
                    });
                    tdActions.appendChild(btnSupprimer);
                    
                    // Ajouter les cellules à la ligne
                    row.append(tdPointVente, tdProduit, tdImpact, tdQuantite, tdPrixUnitaire, tdTotal, tdCommentaire, tdActions);
                    
                    // Ajouter les écouteurs d'événements pour le calcul automatique du total
                    const calculateTotal = () => {
                        const quantite = parseFloat(inputQuantite.value) || 0;
                        const prixUnitaire = parseFloat(inputPrixUnitaire.value) || 0;
                        const impact = parseInt(selectImpact.value) || 1;
                        const total = quantite * prixUnitaire * impact;
                        tdTotal.textContent = total.toLocaleString('fr-FR');
                    };
                    
                    inputQuantite.addEventListener('input', calculateTotal);
                    inputPrixUnitaire.addEventListener('input', calculateTotal);
                    selectImpact.addEventListener('change', calculateTotal);
                    
                    tbody.appendChild(row);
                });
            } else {
                console.log('Aucun transfert trouvé pour cette date, ajout d\'une ligne vide');
                ajouterLigneTransfert();
            }
              
            console.log('Transferts chargés avec succès');
        }
        
        // Toujours retourner un tableau (vide ou filtré)
        return transferts;
        
    } catch (error) {
        console.error('Erreur lors du chargement des transferts:', error);
        // En cas d'erreur, retourner un tableau vide
        return [];
    }
}

// Fonction pour ajouter une ligne au tableau de transfert
function ajouterLigneTransfert() {
    console.log('Ajout d\'une ligne au tableau de transfert');
    const tbody = document.querySelector('#transfertTable tbody');
    const rowIndex = tbody.rows.length;
    
    const row = document.createElement('tr');
    row.dataset.index = rowIndex;
    
    // Point de vente
    const tdPointVente = document.createElement('td');
    const selectPointVente = document.createElement('select');
    selectPointVente.className = 'form-select form-select-sm point-vente-select';
    TOUS_POINTS_VENTE.forEach(pv => {
        const option = document.createElement('option');
        option.value = pv;
        option.textContent = pv;
        selectPointVente.appendChild(option);
    });
    tdPointVente.appendChild(selectPointVente);
    
    // Produit
    const tdProduit = document.createElement('td');
    const selectProduit = document.createElement('select');
    selectProduit.className = 'form-select form-select-sm produit-select';
    PRODUITS_INVENTAIRE.forEach(prod => {
        const option = document.createElement('option');
        option.value = prod;
        option.textContent = prod;
        selectProduit.appendChild(option);
    });
    tdProduit.appendChild(selectProduit);
    
    // Impact
    const tdImpact = document.createElement('td');
    const selectImpact = document.createElement('select');
    selectImpact.className = 'form-select form-select-sm impact-select';
    [
        { value: '1', text: '+' },
        { value: '-1', text: '-' }
    ].forEach(({ value, text }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        selectImpact.appendChild(option);
    });
    tdImpact.appendChild(selectImpact);
    
    // Quantité
    const tdQuantite = document.createElement('td');
    const inputQuantite = document.createElement('input');
    inputQuantite.type = 'number';
    inputQuantite.className = 'form-control form-control-sm quantite-input';
    inputQuantite.min = '0';
    inputQuantite.step = '0.001';
    inputQuantite.value = '0';
    tdQuantite.appendChild(inputQuantite);
    
    // Prix unitaire
    const tdPrixUnitaire = document.createElement('td');
    const inputPrixUnitaire = document.createElement('input');
    inputPrixUnitaire.type = 'number';
    inputPrixUnitaire.className = 'form-control form-control-sm prix-unitaire-input';
    inputPrixUnitaire.min = '0';
    inputPrixUnitaire.step = '0.01';
    inputPrixUnitaire.value = '0';
    tdPrixUnitaire.appendChild(inputPrixUnitaire);
    
    // Total
    const tdTotal = document.createElement('td');
    tdTotal.className = 'total-cell';
    tdTotal.textContent = '0';
    
    // Commentaire
    const tdCommentaire = document.createElement('td');
    const inputCommentaire = document.createElement('input');
    inputCommentaire.type = 'text';
    inputCommentaire.className = 'form-control form-control-sm commentaire-input';
    tdCommentaire.appendChild(inputCommentaire);
    
    // Actions
    const tdActions = document.createElement('td');
    const btnSupprimer = document.createElement('button');
    btnSupprimer.className = 'btn btn-danger btn-sm';
    btnSupprimer.innerHTML = '<i class="fas fa-trash"></i>';
    btnSupprimer.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Voulez-vous vraiment supprimer cette ligne ?')) {
            row.remove();
        }
    });
    tdActions.appendChild(btnSupprimer);
    
    // Ajouter les cellules à la ligne
    row.append(tdPointVente, tdProduit, tdImpact, tdQuantite, tdPrixUnitaire, tdTotal, tdCommentaire, tdActions);
    
    // Ajouter les écouteurs d'événements pour le calcul automatique du total
    const calculateTotal = () => {
        const quantite = parseFloat(inputQuantite.value) || 0;
        const prixUnitaire = parseFloat(inputPrixUnitaire.value) || 0;
        const impact = parseInt(selectImpact.value) || 1;
        const total = quantite * prixUnitaire * impact;
        tdTotal.textContent = total.toLocaleString('fr-FR');
    };
    
    inputQuantite.addEventListener('input', calculateTotal);
    inputPrixUnitaire.addEventListener('input', calculateTotal);
    selectImpact.addEventListener('change', calculateTotal);
    
    // Gestionnaire pour la mise à jour du prix unitaire par défaut
    selectProduit.addEventListener('change', function() {
        const nouveauProduit = this.value;
        inputPrixUnitaire.value = PRIX_DEFAUT_INVENTAIRE[nouveauProduit] || '0';
        calculateTotal();
    });
    
    tbody.appendChild(row);
}

// Fonction pour sauvegarder les transferts
async function sauvegarderTransfert() {
    try {
        console.log('Sauvegarde des transferts...');
        const date = document.getElementById('date-inventaire').value;
        
        if (!date) {
            alert('Veuillez sélectionner une date');
            return;
        }

        // Vérifier les restrictions temporelles
        try {
            const sessionResponse = await fetch('/api/check-session');
            const sessionData = await sessionResponse.json();
            if (sessionData.success && sessionData.user) {
                const restriction = verifierRestrictionsTemporelles(date, sessionData.user.username);
                if (restriction.restricted) {
                    alert(restriction.message);
                    return;
                }
            }
        } catch (error) {
            console.error('Erreur lors de la vérification de session:', error);
        }
        
        // Récupérer les données du tableau
        const rows = document.querySelectorAll('#transfertTable tbody tr');
        const transferts = [];
        
        rows.forEach(row => {
            const pointVente = row.querySelector('.point-vente-select').value;
            const produit = row.querySelector('.produit-select').value;
            const impact = parseInt(row.querySelector('.impact-select').value);
            const quantite = parseFloat(row.querySelector('.quantite-input').value);
            const prixUnitaire = parseFloat(row.querySelector('.prix-unitaire-input').value);
            const commentaire = row.querySelector('.commentaire-input').value;
            
            // Calcul du total
            const total = quantite * prixUnitaire * impact;
            
            // Vérifier que les données sont valides
            if (pointVente && produit && !isNaN(quantite) && !isNaN(prixUnitaire) && quantite > 0) {
                transferts.push({
                    date,
                    pointVente,
                    produit,
                    impact,
                    quantite,
                    prixUnitaire,
                    total,
                    commentaire
                });
            }
        });
        
        if (transferts.length === 0) {
            alert('Aucun transfert valide à sauvegarder');
            return;
        }
        
        // Envoyer les données au serveur
        console.log('Envoi des transferts au serveur:', transferts);
        const response = await fetch('/api/transferts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(transferts)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Transferts sauvegardés avec succès');
            // Recharger les transferts pour mettre à jour l'affichage
            await chargerTransferts();
        } else {
            // Afficher le message d'erreur spécifique du serveur, notamment pour les restrictions temporelles
            throw new Error(result.error || result.message || 'Erreur lors de la sauvegarde des transferts');
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des transferts:', error);
        alert('Erreur lors de la sauvegarde des transferts: ' + error.message);
    }
}

// Attacher les gestionnaires d'événements pour les boutons de transfert
document.addEventListener('DOMContentLoaded', function() {
    // Gestionnaire pour le bouton d'ajout de ligne de transfert
    const btnAjouterLigne = document.getElementById('ajouterLigne');
    if (btnAjouterLigne) {
        btnAjouterLigne.addEventListener('click', ajouterLigneTransfert);
    }
    
    // Gestionnaire pour le bouton de sauvegarde de transfert
    const btnSauvegarderTransfert = document.getElementById('sauvegarderTransfert');
    if (btnSauvegarderTransfert) {
        btnSauvegarderTransfert.addEventListener('click', sauvegarderTransfert);
    }
});

document.addEventListener('DOMContentLoaded', async function() {
    // Vérifier si l'onglet Stock inventaire est actif
    const stockInventaireTab = document.getElementById('stock-inventaire-tab');
    const stockInventaireSection = document.getElementById('stock-inventaire-section');
    const copierStockTab = document.getElementById('copier-stock-tab');
    const copierStockSection = document.getElementById('copier-stock-section');
    const copierStockItem = document.getElementById('copier-stock-item');
    const stockAlerteTab = document.getElementById('stock-alerte-tab');
    const stockAlerteSection = document.getElementById('stock-alerte-section');
    
    // Forcer l'affichage de l'onglet Copier Stock pour tous les utilisateurs
  
    
    // Vérifier si l'utilisateur a les droits pour voir l'onglet 'Copier Stock'
    try {
        const response = await fetch('/api/user-info', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (response.ok) {
            const userData = await response.json();
            if (userData.success && userData.user) {
                // Ne pas afficher l'onglet Copier Stock pour les lecteurs
                if (userData.user.role === 'lecteur') {
                    if (copierStockItem) {
                        copierStockItem.style.display = 'none';
                    }
                } else {
                    // Liste des utilisateurs autorisés à voir l'onglet Copier Stock
                    const usersAutorisesCopiage = ['SALIOU', 'PAPI', 'NADOU', 'OUSMANE'];
                    if (usersAutorisesCopiage.includes(userData.user.username.toUpperCase())) {
                        if (copierStockItem) {
                            copierStockItem.style.display = 'block';
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des droits utilisateur:', error);
    }
    
    if (stockInventaireTab && stockInventaireTab.classList.contains('active')) {
        console.log('Onglet Stock inventaire actif au chargement, initialisation...');
        hideAllSections();
        stockInventaireSection.style.display = 'block';
        await initInventaire();
    } else if (copierStockTab && copierStockTab.classList.contains('active')) {
        console.log('Onglet Copier Stock actif au chargement, initialisation...');
        hideAllSections();
        copierStockSection.style.display = 'block';
        initCopierStock();
    } else if (stockAlerteTab && stockAlerteTab.classList.contains('active')) {
        console.log('Onglet Alertes de stock actif au chargement, initialisation...');
        hideAllSections();
        stockAlerteSection.style.display = 'block';
        initStockAlerte();
    }
});

// Fonction pour formater les données des ventes
function formaterDonneesVentes(ventes) {
    // Fonction utilitaire pour parser les dates
    const parseDate = (dateStr) => {
        if (!dateStr) return new Date(0);
        
        let jour, mois, annee;
        if (dateStr.includes('/')) {
            [jour, mois, annee] = dateStr.split('/');
        } else if (dateStr.includes('-')) {
            [jour, mois, annee] = dateStr.split('-');
        } else {
            return new Date(0);
        }
        
        // Convertir l'année à 2 chiffres en 4 chiffres
        if (annee && annee.length === 2) {
            annee = '20' + annee;
        }
        
        return new Date(parseInt(annee), parseInt(mois) - 1, parseInt(jour));
    };
    
    // Utiliser la fonction globale pour formater les dates d'affichage

    // Fonction pour obtenir le nom du mois en français à partir d'une date
    const getNomMois = (dateStr) => {
        if (!dateStr) return '';
        
        const date = parseDate(dateStr);
        const moisFrancais = [
            'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 
            'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
        ];
        
        return moisFrancais[date.getMonth()];
    };
    
    // Normaliser les données
    const ventesNormalisees = ventes.map(v => {
        // Standardiser la date
        const dateStr = v.Date || v.date || '';
        const dateStandardisee = formaterDateAffichage(dateStr);
        
        // Déterminer le nom du mois en français à partir de la date
        const nomMois = getNomMois(dateStr);
        
        return {
            id: v.id || '',
            Mois: nomMois, // Utiliser le mois extrait de la date
            Date: dateStandardisee,
            Semaine: v.Semaine || v.semaine || '',
            'Point de Vente': v['Point de Vente'] || v.pointVente || '',
            Preparation: v.Preparation || v.preparation || v['Point de Vente'] || v.pointVente || '',
            Catégorie: formatCategorie(v.Catégorie || v.categorie || ''),
            Produit: v.Produit || v.produit || '',
            PU: v.PU || v.prixUnit || '0',
            Nombre: v.Nombre || v.quantite || '0',
            Montant: v.Montant || v.total || '0'
        };
    });
    
    // Trier par date en ordre décroissant
    ventesNormalisees.sort((a, b) => {
        const dateA = parseDate(a.Date);
        const dateB = parseDate(b.Date);
        return dateB - dateA; // Ordre décroissant
    });
    
    return ventesNormalisees;
}

// SUPPRIMÉ - Stock unifié dans les fichiers JSON
// async function chargerStockAutomatique() { ... }

// Fonction pour charger les données de stock d'une date spécifique
async function chargerStock(date, type) {
    console.log('%c=== Chargement des données de stock pour la date ' + date + ' ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    
    // Vérifier le type passé en paramètre ou utiliser celui sélectionné dans l'interface
    const typeStock = type || document.getElementById('type-stock').value;
    
    try {
        console.log('%cRécupération des données depuis le serveur pour le type:', 'color: #00aaff;', typeStock);
        
        // Charger le stock (manuel ET automatique) depuis le JSON
        const response = await fetch(`/api/stock/${typeStock}?date=${date}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        // Même si le serveur renvoie une erreur, on ne la traite pas comme une exception
        // mais on initialise simplement un tableau vide
        let donnees = {};
        if (response.ok) {
            donnees = await response.json();
        } else {
            console.log(`%cAucune donnée disponible pour ${date}, initialisation avec des valeurs à zéro`, 'color: #ff9900;');
        }
        
        console.log('%cDonnées récupérées:', 'color: #00ff00;', donnees);

        // Format plat: { "Keur Bali-Ail": { Nombre: "5", PU: "552", ... } }
        // Convertir l'objet en Map pour stockData
        const flattenedData = new Map();
        for (const key in donnees) {
            flattenedData.set(key, donnees[key]);
        }

        // Mise à jour de stockData
        if (typeStock === 'matin') {
            stockData.matin = flattenedData;
        } else {
            stockData.soir = flattenedData;
        }
        
        console.log(`%c📦 Stock chargé: ${flattenedData.size} entrées`, 'color: #00ff00;');

        // Si on est dans le contexte d'inventaire (tableau présent)
        const tbody = document.querySelector('#stock-table tbody');
        if (tbody) {
            // Vider le tableau AVANT de procéder à l'initialisation
            tbody.innerHTML = '';
            console.log('%cTableau vidé avant initialisation des nouvelles lignes', 'color: #ff0000;');

            // Déterminer si aucune donnée n'est disponible
            const stockEmpty = !donnees || Object.keys(donnees).length === 0;
            console.log('%cStock vide?', 'color: #ff9900;', stockEmpty);

            if (stockEmpty) {
                console.log('%cAucune donnée de stock disponible pour cette date, initialisation des valeurs par défaut', 'color: #ff9900;');
                initTableauStock();
            } else {
                console.log('%cDonnées de stock disponibles, peuplement du tableau avec les valeurs existantes', 'color: #00ff00;');
                onTypeStockChange();
            }
        }
        
        // Retourner directement l'objet plat pour la réconciliation
        console.log(`%c📦 Stock pour réconciliation: ${Object.keys(donnees).length} entrées`, 'color: #00aaff;');
        return donnees;
        
    } catch (error) {
        console.error('%cErreur lors du chargement des données:', 'color: #ff0000; font-weight: bold;', error);
        // Au lieu d'afficher une alerte d'erreur, on initialise le tableau avec des valeurs par défaut
        console.log('%cInitialisation du tableau avec des valeurs par défaut suite à une erreur', 'color: #ff9900;');
        
        // Si on est dans le contexte d'inventaire
        if (document.querySelector('#stock-table tbody')) {
            initTableauStock();
        }
        
        // Retourner un objet vide en cas d'erreur
        return {};
    }
}

// Fonction pour copier les données de stock d'une autre date
async function copierStock() {
    const sourceTypeStock = document.getElementById('source-type-stock').value;
    const sourceDate = document.getElementById('source-date').value;
    const targetTypeStock = document.getElementById('destination-type-stock').value;
    const targetDate = document.getElementById('destination-date').value;
    const copyComments = document.getElementById('copy-comments').checked;

    if (!sourceDate) {
        alert('Veuillez sélectionner une date source.');
        return;
    }

    if (!targetDate) {
        alert('Veuillez sélectionner une date de destination.');
        return;
    }

    if (sourceDate === targetDate && sourceTypeStock === targetTypeStock) {
        alert('La source et la destination sont identiques. Veuillez sélectionner une date ou un type de stock différent.');
        return;
    }

    console.log('%cCopie de stock demandée:', 'color: #00aaff; font-weight: bold;', {
        sourceTypeStock,
        sourceDate,
        targetTypeStock,
        targetDate,
        copyComments
    });

    try {
        // Charger les données sources
        const response = await fetch(`/api/stock/${sourceTypeStock}?date=${sourceDate}`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Erreur lors de la récupération des données (${response.status}): ${response.statusText}`);
        }

        const sourceData = await response.json();
        console.log('%cDonnées sources chargées:', 'color: #00ff00;', sourceData);

        if (!sourceData || (Array.isArray(sourceData) && sourceData.length === 0) || Object.keys(sourceData).length === 0) {
            alert(`Aucune donnée de stock ${sourceTypeStock} n'a été trouvée pour la date ${sourceDate}`);
            return;
        }

        // Demander confirmation
        const commentaireSuffix = copyComments ? ' (commentaires inclus)' : ' (sans les commentaires)';
        if (!confirm(`Voulez-vous copier les données du stock ${sourceTypeStock} du ${sourceDate} vers le stock ${targetTypeStock} du ${targetDate}${commentaireSuffix}? Cette action remplacera les données existantes.`)) {
            return;
        }

        // Créer une structure pour stocker les données à envoyer
        let dataToSave = {};
        
        if (Array.isArray(sourceData)) {
            sourceData.forEach(item => {
                const key = `${item["Point de Vente"] || item.pointVente}-${item.Produit || item.produit}`;
                const newItem = {
                    ...item,
                    date: targetDate,
                    typeStock: targetTypeStock
                };
                
                // Gérer les commentaires selon l'option choisie
                if (!copyComments) {
                    delete newItem.Commentaire;
                    delete newItem.commentaire;
                }
                
                dataToSave[key] = newItem;
            });
        } else {
            Object.entries(sourceData).forEach(([key, value]) => {
                const newItem = {
                    ...value,
                    date: targetDate,
                    typeStock: targetTypeStock
                };
                
                // Gérer les commentaires selon l'option choisie
                if (!copyComments) {
                    delete newItem.Commentaire;
                    delete newItem.commentaire;
                }
                
                dataToSave[key] = newItem;
            });
        }

        // Sauvegarder directement les données
        const saveResponse = await fetch(`/api/stock/${targetTypeStock}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(dataToSave)
        });

        if (!saveResponse.ok) {
            throw new Error(`Erreur lors de la sauvegarde des données (${saveResponse.status}): ${saveResponse.statusText}`);
        }

        const result = await saveResponse.json();
        
        if (result.success) {
            console.log('%cDonnées copiées et sauvegardées avec succès', 'color: #00ff00; font-weight: bold;');
            alert(`Les données du stock ${sourceTypeStock} du ${sourceDate} ont été copiées avec succès vers le stock ${targetTypeStock} du ${targetDate}.`);
        } else {
            throw new Error(result.error || 'Erreur lors de la sauvegarde');
        }
        
    } catch (error) {
        console.error('%cErreur lors de la copie des données:', 'color: #ff0000; font-weight: bold;', error);
        alert(`Erreur lors de la copie des données: ${error.message}`);
    }
}

// ... existing code ...

// Dans l'événement DOMContentLoaded, après les autres initialisations
document.addEventListener('DOMContentLoaded', function() {
    // ... existing code ...
    
    // Initialiser le bouton de copie de stock
    document.getElementById('copy-stock').addEventListener('click', copierStock);
    
    // Initialiser le datepicker pour la date source
    if (document.getElementById('source-date')) {
        flatpickr('#source-date', {
            dateFormat: 'd/m/Y',
            locale: 'fr',
            defaultDate: new Date()
        });
    }
    
    // ... existing code ...
});

// ... existing code ...

// Fonction pour initialiser la page de copie de stock
function initCopierStock() {
    console.log('%c=== Initialisation de la page copier stock ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    
    // Initialiser les datepickers
    flatpickr('#source-date', {
        dateFormat: "d/m/Y",
        defaultDate: "today",
        locale: 'fr'
    });
    
    flatpickr('#destination-date', {
        dateFormat: "d/m/Y",
        defaultDate: "today",
        locale: 'fr'
    });
    
    // Restreindre les options de destination pour les SuperUtilisateurs
    if (currentUser && currentUser.isSuperUtilisateur) {
        const destinationSelect = document.getElementById('destination-type-stock');
        if (destinationSelect) {
            // Garder seulement l'option "Stock Soir" pour les SuperUtilisateurs
            destinationSelect.innerHTML = '<option value="soir">Stock Soir</option>';
            console.log('SuperUtilisateur détecté: destination restreinte au Stock Soir uniquement');
        }
    }
    
    // Initialiser le bouton de copie
    const copyStockBtn = document.getElementById('copy-stock');
    if (copyStockBtn) {
        console.log('Bouton copy-stock trouvé, ajout de l\'écouteur click');
        copyStockBtn.addEventListener('click', copierStock);
    } else {
        console.error('Bouton copy-stock non trouvé');
    }
    
    console.log('%c=== Initialisation de la page copier stock terminée ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
}

// Fonction pour afficher les onglets en fonction des droits utilisateur ET des modules actifs
async function afficherOngletsSuivantDroits(userData) {
    const roleDisplayName = getUserRoleDisplayName(userData);
    document.getElementById('user-info').textContent = `Connecté en tant que ${userData.username} (${roleDisplayName})`;
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    
    // Charger l'état des modules si pas encore fait
    if (window.ModulesHandler) {
        await window.ModulesHandler.loadStatus();
    }
    
    // Fonction helper pour vérifier module + permission
    const shouldShowElement = (elementId, hasPermission) => {
        // Vérifier d'abord si le module est actif
        if (window.ModulesHandler && !window.ModulesHandler.isElementAllowed(elementId)) {
            return false;
        }
        // Ensuite vérifier la permission utilisateur
        return hasPermission;
    };
    
    // Gérer la visibilité des onglets selon les permissions ET les modules
    const stockInventaireItem = document.getElementById('stock-inventaire-item');
    const copierStockItem = document.getElementById('copier-stock-item');
    const cashPaymentItem = document.getElementById('cash-payment-item');
    const estimationItem = document.getElementById('estimation-item');
    const suiviAchatBoeufItem = document.getElementById('suivi-achat-boeuf-item');
    const paymentLinksItem = document.getElementById('payment-links-item');
    const precommandeItem = document.getElementById('precommande-item');
    const reconciliationItem = document.getElementById('reconciliation-item');
    const reconciliationMoisItem = document.getElementById('reconciliation-mois-item');
    const abonnementsItem = document.getElementById('abonnements-item');
    const stockAlerteItem = document.getElementById('stock-alerte-item');
    
    // Onglet Stock inventaire - pour utilisateurs avec accès à tous les points de vente
    if (stockInventaireItem) {
        stockInventaireItem.style.display = shouldShowElement('stock-inventaire-item', userData.canAccessAllPointsVente) ? 'block' : 'none';
    }
    
    // Onglet Copier Stock - pour utilisateurs qui peuvent copier le stock
    if (copierStockItem) {
        copierStockItem.style.display = shouldShowElement('copier-stock-item', userData.canCopyStock) ? 'block' : 'none';
    }
    
    // Onglet Cash Paiement - pour utilisateurs avancés
    if (cashPaymentItem) {
        cashPaymentItem.style.display = shouldShowElement('cash-payment-item', userData.canManageAdvanced) ? 'block' : 'none';
    }
    
    // Onglet Suivi achat boeuf - pour utilisateurs avancés
    if (suiviAchatBoeufItem) {
        suiviAchatBoeufItem.style.display = shouldShowElement('suivi-achat-boeuf-item', userData.canManageAdvanced) ? 'block' : 'none';
    }
    
    // Onglet Estimation - pour utilisateurs qui peuvent gérer les estimations
    if (estimationItem) {
        estimationItem.style.display = shouldShowElement('estimation-item', userData.canManageEstimation) ? 'block' : 'none';
    }
    
    // Onglet Générer Paiement - pour tous les utilisateurs avec droits d'écriture
    if (paymentLinksItem) {
        paymentLinksItem.style.display = shouldShowElement('payment-links-item', userData.canWrite) ? 'block' : 'none';
    }
    
    // Onglet Pré-commande - pour utilisateurs avec droits d'écriture
    if (precommandeItem) {
        precommandeItem.style.display = shouldShowElement('precommande-item', userData.canWrite) ? 'block' : 'none';
    }
    
    // Onglet Réconciliation - visible pour tous les utilisateurs authentifiés mais contrôlé par module
    if (reconciliationItem) {
        reconciliationItem.style.display = shouldShowElement('reconciliation-item', true) ? 'block' : 'none';
    }
    
    // Onglet Réconciliation du mois - visible pour tous les utilisateurs authentifiés mais contrôlé par module
    if (reconciliationMoisItem) {
        reconciliationMoisItem.style.display = shouldShowElement('reconciliation-mois-item', true) ? 'block' : 'none';
    }
    
    // Onglet Abonnements - pour utilisateurs avec droits d'écriture
    if (abonnementsItem) {
        abonnementsItem.style.display = shouldShowElement('abonnements-item', userData.canWrite) ? 'block' : 'none';
    }
    
    // Onglet Audit/Stock alerte - visible pour tous les utilisateurs authentifiés mais contrôlé par module
    if (stockAlerteItem) {
        stockAlerteItem.style.display = shouldShowElement('stock-alerte-item', true) ? 'block' : 'none';
    }
    
    console.log('✅ Onglets affichés selon droits utilisateur et modules actifs');
}

// Fonction pour initialiser la page d'inventaire
async function initInventaire() {
    console.log('%c=== Initialisation de la page inventaire ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    
    // Charger les modes de stock (auto/manuel) depuis l'API
    await chargerModesStock();
    
    // Initialiser les filtres de stock
    initFilterStock();
    
    // Initialiser le datepicker
    const dateInput = document.getElementById('date-inventaire');
    flatpickr(dateInput, {
        dateFormat: "d/m/Y",
        defaultDate: "today",
        disableMobile: "true",
        onChange: function(selectedDates, dateStr) {
            // Recharger les transferts quand la date change
            chargerTransferts();
            // Recharger les données de stock quand la date change
            chargerStock(dateStr);
            // Mettre à jour l'état des boutons selon les restrictions temporelles
            updateStockButtonsState();
        }
    });
    
    // Initialiser le type de stock
    const typeStockSelect = document.getElementById('type-stock');
    if (typeStockSelect) {
        typeStockSelect.addEventListener('change', onTypeStockChange);
    }
    
    // Initialiser les boutons
    const btnAjouterLigneStock = document.getElementById('add-stock-row');
    if (btnAjouterLigneStock) {
        btnAjouterLigneStock.addEventListener('click', ajouterLigneStock);
    }
    
    const btnSaveStock = document.getElementById('save-stock');
    if (btnSaveStock) {
        btnSaveStock.addEventListener('click', sauvegarderDonneesStock);
    }
    
    // Appliquer le filtre initial
    const masquerQuantiteZero = document.getElementById('masquer-quantite-zero');
    if (masquerQuantiteZero) {
        // Par défaut, ne pas masquer les quantités à zéro
        masquerQuantiteZero.checked = false;
    }
    
    // Charger les données initiales
    try {
        const dateInitiale = dateInput.value;
        console.log('%cChargement initial des données pour la date:', 'color: #00aaff;', dateInitiale);
        
        await chargerStock(dateInitiale);
        await chargerTransferts();
        
        // Mettre à jour l'état initial des boutons
        updateStockButtonsState();
        
    } catch (error) {
        console.error('%cErreur lors du chargement initial des données:', 'color: #ff0000;', error);
        // En cas d'erreur, initialiser quand même le tableau
        ajouterLigneStock();
        // Mettre à jour l'état des boutons même en cas d'erreur
        updateStockButtonsState();
    }
    
    console.log('%c=== Initialisation terminée ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
}

// Fonction pour ajouter une ligne au tableau de stock
function ajouterLigneStock() {
    console.log('Ajout d\'une nouvelle ligne de stock');
    
    // Vérifier les restrictions temporelles
    const dateInput = document.getElementById('date-inventaire');
    const typeStockSelect = document.getElementById('type-stock');
    
    if (dateInput && currentUser && !canModifyStockForDate(dateInput.value, currentUser.username)) {
        alert('Vous ne pouvez pas ajouter de ligne pour cette date. Les utilisateurs peuvent modifier le stock seulement le jour J et jusqu\'au lendemain avant 4h00 du matin. Seuls administrateurs sont exemptés de cette restriction.');
        return;
    }
    
    // Vérifier les restrictions spécifiques au stock matin
    if (typeStockSelect && typeStockSelect.value === 'matin' && currentUser && !canModifyStockMatinFields(currentUser.username)) {
        alert('Le stock matin est rempli automatiquement par le système. Seuls les administrateurs peuvent ajouter des lignes manuellement.');
        return;
    }
    
    const tbody = document.querySelector('#stock-table tbody');
    if (!tbody) {
        console.error('Table de stock non trouvée');
        return;
    }

    const row = document.createElement('tr');
    const typeStock = document.getElementById('type-stock').value;
    row.dataset.typeStock = typeStock;
    
    // Point de vente
    const tdPointVente = document.createElement('td');
    const selectPointVente = document.createElement('select');
    selectPointVente.className = 'form-select form-select-sm point-vente-select';
    POINTS_VENTE_PHYSIQUES.forEach(pv => {
        const option = document.createElement('option');
        option.value = pv;
        option.textContent = pv;
        selectPointVente.appendChild(option);
    });
    tdPointVente.appendChild(selectPointVente);
    
    // Produit
    const tdProduit = document.createElement('td');
    const selectProduit = document.createElement('select');
    selectProduit.className = 'form-select form-select-sm produit-select';
    PRODUITS_INVENTAIRE.forEach(prod => {
        const option = document.createElement('option');
        option.value = prod;
        option.textContent = prod;
        selectProduit.appendChild(option);
    });
    tdProduit.appendChild(selectProduit);
    
    // Quantité
    const tdQuantite = document.createElement('td');
    const inputQuantite = document.createElement('input');
    inputQuantite.type = 'number';
    inputQuantite.className = 'form-control form-control-sm quantite-input';
    inputQuantite.step = '0.001';
    inputQuantite.value = '0';
    // Ajouter l'écouteur d'événement pour appliquer le filtre quand la quantité change
    inputQuantite.addEventListener('change', function() {
        // Appliquer le filtre si le masquage des quantités à zéro est activé
        if (document.getElementById('masquer-quantite-zero').checked) {
            filtrerStock();
        }
    });
    tdQuantite.appendChild(inputQuantite);
    
    // Prix unitaire
    const tdPrixUnitaire = document.createElement('td');
    const inputPrixUnitaire = document.createElement('input');
    inputPrixUnitaire.type = 'number';
    inputPrixUnitaire.className = 'form-control form-control-sm prix-unitaire-input';
    inputPrixUnitaire.value = PRIX_DEFAUT_INVENTAIRE[selectProduit.value] || '0';
    tdPrixUnitaire.appendChild(inputPrixUnitaire);
    
    // Total
    const tdTotal = document.createElement('td');
    tdTotal.className = 'total-cell';
    tdTotal.textContent = '0';
    
    // Commentaire
    const tdCommentaire = document.createElement('td');
    const inputCommentaire = document.createElement('input');
    inputCommentaire.type = 'text';
    inputCommentaire.className = 'form-control form-control-sm commentaire-input';
    tdCommentaire.appendChild(inputCommentaire);
    
    // Actions
    const tdActions = document.createElement('td');
    const btnSupprimer = document.createElement('button');
    btnSupprimer.className = 'btn btn-danger btn-sm';
    btnSupprimer.innerHTML = '<i class="fas fa-trash"></i>';
    btnSupprimer.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Vérifier les restrictions temporelles pour la suppression
        const dateInput = document.getElementById('date-inventaire');
        const typeStockSelect = document.getElementById('type-stock');
        
        if (dateInput && currentUser && !canModifyStockForDate(dateInput.value, currentUser.username)) {
            alert('Vous ne pouvez pas supprimer cette ligne pour cette date. Les utilisateurs peuvent modifier le stock seulement le jour J et jusqu\'au lendemain avant 4h00 du matin. Seuls administrateurs sont exemptés de cette restriction.');
            return;
        }
        
        // Vérifier les restrictions spécifiques au stock matin
        if (typeStockSelect && typeStockSelect.value === 'matin' && currentUser && !canModifyStockMatinFields(currentUser.username)) {
            alert('Le stock matin est rempli automatiquement par le système. Seuls les administrateurs peuvent supprimer des lignes manuellement.');
            return;
        }
        
        if (confirm('Êtes-vous sûr de vouloir supprimer cette ligne ?')) {
            row.remove();
        }
    });
    tdActions.appendChild(btnSupprimer);
    
    // Ajouter les cellules à la ligne
    row.append(tdPointVente, tdProduit, tdQuantite, tdPrixUnitaire, tdTotal, tdCommentaire, tdActions);
    
    // Gestionnaire pour le calcul automatique du total
    const calculateTotal = () => {
        const quantite = parseFloat(inputQuantite.value) || 0;
        const prixUnitaire = parseFloat(inputPrixUnitaire.value) || 0;
        tdTotal.textContent = (quantite * prixUnitaire).toLocaleString('fr-FR');
    };
    
    // Gestionnaire pour la mise à jour du prix unitaire par défaut
    selectProduit.addEventListener('change', function() {
        const nouveauProduit = this.value;
        const pointVente = selectPointVente.value;
        const prix = produitsInventaire.getPrixDefaut(nouveauProduit, pointVente);
        inputPrixUnitaire.value = prix || '0';
        calculateTotal();
    });
    
    // Gestionnaire pour la mise à jour du prix unitaire quand le point de vente change
    selectPointVente.addEventListener('change', function() {
        const produit = selectProduit.value;
        const pointVente = this.value;
        const prix = produitsInventaire.getPrixDefaut(produit, pointVente);
        inputPrixUnitaire.value = prix || '0';
        calculateTotal();
    });
    
    // Ajouter les écouteurs d'événements
    inputQuantite.addEventListener('input', calculateTotal);
    inputPrixUnitaire.addEventListener('input', calculateTotal);
    
    tbody.appendChild(row);
    console.log('Nouvelle ligne de stock ajoutée');
}

// Fonction pour vérifier les restrictions temporelles pour NADOU et PAPI
function verifierRestrictionsTemporelles(date, username) {
    if (username === 'NADOU' || username === 'PAPI') {
        const [day, month, year] = date.split('/');
        const dateStock = new Date(year, month - 1, day);
        const maintenant = new Date();
        
        // Calculer la date limite : date du stock + 1 jour + 3 heures
        const dateLimite = new Date(dateStock);
        dateLimite.setDate(dateLimite.getDate() + 1);
        dateLimite.setHours(3, 0, 0, 0);
        
        if (maintenant > dateLimite) {
            return {
                restricted: true,
                message: `Modification interdite. Les données du ${date} ne peuvent plus être modifiées après le ${dateLimite.toLocaleDateString('fr-FR')} à 3h00.`
            };
        }
    }
    return { restricted: false };
}

// Fonction pour sauvegarder les données de stock
async function sauvegarderDonneesStock() {
    console.log('%c=== Sauvegarde des données de stock ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    const typeStock = document.getElementById('type-stock').value;
    const date = document.getElementById('date-inventaire').value;
    console.log('%cType de stock:', 'color: #ff9900; font-weight: bold;', typeStock);
    console.log('%cDate:', 'color: #ff9900;', date);

    // Vérifier les restrictions temporelles avec la nouvelle logique
    if (!canModifyStockForDate(date, currentUser.username)) {
        alert('Vous ne pouvez pas sauvegarder le stock pour cette date. Les utilisateurs peuvent modifier le stock seulement le jour J et jusqu\'au lendemain avant 4h00 du matin. Seuls administrateurs sont exemptés de cette restriction.');
        return;
    }

    // Collecter les données du tableau
    const donnees = {};
    const resume = [];
    let totalGeneral = 0;

    // Helper to fetch prix moyen
    async function fetchPrixMoyen(produit, date, pointVente, isTransfert) {
        let url = '';
        if (isTransfert) {
            url = `/api/prix-moyen?type=${encodeURIComponent(produit.toLowerCase())}&date=${encodeURIComponent(date)}`;
        } else {
            url = `/api/prix-moyen?type=${encodeURIComponent(produit.toLowerCase())}&date=${encodeURIComponent(date)}&pointVente=${encodeURIComponent(pointVente)}`;
        }
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('API error');
            const data = await response.json();
            // Extract prix_moyen_pondere from the first item in data array
            if (data.success && Array.isArray(data.data) && data.data.length > 0) {
                return parseFloat(data.data[0].prix_moyen_pondere) || null;
            }
            return null;
        } catch (err) {
            console.error('Erreur lors de la récupération du prix moyen:', err);
            return null;
        }
    }

    // Use for...of for async/await
    const rows = Array.from(document.querySelectorAll('#stock-table tbody tr'));
    for (const row of rows) {
        const pointVenteSelect = row.querySelector('.point-vente-select');
        const produitSelect = row.querySelector('.produit-select');
        
        // Vérifier que les selects existent
        if (!pointVenteSelect || !produitSelect) {
            continue;
        }
        
        const pointVente = pointVenteSelect.value;
        const produit = produitSelect.value;
        const quantite = parseFloat(row.querySelector('.quantite-input').value) || 0;
        const prixUnitaireInput = row.querySelector('.prix-unitaire-input').value;
        let prixUnitaire = parseFloat(prixUnitaireInput);
        const commentaire = row.querySelector('.commentaire-input')?.value || '';
        
        // Récupérer le mode depuis la ligne (data attribute)
        const modeStock = row.dataset.modeStock || PRODUITS_MODE_STOCK[produit] || 'manuel';

        // Determine if we need to fetch prix moyen
        let needApi = false;
        let isTransfert = false;
        if ((produit === 'Boeuf' || produit === 'Veau')) {
            if (typeStock === 'Stock Matin' || typeStock === 'Stock Soir') {
                needApi = true;
            } else if (typeStock === 'Transfert') {
                needApi = true;
                isTransfert = true;
            }
        }

        if (needApi) {
            let fetchedPrix = null;
            if (isNaN(prixUnitaire) || prixUnitaireInput === '') {
                fetchedPrix = await fetchPrixMoyen(produit, date, pointVente, isTransfert);
                prixUnitaire = fetchedPrix !== null ? fetchedPrix : (produitsInventaire.getPrixDefaut(produit, pointVente) || 0);
            }
        } else {
            if (isNaN(prixUnitaire) || prixUnitaireInput === '') {
                prixUnitaire = produitsInventaire.getPrixDefaut(produit, pointVente) || 0;
            }
        }

        const total = quantite * prixUnitaire;

        // Sauvegarder si quantité != 0 (même négatif pour les produits auto)
        if (quantite !== 0 || modeStock === 'automatique') {
            const key = `${pointVente}-${produit}`;
            donnees[key] = {
                date: date,
                typeStock: typeStock,
                "Point de Vente": pointVente,
                Produit: produit,
                Nombre: quantite.toString(),
                PU: prixUnitaire.toString(),
                Montant: total.toString(),
                Commentaire: commentaire,
                mode: modeStock  // Ajouter le mode (manuel ou automatique)
            };
            resume.push(`${pointVente} - ${produit}: ${quantite} ${modeStock === 'automatique' ? '⚡' : ''} à ${prixUnitaire.toLocaleString('fr-FR')} FCFA = ${total.toLocaleString('fr-FR')} FCFA`);
            totalGeneral += total;
        }
    }

    if (Object.keys(donnees).length === 0) {
        alert('Aucune donnée à sauvegarder. Veuillez saisir au moins une quantité.');
        return;
    }

    // Demander confirmation avec résumé
    const message = `Voulez-vous sauvegarder les données suivantes pour le stock ${typeStock} du ${date} ?\n\n` +
                   `${resume.join('\n')}\n\n` +
                   `Total général: ${totalGeneral.toLocaleString('fr-FR')} FCFA\n\n` +
                   `Cette action écrasera les données existantes pour ce type de stock.`;

    if (!confirm(message)) {
        return;
    }

    try {
        console.log('%cEnvoi des données au serveur...', 'color: #ff9900;');
        const response = await fetch(`/api/stock/${typeStock}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(donnees)
        });

        const result = await response.json();
        if (result.success) {
            console.log('%cDonnées sauvegardées avec succès', 'color: #00ff00; font-weight: bold;');
            alert('Données sauvegardées avec succès');
            
            // Mettre à jour stockData après la sauvegarde
            if (typeStock === 'matin') {
                stockData.matin = new Map(Object.entries(donnees));
            } else {
                stockData.soir = new Map(Object.entries(donnees));
            }
        } else {
            // Afficher le message d'erreur spécifique du serveur, notamment pour les restrictions temporelles
            throw new Error(result.error || 'Erreur lors de la sauvegarde');
        }
    } catch (error) {
        console.error('%cErreur lors de la sauvegarde:', 'color: #ff0000; font-weight: bold;', error);
        alert('Erreur lors de la sauvegarde des données: ' + error.message);
    }
}
// Fonction pour initialiser le tableau de stock
function initTableauStock() {
    console.log('%c=== Début initTableauStock ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    
    const tbody = document.querySelector('#stock-table tbody');
    const typeStock = document.getElementById('type-stock').value;
    console.log('%cType de stock actuel:', 'color: #ff9900; font-weight: bold;', typeStock);

    tbody.innerHTML = '';

    // Récupérer les données sauvegardées pour le type de stock actuel
    const donneesSauvegardees = stockData[typeStock];
    console.log('%cDonnées récupérées pour', 'color: #00ff00;', typeStock, ':', {
        nombreEntrees: donneesSauvegardees ? donneesSauvegardees.size : 0
    });

    // Trier les produits : manuels d'abord, puis automatiques
    const produitsTries = [...PRODUITS_INVENTAIRE].sort((a, b) => {
        const modeA = PRODUITS_MODE_STOCK[a] || 'manuel';
        const modeB = PRODUITS_MODE_STOCK[b] || 'manuel';
        
        // 'manuel' vient avant 'automatique'
        if (modeA === 'manuel' && modeB === 'automatique') return -1;
        if (modeA === 'automatique' && modeB === 'manuel') return 1;
        
        // Si même mode, trier par nom de produit
        return a.localeCompare(b, 'fr');
    });
    
    // Pour chaque point de vente physique
    POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
        // Pour chaque produit (dans l'ordre trié)
        produitsTries.forEach(produit => {
            const key = `${pointVente}-${produit}`;
            
            // Vérifier si le produit est en mode automatique (depuis la table produits)
            const modeStock = PRODUITS_MODE_STOCK[produit] || 'manuel';
            const isAutomatic = modeStock === 'automatique';
            
            const row = document.createElement('tr');
            row.dataset.typeStock = typeStock;
            row.dataset.modeStock = modeStock;
            row.dataset.pointVente = pointVente;
            row.dataset.produit = produit;
            
            // Style pour produits automatiques
            if (isAutomatic) {
                row.classList.add('stock-auto-row');
                row.style.backgroundColor = 'rgba(99, 102, 241, 0.05)';
            }
            
            // Point de vente (select pour tous)
            const tdPointVente = document.createElement('td');
            const selectPointVente = document.createElement('select');
            selectPointVente.className = 'form-select form-select-sm point-vente-select';
            POINTS_VENTE_PHYSIQUES.forEach(pv => {
                const option = document.createElement('option');
                option.value = pv;
                option.textContent = pv;
                if (pv === pointVente) option.selected = true;
                selectPointVente.appendChild(option);
            });
            tdPointVente.appendChild(selectPointVente);
            row.appendChild(tdPointVente);

            // Produit (select pour tous, avec badge Auto si automatique)
            const tdProduit = document.createElement('td');
            
            // Badge Auto si produit automatique
            if (isAutomatic) {
                const badge = document.createElement('span');
                badge.className = 'badge bg-primary me-1';
                badge.textContent = '⚡';
                badge.style.fontSize = '0.75rem';
                badge.title = 'Produit automatique';
                tdProduit.appendChild(badge);
            }
            
            const selectProduit = document.createElement('select');
            selectProduit.className = 'form-select form-select-sm produit-select';
            if (isAutomatic) {
                selectProduit.style.display = 'inline-block';
                selectProduit.style.width = 'calc(100% - 50px)';
            }
            // Utiliser la liste triée pour les options du select
            produitsTries.forEach(prod => {
                const option = document.createElement('option');
                option.value = prod;
                option.textContent = prod;
                if (prod === produit) option.selected = true;
                selectProduit.appendChild(option);
            });
            tdProduit.appendChild(selectProduit);
            
            // Badge unité pour auto
            if (isAutomatic) {
                const unite = PRODUITS_UNITE_STOCK[produit] || 'unite';
                const uniteSpan = document.createElement('span');
                uniteSpan.className = 'badge bg-secondary ms-1';
                uniteSpan.textContent = unite === 'kilo' ? 'kg' : 'u';
                uniteSpan.style.fontSize = '0.6rem';
                tdProduit.appendChild(uniteSpan);
            }
            row.appendChild(tdProduit);

            // Quantité (éditable pour tous)
            const tdQuantite = document.createElement('td');
            const inputQuantite = document.createElement('input');
            inputQuantite.type = 'number';
            inputQuantite.className = 'form-control form-control-sm quantite-input';
            inputQuantite.step = '0.001';
            
            // Prix unitaire
            const tdPrixUnitaire = document.createElement('td');
            const inputPrixUnitaire = document.createElement('input');
            inputPrixUnitaire.type = 'number';
            inputPrixUnitaire.className = 'form-control form-control-sm prix-unitaire-input';
            inputPrixUnitaire.step = '0.01';
            inputPrixUnitaire.min = '0';
            
            // Total
            const tdTotal = document.createElement('td');
            tdTotal.className = 'total-cell';
            
            // Commentaire
            const tdCommentaire = document.createElement('td');
            const inputCommentaire = document.createElement('input');
            inputCommentaire.type = 'text';
            inputCommentaire.className = 'form-control form-control-sm commentaire-input';
            
            // Charger les données depuis le JSON (unifié pour tous les produits)
            if (donneesSauvegardees && donneesSauvegardees.has(key)) {
                const donnees = donneesSauvegardees.get(key);
                const quantite = parseFloat(donnees.Nombre || donnees.quantite || 0);
                inputQuantite.value = quantite;
                inputPrixUnitaire.value = donnees.PU || donnees.prixUnitaire || PRIX_DEFAUT_INVENTAIRE[produit] || 0;
                inputCommentaire.value = donnees.Commentaire || donnees.commentaire || '';
                
                // Afficher en rouge si quantité négative
                if (quantite < 0) {
                    inputQuantite.style.backgroundColor = '#ffcccc';
                    inputQuantite.style.color = '#cc0000';
                    inputQuantite.style.fontWeight = 'bold';
                }
                
                const total = quantite * parseFloat(inputPrixUnitaire.value);
                tdTotal.textContent = total.toLocaleString('fr-FR');
                if (total < 0) {
                    tdTotal.style.color = '#cc0000';
                    tdTotal.style.fontWeight = 'bold';
                }
            } else {
                inputQuantite.value = '0';
                inputPrixUnitaire.value = PRIX_DEFAUT_INVENTAIRE[produit] || produitsInventaire?.getPrixDefaut?.(produit, pointVente) || 0;
                inputCommentaire.value = '';
                tdTotal.textContent = '0';
            }
            
            tdQuantite.appendChild(inputQuantite);
            tdPrixUnitaire.appendChild(inputPrixUnitaire);
            tdCommentaire.appendChild(inputCommentaire);
            
            // Actions (bouton supprimer pour tous)
            const tdActions = document.createElement('td');
            const btnSupprimer = document.createElement('button');
            btnSupprimer.className = 'btn btn-danger btn-sm';
            btnSupprimer.innerHTML = '<i class="fas fa-trash"></i>';
            btnSupprimer.addEventListener('click', (e) => {
                e.preventDefault();
                
                const dateInput = document.getElementById('date-inventaire');
                const typeStockSelect = document.getElementById('type-stock');
                
                if (dateInput && currentUser && !canModifyStockForDate(dateInput.value, currentUser.username)) {
                    alert('Vous ne pouvez pas supprimer cette ligne pour cette date.');
                    return;
                }
                
                if (typeStockSelect && typeStockSelect.value === 'matin' && currentUser && !canModifyStockMatinFields(currentUser.username)) {
                    alert('Seuls les administrateurs peuvent supprimer des lignes du stock matin.');
                    return;
                }
                
                if (confirm('Êtes-vous sûr de vouloir supprimer cette ligne ?')) {
                    row.remove();
                }
            });
            tdActions.appendChild(btnSupprimer);
            
            row.append(tdPointVente, tdProduit, tdQuantite, tdPrixUnitaire, tdTotal, tdCommentaire, tdActions);
            
            // Gestionnaire pour le calcul automatique du total
            const updateTotal = () => {
                const q = parseFloat(inputQuantite.value) || 0;
                const p = parseFloat(inputPrixUnitaire.value) || 0;
                const total = q * p;
                tdTotal.textContent = total.toLocaleString('fr-FR');
                
                // Style rouge si négatif
                if (q < 0) {
                    inputQuantite.style.backgroundColor = '#ffcccc';
                    inputQuantite.style.color = '#cc0000';
                    inputQuantite.style.fontWeight = 'bold';
                    tdTotal.style.color = '#cc0000';
                    tdTotal.style.fontWeight = 'bold';
                } else {
                    inputQuantite.style.backgroundColor = '';
                    inputQuantite.style.color = '';
                    inputQuantite.style.fontWeight = '';
                    tdTotal.style.color = '';
                    tdTotal.style.fontWeight = '';
                }
            };
            
            inputQuantite.addEventListener('input', updateTotal);
            inputPrixUnitaire.addEventListener('input', updateTotal);
            
            // Gestionnaire pour le filtre
            inputQuantite.addEventListener('change', () => {
                if (document.getElementById('masquer-quantite-zero').checked) {
                    filtrerStock();
                }
            });
            
            tbody.appendChild(row);
        });
    });
    
    // =======================================================================
    // AJOUT AUTOMATIQUE DES PRODUITS DU JSON QUI NE SONT PAS DANS PRODUITS_INVENTAIRE
    // (ex: produits importés via OCR)
    // =======================================================================
    if (donneesSauvegardees && donneesSauvegardees.size > 0) {
        const produitsDejaAffiches = new Set();
        POINTS_VENTE_PHYSIQUES.forEach(pv => {
            PRODUITS_INVENTAIRE.forEach(prod => {
                produitsDejaAffiches.add(`${pv}-${prod}`);
            });
        });
        
        console.log('%c🔍 Recherche de produits supplémentaires dans le JSON...', 'color: #ff9900;');
        
        // Parcourir toutes les clés du JSON pour trouver les produits non listés
        donneesSauvegardees.forEach((donnees, key) => {
            if (!produitsDejaAffiches.has(key)) {
                // Extraire pointVente et produit de la clé
                const [pointVente, ...produitParts] = key.split('-');
                const produit = produitParts.join('-'); // Si le nom contient des tirets
                
                console.log(`%c📦 Ajout produit auto du JSON: ${produit} @ ${pointVente}`, 'color: #00ff00;');
                
                // Créer une nouvelle ligne pour ce produit
                const row = document.createElement('tr');
                row.dataset.typeStock = typeStock;
                row.dataset.modeStock = donnees.mode || 'automatique';
                row.dataset.pointVente = pointVente;
                row.dataset.produit = produit;
                
                // Style pour produits automatiques
                row.classList.add('stock-auto-row');
                row.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
                
                // Point de vente (texte simple car pas dans POINTS_VENTE_PHYSIQUES)
                const tdPointVente = document.createElement('td');
                const selectPointVente = document.createElement('select');
                selectPointVente.className = 'form-select form-select-sm point-vente-select';
                // Ajouter le point de vente actuel + tous les autres
                const allPointsVente = [...new Set([pointVente, ...POINTS_VENTE_PHYSIQUES])];
                allPointsVente.forEach(pv => {
                    const option = document.createElement('option');
                    option.value = pv;
                    option.textContent = pv;
                    if (pv === pointVente) option.selected = true;
                    selectPointVente.appendChild(option);
                });
                tdPointVente.appendChild(selectPointVente);
                row.appendChild(tdPointVente);

                // Produit avec badge Auto
                const tdProduit = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = 'badge bg-primary me-1';
                badge.textContent = '⚡';
                badge.style.fontSize = '0.75rem';
                badge.title = 'Produit automatique';
                tdProduit.appendChild(badge);
                
                const selectProduit = document.createElement('select');
                selectProduit.className = 'form-select form-select-sm produit-select';
                selectProduit.style.display = 'inline-block';
                selectProduit.style.width = 'calc(100% - 50px)';
                // Ajouter le produit actuel + tous les autres
                const allProduits = [...new Set([produit, ...PRODUITS_INVENTAIRE])];
                allProduits.forEach(prod => {
                    const option = document.createElement('option');
                    option.value = prod;
                    option.textContent = prod;
                    if (prod === produit) option.selected = true;
                    selectProduit.appendChild(option);
                });
                tdProduit.appendChild(selectProduit);
                
                // Badge unité
                const unite = PRODUITS_UNITE_STOCK[produit] || 'kilo';
                const uniteSpan = document.createElement('span');
                uniteSpan.className = 'badge bg-secondary ms-1';
                uniteSpan.textContent = unite === 'kilo' ? 'kg' : 'u';
                uniteSpan.style.fontSize = '0.6rem';
                tdProduit.appendChild(uniteSpan);
                row.appendChild(tdProduit);

                // Quantité
                const tdQuantite = document.createElement('td');
                const inputQuantite = document.createElement('input');
                inputQuantite.type = 'number';
                inputQuantite.className = 'form-control form-control-sm quantite-input';
                inputQuantite.step = '0.001';
                const quantite = parseFloat(donnees.Nombre || donnees.quantite || 0);
                inputQuantite.value = quantite;
                
                // Style rouge si négatif
                if (quantite < 0) {
                    inputQuantite.style.backgroundColor = '#ffcccc';
                    inputQuantite.style.color = '#cc0000';
                    inputQuantite.style.fontWeight = 'bold';
                }
                tdQuantite.appendChild(inputQuantite);
                row.appendChild(tdQuantite);
                
                // Prix unitaire
                const tdPrixUnitaire = document.createElement('td');
                const inputPrixUnitaire = document.createElement('input');
                inputPrixUnitaire.type = 'number';
                inputPrixUnitaire.className = 'form-control form-control-sm prix-unitaire-input';
                inputPrixUnitaire.step = '0.01';
                inputPrixUnitaire.min = '0';
                inputPrixUnitaire.value = donnees.PU || donnees.prixUnitaire || 0;
                tdPrixUnitaire.appendChild(inputPrixUnitaire);
                row.appendChild(tdPrixUnitaire);
                
                // Total
                const tdTotal = document.createElement('td');
                tdTotal.className = 'total-cell';
                const total = quantite * parseFloat(inputPrixUnitaire.value);
                tdTotal.textContent = total.toLocaleString('fr-FR');
                if (total < 0) {
                    tdTotal.style.color = '#cc0000';
                    tdTotal.style.fontWeight = 'bold';
                }
                row.appendChild(tdTotal);
                
                // Commentaire
                const tdCommentaire = document.createElement('td');
                const inputCommentaire = document.createElement('input');
                inputCommentaire.type = 'text';
                inputCommentaire.className = 'form-control form-control-sm commentaire-input';
                inputCommentaire.value = donnees.Commentaire || donnees.commentaire || '';
                tdCommentaire.appendChild(inputCommentaire);
                row.appendChild(tdCommentaire);
                
                // Actions
                const tdActions = document.createElement('td');
                const btnSupprimer = document.createElement('button');
                btnSupprimer.className = 'btn btn-danger btn-sm';
                btnSupprimer.innerHTML = '<i class="fas fa-trash"></i>';
                btnSupprimer.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (confirm('Êtes-vous sûr de vouloir supprimer cette ligne ?')) {
                        row.remove();
                    }
                });
                tdActions.appendChild(btnSupprimer);
                row.appendChild(tdActions);
                
                // Gestionnaires pour le calcul automatique du total
                const updateTotal = () => {
                    const q = parseFloat(inputQuantite.value) || 0;
                    const p = parseFloat(inputPrixUnitaire.value) || 0;
                    const newTotal = q * p;
                    tdTotal.textContent = newTotal.toLocaleString('fr-FR');
                    
                    if (q < 0) {
                        inputQuantite.style.backgroundColor = '#ffcccc';
                        inputQuantite.style.color = '#cc0000';
                        inputQuantite.style.fontWeight = 'bold';
                        tdTotal.style.color = '#cc0000';
                        tdTotal.style.fontWeight = 'bold';
                    } else {
                        inputQuantite.style.backgroundColor = '';
                        inputQuantite.style.color = '';
                        inputQuantite.style.fontWeight = '';
                        tdTotal.style.color = '';
                        tdTotal.style.fontWeight = '';
                    }
                };
                
                inputQuantite.addEventListener('input', updateTotal);
                inputPrixUnitaire.addEventListener('input', updateTotal);
                
                tbody.appendChild(row);
            }
        });
    }
    
    console.log('%c=== Fin initTableauStock ===', 'background: #222; color: #bada55;');
}

// Configuration pour l'inventaire to refac point de vente
// Note: POINTS_VENTE_PHYSIQUES est déclaré en haut du fichier

// Fonction pour initialiser POINTS_VENTE_PHYSIQUES depuis l'API
async function initPointsVentePhysiques() {
    try {
        const response = await fetch('/api/points-vente');
        if (response.ok) {
            const activePointsVente = await response.json();
            console.log('Données reçues de l\'API /api/points-vente:', activePointsVente);
            console.log('Type des données:', typeof activePointsVente, Array.isArray(activePointsVente));
            POINTS_VENTE_PHYSIQUES = activePointsVente;
            console.log('POINTS_VENTE_PHYSIQUES mis à jour depuis l\'API:', POINTS_VENTE_PHYSIQUES);
            
            // Mettre à jour TOUS_POINTS_VENTE avec les nouveaux points de vente actifs
            await initTousPointsVente();
        }
    } catch (error) {
        console.error('Erreur lors de l\'initialisation de POINTS_VENTE_PHYSIQUES:', error);
    }
}
// Configuration pour l'inventaire - lecture depuis produitsInventaire.js (pour Stock inventaire seulement)
const PRODUITS_INVENTAIRE = [];
const PRIX_DEFAUT_INVENTAIRE = {};
const PRODUITS_MODE_STOCK = {}; // Stocke le mode_stock pour chaque produit ('manuel' ou 'automatique')
const PRODUITS_UNITE_STOCK = {}; // Stocke l'unite_stock pour chaque produit ('unite' ou 'kilo')
// Stocke les données de stock (les produits auto sont maintenant dans le JSON)
let stockAutoData = new Map(); // DEPRECATED - Plus utilisé

// Fonction pour charger les modes de stock depuis l'API produits
async function chargerModesStock() {
    try {
        const response = await fetch('/api/admin/config/produits-inventaire', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.produitsInventaire) {
                // L'API retourne un objet qui peut contenir:
                // - Des produits directs: { "Boeuf": { prixDefault, mode_stock, unite_stock, ... } }
                // - Des catégories: { "Légumes": { "Ail": { prixDefault, ... }, "Carotte": { ... } } }
                const produitsInventaire = result.produitsInventaire;
                
                // Parcourir chaque clé de premier niveau
                for (const cle in produitsInventaire) {
                    const valeur = produitsInventaire[cle];
                    
                    // Vérifier si c'est un produit (a prixDefault) ou une catégorie (contient des produits)
                    if (valeur && typeof valeur === 'object') {
                        if (valeur.prixDefault !== undefined) {
                            // C'est un produit direct au niveau racine
                            const config = valeur;
                            PRODUITS_MODE_STOCK[cle] = config.mode_stock || 'manuel';
                            PRODUITS_UNITE_STOCK[cle] = config.unite_stock || 'unite';
                            
                            if (!PRODUITS_INVENTAIRE.includes(cle)) {
                                PRODUITS_INVENTAIRE.push(cle);
                                PRIX_DEFAUT_INVENTAIRE[cle] = parseFloat(config.prixDefault) || 0;
                            }
                        } else {
                            // C'est une catégorie contenant des produits
                            for (const nomProduit in valeur) {
                                const config = valeur[nomProduit];
                                
                                // Vérifier que c'est bien un produit (pas une propriété technique)
                                if (config && typeof config === 'object' && config.prixDefault !== undefined) {
                                    PRODUITS_MODE_STOCK[nomProduit] = config.mode_stock || 'manuel';
                                    PRODUITS_UNITE_STOCK[nomProduit] = config.unite_stock || 'unite';
                                    
                                    if (!PRODUITS_INVENTAIRE.includes(nomProduit)) {
                                        PRODUITS_INVENTAIRE.push(nomProduit);
                                        PRIX_DEFAUT_INVENTAIRE[nomProduit] = parseFloat(config.prixDefault) || 0;
                                    }
                                }
                            }
                        }
                    }
                }
                
                console.log('%c📦 Modes de stock chargés:', 'color: #00ff00;', Object.keys(PRODUITS_MODE_STOCK).length, 'produits');
                console.log('%c📦 PRODUITS_INVENTAIRE:', 'color: #00ff00;', PRODUITS_INVENTAIRE.length, 'produits');
            }
        }
    } catch (error) {
        console.error('%cErreur chargement modes de stock:', 'color: #ff0000;', error);
    }
}

// PRODUITS_INVENTAIRE est chargé uniquement depuis chargerModesStock() via l'API
// pour éviter les doublons. Le chargement depuis produitsInventaire.js est désactivé.
console.log('%c📦 PRODUITS_INVENTAIRE sera chargé via chargerModesStock()', 'color: #ff9900;');

// Configuration pour les autres sections - lecture depuis produits.js
const PRODUITS = [];
const PRIX_DEFAUT = {};

// Extraire tous les produits de toutes les catégories de produits.js (pour les autres sections)
Object.keys(produits).forEach(categorie => {
    if (typeof produits[categorie] === 'object' && produits[categorie] !== null) {
        Object.keys(produits[categorie]).forEach(produit => {
            if (typeof produits[categorie][produit] === 'object' && produits[categorie][produit].default !== undefined) {
                PRODUITS.push(produit);
                PRIX_DEFAUT[produit] = produits[categorie][produit].default;
            }
        });
    }
});

// Tous les points de vente (chargés depuis la BDD)
let TOUS_POINTS_VENTE = [...POINTS_VENTE_PHYSIQUES];

// Fonction pour mettre à jour TOUS_POINTS_VENTE
function updateTousPointsVente() {
    TOUS_POINTS_VENTE = [...POINTS_VENTE_PHYSIQUES];
    console.log('TOUS_POINTS_VENTE mis à jour:', TOUS_POINTS_VENTE);
}

// Fonction pour initialiser TOUS_POINTS_VENTE depuis l'API spécifique aux transferts
async function initTousPointsVente() {
    try {
        const response = await fetch('/api/points-vente/transferts');
        if (response.ok) {
            const tousPointsVente = await response.json();
            console.log('Données reçues de l\'API /api/points-vente/transferts:', tousPointsVente);
            TOUS_POINTS_VENTE = tousPointsVente;
            console.log('TOUS_POINTS_VENTE mis à jour depuis l\'API transferts:', TOUS_POINTS_VENTE);
        }
    } catch (error) {
        console.error('Erreur lors de l\'initialisation de TOUS_POINTS_VENTE:', error);
        // Fallback: utiliser la méthode locale
        updateTousPointsVente();
    }
}

// Variables globales pour stocker les données de stock
let stockData = {
    matin: new Map(),
    soir: new Map()
};

// Fonction séparée pour gérer le changement de type de stock
async function onTypeStockChange() {
    console.log('%c=== Changement de type de stock ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    const typeStock = document.getElementById('type-stock').value;
    const dateSelectionnee = document.getElementById('date-inventaire').value;
    console.log('%cNouveau type de stock:', 'color: #ff9900; font-weight: bold;', typeStock);
    console.log('%cDate sélectionnée:', 'color: #ff9900; font-weight: bold;', dateSelectionnee);

    try {
        console.log('%cRécupération des données depuis le serveur pour le type:', 'color: #00aaff;', typeStock);
        const response = await fetch(`/api/stock/${typeStock}?date=${dateSelectionnee}`, {
            method: 'GET',
            credentials: 'include'
        });
        let donneesRecues = await response.json();
        console.log('%cDonnées brutes reçues du serveur:', 'color: #00ff00;', donneesRecues);

        // Format plat attendu: { "Keur Bali-Ail": { Nombre: "5", PU: "552", ... } }
        // Les données sont déjà au format plat depuis le serveur
        const donnees = donneesRecues || {};
        
        console.log('%cDonnées chargées (format plat):', 'color: #00ff00;', Object.keys(donnees).length, 'entrées');

        // Vider le tableau
        const tbody = document.querySelector('#stock-table tbody');
        tbody.innerHTML = '';

        // Recréer les lignes pour chaque point de vente et produit
        POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
            PRODUITS_INVENTAIRE.forEach(produit => {
                const tr = document.createElement('tr');
                
                // Vérifier le mode du produit
                const modeStock = PRODUITS_MODE_STOCK[produit] || 'manuel';
                const isAutomatic = modeStock === 'automatique';
                
                // Style pour produits automatiques
                if (isAutomatic) {
                    tr.classList.add('stock-auto-row');
                    tr.style.backgroundColor = 'rgba(99, 102, 241, 0.05)';
                }
                
                tr.dataset.modeStock = modeStock;
                tr.dataset.pointVente = pointVente;
                tr.dataset.produit = produit;
                
                // Point de vente (modifiable)
                const tdPointVente = document.createElement('td');
                const selectPointVente = document.createElement('select');
                selectPointVente.className = 'form-select form-select-sm point-vente-select';
                POINTS_VENTE_PHYSIQUES.forEach(pv => {
                    const option = document.createElement('option');
                    option.value = pv;
                    option.textContent = pv;
                    if (pv === pointVente) {
                        option.selected = true;
                    }
                    selectPointVente.appendChild(option);
                });
                tdPointVente.appendChild(selectPointVente);
                tr.appendChild(tdPointVente);

                // Produit (modifiable) avec badge si automatique
                const tdProduit = document.createElement('td');
                
                // Badge Auto si produit automatique
                if (isAutomatic) {
                    const badge = document.createElement('span');
                    badge.className = 'badge bg-primary me-1';
                    badge.textContent = '⚡';
                    badge.style.fontSize = '0.75rem';
                    badge.title = 'Produit automatique';
                    tdProduit.appendChild(badge);
                }
                
                const selectProduit = document.createElement('select');
                selectProduit.className = 'form-select form-select-sm produit-select';
                if (isAutomatic) {
                    selectProduit.style.display = 'inline-block';
                    selectProduit.style.width = 'calc(100% - 60px)';
                }
                PRODUITS_INVENTAIRE.forEach(prod => {
                    const option = document.createElement('option');
                    option.value = prod;
                    option.textContent = prod;
                    if (prod === produit) {
                        option.selected = true;
                    }
                    selectProduit.appendChild(option);
                });
                tdProduit.appendChild(selectProduit);
                
                // Badge unité pour produits automatiques
                if (isAutomatic) {
                    const unite = PRODUITS_UNITE_STOCK[produit] || 'unite';
                    const uniteSpan = document.createElement('span');
                    uniteSpan.className = 'badge bg-secondary ms-1';
                    uniteSpan.textContent = unite === 'kilo' ? 'kg' : 'u';
                    uniteSpan.style.fontSize = '0.6rem';
                    tdProduit.appendChild(uniteSpan);
                }
                tr.appendChild(tdProduit);

                // Quantité
                const tdQuantite = document.createElement('td');
                const inputQuantite = document.createElement('input');
                inputQuantite.type = 'number';
                inputQuantite.className = 'form-control form-control-sm quantite-input';
                inputQuantite.min = '0';
                inputQuantite.step = '0.001';
                tdQuantite.appendChild(inputQuantite);
                tr.appendChild(tdQuantite);

                // Prix unitaire
                const tdPrixUnitaire = document.createElement('td');
                const inputPrixUnitaire = document.createElement('input');
                inputPrixUnitaire.type = 'number';
                inputPrixUnitaire.className = 'form-control form-control-sm prix-unitaire-input';
                inputPrixUnitaire.min = '0';
                inputPrixUnitaire.step = '0.01';
                tdPrixUnitaire.appendChild(inputPrixUnitaire);
                tr.appendChild(tdPrixUnitaire);

                // Total
                const tdTotal = document.createElement('td');
                tdTotal.className = 'total-cell';
                tdTotal.textContent = '0';
                tr.appendChild(tdTotal);

                // Commentaire
                const tdCommentaire = document.createElement('td');
                const inputCommentaire = document.createElement('input');
                inputCommentaire.type = 'text';
                inputCommentaire.className = 'form-control form-control-sm commentaire-input';
                tdCommentaire.appendChild(inputCommentaire);
                tr.appendChild(tdCommentaire);

                // Actions
                const tdActions = document.createElement('td');
                tdActions.className = 'text-center';
                const btnSupprimer = document.createElement('button');
                btnSupprimer.className = 'btn btn-danger btn-sm';
                btnSupprimer.innerHTML = '<i class="fas fa-trash"></i>';
                btnSupprimer.onclick = () => {
                    // Vérifier les restrictions temporelles pour la suppression
                    const dateInput = document.getElementById('date-inventaire');
                    const typeStockSelect = document.getElementById('type-stock');
                    
                    if (dateInput && currentUser && !canModifyStockForDate(dateInput.value, currentUser.username)) {
                        alert('Vous ne pouvez pas supprimer cette ligne pour cette date. Les utilisateurs peuvent modifier le stock seulement le jour J et jusqu\'au lendemain avant 4h00 du matin. Seuls administrateurs sont exemptés de cette restriction.');
                        return;
                    }
                    
                    // Vérifier les restrictions spécifiques au stock matin
                    if (typeStockSelect && typeStockSelect.value === 'matin' && currentUser && !canModifyStockMatinFields(currentUser.username)) {
                        alert('Le stock matin est rempli automatiquement par le système. Seuls les administrateurs peuvent supprimer des lignes manuellement.');
                        return;
                    }
                    
                    if (confirm('Êtes-vous sûr de vouloir supprimer cette ligne ?')) {
                        tr.remove();
                    }
                };
                tdActions.appendChild(btnSupprimer);
                tr.appendChild(tdActions);

                // Restaurer les données sauvegardées si elles existent
                const key = `${pointVente}-${produit}`;
                if (donnees[key]) {
                    console.log(`%cRestauration des données pour ${key}:`, 'color: #00ff00;', donnees[key]);
                    inputQuantite.value = donnees[key].Nombre || donnees[key].quantite || '0';
                    inputPrixUnitaire.value = donnees[key].PU || donnees[key].prixUnitaire || produitsInventaire.getPrixDefaut(produit, pointVente) || '0';
                    inputCommentaire.value = donnees[key].Commentaire || donnees[key].commentaire || '';
                    // Recalculer le total
                    const total = (parseFloat(inputQuantite.value) * parseFloat(inputPrixUnitaire.value));
                    tdTotal.textContent = total.toLocaleString('fr-FR');
                } else {
                    const prixDefaut = produitsInventaire.getPrixDefaut(produit, pointVente);
                    console.log(`%cPas de données pour ${key}, utilisation des valeurs par défaut`, 'color: #ff9900;');
                    inputQuantite.value = '0';
                    inputPrixUnitaire.value = prixDefaut || '0';
                    inputCommentaire.value = '';
                    tdTotal.textContent = '0';
                }

                // Ajouter les écouteurs d'événements pour le calcul automatique du total
                const calculateTotal = () => {
                    const quantite = parseFloat(inputQuantite.value) || 0;
                    const prixUnitaire = parseFloat(inputPrixUnitaire.value) || 0;
                    const total = quantite * prixUnitaire;
                    tdTotal.textContent = total.toLocaleString('fr-FR');
                };

                inputQuantite.addEventListener('input', calculateTotal);
                inputPrixUnitaire.addEventListener('input', calculateTotal);

                // Gestionnaire pour la mise à jour du prix unitaire par défaut
                selectProduit.addEventListener('change', function() {
                    const nouveauProduit = this.value;
                    const pointVente = selectPointVente.value;
                    const prix = produitsInventaire.getPrixDefaut(nouveauProduit, pointVente);
                    inputPrixUnitaire.value = prix || '0';
                    calculateTotal();
                });
                
                // Gestionnaire pour la mise à jour du prix unitaire quand le point de vente change
                selectPointVente.addEventListener('change', function() {
                    const produit = selectProduit.value;
                    const pointVente = this.value;
                    const prix = produitsInventaire.getPrixDefaut(produit, pointVente);
                    inputPrixUnitaire.value = prix || '0';
                    calculateTotal();
                });

                tbody.appendChild(tr);
            });
        });

        console.log('%cTableau mis à jour avec succès', 'color: #00ff00; font-weight: bold;');
        
        // Mettre à jour l'état des boutons et champs selon les restrictions
        updateStockButtonsState();
    } catch (error) {
        console.error('%cErreur lors du chargement des données:', 'color: #ff0000; font-weight: bold;', error);
        alert('Erreur lors du chargement des données du stock');
    }
}

// Fonction pour supprimer une vente
async function supprimerVente(venteId) {
    try {
        const response = await fetch(`/api/ventes/${venteId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Recharger les ventes après la suppression
            alert('Vente supprimée avec succès');
            chargerDernieresVentes();
        } else {
            // Afficher le message d'erreur du serveur
            console.error('Erreur de suppression:', data);
            alert(data.message || 'Erreur lors de la suppression de la vente');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        alert('Erreur lors de la suppression de la vente');
    }
}

// Fonction pour supprimer TOUTES les ventes du jour (admin uniquement)
async function supprimerVentesJour() {
    // Récupérer la date du jour au format DD/MM/YYYY
    const today = new Date();
    const dateFormatted = today.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    
    // Double confirmation
    const firstConfirm = confirm(`⚠️ ATTENTION ⚠️\n\nVous êtes sur le point de supprimer TOUTES les ventes du ${dateFormatted}.\n\nCette action est IRRÉVERSIBLE.\n\nContinuer ?`);
    
    if (!firstConfirm) return;
    
    const secondConfirm = confirm(`🔴 DERNIÈRE CONFIRMATION 🔴\n\nTapez OK pour confirmer la suppression de TOUTES les ventes du ${dateFormatted}.`);
    
    if (!secondConfirm) return;
    
    try {
        // Format date pour API: YYYY-MM-DD
        const dateApi = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const response = await fetch(`/api/ventes/jour/${dateApi}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            alert(`✅ ${data.count} ventes supprimées pour le ${dateFormatted}`);
            chargerDernieresVentes();
        } else {
            alert(data.message || 'Erreur lors de la suppression');
        }
    } catch (error) {
        console.error('Erreur suppression en masse:', error);
        alert('Erreur lors de la suppression des ventes');
    }
}

// Initialiser le bouton de suppression des ventes du jour
document.addEventListener('DOMContentLoaded', function() {
    const btnSupprimerVentesJour = document.getElementById('btn-supprimer-ventes-jour');
    if (btnSupprimerVentesJour) {
        btnSupprimerVentesJour.addEventListener('click', supprimerVentesJour);
    }
});

// Gestionnaire d'événements pour l'onglet Réconciliation
document.getElementById('reconciliation-tab').addEventListener('click', function() {
    hideAllSections();
    document.getElementById('reconciliation-section').style.display = 'block';
    
    // Initialiser le sélecteur de date avec flatpickr s'il ne l'est pas déjà
    if (!document.getElementById('date-reconciliation')._flatpickr) {
        flatpickr('#date-reconciliation', {
            dateFormat: 'd/m/Y',
            locale: 'fr',
            defaultDate: new Date(),
            disableMobile: "true",
            onChange: function(selectedDates, dateStr) {
                console.log('Date sélectionnée pour la réconciliation:', dateStr);
                // Rendre le bouton de calcul plus visible après changement de date
                const btnCalculer = document.getElementById('calculer-reconciliation');
                btnCalculer.classList.add('btn-pulse');
                setTimeout(() => {
                    btnCalculer.classList.remove('btn-pulse');
                }, 1500);
            }
        });
    }
    
    // Ajouter l'effet CSS pour l'animation du bouton si le style n'existe pas déjà
    if (!document.getElementById('btn-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'btn-pulse-style';
        style.textContent = `
            @keyframes btnPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }
            .btn-pulse {
                animation: btnPulse 0.5s ease-in-out 3;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Ajouter un écouteur d'événement direct sur le changement de date
    // Ceci est nécessaire car le onChange de flatpickr ne déclenche pas toujours le chargement
    const dateReconciliation = document.getElementById('date-reconciliation');
    if (dateReconciliation) {
        // S'assurer que nous n'ajoutons pas l'écouteur multiple fois
        if (!dateReconciliation._hasChangeListener) {
            dateReconciliation.addEventListener('change', function(e) {
                console.log('Changement de date détecté via event listener direct:', this.value);
                if (this.value) {
                    if (typeof ReconciliationManager !== 'undefined' && 
                        typeof ReconciliationManager.chargerReconciliation === 'function') {
                        ReconciliationManager.chargerReconciliation(this.value);
        } else {
                        calculerReconciliation(this.value);
                    }
                }
            });
            dateReconciliation._hasChangeListener = true;
            console.log('Écouteur d\'événement direct ajouté au champ de date');
        }
    }
    
    // Charger les données initiales si une date est déjà sélectionnée
    const date = document.getElementById('date-reconciliation').value;
    if (date) {
        calculerReconciliation(date);
    }
});

// Gestionnaire pour le bouton de calcul de réconciliation
document.getElementById('calculer-reconciliation').addEventListener('click', function() {
    const date = document.getElementById('date-reconciliation').value;
    if (!date) {
        alert('Veuillez sélectionner une date');
        return;
    }
    
    calculerReconciliation(date);
});

// Fonction principale pour calculer la réconciliation
async function calculerReconciliation(date) {
    try {
        console.log('Calcul de réconciliation pour la date:', date);
        
        // Effacer le tableau des résultats précédents
        const tbody = document.querySelector('#reconciliation-table tbody');
        tbody.innerHTML = '';
                
        // Effacer aussi les détails de débogage
        const debugTitle = document.getElementById('debug-title');
        const debugFormule = document.getElementById('debug-formule');
        const debugEcart = document.getElementById('debug-ecart');
        const debugStockSection = document.getElementById('debug-stock-section');
        const debugVentesSection = document.getElementById('debug-ventes-section');
                
        if (debugTitle) debugTitle.innerHTML = '';
        if (debugFormule) debugFormule.innerHTML = '';
        if (debugEcart) debugEcart.innerHTML = '';
        if (debugStockSection) debugStockSection.innerHTML = '';
        if (debugVentesSection) debugVentesSection.innerHTML = '';
                
        // Afficher un indicateur de chargement
        const loadingRow = document.createElement('tr');
        const loadingCell = document.createElement('td');
        loadingCell.colSpan = 7; // Mettre à jour pour 7 colonnes au lieu de 6
        loadingCell.textContent = 'Chargement des données...';
        loadingCell.className = 'text-center';
        loadingRow.appendChild(loadingCell);
        tbody.appendChild(loadingRow);
        
        // Charger les données de stock matin
        const stockMatin = await chargerDonneesStock('matin', date);
        console.log('Stock matin:', stockMatin);
        
        // Charger les données de stock soir
        const stockSoir = await chargerDonneesStock('soir', date);
        console.log('Stock soir:', stockSoir);
        
        // Charger les transferts
        const transferts = await chargerDonneesTransferts(date);
        console.log('Transferts:', transferts);
        
        // Charger les ventes saisies
        const response = await fetch(`/api/ventes-date?date=${date}`, {
            method: 'GET',
            credentials: 'include'
        });
        const ventesSaisiesData = await response.json();
        console.log('Ventes saisies récupérées:', ventesSaisiesData);
        
        // Créer un objet pour collecter les détails de débogage
        let debugInfo = {
                date: date,
            stockMatin: stockMatin,
            stockSoir: stockSoir,
            transferts: transferts,
            ventesSaisies: ventesSaisiesData.success ? ventesSaisiesData.ventes : [],
            detailsParPointVente: {}
        };
        
        // Calcul de la réconciliation par point de vente
        const reconciliation = await calculerReconciliationParPointVente(date, stockMatin, stockSoir, transferts, debugInfo);
        console.log('Réconciliation calculée:', reconciliation);

        // NOUVEAU: Fusionner les commentaires chargés (si existants et pour la même date)
        if (window.currentReconciliation && window.currentReconciliation.date === date && window.currentReconciliation.data) {
            console.log('Fusion des commentaires chargés dans les données calculées...');
            Object.keys(reconciliation).forEach(pointVente => {
                // Vérifier si le point de vente existe dans les données chargées et a un commentaire
                if (window.currentReconciliation.data[pointVente] && window.currentReconciliation.data[pointVente].commentaire) {
                    // Copier le commentaire chargé dans l'objet calculé
                    reconciliation[pointVente].commentaire = window.currentReconciliation.data[pointVente].commentaire;
                    console.log(`Commentaire pour ${pointVente} fusionné:`, reconciliation[pointVente].commentaire);
                } else if (reconciliation[pointVente] && reconciliation[pointVente].commentaire === undefined) {
                    // Si le calcul frais n'a pas initialisé de commentaire
                    reconciliation[pointVente].commentaire = '';
                }
            });
        } else {
            // Si pas de données chargées ou date différente, s'assurer que commentaire est initialisé
            Object.keys(reconciliation).forEach(pointVente => {
                if (reconciliation[pointVente] && reconciliation[pointVente].commentaire === undefined) {
                    reconciliation[pointVente].commentaire = '';
                }
            });
        }
        
        // Mettre à jour l'affichage
        console.log('Mise à jour de l\'affichage...');
        afficherReconciliation(reconciliation, debugInfo);
        
        // Définir la réconciliation actuelle pour la sauvegarde
        window.currentReconciliation = {
            date: date,
            data: reconciliation
        };
        
        // Intégrer les données de paiement en espèces
        if (typeof addCashPaymentToReconciliation === 'function') {
            try {
                console.log('Début de l\'appel à addCashPaymentToReconciliation...');
                await addCashPaymentToReconciliation();
                console.log('Données de paiement en espèces intégrées avec succès');
            } catch (error) {
                console.error('Erreur lors de l\'intégration des paiements en espèces:', error);
            }
        } else {
            console.warn('La fonction addCashPaymentToReconciliation n\'est pas disponible, assurez-vous que cash-payment-function.js est correctement chargé');
        }
        
        // Activer le bouton de sauvegarde
        const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
        if (btnSauvegarder) {
            btnSauvegarder.disabled = false;
        }
        
        // Masquer l'indicateur de chargement
        document.getElementById('loading-indicator-reconciliation').style.display = 'none';
        
        // Activer le mode débogage si nécessaire
        if (isDebugMode) {
            document.getElementById('debug-container').style.display = 'block';
        }
        
    } catch (error) {
        console.error('Erreur lors du calcul de réconciliation:', error);
        
        // Effacer l'indicateur de chargement
        const tbody = document.querySelector('#reconciliation-table tbody');
        tbody.innerHTML = '';
        
        // Afficher un message d'erreur dans le tableau
        const errorRow = document.createElement('tr');
        const errorCell = document.createElement('td');
        errorCell.colSpan = 7; // Mettre à jour pour 7 colonnes au lieu de 6
        errorCell.textContent = 'Erreur lors du calcul: ' + error.message;
        errorCell.className = 'text-center text-danger';
        errorRow.appendChild(errorCell);
        tbody.appendChild(errorRow);
        
        // Masquer l'indicateur de chargement
        document.getElementById('loading-indicator-reconciliation').style.display = 'none';
        
        alert('Erreur lors du calcul de réconciliation: ' + error.message);
    }
}

// Fonction pour charger les données de stock
async function chargerDonneesStock(type, date) {
    try {
        const response = await fetch(`/api/stock/${type}?date=${date}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        // Si la réponse n'est pas OK, on retourne simplement un objet vide
        // au lieu de lancer une exception
        if (!response.ok) {
            console.log(`Aucune donnée de stock ${type} disponible pour ${date}, utilisation d'un objet vide`);
            return {};
        }
        
        const data = await response.json();
        
        // Format plat: { "Keur Bali-Ail": { Nombre: "5", PU: "552", ... } }
        console.log(`Stock ${type} chargé pour réconciliation:`, Object.keys(data).length, 'entrées');
        return data;
    } catch (error) {
        console.error(`Erreur lors du chargement du stock ${type}:`, error);
        // Retourner un objet vide en cas d'erreur
        return {};
    }
}

// Fonction pour charger les données de transferts
async function chargerDonneesTransferts(date) {
    try {
        const response = await fetch(`/api/transferts?date=${date}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        // Si la réponse n'est pas OK, on retourne simplement un tableau vide
        // au lieu de lancer une exception
        if (!response.ok) {
            console.log(`Aucun transfert disponible pour ${date}, utilisation d'un tableau vide`);
            return [];
        }
        
        const result = await response.json();
        // L'API renvoie { success: true, transferts: [] }
        return result.success && result.transferts ? result.transferts : [];
    } catch (error) {
        console.error('Erreur lors du chargement des transferts:', error);
        // Retourner un tableau vide en cas d'erreur
        return [];
    }
}

// Fonction pour calculer la réconciliation par point de vente
async function calculerReconciliationParPointVente(date, stockMatin, stockSoir, transferts, debugInfo) {
    const reconciliation = {};
    
    // Récupérer la date sélectionnée pour charger les ventes saisies
    // Utiliser la date passée en paramètre directement
    const dateSelectionnee = date || ''; // Use passed date, fallback to empty string
    
    // Debug logs for inputs
    console.log(`[DEBUG calcReconPV] Date used for fetch: ${dateSelectionnee}`);
    console.log(`[DEBUG calcReconPV] Stock Matin Input keys:`, Object.keys(stockMatin));
    console.log(`[DEBUG calcReconPV] Stock Soir Input keys:`, Object.keys(stockSoir));
    console.log(`[DEBUG calcReconPV] Transferts Input count:`, transferts.length);
    
    // Vérifier si les données de stock sont vides pour cette date
    console.log("[DEBUG calcReconPV] Données de stock pour la date", dateSelectionnee, ":");
    console.log("[DEBUG calcReconPV] Stock matin:", Object.keys(stockMatin).length, "entrées");
    console.log("[DEBUG calcReconPV] Stock soir:", Object.keys(stockSoir).length, "entrées");
    console.log("[DEBUG calcReconPV] Transferts:", transferts.length, "entrées");
    
    const dateEstVide = Object.keys(stockMatin).length === 0 && 
                        Object.keys(stockSoir).length === 0 && 
                        transferts.length === 0;
    
    if (dateEstVide) {
        console.log(`[DEBUG calcReconPV] Aucune donnée trouvée pour la date ${dateSelectionnee}, initialisation avec des valeurs à zéro`);
    }
    
    // Récupérer les ventes saisies pour la date sélectionnée (Internal fetch)
    let ventesSaisies = {};
    let creancesParPointVente = {}; // Nouveau: stocker les créances par point de vente
    try {
        // Use dateSelectionnee (which now directly comes from the function parameter)
        const response = await fetch(`/api/ventes-date?date=${dateSelectionnee}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        const data = await response.json();
        console.log('[DEBUG calcReconPV] Internal Sales Fetch Response:', data);
        
        if (data.success && data.totaux) {
            ventesSaisies = data.totaux;
            
            // Organiser les ventes par point de vente pour les détails de débogage
            // ET calculer les créances par point de vente
            if (data.ventes && Array.isArray(data.ventes)) {
                const ventesParPointVente = {};
                data.ventes.forEach(vente => {
                    const pointVente = vente['Point de Vente'];
                    if (!ventesParPointVente[pointVente]) {
                        ventesParPointVente[pointVente] = [];
                    }
                    ventesParPointVente[pointVente].push({
                        produit: vente.Produit,
                        pu: vente.PU,
                        nombre: vente.Nombre,
                        montant: vente.Montant
                    });
                    
                    // Calculer les créances par point de vente
                    if (vente.creance === true || vente.creance === 'true' || vente.Creance === true || vente.Creance === 'true') {
                        if (!creancesParPointVente[pointVente]) {
                            creancesParPointVente[pointVente] = 0;
                        }
                        creancesParPointVente[pointVente] += parseFloat(vente.Montant || 0);
                    }
                });
                // Stocker les ventes regroupées dans debugInfo s'il existe
                if (debugInfo) {
                     debugInfo.ventesParPointVente = ventesParPointVente;
                }
            }
        }
    } catch (error) {
        console.error('[DEBUG calcReconPV] Error fetching internal sales:', error);
    }
    console.log('[DEBUG calcReconPV] Ventes Saisies (Internal Fetch):', ventesSaisies);
    console.log('[DEBUG calcReconPV] Créances par Point de Vente:', creancesParPointVente);
    
    // Initialiser les totaux pour chaque point de vente
    POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
        // LOG: Check the specific sales value for this point of sale
        console.log(`[DEBUG calcReconPV] Initializing ${pointVente}: Ventes Saisies value =`, ventesSaisies[pointVente]);
        reconciliation[pointVente] = {
            stockMatin: 0,
            stockSoir: 0,
            transferts: 0,
            ventes: 0,
            ventesSaisies: ventesSaisies[pointVente] || 0, // Use internal fetch result
            creances: creancesParPointVente[pointVente] || 0, // Total des créances pour ce point de vente
            difference: 0,
            pourcentageEcart: 0,
            cashPayment: 0,
            ecartCash: 0,
            commentaire: ''
        };
        
        // Initialiser les détails de débogage pour ce point de vente s'il existe
        if (debugInfo && debugInfo.detailsParPointVente) {
            debugInfo.detailsParPointVente[pointVente] = {
                stockMatin: [],
                stockSoir: [],
                transferts: [],
                ventes: [],
                ventesSaisies: debugInfo.ventesParPointVente ? debugInfo.ventesParPointVente[pointVente] || [] : [],
                totalStockMatin: 0,
                totalStockSoir: 0,
                totalTransferts: 0,
                totalVentesSaisies: ventesSaisies[pointVente] || 0,
                venteTheoriques: 0,
                difference: 0,
                pourcentageEcart: 0
            };
        }
    });
    
    // Si la date est vide, retourner directement les données initialisées à zéro
    if (dateEstVide) {
        console.log("[DEBUG calcReconPV] Retour des données initialisées à zéro pour tous les points de vente");
        return reconciliation;
    }
    
    // Calculer les totaux du stock matin
    Object.entries(stockMatin).forEach(([key, item]) => {
        const [pointVente, ...produitParts] = key.split('-');
        const produit = produitParts.join('-'); // Handle product names with dashes
        if (POINTS_VENTE_PHYSIQUES.includes(pointVente)) {
            const quantite = parseFloat(item.Quantite || item.Nombre || item.quantite || 0);
            const prixUnitaire = parseFloat(item.PU || item.prixUnitaire || 0);
            // Calculate montant from quantite * prixUnitaire if not already present
            const montant = item.Montant !== undefined ? parseFloat(item.Montant) : 
                            item.total !== undefined ? parseFloat(item.total) : 
                            (quantite * prixUnitaire);
            console.log(`  [DEBUG calcReconPV] StockMatin ${key}: qte=${quantite}, pu=${prixUnitaire}, montant=${montant}`);
            reconciliation[pointVente].stockMatin += montant;
            
            if (debugInfo && debugInfo.detailsParPointVente && debugInfo.detailsParPointVente[pointVente]) {
                debugInfo.detailsParPointVente[pointVente].stockMatin.push({
                    produit: produit,
                    montant: montant,
                    quantite: quantite,
                    prixUnitaire: prixUnitaire
                });
                debugInfo.detailsParPointVente[pointVente].totalStockMatin += montant;
            }
        }
    });
    
    // Calculer les totaux du stock soir
    Object.entries(stockSoir).forEach(([key, item]) => {
        const [pointVente, ...produitParts] = key.split('-');
        const produit = produitParts.join('-'); // Handle product names with dashes
        if (POINTS_VENTE_PHYSIQUES.includes(pointVente)) {
            const quantite = parseFloat(item.Quantite || item.Nombre || item.quantite || 0);
            const prixUnitaire = parseFloat(item.PU || item.prixUnitaire || 0);
            // Calculate montant from quantite * prixUnitaire if not already present
            const montant = item.Montant !== undefined ? parseFloat(item.Montant) : 
                            item.total !== undefined ? parseFloat(item.total) : 
                            (quantite * prixUnitaire);
            console.log(`  [DEBUG calcReconPV] StockSoir ${key}: qte=${quantite}, pu=${prixUnitaire}, montant=${montant}`);
            reconciliation[pointVente].stockSoir += montant;
            
            if (debugInfo && debugInfo.detailsParPointVente && debugInfo.detailsParPointVente[pointVente]) {
                debugInfo.detailsParPointVente[pointVente].stockSoir.push({
                    produit: produit,
                    montant: montant,
                    quantite: quantite,
                    prixUnitaire: prixUnitaire
                });
                debugInfo.detailsParPointVente[pointVente].totalStockSoir += montant;
            }
        }
    });
    
    // Calculer les totaux des transferts
    console.log('[DEBUG calcReconPV] Calcul des transferts par point de vente:');
    POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
        let totalTransfert = 0;
        const transfertsDuPoint = transferts.filter(t => 
            (t.pointVente || t["Point de Vente"]) === pointVente
        );
        
        transfertsDuPoint.forEach(transfert => {
            const impact = parseInt(transfert.impact) || 1;
            const montant = parseFloat(transfert.total || 0);
            const valeurTransfert = montant; // Formule simplifiée
            console.log(`  [DEBUG calcReconPV] Transfert ${pointVente}-${transfert.produit}: valeurTransfert = ${valeurTransfert}`); // Log transfer value
            totalTransfert += valeurTransfert;
            
            if (debugInfo && debugInfo.detailsParPointVente && debugInfo.detailsParPointVente[pointVente]) {
                debugInfo.detailsParPointVente[pointVente].transferts.push({
                    produit: transfert.produit || '',
                    impact: impact,
                    montant: montant,
                    valeur: valeurTransfert,
                    quantite: parseFloat(transfert.quantite || 0),
                    prixUnitaire: parseFloat(transfert.prixUnitaire || 0)
                });
            }
        });
        
        reconciliation[pointVente].transferts = totalTransfert;
        if (debugInfo && debugInfo.detailsParPointVente && debugInfo.detailsParPointVente[pointVente]) {
            debugInfo.detailsParPointVente[pointVente].totalTransferts = totalTransfert;
        }
    });
    
  
    // Log state before final calculations
    console.log('[DEBUG calcReconPV] Reconciliation state BEFORE final calculations:');
    POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
        console.log(`  - ${pointVente}:`, JSON.stringify(reconciliation[pointVente]));
    });

    // Calculer les ventes théoriques et différences
    POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
        reconciliation[pointVente].ventes = 
            reconciliation[pointVente].stockMatin - 
            reconciliation[pointVente].stockSoir + 
            reconciliation[pointVente].transferts;
            
        reconciliation[pointVente].difference = 
            reconciliation[pointVente].ventes - 
            reconciliation[pointVente].ventesSaisies;
            
        if (reconciliation[pointVente].ventes !== 0) {
            // Calcul spécial pour le point de vente "Abattage"
            if (pointVente === 'Abattage') {
                // Pour Abattage : (Ventes Théoriques / Stock Matin) * 100
                if (reconciliation[pointVente].stockMatin !== 0) {
                    reconciliation[pointVente].pourcentageEcart = 
                        (reconciliation[pointVente].ventes / reconciliation[pointVente].stockMatin) * 100;
                } else {
                    // Cas où le stock matin est nul - pas de calcul possible
                    reconciliation[pointVente].pourcentageEcart = null;
                    reconciliation[pointVente].commentaire = 'Stock matin nul - calcul impossible';
                }
            } else {
                // Pour les autres points de vente : (Écart / Ventes Théoriques) * 100
                reconciliation[pointVente].pourcentageEcart = 
                    (reconciliation[pointVente].difference / reconciliation[pointVente].ventes) * 100;
            }
        } else {
            reconciliation[pointVente].pourcentageEcart = 0;
        }
        
        if (debugInfo && debugInfo.detailsParPointVente && debugInfo.detailsParPointVente[pointVente]) {
            debugInfo.detailsParPointVente[pointVente].venteTheoriques = reconciliation[pointVente].ventes;
            debugInfo.detailsParPointVente[pointVente].difference = reconciliation[pointVente].difference;
            debugInfo.detailsParPointVente[pointVente].pourcentageEcart = reconciliation[pointVente].pourcentageEcart;
        }
    });
    
    // Log final object
    console.log('[DEBUG calcReconPV] Final Reconciliation Object:', reconciliation);
    return reconciliation;
}

// Fonction pour afficher la réconciliation dans le tableau
function afficherReconciliation(reconciliation, debugInfo) {
    console.log('Affichage des données de réconciliation:', reconciliation);
    
    const table = document.getElementById('reconciliation-table');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';

    let totalStockMatin = 0;
    let totalStockSoir = 0;
    let totalTransferts = 0;
    let totalVentesTheoriques = 0;
    let totalVentesSaisies = 0;
    let totalDifference = 0;
    
    // Vérifier si Abattage est présent pour afficher l'information sur la pération
    const hasAbattage = (POINTS_VENTE_PHYSIQUES.includes('Abattage') || TOUS_POINTS_VENTE.includes('Abattage')) && reconciliation['Abattage'];
    const perationInfo = document.getElementById('peration-info');
    
    // Debug: afficher les informations pour comprendre le problème
    console.log('🔍 Debug Abattage:');
    console.log('  POINTS_VENTE_PHYSIQUES:', POINTS_VENTE_PHYSIQUES);
    console.log('  TOUS_POINTS_VENTE:', TOUS_POINTS_VENTE);
    console.log('  Abattage dans POINTS_VENTE_PHYSIQUES:', POINTS_VENTE_PHYSIQUES.includes('Abattage'));
    console.log('  Abattage dans TOUS_POINTS_VENTE:', TOUS_POINTS_VENTE.includes('Abattage'));
    console.log('  reconciliation[Abattage]:', reconciliation['Abattage']);
    console.log('  hasAbattage:', hasAbattage);
    console.log('  perationInfo element:', perationInfo);
    
    if (perationInfo) {
        perationInfo.style.display = hasAbattage ? 'block' : 'none';
        console.log('  perationInfo.style.display:', perationInfo.style.display);
    } else {
        console.log('  ❌ Élément #peration-info non trouvé dans le DOM');
    }
    
    POINTS_VENTE_PHYSIQUES.forEach((pointVente, index) => {
        const data = reconciliation[pointVente];
        if (data) {
            // Assurer que la propriété commentaire existe
            if (data.commentaire === undefined) {
                data.commentaire = '';
            }

            // Créer une ligne pour chaque point de vente
            const row = document.createElement('tr');
            row.setAttribute('data-point-vente', pointVente);
            
            // Appliquer une couleur de fond basée sur le pourcentage d'écart
            if (Math.abs(data.pourcentageEcart) > 10.5) {
                row.classList.add('table-danger'); // Rouge pour > 10.5%
            } else if (Math.abs(data.pourcentageEcart) > 8) {
                row.classList.add('table-warning'); // Jaune pour 8% à 10.5%
            } else if (Math.abs(data.pourcentageEcart) > 0) {
                row.classList.add('table-success'); // Vert pour <= 8%
            }
            
            // Point de vente
            const tdPointVente = document.createElement('td');
            tdPointVente.textContent = pointVente;
            tdPointVente.setAttribute('data-point-vente', pointVente);
            tdPointVente.classList.add('debug-toggle');
            row.appendChild(tdPointVente);
            
            // Ajouter un écouteur d'événement pour afficher les détails de débogage
            tdPointVente.addEventListener('click', () => {
                afficherDetailsDebugging(pointVente, debugInfo);
            });
            
            // Stock matin
            const tdStockMatin = document.createElement('td');
            tdStockMatin.textContent = formatMonetaire(data.stockMatin);
            tdStockMatin.classList.add('currency');
            row.appendChild(tdStockMatin);
            totalStockMatin += data.stockMatin;
            
            // Stock soir
            const tdStockSoir = document.createElement('td');
            tdStockSoir.textContent = formatMonetaire(data.stockSoir);
            tdStockSoir.classList.add('currency');
            row.appendChild(tdStockSoir);
            totalStockSoir += data.stockSoir;
            
            // Transferts
            const tdTransferts = document.createElement('td');
            tdTransferts.textContent = formatMonetaire(data.transferts);
            tdTransferts.classList.add('currency');
            row.appendChild(tdTransferts);
            totalTransferts += data.transferts;
            
            // Ventes théoriques
            const tdVentes = document.createElement('td');
            tdVentes.textContent = formatMonetaire(data.ventes);
            tdVentes.classList.add('currency');
            row.appendChild(tdVentes);
            totalVentesTheoriques += data.ventes;
            
            // Ventes saisies
            const tdVentesSaisies = document.createElement('td');
            tdVentesSaisies.textContent = formatMonetaire(data.ventesSaisies);
            tdVentesSaisies.classList.add('currency');
            row.appendChild(tdVentesSaisies);
            totalVentesSaisies += data.ventesSaisies;
            
            // Différence (écart)
            const tdDifference = document.createElement('td');
            tdDifference.textContent = formatMonetaire(data.difference);
            tdDifference.classList.add('currency');
            // Ajouter une classe basée sur la différence (positive ou négative)
            if (data.difference < 0) {
                tdDifference.classList.add('negative');
            } else if (data.difference > 0) {
                tdDifference.classList.add('positive');
            }
            row.appendChild(tdDifference);
            totalDifference += data.difference;
            
            // Pourcentage d'écart
            const tdPourcentage = document.createElement('td');
            
            // Gestion spéciale pour Abattage
            if (pointVente === 'Abattage') {
                console.log('🔍 Debug tooltip Abattage:');
                console.log('  pointVente:', pointVente);
                console.log('  data.pourcentageEcart:', data.pourcentageEcart);
                
                if (data.pourcentageEcart === null) {
                    tdPourcentage.textContent = "N/A";
                    tdPourcentage.classList.add('text-muted', 'fst-italic');
                    tdPourcentage.title = "Stock matin nul - calcul impossible";
                    console.log('  Tooltip défini: "Stock matin nul - calcul impossible"');
                } else {
                    tdPourcentage.textContent = `${data.pourcentageEcart.toFixed(2)}%`;
                    tdPourcentage.title = "Pération : Perte de volume entre abattoir et point de vente";
                    console.log('  Tooltip défini: "Pération : Perte de volume entre abattoir et point de vente"');
                    
                    // Appliquer le style basé sur la valeur (pour Abattage, plus c'est élevé, mieux c'est)
                    if (data.pourcentageEcart >= 90) {
                        tdPourcentage.classList.add('text-success', 'fw-bold');
                    } else if (data.pourcentageEcart >= 80) {
                        tdPourcentage.classList.add('text-warning', 'fw-bold');
                    } else if (data.pourcentageEcart > 0) {
                        tdPourcentage.classList.add('text-danger', 'fw-bold');
                    }
                }
            } else {
                // Pour les autres points de vente
                if (data.pourcentageEcart !== null) {
                    tdPourcentage.textContent = `${data.pourcentageEcart.toFixed(2)}%`;
                    // Ajouter une classe basée sur la valeur du pourcentage
                    if (Math.abs(data.pourcentageEcart) > 10.5) {
                        tdPourcentage.classList.add('text-danger', 'fw-bold');
                    } else if (Math.abs(data.pourcentageEcart) > 8) {
                        tdPourcentage.classList.add('text-warning', 'fw-bold');
                    } else if (Math.abs(data.pourcentageEcart) > 0) {
                        tdPourcentage.classList.add('text-success', 'fw-bold');
                    }
                } else {
                    tdPourcentage.textContent = "0.00%";
                }
            }
            
            tdPourcentage.classList.add('currency');
            row.appendChild(tdPourcentage);
            
            // Commentaire - Nouveau
            const tdCommentaire = document.createElement('td');
            const inputCommentaire = document.createElement('input');
            inputCommentaire.type = 'text';
            inputCommentaire.className = 'form-control commentaire-input';
            inputCommentaire.placeholder = 'Ajouter un commentaire...';
            inputCommentaire.setAttribute('data-point-vente', pointVente);
            
            // Utiliser data.commentaire ou une chaîne vide
            inputCommentaire.value = data.commentaire || ''; 
            console.log(`Définition du commentaire pour ${pointVente}:`, inputCommentaire.value); // Log pour vérifier
            
            tdCommentaire.appendChild(inputCommentaire);
            row.appendChild(tdCommentaire);
            
            tbody.appendChild(row);
        }
    });
}

// Fonction pour sauvegarder les données de réconciliation
async function sauvegarderReconciliation() {
    try {
        // Définir un flag global pour éviter les sauvegardes en double
        if (window.reconciliationBeingSaved) {
            console.log('Sauvegarde déjà en cours, abandon de cette requête');
            return;
        }
        
        window.reconciliationBeingSaved = true;
        
        // Vérifier si les données de réconciliation existent
        if (!window.currentReconciliation) {
            alert('Aucune réconciliation à sauvegarder');
            window.reconciliationBeingSaved = false;
            return;
        }
        
        // Récupérer la date
        const date = window.currentReconciliation.date;
        if (!date) {
            alert('Date de réconciliation non définie');
            window.reconciliationBeingSaved = false;
            return;
        }
        
        // Récupérer les données de réconciliation
        const reconciliationData = window.currentReconciliation.data;
        
        // Récupérer les commentaires saisis par l'utilisateur
        const commentaires = {};
        document.querySelectorAll('.commentaire-input').forEach(input => {
            const pointVente = input.getAttribute('data-point-vente');
            const commentaire = input.value.trim();
            if (commentaire) {
                commentaires[pointVente] = commentaire;
            }
        });
        
        // Récupérer les données des paiements en espèces (depuis le tableau)
        const cashPaymentData = {};
        const table = document.getElementById('reconciliation-table');
        if (table) {
            // Trouver l'index de la colonne "Montant Total Cash"
            const headerRow = table.querySelector('thead tr');
            if (headerRow) {
                const headerCells = Array.from(headerRow.cells).map(cell => cell.textContent.trim());
                const cashColumnIndex = headerCells.indexOf("Montant Total Cash");
                
                if (cashColumnIndex !== -1) {
                    // Parcourir chaque ligne du tableau pour extraire les valeurs de cash
                    table.querySelectorAll('tbody tr').forEach(row => {
                        const pointVente = row.getAttribute('data-point-vente');
                        if (pointVente && row.cells.length > cashColumnIndex) {
                            const cashCellText = row.cells[cashColumnIndex].textContent.trim();
                            const cashValue = extractNumericValue(cashCellText);
                            if (cashValue) {
                                cashPaymentData[pointVente] = cashValue;
                            }
                        }
                    });
                }
            }
        }
        
        // Ajouter les commentaires aux données de réconciliation
        Object.keys(reconciliationData).forEach(pointVente => {
            if (commentaires[pointVente]) {
                reconciliationData[pointVente].commentaire = commentaires[pointVente];
            }
        });
        
        // Préparer les données à envoyer
        const dataToSave = {
            date: date,
            reconciliation: reconciliationData,
            cashPaymentData: cashPaymentData
        };
        
        console.log('Données de réconciliation à sauvegarder:', dataToSave);
        
        // Envoyer les données au serveur
        const response = await fetch('/api/reconciliation/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(dataToSave)
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Réconciliation sauvegardée avec succès');
            
            // Sauvegarder également via ReconciliationManager pour assurer la compatibilité
            if (typeof ReconciliationManager !== 'undefined' && 
                typeof ReconciliationManager.sauvegarderReconciliation === 'function') {
                try {
                    // Passer les données cashPayment au ReconciliationManager
                    if (ReconciliationManager.currentReconciliation && cashPaymentData) {
                        ReconciliationManager.currentReconciliation.cashPaymentData = cashPaymentData;
                    }
                } catch (error) {
                    console.error('Erreur lors de la mise à jour des données dans ReconciliationManager:', error);
                }
            }
            
            // Réinitialiser le flag
            window.reconciliationBeingSaved = false;
        } else {
            window.reconciliationBeingSaved = false;
            throw new Error(result.message || 'Erreur lors de la sauvegarde');
        }
    } catch (error) {
        window.reconciliationBeingSaved = false;
        console.error('Erreur lors de la sauvegarde de la réconciliation:', error);
        alert('Erreur lors de la sauvegarde: ' + error.message);
    }
}

// Ajouter un gestionnaire d'événements pour le bouton de sauvegarde
document.addEventListener('DOMContentLoaded', function() {
    const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
    if (btnSauvegarder) {
        btnSauvegarder.addEventListener('click', sauvegarderReconciliation);
        
        // Désactiver le bouton par défaut
        btnSauvegarder.disabled = true;
    }
});

// Fonction pour charger une réconciliation sauvegardée
async function chargerReconciliation(date) {
    try {
        // Afficher l'indicateur de chargement
        document.getElementById('loading-indicator-reconciliation').style.display = 'block';
        
        // Tenter de récupérer une réconciliation sauvegardée
        const response = await fetch(`/api/reconciliation/load?date=${date}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            console.log('Données de réconciliation récupérées:', result);
            
            // Extraire les données de réconciliation
            let reconciliationData = null;
            if (result.data.reconciliation) {
                reconciliationData = result.data.reconciliation;
            } else if (result.data.data) {
                // Compatibilité avec l'ancien format
                try {
                    reconciliationData = JSON.parse(result.data.data);
                } catch (e) {
                    console.error('Erreur lors du parsing des données:', e);
                    reconciliationData = result.data.data;
                }
            }
            
            // Si nous avons des données valides
            if (reconciliationData && typeof reconciliationData === 'object') {
                // Afficher les données
                ReconciliationManager.afficherReconciliation(reconciliationData);
                
                // Stocker les données dans la variable globale pour la sauvegarde
                window.currentReconciliation = {
                    date: date,
                    data: reconciliationData
                };
                
                // Activer le bouton de sauvegarde
                document.getElementById('sauvegarder-reconciliation').disabled = false;
            }
            
            // Masquer l'indicateur de chargement
            document.getElementById('loading-indicator-reconciliation').style.display = 'none';
            return;
        }
        
        // Si nous n'avons pas pu charger de données sauvegardées, calculer
        calculerReconciliation(date);
        
    } catch (error) {
        console.error('Erreur lors du chargement de la réconciliation:', error);
        
        // En cas d'erreur, essayer de calculer
        calculerReconciliation(date);
    }
}

// Fonction pour calculer les données de réconciliation
async function calculerReconciliation(date = null) {
    try {
        // Afficher l'indicateur de chargement
        document.getElementById('loading-indicator-reconciliation').style.display = 'block';
        
        console.log('Calcul de la réconciliation pour la date:', date);
        
        // Récupérer les données de stock pour la date sélectionnée
        const [stockMatin, stockSoir, transferts] = await Promise.all([
            chargerStock(date, 'matin'),
            chargerStock(date, 'soir'),
            chargerTransferts(date)
        ]);
        
        // Préparer les informations de débogage
        const debugInfo = {
            detailsParPointVente: {}
        };
        
        // Calculer la réconciliation
        const reconciliation = await calculerReconciliationParPointVente(date, stockMatin, stockSoir, transferts, debugInfo);
        
        // Afficher les résultats
        ReconciliationManager.afficherReconciliation(reconciliation, debugInfo);
        
        // Stocker les données dans la variable globale pour la sauvegarde
        window.currentReconciliation = {
            date: date,
            data: reconciliation
        };
        window.currentDebugInfo = debugInfo;
        
        // Activer le bouton de sauvegarde
        const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
        if (btnSauvegarder) {
            btnSauvegarder.disabled = false;
        }
        
        // Masquer l'indicateur de chargement
        document.getElementById('loading-indicator-reconciliation').style.display = 'none';
    } catch (error) {
        console.error('Erreur lors du calcul de la réconciliation:', error);
        document.getElementById('loading-indicator-reconciliation').style.display = 'none';
        alert('Erreur lors du calcul: ' + error.message);
    }
}

// Bouton pour calculer la réconciliation
document.addEventListener('DOMContentLoaded', function() {
    // Gestionnaire pour le bouton de réconciliation
    const btnCalculer = document.getElementById('calculer-reconciliation');
    if (btnCalculer) {
        btnCalculer.addEventListener('click', function() {
            const date = document.getElementById('date-reconciliation').value;
            if (!date) {
                alert('Veuillez sélectionner une date');
                return;
            }
            
            // Désactiver le bouton pendant le calcul
            btnCalculer.disabled = true;
            
            // Charger la réconciliation (d'abord essayer de charger une existante)
            ReconciliationManager.chargerReconciliation(date).finally(() => {
                btnCalculer.disabled = false;
            });
        });
    }
    
    // Gestionnaire pour le bouton de sauvegarde
    const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
    if (btnSauvegarder) {
        // Remplacer tous les écouteurs d'événements
        const newBtn = btnSauvegarder.cloneNode(true);
        btnSauvegarder.parentNode.replaceChild(newBtn, btnSauvegarder);
        
        // Ajouter notre nouvel écouteur qui appelle les deux implémentations
        newBtn.addEventListener('click', async function() {
            try {
                // Utiliser d'abord notre implémentation personnalisée
                await sauvegarderReconciliation();
            } catch (error) {
                console.error('Erreur lors de la sauvegarde:', error);
                
                // En cas d'échec de notre méthode, tenter d'utiliser ReconciliationManager comme fallback
                try {
                    await ReconciliationManager.sauvegarderReconciliation();
                } catch (fallbackError) {
                    console.error('Erreur avec ReconciliationManager:', fallbackError);
                    alert('Erreur lors de la sauvegarde. Vérifiez la console pour plus de détails.');
                }
            }
        });
    }
    
    // Initialisation du datepicker pour la date de réconciliation
    const dateReconciliation = document.getElementById('date-reconciliation');
    if (dateReconciliation) {
        flatpickr(dateReconciliation, {
            dateFormat: "d/m/Y",
            locale: "fr",
            defaultDate: new Date()
        });
    }
});

// Si une réconciliation est active, l'afficher
if (window.currentReconciliation && window.currentReconciliation.data) {
    // Utiliser le gestionnaire centralisé pour afficher les données
    ReconciliationManager.afficherReconciliation(window.currentReconciliation.data, window.currentDebugInfo || {});
}

// Fonction pour formatter les valeurs monétaires
function formatMonetaire(valeur) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'XOF',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(valeur);
}

// Fonction pour extraire une valeur numérique d'un texte formaté
function extractNumericValue(formattedText) {
    if (!formattedText) return 0;
    
    // Supprimer tous les caractères non numériques sauf le point et la virgule
    const numericString = formattedText.replace(/[^\d.,]/g, '')
        // Remplacer la virgule par un point pour la conversion
        .replace(',', '.');
    
    return parseFloat(numericString) || 0;
}

// Vérifier que la fonction d'intégration des paiements en espèces est disponible
console.log('Vérification de la disponibilité de addCashPaymentToReconciliation:', 
    typeof addCashPaymentToReconciliation === 'function' ? 'Disponible' : 'Non disponible');

// Exposer la fonction calculerReconciliation au niveau global pour permettre
// à reconciliationManager.js de l'utiliser comme méthode de fallback
window.calculerReconciliation = calculerReconciliation;

// ... existing code ...

// Fonction pour initialiser la page des alertes d'accumulation de stock
function initStockAlerte() {
    console.log('%c=== Initialisation de la page des alertes d\'accumulation de stock ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    
    // Initialiser les datepickers
    flatpickr('#date-debut-alerte', {
        dateFormat: "d/m/Y",
        defaultDate: new Date(new Date().setDate(new Date().getDate() - 7)), // 7 jours avant aujourd'hui
        locale: 'fr'
    });
    
    flatpickr('#date-fin-alerte', {
        dateFormat: "d/m/Y",
        defaultDate: "today",
        locale: 'fr'
    });

    // --- Update explanation text ---
    const infoDiv = document.querySelector('#stock-alerte-section .alert.alert-info');
    if (infoDiv) {
        infoDiv.innerHTML = `
            <p>Cet outil recherche:</p>
            <ul>
                <li><strong>Accumulation</strong>: produits dont le stock soir dépasse 90% du (stock matin + transferts) <strong>et</strong> dont la différence est positive.</li>
                <li><strong>Apparition</strong>: produits présents en stock soir mais absents du stock matin.</li>
            </ul>
            <p>Exemple avec seuil à 10%: accumulation si stock soir > 90% (stock matin + transferts) <strong>et</strong> différence > 0.</p>
            <p class="fw-bold">Important: Une alerte pour un produit et un point de vente n'est affichée que si la condition (accumulation ou apparition) est remplie pendant 3 jours consécutifs dans la période sélectionnée.</p>
        `;
    }
    // --- End update explanation ---
    
    // Initialiser le pourcentage par défaut
    document.getElementById('pourcentage-alerte').value = 10;
    
    // Ajouter l'écouteur d'événement pour le bouton de recherche
    const btnRechercherAlertes = document.getElementById('btn-rechercher-alertes');
    
    if (btnRechercherAlertes) {
        console.log('Bouton de recherche d\'alertes trouvé, ajout de l\'écouteur d\'événement');
        btnRechercherAlertes.addEventListener('click', function() {
            console.log('Clic sur le bouton de recherche d\'alertes');
            rechercherAlertesAccumulation();
        });
    } else {
        console.error('Erreur : le bouton de recherche d\'alertes (ID: btn-rechercher-alertes) n\'a pas été trouvé!');
    }
    
    // Nettoyer le tableau des alertes précédentes
    const tableBody = document.querySelector('#alertes-table tbody');
    if (tableBody) {
        tableBody.innerHTML = '';
    } else {
        console.error('Erreur : le tableau des alertes (ID: alertes-table) n\'a pas été trouvé!');
    }
    
    const noAlertesMessage = document.getElementById('no-alertes-message');
    if (noAlertesMessage) {
        noAlertesMessage.style.display = 'none';
    } else {
        console.error('Erreur : le message "aucune alerte" (ID: no-alertes-message) n\'a pas été trouvé!');
    }
}

// ... existing code ...

// Fonction pour rechercher les alertes d'accumulation de stock
async function rechercherAlertesAccumulation() {
    console.log('%c=== Recherche des alertes d\'accumulation de stock (Règle 3 jours consécutifs) ===', 'background: #222; color: #bada55; font-size: 16px; padding: 5px;');
    
    // Récupérer les paramètres
    const dateDebut = document.getElementById('date-debut-alerte').value;
    const dateFin = document.getElementById('date-fin-alerte').value;
    const pourcentageSeuil = parseFloat(document.getElementById('pourcentage-alerte').value) || 10;
    
    console.log(`Paramètres de recherche - Début: ${dateDebut}, Fin: ${dateFin}, Seuil: ${pourcentageSeuil}%`);
    
    if (!dateDebut || !dateFin) {
        alert('Veuillez sélectionner une période valide');
        return;
    }
    
    // Afficher l'indicateur de chargement
    document.getElementById('loading-indicator-alertes').style.display = 'block';
    document.getElementById('no-alertes-message').style.display = 'none';
    
    // --- Structure pour tracker les alertes potentielles ---
    // Format: { 'PointVente-Produit': { dates: ['dd/mm/yyyy', ...], detailsByDate: {'dd/mm/yyyy': {...alertDetails}} } }
    const potentialAlerts = {}; 
    const oneDayInMillis = 24 * 60 * 60 * 1000;

    // Helper pour parser la date en millisecondes
    const parseDateToMillis = (dateStr) => {
        try {
            const parts = dateStr.split('/');
            // Month is 0-indexed in JavaScript Date
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime();
        } catch (e) {
            console.error(`Error parsing date: ${dateStr}`, e);
            return NaN;
        }
    };
    // --- Fin structure tracker ---

    try {
        // Générer la liste des dates à traiter
        const datesRange = generateDateRange(dateDebut, dateFin);
        console.log('Dates à traiter:', datesRange);
        
        // Tableau pour stocker toutes les alertes -> Remplacé par potentialAlerts
        // const alertes = []; 
        
        // Fonction pour normaliser le nom du produit (enlever espaces/minuscules)
        const normaliserProduit = (produit) => {
            if (!produit) return '';
            return produit.toLowerCase().trim();
        };
        
        // Traiter chaque date
        for (const date of datesRange) {
            console.log(`Traitement de la date: ${date}`);
            
            // Récupérer les données de stock matin, stock soir et transferts pour cette date
            const stockMatin = await getStockForDate(date, 'matin');
            const stockSoir = await getStockForDate(date, 'soir');
            const transferts = await getTransfersForDate(date);
            
            // --- Logique inchangée pour organiser les transferts ---
            const transfertsMap = new Map();
            transferts.forEach(transfert => {
                const pointVente = transfert.pointVente || transfert["Point de Vente"];
                const produitBrut = transfert.produit || transfert.Produit;
                if (!pointVente || !produitBrut) {
                    console.warn('Transfert ignoré car point de vente ou produit manquant:', transfert);
                    return; 
                }
                const produit = produitBrut.trim();
                const key = `${pointVente}-${produit}`;
                if (!transfertsMap.has(key)) {
                    transfertsMap.set(key, 0);
                }
                let montant = 0;
                if (transfert.total !== undefined && transfert.total !== null) {
                    montant = parseFloat(transfert.total);
                } else if (transfert.montant !== undefined && transfert.montant !== null) {
                    montant = parseFloat(transfert.montant);
                } else if (transfert.Montant !== undefined && transfert.Montant !== null) {
                    montant = parseFloat(transfert.Montant);
                } else {
                    const quantite = parseFloat(transfert.quantite || transfert.Quantite || transfert.Nombre || transfert.nombre || 0);
                    const pu = parseFloat(transfert.prixUnitaire || transfert.PU || transfert.pu || 0);
                    if (quantite > 0 && pu > 0) {
                        montant = quantite * pu;
                    }
                }
                if (isNaN(montant) || montant === 0) {
                    console.warn(`Montant invalide pour le transfert ${key}:`, transfert);
                }
                const valeurTransfert = montant;
                transfertsMap.set(key, transfertsMap.get(key) + valeurTransfert);
            });
            // --- Fin logique transferts ---
            
            const keysTraitees = new Set(); 
            
            // --- Boucle pour accumulation --- 
            for (const key in stockMatin) {
                const [pointVente, produitBrut] = key.split('-');
                if (!POINTS_VENTE_PHYSIQUES.includes(pointVente)) continue;
                const produit = produitBrut.trim();
                const keyNorm = `${pointVente}-${produit}`;
                keysTraitees.add(keyNorm);
                
                const stockMatinItem = stockMatin[key];
                const stockMatinMontant = parseFloat(stockMatinItem.Montant || stockMatinItem.total || 0);
                const transfertMontant = transfertsMap.has(keyNorm) ? transfertsMap.get(keyNorm) : 0;
                const stockAttendu = stockMatinMontant + transfertMontant;
                
                if (stockAttendu <= 0) continue;
                
                if (stockSoir[key]) {
                    const stockSoirItem = stockSoir[key];
                    const stockSoirMontant = parseFloat(stockSoirItem.Montant || stockSoirItem.total || 0);
                    const difference = stockSoirMontant - stockAttendu;
                    const pourcentageAccumulation = stockAttendu !== 0 ? (difference / stockAttendu) * 100 : (difference > 0 ? Infinity : -Infinity);
                    
                    const conditionSeuil = stockAttendu === 0 ? (difference > 0) : (pourcentageAccumulation > -pourcentageSeuil);
                    const conditionDifference = difference > 0;
                    
                    if (conditionSeuil && conditionDifference) {
                        console.log(`[+] Condition Accumulation REMPLIE pour ${keyNorm} le ${date}`);
                        // --- Logique pour tracker l'alerte ---
                        const stockMatinQuantite = parseFloat(stockMatinItem.Quantite || stockMatinItem.Nombre || 0);
                        const stockMatinPU = parseFloat(stockMatinItem.PU || stockMatinItem.prixUnitaire || 0);
                        const stockSoirQuantite = parseFloat(stockSoirItem.Quantite || stockSoirItem.Nombre || 0);
                        const stockSoirPU = parseFloat(stockSoirItem.PU || stockSoirItem.prixUnitaire || 0);
                        const transfertDetails = { quantite: 0, prixUnitaire: 0 }; // Simplifié pour l'exemple
                        transferts.forEach(t => { /* ... logique pour remplir transfertDetails si besoin ... */ });

                        const alertDetails = {
                            pointVente,
                            produit,
                            date, // Garder la date spécifique de cette alerte
                            stockMatin: stockMatinMontant,
                            stockSoir: stockSoirMontant,
                            transfert: transfertMontant,
                            difference,
                            pourcentage: pourcentageAccumulation,
                            type: 'accumulation',
                            stockMatinDetails: { quantite: stockMatinQuantite, prixUnitaire: stockMatinPU },
                            stockSoirDetails: { quantite: stockSoirQuantite, prixUnitaire: stockSoirPU },
                            transfertDetails: transfertDetails
                        };

                        if (!potentialAlerts[keyNorm]) {
                            potentialAlerts[keyNorm] = { dates: [], detailsByDate: {} };
                        }
                        potentialAlerts[keyNorm].dates.push(date);
                        potentialAlerts[keyNorm].detailsByDate[date] = alertDetails;
                        // -----------------------------------
                    }
                }
            }
            // --- Fin boucle accumulation ---
            
            // --- Boucle pour apparition ---
            for (const key in stockSoir) {
                const [pointVente, produitBrut] = key.split('-');
                if (!POINTS_VENTE_PHYSIQUES.includes(pointVente)) continue;
                const produit = produitBrut.trim();
                const keyNorm = `${pointVente}-${produit}`;
                
                if (keysTraitees.has(keyNorm)) continue;
                
                const stockSoirItem = stockSoir[key];
                const stockSoirMontant = parseFloat(stockSoirItem.Montant || stockSoirItem.total || 0);
                
                if (stockSoirMontant > 0) {
                     console.log(`[+] Condition Apparition REMPLIE pour ${keyNorm} le ${date}`);
                    // --- Logique pour tracker l'alerte ---
                    const stockSoirQuantite = parseFloat(stockSoirItem.Quantite || stockSoirItem.Nombre || 0);
                    const stockSoirPU = parseFloat(stockSoirItem.PU || stockSoirItem.prixUnitaire || 0);

                     const alertDetails = {
                        pointVente,
                        produit,
                        date, // Garder la date spécifique de cette alerte
                        stockMatin: 0,
                        stockSoir: stockSoirMontant,
                        transfert: 0,
                        difference: stockSoirMontant,
                        pourcentage: 100, 
                        type: 'apparition',
                        stockMatinDetails: { quantite: 0, prixUnitaire: 0 },
                        stockSoirDetails: { quantite: stockSoirQuantite, prixUnitaire: stockSoirPU },
                        transfertDetails: null
                    };

                    if (!potentialAlerts[keyNorm]) {
                        potentialAlerts[keyNorm] = { dates: [], detailsByDate: {} };
                    }
                    potentialAlerts[keyNorm].dates.push(date);
                    potentialAlerts[keyNorm].detailsByDate[date] = alertDetails;
                    // -----------------------------------
                }
            }
             // --- Fin boucle apparition ---
        }
        // --- Fin boucle dates --- 
        
        console.log(`[DEBUG] ===== Vérification des alertes consécutives =====`);
        const finalAlerts = []; // Tableau pour les alertes à afficher
        
        for (const keyNorm in potentialAlerts) {
            const entry = potentialAlerts[keyNorm];
            const alertDates = entry.dates;
            
            if (alertDates.length < 3) continue; // Pas assez de jours pour être consécutifs
            
            console.log(`[Check] Vérification pour ${keyNorm}, dates: [${alertDates.join(', ')}]`);
            
            // Convertir les dates en millisecondes et trier
            const dateMillis = alertDates.map(parseDateToMillis).filter(t => !isNaN(t)).sort((a, b) => a - b);
            
            if (dateMillis.length < 3) continue;
            
            let foundConsecutive = false;
            let lastDateOfSequence = null;

            for (let i = 0; i <= dateMillis.length - 3; i++) {
                const t1 = dateMillis[i];
                const t2 = dateMillis[i+1];
                const t3 = dateMillis[i+2];
                
                // Vérifier si t2 est exactement 1 jour après t1 ET t3 est exactement 1 jour après t2
                const isConsecutive = (t2 - t1 === oneDayInMillis) && (t3 - t2 === oneDayInMillis);
                
                if (isConsecutive) {
                    foundConsecutive = true;
                    // Récupérer la date string du dernier jour de la séquence
                    const lastDateObj = new Date(t3);
                    lastDateOfSequence = formatDateForStockAlerte(lastDateObj); // Use renamed function
                    console.log(`[OK] Séquence de 3 jours trouvée pour ${keyNorm} finissant le ${lastDateOfSequence}`);
                    break; // On a trouvé une séquence, pas besoin de chercher plus loin pour ce produit/PV
                }
            }
            
            // Si une séquence de 3 jours consécutifs a été trouvée
            if (foundConsecutive && lastDateOfSequence) {
                 // Récupérer les détails de l'alerte pour le DERNIER jour de la séquence
                const detailsToShow = entry.detailsByDate[lastDateOfSequence];
                if(detailsToShow){
                     finalAlerts.push(detailsToShow);
                } else {
                    console.warn(`Détails non trouvés pour la date ${lastDateOfSequence} de ${keyNorm}, alerte non ajoutée.`);
                }
            }
        }
        
        console.log(`[DEBUG] ===== Résumé final (après filtre 3 jours) =====`);
        console.log(`[DEBUG] Nombre total d'alertes à afficher: ${finalAlerts.length}`);
        
        // Trier les alertes finales par nom de point de vente puis par date
        finalAlerts.sort((a, b) => {
             // Tri alphabétique par point de vente, puis par date
             if (a.pointVente !== b.pointVente) return a.pointVente.localeCompare(b.pointVente);
             return parseDateToMillis(b.date) - parseDateToMillis(a.date); // Trier par date si même PV
        });
        
        // Afficher les résultats filtrés
        console.log(`[DEBUG StockAlerts] Final alerts to display:`, JSON.stringify(finalAlerts, null, 2)); // Added for debugging
        console.log(`[DEBUG] Appel à afficherAlertesAccumulation avec ${finalAlerts.length} alertes finales`);
        afficherAlertesAccumulation(finalAlerts);
        
    } catch (error) {
        console.error('Detailed error in rechercherAlertesAccumulation:', error); // Added for debugging
        console.error('Erreur lors de la recherche des alertes:', error);
        alert('Une erreur est survenue lors de la recherche des alertes. Veuillez réessayer.');
    } finally {
        // Masquer l'indicateur de chargement
        document.getElementById('loading-indicator-alertes').style.display = 'none';
    }
}

// ... existing code ...

// Fonction pour générer une séquence de dates au format dd/mm/yyyy
function generateDateRange(startDate, endDate) {
    const dateRange = [];
    
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    
    let current = new Date(start);
    while (current <= end) {
        dateRange.push(formatDateForStockAlerte(current)); // Use renamed function
        current.setDate(current.getDate() + 1);
    }
    
    return dateRange;
}

// Fonction pour parser une date au format dd/mm/yyyy
function parseDate(dateStr) {
    const parts = dateStr.split('/');
    // Format dd/mm/yyyy -> new Date(yyyy, mm-1, dd)
    return new Date(parts[2], parts[1] - 1, parts[0]);
}

// Fonction pour formater une date au format dd/mm/yyyy
function formatDateForStockAlerte(date) { // Renamed from formatDate
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
}

// Fonction pour récupérer les données de stock pour une date donnée
async function getStockForDate(date, type) {
    try {
        const response = await fetch(`/api/stock/${type}?date=${date}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            // If response is not OK, but it's a 404 (Not Found), return empty object gracefully
            if (response.status === 404) {
                console.log(`Stock ${type} data not found for ${date}, returning empty object.`);
                return {};
            }
            throw new Error(`Erreur HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Format plat: { "Keur Bali-Ail": { Nombre: "5", PU: "552", ... } }
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            console.log(`Stock ${type} data received for ${date}:`, Object.keys(data).length, 'entrées');
            return data;
        } else {
            console.warn(`Unexpected data format for stock ${type} on ${date}:`, data);
            return {};
        }

    } catch (error) {
        // Handle JSON parsing errors specifically if needed
        if (error instanceof SyntaxError) {
             console.error(`Erreur JSON lors de la récupération du stock ${type} pour ${date}:`, error);
        } else {
            console.error(`Erreur lors de la récupération du stock ${type} pour ${date}:`, error);
        }
        return {};
    }
}

// Fonction pour récupérer les transferts pour une date donnée
async function getTransfersForDate(date) {
    try {
        const response = await fetch(`/api/transferts?date=${date}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            // If response is not OK, but it's a 404 (Not Found), return empty array gracefully
            if (response.status === 404) {
                console.log(`Transfer data not found for ${date}, returning empty array.`);
                return [];
            }
            throw new Error(`Erreur HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Use the correct key 'transferts' as seen in Network logs
        if (data.success && Array.isArray(data.transferts)) {
             console.log(`Transfer data received for ${date}:`, data.transferts);
            return data.transferts;
        } else {
            console.warn(`Unexpected data format for transfers on ${date}:`, data);
            return [];
        }
        
    } catch (error) {
         if (error instanceof SyntaxError) {
             console.error(`Erreur JSON lors de la récupération des transferts pour ${date}:`, error);
        } else {
            console.error(`Erreur lors de la récupération des transferts pour ${date}:`, error);
        }
        return [];
    }
}

// Fonction pour afficher les alertes d'accumulation dans le tableau
function afficherAlertesAccumulation(alertes) {
    console.log('Alertes trouvées:', alertes);
    
    const tbody = document.querySelector('#alertes-table tbody');
    tbody.innerHTML = ''; // Vider le tableau
    
    if (alertes.length === 0) {
        // Aucune alerte trouvée
        document.getElementById('no-alertes-message').style.display = 'block';
        return;
    }
    
    // Remplir le tableau avec les alertes
    alertes.forEach(alerte => {
        const tr = document.createElement('tr');
        
        // Appliquer une classe en fonction du type d'alerte
        if (alerte.type === 'accumulation') {
            tr.classList.add('table-warning');
        } else if (alerte.type === 'apparition') {
            tr.classList.add('table-info');
        }
        
        // Point de vente
        const tdPointVente = document.createElement('td');
        tdPointVente.textContent = alerte.pointVente;
        tr.appendChild(tdPointVente);
        
        // Produit
        const tdProduit = document.createElement('td');
        tdProduit.textContent = alerte.produit;
        tr.appendChild(tdProduit);
        
        // Date
        const tdDate = document.createElement('td');
        tdDate.textContent = alerte.date;
        tr.appendChild(tdDate);
        
        // Stock Matin
        const tdStockMatin = document.createElement('td');
        tdStockMatin.textContent = formatMonetaire(alerte.stockMatin);
        tdStockMatin.classList.add('text-end');
        
        // Ajouter le détail du calcul en tooltip
        if (alerte.stockMatinDetails) {
            const quantite = alerte.stockMatinDetails.quantite || 0;
            const pu = alerte.stockMatinDetails.prixUnitaire || 0;
            tdStockMatin.title = `Quantité: ${quantite} × Prix unitaire: ${formatMonetaire(pu)} = ${formatMonetaire(alerte.stockMatin)}`;
            tdStockMatin.style.cursor = 'help';
        }
        
        tr.appendChild(tdStockMatin);
        
        // Stock Soir
        const tdStockSoir = document.createElement('td');
        tdStockSoir.textContent = formatMonetaire(alerte.stockSoir);
        tdStockSoir.classList.add('text-end');
        
        // Ajouter le détail du calcul en tooltip
        if (alerte.stockSoirDetails) {
            const quantite = alerte.stockSoirDetails.quantite || 0;
            const pu = alerte.stockSoirDetails.prixUnitaire || 0;
            tdStockSoir.title = `Quantité: ${quantite} × Prix unitaire: ${formatMonetaire(pu)} = ${formatMonetaire(alerte.stockSoir)}`;
            tdStockSoir.style.cursor = 'help';
        }
        
        tr.appendChild(tdStockSoir);
        
        // Transferts
        const tdTransfert = document.createElement('td');
        tdTransfert.textContent = formatMonetaire(alerte.transfert);
        tdTransfert.classList.add('text-end');
        
        // Ajouter le détail du calcul en tooltip
        if (alerte.transfertDetails) {
            const quantite = alerte.transfertDetails.quantite || 0;
            const pu = alerte.transfertDetails.prixUnitaire || 0;
            tdTransfert.title = `Quantité: ${quantite} × Prix unitaire: ${formatMonetaire(pu)} = ${formatMonetaire(alerte.transfert)}`;
            tdTransfert.style.cursor = 'help';
        }
        
        tr.appendChild(tdTransfert);
        
        // Différence
        const tdDifference = document.createElement('td');
        tdDifference.textContent = formatMonetaire(alerte.difference);
        tdDifference.classList.add('text-end');
        
        // Colorer selon la différence
        if (alerte.difference > 0) {
            tdDifference.classList.add('text-danger');
        } else if (alerte.difference < 0) {
            tdDifference.classList.add('text-success');
        }
        
        tr.appendChild(tdDifference);
        
        // Pourcentage
        const tdPourcentage = document.createElement('td');
        tdPourcentage.textContent = `${alerte.pourcentage.toFixed(2)}%`;
        tdPourcentage.classList.add('text-end');
        
        // Colorer selon le pourcentage
        if (alerte.pourcentage > 50) {
            tdPourcentage.classList.add('text-danger', 'fw-bold');
        } else if (alerte.pourcentage > 20) {
            tdPourcentage.classList.add('text-warning', 'fw-bold');
        } else {
            tdPourcentage.classList.add('text-primary');
        }
        
        tr.appendChild(tdPourcentage);
        
        tbody.appendChild(tr);
    });
}

// ... existing code ...

// Fonction pour filtrer le tableau de stock par point de vente et produit
function filtrerStock() {
    const pointVenteFiltre = document.getElementById('filtre-point-vente').value;
    const produitFiltre = document.getElementById('filtre-produit').value;
    const masquerQuantiteZero = document.getElementById('masquer-quantite-zero').checked;
    const rows = document.querySelectorAll('#stock-table tbody tr');

    console.log(`Filtrage du stock - Point de vente: ${pointVenteFiltre}, Produit: ${produitFiltre}, Masquer quantité zéro: ${masquerQuantiteZero}`);
    
    rows.forEach(row => {
        // Point de vente: peut être un select (manuel) ou du texte (automatique)
        const pointVenteSelect = row.querySelector('td:first-child select');
        const pointVenteCell = row.querySelector('td:first-child');
        
        // Produit: peut être un select (manuel) ou du texte avec badge (automatique)
        const produitSelect = row.querySelector('td:nth-child(2) select');
        const produitCell = row.querySelector('td:nth-child(2)');
        
        const quantiteInput = row.querySelector('td:nth-child(3) input');
        
        // Récupérer la valeur du point de vente (select ou texte)
        let pointVente = '';
        if (pointVenteSelect) {
            pointVente = pointVenteSelect.value;
        } else if (pointVenteCell) {
            pointVente = pointVenteCell.textContent.trim();
        }
        
        // Récupérer la valeur du produit (select ou texte sans le badge)
        let produit = '';
        if (produitSelect) {
            produit = produitSelect.value;
        } else if (produitCell) {
            // Pour les produits auto, le nom est après le badge "Auto"
            const text = produitCell.textContent.trim();
            // Enlever "Auto" et le symbole info au début
            produit = text.replace(/^Auto\s*/, '').replace(/ℹ️?\s*$/, '').trim();
        }
        
        const quantite = quantiteInput ? parseFloat(quantiteInput.value) || 0 : 0;
        
        const matchPointVente = pointVenteFiltre === 'tous' || pointVente === pointVenteFiltre;
        const matchProduit = produitFiltre === 'tous' || produit === produitFiltre;
        const matchQuantite = !masquerQuantiteZero || quantite > 0;
        
        if (matchPointVente && matchProduit && matchQuantite) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Fonction pour initialiser les filtres de stock
function initFilterStock() {
    const filtrePointVente = document.getElementById('filtre-point-vente');
    const filtreProduit = document.getElementById('filtre-produit');
    const masquerQuantiteZero = document.getElementById('masquer-quantite-zero');
    
    // S'assurer que le filtre de point de vente est peuplé
    if (filtrePointVente && filtrePointVente.options.length <= 1) {
        // Peupler directement avec les points de vente physiques
        POINTS_VENTE_PHYSIQUES.forEach(pv => {
            const option = document.createElement('option');
            option.value = pv;
            option.textContent = pv;
            filtrePointVente.appendChild(option);
        });
    }
    
    // Peupler le filtre de produits avec les produits de produitsInventaire.js
    if (filtreProduit && typeof produitsInventaire !== 'undefined') {
        // Vider les options existantes (sauf la première "Tous les produits")
        while (filtreProduit.children.length > 1) {
            filtreProduit.removeChild(filtreProduit.lastChild);
        }
        
        // Ajouter les produits de produitsInventaire.js
        if (typeof produitsInventaire.getTousLesProduits === 'function') {
            const produitsList = produitsInventaire.getTousLesProduits();
            produitsList.forEach(produit => {
                const option = document.createElement('option');
                option.value = produit;
                option.textContent = produit;
                filtreProduit.appendChild(option);
            });
        }
    }
    
    if (filtrePointVente) {
        filtrePointVente.addEventListener('change', filtrerStock);
    }
    
    if (filtreProduit) {
        filtreProduit.addEventListener('change', filtrerStock);
    }
    
    if (masquerQuantiteZero) {
        masquerQuantiteZero.addEventListener('change', filtrerStock);
    }
    
    // Initialiser le bouton "Aller à la rec."
    const btnAllerReconciliation = document.getElementById('btn-aller-reconciliation');
    if (btnAllerReconciliation) {
        btnAllerReconciliation.addEventListener('click', function() {
            naviguerVersReconciliation();
        });
    }
    
    // Initialiser les boutons de réinitialisation du stock (admin uniquement)
    // Utiliser un flag pour éviter les écouteurs dupliqués
    const btnResetMatin = document.getElementById('btn-reset-stock-matin');
    if (btnResetMatin && !btnResetMatin.hasAttribute('data-listener-added')) {
        btnResetMatin.setAttribute('data-listener-added', 'true');
        btnResetMatin.addEventListener('click', () => resetStock('matin'));
    }
    
    const btnResetSoir = document.getElementById('btn-reset-stock-soir');
    if (btnResetSoir && !btnResetSoir.hasAttribute('data-listener-added')) {
        btnResetSoir.setAttribute('data-listener-added', 'true');
        btnResetSoir.addEventListener('click', () => resetStock('soir'));
    }
}

// Fonction pour réinitialiser le stock à 0 (admin uniquement)
async function resetStock(type) {
    // Récupérer la date sélectionnée
    const dateInput = document.getElementById('date-inventaire');
    if (!dateInput || !dateInput.value) {
        alert('Veuillez sélectionner une date');
        return;
    }
    
    const dateFormatted = dateInput.value; // Format DD/MM/YYYY
    const typeName = type === 'matin' ? 'Stock Matin' : 'Stock Soir';
    
    // Double confirmation
    const firstConfirm = confirm(`⚠️ ATTENTION ⚠️\n\nVous êtes sur le point de mettre TOUTES les quantités du ${typeName} à 0 pour le ${dateFormatted}.\n\nCette action est IRRÉVERSIBLE.\n\nContinuer ?`);
    
    if (!firstConfirm) return;
    
    const secondConfirm = confirm(`🔴 DERNIÈRE CONFIRMATION 🔴\n\nTapez OK pour confirmer la réinitialisation du ${typeName} du ${dateFormatted}.`);
    
    if (!secondConfirm) return;
    
    try {
        // Convertir la date au format YYYY-MM-DD pour l'API
        const [jour, mois, annee] = dateFormatted.split('/');
        const dateApi = `${annee}-${mois}-${jour}`;
        
        const response = await fetch(`/api/admin/stock-reset/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ date: dateApi })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            let message = `✅ ${data.count} entrées du ${typeName} réinitialisées à 0 pour le ${dateFormatted}`;
            if (data.countAuto > 0) {
                message += `\n+ ${data.countAuto} produits automatiques réinitialisés`;
            }
            alert(message);
            // Recharger le stock avec la date actuelle
            const dateInput = document.getElementById('date-inventaire');
            const currentDate = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
            const typeStock = document.getElementById('type-stock').value;
            chargerStock(currentDate, typeStock);
        } else {
            alert(data.message || 'Erreur lors de la réinitialisation');
        }
    } catch (error) {
        console.error('Erreur réinitialisation stock:', error);
        alert('Erreur lors de la réinitialisation du stock');
    }
}

// Fonction pour naviguer vers la page Réconciliation avec la date du Stock inventaire
function naviguerVersReconciliation() {
    // Récupérer la date sélectionnée dans le Stock inventaire
    const dateInventaireInput = document.getElementById('date-inventaire');
    console.log("Élément date inventaire trouvé:", !!dateInventaireInput);
    
    if (!dateInventaireInput || !dateInventaireInput.value) {
        console.error("Aucune date sélectionnée ou élément date-inventaire non trouvé");
        alert('Veuillez sélectionner une date avant de naviguer vers la réconciliation');
        return;
    }
    
    // Récupérer la date avec le format complet (comme retourné par flatpickr)
    const dateInventaire = dateInventaireInput.value;
    console.log("Date récupérée du Stock inventaire:", dateInventaire);
    console.log("Type de la date:", typeof dateInventaire);
    
    // Stocker la date dans sessionStorage pour la récupérer dans la page Réconciliation
    sessionStorage.setItem('reconciliation_date', dateInventaire);
    console.log("Date stockée dans sessionStorage:", sessionStorage.getItem('reconciliation_date'));
    
    // Naviguer vers l'onglet Réconciliation
    const reconciliationTab = document.getElementById('reconciliation-tab');
    console.log("Onglet réconciliation trouvé:", !!reconciliationTab);
    
    if (reconciliationTab) {
        console.log("Clic sur l'onglet Réconciliation");
        reconciliationTab.click();
    } else {
        console.error("L'onglet Réconciliation n'a pas été trouvé");
        alert("Impossible de naviguer vers l'onglet Réconciliation. L'élément n'existe pas.");
    }
}

// ... existing code ...

// Fonction pour initialiser les écouteurs d'événements des onglets
function initTabListeners() {
    // Écouter les changements d'onglets
    const tabLinks = document.querySelectorAll('.nav-link');
    tabLinks.forEach(tab => {
        tab.addEventListener('click', function(e) {
            const tabId = this.id;
            console.log(`Navigation vers l'onglet: ${tabId}`);
            
            // Gestion spécifique pour l'onglet inventaire
            if (tabId === 'stock-inventaire-tab') {
                // Vérifier s'il y a des filtres à appliquer depuis la section réconciliation
                const pointVente = sessionStorage.getItem('inventaire_filter_point_vente');
                const date = sessionStorage.getItem('inventaire_filter_date');
                const periode = sessionStorage.getItem('inventaire_filter_periode');
                
                if (pointVente && date) {
                    console.log(`Filtrage de l'inventaire pour: ${pointVente}, date: ${date}, période: ${periode}`);
                    
                    // Définir la date dans le sélecteur de date
                    const dateInput = document.getElementById('date-inventaire');
                    if (dateInput) {
                        dateInput.value = date;
                        // Déclencher l'événement de changement pour charger les données
                        const event = new Event('change');
                        dateInput.dispatchEvent(event);
                    }
                    
                    // Définir le type de stock (matin ou soir)
                    const typeStockSelect = document.getElementById('type-stock');
                    if (typeStockSelect && periode) {
                        typeStockSelect.value = periode === 'matin' ? 'matin' : 'soir';
                        // Déclencher l'événement de changement
                        const event = new Event('change');
                        typeStockSelect.dispatchEvent(event);
                    }
                    
                    // Définir le point de vente dans le filtre
                    setTimeout(() => {
                        const filtrePointVente = document.getElementById('filtre-point-vente');
                        if (filtrePointVente) {
                            filtrePointVente.value = pointVente;
                            // Déclencher l'événement de changement pour filtrer
                            filtrerStock();
                        }
                        
                        // Effacer les filtres stockés pour éviter de les réappliquer à la prochaine ouverture
                        sessionStorage.removeItem('inventaire_filter_point_vente');
                        sessionStorage.removeItem('inventaire_filter_date');
                        sessionStorage.removeItem('inventaire_filter_periode');
                    }, 1000); // Attendre 1 seconde pour s'assurer que les données sont chargées
                }
            }
            
            // Gestion spécifique pour l'onglet réconciliation
            if (tabId === 'reconciliation-tab') {
                console.log("Navigation vers l'onglet Réconciliation");
                
                // Vérifier s'il y a une date stockée dans sessionStorage
                const storedDate = sessionStorage.getItem('reconciliation_date');
                console.log("Date stockée pour la réconciliation:", storedDate);
                
                if (storedDate) {
                    console.log("Date trouvée, va être appliquée après l'initialisation de flatpickr");
                    
                    // Attendre que l'onglet soit visible et que flatpickr soit initialisé
                    setTimeout(() => {
                        const dateInput = document.getElementById('date-reconciliation');
                        if (dateInput) {
                            console.log("Élément date-reconciliation trouvé");
                            
                            // Essayer d'abord avec flatpickr s'il est initialisé
                            if (dateInput._flatpickr) {
                                console.log("Flatpickr est initialisé, mise à jour de la date via flatpickr");
                                dateInput._flatpickr.setDate(storedDate, true); // true pour déclencher l'événement change
                                console.log("Date définie via flatpickr:", dateInput.value);
                            } else {
                                // Fallback: définir directement la valeur
                                console.log("Flatpickr non initialisé, définition directe de la valeur");
                                dateInput.value = storedDate;
                                
                                // Déclencher manuellement l'événement change
                                const event = new Event('change');
                                dateInput.dispatchEvent(event);
                                console.log("Événement change déclenché manuellement");
                            }
                            
                            // Mettre à jour explicitement l'élément d'affichage de la date
                            const dateDisplay = document.getElementById('date-reconciliation-display');
                            if (dateDisplay) {
                                console.log("Mise à jour de l'affichage de la date:", storedDate);
                                dateDisplay.textContent = storedDate;
                            } else {
                                console.error("Élément date-reconciliation-display non trouvé");
                            }
                            
                            // Supprimer la date du stockage
                            sessionStorage.removeItem('reconciliation_date');
                            console.log("Date supprimée de sessionStorage");
                        } else {
                            console.error("Élément date-reconciliation non trouvé");
                        }
                    }, 500); // Attendre 500ms pour s'assurer que l'onglet est visible et que flatpickr est initialisé
                }
            }

            // Gestion spécifique pour l'onglet estimation
            if (tabId === 'estimation-tab') {
                e.preventDefault();
                showSection('estimation-section');
                // Ensure loadLatestEstimation is called when tab becomes active
                setTimeout(() => {
                    if (typeof loadLatestEstimation === 'function') {
                        loadLatestEstimation();
                    }
                }, 100);
            }
        });
    });
}

// Appeler l'initialisation des écouteurs d'onglets au chargement de la page
document.addEventListener('DOMContentLoaded', function() {
    initTabListeners();
    // ... autres initialisations existantes ...
});

// Gestionnaires d'onglets
document.getElementById('saisie-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('saisie-section');
});

document.getElementById('precommande-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('precommande-section');
    // Initialiser les dropdowns spécifiquement pour les pré-commandes
    initPrecommandeDropdowns();
});

document.getElementById('payment-links-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('payment-links-section');
    
    // Charger les liens de paiement existants via l'iframe
    setTimeout(() => {
        const iframe = document.querySelector('#payment-links-section iframe');
        if (iframe && iframe.contentWindow) {
            try {
                iframe.contentWindow.postMessage({ action: 'loadPaymentLinks' }, '*');
                console.log('Message envoyé à l\'iframe pour charger les liens de paiement');
                
                // Ajuster la hauteur de l'iframe après le chargement
                adjustIframeHeight(iframe);
            } catch (error) {
                console.error('Erreur lors de l\'envoi du message à l\'iframe:', error);
            }
        }
    }, 100);
});

// Fonction pour ajuster la hauteur de l'iframe automatiquement
function adjustIframeHeight(iframe) {
    if (!iframe) return;
    
    // Attendre que l'iframe soit chargé
    iframe.onload = function() {
        try {
            // Obtenir la hauteur du contenu de l'iframe
            const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
            const body = iframeDocument.body;
            const html = iframeDocument.documentElement;
            
            // Calculer la hauteur nécessaire
            const height = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                html.clientHeight,
                html.scrollHeight,
                html.offsetHeight
            );
            
            // Ajuster la hauteur de l'iframe
            iframe.style.height = height + 'px';
            console.log('Hauteur de l\'iframe ajustée à:', height + 'px');
            
        } catch (error) {
            console.error('Erreur lors de l\'ajustement de la hauteur de l\'iframe:', error);
        }
    };
    
    // Ajuster aussi après un délai pour s'assurer que le contenu est chargé
    setTimeout(() => {
        try {
            const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
            const body = iframeDocument.body;
            const html = iframeDocument.documentElement;
            
            const height = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                html.clientHeight,
                html.scrollHeight,
                html.offsetHeight
            );
            
            iframe.style.height = height + 'px';
            console.log('Hauteur de l\'iframe ajustée (délai) à:', height + 'px');
            
        } catch (error) {
            console.error('Erreur lors de l\'ajustement de la hauteur de l\'iframe (délai):', error);
        }
    }, 500);
}

// Écouter les messages de l'iframe pour ajuster la hauteur
window.addEventListener('message', function(event) {
    if (event.data && event.data.action === 'resizeIframe') {
        const iframe = document.querySelector('#payment-links-section iframe');
        if (iframe) {
            iframe.style.height = event.data.height + 'px';
            console.log('📏 Hauteur de l\'iframe ajustée via message:', event.data.height + 'px');
        }
    }
});

document.getElementById('visualisation-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('visualisation-section');
});

document.getElementById('stock-inventaire-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('stock-inventaire-section');
});

document.getElementById('copier-stock-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('copier-stock-section');
});

document.getElementById('suivi-achat-boeuf-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('suivi-achat-boeuf-section');
});

document.getElementById('reconciliation-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('reconciliation-section');
});


document.getElementById('stock-alerte-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('stock-alerte-section');
});

document.getElementById('cash-payment-tab').addEventListener('click', function(e) {
    e.preventDefault();
    showSection('cash-payment-section');
    
    // Vérifier les permissions admin pour afficher le bouton "Effacer les données"
    checkCashPaymentAdminPermissions();
});


// Fonction pour initialiser la section de réconciliation mensuelle
function initReconciliationMensuelle() {
    console.log('Initialisation de la section de réconciliation mensuelle');
    
    // S'assurer que la section est visible
    document.getElementById('reconciliation-mois-section').style.display = 'block';
    
    // Initialiser le mois et l'année avec les valeurs actuelles
    const currentDate = new Date();
    const currentMonth = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    const currentYear = currentDate.getFullYear().toString();
    
    const moisSelect = document.getElementById('mois-reconciliation');
    const anneeSelect = document.getElementById('annee-reconciliation');
    
    // Définir les valeurs par défaut
    if (moisSelect) moisSelect.value = currentMonth;
    if (anneeSelect) {
        // Vérifier si l'année courante existe dans les options
        let yearExists = false;
        for (let i = 0; i < anneeSelect.options.length; i++) {
            if (anneeSelect.options[i].value === currentYear) {
                yearExists = true;
                break;
            }
        }
        
        // Si l'année n'existe pas, l'ajouter
        if (!yearExists) {
            const option = document.createElement('option');
            option.value = currentYear;
            option.textContent = currentYear;
            anneeSelect.appendChild(option);
        }
        
        anneeSelect.value = currentYear;
    }
    
    // Ajouter les écouteurs d'événements pour les changements de mois/année
    if (moisSelect) {
        moisSelect.addEventListener('change', function() {
            // Charger les données seulement si l'utilisateur change manuellement
            chargerReconciliationMensuelle();
        });
    }
    
    if (anneeSelect) {
        anneeSelect.addEventListener('change', function() {
            // Charger les données seulement si l'utilisateur change manuellement
            chargerReconciliationMensuelle();
        });
    }
        // Ajouter l'écouteur d'événement pour le bouton d'export Excel
        const btnExportExcelMois = document.getElementById('export-reconciliation-mois');
        if (btnExportExcelMois) {
            console.log('[DEBUG] Bouton Export Excel (export-reconciliation-mois) trouvé. Ajout écouteur.'); 
            btnExportExcelMois.addEventListener('click', exportReconciliationMoisToExcel);
        } else {
            console.error('Bouton d\'export Excel non trouvé!');
        }
    // Ajouter l'écouteur d'événement pour le filtre de point de vente
    const pointVenteFiltre = document.getElementById('point-vente-filtre-mois');
    if (pointVenteFiltre) {
        // Vider les options existantes sauf la première
        while (pointVenteFiltre.options.length > 1) {
            pointVenteFiltre.remove(1);
        }
        
        // Populer les options de point de vente
        POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
            const option = document.createElement('option');
            option.value = pointVente;
            option.textContent = pointVente;
            pointVenteFiltre.appendChild(option);
        });
        
        pointVenteFiltre.addEventListener('change', function() {
            filtrerTableauReconciliationMensuelle();
        });
    }
    
    // Ajouter l'écouteur d'événement pour le bouton de chargement des commentaires
    const btnChargerCommentairesMois = document.getElementById('charger-commentaires-mois');
    if (btnChargerCommentairesMois) {
        btnChargerCommentairesMois.addEventListener('click', function(e) {
            e.preventDefault();
            chargerCommentairesMensuels();
            return false;
        });
    }
    
    // NE PAS charger automatiquement les données au démarrage
    // Les données seront chargées seulement quand l'utilisateur change le mois/année
    // ou quand il clique sur un bouton spécifique
    console.log('Initialisation terminée - données non chargées automatiquement');
    
    // Vérifier si les boutons existent déjà pour éviter la duplication
    if (!document.getElementById('recalculer-reconciliation-mois')) {
        // Ajouter le bouton de recalcul forcé
        const btnRecalculer = document.createElement('button');
        btnRecalculer.id = 'recalculer-reconciliation-mois';
        btnRecalculer.className = 'btn btn-warning btn-sm ms-2';
        btnRecalculer.innerHTML = '<i class="fas fa-sync-alt"></i> Recalculer';
        btnRecalculer.title = 'Forcer le recalcul (ignore le cache)';
        
        // Insérer le bouton après le bouton d'export
        const exportBtn = document.getElementById('export-reconciliation-mois');
        if (exportBtn && exportBtn.parentNode) {
            exportBtn.parentNode.insertBefore(btnRecalculer, exportBtn.nextSibling);
        }
    
        // Ajouter l'écouteur d'événement pour le recalcul forcé
        btnRecalculer.addEventListener('click', function() {
            const mois = document.getElementById('mois-reconciliation').value;
            const annee = document.getElementById('annee-reconciliation').value;
            if (mois && annee) {
                // Forcer le recalcul en supprimant le cache pour cette période
                const cacheKey = `${mois}-${annee}`;
                reconciliationCache.delete(cacheKey);
                console.log(`Cache supprimé pour ${mois}/${annee}, recalcul forcé`);
                chargerReconciliationMensuelle(true); // true = force recalcul
            } else {
                alert('Veuillez sélectionner un mois et une année');
            }
        });
    }
    
    // Vérifier si le bouton vider cache existe déjà
    if (!document.getElementById('vider-cache-reconciliation')) {
        // Ajouter un bouton pour vider tout le cache
        const btnViderCache = document.createElement('button');
        btnViderCache.id = 'vider-cache-reconciliation';
        btnViderCache.className = 'btn btn-outline-secondary btn-sm ms-2';
        btnViderCache.innerHTML = '<i class="fas fa-trash"></i> Vider Cache';
        btnViderCache.title = 'Vider tout le cache de réconciliation';
        
        // Insérer le bouton après le bouton de recalcul ou d'export
        const recalculBtn = document.getElementById('recalculer-reconciliation-mois');
        const exportBtn = document.getElementById('export-reconciliation-mois');
        const parentNode = recalculBtn ? recalculBtn.parentNode : (exportBtn ? exportBtn.parentNode : null);
        
        if (parentNode) {
            if (recalculBtn) {
                parentNode.insertBefore(btnViderCache, recalculBtn.nextSibling);
            } else {
                parentNode.insertBefore(btnViderCache, exportBtn.nextSibling);
            }
        }
        
        // Ajouter l'écouteur d'événement pour vider le cache
        btnViderCache.addEventListener('click', function() {
            const cacheSize = reconciliationCache.size;
            reconciliationCache.clear();
            console.log(`Cache vidé - ${cacheSize} entrées supprimées`);
            alert(`Cache vidé avec succès (${cacheSize} entrées supprimées)`);
        });
    }
    
    // Vérifier si l'indicateur de cache existe déjà
    if (!document.getElementById('cache-indicator')) {
        // Ajouter un indicateur d'état du cache
        const cacheIndicator = document.createElement('span');
        cacheIndicator.id = 'cache-indicator';
        cacheIndicator.className = 'badge bg-info ms-2';
        cacheIndicator.style.fontSize = '0.8em';
        cacheIndicator.textContent = 'Cache: 0 entrées';
        
        // Insérer l'indicateur après les boutons
        const viderCacheBtn = document.getElementById('vider-cache-reconciliation');
        const recalculBtn = document.getElementById('recalculer-reconciliation-mois');
        const exportBtn = document.getElementById('export-reconciliation-mois');
        const parentNode = viderCacheBtn ? viderCacheBtn.parentNode : 
                          (recalculBtn ? recalculBtn.parentNode : 
                          (exportBtn ? exportBtn.parentNode : null));
        
        if (parentNode) {
            if (viderCacheBtn) {
                parentNode.insertBefore(cacheIndicator, viderCacheBtn.nextSibling);
            } else if (recalculBtn) {
                parentNode.insertBefore(cacheIndicator, recalculBtn.nextSibling);
            } else {
                parentNode.insertBefore(cacheIndicator, exportBtn.nextSibling);
            }
        }
    }
    
    // Fonction pour mettre à jour l'indicateur de cache
    function updateCacheIndicator() {
        const cacheSize = reconciliationCache.size;
        const indicator = document.getElementById('cache-indicator');
        if (indicator) {
            indicator.textContent = `Cache: ${cacheSize} entrées`;
            indicator.className = cacheSize > 0 ? 'badge bg-success ms-2' : 'badge bg-info ms-2';
        }
    }
    
    // Exposer la fonction globalement pour pouvoir l'appeler depuis chargerReconciliationMensuelle
    window.updateCacheIndicator = updateCacheIndicator;
    
    // Mettre à jour l'indicateur initialement
    updateCacheIndicator();
}

let isLoadingReconciliationMensuelle = false; // Moved to global scope here

/**
 * Charge les données de réconciliation pour le mois et l'année sélectionnés
 * @param {boolean} forceRecalcul - Si true, ignore le cache et force le recalcul
 */
async function chargerReconciliationMensuelle(forceRecalcul = false) {
    if (isLoadingReconciliationMensuelle) {
        console.log("Chargement de la réconciliation mensuelle déjà en cours. Annulation de la nouvelle demande.");
        return;
    }
    isLoadingReconciliationMensuelle = true;

    try { // Add try block
        const moisSelect = document.getElementById('mois-reconciliation');
        const anneeSelect = document.getElementById('annee-reconciliation');

        // --- Récupérer les éléments des totaux ---
        const totalVentesTheoriquesEl = document.getElementById('total-ventes-theoriques-mois');
        const totalVentesSaisiesEl = document.getElementById('total-ventes-saisies-mois');
        const totalCreancesEl = document.getElementById('total-creances-mois');
        const totalVersementsEl = document.getElementById('total-versements-mois');
        // --- Récupérer l'élément pour l'estimation ---
        const estimationVersementsEl = document.getElementById('estimation-versements-mois');

        // --- Réinitialiser les totaux affichés ---
        if (totalVentesTheoriquesEl) totalVentesTheoriquesEl.textContent = formatMonetaire(0);
        if (totalVentesSaisiesEl) totalVentesSaisiesEl.textContent = formatMonetaire(0);
        if (totalCreancesEl) totalCreancesEl.textContent = formatMonetaire(0);
        if (totalVersementsEl) totalVersementsEl.textContent = formatMonetaire(0);
        // --- Réinitialiser l'estimation ---
        if (estimationVersementsEl) estimationVersementsEl.textContent = formatMonetaire(0);

        // --- Initialiser les variables de calcul des totaux ---
        let totalVentesTheoriquesMois = 0;
        let totalVentesSaisiesMois = 0;
        let totalCreancesMois = 0;
        let totalVersementsMois = 0;
        let dernierJourAvecDonnees = 0; // Pour l'estimation
        // --- Fin initialisation totaux ---

        if (!moisSelect || !anneeSelect) {
            console.error('Sélecteurs de mois/année non trouvés');
            return;
        }

        const mois = moisSelect.value;
        const annee = anneeSelect.value;

        console.log(`Chargement des données de réconciliation pour ${mois}/${annee}`);

        // Vérifier le cache si on ne force pas le recalcul
        if (!forceRecalcul) {
            const cacheKey = `${mois}-${annee}`;
            const cachedData = reconciliationCache.get(cacheKey);
            
            if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
                console.log(`Données trouvées en cache pour ${mois}/${annee}`);
                
                // Afficher les données en cache
                afficherDonneesReconciliationMensuelle(cachedData.data);
                
                // Mettre à jour les totaux
                if (cachedData.totaux) {
                    const totalVentesTheoriquesEl = document.getElementById('total-ventes-theoriques-mois');
                    const totalVentesSaisiesEl = document.getElementById('total-ventes-saisies-mois');
                    const totalVersementsEl = document.getElementById('total-versements-mois');
                    const estimationVersementsEl = document.getElementById('estimation-versements-mois');
                    
                    if (totalVentesTheoriquesEl) totalVentesTheoriquesEl.textContent = formatMonetaire(cachedData.totaux.ventesTheoriques);
                    if (totalVentesSaisiesEl) totalVentesSaisiesEl.textContent = formatMonetaire(cachedData.totaux.ventesSaisies);
                    if (totalVersementsEl) totalVersementsEl.textContent = formatMonetaire(cachedData.totaux.versements);
                    if (estimationVersementsEl) estimationVersementsEl.textContent = formatMonetaire(cachedData.totaux.estimation);
                }
                
                isLoadingReconciliationMensuelle = false;
                return;
            }
        }

        const loadingIndicator = document.getElementById('loading-indicator-reconciliation-mois');
        if (loadingIndicator) loadingIndicator.style.display = 'block';

        const tableBody = document.querySelector('#reconciliation-mois-table tbody');
        tableBody.innerHTML = ''; // Vider le tableau

        // --- Add check for valid month selection ---
        if (!mois) {
            console.warn("Aucun mois valide sélectionné. Arrêt du chargement.");
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 12; // Adjust colspan if needed
            cell.textContent = 'Aucun mois sélectionné ou aucune donnée pour cette année.';
            cell.className = 'text-center';
            row.appendChild(cell);
            tableBody.appendChild(row);
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            // Reset totals and estimation if no month selected
            if (totalVentesTheoriquesEl) totalVentesTheoriquesEl.textContent = formatMonetaire(0);
            if (totalVentesSaisiesEl) totalVentesSaisiesEl.textContent = formatMonetaire(0);
            if (totalVersementsEl) totalVersementsEl.textContent = formatMonetaire(0);
            if (estimationVersementsEl) estimationVersementsEl.textContent = formatMonetaire(0);
            return; // Stop execution
        }
        // --- End check ---

        const anneeNum = parseInt(annee);
        const moisNum = parseInt(mois); // Mois est 1-basé ici
        const totalDaysInMonth = new Date(anneeNum, moisNum, 0).getDate();
        let hasAnyData = false; // Flag to check if any data was found for the month

        for (let jour = 1; jour <= totalDaysInMonth; jour++) {
            const dateStr = `${jour.toString().padStart(2, '0')}/${mois}/${annee}`;
            console.log(`Traitement du jour ${dateStr}...`);

            // 1. Fetch base data components
            let stockMatin, stockSoir, transferts, ventesData;
            try {
                [stockMatin, stockSoir, transferts, ventesData] = await Promise.all([
                    getStockForDate(dateStr, 'matin'),
                    getStockForDate(dateStr, 'soir'),
                    getTransfersForDate(dateStr),
                    fetch(`/api/ventes-date?date=${dateStr}`, { method: 'GET', credentials: 'include' }).then(res => res.ok ? res.json() : { success: false })
                ]);
                console.log(`Données brutes pour ${dateStr}:`, { stockMatin: Object.keys(stockMatin).length, stockSoir: Object.keys(stockSoir).length, transferts: transferts.length, ventes: ventesData.success ? ventesData.totaux : {} });
            } catch (fetchError) {
                console.error(`Erreur de fetch pour ${dateStr}:`, fetchError);
                continue; // Skip this day if base data fetch fails
            }

            const ventesSaisies = ventesData.success && ventesData.totaux ? ventesData.totaux : {};

            // 2. Check if any data exists for this date
            const dayHasData =
                Object.keys(stockMatin).length > 0 ||
                Object.keys(stockSoir).length > 0 ||
                transferts.length > 0 ||
                Object.keys(ventesSaisies).length > 0;

            if (!dayHasData) {
                console.log(`Aucune donnée pour ${dateStr}, jour ignoré.`);
                continue; // Skip this day if no data
            }

            hasAnyData = true; // Mark that we found data for at least one day
            dernierJourAvecDonnees = jour; // Update last day with data for estimation

            // 3. Calculate reconciliation for the day
            let dailyReconciliation = {};
            const debugInfo = { date: dateStr, detailsParPointVente: {} }; // Minimal debug info
            try {
                // Pass dateStr as the first argument
                dailyReconciliation = await calculerReconciliationParPointVente(dateStr, stockMatin, stockSoir, transferts, debugInfo);
                console.log(`Réconciliation calculée pour ${dateStr}:`, dailyReconciliation);
            } catch (calcError) {
                console.error(`Erreur de calcul pour ${dateStr}:`, calcError);
                // Initialize with zeros if calculation fails but base data exists
                POINTS_VENTE_PHYSIQUES.forEach(pv => {
                    dailyReconciliation[pv] = { stockMatin: 0, stockSoir: 0, transferts: 0, ventes: 0, ventesSaisies: 0, difference: 0, pourcentageEcart: 0, cashPayment: 0, ecartCash: 0, commentaire: 'Erreur calcul' };
                });
            }

            // 4. Fetch saved reconciliation data (for comments/cash)
            let savedData = null;
            try {
                const loadResponse = await fetch(`/api/reconciliation/load?date=${dateStr}`, {
                    method: 'GET',
                    credentials: 'include'
                });
                if (loadResponse.ok) {
                    const loadResult = await loadResponse.json();
                    if (loadResult.success && loadResult.data) {
                        if (loadResult.data.reconciliation) {
                            savedData = loadResult.data.reconciliation;
                        } else if (loadResult.data.data) { // Compatibility
                            try { savedData = JSON.parse(loadResult.data.data); } catch(e) { savedData = loadResult.data.data; }
                        }
                        console.log(`Données sauvegardées chargées pour ${dateStr}:`, savedData);
                    }
                }
            } catch (loadError) {
                console.warn(`Erreur chargement données sauvegardées pour ${dateStr}:`, loadError);
            }

            // 5. Merge saved comments/cash into calculated data and Accumulate totals
            if (savedData) {
                Object.keys(savedData).forEach(pointVente => {
                    if (dailyReconciliation[pointVente]) {
                        if (savedData[pointVente].commentaire) {
                            dailyReconciliation[pointVente].commentaire = savedData[pointVente].commentaire;
                        }
                        if (savedData[pointVente].cashPayment !== undefined) { // Check for undefined, as 0 is valid
                            dailyReconciliation[pointVente].cashPayment = parseFloat(savedData[pointVente].cashPayment) || 0; // Ensure it's a number
                            // Recalculate ecartCash if cashPayment was loaded
                            dailyReconciliation[pointVente].ecartCash = (dailyReconciliation[pointVente].cashPayment || 0) - (dailyReconciliation[pointVente].ventesSaisies || 0);
                        } else {
                            // Ensure cashPayment is initialized if not in saved data
                             dailyReconciliation[pointVente].cashPayment = 0;
                             dailyReconciliation[pointVente].ecartCash = 0 - (dailyReconciliation[pointVente].ventesSaisies || 0);
                        }
                    }
                });
            } else {
                // Ensure cashPayment is initialized if no saved data
                Object.keys(dailyReconciliation).forEach(pointVente => {
                     if (dailyReconciliation[pointVente]) {
                         dailyReconciliation[pointVente].cashPayment = 0;
                         dailyReconciliation[pointVente].ecartCash = 0 - (dailyReconciliation[pointVente].ventesSaisies || 0);
                     }
                });
            }

             // --- Accumuler les totaux pour ce jour ---
             Object.values(dailyReconciliation).forEach(data => {
                 totalVentesTheoriquesMois += parseFloat(data.ventes) || 0;
                 totalVentesSaisiesMois += parseFloat(data.ventesSaisies) || 0;
                 totalCreancesMois += parseFloat(data.creances) || 0;
                 totalVersementsMois += parseFloat(data.cashPayment) || 0;
             });
             // --- Fin accumulation totaux ---

            // 6. Generate table rows for this date
            Object.keys(dailyReconciliation).forEach(pointVente => {
                 if (!POINTS_VENTE_PHYSIQUES.includes(pointVente)) return;

                 const data = dailyReconciliation[pointVente];
                 const row = document.createElement('tr');

                 // Cellule Date
                 let cell = document.createElement('td');
                 cell.textContent = dateStr;
                 row.appendChild(cell);

                 // Cellule Point de Vente
                 cell = document.createElement('td');
                 cell.textContent = pointVente;
                 row.appendChild(cell);

                 // Cellules de valeurs (stock matin, stock soir, etc.)
                 const columns = [
                     { key: 'stockMatin', format: 'currency' },
                     { key: 'stockSoir', format: 'currency' },
                     { key: 'transferts', format: 'currency' },
                     { key: 'ventes', format: 'currency' }, // Theoretical Sales
                     { key: 'ventesSaisies', format: 'currency' },
                     { key: 'creances', format: 'currency' }, // Créances
                     { key: 'difference', format: 'currency' }, // Ecart
                     { key: 'cashPayment', format: 'currency' },
                     { key: 'pourcentageEcart', format: 'percentage' }, // Ecart %
                     { key: 'ecartCash', format: 'currency' }
                 ];

                 columns.forEach(columnInfo => {
                     cell = document.createElement('td');
                     cell.className = 'text-end';

                     const value = data ? data[columnInfo.key] : 0;

                     if (columnInfo.format === 'percentage') {
                         const percentageValue = parseFloat(value) || 0;
                         cell.textContent = `${percentageValue.toFixed(2)}%`;

                         if (Math.abs(percentageValue) > 10) {
                             cell.classList.add('text-danger', 'fw-bold');
                         } else if (Math.abs(percentageValue) > 8) {
                             cell.classList.add('text-warning', 'fw-bold');
                         } else if (Math.abs(percentageValue) > 0) {
                             cell.classList.add('text-success', 'fw-bold');
                         }
                     } else { // currency
                         const currencyValue = parseFloat(value) || 0;
                         cell.textContent = formatMonetaire(currencyValue);

                         if ((columnInfo.key === 'difference' || columnInfo.key === 'ecartCash') && currencyValue !== 0) {
                             cell.classList.add(currencyValue < 0 ? 'negative' : 'positive');
                         }
                         
                         // Style pour les créances
                         if (columnInfo.key === 'creances' && currencyValue > 0) {
                             cell.style.color = '#dc3545';
                             cell.style.fontWeight = 'bold';
                         }
                     }
                     row.appendChild(cell);
                 });

                 // Cellule Commentaire
                 cell = document.createElement('td');
                 const inputComment = document.createElement('input');
                 inputComment.type = 'text';
                 inputComment.className = 'form-control form-control-sm'; // smaller input
                 inputComment.value = data.commentaire || '';
                 inputComment.setAttribute('data-point-vente', pointVente);
                 inputComment.setAttribute('data-date', dateStr);
                 // Add event listener for saving comments if needed later
                 cell.appendChild(inputComment);
                 row.appendChild(cell);

                 tableBody.appendChild(row);
             });
        }

        // --- Calcul et affichage de l'estimation ---
        let estimationVersements = 0;
        if (hasAnyData && dernierJourAvecDonnees > 0) {
            let effectiveDaysPassed = 0;
            for (let d = 1; d <= dernierJourAvecDonnees; d++) {
                const currentDate = new Date(anneeNum, moisNum - 1, d);
                effectiveDaysPassed += (currentDate.getDay() === 0) ? 0.5 : 1; // Sunday is 0
            }

            let totalEffectiveDaysInMonth = 0;
            for (let d = 1; d <= totalDaysInMonth; d++) {
                const currentDate = new Date(anneeNum, moisNum - 1, d);
                totalEffectiveDaysInMonth += (currentDate.getDay() === 0) ? 0.5 : 1; // Sunday is 0
            }

            if (effectiveDaysPassed > 0) {
                estimationVersements = totalVersementsMois * (totalEffectiveDaysInMonth / effectiveDaysPassed);
                console.log(`Estimation calculée: TotalVersements=${totalVersementsMois}, JoursEffectifsPassés=${effectiveDaysPassed}, TotalJoursEffectifs=${totalEffectiveDaysInMonth}, Estimation=${estimationVersements}`);
            } else {
                 console.log("Jours effectifs passés est 0, estimation mise à 0.");
            }
        } else {
            console.log("Aucune donnée ou dernier jour avec données est 0, estimation mise à 0.");
        }

        if (estimationVersementsEl) {
            estimationVersementsEl.textContent = formatMonetaire(estimationVersements);
        }
        // --- Fin calcul et affichage estimation ---


        // If after checking all days, no data was found, display a message
        if (!hasAnyData) {
             const row = document.createElement('tr');
             const cell = document.createElement('td');
             cell.colSpan = 12; // Adjust colspan to match the number of columns
             cell.textContent = 'Aucune donnée trouvée pour ce mois.';
             cell.className = 'text-center';
             row.appendChild(cell);
             tableBody.appendChild(row);
             // --- Réinitialiser les totaux si aucune donnée ---
             if (totalVentesTheoriquesEl) totalVentesTheoriquesEl.textContent = formatMonetaire(0);
             if (totalVentesSaisiesEl) totalVentesSaisiesEl.textContent = formatMonetaire(0);
             if (totalVersementsEl) totalVersementsEl.textContent = formatMonetaire(0);
             // --- Reset estimation si aucune donnée ---
             if (estimationVersementsEl) estimationVersementsEl.textContent = formatMonetaire(0);

        } else {
            // --- Mettre à jour les totaux affichés si des données existent ---
            if (totalVentesTheoriquesEl) totalVentesTheoriquesEl.textContent = formatMonetaire(totalVentesTheoriquesMois);
            if (totalVentesSaisiesEl) totalVentesSaisiesEl.textContent = formatMonetaire(totalVentesSaisiesMois);
            if (totalCreancesEl) totalCreancesEl.textContent = formatMonetaire(totalCreancesMois);
            if (totalVersementsEl) totalVersementsEl.textContent = formatMonetaire(totalVersementsMois);
            // Estimation déjà mise à jour ci-dessus
        }

        // Sauvegarder dans le cache
        const cacheKey = `${mois}-${annee}`;
        const reconciliationData = []; // Collecter les données pour le cache
        
        // Collecter les données du tableau pour le cache
        const rows = tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.cells;
            if (cells.length >= 12) {
                reconciliationData.push({
                    date: cells[0].textContent,
                    pointVente: cells[1].textContent,
                    ventesTheoriques: extractNumericValue(cells[2].textContent),
                    ventesSaisies: extractNumericValue(cells[3].textContent),
                    versements: extractNumericValue(cells[4].textContent),
                    estimation: extractNumericValue(cells[7].textContent),
                    commentaires: cells[9].textContent
                });
            }
        });
        
        const cacheData = {
            data: reconciliationData,
            totaux: {
                ventesTheoriques: totalVentesTheoriquesMois,
                ventesSaisies: totalVentesSaisiesMois,
                versements: totalVersementsMois,
                estimation: estimationVersements
            },
            timestamp: Date.now()
        };
        reconciliationCache.set(cacheKey, cacheData);
        console.log(`Données sauvegardées en cache pour ${mois}/${annee}`);
        
        // Mettre à jour l'indicateur de cache
        if (window.updateCacheIndicator) {
            window.updateCacheIndicator();
        }

        // Filter the table based on the current dropdown selection
        filtrerTableauReconciliationMensuelle();

    } catch (error) {
        console.error('Erreur majeure lors du chargement des données mensuelles:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="12" class="text-center text-danger">
                    Une erreur majeure est survenue: ${error.message}
                </td>
            </tr>
        `;
        // --- Réinitialiser les totaux en cas d'erreur majeure ---
        if (totalVentesTheoriquesEl) totalVentesTheoriquesEl.textContent = formatMonetaire(0);
        if (totalVentesSaisiesEl) totalVentesSaisiesEl.textContent = formatMonetaire(0);
        if (totalVersementsEl) totalVersementsEl.textContent = formatMonetaire(0);
        // --- Reset estimation en cas d'erreur majeure ---
         if (estimationVersementsEl) estimationVersementsEl.textContent = formatMonetaire(0);
    } finally { // Add finally block
        isLoadingReconciliationMensuelle = false;
        const loadingIndicator = document.getElementById('loading-indicator-reconciliation-mois'); // Ensure indicator is hidden
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

/**
 * Filtre le tableau de réconciliation mensuelle selon le point de vente sélectionné
 */
function filtrerTableauReconciliationMensuelle() {
    const filtre = document.getElementById('point-vente-filtre-mois').value;
    const rows = document.querySelectorAll('#reconciliation-mois-table tbody tr');
    
    rows.forEach(row => {
        const pointVente = row.cells[1].textContent;
        if (filtre === '' || pointVente === filtre) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

/**
 * Affiche les données de réconciliation mensuelle (utilisée pour le cache)
 * @param {Array} reconciliationData - Les données de réconciliation à afficher
 */
function afficherDonneesReconciliationMensuelle(reconciliationData) {
    const tableBody = document.querySelector('#reconciliation-mois-table tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    if (!reconciliationData || reconciliationData.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 12;
        cell.textContent = 'Aucune donnée disponible pour cette période.';
        cell.className = 'text-center';
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
    }
    
    reconciliationData.forEach(entry => {
        const row = document.createElement('tr');
        
        // Date
        const tdDate = document.createElement('td');
        tdDate.textContent = entry.date;
        row.appendChild(tdDate);
        
        // Point de vente
        const tdPointVente = document.createElement('td');
        tdPointVente.textContent = entry.pointVente;
        row.appendChild(tdPointVente);
        
        // Ventes théoriques
        const tdVentesTheoriques = document.createElement('td');
        tdVentesTheoriques.textContent = formatMonetaire(entry.ventesTheoriques);
        row.appendChild(tdVentesTheoriques);
        
        // Ventes saisies
        const tdVentesSaisies = document.createElement('td');
        tdVentesSaisies.textContent = formatMonetaire(entry.ventesSaisies);
        row.appendChild(tdVentesSaisies);
        
        // Versements
        const tdVersements = document.createElement('td');
        tdVersements.textContent = formatMonetaire(entry.versements);
        row.appendChild(tdVersements);
        
        // Écart
        const tdEcart = document.createElement('td');
        const ecart = entry.ventesSaisies - entry.ventesTheoriques;
        tdEcart.textContent = formatMonetaire(ecart);
        tdEcart.className = ecart >= 0 ? 'text-success' : 'text-danger';
        row.appendChild(tdEcart);
        
        // Pourcentage d'écart
        const tdPourcentage = document.createElement('td');
        const pourcentage = entry.ventesTheoriques > 0 ? (ecart / entry.ventesTheoriques) * 100 : 0;
        tdPourcentage.textContent = `${pourcentage.toFixed(2)}%`;
        tdPourcentage.className = Math.abs(pourcentage) <= 5 ? 'text-success' : 
                                 Math.abs(pourcentage) <= 10 ? 'text-warning' : 'text-danger';
        row.appendChild(tdPourcentage);
        
        // Estimation
        const tdEstimation = document.createElement('td');
        tdEstimation.textContent = formatMonetaire(entry.estimation);
        row.appendChild(tdEstimation);
        
        // Écart estimation
        const tdEcartEstimation = document.createElement('td');
        const ecartEstimation = entry.versements - entry.estimation;
        tdEcartEstimation.textContent = formatMonetaire(ecartEstimation);
        tdEcartEstimation.className = Math.abs(ecartEstimation) <= 10000 ? 'text-success' : 
                                     Math.abs(ecartEstimation) <= 50000 ? 'text-warning' : 'text-danger';
        row.appendChild(tdEcartEstimation);
        
        // Commentaires
        const tdCommentaires = document.createElement('td');
        tdCommentaires.textContent = entry.commentaires || '';
        row.appendChild(tdCommentaires);
        
        // Actions
        const tdActions = document.createElement('td');
        const btnDetails = document.createElement('button');
        btnDetails.className = 'btn btn-sm btn-outline-primary';
        btnDetails.textContent = 'Détails';
        btnDetails.onclick = () => naviguerVersReconciliation(entry.date);
        tdActions.appendChild(btnDetails);
        row.appendChild(tdActions);
        
        tableBody.appendChild(row);
    });
}

/**
 * Charge les commentaires pour la réconciliation mensuelle
 */
async function chargerCommentairesMensuels() {
    console.log('Chargement des commentaires pour la réconciliation mensuelle');
    
    const mois = document.getElementById('mois-reconciliation').value;
    const annee = document.getElementById('annee-reconciliation').value;
    
    // Afficher l'indicateur de chargement
    const loadingIndicator = document.getElementById('loading-indicator-reconciliation-mois');
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    
    try {
        // Récupérer les commentaires pour chaque jour du mois
        const commentaires = {};
        
        // Déterminer le nombre de jours dans le mois
        const dernierJour = new Date(parseInt(annee), parseInt(mois), 0).getDate();
        
        // Pour chaque jour du mois, récupérer les commentaires
        for (let jour = 1; jour <= dernierJour; jour++) {
            const dateStr = `${jour.toString().padStart(2, '0')}/${mois}/${annee}`;
            
            try {
                // Charger les commentaires pour cette date
                const response = await fetch(`reconciliation/commentaires_${dateStr}.json`);
                if (response.ok) {
                    const data = await response.json();
                    commentaires[dateStr] = data;
                }
            } catch (error) {
                console.log(`Pas de commentaires pour ${dateStr}`);
            }
        }
        
        // Mettre à jour les commentaires dans le tableau
        const rows = document.querySelectorAll('#reconciliation-mois-table tbody tr');
        rows.forEach(row => {
            const date = row.cells[0].textContent;
            const pointVente = row.cells[1].textContent;
            
            if (commentaires[date] && commentaires[date][pointVente]) {
                const commentaireInput = row.querySelector(`input[data-date="${date}"][data-point-vente="${pointVente}"]`);
                if (commentaireInput) {
                    commentaireInput.value = commentaires[date][pointVente].commentaire || '';
                }
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des commentaires mensuels:', error);
        alert('Une erreur est survenue lors du chargement des commentaires');
    } finally {
        // Masquer l'indicateur de chargement
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

// Fonction pour afficher une section spécifique
function showSection(sectionId) {
    hideAllSections();
    document.getElementById(sectionId).style.display = 'block';
    
    // Désactiver tous les onglets
    const tabs = document.querySelectorAll('.nav-link');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Activer l'onglet correspondant
    const tabId = sectionId.replace('-section', '-tab');
    const tab = document.getElementById(tabId);
    if (tab) {
        tab.classList.add('active');
    }
    
    // Keep content-section elements hidden when showing saisie section
    if (sectionId === 'saisie-section') {
        console.log('Showing saisie section - hiding content-section elements');
        const contentSections = document.querySelectorAll('.content-section');
        console.log(`Found ${contentSections.length} content-section elements to hide`);
        contentSections.forEach(el => {
            console.log(`Hiding element: ${el.id}`);
            el.style.display = 'none';
        });
    }
    
    // Initialiser la section selon son type
    if (sectionId === 'reconciliation-section') {
        initReconciliation();
    } else if (sectionId === 'reconciliation-mois-section') {
        initReconciliationMensuelle();
    } else if (sectionId === 'visualisation-section') {
        chargerVentes();
    } else if (sectionId === 'stock-inventaire-section') {
        initInventaire();
    } else if (sectionId === 'stock-alerte-section') {
        initStockAlerte();
    } else if (sectionId === 'copier-stock-section') {
        initCopierStock();
    }
    // Add condition for the new section
    else if (sectionId === 'suivi-achat-boeuf-section') {
        if (typeof initSuiviAchatBoeuf === 'function') {
            initSuiviAchatBoeuf();
        } else {
            console.error('initSuiviAchatBoeuf function not found when showing section!');
        }
    }
}


window.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Loaded - Adding button...');
    
    // Définir les prix par défaut acceptables
    const PRIX_DEFAUT_RANGES = {
        'Boeuf': [3400, 3500, 3600, 3700, 3800, 3900],
        'Veau': [3500, 3600, 3700, 3800, 3900]
    };

    // Fonction pour vérifier si un prix est considéré comme "par défaut"
    function isPrixDefaut(produit, prix) {
        const prixNum = parseFloat(prix) || 0;
        const validPrices = PRIX_DEFAUT_RANGES[produit];
        return !prix || prixNum === 0 || (validPrices && validPrices.includes(prixNum));
    }
    
    // Add the button only if not already present
    if (!document.getElementById('btn-prix-pondere')) {
        const btn = document.createElement('button');
        btn.id = 'btn-prix-pondere';
        btn.className = 'btn btn-info mb-2';
        btn.textContent = 'Remplir Prix Moyen Pondéré (Boeuf/Veau)';
        
         // Style pour aligner à droite
         btn.style.cssText = `
         margin: 10px;
         float: right;
         margin-right: 20px;
     `;
        
        // Try multiple locations to insert the button
        const stockSection = document.getElementById('stock-inventaire-section');
        const stockTable = document.getElementById('stock-table');
        
        if (stockSection) {
            stockSection.insertBefore(btn, stockSection.firstChild);
            console.log('Button added to stock section');
        } else if (stockTable && stockTable.parentElement) {
            stockTable.parentElement.insertBefore(btn, stockTable);
            console.log('Button added before stock table');
        } else {
            // Fallback: add to the top of the page
            document.body.insertBefore(btn, document.body.firstChild);
            console.log('Button added to body');
        }
        
        console.log('Button "Remplir Prix Moyen Pondéré" has been added!');
    }

    // Add click event listener
    setTimeout(function() {
        const button = document.getElementById('btn-prix-pondere');
        if (button) {
            button.addEventListener('click', async function() {
                const typeStock = document.getElementById('type-stock') ? document.getElementById('type-stock').value : '';
                const date = document.getElementById('date-inventaire') ? document.getElementById('date-inventaire').value : '';

                console.log('=== DEBUG: Button clicked ===');
                console.log('typeStock:', typeStock);
                console.log('date:', date);
                console.log('PRIX_DEFAUT_RANGES:', PRIX_DEFAUT_RANGES);

                // --- STOCK TABLE ---
                const stockRows = Array.from(document.querySelectorAll('#stock-table tbody tr'));
                console.log('Stock rows found:', stockRows.length);
                
                for (const row of stockRows) {
                    const produitSelect = row.querySelector('.produit-select');
                    const pointVenteSelect = row.querySelector('.point-vente-select');
                    const prixInput = row.querySelector('.prix-unitaire-input');
                    
                    if (!produitSelect || !pointVenteSelect || !prixInput) {
                        console.log('Missing elements in row, skipping');
                        continue;
                    }
                    
                    const produit = produitSelect.value;
                    const pointVente = pointVenteSelect.value;
                    
                    console.log('=== Row Debug ===');
                    console.log('Produit:', produit);
                    console.log('Point de Vente:', pointVente);
                    console.log('Prix Input Value:', prixInput.value);
                    console.log('Is Boeuf or Veau?', (produit === 'Boeuf' || produit === 'Veau'));
                    console.log('Is prix défaut?', isPrixDefaut(produit, prixInput.value));
                    
                    if ((produit === 'Boeuf' || produit === 'Veau')) {
                        console.log('*** MAKING API CALL FOR:', produit);
                        try {
                            if (typeStock === 'matin' || typeStock === 'soir') {
                                const url = `/api/prix-moyen?type=${encodeURIComponent(produit.toLowerCase())}&date=${encodeURIComponent(date)}&pointVente=${encodeURIComponent(pointVente)}`;
                                console.log('API URL:', url);
                                const response = await fetch(url);
                                console.log('API Response status:', response.status);
                                if (!response.ok) throw new Error('API error: ' + response.status);
                                const data = await response.json();
                                console.log('API Response:', data);
                                if (data.success && Array.isArray(data.data) && data.data.length > 0) {
                                    // Activer temporairement le champ s'il est désactivé
                                    const wasDisabled = prixInput.disabled;
                                    if (wasDisabled) {
                                        prixInput.disabled = false;
                                    }
                                    
                                    prixInput.value = parseFloat(data.data[0].prix_moyen_pondere);
                                    console.log('Updated price to:', prixInput.value);
                                    // Trigger change event to update totals
                                    prixInput.dispatchEvent(new Event('input', { bubbles: true }));
                                    
                                    // Redésactiver le champ s'il était désactivé
                                    if (wasDisabled) {
                                        prixInput.disabled = true;
                                    }
                                } else {
                                    // Fallback to default if no data
                                    const fallbackPrice = (typeof PRIX_DEFAUT !== 'undefined' && PRIX_DEFAUT[produit]) ? PRIX_DEFAUT[produit] : (PRIX_DEFAUT_RANGES[produit] ? PRIX_DEFAUT_RANGES[produit][3] : 0);
                                    
                                    // Activer temporairement le champ s'il est désactivé
                                    const wasDisabled = prixInput.disabled;
                                    if (wasDisabled) {
                                        prixInput.disabled = false;
                                    }
                                    
                                    prixInput.value = fallbackPrice;
                                    console.log('Stock - No data, using fallback:', fallbackPrice);
                                    
                                    // Redésactiver le champ s'il était désactivé
                                    if (wasDisabled) {
                                        prixInput.disabled = true;
                                    }
                                    prixInput.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            }
                        } catch (err) {
                            console.error('Erreur lors de la récupération du prix moyen (stock):', err);
                            // Use fallback on error
                            const fallbackPrice = (typeof PRIX_DEFAUT !== 'undefined' && PRIX_DEFAUT[produit]) ? PRIX_DEFAUT[produit] : (PRIX_DEFAUT_RANGES[produit] ? PRIX_DEFAUT_RANGES[produit][3] : 0);
                            prixInput.value = fallbackPrice;
                            console.log('Stock - Error, using fallback:', fallbackPrice);
                            prixInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    } else {
                        console.log('*** SKIPPING ROW - conditions not met');
                    }
                }

                // --- TRANSFERT TABLE ---
                const transfertRows = Array.from(document.querySelectorAll('#transfertTable tbody tr'));
                console.log('Transfert rows found:', transfertRows.length);
                
                for (const row of transfertRows) {
                    const produitSelect = row.querySelector('.produit-select');
                    const prixInput = row.querySelector('.prix-unitaire-input');
                    
                    if (!produitSelect || !prixInput) {
                        console.log('Missing elements in transfert row, skipping');
                        continue;
                    }
                    
                    const produit = produitSelect.value;
                    console.log('Transfert - Produit:', produit, 'Prix:', prixInput.value);
                    
                    // For transfert: Only check if it's Boeuf or Veau (no strict price condition)
                    if (produit === 'Boeuf' || produit === 'Veau') {
                        console.log('*** MAKING TRANSFERT API CALL FOR:', produit);
                        try {
                            // TRANSFERT: Call API without pointVente parameter
                            const url = `/api/prix-moyen?type=${encodeURIComponent(produit.toLowerCase())}&date=${encodeURIComponent(date)}`;
                            console.log('Transfert API URL:', url);
                            const response = await fetch(url);
                            console.log('Transfert API Response status:', response.status);
                            if (!response.ok) throw new Error('API error: ' + response.status);
                            const data = await response.json();
                            console.log('Transfert API Response:', data);
                            if (data.success && Array.isArray(data.data) && data.data.length > 0) {
                                prixInput.value = parseFloat(data.data[0].prix_moyen_pondere);
                                console.log('Transfert - Updated price to:', prixInput.value);
                                // Trigger change event to update totals
                                prixInput.dispatchEvent(new Event('input', { bubbles: true }));
                            } else {
                                // Fallback to default if no data
                                const defaultPrice = (typeof PRIX_DEFAUT !== 'undefined' && PRIX_DEFAUT[produit]) ? PRIX_DEFAUT[produit] : (PRIX_DEFAUT_RANGES[produit] ? PRIX_DEFAUT_RANGES[produit][3] : 0);
                                prixInput.value = defaultPrice;
                                console.log('Transfert - No data, using fallback:', defaultPrice);
                                prixInput.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        } catch (err) {
                            console.error('Erreur lors de la récupération du prix moyen (transfert):', err);
                            // Use fallback on error
                            const defaultPrice = (typeof PRIX_DEFAUT !== 'undefined' && PRIX_DEFAUT[produit]) ? PRIX_DEFAUT[produit] : (PRIX_DEFAUT_RANGES[produit] ? PRIX_DEFAUT_RANGES[produit][3] : 0);
                            prixInput.value = defaultPrice;
                            console.log('Transfert - Error, using fallback:', defaultPrice);
                            prixInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    } else {
                        console.log('*** SKIPPING TRANSFERT ROW - not Boeuf/Veau');
                    }
                }

                alert('Prix moyen pondéré appliqué (si disponible) pour Boeuf/Veau dans Stock et Transfert.');
            });
            console.log('Click event listener added to button');
        } else {
            console.error('Button not found after creation!');
        }
    }, 100);
});

// Function to export visualization/ventes data to Excel
async function exportVisualisationToExcel() {
    try {
        // Check if XLSX library is loaded
        if (typeof XLSX === 'undefined') {
            console.error("Erreur: La bibliothèque XLSX n'est pas chargée.");
            alert("Erreur: La bibliothèque XLSX n'est pas chargée. Veuillez rafraîchir la page.");
            return;
        }

        // Show loading indicator
        const loadingHtml = `
            <div id="export-loading" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                 background: white; padding: 20px; border: 2px solid #007bff; border-radius: 8px; z-index: 1000; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Chargement...</span>
                    </div>
                    <p class="mt-2 mb-0">Export de toutes les données en cours...</p>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', loadingHtml);

        // Get current filter parameters
        const dateDebut = document.getElementById('date-debut').value;
        const dateFin = document.getElementById('date-fin').value;
        const pointVente = document.getElementById('point-vente-select').value;

        console.log('Export avec les paramètres:', { dateDebut, dateFin, pointVente });

        // Convert dates to API format
        const formatDateForApi = (dateStr, isEndDate = false) => {
            if (!dateStr) return '';
            const [jour, mois, annee] = dateStr.split('/');
            
            // Formater directement au format YYYY-MM-DD sans passer par toISOString()
            let year = parseInt(annee);
            let month = parseInt(mois);
            let day = parseInt(jour);
            
            // Ne pas ajouter de jour supplémentaire pour la date de fin
            // La logique de filtrage côté serveur gère déjà correctement les limites
            
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        };

        const debut = formatDateForApi(dateDebut);
        const fin = formatDateForApi(dateFin);

        // Fetch all data from API (not just current page)
        const response = await fetch(`/api/ventes?dateDebut=${debut}&dateFin=${fin}&pointVente=${pointVente}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Erreur lors de la récupération des données');
        }

        // Format the data for export
        const exportData = data.ventes.map(vente => ({
            'Mois': vente.Mois || vente.mois || '',
            'Date': vente.Date || vente.date || '',
            'Semaine': vente.Semaine || vente.semaine || '',
            'Point de Vente': vente['Point de Vente'] || vente.pointVente || '',
            'Préparation': vente.Preparation || vente.preparation || vente['Point de Vente'] || vente.pointVente || '',
            'Catégorie': formatCategorie(vente.Catégorie || vente.categorie || ''),
            'Produit': vente.Produit || vente.produit || '',
            'Prix Unitaire': parseFloat(vente.PU || vente.prixUnit || 0),
            'Quantité': parseFloat(vente.Nombre || vente.quantite || 0),
            'Montant': parseFloat(vente.Montant || vente.total || 0),
            'Nom Client': vente.nomClient || '',
            'Numéro Client': vente.numeroClient || '',
            'Adresse Client': vente.adresseClient || '',
            'Créance': vente.creance ? 'Oui' : 'Non'
        }));

        if (exportData.length === 0) {
            // Remove loading indicator
            const loadingElement = document.getElementById('export-loading');
            if (loadingElement) {
                loadingElement.remove();
            }
            alert('Aucune donnée à exporter pour les critères sélectionnés');
            return;
        }

        // Get headers from the first data row
        const headers = Object.keys(exportData[0]);

        // Create workbook and worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);

        // Format currency columns
        const currencyFormat = '#,##0 FCFA';
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            // Prix Unitaire, Montant columns
            const prixUnitaireCol = headers.indexOf('Prix Unitaire');
            const montantCol = headers.indexOf('Montant');
            const quantiteCol = headers.indexOf('Quantité');
            
            [prixUnitaireCol, montantCol].forEach(C => {
                if (C >= 0) {
                    const cell_address = { c: C, r: R };
                    const cell_ref = XLSX.utils.encode_cell(cell_address);
                    if (worksheet[cell_ref] && typeof worksheet[cell_ref].v === 'number') {
                        worksheet[cell_ref].t = 'n';
                        worksheet[cell_ref].z = currencyFormat;
                    }
                }
            });
            
            // Format quantity column
            if (quantiteCol >= 0) {
                const qty_cell_address = { c: quantiteCol, r: R };
                const qty_cell_ref = XLSX.utils.encode_cell(qty_cell_address);
                if (worksheet[qty_cell_ref] && typeof worksheet[qty_cell_ref].v === 'number') {
                    worksheet[qty_cell_ref].t = 'n';
                }
            }
        }

        // Set column widths
        const colWidths = headers.map(header => {
            switch (header) {
                case 'Date': return { wch: 12 };
                case 'Point de Vente': case 'Préparation': return { wch: 15 };
                case 'Produit': return { wch: 18 };
                case 'Catégorie': return { wch: 12 };
                case 'Prix Unitaire': case 'Montant': return { wch: 15 };
                case 'Nom Client': case 'Adresse Client': return { wch: 20 };
                case 'Numéro Client': return { wch: 15 };
                default: return { wch: 10 };
            }
        });
        worksheet['!cols'] = colWidths;

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Tableau des Ventes');

        // Generate filename with current date and filter info
        const currentDate = new Date();
        const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        let filename = `Tableau_Ventes_${dateStr}`;
        
        // Add filter information to filename if filters are applied
        if (dateDebut || dateFin || (pointVente && pointVente !== 'tous')) {
            filename += '_';
            if (dateDebut && dateFin) {
                filename += `${dateDebut.replace(/\//g, '-')}_${dateFin.replace(/\//g, '-')}`;
            } else if (dateDebut) {
                filename += `depuis_${dateDebut.replace(/\//g, '-')}`;
            } else if (dateFin) {
                filename += `jusqu_${dateFin.replace(/\//g, '-')}`;
            }
            if (pointVente && pointVente !== 'tous') {
                filename += `_${pointVente}`;
            }
        }
        filename += '.xlsx';

        // Save the file
        XLSX.writeFile(workbook, filename);

        // Remove loading indicator
        const loadingElement = document.getElementById('export-loading');
        if (loadingElement) {
            loadingElement.remove();
        }

        // Calculate total amount for summary
        const totalAmount = exportData.reduce((sum, vente) => sum + (parseFloat(vente['Montant']) || 0), 0);
        const totalQuantity = exportData.reduce((sum, vente) => sum + (parseFloat(vente['Quantité']) || 0), 0);

        alert(`Export Excel réussi !\n\nDonnées exportées: ${exportData.length} entrées\nMontant total: ${totalAmount.toLocaleString('fr-FR')} FCFA\nQuantité totale: ${totalQuantity.toLocaleString('fr-FR')}\nFichier: ${filename}`);

    } catch (error) {
        console.error('Erreur lors de l\'export Excel visualization:', error);
        
        // Remove loading indicator in case of error
        const loadingElement = document.getElementById('export-loading');
        if (loadingElement) {
            loadingElement.remove();
        }
        
        alert('Erreur lors de l\'export Excel : ' + error.message);
    }
}

// Function to export monthly reconciliation data to Excel
async function exportReconciliationMoisToExcel() {
    try {
        // Check if XLSX library is loaded
        if (typeof XLSX === 'undefined') {
            console.error("Erreur: La bibliothèque XLSX n'est pas chargée.");
            alert("Erreur: La bibliothèque XLSX n'est pas chargée. Veuillez rafraîchir la page.");
            return;
        }

        // Show loading indicator
        const loadingHtml = `
            <div id="export-loading" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                 background: white; padding: 20px; border: 2px solid #007bff; border-radius: 8px; z-index: 1000; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Chargement...</span>
                    </div>
                    <p class="mt-2 mb-0">Export de la réconciliation mensuelle en cours...</p>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', loadingHtml);

        // Get current month and year
        const moisSelect = document.getElementById('mois-reconciliation');
        const anneeSelect = document.getElementById('annee-reconciliation');
        
        if (!moisSelect || !anneeSelect) {
            throw new Error('Sélecteurs de mois/année non trouvés');
        }

        const mois = moisSelect.value;
        const annee = anneeSelect.value;

        if (!mois) {
            throw new Error('Aucun mois sélectionné');
        }

        console.log(`Export de la réconciliation pour ${mois}/${annee}`);

        // Recalculate all data for the month to ensure we have complete data
        const anneeNum = parseInt(annee);
        const moisNum = parseInt(mois);
        const totalDaysInMonth = new Date(anneeNum, moisNum, 0).getDate();
        
        // Récupérer toutes les données de paiement en espèces pour le mois en une seule fois
        let allCashPayments = {};
        try {
            const cashResponse = await fetch(`/api/cash-payments/aggregated`, { 
                method: 'GET', 
                credentials: 'include' 
            });
            
            if (cashResponse.ok) {
                const cashData = await cashResponse.json();
                
                if (cashData.success && cashData.data && Array.isArray(cashData.data)) {
                    // Filtrer les données pour le mois en cours
                    cashData.data.forEach(entry => {
                        if (entry.date) {
                            const parts = entry.date.split('-');
                            if (parts.length === 3) {
                                const entryYear = parseInt(parts[0]);
                                const entryMonth = parseInt(parts[1]);
                                const entryDay = parseInt(parts[2]);
                                if (entryMonth === moisNum && entryYear === anneeNum) {
                                    const formattedDate = `${entryDay.toString().padStart(2, '0')}/${entryMonth.toString().padStart(2, '0')}/${entryYear}`;
                                    allCashPayments[formattedDate] = {};
                                    if (entry.points && Array.isArray(entry.points)) {
                                        entry.points.forEach(point => {
                                            allCashPayments[formattedDate][point.point] = parseFloat(point.total) || 0;
                                        });
                                    }
                                }
                            }
                        }
                    });
                }
            }
        } catch (error) {
            console.error(`Erreur lors de la récupération des paiements en espèces pour le mois:`, error);
        }

        const exportData = [];
        let totalVentesTheoriques = 0;
        let totalVentesSaisies = 0;
        let totalVersements = 0;

        // Process each day of the month
        for (let jour = 1; jour <= totalDaysInMonth; jour++) {
            const dateStr = `${jour.toString().padStart(2, '0')}/${mois}/${annee}`;
            
            try {
                // Fetch data for this day
                const [stockMatin, stockSoir, transferts, ventesData] = await Promise.all([
                    getStockForDate(dateStr, 'matin'),
                    getStockForDate(dateStr, 'soir'),
                    getTransfersForDate(dateStr),
                    fetch(`/api/ventes-date?date=${dateStr}`, { method: 'GET', credentials: 'include' }).then(res => res.ok ? res.json() : { success: false })
                ]);

                const ventesSaisies = ventesData.success && ventesData.totaux ? ventesData.totaux : {};
                
                // Calculer les créances par point de vente
                const creancesParPV = {};
                if (ventesData.success && ventesData.ventes && Array.isArray(ventesData.ventes)) {
                    ventesData.ventes.forEach(vente => {
                        const pv = vente['Point de Vente'];
                        if (vente.creance === true || vente.creance === 'true' || vente.Creance === true || vente.Creance === 'true') {
                            if (!creancesParPV[pv]) {
                                creancesParPV[pv] = 0;
                            }
                            creancesParPV[pv] += parseFloat(vente.Montant || 0);
                        }
                    });
                }

                // DEBUG: Log the data received
                console.log(`=== DEBUG pour ${dateStr} ===`);
                console.log('Stock Matin reçu:', stockMatin);
                console.log('Stock Soir reçu:', stockSoir);
                console.log('Transferts reçus:', transferts);
                console.log('Ventes saisies reçues:', ventesSaisies);

                // Check if any data exists for this date
                const dayHasData =
                    Object.keys(stockMatin).length > 0 ||
                    Object.keys(stockSoir).length > 0 ||
                    transferts.length > 0 ||
                    Object.keys(ventesSaisies).length > 0;

                if (!dayHasData) {
                    continue; // Skip this day if no data
                }

                // Calculate reconciliation for each point of sale
                const dailyReconciliation = {};
                
                                // Process each point of sale
                for (const pointVente of POINTS_VENTE_PHYSIQUES) {
                    // Calculate stock values by summing all products for this point de vente
                    const stockMatinKeys = Object.keys(stockMatin).filter(key => key.startsWith(pointVente + '-'));
                    const stockMatinValue = stockMatinKeys.reduce((sum, key) => {
                        const stockData = stockMatin[key];
                        const montant = parseFloat(stockData.Montant || stockData.total || 0);
                        return sum + montant;
                    }, 0);
                    
                    const stockSoirKeys = Object.keys(stockSoir).filter(key => key.startsWith(pointVente + '-'));
                    const stockSoirValue = stockSoirKeys.reduce((sum, key) => {
                        const stockData = stockSoir[key];
                        const montant = parseFloat(stockData.Montant || stockData.total || 0);
                        return sum + montant;
                    }, 0);
                    
                    const transfertsValue = transferts
                        .filter(t => t.pointVente === pointVente)
                        .reduce((sum, t) => sum + (parseFloat(t.total || t.montant || 0)), 0);
                    const ventesSaisiesValue = ventesSaisies[pointVente] || 0;

                    // DEBUG: Log calculations for this point de vente
                    console.log(`--- ${pointVente} ---`);
                    console.log('Clés stock matin trouvées:', stockMatinKeys);
                    console.log('Clés stock soir trouvées:', stockSoirKeys);
                    
                    // DEBUG: Log the actual structure of stock data
                    if (stockMatinKeys.length > 0) {
                        console.log('Structure stock matin:', stockMatin[stockMatinKeys[0]]);
                    }
                    if (stockSoirKeys.length > 0) {
                        console.log('Structure stock soir:', stockSoir[stockSoirKeys[0]]);
                    }
                    
                    console.log('Stock Matin calculé:', stockMatinValue);
                    console.log('Stock Soir calculé:', stockSoirValue);
                    console.log('Transferts calculés:', transfertsValue);
                    console.log('Ventes saisies:', ventesSaisiesValue);

                    // Calculate theoretical sales
                    const ventesTheoriques = stockMatinValue + transfertsValue - stockSoirValue;

                    // Calculate difference
                    const difference = ventesTheoriques - ventesSaisiesValue;

                    // Calculate percentage difference
                    let pourcentageEcart;
                    if (pointVente === 'Abattage') {
                        // Pour Abattage : (Ventes Théoriques / Stock Matin) * 100
                        if (stockMatinValue > 0) {
                            pourcentageEcart = (ventesTheoriques / stockMatinValue) * 100;
                        } else {
                            // Cas où le stock matin est nul - pas de calcul possible
                            pourcentageEcart = null;
                        }
                    } else {
                        // Pour les autres points de vente : (Écart / Ventes Théoriques) * 100
                        pourcentageEcart = ventesTheoriques > 0 ? (difference / ventesTheoriques) * 100 : 0;
                    }

                    // Get cash payment data from pre-loaded data
                    const cashPayment = allCashPayments[dateStr] && allCashPayments[dateStr][pointVente] ? allCashPayments[dateStr][pointVente] : 0;

                    // Calculate cash difference
                    const ecartCash = cashPayment - ventesSaisiesValue;

                    dailyReconciliation[pointVente] = {
                        stockMatin: stockMatinValue,
                        stockSoir: stockSoirValue,
                        transferts: transfertsValue,
                        ventes: ventesTheoriques,
                        ventesSaisies: ventesSaisiesValue,
                        creances: creancesParPV[pointVente] || 0,
                        difference: difference,
                        cashPayment: cashPayment,
                        pourcentageEcart: pourcentageEcart,
                        ecartCash: ecartCash,
                        commentaire: '' // You can implement comment loading if needed
                    };

                    // Accumulate totals
                    totalVentesTheoriques += ventesTheoriques;
                    totalVentesSaisies += ventesSaisiesValue;
                    totalVersements += cashPayment;
                }

                // Add data to export array
                Object.keys(dailyReconciliation).forEach(pointVente => {
                    const data = dailyReconciliation[pointVente];
                    exportData.push({
                        'Date': dateStr,
                        'Point de Vente': pointVente,
                        'Stock Matin': data.stockMatin,
                        'Stock Soir': data.stockSoir,
                        'Transferts': data.transferts,
                        'Ventes Théoriques': data.ventes,
                        'Ventes Saisies': data.ventesSaisies,
                        'Créances': data.creances || 0,
                        'Écart': data.difference,
                        'Montant Total Cash': data.cashPayment,
                        'Écart %': data.pourcentageEcart,
                        'Écart Cash': data.ecartCash,
                        'Commentaire': data.commentaire
                    });
                });

            } catch (error) {
                console.error(`Erreur lors du traitement du jour ${dateStr}:`, error);
                continue; // Skip this day if there's an error
            }
        }

        if (exportData.length === 0) {
            // Remove loading indicator
            const loadingElement = document.getElementById('export-loading');
            if (loadingElement) {
                loadingElement.remove();
            }
            alert('Aucune donnée à exporter pour ce mois');
            return;
        }

        // Create workbook and worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);

        // Format currency and percentage columns
        const currencyFormat = '#,##0 FCFA';
        const percentageFormat = '0.00%';
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            const headers = Object.keys(exportData[0]);
            headers.forEach((header, C) => {
                const cell_address = { c: C, r: R };
                const cell_ref = XLSX.utils.encode_cell(cell_address);
                
                if (worksheet[cell_ref] && typeof worksheet[cell_ref].v === 'number') {
                    if (header.includes('Stock') || header.includes('Transfert') || 
                        header.includes('Vente') || header.includes('Montant') || 
                        header.includes('Cash') || header.includes('Ecart') || 
                        header.includes('Créances')) {
                        
                        if (header.includes('%') || header.includes('Écart %')) {
                            worksheet[cell_ref].t = 'n';
                            worksheet[cell_ref].z = percentageFormat;
                            // Convert percentage value back to decimal for Excel
                            worksheet[cell_ref].v = worksheet[cell_ref].v / 100;
                        } else {
                            worksheet[cell_ref].t = 'n';
                            worksheet[cell_ref].z = currencyFormat;
                        }
                    }
                }
            });
        }

        // Set column widths
        const headers = Object.keys(exportData[0]);
        const colWidths = headers.map(header => {
            switch (true) {
                case header === 'Date': return { wch: 12 };
                case header === 'Point de Vente': return { wch: 15 };
                case header.includes('Stock') || header.includes('Vente') || header.includes('Cash'): return { wch: 15 };
                case header === 'Commentaire': return { wch: 30 };
                case header.includes('Écart'): return { wch: 12 };
                default: return { wch: 12 };
            }
        });
        worksheet['!cols'] = colWidths;

        // Add summary data
        const summaryData = [
            {},
            { [headers[0]]: 'RÉSUMÉ DU MOIS', [headers[1]]: `${mois}/${annee}` },
            { [headers[0]]: 'Total Ventes Théoriques:', [headers[1]]: totalVentesTheoriques },
            { [headers[0]]: 'Total Ventes Saisies:', [headers[1]]: totalVentesSaisies },
            { [headers[0]]: 'Total Versements:', [headers[1]]: totalVersements }
        ];

        // Add summary to export data
        exportData.push(...summaryData);

        // Recreate worksheet with summary data
        const finalWorksheet = XLSX.utils.json_to_sheet(exportData);
        
        // Reapply formatting
        const finalRange = XLSX.utils.decode_range(finalWorksheet['!ref']);
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            headers.forEach((header, C) => {
                const cell_address = { c: C, r: R };
                const cell_ref = XLSX.utils.encode_cell(cell_address);
                
                if (finalWorksheet[cell_ref] && typeof finalWorksheet[cell_ref].v === 'number') {
                    if (header.includes('Stock') || header.includes('Transfert') || 
                        header.includes('Vente') || header.includes('Montant') || 
                        header.includes('Cash') || header.includes('Écart')) {
                        
                        if (header.includes('%') || header.includes('Écart %')) {
                            finalWorksheet[cell_ref].t = 'n';
                            finalWorksheet[cell_ref].z = percentageFormat;
                            finalWorksheet[cell_ref].v = finalWorksheet[cell_ref].v / 100;
                        } else {
                            finalWorksheet[cell_ref].t = 'n';
                            finalWorksheet[cell_ref].z = currencyFormat;
                        }
                    }
                }
            });
        }
        
        finalWorksheet['!cols'] = colWidths;

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, finalWorksheet, 'Réconciliation Mensuelle');

        // Generate filename
        const filename = `Reconciliation_Mensuelle_${mois}_${annee}.xlsx`;

        // Save the file
        XLSX.writeFile(workbook, filename);

        // Remove loading indicator
        const loadingElement = document.getElementById('export-loading');
        if (loadingElement) {
            loadingElement.remove();
        }

        // Calculate processed rows (excluding summary rows)
        const processedRows = exportData.length - summaryData.length;

        alert(`Export Excel réussi !\n\nDonnées exportées: ${processedRows} entrées pour ${mois}/${annee}\nFichier: ${filename}`);

    } catch (error) {
        console.error('Erreur lors de l\'export Excel réconciliation mensuelle:', error);
        
        // Remove loading indicator in case of error
        const loadingElement = document.getElementById('export-loading');
        if (loadingElement) {
            loadingElement.remove();
        }
        
        alert('Erreur lors de l\'export Excel : ' + error.message);
    }
}

// ================================
// UTILITAIRES POUR DISTINCTION VISUELLE
// ================================

// Fonction utilitaire pour appliquer la distinction visuelle aux ventes provenant de pré-commandes
function appliquerDistinctionVisuellePrecommande(row, vente) {
    if (vente.adresseClient && vente.adresseClient.includes('Provenant de pré-commande')) {
        row.style.backgroundColor = '#e3f2fd'; // Bleu clair
        row.style.borderLeft = '4px solid #2196f3'; // Bordure bleue
        row.title = 'Cette vente provient d\'une pré-commande convertie'; // Tooltip
        
        // Ajouter une classe CSS pour un style plus cohérent
        row.classList.add('vente-precommande');
    }
}

// ================================
// GESTION DES PRÉ-COMMANDES CLIENTS
// ================================

// Variables globales pour les pré-commandes
let currentPrecommandes = [];
let currentPrecommandePage = 1;
let precommandesPerPage = 20; // Nombre de pré-commandes par page

// Initialisation des dropdowns pour les pré-commandes
async function initPrecommandeDropdowns() {
    console.log('Initialisation des dropdowns pré-commandes');
    
    // Populer les points de vente
    await populatePrecommandePointVenteDropdown();
    
    // Populer les catégories
    populatePrecommandeCategoriesForEntry();
    
    // Charger les labels existants pour l'autocomplétion
    await loadPrecommandeLabelsForAutocomplete();
    
    // Charger les labels pour le filtre
    await populatePrecommandeFilterLabelsDropdown();
    
    // Attacher les événements pour le filtre de statut collapsible
    attachStatutFilterEvents();
    
    // Charger les pré-commandes existantes
    await chargerPrecommandes();
}

// Attacher les événements pour le filtre de statut collapsible
function attachStatutFilterEvents() {
    console.log('Attachement des événements pour le filtre de statut');
    
    // Événement pour le bouton toggle
    const statutToggleBtn = document.getElementById('statut-filter-toggle');
    if (statutToggleBtn) {
        // Supprimer les anciens événements s'ils existent
        statutToggleBtn.removeEventListener('click', toggleStatutFilter);
        statutToggleBtn.addEventListener('click', toggleStatutFilter);
        console.log('Événement toggle attaché');
    }
    
    // Événements pour les checkboxes
    const statutCheckboxes = document.querySelectorAll('.statut-checkboxes input[type="checkbox"]');
    statutCheckboxes.forEach(checkbox => {
        checkbox.removeEventListener('change', updateStatutFilterLabel);
        checkbox.addEventListener('change', updateStatutFilterLabel);
    });
    console.log('Événements checkboxes attachés:', statutCheckboxes.length);
    
    // Événements pour les autres filtres (filtrage automatique)
    const dateDebutInput = document.getElementById('filter-precommande-date-debut');
    const dateFinInput = document.getElementById('filter-precommande-date-fin');
    const pointVenteSelect = document.getElementById('filter-precommande-point-vente');
    const labelSelect = document.getElementById('filter-precommande-label');
    
    if (dateDebutInput) {
        dateDebutInput.addEventListener('change', filtrerPrecommandes);
    }
    if (dateFinInput) {
        dateFinInput.addEventListener('change', filtrerPrecommandes);
    }
    if (pointVenteSelect) {
        pointVenteSelect.addEventListener('change', filtrerPrecommandes);
    }
    if (labelSelect) {
        labelSelect.addEventListener('change', filtrerPrecommandes);
    }
    
    console.log('Événements de filtrage automatique attachés');
    
    // Fermer le dropdown si on clique ailleurs
    document.removeEventListener('click', handleStatutFilterOutsideClick);
    document.addEventListener('click', handleStatutFilterOutsideClick);
}

// Gestionnaire pour fermer le dropdown si on clique ailleurs
function handleStatutFilterOutsideClick(event) {
    const statutContainer = document.querySelector('.statut-filter-container');
    if (statutContainer && !statutContainer.contains(event.target)) {
        const checkboxes = document.getElementById('statut-checkboxes');
        const icon = document.getElementById('statut-filter-icon');
        if (checkboxes && checkboxes.style.display === 'block') {
            checkboxes.style.display = 'none';
            checkboxes.classList.remove('show');
            icon.className = 'bi bi-chevron-down';
        }
    }
}

// Récupérer les statuts sélectionnés
function getStatutsSelectionnes() {
    const statuts = [];
    const checkboxes = document.querySelectorAll('.statut-checkboxes input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
        statuts.push(checkbox.value);
    });
    return statuts;
}

// Mettre à jour le label du bouton de statut
function updateStatutFilterLabel() {
    const statutsSelectionnes = getStatutsSelectionnes();
    const label = document.getElementById('statut-filter-label');
    const count = statutsSelectionnes.length;
    
    if (count === 0) {
        label.textContent = 'Statut (aucun sélectionné)';
    } else if (count === 1) {
        label.textContent = 'Statut (1 sélectionné)';
    } else {
        label.textContent = `Statut (${count} sélectionnés)`;
    }
    
    // Appliquer automatiquement le filtre
    console.log('Filtrage automatique déclenché par changement de statut');
    filtrerPrecommandes();
}

// Toggle du filtre de statut
function toggleStatutFilter() {
    console.log('Toggle du filtre de statut appelé');
    const checkboxes = document.getElementById('statut-checkboxes');
    const icon = document.getElementById('statut-filter-icon');
    
    if (!checkboxes || !icon) {
        console.error('Éléments du filtre de statut non trouvés');
        return;
    }
    
    if (checkboxes.style.display === 'none') {
        checkboxes.style.display = 'block';
        checkboxes.classList.add('show');
        icon.className = 'bi bi-chevron-up';
        console.log('Filtre de statut ouvert');
    } else {
        checkboxes.style.display = 'none';
        checkboxes.classList.remove('show');
        icon.className = 'bi bi-chevron-down';
        console.log('Filtre de statut fermé');
    }
}

// Populer les points de vente pour les pré-commandes (identique à Saisie)
async function populatePrecommandePointVenteDropdown() {
    try {
        const response = await fetch('/api/points-vente');
        const pointsVente = await response.json();
        
        const pointVenteSelect = document.getElementById('precommande-point-vente');
        const filterPointVenteSelect = document.getElementById('filter-precommande-point-vente');
        
        if (pointVenteSelect) {
            pointVenteSelect.innerHTML = '<option value="">Sélectionner un point de vente</option>';
            pointsVente.forEach(pointVente => {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente;
                pointVenteSelect.appendChild(option);
            });
        }
        
        if (filterPointVenteSelect) {
            // Garder l'option "tous"
            filterPointVenteSelect.innerHTML = '<option value="tous">Tous les points de vente</option>';
            pointsVente.forEach(pointVente => {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente;
                filterPointVenteSelect.appendChild(option);
            });
        }
        
        // Appliquer les restrictions selon l'utilisateur (comme pour Saisie)
        const userPointsVente = getUserAuthorizedPointsVente();
        if (!userPointsVente.includes("tous") && userPointsVente.length === 1) {
            if (pointVenteSelect) {
                pointVenteSelect.value = userPointsVente[0];
                pointVenteSelect.disabled = true;
            }
        }
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente pour pré-commandes:', error);
    }
}

// Charger les labels existants pour l'autocomplétion des pré-commandes
async function loadPrecommandeLabelsForAutocomplete() {
    console.log('=== DÉBUT loadPrecommandeLabelsForAutocomplete ===');
    try {
        const response = await fetch('/api/precommandes');
        const data = await response.json();
        
        console.log('Réponse API pré-commandes:', data);
        
        if (data.success && data.precommandes) {
            console.log('Nombre de pré-commandes reçues:', data.precommandes.length);
            console.log('Contenu des pré-commandes:', data.precommandes);
            
            // Extraire tous les labels uniques
            const labels = [...new Set(data.precommandes
                .map(p => p.label)
                .filter(label => label && label.trim() !== '')
            )].sort();
            
            console.log('Labels uniques trouvés:', labels);
            
            // Configurer l'autocomplétion sur l'input
            const labelInput = document.getElementById('precommande-label');
            console.log('Élément precommande-label trouvé:', labelInput);
            
            if (labelInput && labels.length > 0) {
                console.log('Type de l\'élément:', labelInput.tagName);
                console.log('Configuration de l\'autocomplétion avec', labels.length, 'labels');
                
                // Créer la datalist pour l'autocomplétion
                let datalist = document.getElementById('precommande-labels-datalist');
                if (!datalist) {
                    datalist = document.createElement('datalist');
                    datalist.id = 'precommande-labels-datalist';
                    labelInput.setAttribute('list', 'precommande-labels-datalist');
                    document.body.appendChild(datalist);
                }
                
                // Vider et peupler la datalist
                datalist.innerHTML = '';
                labels.forEach(label => {
                    const option = document.createElement('option');
                    option.value = label;
                    datalist.appendChild(option);
                    console.log('Label ajouté à la datalist:', label);
                });
                
                console.log('Autocomplétion configurée avec', datalist.children.length, 'options');
            } else if (labelInput) {
                console.log('Aucun label trouvé, pas d\'autocomplétion configurée');
            } else {
                console.error('Élément precommande-label non trouvé dans le DOM');
            }
        } else {
            console.log('Pas de pré-commandes ou erreur dans la réponse');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des labels pour pré-commandes:', error);
    }
    console.log('=== FIN loadPrecommandeLabelsForAutocomplete ===');
}

// Populer le dropdown de filtre des labels pour les pré-commandes
async function populatePrecommandeFilterLabelsDropdown() {
    console.log('=== DÉBUT populatePrecommandeFilterLabelsDropdown ===');
    try {
        const response = await fetch('/api/precommandes');
        const data = await response.json();
        
        if (data.success && data.precommandes) {
            // Extraire tous les labels uniques
            const labels = [...new Set(data.precommandes
                .map(p => p.label)
                .filter(label => label && label.trim() !== '')
            )].sort();
            
            console.log('Labels uniques pour le filtre:', labels);
            
            // Populer le dropdown de filtre
            const filterLabelSelect = document.getElementById('filter-precommande-label');
            console.log('Élément filter-precommande-label trouvé:', filterLabelSelect);
            
            if (filterLabelSelect) {
                console.log('Type de l\'élément:', filterLabelSelect.tagName);
                
                // Garder l'option par défaut
                filterLabelSelect.innerHTML = '<option value="">Tous les labels</option>';
                console.log('Option par défaut ajoutée');
                
                // Ajouter les labels existants
                labels.forEach(label => {
                    const option = document.createElement('option');
                    option.value = label;
                    option.textContent = label;
                    filterLabelSelect.appendChild(option);
                    console.log('Label ajouté au filtre:', label);
                });
                
                console.log('Dropdown de filtre configuré avec', filterLabelSelect.options.length, 'options');
            } else {
                console.error('Élément filter-precommande-label non trouvé dans le DOM');
            }
        } else {
            console.log('Pas de pré-commandes ou erreur dans la réponse');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des labels pour le filtre:', error);
    }
    console.log('=== FIN populatePrecommandeFilterLabelsDropdown ===');
}

// Populer les catégories pour les pré-commandes (identique à Saisie)
function populatePrecommandeCategoriesForEntry() {
    const categoriesSelects = document.querySelectorAll('.precommande-categorie-select');
    
    categoriesSelects.forEach(select => {
        select.innerHTML = '<option value="">Sélectionner une catégorie</option>';
        
        if (produits && typeof produits === 'object') {
            Object.keys(produits).forEach(categorie => {
                if (typeof produits[categorie] === 'object' && produits[categorie] !== null) {
                    // Ignorer les fonctions
                    if (typeof produits[categorie] === 'function') return;
                    
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    select.appendChild(option);
                }
            });
        }
    });
}

// Populer les catégories pour une ligne spécifique (pour éviter de réinitialiser toutes les lignes)
function populatePrecommandeCategoriesForSpecificEntry(categorieSelect) {
    categorieSelect.innerHTML = '<option value="">Sélectionner une catégorie</option>';
    
    if (produits && typeof produits === 'object') {
        Object.keys(produits).forEach(categorie => {
            if (typeof produits[categorie] === 'object' && produits[categorie] !== null) {
                // Ignorer les fonctions
                if (typeof produits[categorie] === 'function') return;
                
                const option = document.createElement('option');
                option.value = categorie;
                option.textContent = categorie;
                categorieSelect.appendChild(option);
            }
        });
    }
}

// Populer les produits pour une catégorie donnée (identique à Saisie)
function populatePrecommandeProduitsForEntry(categorieSelect, produitSelect) {
    const categorie = categorieSelect.value;
    produitSelect.innerHTML = '<option value="">Sélectionner un produit</option>';
    
    if (categorie && produits[categorie]) {
        Object.keys(produits[categorie]).forEach(produit => {
            const option = document.createElement('option');
            option.value = produit;
            option.textContent = produit;
            produitSelect.appendChild(option);
        });
    }
}

// Créer une nouvelle entrée de produit pour pré-commande (basé sur creerNouvelleEntree)
function creerNouvelleEntreePrecommande() {
    const container = document.getElementById('precommande-produits-container');
    const template = document.querySelector('.precommande-produit-entry');
    const div = template.cloneNode(true);
    
    // Nettoyer les valeurs
    div.querySelectorAll('select, input').forEach(field => {
        if (field.type !== 'readonly') {
            field.value = '';
        }
    });
    
    // Ajouter le bouton de suppression
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'col-12 d-flex justify-content-end mt-2';
    buttonsDiv.innerHTML = '<button type="button" class="btn btn-danger btn-sm supprimer-produit-precommande">Supprimer</button>';
    div.querySelector('.row').appendChild(buttonsDiv);
    
    container.appendChild(div);
    
    // Configurer les événements
    setupPrecommandeEntryEvents(div);
    
    return div;
}

// Configurer les événements pour une entrée de pré-commande
function setupPrecommandeEntryEvents(div) {
    const categorieSelect = div.querySelector('.precommande-categorie-select');
    const produitSelect = div.querySelector('.precommande-produit-select');
    const prixUnitInput = div.querySelector('.precommande-prix-unit');
    const quantiteInput = div.querySelector('.precommande-quantite');
    const deleteButton = div.querySelector('.supprimer-produit-precommande');
    
    // Populer les catégories pour cette ligne uniquement
    populatePrecommandeCategoriesForSpecificEntry(categorieSelect);
    
    // Événement changement de catégorie
    categorieSelect.addEventListener('change', function() {
        populatePrecommandeProduitsForEntry(categorieSelect, produitSelect);
        prixUnitInput.value = '';
        calculerTotalPrecommande(div);
    });
    
    // Événement changement de produit (mise à jour prix automatique)
    produitSelect.addEventListener('change', function() {
        const selectedProduit = this.value;
        const categorie = categorieSelect.value;
        const pointVente = document.getElementById('precommande-point-vente').value;
        
        if (categorie && selectedProduit && produits[categorie] && produits[categorie][selectedProduit]) {
            prixUnitInput.value = produits.getPrixDefaut(categorie, selectedProduit, pointVente) || '';
        } else {
            prixUnitInput.value = '';
        }
        
        calculerTotalPrecommande(div);
    });
    
    // Calcul automatique du total
    prixUnitInput.addEventListener('input', () => calculerTotalPrecommande(div));
    quantiteInput.addEventListener('input', () => calculerTotalPrecommande(div));
    
    // Suppression d'entrée
    if (deleteButton) {
        deleteButton.addEventListener('click', function() {
            div.remove();
            calculerTotalGeneralPrecommande();
        });
    }
}

// Calculer le total d'une ligne de pré-commande (identique à calculerTotal)
function calculerTotalPrecommande(div) {
    const prixUnit = parseFloat(div.querySelector('.precommande-prix-unit').value) || 0;
    const quantite = parseFloat(div.querySelector('.precommande-quantite').value) || 0;
    const total = prixUnit * quantite;
    
    div.querySelector('.precommande-total').value = total.toFixed(2);
    calculerTotalGeneralPrecommande();
}

// Calculer le total général des pré-commandes (identique à calculerTotalGeneral)
function calculerTotalGeneralPrecommande() {
    let totalGeneral = 0;
    const entriesProduits = document.querySelectorAll('.precommande-produit-entry');
    
    entriesProduits.forEach(entry => {
        const total = parseFloat(entry.querySelector('.precommande-total').value) || 0;
        totalGeneral += total;
    });
    
    const totalElement = document.getElementById('precommande-total-general');
    if (totalElement) {
        totalElement.textContent = `${totalGeneral.toFixed(2)} FCFA`;
    }
}

// Charger les pré-commandes existantes
async function chargerPrecommandes() {
    try {
        // Charger toutes les pré-commandes (sans limite) pour permettre le filtrage côté client
        const response = await fetch('/api/precommandes', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            currentPrecommandes = data.precommandes || [];
            console.log('Pré-commandes chargées:', currentPrecommandes.length);
            
            // Mettre à jour le compteur total
            const totalElement = document.getElementById('total-precommandes');
            if (totalElement) {
                totalElement.textContent = `${currentPrecommandes.length} pré-commande(s) au total`;
            }
            
            // Mettre à jour la dernière mise à jour
            const updateElement = document.getElementById('derniere-mise-a-jour-precommandes');
            if (updateElement) {
                updateElement.textContent = `Dernière maj: ${new Date().toLocaleString()}`;
            }
            
            // Appliquer immédiatement le filtre par défaut (seulement "Ouvert")
            console.log('Application du filtre par défaut après chargement');
            filtrerPrecommandes();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des pré-commandes:', error);
    }
}

// Afficher les pré-commandes dans le tableau avec pagination
function afficherPrecommandes(precommandes) {
    const tbody = document.querySelector("#precommandes-table tbody");
    if (!tbody) {
        console.error('Tableau des pré-commandes non trouvé');
        return;
    }
    
    tbody.innerHTML = '';
    
    if (!precommandes || precommandes.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="18" class="text-center">Aucune pré-commande trouvée</td>';
        tbody.appendChild(tr);
        afficherPaginationPrecommandes(0);
        return;
    }
    
    // Calculer la pagination
    const totalPages = Math.ceil(precommandes.length / precommandesPerPage);
    const startIndex = (currentPrecommandePage - 1) * precommandesPerPage;
    const endIndex = startIndex + precommandesPerPage;
    const precommandesPage = precommandes.slice(startIndex, endIndex);
    
    precommandesPage.forEach(precommande => {
        const tr = document.createElement('tr');
        
        // Appliquer les classes CSS selon le statut
        const statutClass = getStatutClass(precommande.statut || 'ouvert');
        const dateReceptionClass = getDateReceptionClass(precommande['Date Réception'], precommande.statut || 'ouvert');
        
        tr.className = `${statutClass} ${dateReceptionClass}`;
        
        tr.innerHTML = `
            <td>${precommande.Mois || ''}</td>
            <td>${precommande['Date Enregistrement'] || ''}</td>
            <td class="${dateReceptionClass}">${getDateReceptionContent(precommande['Date Réception'], precommande.statut || 'ouvert')}</td>
            <td>${precommande.Semaine || ''}</td>
            <td>${precommande['Point de Vente'] || ''}</td>
            <td>${precommande.Preparation || ''}</td>
            <td>${precommande.Catégorie || ''}</td>
            <td>${precommande.Produit || ''}</td>
            <td>${precommande.PU || ''}</td>
            <td>${precommande.Nombre || ''}</td>
            <td>${precommande.Montant || ''}</td>
            <td>${precommande.nomClient || ''}</td>
            <td>${precommande.numeroClient || ''}</td>
            <td>${precommande.adresseClient || ''}</td>
            <td>${precommande.commentaire || ''}</td>
            <td>${precommande.label || ''}</td>
            <td>${getStatutBadge(precommande.statut || 'ouvert')}</td>
            <td>
                <div class="btn-group" role="group">
                    ${getActionsDisponibles(precommande.statut || 'ouvert', precommande.id)}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // Ajouter les événements pour les boutons d'action
    setupPrecommandeTableEvents();
    
    // Afficher la pagination
    afficherPaginationPrecommandes(precommandes.length);
}

// Afficher la pagination pour les pré-commandes
function afficherPaginationPrecommandes(totalPrecommandes) {
    console.log('=== DÉBUT afficherPaginationPrecommandes ===');
    console.log('Total pré-commandes:', totalPrecommandes);
    console.log('Page actuelle:', currentPrecommandePage);
    console.log('Pré-commandes par page:', precommandesPerPage);
    
    const paginationContainer = document.getElementById('precommandes-pagination');
    console.log('Container de pagination trouvé:', paginationContainer);
    
    if (!paginationContainer) {
        console.error('Container de pagination des pré-commandes non trouvé');
        return;
    }
    
    const totalPages = Math.ceil(totalPrecommandes / precommandesPerPage);
    console.log('Nombre total de pages:', totalPages);
    
    if (totalPages <= 1) {
        console.log('Une seule page ou moins, pas de pagination nécessaire');
        paginationContainer.innerHTML = '';
        return;
    }
    
    let paginationHTML = '<nav aria-label="Pagination des pré-commandes"><ul class="pagination justify-content-center">';
    
    // Bouton Précédent
    if (currentPrecommandePage > 1) {
        paginationHTML += `<li class="page-item">
            <a class="page-link" href="#" data-page="${currentPrecommandePage - 1}">Précédent</a>
        </li>`;
    } else {
        paginationHTML += '<li class="page-item disabled"><span class="page-link">Précédent</span></li>';
    }
    
    // Numéros de pages
    const startPage = Math.max(1, currentPrecommandePage - 2);
    const endPage = Math.min(totalPages, currentPrecommandePage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        if (i === currentPrecommandePage) {
            paginationHTML += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
        } else {
            paginationHTML += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }
    }
    
    // Bouton Suivant
    if (currentPrecommandePage < totalPages) {
        paginationHTML += `<li class="page-item">
            <a class="page-link" href="#" data-page="${currentPrecommandePage + 1}">Suivant</a>
        </li>`;
    } else {
        paginationHTML += '<li class="page-item disabled"><span class="page-link">Suivant</span></li>';
    }
    
    paginationHTML += '</ul></nav>';
    
    // Informations de pagination
    const startIndex = (currentPrecommandePage - 1) * precommandesPerPage + 1;
    const endIndex = Math.min(currentPrecommandePage * precommandesPerPage, totalPrecommandes);
    paginationHTML += `<div class="text-center mt-2">
        <small class="text-muted">Affichage ${startIndex}-${endIndex} sur ${totalPrecommandes} pré-commandes</small>
    </div>`;
    
    paginationContainer.innerHTML = paginationHTML;
    
    // Ajouter les événements de pagination
    paginationContainer.querySelectorAll('a[data-page]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const page = parseInt(this.getAttribute('data-page'));
            if (page !== currentPrecommandePage) {
                currentPrecommandePage = page;
                afficherPrecommandes(currentPrecommandes);
            }
        });
    });
    
    console.log('=== FIN afficherPaginationPrecommandes ===');
}


// Fonction pour obtenir la classe CSS selon le statut
function getStatutClass(statut) {
    switch(statut) {
        case 'ouvert': return 'statut-ouvert';
        case 'convertie': return 'statut-convertie';
        case 'annulee': return 'statut-annulee';
        case 'archivee': return 'statut-archivee';
        default: return '';
    }
}

// Fonction pour obtenir le badge de statut
function getStatutBadge(statut) {
    switch(statut) {
        case 'ouvert': return '<span class="badge badge-statut badge-ouvert">Ouvert</span>';
        case 'convertie': return '<span class="badge badge-statut badge-convertie">Convertie</span>';
        case 'annulee': return '<span class="badge badge-statut badge-annulee">Annulée</span>';
        case 'archivee': return '<span class="badge badge-statut badge-archivee">Archivée</span>';
        default: return '';
    }
}

// Fonction pour obtenir la classe CSS selon la date de réception
function getDateReceptionClass(dateReception, statut) {
    // Si la pré-commande n'est pas ouverte, ne pas appliquer de style de date
    if (!dateReception || statut !== 'ouvert') {
        return '';
    }
    
    const today = new Date();
    const receptionDate = new Date(dateReception);
    
    // Normaliser les dates (ignorer l'heure)
    today.setHours(0, 0, 0, 0);
    receptionDate.setHours(0, 0, 0, 0);
    
    const diffTime = receptionDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        return 'date-reception-depassee'; // Date dépassée
    } else if (diffDays === 0) {
        return 'date-reception-aujourdhui'; // Aujourd'hui
    } else if (diffDays === 1) {
        return 'date-reception-demain'; // Demain
    }
    
    return ''; // Date normale
}

// Fonction pour générer le contenu de la cellule date de réception avec badges
function getDateReceptionContent(dateReception, statut) {
    if (!dateReception || statut !== 'ouvert') {
        return dateReception || '';
    }
    
    const today = new Date();
    let receptionDate;
    
    // Debug: Afficher les valeurs pour comprendre le problème
    console.log('=== DEBUG DATE RÉCEPTION ===');
    console.log('Date réception reçue:', dateReception);
    console.log('Type:', typeof dateReception);
    console.log('Date aujourd\'hui:', today.toISOString().split('T')[0]);
    
    // Gérer différents formats de date
    if (typeof dateReception === 'string') {
        if (dateReception.includes('-') || dateReception.includes('/')) {
            const parts = dateReception.replace(/\//g, '-').split('-');
            if (parts.length === 3) {
                // Détecter le format : YYYY-MM-DD ou DD-MM-YYYY
                if (parts[0].length === 4) {
                    // Format YYYY-MM-DD (déjà correct pour new Date())
                    receptionDate = new Date(dateReception);
                    console.log('Date parsée (YYYY-MM-DD):', receptionDate.toISOString().split('T')[0]);
                } else {
                    // Format DD-MM-YYYY -> YYYY-MM-DD pour new Date()
                    receptionDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                    console.log('Date parsée (DD-MM-YYYY):', receptionDate.toISOString().split('T')[0]);
                }
            } else {
                receptionDate = new Date(dateReception);
                console.log('Date parsée (autre format):', receptionDate.toISOString().split('T')[0]);
            }
        } else {
            receptionDate = new Date(dateReception);
            console.log('Date parsée (format simple):', receptionDate.toISOString().split('T')[0]);
        }
    } else {
        receptionDate = new Date(dateReception);
        console.log('Date parsée (objet Date):', receptionDate.toISOString().split('T')[0]);
    }
    
    // Vérifier si la date est valide
    if (isNaN(receptionDate.getTime())) {
        console.log('Date invalide, retour de la date originale');
        return dateReception; // Retourner la date originale si invalide
    }
    
    // Normaliser les dates (ignorer l'heure)
    today.setHours(0, 0, 0, 0);
    receptionDate.setHours(0, 0, 0, 0);
    
    const diffTime = receptionDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    console.log('Différence en jours:', diffDays);
    console.log('Date réception normalisée:', receptionDate.toISOString().split('T')[0]);
    console.log('Date aujourd\'hui normalisée:', today.toISOString().split('T')[0]);
    
    let badge = '';
    if (diffDays < 0) {
        badge = '<span class="badge bg-danger ms-2">DÉLAI DÉPASSÉ</span>';
        console.log('Badge: DÉLAI DÉPASSÉ');
    } else if (diffDays === 0) {
        badge = '<span class="badge bg-warning ms-2">URGENT</span>';
        console.log('Badge: URGENT');
    } else if (diffDays === 1) {
        badge = '<span class="badge bg-info ms-2">PROCHE</span>';
        console.log('Badge: PROCHE');
    } else {
        console.log('Badge: Aucun');
    }
    
    console.log('=== FIN DEBUG ===');
    
    return `${dateReception}${badge}`;
}

// Fonction pour obtenir les actions disponibles selon le statut
function getActionsDisponibles(statut, precommandeId) {
    const currentUser = window.currentUser;
    const isSuperviseur = currentUser && (currentUser.role === 'superviseur' || currentUser.role === 'admin');
    
    if (statut === 'ouvert') {
        return `
            <button class="btn btn-sm btn-primary modifier-precommande" data-id="${precommandeId}" title="Modifier">
                <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-success convertir-precommande" data-id="${precommandeId}" title="Convertir en vente">
                <i class="bi bi-arrow-right-circle"></i>
            </button>
            <button class="btn btn-sm btn-warning annuler-precommande" data-id="${precommandeId}" title="Annuler">
                <i class="bi bi-x-circle"></i>
            </button>
            <button class="btn btn-sm btn-secondary archiver-precommande" data-id="${precommandeId}" title="Archiver">
                <i class="bi bi-archive"></i>
            </button>
            <button class="btn btn-sm btn-danger supprimer-precommande" data-id="${precommandeId}" title="Supprimer">
                <i class="bi bi-trash"></i>
            </button>
        `;
    } else if (isSuperviseur && (statut === 'annulee' || statut === 'archivee' || statut === 'convertie')) {
        // Les superviseurs peuvent supprimer les pré-commandes annulées, archivées ou converties
        return `
            <button class="btn btn-sm btn-danger supprimer-precommande" data-id="${precommandeId}" title="Supprimer (Superviseur)">
                <i class="bi bi-trash"></i>
            </button>
        `;
    } else {
        return `<span class="text-muted">Aucune action</span>`;
    }
}

// Configurer les événements des boutons dans le tableau
function setupPrecommandeTableEvents() {
    // Boutons de modification
    document.querySelectorAll('.modifier-precommande').forEach(btn => {
        btn.addEventListener('click', function() {
            const precommandeId = this.getAttribute('data-id');
            ouvrirModalModification(precommandeId);
        });
    });
    
    // Boutons de conversion
    document.querySelectorAll('.convertir-precommande').forEach(btn => {
        btn.addEventListener('click', function() {
            const precommandeId = this.getAttribute('data-id');
            ouvrirModalConversion(precommandeId);
        });
    });
    
    
    // Boutons d'annulation
    document.querySelectorAll('.annuler-precommande').forEach(btn => {
        btn.addEventListener('click', function() {
            const precommandeId = this.getAttribute('data-id');
            ouvrirModalAnnulation(precommandeId);
        });
    });
    
    // Boutons d'archivage
    document.querySelectorAll('.archiver-precommande').forEach(btn => {
        btn.addEventListener('click', function() {
            const precommandeId = this.getAttribute('data-id');
            ouvrirModalArchivage(precommandeId);
        });
    });
    
    // Boutons de suppression
    document.querySelectorAll('.supprimer-precommande').forEach(btn => {
        btn.addEventListener('click', function() {
            const precommandeId = this.getAttribute('data-id');
            supprimerPrecommande(precommandeId);
        });
    });
}

// Variables globales pour les modals
let precommandeEnCoursDeConversion = null;
let precommandeEnCoursDAnnulation = null;
let precommandeEnCoursDArchivage = null;

// Ouvrir la modal de conversion
async function ouvrirModalConversion(precommandeId) {
    try {
        // Récupérer les détails de la pré-commande
        const precommande = currentPrecommandes.find(p => p.id == precommandeId);
        if (!precommande) {
            alert('Pré-commande non trouvée');
            return;
        }
        
        precommandeEnCoursDeConversion = precommande;
        
        // Remplir les informations de la pré-commande dans la modal
        document.getElementById('conversion-info-client').textContent = 
            precommande.nomClient || 'Non renseigné';
        document.getElementById('conversion-info-montant').textContent = 
            `${precommande.Montant} FCFA`;
        document.getElementById('conversion-info-produit').textContent = 
            `${precommande.Catégorie} - ${precommande.Produit}`;
        document.getElementById('conversion-info-quantite').textContent = 
            precommande.Nombre;
        document.getElementById('conversion-info-commentaire').textContent = 
            precommande.commentaire || 'Aucun commentaire';
        
        // Populer les points de vente pour la conversion
        await populateConversionPointsVente();
        
        // Réinitialiser les champs de saisie
        const conversionDateInput = document.getElementById('conversion-date-vente');
        if (conversionDateInput && conversionDateInput._flatpickr) {
            conversionDateInput._flatpickr.setDate(new Date());
        } else {
            // Si Flatpickr n'est pas encore initialisé, initialiser la date manuellement
            conversionDateInput.value = new Date().toLocaleDateString('fr-FR');
        }
        document.getElementById('conversion-point-vente').value = '';
        
        // Ouvrir la modal
        const modal = new bootstrap.Modal(document.getElementById('conversionModal'));
        modal.show();
        
    } catch (error) {
        console.error('Erreur lors de l\'ouverture de la modal de conversion:', error);
        alert('Erreur lors de l\'ouverture de la modal de conversion');
    }
}

// Populer les points de vente pour la conversion
async function populateConversionPointsVente() {
    try {
        const response = await fetch('/api/points-vente');
        const pointsVente = await response.json();
        
        const select = document.getElementById('conversion-point-vente');
        select.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        pointsVente.forEach(pointVente => {
            const option = document.createElement('option');
            option.value = pointVente;
            option.textContent = pointVente;
            select.appendChild(option);
        });
        
        // Appliquer les restrictions selon l'utilisateur (comme pour Saisie)
        const userPointsVente = getUserAuthorizedPointsVente();
        if (!userPointsVente.includes("tous") && userPointsVente.length === 1) {
            select.value = userPointsVente[0];
            select.disabled = true;
        }
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente pour conversion:', error);
    }
}

// Confirmer la conversion
async function confirmerConversion() {
    const dateVente = document.getElementById('conversion-date-vente').value;
    const pointVenteDestination = document.getElementById('conversion-point-vente').value;
    
    if (!dateVente || !pointVenteDestination) {
        alert('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    if (!precommandeEnCoursDeConversion) {
        alert('Aucune pré-commande sélectionnée');
        return;
    }
    
    if (!confirm('Êtes-vous sûr de vouloir convertir cette pré-commande en vente réelle ?')) {
        return;
    }
    
    try {
        showLoadingSpinner();
        
        const response = await fetch(`/api/precommandes/${precommandeEnCoursDeConversion.id}/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                dateVente: dateVente,
                pointVenteDestination: pointVenteDestination
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Pré-commande convertie en vente réelle avec succès !');
            
            // Fermer la modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('conversionModal'));
            modal.hide();
            
            // Recharger les pré-commandes
            await chargerPrecommandes();
            
            // Réinitialiser la variable globale
            precommandeEnCoursDeConversion = null;
            
        } else {
            alert('Erreur lors de la conversion: ' + data.message);
        }
        
    } catch (error) {
        console.error('Erreur lors de la conversion:', error);
        alert('Erreur lors de la conversion de la pré-commande');
    } finally {
        hideLoadingSpinner();
    }
}


// Ouvrir la modal d'annulation
function ouvrirModalAnnulation(precommandeId) {
    const precommande = currentPrecommandes.find(p => p.id == precommandeId);
    if (!precommande) {
        alert('Pré-commande non trouvée');
        return;
    }
    
    // Vérifier que la pré-commande est ouverte
    if (precommande.statut !== 'ouvert') {
        alert('Seules les pré-commandes ouvertes peuvent être annulées');
        return;
    }
    
    precommandeEnCoursDAnnulation = precommande;
    
    // Vider le champ commentaire
    document.getElementById('cancel-commentaire').value = '';
    
    // Afficher la modal
    const modal = new bootstrap.Modal(document.getElementById('cancelPrecommandeModal'));
    modal.show();
}

// Confirmer l'annulation
async function confirmerAnnulation() {
    if (!precommandeEnCoursDAnnulation) {
        alert('Aucune pré-commande sélectionnée');
        return;
    }
    
    const commentaire = document.getElementById('cancel-commentaire').value.trim();
    if (!commentaire) {
        alert('Veuillez expliquer la raison de l\'annulation');
        return;
    }
    
    try {
        showLoadingSpinner();
        
        const response = await fetch(`/api/precommandes/${precommandeEnCoursDAnnulation.id}/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ commentaire })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Pré-commande annulée avec succès !');
            
            // Fermer la modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('cancelPrecommandeModal'));
            modal.hide();
            
            // Recharger les pré-commandes
            await chargerPrecommandes();
            
            // Réinitialiser la variable globale
            precommandeEnCoursDAnnulation = null;
            
        } else {
            alert('Erreur lors de l\'annulation: ' + data.message);
        }
        
    } catch (error) {
        console.error('Erreur lors de l\'annulation:', error);
        alert('Erreur lors de l\'annulation de la pré-commande');
    } finally {
        hideLoadingSpinner();
    }
}

// Ouvrir la modal d'archivage
function ouvrirModalArchivage(precommandeId) {
    const precommande = currentPrecommandes.find(p => p.id == precommandeId);
    if (!precommande) {
        alert('Pré-commande non trouvée');
        return;
    }
    
    // Vérifier que la pré-commande est ouverte
    if (precommande.statut !== 'ouvert') {
        alert('Seules les pré-commandes ouvertes peuvent être archivées');
        return;
    }
    
    precommandeEnCoursDArchivage = precommande;
    
    // Vider le champ commentaire
    document.getElementById('archive-commentaire').value = '';
    
    // Afficher la modal
    const modal = new bootstrap.Modal(document.getElementById('archivePrecommandeModal'));
    modal.show();
}

// Variable globale pour stocker la pré-commande en cours de modification
let precommandeEnCoursDeModification = null;

// Ouvrir la modal de modification
function ouvrirModalModification(precommandeId) {
    const precommande = currentPrecommandes.find(p => p.id == precommandeId);
    if (!precommande) {
        alert('Pré-commande non trouvée');
        return;
    }
    
    // Vérifier que la pré-commande est ouverte
    if (precommande.statut !== 'ouvert') {
        alert('Seules les pré-commandes ouvertes peuvent être modifiées');
        return;
    }
    
    precommandeEnCoursDeModification = precommande;
    
    // Debug: Afficher les données de la pré-commande
    console.log('Données de la pré-commande à modifier:', precommande);
    console.log('Date Enregistrement:', precommande['Date Enregistrement']);
    console.log('Date Réception:', precommande['Date Réception']);
    console.log('Point de Vente:', precommande['Point de Vente']);
    console.log('Preparation:', precommande['Preparation']);
    
    // Fonction utilitaire pour récupérer une valeur avec plusieurs noms possibles
    const getValue = (obj, ...keys) => {
        for (const key of keys) {
            if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
                return obj[key];
            }
        }
        return '';
    };
    
    // Fonction pour récupérer une valeur en gérant les propriétés avec espaces
    const getValueWithSpaces = (obj, ...keys) => {
        for (const key of keys) {
            // Essayer avec le nom exact
            if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
                return obj[key];
            }
            // Essayer avec des variations (espaces, underscores, camelCase)
            const variations = [
                key.replace(/\s+/g, ''),
                key.replace(/\s+/g, '_'),
                key.replace(/\s+/g, '').replace(/^[a-z]/, c => c.toUpperCase()),
                key.toLowerCase().replace(/\s+/g, '_')
            ];
            
            for (const variation of variations) {
                if (obj[variation] !== undefined && obj[variation] !== null && obj[variation] !== '') {
                    return obj[variation];
                }
            }
        }
        return '';
    };
    
    // Fonction pour convertir le format de date DD-MM-YYYY vers YYYY-MM-DD
    const convertDateFormat = (dateStr) => {
        if (!dateStr) return '';
        // Si c'est déjà au format YYYY-MM-DD, le retourner tel quel
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
        }
        // Si c'est au format DD-MM-YYYY, le convertir
        if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
            const [day, month, year] = dateStr.split('-');
            return `${year}-${month}-${day}`;
        }
        return dateStr;
    };
    
    // Pré-remplir le formulaire avec les données de la pré-commande
    const moisValue = getValueWithSpaces(precommande, 'Mois', 'mois');
    const semaineValue = getValueWithSpaces(precommande, 'Semaine', 'semaine');
    const dateEnregistrementValue = getValueWithSpaces(precommande, 'Date Enregistrement', 'dateEnregistrement', 'date_enregistrement');
    const dateReceptionValue = getValueWithSpaces(precommande, 'Date Réception', 'dateReception', 'date_reception');
    const preparationValue = getValueWithSpaces(precommande, 'Preparation', 'preparation');
    
    console.log('Valeurs récupérées:');
    console.log('Mois:', moisValue);
    console.log('Semaine:', semaineValue);
    console.log('Date Enregistrement:', dateEnregistrementValue);
    console.log('Date Réception:', dateReceptionValue);
    console.log('Preparation:', preparationValue);
    
    document.getElementById('edit-mois').value = moisValue;
    document.getElementById('edit-semaine').value = semaineValue;
    document.getElementById('edit-date-enregistrement').value = convertDateFormat(dateEnregistrementValue);
    document.getElementById('edit-date-reception').value = convertDateFormat(dateReceptionValue);
    document.getElementById('edit-preparation').value = preparationValue;
    document.getElementById('edit-prix-unit').value = getValueWithSpaces(precommande, 'PU', 'prixUnit', 'prix_unit', 'prixUnitaire');
    document.getElementById('edit-nombre').value = getValueWithSpaces(precommande, 'Nombre', 'nombre');
    document.getElementById('edit-montant').value = getValueWithSpaces(precommande, 'Montant', 'montant');
    document.getElementById('edit-nom-client').value = getValueWithSpaces(precommande, 'nomClient', 'nom_client');
    document.getElementById('edit-numero-client').value = getValueWithSpaces(precommande, 'numeroClient', 'numero_client');
    document.getElementById('edit-adresse-client').value = getValueWithSpaces(precommande, 'adresseClient', 'adresse_client');
    document.getElementById('edit-commentaire').value = getValueWithSpaces(precommande, 'commentaire');
    document.getElementById('edit-label').value = getValueWithSpaces(precommande, 'label');
    
    // Peupler les dropdowns
    populateEditDropdowns();
    
    // Attendre un peu pour que les dropdowns soient peuplés
    setTimeout(() => {
        // Définir les valeurs des dropdowns
        const pointVenteValue = getValueWithSpaces(precommande, 'Point de Vente', 'pointVente', 'point_vente');
        const categorieValue = getValueWithSpaces(precommande, 'Catégorie', 'categorie');
        
        console.log('Point de Vente:', pointVenteValue);
        console.log('Catégorie:', categorieValue);
        
        document.getElementById('edit-point-vente').value = pointVenteValue;
        document.getElementById('edit-categorie').value = categorieValue;
        
        // Vérifier si la valeur a été définie
        console.log('Valeur définie pour Point de Vente:', document.getElementById('edit-point-vente').value);
        console.log('Valeur définie pour Catégorie:', document.getElementById('edit-categorie').value);
        
        // Peupler les produits selon la catégorie sélectionnée
        const categorie = getValueWithSpaces(precommande, 'Catégorie', 'categorie');
        if (categorie) {
            populateEditProduits(categorie);
            // Attendre un peu pour que les produits soient peuplés
            setTimeout(() => {
                document.getElementById('edit-produit').value = getValueWithSpaces(precommande, 'Produit', 'produit');
                console.log('Valeur définie pour Produit:', document.getElementById('edit-produit').value);
            }, 50);
        }
    }, 100);
    
    const modal = new bootstrap.Modal(document.getElementById('editPrecommandeModal'));
    modal.show();
}

// Peupler les dropdowns du modal d'édition
function populateEditDropdowns() {
    // Peupler les points de vente
    const pointVenteSelect = document.getElementById('edit-point-vente');
    pointVenteSelect.innerHTML = '<option value="">Sélectionner...</option>';
    
    console.log('POINTS_VENTE_PHYSIQUES disponibles:', POINTS_VENTE_PHYSIQUES);
    
    if (POINTS_VENTE_PHYSIQUES && Array.isArray(POINTS_VENTE_PHYSIQUES)) {
        POINTS_VENTE_PHYSIQUES.forEach(point => {
            const option = document.createElement('option');
            option.value = point;
            option.textContent = point;
            pointVenteSelect.appendChild(option);
        });
        console.log('Points de vente ajoutés au dropdown:', POINTS_VENTE_PHYSIQUES);
    } else {
        console.log('POINTS_VENTE_PHYSIQUES non disponible ou pas un array');
    }
    
    // Peupler les catégories
    const categorieSelect = document.getElementById('edit-categorie');
    categorieSelect.innerHTML = '<option value="">Sélectionner...</option>';
    
    if (produits && typeof produits === 'object') {
        Object.keys(produits).forEach(categorie => {
            if (typeof produits[categorie] === 'object' && produits[categorie] !== null) {
                // Ignorer les fonctions
                if (typeof produits[categorie] === 'function') return;
                
                const option = document.createElement('option');
                option.value = categorie;
                option.textContent = categorie;
                categorieSelect.appendChild(option);
            }
        });
    }
}

// Peupler les produits selon la catégorie sélectionnée
function populateEditProduits(categorie) {
    const produitSelect = document.getElementById('edit-produit');
    produitSelect.innerHTML = '<option value="">Sélectionner...</option>';
    
    if (categorie && produits[categorie]) {
        Object.keys(produits[categorie]).forEach(produit => {
            const option = document.createElement('option');
            option.value = produit;
            option.textContent = produit;
            produitSelect.appendChild(option);
        });
    }
}

// Confirmer l'archivage
async function confirmerArchivage() {
    if (!precommandeEnCoursDArchivage) {
        alert('Aucune pré-commande sélectionnée');
        return;
    }
    
    const commentaire = document.getElementById('archive-commentaire').value.trim();
    if (!commentaire) {
        alert('Veuillez expliquer la raison de l\'archivage');
        return;
    }
    
    try {
        showLoadingSpinner();
        
        const response = await fetch(`/api/precommandes/${precommandeEnCoursDArchivage.id}/archive`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ commentaire })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Pré-commande archivée avec succès !');
            
            // Fermer la modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('archivePrecommandeModal'));
            modal.hide();
            
            // Recharger les pré-commandes
            await chargerPrecommandes();
            
            // Réinitialiser la variable globale
            precommandeEnCoursDArchivage = null;
            
        } else {
            alert('Erreur lors de l\'archivage: ' + data.message);
        }
        
    } catch (error) {
        console.error('Erreur lors de l\'archivage:', error);
        alert('Erreur lors de l\'archivage de la pré-commande');
    } finally {
        hideLoadingSpinner();
    }
}

// Confirmer la modification
async function confirmerModification() {
    if (!precommandeEnCoursDeModification) {
        alert('Aucune pré-commande sélectionnée');
        return;
    }
    
    // Récupérer les données du formulaire
    const formData = {
        mois: document.getElementById('edit-mois').value,
        semaine: document.getElementById('edit-semaine').value,
        dateEnregistrement: document.getElementById('edit-date-enregistrement').value,
        dateReception: document.getElementById('edit-date-reception').value,
        pointVente: document.getElementById('edit-point-vente').value,
        preparation: document.getElementById('edit-preparation').value,
        categorie: document.getElementById('edit-categorie').value,
        produit: document.getElementById('edit-produit').value,
        prixUnit: parseFloat(document.getElementById('edit-prix-unit').value) || 0,
        nombre: parseFloat(document.getElementById('edit-nombre').value) || 0,
        montant: parseFloat(document.getElementById('edit-montant').value) || 0,
        nomClient: document.getElementById('edit-nom-client').value,
        numeroClient: document.getElementById('edit-numero-client').value,
        adresseClient: document.getElementById('edit-adresse-client').value,
        commentaire: document.getElementById('edit-commentaire').value,
        label: document.getElementById('edit-label').value
    };
    
    // Validation des champs obligatoires
    if (!formData.mois || !formData.semaine || !formData.dateEnregistrement || 
        !formData.dateReception || !formData.pointVente || !formData.preparation ||
        !formData.categorie || !formData.produit || !formData.prixUnit || 
        !formData.nombre || !formData.montant) {
        alert('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    showLoadingSpinner();
    
    try {
        const response = await fetch(`/api/precommandes/${precommandeEnCoursDeModification.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Pré-commande modifiée avec succès !');
            
            // Fermer la modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('editPrecommandeModal'));
            modal.hide();
            
            // Recharger la liste des pré-commandes pour voir les changements
            console.log('Rechargement des pré-commandes après modification...');
            await chargerPrecommandes();
            console.log('Pré-commandes rechargées avec succès');
            
            // Réinitialiser la variable globale
            precommandeEnCoursDeModification = null;
            
        } else {
            alert('Erreur lors de la modification: ' + data.message);
        }
        
    } catch (error) {
        console.error('Erreur lors de la modification:', error);
        alert('Erreur lors de la modification de la pré-commande');
    } finally {
        hideLoadingSpinner();
    }
}

// Supprimer une pré-commande
async function supprimerPrecommande(precommandeId) {
    const currentUser = window.currentUser;
    const isSuperviseur = currentUser && (currentUser.role === 'superviseur' || currentUser.role === 'admin');
    
    // Vérifier les permissions côté client
    if (!isSuperviseur) {
        alert('Vous n\'avez pas les permissions pour supprimer cette pré-commande.');
        return;
    }
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette pré-commande ?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/precommandes/${precommandeId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Pré-commande supprimée avec succès');
            await chargerPrecommandes(); // Recharger la liste
        } else {
            alert('Erreur lors de la suppression: ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        alert('Erreur lors de la suppression de la pré-commande');
    }
}

// Initialisation des événements pour le formulaire de pré-commande
document.addEventListener('DOMContentLoaded', function() {
    // Bouton ajouter produit
    const ajouterProduitBtn = document.getElementById('ajouter-produit-precommande');
    if (ajouterProduitBtn) {
        ajouterProduitBtn.addEventListener('click', creerNouvelleEntreePrecommande);
    }
    
    // Formulaire de soumission
    const precommandeForm = document.getElementById('precommande-form');
    if (precommandeForm) {
        precommandeForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            await soumettrePrecommande();
        });
    }
    
    // Boutons de filtrage
    const filtrerBtn = document.getElementById('filtrer-precommandes');
    if (filtrerBtn) {
        filtrerBtn.addEventListener('click', filtrerPrecommandes);
    }
    
    const resetBtn = document.getElementById('reset-filtres-precommandes');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFiltresPrecommandes);
    }
    
    // Initialiser la première entrée de produit
    const premiereProduitEntry = document.querySelector('.precommande-produit-entry');
    if (premiereProduitEntry) {
        setupPrecommandeEntryEvents(premiereProduitEntry);
    }
    
    // Bouton de confirmation de conversion
    const confirmerConversionBtn = document.getElementById('confirmer-conversion');
    if (confirmerConversionBtn) {
        confirmerConversionBtn.addEventListener('click', confirmerConversion);
    }
    
    
    // Bouton de confirmation d'annulation
    const confirmerCancelBtn = document.getElementById('confirmer-cancel');
    if (confirmerCancelBtn) {
        confirmerCancelBtn.addEventListener('click', confirmerAnnulation);
    }
    
    // Bouton de confirmation d'archivage
    const confirmerArchiveBtn = document.getElementById('confirmer-archive');
    if (confirmerArchiveBtn) {
        confirmerArchiveBtn.addEventListener('click', confirmerArchivage);
    }
    
    // Bouton de confirmation de modification
    const confirmerModificationBtn = document.getElementById('confirmer-modification');
    if (confirmerModificationBtn) {
        confirmerModificationBtn.addEventListener('click', confirmerModification);
    }
    
    // Événements pour le modal d'édition
    const editCategorieSelect = document.getElementById('edit-categorie');
    if (editCategorieSelect) {
        editCategorieSelect.addEventListener('change', function() {
            const categorie = this.value;
            populateEditProduits(categorie);
        });
    }
    
    // Calcul automatique du montant dans le modal d'édition
    const editPrixUnit = document.getElementById('edit-prix-unit');
    const editNombre = document.getElementById('edit-nombre');
    const editMontant = document.getElementById('edit-montant');
    
    if (editPrixUnit && editNombre && editMontant) {
        const calculerMontantEdit = () => {
            const prix = parseFloat(editPrixUnit.value) || 0;
            const nombre = parseFloat(editNombre.value) || 0;
            editMontant.value = (prix * nombre).toFixed(2);
        };
        
        editPrixUnit.addEventListener('input', calculerMontantEdit);
        editNombre.addEventListener('input', calculerMontantEdit);
    }
});

// Soumettre une pré-commande (basé sur la logique de soumission des ventes)
async function soumettrePrecommande() {
    const dateEnregistrement = document.getElementById('precommande-date-enregistrement').value;
    const dateReception = document.getElementById('precommande-date-reception').value;
    const pointVente = document.getElementById('precommande-point-vente').value;
    const label = document.getElementById('precommande-label').value;
    const clientNom = document.getElementById('precommande-client-nom').value;
    const clientNumero = document.getElementById('precommande-client-numero').value;
    const clientAdresse = document.getElementById('precommande-client-adresse').value;
    const commentaire = document.getElementById('precommande-commentaire').value;
    
    if (!dateEnregistrement || !dateReception || !pointVente) {
        alert('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    const entriesToProcess = document.querySelectorAll('.precommande-produit-entry');
    const entries = [];
    
    entriesToProcess.forEach(entry => {
        const categorie = entry.querySelector('.precommande-categorie-select').value;
        const produit = entry.querySelector('.precommande-produit-select').value;
        const quantite = entry.querySelector('.precommande-quantite').value;
        const prixUnit = entry.querySelector('.precommande-prix-unit').value;
        const total = entry.querySelector('.precommande-total').value;
        
        if (categorie && produit && quantite && prixUnit) {
            const mois = new Date(dateEnregistrement.split('/').reverse().join('-')).toLocaleString('fr-FR', { month: 'long' });
            const semaine = `S${Math.ceil(new Date(dateEnregistrement.split('/').reverse().join('-')).getDate() / 7)}`;
            
            entries.push({
                mois,
                dateEnregistrement,
                dateReception,
                semaine,
                pointVente,
                categorie,
                produit,
                prixUnit,
                quantite,
                total,
                nomClient: clientNom,
                numeroClient: clientNumero,
                adresseClient: clientAdresse,
                commentaire,
                label
            });
        }
    });
    
    if (entries.length === 0) {
        alert('Veuillez ajouter au moins un produit');
        return;
    }
    
    showLoadingSpinner();
    
    try {
        const response = await fetch('/api/precommandes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(entries)
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Pré-commande enregistrée avec succès !');
            
            // Réinitialiser le formulaire
            resetFormulairePrecommande();
            
            // Recharger les pré-commandes
            await chargerPrecommandes();
        } else {
            alert('Erreur lors de l\'enregistrement: ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement:', error);
        alert('Erreur lors de l\'enregistrement de la pré-commande');
    } finally {
        hideLoadingSpinner();
    }
}

// Réinitialiser le formulaire de pré-commande
function resetFormulairePrecommande() {
    // Réinitialiser les champs principaux
    document.getElementById('precommande-date-enregistrement')._flatpickr.setDate(new Date());
    document.getElementById('precommande-date-reception')._flatpickr.setDate(new Date());
    document.getElementById('precommande-label').value = '';
    document.getElementById('precommande-client-nom').value = '';
    document.getElementById('precommande-client-numero').value = '';
    document.getElementById('precommande-client-adresse').value = '';
    document.getElementById('precommande-commentaire').value = '';
    
    // Garder le point de vente selon les droits de l'utilisateur
    const userPointsVente = getUserAuthorizedPointsVente();
    const pointVenteSelect = document.getElementById('precommande-point-vente');
    if (!userPointsVente.includes("tous") && userPointsVente.length === 1) {
        pointVenteSelect.value = userPointsVente[0];
        pointVenteSelect.disabled = true;
    } else {
        pointVenteSelect.value = '';
    }
    
    // Réinitialiser les entrées de produits
    const container = document.getElementById('precommande-produits-container');
    const entries = container.querySelectorAll('.precommande-produit-entry');
    
    // Garder seulement la première entrée et la réinitialiser
    entries.forEach((entry, index) => {
        if (index === 0) {
            entry.querySelectorAll('select, input').forEach(field => {
                if (field.type !== 'readonly') {
                    field.value = '';
                }
            });
        } else {
            entry.remove();
        }
    });
    
    calculerTotalGeneralPrecommande();
}

// Filtrer les pré-commandes (filtrage côté client)
function filtrerPrecommandes() {
    console.log('=== DÉBUT filtrerPrecommandes ===');
    
    // Réinitialiser la page à 1 lors du filtrage
    currentPrecommandePage = 1;
    
    const dateDebut = document.getElementById('filter-precommande-date-debut').value;
    const dateFin = document.getElementById('filter-precommande-date-fin').value;
    const pointVente = document.getElementById('filter-precommande-point-vente').value;
    const label = document.getElementById('filter-precommande-label').value;
    const statutsSelectionnes = getStatutsSelectionnes();
    
    console.log('Paramètres de filtrage:', { dateDebut, dateFin, pointVente, label, statutsSelectionnes });
    
    // Filtrage côté client
    let precommandesFiltrees = [...currentPrecommandes];
    
    // Filtrer par date de début
    if (dateDebut) {
        precommandesFiltrees = precommandesFiltrees.filter(p => {
            const datePrecommande = p['Date Enregistrement'];
            return datePrecommande && datePrecommande >= dateDebut;
        });
    }
    
    // Filtrer par date de fin
    if (dateFin) {
        precommandesFiltrees = precommandesFiltrees.filter(p => {
            const datePrecommande = p['Date Enregistrement'];
            return datePrecommande && datePrecommande <= dateFin;
        });
    }
    
    // Filtrer par point de vente
    if (pointVente && pointVente !== 'tous') {
        precommandesFiltrees = precommandesFiltrees.filter(p => 
            p['Point de Vente'] === pointVente
        );
    }
    
    // Filtrer par label
    if (label) {
        precommandesFiltrees = precommandesFiltrees.filter(p => 
            p.label === label
        );
    }
    
    // Filtrer par statut
    if (statutsSelectionnes.length > 0) {
        precommandesFiltrees = precommandesFiltrees.filter(p => 
            statutsSelectionnes.includes(p.statut || 'ouvert')
        );
    }
    
    console.log(`Filtrage terminé: ${precommandesFiltrees.length} pré-commandes sur ${currentPrecommandes.length}`);
    
    // Afficher les résultats
    afficherPrecommandes(precommandesFiltrees);
    
    // Mettre à jour le compteur
    const totalElement = document.getElementById('total-precommandes');
    if (totalElement) {
        totalElement.textContent = `${precommandesFiltrees.length} pré-commande(s) trouvée(s)`;
    }
    
    console.log('=== FIN filtrerPrecommandes ===');
}

// Réinitialiser les filtres
function resetFiltresPrecommandes() {
    document.getElementById('filter-precommande-date-debut').value = '';
    document.getElementById('filter-precommande-date-fin').value = '';
    document.getElementById('filter-precommande-point-vente').value = 'tous';
    document.getElementById('filter-precommande-label').value = '';
    
    // Réinitialiser les checkboxes de statut (seule "Ouvert" cochée)
    document.getElementById('statut-ouvert').checked = true;
    document.getElementById('statut-convertie').checked = false;
    document.getElementById('statut-annulee').checked = false;
    document.getElementById('statut-archivee').checked = false;
    
    // Mettre à jour le label (cela déclenchera automatiquement le filtrage)
    updateStatutFilterLabel();
}

// ================================
// FONCTIONS ANALYTICS DES VENTES
// ================================

// Fonction pour calculer les statistiques analytics par catégorie
function calculerAnalyticsVentes(ventes) {
    // Catégories individuelles (comme avant)
    const categoriesIndividuelles = {
        'Boeuf en gros': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Boeuf en détail': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Veau en gros': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Veau en détail': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Poulet en gros': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Poulet en détail': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Agneau': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 }
    };

    // Catégories regroupées (nouvelles) - Agneau en première position
    const categoriesRegroupees = {
        'Agneau': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Boeuf': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Veau': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Poulet': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Oeuf': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Packs': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Sur Pieds': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Divers': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Autre': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
        'Stock Soir': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 }
    };

    // Debug: Afficher toutes les catégories trouvées
    console.log('🔍 DEBUG - Toutes les catégories dans les ventes:');
    if (!ventes || !Array.isArray(ventes)) {
        console.error('❌ ERREUR: ventes est undefined ou pas un tableau:', ventes);
        return { individuelles: {}, regroupees: {} };
    }
    const categoriesTrouvees = [...new Set(ventes.map(v => v.Categorie).filter(c => c))];
    console.log('Catégories uniques:', categoriesTrouvees);
    
    // Debug: Afficher les ventes avec nom contenant "pack"
    const ventesPack = ventes.filter(v => v.Produit && v.Produit.toLowerCase().includes('pack'));
    console.log(`🔍 DEBUG - Ventes avec nom contenant "pack": ${ventesPack.length}`);
    ventesPack.forEach(v => {
        console.log(`  - ${v.Produit}: PU=${v.PU}, Qté=${v.Nombre}, Catégorie=${v.Categorie || 'undefined'}`);
    });
    
    // Debug: Afficher les ventes détectées comme "Divers"
    const ventesDivers = ventes.filter(v => {
        const produit = v.Produit ? v.Produit.toLowerCase() : '';
        return produit.includes('sans os') || 
               produit.includes('foie') || 
               produit.includes('peaux') || 
               produit.includes('jarret') || 
               produit.includes('yell') || 
               produit.includes('dechet') || 
               produit.includes('viande hachée') || 
               produit.includes('viande hachee') || 
               produit.includes('autre viande') || 
               produit.includes('tete agneau') || 
               produit.includes('tête agneau');
    });
    console.log(`🔍 DEBUG - Ventes détectées comme "Divers": ${ventesDivers.length}`);
    ventesDivers.forEach(v => {
        console.log(`  - ${v.Produit}: PU=${v.PU}, Qté=${v.Nombre}, Montant=${(parseFloat(v.PU) || 0) * (parseFloat(v.Nombre) || 0)}`);
    });

    // Debug: Compter les ventes exclues
    const ventesAbattage = ventes.filter(v => v['Point de Vente'] && v['Point de Vente'].toLowerCase() === 'abattage');
    console.log(`🔍 DEBUG - Ventes exclues (Point de vente "Abattage"): ${ventesAbattage.length}`);

    // Parcourir toutes les ventes et calculer les statistiques
    ventes.forEach(vente => {
        // Exclure les ventes du point de vente "Abattage"
        if (vente['Point de Vente'] && vente['Point de Vente'].toLowerCase() === 'abattage') {
            return; // Skip cette vente
        }
        
        const produit = vente.Produit || '';
        const prixUnitaire = parseFloat(vente.PU) || 0;
        const quantite = parseFloat(vente.Nombre) || 0;

        // Identifier les catégories individuelles
        let categorieIndividuelle = null;
        let categorieRegroupee = null;
        
        if (produit.toLowerCase().includes('boeuf en gros')) {
            categorieIndividuelle = 'Boeuf en gros';
            categorieRegroupee = 'Boeuf';
        } else if (produit.toLowerCase().includes('boeuf en détail') || produit.toLowerCase().includes('boeuf en detail')) {
            categorieIndividuelle = 'Boeuf en détail';
            categorieRegroupee = 'Boeuf';
        } else if (produit.toLowerCase().includes('veau en gros')) {
            categorieIndividuelle = 'Veau en gros';
            categorieRegroupee = 'Veau';
        } else if (produit.toLowerCase().includes('veau en détail') || produit.toLowerCase().includes('veau en detail')) {
            categorieIndividuelle = 'Veau en détail';
            categorieRegroupee = 'Veau';
        } else if (produit.toLowerCase().includes('poulet en gros')) {
            categorieIndividuelle = 'Poulet en gros';
            categorieRegroupee = 'Poulet';
        } else if (produit.toLowerCase().includes('poulet en détail') || produit.toLowerCase().includes('poulet en detail')) {
            categorieIndividuelle = 'Poulet en détail';
            categorieRegroupee = 'Poulet';
        } else if (produit.toLowerCase() === 'agneau') {
            categorieIndividuelle = 'Agneau';
            categorieRegroupee = 'Agneau';
        } else if (produit.toLowerCase() === 'oeuf' || produit.toLowerCase() === 'œuf') {
            categorieIndividuelle = 'Oeuf';
            categorieRegroupee = 'Oeuf';
            console.log(`🔍 Détection Oeuf: ${produit} - PU: ${vente.PU}, Qté: ${vente.Nombre}, Montant: ${prixUnitaire * quantite}`);
        } else if (produit.toLowerCase().includes('pack')) {
            categorieIndividuelle = 'Packs';
            categorieRegroupee = 'Packs';
            console.log(`🔍 Détection Pack: ${produit} (par nom) - PU: ${vente.PU}, Qté: ${vente.Nombre}`);
        } else if (produit.toLowerCase().includes('sur pied')) {
            categorieIndividuelle = 'Sur Pieds';
            categorieRegroupee = 'Sur Pieds';
            console.log(`🔍 Détection Sur Pieds: ${produit} - PU: ${vente.PU}, Qté: ${vente.Nombre}, Montant: ${prixUnitaire * quantite}`);
        } else if (produit.toLowerCase().includes('autre viande')) {
            categorieIndividuelle = 'Autre';
            categorieRegroupee = 'Autre';
            console.log(`🔍 Détection Autre: ${produit} - PU: ${vente.PU}, Qté: ${vente.Nombre}, Montant: ${prixUnitaire * quantite}`);
        } else if (produit.toLowerCase().includes('sans os') || 
                   produit.toLowerCase().includes('foie') || 
                   produit.toLowerCase().includes('peaux') || 
                   produit.toLowerCase().includes('jarret') || 
                   produit.toLowerCase().includes('yell') || 
                   produit.toLowerCase().includes('dechet') || 
                   produit.toLowerCase().includes('viande hachée') || 
                   produit.toLowerCase().includes('viande hachee') || 
                   produit.toLowerCase().includes('tete agneau') || 
                   produit.toLowerCase().includes('tête agneau')) {
            categorieIndividuelle = 'Divers';
            categorieRegroupee = 'Divers';
            console.log(`🔍 Détection Divers: ${produit} - PU: ${vente.PU}, Qté: ${vente.Nombre}, Montant: ${prixUnitaire * quantite}`);
        }

        // Ajouter aux catégories individuelles
        if (categorieIndividuelle && categoriesIndividuelles[categorieIndividuelle]) {
            categoriesIndividuelles[categorieIndividuelle].prixTotal += (prixUnitaire * quantite); // CA = prix × quantité
            categoriesIndividuelles[categorieIndividuelle].quantiteTotal += quantite;
            categoriesIndividuelles[categorieIndividuelle].nombreVentes += 1;
        }

        // Ajouter aux catégories regroupées
        if (categorieRegroupee && categoriesRegroupees[categorieRegroupee]) {
            categoriesRegroupees[categorieRegroupee].prixTotal += (prixUnitaire * quantite); // CA = prix × quantité
            categoriesRegroupees[categorieRegroupee].quantiteTotal += quantite;
            categoriesRegroupees[categorieRegroupee].nombreVentes += 1;
        }
        
        // Debug: Afficher les catégories non reconnues
        if (!categorieRegroupee) {
            console.log(`⚠️ Catégorie non reconnue: "${produit}" (Catégorie: ${vente.Categorie})`);
        }
    });

    // Calculer les prix moyens pondérés pour les catégories individuelles
    const resultatsIndividuels = {};
    Object.keys(categoriesIndividuelles).forEach(categorie => {
        const data = categoriesIndividuelles[categorie];
        resultatsIndividuels[categorie] = {
            prixMoyen: data.quantiteTotal > 0 ? data.prixTotal / data.quantiteTotal : 0, // Moyenne pondérée
            quantiteTotal: data.quantiteTotal,
            nombreVentes: data.nombreVentes
        };
    });

    // Calculer les prix moyens pondérés pour les catégories regroupées
    const resultatsRegroupes = {};
    Object.keys(categoriesRegroupees).forEach(categorie => {
        const data = categoriesRegroupees[categorie];
        resultatsRegroupes[categorie] = {
            prixMoyen: data.quantiteTotal > 0 ? data.prixTotal / data.quantiteTotal : 0, // Moyenne pondérée
            quantiteTotal: data.quantiteTotal,
            nombreVentes: data.nombreVentes
        };
    });
    
    // Debug: Afficher les totaux calculés pour Packs
    console.log('🔍 DEBUG - Totaux calculés pour Packs:');
    console.log('  - categoriesRegroupees.Packs:', categoriesRegroupees.Packs);
    console.log('  - resultatsRegroupes.Packs:', resultatsRegroupes.Packs);
    
    // Debug: Afficher les totaux calculés pour Oeuf
    console.log('🔍 DEBUG - Totaux calculés pour Oeuf:');
    console.log('  - categoriesRegroupees.Oeuf:', categoriesRegroupees.Oeuf);
    console.log('  - resultatsRegroupes.Oeuf:', resultatsRegroupes.Oeuf);
    
    // Debug: Afficher les totaux calculés pour Divers
    console.log('🔍 DEBUG - Totaux calculés pour Divers:');
    console.log('  - categoriesRegroupees.Divers:', categoriesRegroupees.Divers);
    console.log('  - resultatsRegroupes.Divers:', resultatsRegroupes.Divers);
    
    // Debug: Afficher les totaux calculés pour Autre
    console.log('🔍 DEBUG - Totaux calculés pour Autre:');
    console.log('  - categoriesRegroupees.Autre:', categoriesRegroupees.Autre);
    console.log('  - resultatsRegroupes.Autre:', resultatsRegroupes.Autre);

    return {
        individuelles: resultatsIndividuels,
        regroupees: resultatsRegroupes
    };
}

// Fonction pour calculer la variation du stock soir selon la logique améliorée
// Fonction pour appeler l'API de marge Stock Soir
async function calculerMargeStockSoirAPI(dateDebut, dateFin, pointVente = null) {
    try {
        console.log(`🔍 🚀 NOUVEAU: Calcul marge via API Stock Soir: ${dateDebut} à ${dateFin}, Point: ${pointVente || 'Tous'}`);
        
        // Convertir les dates au format DD/MM/YYYY pour l'API
        const formatForAPI = (dateStr) => {
            // dateStr est au format DD-MM-YYYY, convertir en DD/MM/YYYY
            return dateStr.replace(/-/g, '/');
        };
        
        const startDate = formatForAPI(dateDebut);
        const endDate = formatForAPI(dateFin);
        const pointVenteParam = pointVente || 'Sélectionner un point de vente';
        
        console.log(`📅 Dates API: ${startDate} à ${endDate}, Point de vente: ${pointVenteParam}`);
        
        // Ajouter les paramètres des ratios éditables
        const ratiosParams = `&ratioPerteBoeuf=${proxyMargesControls.ratioPerteBoeuf}&ratioPerteVeau=${proxyMargesControls.ratioPerteVeau}&calculAutoActif=${proxyMargesControls.calculAutoActif}`;
        
        const response = await fetch(`/api/external/stock-soir-marge?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&pointVente=${encodeURIComponent(pointVenteParam)}${ratiosParams}`, {
            method: 'GET',
            headers: {
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Erreur API: ${response.status} ${response.statusText}`);
        }
        
        const json = await response.json();
        // Support both old {data: {...}} and new {stockSoirMarge: {...}} shapes
        const node = json?.stockSoirMarge || json?.data;
        if (!node) {
            throw new Error('Structure de réponse inattendue (stockSoirMarge/data manquant)');
        }
        console.log(`✅ Marge API récupérée: ${Number(node.marge).toLocaleString()} FCFA`);
        console.log(`📊 Détails API: CA=${Number(node.totalCA).toLocaleString()}, Coût=${Number(node.totalCout).toLocaleString()}`);
        
        return {
            montantTotal: Number(node.marge) || 0,
            margeAPI: Number(node.marge) || 0,
            totalCA: Number(node.totalCA) || 0,
            totalCout: Number(node.totalCout) || 0,
            detailsAPI: node.detailParProduit || [],
            nombreProduits: node.nombreProduits || 0,
            type: 'marge_api',
            sourceAPI: true
        };
        
    } catch (error) {
        console.error('❌ Erreur lors du calcul de marge via API:', error);
        // Fallback vers le calcul traditionnel
        return null;
    }
}

async function calculerStockSoirVariation(dateDebut, dateFin, pointVente = null) {
    try {
        console.log(`🔍 Calcul stock soir variation: ${dateDebut} à ${dateFin}`);
        
        // Calculer d'abord le stock traditionnel pour les détails
        let resultTradiitionel = null;
        
        // Si même date, prendre le stock du jour précédent
        if (dateDebut === dateFin) {
            const datePrecedente = calculerDatePrecedente(dateDebut);
            console.log(`📅 Même date détectée, utilisation du stock du jour précédent: ${datePrecedente}`);
            const stockPrecedente = await calculerStockSoir(datePrecedente, pointVente);
            resultTradiitionel = {
                montantTotal: stockPrecedente.montantTotal,
                nombreItems: stockPrecedente.nombreItems,
                details: stockPrecedente.details,
                type: 'jour_precedent',
                dateUtilisee: datePrecedente,
                stockPrecedente: stockPrecedente
            };
        } else {
            // Calculer la variation traditionnelle (Stock fin - Stock début)
            console.log(`📅 Période différente, calcul de la variation traditionnelle`);
            
            // Utiliser dateDebut-1 pour le stock de début pour avoir la variation correcte
            const dateDebutPrecedente = calculerDatePrecedente(dateDebut);
            console.log(`📅 Stock Début: ${dateDebutPrecedente} (dateDebut-1 pour variation correcte)`);
            console.log(`📅 Stock Fin: ${dateFin}`);
            
        const stockDebut = await calculerStockSoir(dateDebutPrecedente, pointVente);
        const stockFin = await calculerStockSoir(dateFin, pointVente);
        
        // Calculer la variation des détails par produit
        const detailsVariation = {};
        const allProduits = new Set([...Object.keys(stockDebut.details || {}), ...Object.keys(stockFin.details || {})]);
        
        allProduits.forEach(produit => {
            const montantDebut = (stockDebut.details && stockDebut.details[produit]) ? stockDebut.details[produit].Montant : 0;
            const montantFin = (stockFin.details && stockFin.details[produit]) ? stockFin.details[produit].Montant : 0;
            const quantiteDebut = (stockDebut.details && stockDebut.details[produit]) ? stockDebut.details[produit].Quantite : 0;
            const quantiteFin = (stockFin.details && stockFin.details[produit]) ? stockFin.details[produit].Quantite : 0;
            
            detailsVariation[produit] = {
                Montant: montantFin - montantDebut,
                Quantite: quantiteFin - quantiteDebut,
                PointVente: (stockFin.details && stockFin.details[produit]) ? stockFin.details[produit].PointVente : 
                          (stockDebut.details && stockDebut.details[produit]) ? stockDebut.details[produit].PointVente : pointVente
            };
        });
        
            resultTradiitionel = {
            montantTotal: stockFin.montantTotal - stockDebut.montantTotal,
            nombreItems: stockFin.nombreItems - stockDebut.nombreItems,
            details: detailsVariation,
            type: 'variation',
            dateDebut: dateDebut,
            dateFin: dateFin,
            dateDebutReelle: dateDebutPrecedente, // Date réellement utilisée pour le stock de début
            stockDebut: stockDebut,
            stockFin: stockFin
        };
        }
        
        // 🚀 NOUVEAU: Remplacer SEULEMENT le montantTotal par la marge API pour Proxy Marges
        const margeAPI = await calculerMargeStockSoirAPI(dateDebut, dateFin, pointVente);
        if (margeAPI && resultTradiitionel) {
            console.log(`🎉 Remplacement du montant Stock Soir: ${resultTradiitionel.montantTotal.toLocaleString()} → ${margeAPI.montantTotal.toLocaleString()} FCFA (API)`);
            // Garder toute la structure traditionnelle mais remplacer seulement le montantTotal
            resultTradiitionel.montantTotal = margeAPI.montantTotal;
            resultTradiitionel.margeAPI = margeAPI.montantTotal; // Ajouter pour référence
            return resultTradiitionel;
        }
        
        console.log(`⚠️ Utilisation du calcul traditionnel: ${resultTradiitionel ? resultTradiitionel.montantTotal.toLocaleString() : 'N/A'} FCFA`);
        return resultTradiitionel;
        
    } catch (error) {
        console.error('❌ Erreur lors du calcul de la variation stock soir:', error);
        return { 
            montantTotal: 0, 
            nombreItems: 0,
            type: 'erreur',
            error: error.message
        };
    }
}

// Fonction pour calculer la date précédente (éviter les problèmes de timezone)
function calculerDatePrecedente(dateStr) {
    // Format DD/MM/YYYY -> DD/MM/YYYY précédent
    const [jour, mois, annee] = dateStr.split('/');
    const jourNum = parseInt(jour);
    const moisNum = parseInt(mois);
    const anneeNum = parseInt(annee);
    
    // Créer la date précédente
    let jourPrecedent = jourNum - 1;
    let moisPrecedent = moisNum;
    let anneePrecedente = anneeNum;
    
    // Gérer le passage au mois précédent
    if (jourPrecedent <= 0) {
        moisPrecedent--;
        if (moisPrecedent <= 0) {
            moisPrecedent = 12;
            anneePrecedente--;
        }
        // Dernier jour du mois précédent (approximation simple)
        jourPrecedent = 31;
    }
    
    return `${jourPrecedent.toString().padStart(2, '0')}/${moisPrecedent.toString().padStart(2, '0')}/${anneePrecedente}`;
}

// Variables globales pour les contrôles Proxy Marges
let proxyMargesControls = {
    calculAutoActif: false,
    ratioPerteBoeuf: 8.0,
    ratioPerteVeau: 8.0,
    coutManuelPacks: 0,
    coutManuelAutre: 0,
    pointVenteActuel: 'Sélectionner un point de vente',
    modeQuantiteReelle: false  // Nouveau: Mode Quantité Réelle (API) vs Ratio
};

// Variables globales pour stocker les ratios calculés par les Proxy Marges
let ratiosCalculesProxyMarges = {
    ratioBoeuf: null,
    ratioVeau: null,
    dernierCalcul: null,
    pointVente: null
};

// Variables globales pour stocker les prix moyens calculés par les Proxy Marges
let prixMoyensProxyMarges = {
    prixMoyenBoeuf: null,
    prixMoyenVeau: null,
    prixMoyenPoulet: null,
    prixMoyenAgneau: null,
    prixMoyenOeuf: null, // Égal à tablette
    dernierCalcul: null,
    pointVente: null
};

// Fonction pour initialiser les contrôles Proxy Marges
function initialiserControlesProxyMarges() {
    console.log('🎛️ Initialisation des contrôles Proxy Marges');
    
    // Écouter les changements sur le point de vente existant
    const pointVenteSelect = document.getElementById('point-vente-select');
    if (pointVenteSelect) {
        pointVenteSelect.addEventListener('change', function() {
            const pointVente = this.value;
            console.log(`📍 Point de vente changé: ${pointVente}`);
            proxyMargesControls.pointVenteActuel = pointVente;
            updateProxyMargesControls(pointVente);
        });
    }
    
    // Écouter les changements sur la checkbox de calcul automatique
    const calculAutoCheckbox = document.getElementById('calcul-auto-abattage');
    if (calculAutoCheckbox) {
        calculAutoCheckbox.addEventListener('change', function() {
            proxyMargesControls.calculAutoActif = this.checked;
            console.log(`🔄 Calcul automatique: ${proxyMargesControls.calculAutoActif ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`);
            updateProxyMargesControls(proxyMargesControls.pointVenteActuel);
        });
    }
    
    // Écouter les changements sur les ratios
    const ratioBoeufInput = document.getElementById('ratio-perte-boeuf');
    const ratioVeauInput = document.getElementById('ratio-perte-veau');
    
    if (ratioBoeufInput) {
        ratioBoeufInput.addEventListener('input', function() {
            proxyMargesControls.ratioPerteBoeuf = parseFloat(this.value) || 8.0;
            console.log(`🐄 Ratio Boeuf mis à jour: ${proxyMargesControls.ratioPerteBoeuf}%`);
        });
    }
    
    if (ratioVeauInput) {
        ratioVeauInput.addEventListener('input', function() {
            proxyMargesControls.ratioPerteVeau = parseFloat(this.value) || 8.0;
            console.log(`🐄 Ratio Veau mis à jour: ${proxyMargesControls.ratioPerteVeau}%`);
        });
    }
    
    // Écouter les changements sur les coûts manuels
    const coutPacksInput = document.getElementById('cout-manuel-packs');
    const coutAutreInput = document.getElementById('cout-manuel-autre');
    
    if (coutPacksInput) {
        coutPacksInput.addEventListener('input', function() {
            proxyMargesControls.coutManuelPacks = parseFloat(this.value) || 0;
            console.log(`📦 Coût Packs mis à jour: ${proxyMargesControls.coutManuelPacks} FCFA`);
        });
    }
    
    if (coutAutreInput) {
        coutAutreInput.addEventListener('input', function() {
            proxyMargesControls.coutManuelAutre = parseFloat(this.value) || 0;
            console.log(`🍖 Coût Autre mis à jour: ${proxyMargesControls.coutManuelAutre} FCFA`);
        });
    }
    
    // Écouter le bouton de recalcul
    const recalculerBtn = document.getElementById('recalculer-proxy-marges');
    if (recalculerBtn) {
        recalculerBtn.addEventListener('click', function() {
            console.log('🔄 Recalcul des Proxy Marges demandé');
            // Déclencher le recalcul des proxy marges
            if (typeof calculerEtAfficherProxyMarges === 'function') {
                calculerEtAfficherProxyMarges();
            }
        });
    }
}

// Fonction pour mettre à jour l'état des contrôles selon le point de vente
function updateProxyMargesControls(pointVente) {
    const calculAutoCheckbox = document.getElementById('calcul-auto-abattage');
    const recalculerBtn = document.getElementById('recalculer-proxy-marges');
    const autoStatus = document.querySelector('#calcul-auto-abattage').nextElementSibling;
    const recalculerStatus = document.querySelector('#recalculer-proxy-marges').nextElementSibling;
    const nomPointVente = document.getElementById('nom-point-vente');
    
    // Mettre à jour l'affichage du nom du point de vente
    if (nomPointVente) {
        if (pointVente === 'Sélectionner un point de vente' || pointVente === '') {
            nomPointVente.textContent = 'Tous les points de vente';
            nomPointVente.className = 'text-muted';
        } else {
            nomPointVente.textContent = pointVente;
            nomPointVente.className = 'text-primary fw-bold';
        }
    }
    
    if (pointVente === 'Sélectionner un point de vente' || pointVente === '') {
        // Tous les points de vente - mode désactivé par défaut
        if (calculAutoCheckbox) {
            calculAutoCheckbox.checked = false;
            calculAutoCheckbox.disabled = false; // Mais utilisateur peut l'activer manuellement
        }
        if (autoStatus) autoStatus.textContent = '(Auto: OFF)';
        if (recalculerStatus) recalculerStatus.textContent = '(Inactif)';
        if (recalculerBtn) recalculerBtn.disabled = true;
        
        console.log('⚠️ Mode automatique désactivé (tous les points de vente)');
    } else {
        // Point de vente spécifique - mode activé par défaut
        if (calculAutoCheckbox) {
            calculAutoCheckbox.checked = true;
            calculAutoCheckbox.disabled = false; // Mais utilisateur peut le désactiver manuellement
        }
        if (autoStatus) autoStatus.textContent = '(Auto: ON)';
        if (recalculerStatus) recalculerStatus.textContent = '(Actif)';
        if (recalculerBtn) recalculerBtn.disabled = false;
        
        console.log(`✅ Mode automatique activé pour: ${pointVente}`);
    }
    
    // Mettre à jour l'état global
    proxyMargesControls.calculAutoActif = calculAutoCheckbox ? calculAutoCheckbox.checked : false;
    
    // Gérer l'affichage du toggle Mode Calcul
    updateModeCalculToggle(pointVente);
}

// Fonction pour gérer l'affichage et les événements du toggle Mode Calcul
function updateModeCalculToggle(pointVente) {
    // Supprimer l'ancien toggle s'il existe
    const existingToggle = document.getElementById('mode-calcul-container');
    if (existingToggle) {
        existingToggle.remove();
    }
    
    // Ajouter le toggle seulement pour les points de vente spécifiques
    if (pointVente !== 'Sélectionner un point de vente' && pointVente !== '') {
        const toggleHTML = `
            <div id="mode-calcul-container" style="margin: 15px 0; padding: 10px; background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                <div style="font-weight: bold; color: #856404; margin-bottom: 10px;">🔄 Mode Calcul Qté Abattue</div>
                <div style="display: flex; gap: 20px; align-items: center;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="radio" name="mode-calcul" value="ratio" id="mode-ratio" checked 
                               style="margin-right: 8px; transform: scale(1.1);">
                        <span style="color: #856404;">📐 Ratio</span>
                    </label>
                    <!-- 📊 Quantité Réelle (API) temporairement cachée -->
                    <div style="display: none;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="radio" name="mode-calcul" value="quantite-reelle" id="mode-quantite-reelle" 
                                   style="margin-right: 8px; transform: scale(1.1);">
                            <span style="color: #856404;">📊 Quantité Réelle (API)</span>
                        </label>
                    </div>
                </div>
                <div style="font-size: 0.85em; color: #6c757d; margin-top: 5px; font-style: italic;">
                    <span id="mode-calcul-description">
                        ${proxyMargesControls.modeQuantiteReelle ? 'Utilise les vraies quantités d\'abattage via API réconciliation' : 'Utilise les ratios de perte saisis/calculés'}
                    </span>
                </div>
            </div>
        `;
        
        // Insérer après l'élément de calcul automatique
        const calculAutoContainer = document.querySelector('#calcul-auto-abattage').closest('div').parentElement;
        if (calculAutoContainer && calculAutoContainer.nextSibling) {
            calculAutoContainer.insertAdjacentHTML('afterend', toggleHTML);
        }
        
        // Ajouter les événements pour les radio buttons
        const modeRatioInput = document.getElementById('mode-ratio');
        const modeQuantiteReelleInput = document.getElementById('mode-quantite-reelle');
        const descriptionSpan = document.getElementById('mode-calcul-description');
        
        if (modeRatioInput) {
            modeRatioInput.addEventListener('change', function() {
                if (this.checked) {
                    proxyMargesControls.modeQuantiteReelle = false;
                    descriptionSpan.textContent = 'Utilise les ratios de perte saisis/calculés';
                    console.log('🔄 Mode Calcul: RATIO activé');
                }
            });
        }
        
        if (modeQuantiteReelleInput) {
            modeQuantiteReelleInput.addEventListener('change', function() {
                if (this.checked) {
                    proxyMargesControls.modeQuantiteReelle = true;
                    descriptionSpan.textContent = 'Utilise les vraies quantités d\'abattage via API réconciliation';
                    console.log('🔄 Mode Calcul: QUANTITÉ RÉELLE (API) activé');
                }
            });
        }
        
        console.log(`🎛️ Toggle Mode Calcul ajouté pour point de vente: ${pointVente}`);
    } else {
        // Forcer le mode ratio pour les points de vente globaux
        proxyMargesControls.modeQuantiteReelle = false;
        console.log('🔄 Mode global: Mode Ratio forcé');
    }
    
    // 🚫 FORCE: Toujours utiliser le mode Ratio (Quantité Réelle désactivé temporairement)
    proxyMargesControls.modeQuantiteReelle = false;
}

// Fonction pour récupérer les quantités réelles d'abattage via API réconciliation
async function fetchQuantitesReellesAbattage(dateDebut, dateFin, pointVente) {
    try {
        console.log(`🔍 Récupération quantités réelles d'abattage: ${dateDebut} à ${dateFin}, Point: ${pointVente}`);
        
        // Validation et sécurisation des dates
        if (!dateDebut || !dateFin || !dateDebut.includes('/') || !dateFin.includes('/')) {
            throw new Error(`Dates invalides: dateDebut=${dateDebut}, dateFin=${dateFin}`);
        }
        
        // Convertir les dates au format requis par l'API (DD/MM/YYYY -> YYYY-MM-DD)
        const startDate = dateDebut.split('/').reverse().join('-');
        const endDate = dateFin.split('/').reverse().join('-');
        
        // Validation des dates converties (vérifier que l'année est cohérente)
        if (!startDate.startsWith('20') || !endDate.startsWith('20')) {
            throw new Error(`Années converties invalides: ${startDate}, ${endDate} depuis ${dateDebut}, ${dateFin}`);
        }
        
        console.log(`🔍 Conversion dates: ${dateDebut} -> ${startDate}, ${dateFin} -> ${endDate}`);
        
        const url = `/api/external/reconciliation/aggregated?startDate=${startDate}&endDate=${endDate}&pointVente=${encodeURIComponent(pointVente)}`;
        
        const response = await fetch(url, {
            headers: {
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📊 Données réconciliation reçues:', data);
        
        if (data.success && data.data && data.data.ventesTheoriquesNombre) {
            const ventesTheoriques = data.data.ventesTheoriquesNombre;
            
            const quantitesReelles = {
                qteAbattueBoeuf: ventesTheoriques.boeuf || 0,
                qteAbattueVeau: ventesTheoriques.veau || 0,
                source: 'API_RECONCILIATION',
                metadata: {
                    periode: `${dateDebut} - ${dateFin}`,
                    pointVente: pointVente,
                    timestamp: new Date().toISOString()
                }
            };
            
            console.log('🎯 Quantités réelles extraites:', quantitesReelles);
            return quantitesReelles;
            
        } else {
            console.warn('⚠️ Structure de données inattendue ou données manquantes:', data);
            return null;
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération des quantités réelles:', error);
        return null;
    }
}

// Fonction pour filtrer les analytics par point de vente (OPTIMISÉE)
async function filtrerAnalyticsParPointVente(analyticsRegroupees, pointVente, dateDebut, dateFin) {
    try {
        console.log(`🚀 FILTRAGE OPTIMISÉ des analytics pour ${pointVente} du ${dateDebut} au ${dateFin}`);
        
        // Calculer le nombre de jours pour info
        const [jourDebut, moisDebut, anneeDebut] = dateDebut.split('/');
        const [jourFin, moisFin, anneeFin] = dateFin.split('/');
        const start = new Date(anneeDebut, moisDebut - 1, jourDebut);
        const end = new Date(anneeFin, moisFin - 1, jourFin);
        const nombreJours = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        
        console.log(`📡 UN SEUL APPEL API au lieu de ${nombreJours} appels pour récupérer toutes les ventes !`);
        
        // Convertir les dates au format YYYY-MM-DD pour l'API /api/ventes
        const formatDateForApi = (dateStr) => {
            const [jour, mois, annee] = dateStr.split('/');
            return `${annee}-${mois}-${jour}`;
        };
        
        const dateDebutAPI = formatDateForApi(dateDebut);
        const dateFinAPI = formatDateForApi(dateFin);
        
        // RÉVOLUTIONNAIRE: UN SEUL appel API au lieu de nombreux appels répétés !
        const response = await fetch(`/api/external/ventes?dateDebut=${dateDebutAPI}&dateFin=${dateFinAPI}&pointVente=${encodeURIComponent(pointVente)}`, {
            method: 'GET',
            headers: {
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
            }
        });
        
        let toutesVentesFiltrees = [];
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.ventes && Array.isArray(data.ventes)) {
                toutesVentesFiltrees = data.ventes;
                console.log(`✅ OPTIMISATION RÉUSSIE: ${data.ventes.length} ventes récupérées en 1 appel au lieu de ${nombreJours} appels !`);
            } else {
                console.log(`ℹ️ Aucune vente trouvée pour la période spécifiée`);
            }
        } else {
            console.warn(`⚠️ Erreur lors de la récupération des ventes: ${response.status}`);
        }
        
        console.log(`📊 Total ventes filtrées pour ${pointVente}: ${toutesVentesFiltrees.length} ventes`);
        
        if (toutesVentesFiltrees.length === 0) {
            console.log(`⚠️ Aucune vente trouvée pour ${pointVente} sur la période`);
            return {}; // Retourner un objet vide si aucune vente
        }
        
        // Recalculer les analytics avec toutes les ventes du point de vente sélectionné
        const analyticsFiltrees = calculerAnalyticsVentes(toutesVentesFiltrees);
        
        console.log(`✅ Analytics filtrées pour ${pointVente}:`, analyticsFiltrees);
        return analyticsFiltrees.regroupees;
        
    } catch (error) {
        console.error(`❌ Erreur filtrage analytics pour ${pointVente}:`, error);
        return analyticsRegroupees; // Retourner les données non filtrées en cas d'erreur
    }
}

// Fonction pour générer les dates entre deux dates
function genererDatesEntre(dateDebut, dateFin) {
    const dates = [];
    const start = new Date(dateDebut);
    const end = new Date(dateFin);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        // Convertir au format DD/MM/YYYY
        const jour = String(d.getDate()).padStart(2, '0');
        const mois = String(d.getMonth() + 1).padStart(2, '0');
        const annee = d.getFullYear();
        dates.push(`${jour}/${mois}/${annee}`);
    }
    
    return dates;
}

// Fonction pour calculer le ratio de perte dynamique
async function calculerRatioPerteDynamique(dateDebut, dateFin, pointVente, categorie) {
    try {
        console.log(`🔍 Calcul ratio perte dynamique: ${categorie} pour ${pointVente} du ${dateDebut} au ${dateFin}`);
        
        // Générer toutes les dates entre dateDebut et dateFin au format DD-MM-YYYY
        const dates = [];
        // Les dates arrivent au format DD/MM/YYYY, on les parse correctement
        const [jourDebut, moisDebut, anneeDebut] = dateDebut.split('/');
        const [jourFin, moisFin, anneeFin] = dateFin.split('/');
        
        const start = new Date(anneeDebut, moisDebut - 1, jourDebut);
        const end = new Date(anneeFin, moisFin - 1, jourFin);
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const jour = String(d.getDate()).padStart(2, '0');
            const mois = String(d.getMonth() + 1).padStart(2, '0');
            const annee = d.getFullYear();
            dates.push(`${jour}-${mois}-${annee}`); // Format DD-MM-YYYY
        }
        
        console.log(`📅 Dates à traiter: ${dates.length} dates`);
        
        let sommeVentesNombre = 0;
        let sommeVentesTheoriquesNombre = 0;
        let datesAvecDonnees = 0;
        
        // Appeler l'API pour chaque date et accumuler les sommes
        for (const date of dates) {
            try {
                const response = await fetch(`/api/external/reconciliation?date=${encodeURIComponent(date)}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
                    }
                });
                
                if (!response.ok) {
                    console.log(`⚠️ Erreur API reconciliation pour ${date}: ${response.status}`);
                    continue;
                }
                
                const data = await response.json();
                
                if (data.success && data.data && data.data.details && data.data.details[pointVente] && data.data.details[pointVente][categorie]) {
                    const details = data.data.details[pointVente][categorie];
                    const ventesNombre = parseFloat(details.ventesNombre) || 0;
                    const ventesTheoriquesNombre = parseFloat(details.ventesTheoriquesNombre) || 0;
                    
                    console.log(`🔍 DEBUG ${date} - ${categorie} (${pointVente}):`);
                    console.log(`   - ventesNombre: ${ventesNombre}`);
                    console.log(`   - ventesTheoriquesNombre: ${ventesTheoriquesNombre}`);
                    
                    // Accumuler les sommes
                    sommeVentesNombre += ventesNombre;
                    sommeVentesTheoriquesNombre += ventesTheoriquesNombre;
                    datesAvecDonnees++;
                    
                    console.log(`   ✅ Données ajoutées aux sommes (${datesAvecDonnees} dates)`);
                } else {
                    console.log(`⚠️ ${date}: Données manquantes pour ${categorie} - ${pointVente}`);
                }
            } catch (error) {
                console.log(`⚠️ Erreur pour la date ${date}:`, error);
            }
        }
        
        if (datesAvecDonnees === 0) {
            console.log(`⚠️ Aucune donnée trouvée pour ${categorie} - ${pointVente}`);
            console.log(`   - Utilisation du ratio par défaut: 8%`);
            return 0.08; // Retourner le ratio par défaut (8%)
        }
        
        // Calculer le ratio global sur la somme SANS Math.abs
        console.log(`📊 CALCUL RATIO GLOBAL pour ${categorie} - ${pointVente}:`);
        console.log(`   - Dates avec données: ${datesAvecDonnees}`);
        console.log(`   - Somme ventesNombre: ${sommeVentesNombre.toFixed(2)}`);
        console.log(`   - Somme ventesTheoriquesNombre: ${sommeVentesTheoriquesNombre.toFixed(2)}`);
        
        if (sommeVentesTheoriquesNombre > 0) {
            const ratioGlobal = (sommeVentesNombre / sommeVentesTheoriquesNombre) - 1;
            const ratioPourcentage = ratioGlobal * 100;
            
            console.log(`   - Calcul: (${sommeVentesNombre.toFixed(2)} / ${sommeVentesTheoriquesNombre.toFixed(2)}) - 1`);
            console.log(`   - = ${(sommeVentesNombre / sommeVentesTheoriquesNombre).toFixed(4)} - 1`);
            console.log(`   - = ${(sommeVentesNombre / sommeVentesTheoriquesNombre - 1).toFixed(4)}`);
            console.log(`   - = ${ratioGlobal.toFixed(4)}`);
            console.log(`   - Ratio global: ${ratioPourcentage.toFixed(2)}%`);
            
            return ratioGlobal;
        } else {
            console.log(`   ⚠️ Somme ventesTheoriquesNombre = 0, utilisation du ratio par défaut`);
            return 0.08; // 8% par défaut
        }
        
    } catch (error) {
        console.error(`❌ Erreur calcul ratio perte dynamique:`, error);
        return 0.08; // Retourner le ratio par défaut (8%)
    }
}

// Fonction pour récupérer et calculer le stock soir
async function calculerStockSoir(dateFin, pointVente = null) {
    try {
        console.log(`🔍 Récupération du stock soir pour la date: ${dateFin}`);
        
        const response = await fetch(`/api/external/stock/soir?date=${encodeURIComponent(dateFin)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
            }
        });

        if (!response.ok) {
            throw new Error(`Erreur API stock soir: ${response.status}`);
        }

        const data = await response.json();
        console.log('📊 Données stock soir reçues:', data);

        if (!data || Object.keys(data).length === 0) {
            console.log('⚠️ Aucune donnée de stock soir disponible');
            return { montantTotal: 0, nombreItems: 0 };
        }

        // Les données sont déjà filtrées par date par l'API
        // Filtrer par point de vente si spécifié
        let montantTotal = 0;
        let nombreItems = 0;
        let detailsParProduit = {};
        
        console.log(`🔍 Point de vente demandé: ${pointVente || 'Tous les points de vente'}`);
        console.log(`📊 Données reçues de l'API:`, data);
        
        // Filtrer les clés par point de vente si spécifié
        let filteredData = data;
        if (pointVente && pointVente !== 'Sélectionner un point de vente') {
            filteredData = {};
            Object.entries(data).forEach(([key, item]) => {
                // Extraire le point de vente de la clé (premier élément avant le tiret)
                const pointVenteFromKey = key.split('-')[0];
                console.log(`🔍 Clé: ${key} → Point de vente extrait: ${pointVenteFromKey}`);
                
                if (pointVenteFromKey === pointVente) {
                    filteredData[key] = item;
                    console.log(`✅ Item accepté: ${key} (${item.Produit}) - Montant: ${item.Montant} FCFA`);
                } else {
                    console.log(`❌ Item ignoré: ${key} (${pointVenteFromKey} ≠ ${pointVente})`);
                }
            });
            console.log(`📊 Données filtrées pour ${pointVente}:`, filteredData);
        }
        
        Object.entries(filteredData).forEach(([key, item]) => {
            console.log(`📋 Traitement: ${item.Produit || key} - Point de vente: ${item['Point de Vente']} - Montant: ${item.Montant} FCFA`);
            
            const montant = parseFloat(item.Montant) || 0;
            const quantite = parseFloat(item.Nombre) || 0;
            montantTotal += montant;
            nombreItems++;
            
            // Stocker les détails par produit
            const nomProduit = item.Produit || key;
            if (!detailsParProduit[nomProduit]) {
                detailsParProduit[nomProduit] = { 
                    Montant: 0, 
                    Quantite: 0,
                    PointVente: item['Point de Vente'],
                    PrixUnitaire: parseFloat(item['PU']) || 0
                };
            }
            detailsParProduit[nomProduit].Montant += montant;
            detailsParProduit[nomProduit].Quantite += quantite;
            
            console.log(`  ✅ ${nomProduit} (${item['Point de Vente']}): ${quantite} ${item['PU'] ? '× ' + item['PU'] + ' = ' : ''}${montant} FCFA`);
        });

        console.log(`💰 Montant total stock soir: ${montantTotal} FCFA`);

        return {
            montantTotal: montantTotal,
            nombreItems: nombreItems,
            details: detailsParProduit
        };

    } catch (error) {
        console.error('❌ Erreur lors du calcul du stock soir:', error);
        return { montantTotal: 0, nombreItems: 0 };
    }
}

// Fonction pour afficher les analytics dans l'interface
async function afficherAnalyticsVentes(ventes) {
    const container = document.getElementById('analytics-container');
    if (!container) return;

    // Afficher un loader pendant le calcul
    const loaderHtml = `
        <div class="text-center py-2 mt-3" id="analytics-loader">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Chargement...</span>
            </div>
            <div class="mt-2">
                <h5>Calcul des analytics en cours...</h5>
                <p class="text-muted">Calcul des ratios dynamiques et des proxy marges</p>
            </div>
        </div>
    `;
    container.innerHTML = loaderHtml;

    console.log('🚀 Début du calcul optimisé des analytics et proxy marges');

    const analytics = calculerAnalyticsVentes(ventes);
    
    // Calculer les proxy marges (avec ratios dynamiques si nécessaire)
    await calculerEtAfficherProxyMarges(analytics.regroupees);
    
    console.log('✅ Calcul terminé, masquage du loader');
    
    // Créer le HTML pour afficher les analytics
    let html = '';
    
    // Section des catégories regroupées (nouvelles)
    html += '<div class="col-12 mb-4"><h6 class="text-primary mb-3"><i class="fas fa-chart-pie me-2"></i>Vue d\'ensemble par catégorie</h6></div>';
    Object.keys(analytics.regroupees).forEach(categorie => {
        const data = analytics.regroupees[categorie];
        const prixMoyen = data.prixMoyen.toFixed(0);
        const quantiteTotal = data.quantiteTotal.toFixed(0);
        
        html += `
            <div class="col-md-4 mb-3">
                <div class="card border-success h-100">
                    <div class="card-body text-center">
                        <h6 class="card-title text-success">${categorie}</h6>
                        <div class="row">
                            <div class="col-6">
                                <div class="mb-2">
                                    <small class="text-muted">Prix Moyen</small>
                                    <div class="fw-bold text-success">${prixMoyen} FCFA</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-2">
                                    <small class="text-muted">Quantité Total</small>
                                    <div class="fw-bold text-info">${quantiteTotal}</div>
                                </div>
                            </div>
                        </div>
                        <small class="text-muted">${data.nombreVentes} vente(s)</small>
                    </div>
                </div>
            </div>
        `;
    });
    
    // Section des catégories individuelles (comme avant)
    html += '<div class="col-12 mb-4 mt-4"><h6 class="text-primary mb-3"><i class="fas fa-list me-2"></i>Détail par type de vente</h6></div>';
    Object.keys(analytics.individuelles).forEach(categorie => {
        const data = analytics.individuelles[categorie];
        const prixMoyen = data.prixMoyen.toFixed(0);
        const quantiteTotal = data.quantiteTotal.toFixed(0);
        
        html += `
            <div class="col-md-6 col-lg-4 mb-3">
                <div class="card border-primary h-100">
                    <div class="card-body text-center">
                        <h6 class="card-title text-primary">${categorie}</h6>
                        <div class="row">
                            <div class="col-6">
                                <div class="mb-2">
                                    <small class="text-muted">Prix Moyen</small>
                                    <div class="fw-bold text-success">${prixMoyen} FCFA</div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="mb-2">
                                    <small class="text-muted">Quantité Total</small>
                                    <div class="fw-bold text-info">${quantiteTotal}</div>
                                </div>
                            </div>
                        </div>
                        <small class="text-muted">${data.nombreVentes} vente(s)</small>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Fonction pour calculer et afficher les proxy marges
async function calculerEtAfficherProxyMarges(analyticsRegroupees) {
    const proxyMargesContainer = document.getElementById('proxy-marges-container');
    if (!proxyMargesContainer) return;

    try {
        // Récupérer les dates de la période actuelle
        const dateDebut = document.getElementById('date-debut').value;
        const dateFin = document.getElementById('date-fin').value;
        
        if (!dateDebut || !dateFin) {
            proxyMargesContainer.innerHTML = '<div class="text-muted">Sélectionnez une période pour calculer les proxy marges</div>';
            return;
        }
        
        console.log(`🔍 Calcul des proxy marges pour la période: ${dateDebut} à ${dateFin}`);

        // Récupérer les prix d'achat fixes
        const prixAchatPoulet = parseFloat(document.getElementById('prix-achat-poulet').value) || 2600;
        const prixAchatAgneau = parseFloat(document.getElementById('prix-achat-agneau').value) || 4000;
        const prixAchatOeuf = parseFloat(document.getElementById('prix-achat-oeuf').value) || 2200;

        // Récupérer les données d'achat pour la période via l'API externe
        const dateDebutObj = new Date(dateDebut.split('/').reverse().join('-'));
        const dateFinObj = new Date(dateFin.split('/').reverse().join('-'));
        const dateDebutFormatted = dateDebutObj.toISOString().split('T')[0];
        const dateFinFormatted = dateFinObj.toISOString().split('T')[0];
        
        console.log(`🔍 Récupération prix d'achat pour Proxy Marges: ${dateDebutFormatted} à ${dateFinFormatted}`);
        
        const response = await fetch(`/api/external/achats-boeuf?startDate=${dateDebutFormatted}&endDate=${dateFinFormatted}`, {
            headers: {
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
            }
        });

        let prixAchatBoeuf = 3500; // Valeur par défaut
        let prixAchatVeau = 3300; // Valeur par défaut
        let poidsTotalBoeuf = 0;
        let poidsTotalVeau = 0;
        let achatsPeriode = [];
        let totals = null; // Déclarer totals en dehors pour l'utiliser dans les calculs

        if (response.ok) {
            const achatsData = await response.json();
            console.log('📊 Données d\'achats récupérées pour Proxy Marges:', achatsData);
            
            if (achatsData.success && achatsData.data) {
                // Récupérer les prix moyens pondérés depuis les totals (priorité aux pondérés)
                if (achatsData.data.totals) {
                    totals = achatsData.data.totals;
                    // Utiliser les moyennes pondérées si disponibles, sinon fallback sur moyennes simples
                    if (totals.avgWeightedPrixKgBoeuf && totals.avgWeightedPrixKgBoeuf > 0) {
                        prixAchatBoeuf = totals.avgWeightedPrixKgBoeuf;
                        console.log(`🎯 Boeuf - Utilisation prix pondéré: ${prixAchatBoeuf.toFixed(2)} FCFA/kg`);
                    } else if (totals.avgPrixKgBoeuf && totals.avgPrixKgBoeuf > 0) {
                        prixAchatBoeuf = totals.avgPrixKgBoeuf;
                        console.log(`🎯 Boeuf - Utilisation prix simple: ${prixAchatBoeuf.toFixed(2)} FCFA/kg`);
                    }
                    
                    if (totals.avgWeightedPrixKgVeau && totals.avgWeightedPrixKgVeau > 0) {
                        prixAchatVeau = totals.avgWeightedPrixKgVeau;
                        console.log(`🎯 Veau - Utilisation prix pondéré: ${prixAchatVeau.toFixed(2)} FCFA/kg`);
                    } else if (totals.avgPrixKgVeau && totals.avgPrixKgVeau > 0) {
                        prixAchatVeau = totals.avgPrixKgVeau;
                        console.log(`🎯 Veau - Utilisation prix simple: ${prixAchatVeau.toFixed(2)} FCFA/kg`);
                    }
                    
                    // Récupérer les poids totaux
                    poidsTotalBoeuf = totals.totalKgBoeuf || 0;
                    poidsTotalVeau = totals.totalKgVeau || 0;
                    
                    console.log(`🐄 Boeuf - Prix final: ${prixAchatBoeuf.toFixed(2)} FCFA/kg, Poids total: ${poidsTotalBoeuf} kg`);
                    console.log(`🐂 Veau - Prix final: ${prixAchatVeau.toFixed(2)} FCFA/kg, Poids total: ${poidsTotalVeau} kg`);
                }
                
                // Récupérer les achats détaillés pour les logs
                if (achatsData.data.achats && Array.isArray(achatsData.data.achats)) {
                    achatsPeriode = achatsData.data.achats;
                    console.log(`📊 Total achats pour la période: ${achatsPeriode.length}`);
                    
                    const boeufAchats = achatsPeriode.filter(achat => 
                        achat.bete && achat.bete.toLowerCase() === 'boeuf'
                    );
                    const veauAchats = achatsPeriode.filter(achat => 
                        achat.bete && achat.bete.toLowerCase() === 'veau'
                    );
                    
                    if (boeufAchats.length > 0) {
                        console.log(`🐄 DÉTAIL ACHATS BOEUF (${boeufAchats.length} achats):`);
                        boeufAchats.forEach((achat, index) => {
                            console.log(`   ${index + 1}. Date: ${achat.date}, Prix/kg: ${achat.prix_achat_kg} FCFA, Poids: ${achat.nbr_kg} kg`);
                        });
                    }
                    
                    if (veauAchats.length > 0) {
                        console.log(`🐂 DÉTAIL ACHATS VEAU (${veauAchats.length} achats):`);
                        veauAchats.forEach((achat, index) => {
                            console.log(`   ${index + 1}. Date: ${achat.date}, Prix/kg: ${achat.prix_achat_kg} FCFA, Poids: ${achat.nbr_kg} kg`);
                        });
                    }
                }
            }
        }
        
        // Si aucune donnée d'achat trouvée, afficher un message
        if (achatsPeriode.length === 0) {
            console.log('⚠️ Aucun achat trouvé pour cette période');
            proxyMargesContainer.innerHTML = '<div class="text-warning">Aucun achat trouvé pour cette période</div>';
            return;
        }

        // Récupérer le stock soir selon la logique améliorée (filtré par point de vente si spécifique)
        const stockSoir = await calculerStockSoirVariation(dateDebut, dateFin, proxyMargesControls.pointVenteActuel);
        console.log(`📊 Stock soir récupéré: ${stockSoir.montantTotal} FCFA (${stockSoir.nombreItems} items)`);

        // 📦 Récupérer les données des packs via l'API
        let packCostData = null;
        if (proxyMargesControls.pointVenteActuel && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
            try {
                const [jourDebut, moisDebut, anneeDebut] = dateDebut.split('/');
                const [jourFin, moisFin, anneeFin] = dateFin.split('/');
                const startDatePack = `${anneeDebut}-${moisDebut}-${jourDebut}`;
                const endDatePack = `${anneeFin}-${moisFin}-${jourFin}`;
                
                const boeufPackAchat = 3400;
                const veauPackAchat = 3550;
                const agneauPackAchat = 3800;
                const pouletPackAchat = 2800;
                const oeufPackAchat = 2500;
                
                const packApiUrl = `/api/external/ventes-date/pack/aggregated?start_date=${startDatePack}&end_date=${endDatePack}&pointVente=${encodeURIComponent(proxyMargesControls.pointVenteActuel)}&boeufPackAchat=${boeufPackAchat}&veauPackAchat=${veauPackAchat}&agneauPackAchat=${agneauPackAchat}&pouletPackAchat=${pouletPackAchat}&oeufPackAchat=${oeufPackAchat}`;
                
                console.log(`📦 Appel API pack: ${packApiUrl}`);
                
                const packResponse = await fetch(packApiUrl, {
                    headers: {
                        'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
                    }
                });
                
                if (packResponse.ok) {
                    const packData = await packResponse.json();
                    
                    if (packData.success && packData.pointsVente && packData.pointsVente[proxyMargesControls.pointVenteActuel]) {
                        packCostData = packData.pointsVente[proxyMargesControls.pointVenteActuel];
                        console.log(`📦 Données pack récupérées:`, {
                            montantInformatif: packCostData.montantInformatif,
                            montantTotal: packCostData.montantTotal,
                            margeAbsolue: packCostData.margeAbsolue,
                            margePourcentage: packCostData.margePourcentage
                        });
                    }
                }
            } catch (error) {
                console.error(`❌ Erreur lors de l'appel API pack:`, error);
            }
        }

        // Récupérer les quantités réelles d'abattage si le mode Quantité Réelle est activé
        let quantitesReelles = null;
        // 🚫 Mode Quantité Réelle temporairement désactivé
        // if (proxyMargesControls.modeQuantiteReelle && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
        //     quantitesReelles = await fetchQuantitesReellesAbattage(dateDebut, dateFin, proxyMargesControls.pointVenteActuel);
        //     if (quantitesReelles) {
        //         console.log(`🎯 Mode Quantité Réelle activé - Quantités d'abattage récupérées:`, quantitesReelles);
        //     } else {
        //         console.warn(`⚠️ Mode Quantité Réelle: Échec récupération, fallback vers mode Ratio`);
        //     }
        // }

        // 🚀 CALCUL UNIQUE DE LA MARGE STOCK SOIR (sera utilisée partout)
        // Cette marge sera la SEULE source de vérité !
        let totauxStockSoir = null;
        
        // On va calculer les totaux Stock Soir APRÈS les autres proxy marges pour avoir accès aux prix moyens
        let totauxStockSoirPromise = null;
        if (stockSoir.type === 'variation' && stockSoir.stockDebut && stockSoir.stockFin) {
            console.log(`🚀 PREPARATION: Calcul de la marge Stock Soir sera fait après les autres proxy marges...`);
            totauxStockSoirPromise = {
                stockDebut: stockSoir.stockDebut.details || {},
                stockFin: stockSoir.stockFin.details || {},
                dateDebut: stockSoir.dateDebut,
                dateFin: stockSoir.dateFin,
                pointVente: proxyMargesControls.pointVenteActuel
            };
            // ⚡ Calculer IMMÉDIATEMENT les totaux via l'API pour éviter le fallback à 512 360 FCFA
            try {
                console.log(`🚀 CALCUL IMMÉDIAT: Appel de l'API Stock Soir Marge (pré-boucle)...`);
                totauxStockSoir = await calculerMargeStockSoirViaAPI(
                    totauxStockSoirPromise.dateDebut,
                    totauxStockSoirPromise.dateFin,
                    totauxStockSoirPromise.pointVente,
                    prixMoyensProxyMarges
                );
                if (totauxStockSoir) {
                    console.log(`✅ CALCUL API (pré-boucle): ${totauxStockSoir.marge.toFixed(0)} FCFA`);
                }
            } catch (e) {
                console.warn('⚠️ API Stock Soir Marge (pré-boucle) indisponible, on tentera plus tard:', e.message);
            }
        } else {
            console.log(`⚠️ Type de Stock Soir non géré pour calcul détaillé: ${stockSoir.type}`);
        }

        // Filtrer les données analytics par point de vente si spécifique
        let analyticsRegroupeesFiltrees = analyticsRegroupees;
        if (proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
            console.log(`🔍 Filtrage des données pour le point de vente: ${proxyMargesControls.pointVenteActuel}`);
            const filteredData = await filtrerAnalyticsParPointVente(analyticsRegroupees, proxyMargesControls.pointVenteActuel, dateDebut, dateFin);
            
            // Protection contre les erreurs API
            if (filteredData && typeof filteredData === 'object') {
                analyticsRegroupeesFiltrees = filteredData;
                console.log(`✅ Données filtrées avec succès pour ${proxyMargesControls.pointVenteActuel}`);
            } else {
                console.warn(`⚠️ Échec du filtrage pour ${proxyMargesControls.pointVenteActuel}, utilisation des données globales`);
                analyticsRegroupeesFiltrees = analyticsRegroupees; // Fallback vers données globales
            }
        }

        // Calculer les ratios dynamiques si le calcul automatique est activé
        let ratioBoeufDynamique = proxyMargesControls.ratioPerteBoeuf / 100;
        let ratioVeauDynamique = proxyMargesControls.ratioPerteVeau / 100;
        let ratioAgneauDynamique = 0; // Ratio de perte pour l'agneau (0 par défaut)
        
        if (proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
            // Afficher un loader dans la section Proxy Marges
            const proxyMargesSection = document.getElementById('proxy-marges-section');
            if (proxyMargesSection) {
                const existingLoader = document.getElementById('ratio-calcul-spinner');
                if (existingLoader) existingLoader.remove();
                
                const spinnerElement = document.createElement('div');
                spinnerElement.id = 'ratio-calcul-spinner';
                spinnerElement.className = 'alert alert-info text-center mb-3';
                spinnerElement.innerHTML = `
                    <i class="fas fa-spinner fa-spin me-2"></i>
                    <strong>Calcul des ratios dynamiques en cours...</strong>
                    <div class="small text-muted mt-1">Point de vente: ${proxyMargesControls.pointVenteActuel}</div>
                `;
                
                // Insérer le spinner au début de la section Proxy Marges
                const firstChild = proxyMargesSection.firstChild;
                if (firstChild) {
                    proxyMargesSection.insertBefore(spinnerElement, firstChild);
                } else {
                    proxyMargesSection.appendChild(spinnerElement);
                }
            }
            
            try {
                console.log(`🔄 Calcul OPTIMISÉ des ratios dynamiques pour ${proxyMargesControls.pointVenteActuel}`);
                
                // OPTIMISATION: UN SEUL appel au lieu de 62
                const ratios = await calculerRatiosPerteOptimise(dateDebut, dateFin, proxyMargesControls.pointVenteActuel);
                if (ratios.boeuf !== null) ratioBoeufDynamique = ratios.boeuf;
                if (ratios.veau !== null) ratioVeauDynamique = ratios.veau;
                if (ratios.agneau !== null) ratioAgneauDynamique = ratios.agneau;
                
                console.log(`📊 Ratios dynamiques calculés (OPTIMISÉ):`);
                console.log(`   - Boeuf: ${(ratioBoeufDynamique * 100).toFixed(2)}%`);
                console.log(`   - Veau: ${(ratioVeauDynamique * 100).toFixed(2)}%`);
                console.log(`   - Agneau: ${(ratioAgneauDynamique * 100).toFixed(2)}%`);
                
                // Sauvegarder les ratios calculés dans la variable globale pour réutilisation
                ratiosCalculesProxyMarges.ratioBoeuf = ratioBoeufDynamique;
                ratiosCalculesProxyMarges.ratioVeau = ratioVeauDynamique;
                ratiosCalculesProxyMarges.ratioAgneau = ratioAgneauDynamique;
                ratiosCalculesProxyMarges.dernierCalcul = new Date();
                ratiosCalculesProxyMarges.pointVente = proxyMargesControls.pointVenteActuel;
                console.log(`💾 Ratios sauvegardés pour réutilisation par Stock Soir`);
                
                // Sauvegarder aussi les prix moyens pour réutilisation par Stock Soir  
                prixMoyensProxyMarges.dernierCalcul = new Date();
                prixMoyensProxyMarges.pointVente = proxyMargesControls.pointVenteActuel;
                console.log(`💾 Prix moyens sauvegardés pour réutilisation par Stock Soir:`);
                console.log(`   - Boeuf: ${prixMoyensProxyMarges.prixMoyenBoeuf ? prixMoyensProxyMarges.prixMoyenBoeuf.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                console.log(`   - Veau: ${prixMoyensProxyMarges.prixMoyenVeau ? prixMoyensProxyMarges.prixMoyenVeau.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                console.log(`   - Poulet: ${prixMoyensProxyMarges.prixMoyenPoulet ? prixMoyensProxyMarges.prixMoyenPoulet.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                console.log(`   - Agneau: ${prixMoyensProxyMarges.prixMoyenAgneau ? prixMoyensProxyMarges.prixMoyenAgneau.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                console.log(`   - Oeuf/Tablette: ${prixMoyensProxyMarges.prixMoyenOeuf ? prixMoyensProxyMarges.prixMoyenOeuf.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                
                // Mettre à jour les champs de ratio éditables avec les nouvelles valeurs calculées
                mettreAJourRatiosEditables(ratioBoeufDynamique, ratioVeauDynamique);
                
                // ========== AJUSTEMENT RECLASSIFICATION BOEUF → VEAU (FRONTEND) ==========
                // Détecter si du bœuf a été vendu comme veau
                if (analyticsRegroupeesFiltrees['Veau'] && analyticsRegroupeesFiltrees['Veau'].quantiteTotal > 0 && ratios) {
                    try {
                        // Récupérer les données brutes de réconciliation déjà disponibles
                        const formatDateForApi = (dateStr) => dateStr.replace(/\//g, '-');
                        const startDateFormatted = formatDateForApi(dateDebut);
                        const endDateFormatted = formatDateForApi(dateFin);
                        
                        const reconResponse = await fetch(`/api/external/reconciliation/aggregated?startDate=${startDateFormatted}&endDate=${endDateFormatted}`, {
                            headers: { 'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1' }
                        });
                        
                        if (reconResponse.ok) {
                            const reconData = await reconResponse.json();
                            
                            if (reconData.success && reconData.data.details[proxyMargesControls.pointVenteActuel]) {
                                const pointData = reconData.data.details[proxyMargesControls.pointVenteActuel];
                                
                                if (pointData.Veau) {
                                    const ventesTheoriquesVeau = parseFloat(pointData.Veau.ventesTheoriquesNombre) || 0;
                                    const ecartVeau = parseFloat(pointData.Veau.ecartNombre) || 0;
                                    const veauDepuisBoeuf = ecartVeau < 0 ? Math.abs(ecartVeau) : 0;
                                    
                                    if (veauDepuisBoeuf > 0) {
                                        console.log(`🔄 FRONTEND: Reclassification Bœuf → Veau détectée: ${veauDepuisBoeuf} kg`);
                                        window.reclassificationBoeufVeau = {
                                            veauDepuisBoeuf: veauDepuisBoeuf,
                                            veauPur: ventesTheoriquesVeau,
                                            ratioVeauPur: ratios.veau || 0
                                        };
                                        console.log(`   📊 Veau pur: ${ventesTheoriquesVeau} kg, Veau du bœuf: ${veauDepuisBoeuf} kg`);
                                    } else {
                                        window.reclassificationBoeufVeau = null;
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.warn('⚠️ Erreur récupération reclassification:', err);
                        window.reclassificationBoeufVeau = null;
                    }
                } else {
                    window.reclassificationBoeufVeau = null;
                }
                // ========== FIN AJUSTEMENT RECLASSIFICATION ==========
                
            } catch (error) {
                console.error('❌ Erreur calcul ratios dynamiques:', error);
            } finally {
                // Supprimer le spinner
                const spinnerElement = document.getElementById('ratio-calcul-spinner');
                if (spinnerElement) {
                    spinnerElement.remove();
                }
            }
        }

        // Précalculer les totaux Stock Soir si nécessaire (en utilisant la MÊME logique que le détail)
        // 🎯 AUCUN CALCUL ICI : utiliser directement totauxStockSoir pré-calculé

        // Calculer les proxy marges
        const proxyMarges = {};
        
        // Protection finale contre les données undefined/null
        if (!analyticsRegroupeesFiltrees || typeof analyticsRegroupeesFiltrees !== 'object') {
            console.error('❌ analyticsRegroupeesFiltrees est undefined/null, arrêt du calcul');
            proxyMargesContainer.innerHTML = '<div class="alert alert-warning">Erreur de données, impossible de calculer les proxy marges</div>';
            return;
        }
        
        Object.keys(analyticsRegroupeesFiltrees).forEach(categorie => {
            const data = analyticsRegroupeesFiltrees[categorie];
            let chiffreAffaires;
            let coutAchat = 0;
            
            // Calcul spécial pour Stock Soir
            if (categorie === 'Stock Soir') {
                // Le chiffre d'affaires sera calculé dans le case 'Stock Soir'
                chiffreAffaires = 0; // Sera remplacé par le calcul spécifique
            } else {
                chiffreAffaires = data.prixMoyen * data.quantiteTotal;
            }
            
            switch (categorie) {
                case 'Boeuf':
                    // Toujours utiliser le prix pondéré si disponible
                    const prixPondereBoeuf = (totals && totals.avgWeightedPrixKgBoeuf) ? totals.avgWeightedPrixKgBoeuf : prixAchatBoeuf;
                    
                    // Calculer la quantité abattue selon le mode
                    let quantiteAbattueBoeuf;
                    let ratioCalculeBoeuf = ratioBoeufDynamique; // Ratio par défaut
                    
                    if (proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                        
                        if (proxyMargesControls.modeQuantiteReelle && quantitesReelles && quantitesReelles.qteAbattueBoeuf > 0) {
                            // 🆕 MODE QUANTITÉ RÉELLE : Utiliser les vraies quantités d'abattage
                            quantiteAbattueBoeuf = quantitesReelles.qteAbattueBoeuf;
                            ratioCalculeBoeuf = (data.quantiteTotal / quantiteAbattueBoeuf) - 1;
                            console.log(`🎯 Boeuf - MODE QUANTITÉ RÉELLE: Qté abattue API = ${quantiteAbattueBoeuf.toFixed(2)} kg, Ratio calculé = ${(ratioCalculeBoeuf * 100).toFixed(2)}%`);
                            coutAchat = prixPondereBoeuf * quantiteAbattueBoeuf;
                        } else {
                            // 📐 MODE RATIO : Utiliser les ratios pour calculer la quantité abattue
                        quantiteAbattueBoeuf = data.quantiteTotal / (1 + ratioBoeufDynamique);
                            console.log(`📐 Boeuf - MODE RATIO: Qté abattue calculée = ${quantiteAbattueBoeuf.toFixed(2)} kg, Ratio utilisé = ${(ratioBoeufDynamique * 100).toFixed(2)}%`);
                            coutAchat = prixPondereBoeuf * quantiteAbattueBoeuf;
                        }
                    } else {
                        // Mode manuel : utiliser les données globales
                        quantiteAbattueBoeuf = poidsTotalBoeuf;
                        coutAchat = prixPondereBoeuf * poidsTotalBoeuf;
                    }
                    
                    // Appliquer la reclassification si détectée
                    if (window.reclassificationBoeufVeau && window.reclassificationBoeufVeau.veauDepuisBoeuf > 0) {
                        const ancienneQte = quantiteAbattueBoeuf;
                        const ancienCout = coutAchat;
                        
                        quantiteAbattueBoeuf -= window.reclassificationBoeufVeau.veauDepuisBoeuf;
                        coutAchat = prixPondereBoeuf * quantiteAbattueBoeuf;
                        ratioCalculeBoeuf = (data.quantiteTotal / quantiteAbattueBoeuf) - 1;
                        
                        console.log(`🔄 Bœuf ajusté (reclassification): ${ancienneQte.toFixed(2)} → ${quantiteAbattueBoeuf.toFixed(2)} kg`);
                        console.log(`   Coût ajusté: ${ancienCout.toFixed(0)} → ${coutAchat.toFixed(0)} FCFA`);
                    }
                    
                    console.log(`💪 CALCUL PROXY MARGE BOEUF:`);
                    console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                    console.log(`   - Quantité vendue: ${data.quantiteTotal} kg`);
                    console.log(`   - Quantité abattue: ${quantiteAbattueBoeuf.toFixed(2)} kg`);
                    console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                    console.log(`   - Prix achat utilisé: ${prixPondereBoeuf.toFixed(2)} FCFA/kg (${(totals && totals.avgWeightedPrixKgBoeuf) ? 'pondéré' : 'simple'})`);
                    console.log(`   - Coût d'achat: ${prixPondereBoeuf.toFixed(2)} × ${quantiteAbattueBoeuf.toFixed(2)} = ${coutAchat.toFixed(0)} FCFA`);
                    console.log(`   - Marge: ${chiffreAffaires.toFixed(0)} - ${coutAchat.toFixed(0)} = ${(chiffreAffaires - coutAchat).toFixed(0)} FCFA`);
                    
                    // Sauvegarder le prix moyen pour réutilisation par Stock Soir
                    prixMoyensProxyMarges.prixMoyenBoeuf = data.prixMoyen;
                    console.log(`   - Ratio ${proxyMargesControls.modeQuantiteReelle && quantitesReelles ? 'calculé' : 'dynamique'}: ${(ratioCalculeBoeuf * 100).toFixed(2)}%`);
                    console.log(`   - Mode: ${proxyMargesControls.calculAutoActif ? 'ACTIF' : 'INACTIF'} | Calcul: ${proxyMargesControls.modeQuantiteReelle ? 'Quantité Réelle (API)' : 'Ratio'}`);
                    break;
                case 'Veau':
                    // Toujours utiliser le prix pondéré si disponible
                    const prixPondereVeau = (totals && totals.avgWeightedPrixKgVeau) ? totals.avgWeightedPrixKgVeau : prixAchatVeau;
                    
                    // Calculer la quantité abattue selon le mode
                    let quantiteAbattueVeau;
                    let ratioCalculeVeau = ratioVeauDynamique; // Ratio par défaut
                    
                    if (proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                        
                        if (proxyMargesControls.modeQuantiteReelle && quantitesReelles && quantitesReelles.qteAbattueVeau > 0) {
                            // 🆕 MODE QUANTITÉ RÉELLE : Utiliser les vraies quantités d'abattage
                            quantiteAbattueVeau = quantitesReelles.qteAbattueVeau;
                            ratioCalculeVeau = (data.quantiteTotal / quantiteAbattueVeau) - 1;
                            console.log(`🎯 Veau - MODE QUANTITÉ RÉELLE: Qté abattue API = ${quantiteAbattueVeau.toFixed(2)} kg, Ratio calculé = ${(ratioCalculeVeau * 100).toFixed(2)}%`);
                            coutAchat = prixPondereVeau * quantiteAbattueVeau;
                        } else {
                            // 📐 MODE RATIO : Utiliser les ratios pour calculer la quantité abattue
                        quantiteAbattueVeau = data.quantiteTotal / (1 + ratioVeauDynamique);
                            console.log(`📐 Veau - MODE RATIO: Qté abattue calculée = ${quantiteAbattueVeau.toFixed(2)} kg, Ratio utilisé = ${(ratioVeauDynamique * 100).toFixed(2)}%`);
                            coutAchat = prixPondereVeau * quantiteAbattueVeau;
                        }
                    } else {
                        // Mode manuel : utiliser les données globales
                        quantiteAbattueVeau = poidsTotalVeau;
                        coutAchat = prixPondereVeau * poidsTotalVeau;
                    }
                    
                    // Appliquer la reclassification si détectée (cas mixte)
                    if (window.reclassificationBoeufVeau && window.reclassificationBoeufVeau.veauDepuisBoeuf > 0) {
                        const veauPur = window.reclassificationBoeufVeau.veauPur;
                        const veauDepuisBoeuf = window.reclassificationBoeufVeau.veauDepuisBoeuf;
                        const ratioVeauPur = window.reclassificationBoeufVeau.ratioVeauPur;
                        
                        // Quantité abattue veau pur
                        const qteAbattueVeauPur = veauPur > 0 && (1 + ratioVeauPur) !== 0
                            ? veauPur / (1 + ratioVeauPur)
                            : veauPur;
                        
                        // Quantité totale = veau pur + veau du bœuf
                        quantiteAbattueVeau = qteAbattueVeauPur + veauDepuisBoeuf;
                        
                        // Coût mixte
                        const prixPondereBoeuf = (totals && totals.avgWeightedPrixKgBoeuf) ? totals.avgWeightedPrixKgBoeuf : prixAchatBoeuf;
                        const coutVeauPur = prixPondereVeau * qteAbattueVeauPur;
                        const coutVeauDepuisBoeuf = prixPondereBoeuf * veauDepuisBoeuf;
                        coutAchat = coutVeauPur + coutVeauDepuisBoeuf;
                        
                        // Ratio global
                        ratioCalculeVeau = (data.quantiteTotal / quantiteAbattueVeau) - 1;
                        
                        console.log(`🔄 Veau ajusté (reclassification mixte):`);
                        console.log(`   Veau pur: ${veauPur.toFixed(2)} kg, abattu: ${qteAbattueVeauPur.toFixed(2)} kg`);
                        console.log(`   Veau du bœuf: ${veauDepuisBoeuf.toFixed(2)} kg`);
                        console.log(`   Total abattu: ${quantiteAbattueVeau.toFixed(2)} kg`);
                        console.log(`   Coût veau pur: ${coutVeauPur.toFixed(0)} + Coût bœuf: ${coutVeauDepuisBoeuf.toFixed(0)} = ${coutAchat.toFixed(0)} FCFA`);
                    }
                    
                    console.log(`💪 CALCUL PROXY MARGE VEAU:`);
                    console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                    console.log(`   - Quantité vendue: ${data.quantiteTotal} kg`);
                    console.log(`   - Quantité abattue: ${quantiteAbattueVeau.toFixed(2)} kg`);
                    console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                    console.log(`   - Prix achat utilisé: ${prixPondereVeau.toFixed(2)} FCFA/kg (${(totals && totals.avgWeightedPrixKgVeau) ? 'pondéré' : 'simple'})`);
                    console.log(`   - Coût d'achat: ${prixPondereVeau.toFixed(2)} × ${quantiteAbattueVeau.toFixed(2)} = ${coutAchat.toFixed(0)} FCFA`);
                    console.log(`   - Marge: ${chiffreAffaires.toFixed(0)} - ${coutAchat.toFixed(0)} = ${(chiffreAffaires - coutAchat).toFixed(0)} FCFA`);
                    
                    // Sauvegarder le prix moyen pour réutilisation par Stock Soir
                    prixMoyensProxyMarges.prixMoyenVeau = data.prixMoyen;
                    console.log(`   - Ratio ${proxyMargesControls.modeQuantiteReelle && quantitesReelles ? 'calculé' : 'dynamique'}: ${(ratioCalculeVeau * 100).toFixed(2)}%`);
                    console.log(`   - Mode: ${proxyMargesControls.calculAutoActif ? 'ACTIF' : 'INACTIF'} | Calcul: ${proxyMargesControls.modeQuantiteReelle ? 'Quantité Réelle (API)' : 'Ratio'}`);
                    break;
                case 'Poulet':
                    coutAchat = prixAchatPoulet * data.quantiteTotal;
                    
                    // Sauvegarder le prix moyen pour réutilisation par Stock Soir
                    prixMoyensProxyMarges.prixMoyenPoulet = data.prixMoyen;
                    console.log(`💰 CALCUL PROXY MARGE POULET:`);
                    console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                    console.log(`   - Quantité vendue: ${data.quantiteTotal} kg`);
                    console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                    console.log(`   - Prix moyen achat: ${prixAchatPoulet.toFixed(2)} FCFA/kg`);
                    console.log(`   - Coût d'achat: ${coutAchat.toFixed(0)} FCFA`);
                    break;
                case 'Agneau':
                    // Calculer la quantité abattue selon le mode
                    let quantiteAbattueAgneau;
                    let ratioCalculeAgneau = ratioAgneauDynamique; // Ratio par défaut
                    
                    if (proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                        // MODE RATIO : Utiliser les ratios pour calculer la quantité abattue
                        quantiteAbattueAgneau = data.quantiteTotal / (1 + ratioAgneauDynamique);
                        console.log(`📐 Agneau - MODE RATIO: Qté abattue calculée = ${quantiteAbattueAgneau.toFixed(2)} kg, Ratio utilisé = ${(ratioAgneauDynamique * 100).toFixed(2)}%`);
                        coutAchat = prixAchatAgneau * quantiteAbattueAgneau;
                    } else {
                        // Mode manuel : utiliser la quantité vendue
                        quantiteAbattueAgneau = data.quantiteTotal;
                        coutAchat = prixAchatAgneau * data.quantiteTotal;
                    }
                    
                    // Sauvegarder le prix moyen pour réutilisation par Stock Soir
                    prixMoyensProxyMarges.prixMoyenAgneau = data.prixMoyen;
                    console.log(`💰 CALCUL PROXY MARGE AGNEAU:`);
                    console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                    console.log(`   - Quantité vendue: ${data.quantiteTotal} kg`);
                    console.log(`   - Quantité abattue: ${quantiteAbattueAgneau.toFixed(2)} kg`);
                    console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                    console.log(`   - Prix moyen achat: ${prixAchatAgneau.toFixed(2)} FCFA/kg`);
                    console.log(`   - Coût d'achat: ${prixAchatAgneau.toFixed(2)} × ${quantiteAbattueAgneau.toFixed(2)} = ${coutAchat.toFixed(0)} FCFA`);
                    console.log(`   - Marge: ${chiffreAffaires.toFixed(0)} - ${coutAchat.toFixed(0)} = ${(chiffreAffaires - coutAchat).toFixed(0)} FCFA`);
                    console.log(`   - Ratio ${proxyMargesControls.calculAutoActif ? 'dynamique' : 'manuel'}: ${(ratioCalculeAgneau * 100).toFixed(2)}%`);
                    console.log(`   - Mode: ${proxyMargesControls.calculAutoActif ? 'ACTIF' : 'INACTIF'}`);
                    break;
                case 'Oeuf':
                    coutAchat = prixAchatOeuf * data.quantiteTotal;
                    
                    // Sauvegarder le prix moyen pour réutilisation par Stock Soir (Oeuf = Tablette)
                    prixMoyensProxyMarges.prixMoyenOeuf = data.prixMoyen;
                    console.log(`💰 CALCUL PROXY MARGE OEUF/TABLETTE:`);
                    console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                    console.log(`   - Quantité vendue: ${data.quantiteTotal} kg`);
                    console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                    console.log(`   - Prix moyen achat: ${prixAchatOeuf.toFixed(2)} FCFA/kg`);
                    console.log(`   - Coût d'achat: ${coutAchat.toFixed(0)} FCFA`);
                    break;
                case 'Packs':
                    // 📦 Utiliser les données pack déjà récupérées
                    if (packCostData && packCostData.montantInformatif > 0) {
                        coutAchat = packCostData.montantInformatif;
                        
                        console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()} (API):`);
                        console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                        console.log(`   - Quantité totale: ${data.quantiteTotal} unité`);
                        console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                        console.log(`   - Coût composition (montantInformatif): ${coutAchat.toFixed(0)} FCFA`);
                        console.log(`   - Marge brute: ${packCostData.margeAbsolue || (chiffreAffaires - coutAchat)} FCFA`);
                        console.log(`   - Marge %: ${packCostData.margePourcentage || 0}%`);
                    } else {
                        // Fallback: mode manuel ou ancien comportement
                        if (!proxyMargesControls.calculAutoActif) {
                            coutAchat = 0;
                        } else {
                            coutAchat = proxyMargesControls.coutManuelPacks || chiffreAffaires;
                        }
                        
                        console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()} (Fallback):`);
                        console.log(`   - Composition: Tous les produits avec catégorie "Pack"`);
                        console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                        console.log(`   - Quantité totale: ${data.quantiteTotal} unité`);
                        console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                        console.log(`   - Coût final: ${coutAchat.toFixed(0)} FCFA`);
                    }
                    break;
                case 'Sur Pieds':
                    // Même logique que Packs: Si mode Auto OFF, forcer le coût à zéro, sinon coût = CA (pas de marge)
                    if (!proxyMargesControls.calculAutoActif) {
                        coutAchat = 0;
                        console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()}:`);
                        console.log(`   - Composition: Tous les produits "sur pied"`);
                        console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA/unité`);
                        console.log(`   - Quantité totale: ${data.quantiteTotal} unité`);
                        console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                        console.log(`   - Mode Auto: OFF - Coût forcé à 0 FCFA`);
                        console.log(`   - Coût final: ${coutAchat.toFixed(0)} FCFA`);
                    } else {
                        coutAchat = chiffreAffaires; // CA = Coût, donc Marge = 0
                        console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()}:`);
                        console.log(`   - Composition: Tous les produits "sur pied"`);
                        console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA/unité`);
                        console.log(`   - Quantité totale: ${data.quantiteTotal} unité`);
                        console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                        console.log(`   - Coût = CA (pas de marge): ${coutAchat.toFixed(0)} FCFA`);
                    }
                    break;
                case 'Divers':
                    // Pas de coût d'achat pour cette catégorie
                    coutAchat = 0;
                    console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()}:`);
                    console.log(`   - Composition: Sans Os, Foie, Peaux, Jarret, Yell, Dechet, Viande hachée, Tete Agneau`);
                    console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                    console.log(`   - Quantité totale: ${data.quantiteTotal} kg`);
                    console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                    console.log(`   - Pas de coût d'achat (produits dérivés)`);
                    break;
                case 'Autre':
                    // Si mode Auto OFF, forcer le coût à zéro, sinon coût manuel ou par défaut = CA
                    if (!proxyMargesControls.calculAutoActif) {
                        coutAchat = 0;
                        console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()}:`);
                        console.log(`   - Composition: Autre viande`);
                        console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                        console.log(`   - Quantité totale: ${data.quantiteTotal} kg`);
                        console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                        console.log(`   - Mode Auto: OFF - Coût forcé à 0 FCFA`);
                        console.log(`   - Coût final: ${coutAchat.toFixed(0)} FCFA`);
                    } else {
                        coutAchat = proxyMargesControls.coutManuelAutre || chiffreAffaires;
                        console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()}:`);
                        console.log(`   - Composition: Autre viande`);
                        console.log(`   - Prix moyen vente: ${data.prixMoyen.toFixed(0)} FCFA`);
                        console.log(`   - Quantité totale: ${data.quantiteTotal} kg`);
                        console.log(`   - Chiffre d'affaires: ${chiffreAffaires.toFixed(0)} FCFA`);
                        console.log(`   - Coût manuel: ${proxyMargesControls.coutManuelAutre} FCFA`);
                        console.log(`   - Coût final: ${coutAchat.toFixed(0)} FCFA`);
                    }
                    break;
                case 'Stock Soir':
                    // 🚀 UTILISER DIRECTEMENT LES TOTAUX PRÉ-CALCULÉS DE L'API
                    console.log(`💰 CALCUL PROXY MARGE ${categorie.toUpperCase()}:`);
                    console.log(`🎯 Point de vente sélectionné: ${proxyMargesControls.pointVenteActuel}`);
                    console.log(`🔍 DEBUG: totauxStockSoir disponible: ${!!totauxStockSoir}`);
                    console.log(`🔍 DEBUG: stockSoir.montantTotal: ${stockSoir.montantTotal}`);
                    
                    // 🎯 UTILISER LES VALEURS DÉJÀ ARRONDIES DE L'API
                    if (totauxStockSoir) {
                        // API returns already rounded values (Math.round applied server-side)
                        chiffreAffaires = totauxStockSoir.totalCA;  // Already rounded by API
                        coutAchat = totauxStockSoir.totalCout;      // Already rounded by API
                        
                        console.log(`📊 TOTAUX FINAUX STOCK SOIR (API pré-arrondis):`);
                        console.log(`   - CA API (pré-arrondi): ${chiffreAffaires} FCFA`);
                        console.log(`   - Coût API (pré-arrondi): ${coutAchat} FCFA`);
                        console.log(`   - Marge API (pré-arrondie): ${totauxStockSoir.marge} FCFA`);
                        console.log(`🎯 DEBUG: Utilisation directe des valeurs API arrondies`);
                    } else {
                        // Fallback explicite à 0 si les totaux API ne sont pas disponibles
                        chiffreAffaires = 0;
                        coutAchat = 0;
                        console.log(`⚠️ Fallback: Marge indisponible → 0 FCFA (aucun total API)`);
                        console.log(`🔍 DEBUG: Utilisation du fallback zéro pour Stock Soir`);
                    }
                    
                    // Afficher les détails selon le type de calcul
                    if (stockSoir.type === 'jour_precedent') {
                        console.log(`   - Type: Stock du jour précédent`);
                        console.log(`   - Date utilisée: ${stockSoir.dateUtilisee}`);
                        console.log(`   - Montant total: ${stockSoir.montantTotal.toFixed(0)} FCFA`);
                        console.log(`   - Nombre d'items: ${stockSoir.nombreItems}`);
                    } else if (stockSoir.type === 'variation') {
                        console.log(`   - Type: Variation entre deux dates`);
                        console.log(`   - Date début: ${stockSoir.dateDebut} (${stockSoir.stockDebut.montantTotal.toFixed(0)} FCFA)`);
                        console.log(`   - Date fin: ${stockSoir.dateFin} (${stockSoir.stockFin.montantTotal.toFixed(0)} FCFA)`);
                        console.log(`   - Variation: ${stockSoir.montantTotal.toFixed(0)} FCFA`);
                        console.log(`   - Nombre d'items: ${stockSoir.nombreItems}`);
                    }
                    
                    console.log(`   - TOTAUX CALCULÉS:`);
                    console.log(`   - CA total: ${chiffreAffaires.toFixed(0)} FCFA`);
                    console.log(`   - Coût total: ${coutAchat.toFixed(0)} FCFA`);
                    console.log(`   - Marge totale: ${(chiffreAffaires - coutAchat).toFixed(0)} FCFA`);
                    console.log(`   - Point de vente: ${proxyMargesControls.pointVenteActuel}`);
                    break;
            }
            
            // Calculate final margin with API-style precision
            const finalMarge = chiffreAffaires - coutAchat;
            
            // For Stock Soir, use API's already-rounded values; for others, apply API-style rounding
            if (categorie === 'Stock Soir' && totauxStockSoir) {
                // Stock Soir: Use API's exact rounded values (no additional rounding)
                proxyMarges[categorie] = {
                    chiffreAffaires: totauxStockSoir.totalCA,    // API's rounded value
                    coutAchat: totauxStockSoir.totalCout,        // API's rounded value
                    proxyMarge: totauxStockSoir.marge,           // API's rounded value
                    prixAchat: 0  // N/A for Stock Soir
                };
            } else {
                // Other categories: Apply API-style rounding (round final result only)
                proxyMarges[categorie] = {
                    chiffreAffaires: Math.round(chiffreAffaires),  // API-style: round final CA
                    coutAchat: Math.round(coutAchat),              // API-style: round final cost
                    proxyMarge: Math.round(finalMarge),            // API-style: round final margin
                    prixAchat: categorie === 'Boeuf' ? prixAchatBoeuf : 
                              categorie === 'Veau' ? prixAchatVeau :
                              categorie === 'Poulet' ? prixAchatPoulet : 
                              categorie === 'Agneau' ? prixAchatAgneau :
                              categorie === 'Oeuf' ? prixAchatOeuf : 0
                };
            }
        });

        // Calculer le total des proxy marges
        const totalProxyMarges = Object.values(proxyMarges).reduce((total, marge) => total + marge.proxyMarge, 0);
        
        // Afficher les proxy marges
        let html = '';
        Object.keys(proxyMarges).forEach(categorie => {
            const marge = proxyMarges[categorie];
            const couleur = marge.proxyMarge >= 0 ? 'success' : 'danger';
            let icone = marge.proxyMarge >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
            
            // Icônes spécifiques par catégorie
            if (categorie === 'Packs') {
                icone = 'fa-box';
            } else if (categorie === 'Sur Pieds') {
                icone = 'fa-horse-head';
            } else if (categorie === 'Divers') {
                icone = 'fa-ellipsis-h';
            }
            
            // Récupérer la quantité depuis les analytics filtrées
            const quantiteVendue = analyticsRegroupeesFiltrees[categorie] ? analyticsRegroupeesFiltrees[categorie].quantiteTotal : 0;
            // Afficher le prix moyen issu des analytics; pour Agneau, forcer exact prix utilisé par l'API si disponible
            const prixMoyenAffiche = (categorie === 'Agneau' && prixMoyensProxyMarges?.prixMoyenAgneau)
                ? prixMoyensProxyMarges.prixMoyenAgneau
                : (analyticsRegroupeesFiltrees[categorie]?.prixMoyen ?? 0);
            
            // Calculer la quantité abattue selon le mode (dynamique ou statique)
            let quantiteAbattue = quantiteVendue;
            if (categorie === 'Boeuf' && proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                // Utiliser le ratio dynamique pour Boeuf
                quantiteAbattue = quantiteVendue / (1 + ratioBoeufDynamique);
                
                // Appliquer la reclassification si détectée
                if (window.reclassificationBoeufVeau && window.reclassificationBoeufVeau.veauDepuisBoeuf > 0) {
                    quantiteAbattue -= window.reclassificationBoeufVeau.veauDepuisBoeuf;
                }
                
                console.log(`🐄 Boeuf - Qté vendue: ${quantiteVendue} kg, Ratio dynamique: ${(ratioBoeufDynamique * 100).toFixed(2)}%, Qté abattue: ${quantiteAbattue.toFixed(2)} kg`);
            } else if (categorie === 'Veau' && proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                // Utiliser le ratio dynamique pour Veau
                quantiteAbattue = quantiteVendue / (1 + ratioVeauDynamique);
                
                // Appliquer la reclassification si détectée (cas mixte)
                if (window.reclassificationBoeufVeau && window.reclassificationBoeufVeau.veauDepuisBoeuf > 0) {
                    const veauPur = window.reclassificationBoeufVeau.veauPur;
                    const veauDepuisBoeuf = window.reclassificationBoeufVeau.veauDepuisBoeuf;
                    const ratioVeauPur = window.reclassificationBoeufVeau.ratioVeauPur;
                    
                    // Quantité abattue veau pur
                    const qteAbattueVeauPur = veauPur > 0 && (1 + ratioVeauPur) !== 0
                        ? veauPur / (1 + ratioVeauPur)
                        : veauPur;
                    
                    // Quantité totale = veau pur + veau du bœuf
                    quantiteAbattue = qteAbattueVeauPur + veauDepuisBoeuf;
                }
                
                console.log(`🐄 Veau - Qté vendue: ${quantiteVendue} kg, Ratio dynamique: ${(ratioVeauDynamique * 100).toFixed(2)}%, Qté abattue: ${quantiteAbattue.toFixed(2)} kg`);
            } else if (categorie === 'Agneau' && proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                // Utiliser le ratio dynamique pour Agneau
                quantiteAbattue = quantiteVendue / (1 + ratioAgneauDynamique);
                console.log(`🐑 Agneau - Qté vendue: ${quantiteVendue} kg, Ratio dynamique: ${(ratioAgneauDynamique * 100).toFixed(2)}%, Qté abattue: ${quantiteAbattue.toFixed(2)} kg`);
            } else if (categorie === 'Boeuf') {
                // Mode statique pour Boeuf
                quantiteAbattue = poidsTotalBoeuf;
            } else if (categorie === 'Veau') {
                // Mode statique pour Veau
                quantiteAbattue = poidsTotalVeau;
            }
            
            // Calculer le ratio de perte
            let ratioPerte = 0;
            let couleurRatio = 'warning';
            
            if (Math.abs(quantiteAbattue) > 0) {
                if (categorie === 'Boeuf' && proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                    // Pour le mode dynamique, recalculer le ratio avec la quantité ajustée (après reclassification)
                    ratioPerte = ((quantiteVendue / quantiteAbattue) - 1) * 100;
                } else if (categorie === 'Veau' && proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                    // Pour le mode dynamique, recalculer le ratio avec la quantité ajustée (après reclassification)
                    ratioPerte = ((quantiteVendue / quantiteAbattue) - 1) * 100;
                } else if (categorie === 'Agneau' && proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                    // Pour le mode dynamique Agneau, recalculer le ratio
                    ratioPerte = ((quantiteVendue / quantiteAbattue) - 1) * 100;
                } else {
                    // Pour le mode statique, calculer le ratio à partir des quantités
                    // Si les deux quantités sont négatives (variation de stock), garder le signe négatif correct
                    if (quantiteVendue < 0 && quantiteAbattue < 0) {
                        ratioPerte = ((Math.abs(quantiteVendue) / Math.abs(quantiteAbattue)) - 1) * -100;
                        console.log(`📊 ${categorie} - Variation de stock négative détectée - Ratio corrigé`);
                    } else {
                        ratioPerte = ((quantiteVendue / quantiteAbattue) - 1) * 100;
                    }
                }
                
                // Déterminer la couleur selon le signe du ratio
                if (ratioPerte < 0) {
                    couleurRatio = 'info'; // Bleu pour ratio normal (on vend moins qu'on abat)
                } else if (ratioPerte > 0) {
                    couleurRatio = 'warning'; // Orange pour survente (on vend plus qu'on abat)
                } else {
                    couleurRatio = 'success'; // Vert pour équilibre parfait
                }
            }
            
            html += `
                <div class="mb-3">
                    <div class="d-flex justify-content-between align-items-center">
                        <span class="fw-bold">${categorie}</span>
                        <span class="badge bg-${couleur}">
                            <i class="fas ${icone} me-1"></i>
                            ${marge.proxyMarge.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA
                        </span>
                    </div>
                    ${categorie === 'Divers' ? '<small class="text-muted d-block mb-2"><i class="fas fa-info-circle me-1"></i>Sans Os, Foie, Peaux, Jarret, Yell, Dechet, Viande hachée, Tete Agneau</small>' : ''}
                    ${categorie === 'Autre' ? '<small class="text-muted d-block mb-2"><i class="fas fa-info-circle me-1"></i>Autre viande</small>' : ''}
                    ${categorie === 'Stock Soir' ? '<small class="text-muted d-block mb-2"><i class="fas fa-info-circle me-1"></i>Stock soir (date de fin)</small>' : ''}
                    <div class="row mt-1">
                        <div class="col-6">
                            ${categorie === 'Stock Soir' ? 
                                `<small class="text-muted d-block">Montant total: ${marge.chiffreAffaires.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</small>
                                 <small class="text-muted d-block">Nombre d'items: ${stockSoir.nombreItems}</small>
                                 ${stockSoir.type === 'jour_precedent' ? 
                                    `<small class="text-info d-block">Stock du jour précédent (${stockSoir.dateUtilisee})</small>` :
                                    stockSoir.type === 'variation' ?
                                    `<small class="text-info d-block">Variation: ${stockSoir.dateDebut} → ${stockSoir.dateFin}</small>
                                     <small class="text-muted d-block">Début: ${stockSoir.stockDebut.montantTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</small>
                                     <small class="text-muted d-block">Fin: ${stockSoir.stockFin.montantTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</small>` :
                                    `<small class="text-info d-block">Pas de coût d'achat</small>`
                                 }
                                 <button class="btn btn-sm btn-outline-info mt-1" id="btn-detail-stock-soir" onclick="afficherDetailStockSoirAvecSpinner('${stockSoir.type}', '${stockSoir.dateUtilisee || stockSoir.dateDebut}', '${stockSoir.dateFin || ''}', '${proxyMargesControls.pointVenteActuel}')" title="Voir le détail pour ${proxyMargesControls.pointVenteActuel}">
                                     <i class="fas fa-info-circle"></i> Détail
                                 </button>` :
                                `<small class="text-muted d-block">Prix vente: ${(+prixMoyenAffiche).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA/${categorie === 'Poulet' || categorie === 'Oeuf' || categorie === 'Packs' || categorie === 'Sur Pieds' || categorie === 'Divers' || categorie === 'Autre' ? 'unité' : 'kg'}</small>
                                 ${categorie === 'Packs' && marge.coutAchat > 0 && marge.coutAchat !== marge.chiffreAffaires ? 
                                    `<small class="text-success d-block">💰 Coût composition calculé</small>` :
                                    marge.prixAchat > 0 ? 
                                    `<small class="text-muted d-block">Prix achat: ${marge.prixAchat.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA/${categorie === 'Poulet' || categorie === 'Oeuf' || categorie === 'Packs' || categorie === 'Sur Pieds' || categorie === 'Divers' || categorie === 'Autre' ? 'unité' : 'kg'}</small>` : 
                                    '<small class="text-info d-block">Pas de coût d\'achat</small>'
                                 }
                                 <small class="text-muted d-block">Qté vendue: ${quantiteVendue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${categorie === 'Poulet' || categorie === 'Oeuf' || categorie === 'Packs' || categorie === 'Sur Pieds' || categorie === 'Divers' || categorie === 'Autre' ? 'unité' : 'kg'}</small>
                                 ${categorie !== 'Packs' && categorie !== 'Sur Pieds' && categorie !== 'Divers' && categorie !== 'Autre' && categorie !== 'Stock Soir' && categorie !== 'Poulet' && categorie !== 'Oeuf' ? `<small class="text-muted d-block">Qté abattue: ${quantiteAbattue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} kg</small>` : ''}
                                 ${categorie !== 'Packs' && categorie !== 'Sur Pieds' && categorie !== 'Divers' && categorie !== 'Autre' && categorie !== 'Stock Soir' && categorie !== 'Poulet' && categorie !== 'Oeuf' ? `<small class="text-${couleurRatio} d-block">Ratio perte: ${ratioPerte >= 0 ? '+' : ''}${ratioPerte.toFixed(1)}%</small>` : ''}`
                            }
                        </div>
                        <div class="col-6">
                            <small class="text-muted d-block">CA: ${marge.chiffreAffaires.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</small>
                            <small class="text-muted d-block">Coût: ${marge.coutAchat.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</small>
                        </div>
                    </div>
                </div>
            `;
        });
        
        // Ajouter le total des proxy marges
        const couleurTotal = totalProxyMarges >= 0 ? 'success' : 'danger';
        const iconeTotal = totalProxyMarges >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        
        // Formater le total avec des espaces pour faciliter la lecture
        const totalFormate = totalProxyMarges.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        
        html += `
            <hr>
            <div class="d-flex justify-content-between align-items-center">
                <span class="fw-bold">TOTAL PROXY MARGES</span>
                <span class="badge bg-${couleurTotal} fs-6">
                    <i class="fas ${iconeTotal} me-1"></i>
                    ${totalFormate} FCFA
                </span>
            </div>
        `;

        proxyMargesContainer.innerHTML = html;
        
        // Mettre à jour les champs ratios éditables si nous ne sommes pas en mode dynamique
        if (!proxyMargesControls.calculAutoActif || proxyMargesControls.pointVenteActuel === 'Sélectionner un point de vente') {
            try {
                console.log(`🔄 Mode statique: Calcul des ratios globaux pour mise à jour des champs éditables`);
                
                // Calculer les ratios globaux pour Boeuf et Veau à partir des analytics et des achats
                let ratioBoeufGlobal = null;
                let ratioVeauGlobal = null;
                
                // Utiliser les mêmes données que dans le calcul des proxy marges
                if (analyticsRegroupeesFiltrees['Boeuf'] && poidsTotalBoeuf > 0) {
                    const quantiteVendueBoeuf = analyticsRegroupeesFiltrees['Boeuf'].quantiteTotal || 0;
                    ratioBoeufGlobal = ((quantiteVendueBoeuf / poidsTotalBoeuf) - 1);
                    console.log(`🐄 Ratio Boeuf global: (${quantiteVendueBoeuf} / ${poidsTotalBoeuf}) - 1 = ${(ratioBoeufGlobal * 100).toFixed(2)}%`);
                }
                
                if (analyticsRegroupeesFiltrees['Veau'] && poidsTotalVeau > 0) {
                    const quantiteVendueVeau = analyticsRegroupeesFiltrees['Veau'].quantiteTotal || 0;
                    ratioVeauGlobal = ((quantiteVendueVeau / poidsTotalVeau) - 1);
                    console.log(`🐂 Ratio Veau global: (${quantiteVendueVeau} / ${poidsTotalVeau}) - 1 = ${(ratioVeauGlobal * 100).toFixed(2)}%`);
                }
                
                // Mettre à jour les champs éditables avec les ratios calculés
                if (ratioBoeufGlobal !== null || ratioVeauGlobal !== null) {
                    mettreAJourRatiosEditables(ratioBoeufGlobal, ratioVeauGlobal);
                    
                    // NOUVEAU: Sauvegarder aussi les ratios en mode statique pour réutilisation par Stock Soir
                    if (ratioBoeufGlobal !== null) ratiosCalculesProxyMarges.ratioBoeuf = ratioBoeufGlobal;
                    if (ratioVeauGlobal !== null) ratiosCalculesProxyMarges.ratioVeau = ratioVeauGlobal;
                    ratiosCalculesProxyMarges.dernierCalcul = new Date();
                    ratiosCalculesProxyMarges.pointVente = 'Sélectionner un point de vente';
                    console.log(`💾 Ratios statiques sauvegardés pour réutilisation par Stock Soir:`);
                    console.log(`   - Boeuf: ${ratioBoeufGlobal ? (ratioBoeufGlobal * 100).toFixed(2) + '%' : 'N/A'}`);
                    console.log(`   - Veau: ${ratioVeauGlobal ? (ratioVeauGlobal * 100).toFixed(2) + '%' : 'N/A'}`);
                    
                    // Sauvegarder aussi les prix moyens pour réutilisation par Stock Soir
                    prixMoyensProxyMarges.dernierCalcul = new Date();
                    prixMoyensProxyMarges.pointVente = 'Sélectionner un point de vente';
                    console.log(`💾 Prix moyens sauvegardés pour réutilisation par Stock Soir:`);
                    console.log(`   - Boeuf: ${prixMoyensProxyMarges.prixMoyenBoeuf ? prixMoyensProxyMarges.prixMoyenBoeuf.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                    console.log(`   - Veau: ${prixMoyensProxyMarges.prixMoyenVeau ? prixMoyensProxyMarges.prixMoyenVeau.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                    console.log(`   - Poulet: ${prixMoyensProxyMarges.prixMoyenPoulet ? prixMoyensProxyMarges.prixMoyenPoulet.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                    console.log(`   - Agneau: ${prixMoyensProxyMarges.prixMoyenAgneau ? prixMoyensProxyMarges.prixMoyenAgneau.toFixed(0) + ' FCFA/kg' : 'N/A'}`);
                    console.log(`   - Oeuf/Tablette: ${prixMoyensProxyMarges.prixMoyenOeuf ? prixMoyensProxyMarges.prixMoyenOeuf.toFixed(0) + ' FCFA/kg' : 'N/A'}`);

                    // Le calcul de la marge Stock Soir via l'API sera exécuté plus bas
                } else {
                    console.log(`⚠️ Pas de données Boeuf/Veau ou pas de quantités abattues pour calculer les ratios`);
                }
                
            } catch (error) {
                console.warn('Erreur lors du calcul des ratios globaux en mode statique:', error);
            }
        }

        // API already called pre-boucle to avoid fallback; reuse totauxStockSoir

    } catch (error) {
        console.error('Erreur lors du calcul des proxy marges:', error);
        proxyMargesContainer.innerHTML = '<div class="text-danger">Erreur lors du calcul des proxy marges</div>';
    } finally {
        // Supprimer le spinner principal des analytics s'il existe encore
        const analyticsLoader = document.getElementById('analytics-loader');
        if (analyticsLoader) {
            analyticsLoader.remove();
            console.log('📱 Spinner principal des analytics supprimé');
        }
    }
}

// Variable globale pour éviter les clics multiples
let stockSoirDetailEnCours = false;

// Fonction wrapper avec spinner et protection contre les clics multiples
async function afficherDetailStockSoirAvecSpinner(type, date1, date2 = '', pointVente = null) {
    // Éviter les clics multiples
    if (stockSoirDetailEnCours) {
        console.log('🔒 Chargement du détail Stock Soir déjà en cours...');
        return;
    }
    
    stockSoirDetailEnCours = true;
    const bouton = document.getElementById('btn-detail-stock-soir');
    
    try {
        // Afficher le spinner
        if (bouton) {
            bouton.disabled = true;
            bouton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement...';
        }
        
        console.log('🔄 Début du chargement du détail Stock Soir...');
        
        // Appeler la fonction originale
        await afficherDetailStockSoirVariation(type, date1, date2, pointVente);
        
    } catch (error) {
        console.error('Erreur lors du chargement du détail Stock Soir:', error);
        alert('Erreur lors du chargement du détail. Veuillez réessayer.');
    } finally {
        // Restaurer le bouton et déverrouiller
        if (bouton) {
            bouton.disabled = false;
            bouton.innerHTML = '<i class="fas fa-info-circle"></i> Détail';
        }
        stockSoirDetailEnCours = false;
        console.log('✅ Chargement du détail Stock Soir terminé.');
    }
}

// Fonction pour afficher le détail du stock soir avec variation
async function afficherDetailStockSoirVariation(type, date1, date2 = '', pointVente = null) {
    try {
        console.log(`🔍 Affichage détail stock soir - Type: ${type}, Date1: ${date1}, Date2: ${date2}, Point de vente: ${pointVente}`);
        
        let modalContent = '';
        let modalTitle = '';
        
        const pointVenteText = pointVente && pointVente !== 'Sélectionner un point de vente' ? ` - ${pointVente}` : '';
        
        if (type === 'jour_precedent') {
            modalTitle = `Détail du Stock Soir - ${date1}${pointVenteText}`;
            modalContent = await genererDetailStockSoir(date1, pointVente);
        } else if (type === 'variation') {
            // Calculer la date réelle du stock de début (date1 - 1)
            const dateDebutReelle = calculerDatePrecedente(date1);
            modalTitle = `Détail Stock Soir - Variation ${dateDebutReelle} → ${date2}${pointVenteText}`;
            modalContent = await genererDetailStockSoirVariation(date1, date2, pointVente);
        } else {
            modalContent = '<div class="text-danger">Type de stock soir non reconnu</div>';
        }
        
        // Créer et afficher la modal
        const modalHtml = `
            <div class="modal fade" id="modalDetailStockSoir" tabindex="-1">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${modalTitle}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            ${modalContent}
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Supprimer l'ancienne modal si elle existe
        const existingModal = document.getElementById('modalDetailStockSoir');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Ajouter la nouvelle modal
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Afficher la modal
        const modal = new bootstrap.Modal(document.getElementById('modalDetailStockSoir'));
        modal.show();
        
    } catch (error) {
        console.error('Erreur lors de l\'affichage du détail stock soir:', error);
        alert('Erreur lors de l\'affichage du détail: ' + error.message);
    }
}

// Fonction pour générer le détail d'une date
async function genererDetailStockSoir(date, pointVente = null) {
    try {
        console.log(`🔍 Génération détail stock soir pour ${pointVente || 'tous les points de vente'} - ${date}`);
        
        const response = await fetch(`/api/external/stock/soir?date=${encodeURIComponent(date)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
            }
        });

        if (!response.ok) {
            return `<div class="text-danger">Erreur lors de la récupération des données pour ${date}</div>`;
        }

        const data = await response.json();
        
        if (!data || Object.keys(data).length === 0) {
            return `<div class="text-muted">Aucune donnée de stock soir disponible pour ${date}</div>`;
        }

        // Filtrer par point de vente si spécifié
        let filteredData = data;
        if (pointVente && pointVente !== 'Sélectionner un point de vente') {
            console.log(`🔍 Filtrage des données pour ${pointVente}`);
            filteredData = {};
            Object.entries(data).forEach(([key, item]) => {
                const pointVenteFromKey = key.split('-')[0];
                if (pointVenteFromKey === pointVente) {
                    filteredData[key] = item;
                }
            });
            console.log(`✅ Données filtrées: ${Object.keys(filteredData).length} items`);
        }

        // Organiser les données par point de vente
        const stockParPointVente = {};
        let totalGeneral = 0;
        let nombreItemsTotal = 0;

        Object.entries(filteredData).forEach(([key, item]) => {
            const [pointVente, produit] = key.split('-');
            if (!stockParPointVente[pointVente]) {
                stockParPointVente[pointVente] = [];
            }
            
            const montant = parseFloat(item.Montant) || 0;
            stockParPointVente[pointVente].push({
                produit,
                montant,
                quantite: parseFloat(item.Quantite || item.Nombre) || 0,
                prixUnitaire: parseFloat(item.PU || item.prixUnitaire) || 0
            });
            
            totalGeneral += montant;
            nombreItemsTotal++;
        });

        let html = `
            <div class="row mb-3">
                <div class="col-md-6">
                    <div class="card border-primary">
                        <div class="card-body">
                            <h6 class="card-title text-primary">Total Général</h6>
                            <div class="h4 text-primary">${totalGeneral.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</div>
                            <small class="text-muted">${nombreItemsTotal} items</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card border-info">
                        <div class="card-body">
                            <h6 class="card-title text-info">Points de Vente</h6>
                            <div class="h4 text-info">${Object.keys(stockParPointVente).length}</div>
                            <small class="text-muted">avec stock</small>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Afficher le détail par point de vente
        Object.keys(stockParPointVente).sort().forEach(pointVente => {
            const items = stockParPointVente[pointVente];
            const totalPointVente = items.reduce((sum, item) => sum + item.montant, 0);
            const pourcentage = totalGeneral > 0 ? (totalPointVente / totalGeneral) * 100 : 0;

            html += `
                <div class="card mb-3">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h6 class="mb-0">${pointVente}</h6>
                        <span class="badge bg-primary">${totalPointVente.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA (${pourcentage.toFixed(1)}%)</span>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Produit</th>
                                        <th class="text-end">Quantité</th>
                                        <th class="text-end">Prix Unitaire</th>
                                        <th class="text-end">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
            `;

            items.sort((a, b) => b.montant - a.montant).forEach(item => {
                html += `
                    <tr>
                        <td>${item.produit}</td>
                        <td class="text-end">${item.quantite.toFixed(2)}</td>
                        <td class="text-end">${item.prixUnitaire.toFixed(0)} FCFA</td>
                        <td class="text-end">${item.montant.toFixed(0)} FCFA</td>
                    </tr>
                `;
            });

            html += `
                                </tbody>
                            </table>
                        </div>
                        <div class="text-end">
                            <strong>Total ${pointVente}: ${totalPointVente.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</strong>
                        </div>
                    </div>
                </div>
            `;
        });

        return html;

    } catch (error) {
        console.error('Erreur lors de la génération du détail:', error);
        return `<div class="text-danger">Erreur: ${error.message}</div>`;
    }
}

// Fonction pour générer le HTML des calculs de marge avec les données API (bonnes quantités abattues)
function genererCalculsMargeStockSoirAPI(margeData) {
    const { totalCA, totalCout, marge, detailParProduit } = margeData;
    
    let html = `
        <div class="card mt-3">
            <div class="card-header bg-primary text-white">
                <h6 class="mb-0">Calculs de Marge Stock Soir - </h6>
            </div>
            <div class="card-body">
                <div class="row mb-3">
                    <div class="col-md-4">
                        <div class="border p-2 text-center">
                            <strong class="text-success">Chiffre d'Affaires</strong><br>
                            <span class="h5 text-success">${totalCA.toLocaleString()} FCFA</span>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="border p-2 text-center">
                            <strong class="text-warning">Coût Total</strong><br>
                            <span class="h5 text-warning">${totalCout.toLocaleString()} FCFA</span>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="border p-2 text-center">
                            <strong class="text-primary">Marge</strong><br>
                            <span class="h5 text-primary">${marge.toLocaleString()} FCFA</span>
                        </div>
                    </div>
                </div>
                
                <h6>Détail par Produit:</h6>
                <div class="table-responsive">
                    <table class="table table-sm table-striped">
                        <thead class="table-dark">
                            <tr>
                                <th>Produit</th>
                                <th>Qté Vendue</th>
                                <th>Qté Abattue</th>
                                <th>Ratio</th>
                                <th>Prix Vente</th>
                                <th>Prix Achat</th>
                                <th>CA</th>
                                <th>Coût</th>
                                <th>Marge</th>
                            </tr>
                        </thead>
                        <tbody>
    `;
    
    // Trier les produits par nom pour un affichage cohérent
    const produitsTries = detailParProduit.sort((a, b) => a.produit.localeCompare(b.produit));
    
    produitsTries.forEach(produit => {
        // Calculer le ratio correct
        let ratioText = '-';
        let ratioClass = '';
        if (produit.quantiteAbattue !== 0) {
            const ratio = ((produit.quantiteVendue / produit.quantiteAbattue) - 1) * 100;
            ratioText = `${ratio.toFixed(2)}%`;
            ratioClass = ratio < 0 ? 'text-danger' : 'text-success';
        }
        
        // Déterminer les classes CSS pour la marge
        const margeClass = produit.margeProduit >= 0 ? 'text-success' : 'text-danger';
        
        html += `
            <tr>
                <td><strong>${produit.produit}</strong></td>
                <td>${produit.quantiteVendue.toFixed(2)} kg</td>
                <td>${produit.quantiteAbattue.toFixed(2)} kg</td>
                <td class="${ratioClass}">${ratioText}</td>
                <td>${produit.prixVenteProduit.toLocaleString()} FCFA/kg</td>
                <td>${produit.prixAchatProduit.toLocaleString()} FCFA/kg</td>
                <td>${produit.caProduit.toLocaleString()} FCFA</td>
                <td>${produit.coutProduit.toLocaleString()} FCFA</td>
                <td class="${margeClass}"><strong>${produit.margeProduit.toLocaleString()} FCFA</strong></td>
            </tr>
        `;
    });
    
    html += `
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    return html;
}

// Fonction pour générer les détails de stock à partir des données API
function genererDetailStockFromAPI(margeData, dateDebut, dateFin) {
    const { detailParProduit } = margeData;
    
    // Séparer les produits en Stock Début et Stock Fin basé sur les quantités
    const stockDebutProduits = [];
    const stockFinProduits = [];
    
    detailParProduit.forEach(produit => {
        if (produit.quantiteVendue < 0) {
            // Quantité négative = diminution de stock = était en stock au début
            stockDebutProduits.push({
                produit: produit.produit,
                quantite: Math.abs(produit.quantiteVendue),
                prixUnitaire: produit.prixVenteProduit,
                total: Math.abs(produit.quantiteVendue) * produit.prixVenteProduit,
                pointVente: produit.pointVente
            });
        } else if (produit.quantiteVendue > 0) {
            // Quantité positive = augmentation de stock = ajouté en fin
            stockFinProduits.push({
                produit: produit.produit,
                quantite: produit.quantiteVendue,
                prixUnitaire: produit.prixVenteProduit,
                total: produit.quantiteVendue * produit.prixVenteProduit,
                pointVente: produit.pointVente
            });
        }
    });
    
    // Générer le HTML pour Stock Début
    const genererTableauStock = (produits, titre) => {
        if (produits.length === 0) {
            return `
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">${titre}</h6>
                    </div>
                    <div class="card-body">
                        <p class="text-muted">Aucun produit</p>
                    </div>
                </div>
            `;
        }
        
        const totalGeneral = produits.reduce((sum, p) => sum + p.total, 0);
        
        let html = `
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h6 class="mb-0">${titre}</h6>
                    <span class="badge bg-primary">${totalGeneral.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</span>
                </div>
                <div class="card-body">
                    <div class="table-responsive">
                        <table class="table table-sm table-striped">
                            <thead class="table-light">
                                <tr>
                                    <th>Produit</th>
                                    <th>Quantité</th>
                                    <th>Prix Unitaire</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
        `;
        
        produits.forEach(produit => {
            html += `
                <tr>
                    <td><strong>${produit.produit}</strong></td>
                    <td>${produit.quantite.toFixed(2)} kg</td>
                    <td>${produit.prixUnitaire.toLocaleString()} FCFA/kg</td>
                    <td>${produit.total.toLocaleString()} FCFA</td>
                </tr>
            `;
        });
        
        html += `
                            </tbody>
                        </table>
                    </div>
                    <small class="text-muted">${produits.length} items avec stock</small>
                </div>
            </div>
        `;
        
        return html;
    };
    
    return `
        <div class="row mt-4">
            <div class="col-md-6">
                ${genererTableauStock(stockDebutProduits, `Détail Stock Début (${dateDebut})`)}
            </div>
            <div class="col-md-6">
                ${genererTableauStock(stockFinProduits, `Détail Stock Fin (${dateFin})`)}
            </div>
        </div>
    `;
}

// Fonction pour générer le détail de variation entre deux dates
async function genererDetailStockSoirVariation(dateDebut, dateFin, pointVente = null) {
    try {
        console.log(`🔍 🚀 SINGLE SOURCE OF TRUTH: Génération détail via API UNIQUEMENT pour ${pointVente || 'tous les points de vente'}`);
        
        // Convertir les dates au format DD/MM/YYYY pour l'API
        const formatForAPI = (dateStr) => {
            return dateStr.replace(/-/g, '/');
        };
        
        const startDate = formatForAPI(dateDebut);
        const endDate = formatForAPI(dateFin);
        const pointVenteParam = pointVente || 'Sélectionner un point de vente';
        
        console.log(`📅 Appel API marge: ${startDate} à ${endDate}, Point: ${pointVenteParam}`);
        
        // Ajouter les paramètres des ratios éditables
        const ratiosParams = `&ratioPerteBoeuf=${proxyMargesControls.ratioPerteBoeuf}&ratioPerteVeau=${proxyMargesControls.ratioPerteVeau}&calculAutoActif=${proxyMargesControls.calculAutoActif}`;
        
        // Appeler notre API de marge qui a les bonnes quantités abattues
        const margeResponse = await fetch(`/api/external/stock-soir-marge?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&pointVente=${encodeURIComponent(pointVenteParam)}${ratiosParams}`, {
            method: 'GET',
            headers: {
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1',
                'Content-Type': 'application/json'
            }
        });
        
        if (!margeResponse.ok) {
            throw new Error(`Erreur API marge: ${margeResponse.status}`);
        }
        
        const margeData = await margeResponse.json();
        console.log(`✅ Données API récupérées: ${margeData.stockSoirMarge.nombreProduits} produits`);
        console.log(`🎯 API Response:`, margeData);
        
        // 🚀 NOUVEAU: Utiliser UNIQUEMENT les données de l'API pour tout l'affichage
        // Calculer les totaux à partir des données API
        const dateDebutPrecedente = calculerDatePrecedente(dateDebut);
        
        // Calculer Stock Début et Stock Fin à partir des données API
        let stockDebutTotal = 0;
        let stockFinTotal = 0;
        let stockDebutItems = 0;
        let stockFinItems = 0;
        
        // Utiliser les détails par produit de l'API pour reconstituer les stocks
        margeData.stockSoirMarge.detailParProduit.forEach(produit => {
            // Stock Début = produits avec quantité négative (diminution de stock)
            // Stock Fin = produits avec quantité positive (augmentation de stock)
            if (produit.quantiteVendue < 0) {
                // Quantité négative = diminution de stock = était en stock au début
                const stockDebutProduit = Math.abs(produit.quantiteVendue) * produit.prixVenteProduit;
                stockDebutTotal += stockDebutProduit;
                stockDebutItems++;
            } else if (produit.quantiteVendue > 0) {
                // Quantité positive = augmentation de stock = ajouté en fin
                const stockFinProduit = produit.quantiteVendue * produit.prixVenteProduit;
                stockFinTotal += stockFinProduit;
                stockFinItems++;
            }
        });
        
        const variationTotal = stockFinTotal - stockDebutTotal;

        let html = `
            <div class="row mb-3">
                <div class="col-md-4">
                    <div class="card border-info">
                        <div class="card-header bg-info text-white">
                            <h6 class="mb-0">Stock Début (${dateDebutPrecedente})</h6>
                        </div>
                        <div class="card-body">
                            <div class="h5 text-info">${stockDebutTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</div>
                            <small class="text-muted">${stockDebutItems} items</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card border-success">
                        <div class="card-header bg-success text-white">
                            <h6 class="mb-0">Stock Fin (${dateFin})</h6>
                        </div>
                        <div class="card-body">
                            <div class="h5 text-success">${stockFinTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</div>
                            <small class="text-muted">${stockFinItems} items</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card border-warning">
                        <div class="card-header bg-warning text-dark">
                            <h6 class="mb-0">Variation</h6>
                        </div>
                        <div class="card-body">
                            <div class="h5 text-warning">${variationTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</div>
                            <small class="text-muted">Différence</small>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 🚀 PRINCIPAL: Ajouter les calculs de marge de l'API (SINGLE SOURCE OF TRUTH)
        html += genererCalculsMargeStockSoirAPI(margeData.stockSoirMarge);
        
        // 🚀 NOUVEAU: Ajouter les détails des stocks basés sur l'API
        html += genererDetailStockFromAPI(margeData.stockSoirMarge, dateDebutPrecedente, dateFin);

        return html;

    } catch (error) {
        console.error('Erreur lors de la génération du détail de variation:', error);
        return `<div class="text-danger">Erreur: ${error.message}</div>`;
    }
}

// Fonction pour générer les calculs de marge détaillés du Stock Soir
async function genererCalculsMargeStockSoir(stockDebut, stockFin, dateDebut, dateFin, pointVente) {
    try {
        console.log(`🔍 Génération calculs marge Stock Soir pour ${pointVente}`);
        
        // Calculer la variation pour chaque produit
        const variationsParProduit = {};
        const allProduits = new Set([...Object.keys(stockDebut || {}), ...Object.keys(stockFin || {})]);
        
        allProduits.forEach(key => {
            const [pointVenteKey, produit] = key.split('-');
            if (pointVente === 'Sélectionner un point de vente' || pointVenteKey === pointVente || !pointVente) {
                const debut = stockDebut[key] || { Montant: 0, Nombre: 0, PU: 0 };
                const fin = stockFin[key] || { Montant: 0, Nombre: 0, PU: 0 };
                
                const montantVariation = (parseFloat(fin.Montant) || 0) - (parseFloat(debut.Montant) || 0);
                const quantiteVariation = (parseFloat(fin.Nombre) || 0) - (parseFloat(debut.Nombre) || 0);
                
                if (Math.abs(montantVariation) > 0.01 || Math.abs(quantiteVariation) > 0.01) {
                    variationsParProduit[produit] = {
                        Montant: montantVariation,
                        Quantite: quantiteVariation,
                        PU: parseFloat(fin.PU) || parseFloat(debut.PU) || 0,
                        PointVente: pointVenteKey
                    };
                }
            }
        });

        // Reproduire la logique de calcul des marges (comme dans calculerEtAfficherProxyMarges)
        let totalCA = 0;
        let totalCout = 0;
        let calculsByProduit = [];

        // Prix de configuration
        const prixAchatPouletConfig = parseFloat(document.getElementById('prix-achat-poulet')?.value) || 2600;
        const prixAchatAgneauConfig = parseFloat(document.getElementById('prix-achat-agneau')?.value) || 4000;
        const prixAchatOeufConfig = parseFloat(document.getElementById('prix-achat-oeuf')?.value) || 2200;
        
        // Récupérer les vrais prix d'achat depuis les achats comme dans calculerEtAfficherProxyMarges
        let prixAchatBoeuf = 3500; // Valeur par défaut
        let prixAchatVeau = 3300;  // Valeur par défaut
        // Utiliser les mêmes valeurs par défaut que les Proxy Marges
        let ratioBoeufDynamique = proxyMargesControls.ratioPerteBoeuf / 100;
        let ratioVeauDynamique = proxyMargesControls.ratioPerteVeau / 100;
        
        // Variables pour les quantités abattues (même logique que Proxy Marges)
        let poidsTotalBoeuf = 0;
        let poidsTotalVeau = 0;

        try {
            // Récupérer les prix d'achat réels via l'API externe
            const dateDebutObj = new Date(dateDebut.split('/').reverse().join('-'));
            const dateFinObj = new Date(dateFin.split('/').reverse().join('-'));
            const dateDebutFormatted = dateDebutObj.toISOString().split('T')[0];
            const dateFinFormatted = dateFinObj.toISOString().split('T')[0];
            
            console.log(`🔍 Récupération prix d'achat via API externe: ${dateDebutFormatted} à ${dateFinFormatted}`);
            
            const response = await fetch(`/api/external/achats-boeuf?startDate=${dateDebutFormatted}&endDate=${dateFinFormatted}`, {
                headers: {
                    'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
                }
            });
            
            if (response.ok) {
                const achatsData = await response.json();
                console.log('📊 Données d\'achats récupérées:', achatsData);
                
                if (achatsData.success && achatsData.data && achatsData.data.totals) {
                    const totals = achatsData.data.totals;
                    if (totals.avgPrixKgBoeuf && totals.avgPrixKgBoeuf > 0) {
                        prixAchatBoeuf = totals.avgPrixKgBoeuf;
                    }
                    if (totals.avgPrixKgVeau && totals.avgPrixKgVeau > 0) {
                        prixAchatVeau = totals.avgPrixKgVeau;
                    }
                    
                    // Récupérer les poids totaux (même logique que Proxy Marges)
                    poidsTotalBoeuf = totals.totalKgBoeuf || 0;
                    poidsTotalVeau = totals.totalKgVeau || 0;
                    
                    console.log(`🐄 Boeuf - Prix moyen: ${prixAchatBoeuf.toFixed(2)} FCFA/kg, Poids total: ${poidsTotalBoeuf} kg`);
                    console.log(`🐂 Veau - Prix moyen: ${prixAchatVeau.toFixed(2)} FCFA/kg, Poids total: ${poidsTotalVeau} kg`);
                }
                console.log(`📊 Prix d'achat récupérés: Boeuf=${prixAchatBoeuf}, Veau=${prixAchatVeau}`);
            } else {
                console.warn('Erreur API externe achats-boeuf:', response.status);
            }

            // Récupérer les ratios dynamiques (OPTIMISÉ)
            if (pointVente && pointVente !== 'Sélectionner un point de vente') {
                const ratios = await calculerRatiosPerteOptimise(dateDebut, dateFin, pointVente);
                
                // Utiliser les ratios calculés ou garder les valeurs par défaut des contrôles
                if (ratios.boeuf !== null && ratios.boeuf !== undefined) {
                    ratioBoeufDynamique = ratios.boeuf;
                }
                if (ratios.veau !== null && ratios.veau !== undefined) {
                    ratioVeauDynamique = ratios.veau;
                }
                console.log(`📊 Ratios dynamiques récupérés pour point spécifique: Boeuf=${ratioBoeufDynamique}, Veau=${ratioVeauDynamique}`);
            } else {
                // Cas "tous les points de vente" - utiliser les ratios calculés par les Proxy Marges si disponibles
                console.log(`🔍 DEBUG Ratios Proxy Marges dans genererCalculsMargeStockSoir:`);
                console.log(`   - ratioBoeuf: ${ratiosCalculesProxyMarges.ratioBoeuf}`);
                console.log(`   - ratioVeau: ${ratiosCalculesProxyMarges.ratioVeau}`);
                console.log(`   - dernierCalcul: ${ratiosCalculesProxyMarges.dernierCalcul}`);
                
                // NOUVEAU PARADIGME pour "Sélectionner un point de vente"
                if (pointVente === 'Sélectionner un point de vente') {
                    // Utiliser les ratios déjà calculés par les Proxy Marges
                    if (ratiosCalculesProxyMarges.ratioBoeuf !== null && ratiosCalculesProxyMarges.ratioVeau !== null) {
                        ratioBoeufDynamique = ratiosCalculesProxyMarges.ratioBoeuf;
                        ratioVeauDynamique = ratiosCalculesProxyMarges.ratioVeau;
                        console.log(`🎯 NOUVEAU PARADIGME: Utilisation des ratios Proxy Marges pour "Sélectionner un point de vente"`);
                        console.log(`   - Ratio Boeuf: ${(ratioBoeufDynamique * 100).toFixed(2)}%`);
                        console.log(`   - Ratio Veau: ${(ratioVeauDynamique * 100).toFixed(2)}%`);
                        console.log(`   - Formule: quantiteAbattue = quantiteVendue / (1 + ratio)`);
                    } else {
                        console.log(`⚠️ Ratios Proxy Marges non disponibles, utilisation de la logique statique de fallback`);
                        console.log(`🔄 Mode statique (comme Proxy Marges): quantiteAbattue = poidsTotalBoeuf/poidsTotalVeau`);
                        console.log(`✅ Les ratios seront calculés dynamiquement pour chaque produit dans la boucle forEach`);
                    }
                } else {
                    // Pour un point de vente spécifique, garder la logique actuelle
                    if (ratiosCalculesProxyMarges.ratioBoeuf !== null && ratiosCalculesProxyMarges.ratioVeau !== null) {
                        ratioBoeufDynamique = ratiosCalculesProxyMarges.ratioBoeuf;
                        ratioVeauDynamique = ratiosCalculesProxyMarges.ratioVeau;
                        console.log(`♻️ Point de vente spécifique: Utilisation des ratios des Proxy Marges:`);
                        console.log(`   - Boeuf: ${(ratioBoeufDynamique * 100).toFixed(2)}%`);
                        console.log(`   - Veau: ${(ratioVeauDynamique * 100).toFixed(2)}%`);
                        console.log(`   - Calculé le: ${ratiosCalculesProxyMarges.dernierCalcul}`);
                    } else {
                        console.log(`⚠️ Ratios non disponibles pour point de vente spécifique, fallback vers logique statique`);
                    }
                }
            }
        } catch (error) {
            console.warn('Erreur lors de la récupération des prix/ratios:', error);
        }

        console.log(`🔍 DEBUG: Nombre de produits avec variations: ${Object.keys(variationsParProduit).length}`);
        console.log(`📊 DEBUG: Produits avec variations:`, Object.keys(variationsParProduit));
        
        Object.entries(variationsParProduit).forEach(([produit, data]) => {
            const quantiteVendue = parseFloat(data.Quantite) || 0;
            console.log(`🔍 DEBUG: Traitement produit ${produit}, quantité: ${quantiteVendue}`);
            if (Math.abs(quantiteVendue) < 0.01) {
                console.log(`⚠️ DEBUG: Produit ${produit} ignoré car quantité trop petite: ${quantiteVendue}`);
                return;
            }

            let prixAchatProduit, prixVenteProduit, quantiteAbattue, unite = 'kg';

            // Logique EXACTEMENT identique aux Proxy Marges
            if (produit.toLowerCase() === 'boeuf') {
                prixAchatProduit = prixAchatBoeuf; // VRAI prix d'achat
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenBoeuf || parseFloat(data.PU) || prixAchatBoeuf;
                console.log(`🎯 Boeuf - Prix vente: ${prixMoyensProxyMarges.prixMoyenBoeuf ? 'Proxy Marges' : 'Stock'} = ${prixVenteProduit.toFixed(0)} FCFA/kg`);
                
                if (pointVente === 'Sélectionner un point de vente' && ratioBoeufDynamique !== null) {
                    // NOUVEAU PARADIGME: Utiliser les ratios des Proxy Marges
                    quantiteAbattue = quantiteVendue / (1 + ratioBoeufDynamique);
                    console.log(`🎯 Boeuf - NOUVEAU PARADIGME: Qté vendue: ${quantiteVendue} kg, Ratio Proxy: ${(ratioBoeufDynamique * 100).toFixed(2)}%, Qté abattue: ${quantiteAbattue.toFixed(2)} kg`);
                    console.log(`🎯 Boeuf - PARADIGME UTILISÉ: ratioBoeufDynamique = ${ratioBoeufDynamique}`);
                } else if (proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                    // Mode dynamique (pour point de vente spécifique)
                    quantiteAbattue = quantiteVendue / (1 + ratioBoeufDynamique);
                    console.log(`🐄 Boeuf - Mode dynamique: Qté vendue: ${quantiteVendue} kg, Ratio: ${(ratioBoeufDynamique * 100).toFixed(2)}%, Qté abattue: ${quantiteAbattue.toFixed(2)} kg`);
                } else {
                    // Mode statique (fallback - ancienne logique)
                    quantiteAbattue = poidsTotalBoeuf;
                    console.log(`🐄 Boeuf - Mode statique fallback: Qté abattue = poidsTotalBoeuf = ${quantiteAbattue} kg`);
                }
            } else if (produit.toLowerCase() === 'veau') {
                prixAchatProduit = prixAchatVeau; // VRAI prix d'achat
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenVeau || parseFloat(data.PU) || prixAchatVeau;
                console.log(`🎯 Veau - Prix vente: ${prixMoyensProxyMarges.prixMoyenVeau ? 'Proxy Marges' : 'Stock'} = ${prixVenteProduit.toFixed(0)} FCFA/kg`);
                
                if (pointVente === 'Sélectionner un point de vente' && ratioVeauDynamique !== null) {
                    // NOUVEAU PARADIGME: Utiliser les ratios des Proxy Marges
                    quantiteAbattue = quantiteVendue / (1 + ratioVeauDynamique);
                    console.log(`🎯 Veau - NOUVEAU PARADIGME: Qté vendue: ${quantiteVendue} kg, Ratio Proxy: ${(ratioVeauDynamique * 100).toFixed(2)}%, Qté abattue: ${quantiteAbattue.toFixed(2)} kg`);
                    console.log(`🎯 Veau - PARADIGME UTILISÉ: ratioVeauDynamique = ${ratioVeauDynamique}`);
                } else if (proxyMargesControls.calculAutoActif && proxyMargesControls.pointVenteActuel !== 'Sélectionner un point de vente') {
                    // Mode dynamique (pour point de vente spécifique)
                    quantiteAbattue = quantiteVendue / (1 + ratioVeauDynamique);
                    console.log(`🐂 Veau - Mode dynamique: Qté vendue: ${quantiteVendue} kg, Ratio: ${(ratioVeauDynamique * 100).toFixed(2)}%, Qté abattue: ${quantiteAbattue.toFixed(2)} kg`);
                } else {
                    // Mode statique (fallback - ancienne logique)
                    quantiteAbattue = poidsTotalVeau;
                    console.log(`🐂 Veau - Mode statique fallback: Qté abattue = poidsTotalVeau = ${quantiteAbattue} kg`);
                }
            } else if (produit.toLowerCase() === 'poulet') {
                prixAchatProduit = prixAchatPouletConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenPoulet || parseFloat(data.PU) || prixAchatPouletConfig;
                console.log(`🎯 Poulet - Prix vente: ${prixMoyensProxyMarges.prixMoyenPoulet ? 'Proxy Marges' : 'Stock'} = ${prixVenteProduit.toFixed(0)} FCFA/kg`);
                quantiteAbattue = quantiteVendue; // Même signe que quantiteVendue
                unite = 'unité';
            } else if (produit.toLowerCase() === 'agneau') {
                prixAchatProduit = prixAchatAgneauConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenAgneau || parseFloat(data.PU) || prixAchatAgneauConfig;
                console.log(`🎯 Agneau - Prix vente: ${prixMoyensProxyMarges.prixMoyenAgneau ? 'Proxy Marges' : 'Stock'} = ${prixVenteProduit.toFixed(0)} FCFA/kg`);
                quantiteAbattue = quantiteVendue; // Même signe que quantiteVendue
            } else if (produit.toLowerCase() === 'oeuf' || produit.toLowerCase() === 'tablette') {
                prixAchatProduit = prixAchatOeufConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU (Oeuf = Tablette)
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenOeuf || parseFloat(data.PU) || prixAchatOeufConfig;
                console.log(`🎯 ${produit} - Prix vente: ${prixMoyensProxyMarges.prixMoyenOeuf ? 'Proxy Marges' : 'Stock'} = ${prixVenteProduit.toFixed(0)} FCFA/kg`);
                quantiteAbattue = quantiteVendue; // Même signe que quantiteVendue
                unite = 'unité';
            } else {
                // Traitement spécial pour Viande hachée : utiliser le prix d'achat du Boeuf
                if (produit.toLowerCase().includes('viande hach')) {
                    prixAchatProduit = prixAchatBoeuf; // NOUVEAU: Prix d'achat du Boeuf
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue));
                    console.log(`🎯 Viande hachée - Prix achat: Boeuf = ${prixAchatBoeuf.toFixed(0)} FCFA/kg`);
                    quantiteAbattue = quantiteVendue; // Même signe que quantiteVendue
                } else {
                    // Autres produits dérivés (foie, etc.) - pas de coût d'achat
                    prixAchatProduit = 0;
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue));
                    quantiteAbattue = quantiteVendue; // Même signe que quantiteVendue
                }
            }

            // Calculer la marge avec ajustements (peut être négatif si diminution de stock)
            const caProduit = quantiteVendue * prixVenteProduit;
            const coutProduit = quantiteAbattue * prixAchatProduit;
            const margeProduit = caProduit - coutProduit;

            // Calculer le ratio de perte (même logique que Proxy Marges)
            let ratioPerte = 0;
            if (Math.abs(quantiteAbattue) > 0) {
                if (produit.toLowerCase() === 'boeuf' || produit.toLowerCase() === 'veau') {
                    // Utiliser toujours les ratios éditables (qui sont mis à jour par les Proxy Marges)
                    ratioPerte = produit.toLowerCase() === 'boeuf' ? 
                        -Math.abs(proxyMargesControls.ratioPerteBoeuf) : 
                        -Math.abs(proxyMargesControls.ratioPerteVeau);
                    console.log(`📊 ${produit} - Ratio éditable: ${ratioPerte.toFixed(2)}% (mis à jour par Proxy Marges)`);
                } else {
                    // Pour les autres produits, calculer le ratio à partir des quantités
                    if (quantiteVendue < 0 && quantiteAbattue < 0) {
                        ratioPerte = ((Math.abs(quantiteVendue) / Math.abs(quantiteAbattue)) - 1) * -100;
                        console.log(`📊 ${produit} - Variation de stock négative détectée - Ratio corrigé`);
                        console.log(`📊 ${produit} - CALCUL: ((${Math.abs(quantiteVendue)} / ${Math.abs(quantiteAbattue)}) - 1) * -100 = ${ratioPerte.toFixed(2)}%`);
                    } else {
                        ratioPerte = ((quantiteVendue / quantiteAbattue) - 1) * 100;
                        console.log(`📊 ${produit} - CALCUL NORMAL: ((${quantiteVendue} / ${quantiteAbattue}) - 1) * 100 = ${ratioPerte.toFixed(2)}%`);
                    }
                }
            }

            totalCA += caProduit;
            totalCout += coutProduit;

            calculsByProduit.push({
                produit,
                quantiteVendue, // Conserver le signe (ajustement positif/négatif)
                quantiteAbattue,
                prixVenteProduit,
                prixAchatProduit,
                caProduit,
                coutProduit,
                margeProduit,
                unite,
                ratioUtilise: (produit.toLowerCase() === 'boeuf' || produit.toLowerCase() === 'veau') ? 
                             (ratioPerte / 100) : null // Utiliser le ratio corrigé (converti en décimal)
            });
        });

        const margeTotal = totalCA - totalCout;

        // Générer le HTML
        let html = `
            <div class="card border-primary mb-4">
                <div class="card-header bg-primary text-white">
                    <h5 class="mb-0">
                        <i class="fas fa-calculator me-2"></i>
                        Calculs de Marge Stock Soir - ${pointVente}
                    </h5>
                </div>
                <div class="card-body">
                    <div class="row mb-3">
                        <div class="col-md-4">
                            <div class="card border-success">
                                <div class="card-body text-center">
                                    <h6 class="card-title text-success">Chiffre d'Affaires</h6>
                                    <div class="h4 text-success">${totalCA.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card border-warning">
                                <div class="card-body text-center">
                                    <h6 class="card-title text-warning">Coût Total</h6>
                                    <div class="h4 text-warning">${totalCout.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card border-primary">
                                <div class="card-body text-center">
                                    <h6 class="card-title text-primary">Marge</h6>
                                    <div class="h4 text-primary">${margeTotal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <h6>Détail par Produit:</h6>
                    <div class="table-responsive">
                        <table class="table table-striped table-sm">
                            <thead class="table-dark">
                                <tr>
                                    <th>Produit</th>
                                    <th>Qté Vendue</th>
                                    <th>Qté Abattue</th>
                                    <th>Ratio</th>
                                    <th>Prix Vente</th>
                                    <th>Prix Achat</th>
                                    <th>CA</th>
                                    <th>Coût</th>
                                    <th>Marge</th>
                                </tr>
                            </thead>
                            <tbody>`;

        calculsByProduit.forEach(calc => {
            const couleurMarge = calc.margeProduit >= 0 ? 'text-success' : 'text-danger';
            const ratioText = calc.ratioUtilise !== null ? 
                `${(calc.ratioUtilise * 100).toFixed(2)}%` : 
                '<span class="text-muted">-</span>';
            html += `
                <tr>
                    <td><strong>${calc.produit}</strong></td>
                    <td>${calc.quantiteVendue.toFixed(2)} ${calc.unite}</td>
                    <td>${calc.quantiteAbattue.toFixed(2)} ${calc.unite}</td>
                    <td><small>${ratioText}</small></td>
                    <td>${calc.prixVenteProduit.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA/${calc.unite}</td>
                    <td>${calc.prixAchatProduit.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA/${calc.unite}</td>
                    <td>${calc.caProduit.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</td>
                    <td>${calc.coutProduit.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</td>
                    <td class="${couleurMarge}"><strong>${calc.margeProduit.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA</strong></td>
                </tr>`;
        });

        html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>`;

        console.log(`🔍 DEBUG: HTML généré pour Stock Soir (${calculsByProduit.length} produits):`);
        console.log(`📊 DEBUG: Longueur HTML: ${html.length} caractères`);
        console.log(`📋 DEBUG: Extrait HTML:`, html.substring(0, 200) + '...');
        
        return html;

    } catch (error) {
        console.error('Erreur lors de la génération des calculs de marge:', error);
        return `<div class="text-danger">Erreur lors du calcul des marges: ${error.message}</div>`;
    }
}

// Fonction pour calculer la marge Stock Soir via l'API externe (cohérence garantie avec Details)
async function calculerMargeStockSoirViaAPI(dateDebut, dateFin, pointVente, prixMoyensProxyMarges) {
    try {
        console.log(`🌐 Appel API Stock Soir Marge: ${dateDebut} → ${dateFin}, PV: ${pointVente}`);
        
        // Convertir les dates au format attendu par l'API (DD/MM/YYYY)
        const formatDateForAPI = (dateStr) => {
            // dateStr est au format DD/MM/YYYY
            return dateStr;
        };
        
        const startDate = formatDateForAPI(dateDebut);
        const endDate = formatDateForAPI(dateFin);
        
        // Construire l'URL de l'API avec les prix moyens
        let apiUrl = `/api/external/stock-soir-marge?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&pointVente=${encodeURIComponent(pointVente)}`;
        
        // Ajouter les prix moyens si disponibles
        if (prixMoyensProxyMarges) {
            if (prixMoyensProxyMarges.prixMoyenBoeuf) {
                apiUrl += `&prixMoyenBoeuf=${prixMoyensProxyMarges.prixMoyenBoeuf}`;
            }
            if (prixMoyensProxyMarges.prixMoyenVeau) {
                apiUrl += `&prixMoyenVeau=${prixMoyensProxyMarges.prixMoyenVeau}`;
            }
            if (prixMoyensProxyMarges.prixMoyenPoulet) {
                apiUrl += `&prixMoyenPoulet=${prixMoyensProxyMarges.prixMoyenPoulet}`;
            }
            if (prixMoyensProxyMarges.prixMoyenAgneau) {
                apiUrl += `&prixMoyenAgneau=${prixMoyensProxyMarges.prixMoyenAgneau}`;
            }
            if (prixMoyensProxyMarges.prixMoyenOeuf) {
                apiUrl += `&prixMoyenOeuf=${prixMoyensProxyMarges.prixMoyenOeuf}`;
            }
        }
        
        // Ajouter les paramètres des ratios éditables
        apiUrl += `&ratioPerteBoeuf=${proxyMargesControls.ratioPerteBoeuf}&ratioPerteVeau=${proxyMargesControls.ratioPerteVeau}&calculAutoActif=${proxyMargesControls.calculAutoActif}`;
        
        console.log(`🌐 URL API avec prix moyens: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
            }
        });
        
        if (!response.ok) {
            console.error(`❌ Erreur API (${response.status}):`, response.statusText);
            return null;
        }
        
        const result = await response.json();
        
        if (result.success && result.stockSoirMarge) {
            console.log(`✅ API Success:`, result.stockSoirMarge);
            return {
                totalCA: result.stockSoirMarge.totalCA,
                totalCout: result.stockSoirMarge.totalCout,
                marge: result.stockSoirMarge.marge,
                detailParProduit: result.stockSoirMarge.detailParProduit
            };
        } else {
            console.error(`❌ API Error:`, result.message || 'Structure stockSoirMarge manquante');
            return null;
        }
        
    } catch (error) {
        console.error(`❌ Erreur lors de l'appel API Stock Soir Marge:`, error);
        return null;
    }
}

// Fonction pour calculer UNIQUEMENT les totaux de marge Stock Soir (extrait de genererCalculsMargeStockSoir)
async function calculerMargeStockSoirTotaux(stockDebut, stockFin, dateDebut, dateFin, pointVente) {
    try {
        console.log(`🔍 Calcul totaux marge Stock Soir (méthode corrigée) pour ${pointVente}`);
        
        // Calculer la variation pour chaque produit (MÊME LOGIQUE que genererCalculsMargeStockSoir)
        const variationsParProduit = {};
        const allProduits = new Set([...Object.keys(stockDebut || {}), ...Object.keys(stockFin || {})]);
        
        allProduits.forEach(key => {
            const [pointVenteKey, produit] = key.split('-');
            if (pointVente === 'Sélectionner un point de vente' || pointVenteKey === pointVente || !pointVente) {
                const debut = stockDebut[key] || { Montant: 0, Nombre: 0, PU: 0 };
                const fin = stockFin[key] || { Montant: 0, Nombre: 0, PU: 0 };
                
                const montantVariation = (parseFloat(fin.Montant) || 0) - (parseFloat(debut.Montant) || 0);
                const quantiteVariation = (parseFloat(fin.Nombre) || 0) - (parseFloat(debut.Nombre) || 0);
                
                if (Math.abs(montantVariation) > 0.01 || Math.abs(quantiteVariation) > 0.01) {
                    variationsParProduit[produit] = {
                        Montant: montantVariation,
                        Quantite: quantiteVariation,
                        PU: parseFloat(fin.PU) || parseFloat(debut.PU) || 0,
                        PointVente: pointVenteKey
                    };
                }
            }
        });

        // Reproduire la logique de calcul des marges (MÊME LOGIQUE que genererCalculsMargeStockSoir)
        let totalCA = 0;
        let totalCout = 0;

        // Prix de configuration
        const prixAchatPouletConfig = parseFloat(document.getElementById('prix-achat-poulet')?.value) || 2600;
        const prixAchatAgneauConfig = parseFloat(document.getElementById('prix-achat-agneau')?.value) || 4000;
        const prixAchatOeufConfig = parseFloat(document.getElementById('prix-achat-oeuf')?.value) || 2200;
        
        // Récupérer les vrais prix d'achat depuis les achats
        let prixAchatBoeuf = 3500; // Valeur par défaut
        let prixAchatVeau = 3300;  // Valeur par défaut
        let ratioBoeufDynamique = proxyMargesControls.ratioPerteBoeuf / 100;
        let ratioVeauDynamique = proxyMargesControls.ratioPerteVeau / 100;

        try {
            console.log(`🔍 Récupération prix d'achat via API externe: ${dateDebut} à ${dateFin}`);
            const response = await fetch(`/api/external/achats-boeuf?startDate=${dateDebut}&endDate=${dateFin}`, {
                headers: {
                    'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
                }
            });
            const data = await response.json();
            
            if (data.success && data.data) {
                const { boeuf, veau } = data.data;
                if (boeuf && boeuf.prixMoyen && boeuf.poidsTotal) {
                    prixAchatBoeuf = boeuf.prixMoyen;
                    console.log(`🐄 Boeuf - Prix moyen: ${prixAchatBoeuf.toFixed(2)} FCFA/kg, Poids total: ${boeuf.poidsTotal} kg`);
                }
                if (veau && veau.prixMoyen && veau.poidsTotal) {
                    prixAchatVeau = veau.prixMoyen;
                    console.log(`🐂 Veau - Prix moyen: ${prixAchatVeau.toFixed(2)} FCFA/kg, Poids total: ${veau.poidsTotal} kg`);
                }
            }
        } catch (error) {
            console.error('Erreur lors de la récupération des prix d\'achat:', error);
        }

        // Utiliser les ratios calculés par les Proxy Marges si disponibles (MÊME LOGIQUE)
        if (ratiosCalculesProxyMarges.ratioBoeuf !== null && ratiosCalculesProxyMarges.ratioVeau !== null) {
            ratioBoeufDynamique = ratiosCalculesProxyMarges.ratioBoeuf;
            ratioVeauDynamique = ratiosCalculesProxyMarges.ratioVeau;
            console.log(`♻️ Utilisation des ratios des Proxy Marges dans calculerMargeStockSoirTotaux:`);
            console.log(`   - Boeuf: ${(ratioBoeufDynamique * 100).toFixed(2)}%`);
            console.log(`   - Veau: ${(ratioVeauDynamique * 100).toFixed(2)}%`);
        }

        console.log(`🔍 DEBUG: ${Object.keys(variationsParProduit).length} produits à traiter`);
        console.log(`🔍 DEBUG: prixMoyensProxyMarges disponible:`, !!prixMoyensProxyMarges, prixMoyensProxyMarges);

        Object.entries(variationsParProduit).forEach(([produit, data]) => {
            const quantiteVendue = parseFloat(data.Quantite) || 0;
            let prixAchatProduit, prixVenteProduit, quantiteAbattue;
            let unite = 'kg';

            console.log(`🔍 DEBUG: Traitement produit ${produit}:`, data);
            
            // EXACTE MÊME LOGIQUE que genererCalculsMargeStockSoir
            if (Math.abs(quantiteVendue) < 0.01) {
                console.log(`⚠️ DEBUG: Produit ${produit} ignoré car quantité trop petite: ${quantiteVendue}`);
                return;
            }
            
            // CORRECTION: Le nom du produit peut être dans data.PointVente au lieu de la clé
            const nomProduitReel = produit === 'undefined' ? data.PointVente : produit;
            console.log(`🔄 Nom produit corrigé: "${produit}" → "${nomProduitReel}"`);
            
            // Calculer le prix de vente unitaire de façon sécurisée
            prixVenteProduit = parseFloat(data.Montant) / quantiteVendue;
            if (!isFinite(prixVenteProduit) || prixVenteProduit <= 0) {
                console.log(`⚠️ IGNORÉ: ${nomProduitReel} - prix de vente invalide (${prixVenteProduit})`);
                return;
            }

            // MÊME LOGIQUE DE CALCUL que genererCalculsMargeStockSoir avec fallback sécurisé
            if (nomProduitReel.toLowerCase() === 'boeuf') {
                prixAchatProduit = prixAchatBoeuf;
                prixVenteProduit = (prixMoyensProxyMarges && prixMoyensProxyMarges.prixMoyenBoeuf) || prixVenteProduit;
                quantiteAbattue = quantiteVendue / (1 + ratioBoeufDynamique);
            } else if (nomProduitReel.toLowerCase() === 'veau') {
                prixAchatProduit = prixAchatVeau;
                prixVenteProduit = (prixMoyensProxyMarges && prixMoyensProxyMarges.prixMoyenVeau) || prixVenteProduit;
                quantiteAbattue = quantiteVendue / (1 + ratioVeauDynamique);
            } else if (nomProduitReel.toLowerCase() === 'poulet') {
                prixAchatProduit = prixAchatPouletConfig;
                prixVenteProduit = (prixMoyensProxyMarges && prixMoyensProxyMarges.prixMoyenPoulet) || prixVenteProduit;
                quantiteAbattue = quantiteVendue;
                unite = 'unité';
            } else if (nomProduitReel.toLowerCase() === 'agneau') {
                prixAchatProduit = prixAchatAgneauConfig;
                prixVenteProduit = (prixMoyensProxyMarges && prixMoyensProxyMarges.prixMoyenAgneau) || prixVenteProduit;
                quantiteAbattue = quantiteVendue;
            } else if (nomProduitReel.toLowerCase() === 'oeuf' || nomProduitReel.toLowerCase() === 'tablette') {
                prixAchatProduit = prixAchatOeufConfig;
                prixVenteProduit = (prixMoyensProxyMarges && prixMoyensProxyMarges.prixMoyenOeuf) || prixVenteProduit;
                quantiteAbattue = quantiteVendue;
                unite = 'unité';
            } else {
                // Traitement spécial pour Viande hachée : utiliser le prix d'achat du Boeuf
                if (nomProduitReel.toLowerCase().includes('viande hach')) {
                    prixAchatProduit = prixAchatBoeuf;
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue)) || 5000; // fallback pour viande hachée
                    quantiteAbattue = quantiteVendue;
                } else {
                    // Autres produits dérivés (foie, etc.) - pas de coût d'achat
                    prixAchatProduit = 0;
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue)) || 0;
                    quantiteAbattue = quantiteVendue;
                }
            }

            // Vérifier que les valeurs sont valides (pas NaN)
            if (isNaN(prixVenteProduit) || isNaN(quantiteVendue) || isNaN(prixAchatProduit) || isNaN(quantiteAbattue)) {
                console.warn(`⚠️ Valeurs invalides pour ${produit}:`, {
                    prixVenteProduit, quantiteVendue, prixAchatProduit, quantiteAbattue, data
                });
                return; // Skip ce produit
            }

            // Calculer la marge avec ajustements (peut être négatif si diminution de stock)
            const caProduit = quantiteVendue * prixVenteProduit;
            const coutProduit = quantiteAbattue * prixAchatProduit;

            console.log(`📊 ${nomProduitReel}: qté=${quantiteVendue}, prixVente=${prixVenteProduit}, CA=${caProduit}, coût=${coutProduit}`);

            totalCA += caProduit;
            totalCout += coutProduit;
        });

        const marge = totalCA - totalCout;
        
        console.log(`🔍 DEBUG calculerMargeStockSoirTotaux FINAL:`);
        console.log(`   - Total CA: ${totalCA.toFixed(0)} FCFA`);
        console.log(`   - Total Coût: ${totalCout.toFixed(0)} FCFA`);
        console.log(`   - Marge: ${marge.toFixed(0)} FCFA`);
        
        return {
            totalCA: totalCA,
            totalCout: totalCout,
            marge: marge
        };

    } catch (error) {
        console.error('Erreur lors du calcul des totaux de marge Stock Soir (méthode corrigée):', error);
        return { totalCA: 0, totalCout: 0, marge: 0 };
    }
}

// Fonction pour calculer directement les totaux de marge depuis stockSoir.details (OPTIMISÉE)
function calculerTotauxMargeStockSoirDirect(stockSoirDetails, donneesExistantes) {
    try {
        console.log(`🔍 Calcul direct totaux marge Stock Soir`);
        console.log(`📊 Données reçues:`, Object.keys(stockSoirDetails));
        
        // Utiliser les données existantes
        let { prixAchatBoeuf, prixAchatVeau, ratioBoeufDynamique, ratioVeauDynamique } = donneesExistantes;
        
        // Si les ratios ne sont pas fournis dans donneesExistantes, essayer d'utiliser ceux des Proxy Marges
        if ((!ratioBoeufDynamique || !ratioVeauDynamique) && ratiosCalculesProxyMarges.ratioBoeuf !== null && ratiosCalculesProxyMarges.ratioVeau !== null) {
            ratioBoeufDynamique = ratioBoeufDynamique || ratiosCalculesProxyMarges.ratioBoeuf;
            ratioVeauDynamique = ratioVeauDynamique || ratiosCalculesProxyMarges.ratioVeau;
            console.log(`♻️ Utilisation des ratios des Proxy Marges dans Stock Soir Direct: Boeuf=${(ratioBoeufDynamique * 100).toFixed(2)}%, Veau=${(ratioVeauDynamique * 100).toFixed(2)}%`);
        }
        
        // Prix de configuration
        const prixAchatPouletConfig = parseFloat(document.getElementById('prix-achat-poulet')?.value) || 2600;
        const prixAchatAgneauConfig = parseFloat(document.getElementById('prix-achat-agneau')?.value) || 4000;
        const prixAchatOeufConfig = parseFloat(document.getElementById('prix-achat-oeuf')?.value) || 2200;
        
        let totalCA = 0;
        let totalCout = 0;

        // Calculer les marges par produit directement depuis stockSoir.details
        Object.entries(stockSoirDetails).forEach(([produit, data]) => {
            const quantiteVendue = parseFloat(data.Quantite) || 0;
            const montantVariation = parseFloat(data.Montant) || 0;
            
            if (Math.abs(quantiteVendue) < 0.01) return;

            let prixAchatProduit, prixVenteProduit, quantiteAbattue;
            
            // Calculer prix de vente avec fallback
            const prixUnitaireStock = parseFloat(data.PrixUnitaire) || 0;
            const prixCalcule = Math.abs(quantiteVendue) > 0.01 ? Math.abs(montantVariation) / Math.abs(quantiteVendue) : 0;
            
            // Utiliser la même logique que genererCalculsMargeStockSoir
            if (produit.toLowerCase() === 'boeuf') {
                prixAchatProduit = prixAchatBoeuf;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges en priorité
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenBoeuf || prixUnitaireStock || prixCalcule || prixAchatBoeuf;
                quantiteAbattue = quantiteVendue / (1 + ratioBoeufDynamique);
            } else if (produit.toLowerCase() === 'veau') {
                prixAchatProduit = prixAchatVeau;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges en priorité
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenVeau || prixUnitaireStock || prixCalcule || prixAchatVeau;
                quantiteAbattue = quantiteVendue / (1 + ratioVeauDynamique);
            } else if (produit.toLowerCase() === 'poulet') {
                prixAchatProduit = prixAchatPouletConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges en priorité
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenPoulet || prixUnitaireStock || prixCalcule || prixAchatPouletConfig;
                quantiteAbattue = quantiteVendue;
            } else if (produit.toLowerCase() === 'agneau') {
                prixAchatProduit = prixAchatAgneauConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges en priorité
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenAgneau || prixUnitaireStock || prixCalcule || prixAchatAgneauConfig;
                quantiteAbattue = quantiteVendue;
            } else if (produit.toLowerCase() === 'oeuf' || produit.toLowerCase() === 'tablette') {
                prixAchatProduit = prixAchatOeufConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges en priorité (Oeuf = Tablette)
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenOeuf || prixUnitaireStock || prixCalcule || prixAchatOeufConfig;
                quantiteAbattue = quantiteVendue;
            } else {
                // Traitement spécial pour Viande hachée : utiliser le prix d'achat du Boeuf
                if (produit.toLowerCase().includes('viande hach')) {
                    prixAchatProduit = prixAchatBoeuf; // NOUVEAU: Prix d'achat du Boeuf
                    prixVenteProduit = prixUnitaireStock || prixCalcule;
                    quantiteAbattue = quantiteVendue;
                } else {
                    // Autres produits dérivés - pas de coût d'achat
                    prixAchatProduit = 0;
                    prixVenteProduit = prixUnitaireStock || prixCalcule;
                    quantiteAbattue = quantiteVendue;
                }
            }
            
            console.log(`🔍 ${produit}: PrixStock=${prixUnitaireStock}, PrixCalculé=${prixCalcule.toFixed(2)}, PrixFinal=${prixVenteProduit.toFixed(2)}`);

            const caProduit = quantiteVendue * prixVenteProduit;
            const coutProduit = quantiteAbattue * prixAchatProduit;

            totalCA += caProduit;
            totalCout += coutProduit;
            
            console.log(`🔍 ${produit}: CA=${caProduit.toFixed(0)}, Coût=${coutProduit.toFixed(0)}, Marge=${(caProduit-coutProduit).toFixed(0)}`);
        });

        const marge = totalCA - totalCout;
        
        console.log(`🔍 DEBUG FINAL calculerTotauxMargeStockSoirDirect:`);
        console.log(`   - Total CA: ${totalCA.toFixed(0)} FCFA`);
        console.log(`   - Total Coût: ${totalCout.toFixed(0)} FCFA`);
        console.log(`   - Marge: ${marge.toFixed(0)} FCFA`);
        
        return {
            totalCA: totalCA,
            totalCout: totalCout,
            marge: marge
        };

    } catch (error) {
        console.error('Erreur lors du calcul direct totaux marge Stock Soir:', error);
        return { totalCA: 0, totalCout: 0, marge: 0 };
    }
}

// Fonction pour calculer uniquement les totaux de marge Stock Soir (même logique que genererCalculsMargeStockSoir)
async function calculerTotauxMargeStockSoir(stockDebut, stockFin, dateDebut, dateFin, pointVente, donneesExistantes = null) {
    try {
        console.log(`🔍 Calcul totaux marge Stock Soir pour ${pointVente}`);
        console.log(`📊 DEBUG stockDebut:`, stockDebut ? Object.keys(stockDebut).length + ' produits' : 'null');
        console.log(`📊 DEBUG stockFin:`, stockFin ? Object.keys(stockFin).length + ' produits' : 'null');
        console.log(`📅 DEBUG dates: ${dateDebut} → ${dateFin}`);
        
        // Calculer la variation pour chaque produit (même logique que genererCalculsMargeStockSoir)
        const variationsParProduit = {};
        const allProduits = new Set([...Object.keys(stockDebut || {}), ...Object.keys(stockFin || {})]);
        
        console.log(`🔍 DEBUG: ${allProduits.size} produits uniques trouvés`);
        if (allProduits.size > 0) {
            console.log(`📋 DEBUG: Premiers produits:`, Array.from(allProduits).slice(0, 5));
        }
        
        console.log(`🔍 DEBUG STRUCTURE DES DONNÉES:`);
        console.log(`📊 Structure stockDebut COMPLÈTE:`, stockDebut);
        console.log(`📊 Structure stockFin COMPLÈTE:`, stockFin);
        console.log(`📊 Type stockDebut:`, typeof stockDebut, Array.isArray(stockDebut) ? 'ARRAY' : 'OBJECT');
        console.log(`📊 Type stockFin:`, typeof stockFin, Array.isArray(stockFin) ? 'ARRAY' : 'OBJECT');
        
        allProduits.forEach(key => {
            // NOUVEAU: Les clés sont maintenant des noms de produits directement (ex: "Boeuf", "Veau")
            // au lieu de "PointVente-Produit" car les données sont agrégées par produit
            const produit = key; // La clé EST le nom du produit
            const pointVenteKey = 'Tous'; // Données agrégées pour tous les points de vente
            
            console.log(`🔍 DEBUG PROCESSING: Produit="${produit}", PointVente="${pointVenteKey}"`);
            
            if (pointVente === 'Sélectionner un point de vente' || pointVente === 'Tous' || !pointVente) {
                const debut = stockDebut[key] || { Montant: 0, Nombre: 0, PU: 0 };
                const fin = stockFin[key] || { Montant: 0, Nombre: 0, PU: 0 };
                
                console.log(`📊 DEBUG DONNÉES pour ${produit}:`);
                console.log(`   - Début:`, debut);
                console.log(`   - Fin:`, fin);
                
                const montantVariation = (parseFloat(fin.Montant) || 0) - (parseFloat(debut.Montant) || 0);
                
                // CORRECTION: Utiliser le bon champ pour les quantités (Quantite ou Nombre)
                const quantiteDebutStock = parseFloat(debut.Quantite) || parseFloat(debut.Nombre) || 0;
                const quantiteFinStock = parseFloat(fin.Quantite) || parseFloat(fin.Nombre) || 0;
                const quantiteVariation = quantiteFinStock - quantiteDebutStock;
                
                console.log(`   - Variation montant: ${fin.Montant} - ${debut.Montant} = ${montantVariation}`);
                console.log(`   - Quantité début: ${debut.Quantite || debut.Nombre} (${quantiteDebutStock})`);
                console.log(`   - Quantité fin: ${fin.Quantite || fin.Nombre} (${quantiteFinStock})`);
                console.log(`   - Variation quantité: ${quantiteFinStock} - ${quantiteDebutStock} = ${quantiteVariation}`);
                
                if (Math.abs(montantVariation) > 0.01 || Math.abs(quantiteVariation) > 0.01) {
                    variationsParProduit[produit] = {
                        Montant: montantVariation,
                        Quantite: quantiteVariation,
                        PU: parseFloat(fin.PU) || parseFloat(debut.PU) || 0,
                        PointVente: pointVenteKey
                    };
                    console.log(`✅ VARIATION ENREGISTRÉE pour ${produit}: Montant=${montantVariation}, Qté=${quantiteVariation}`);
                }
            }
        });
        
        console.log(`🔍 DEBUG: ${Object.keys(variationsParProduit).length} variations trouvées`);
        if (Object.keys(variationsParProduit).length > 0) {
            console.log(`📋 DEBUG: Variations:`, Object.keys(variationsParProduit));
        }

        // Reproduire exactement la logique de calcul des marges
        let totalCA = 0;
        let totalCout = 0;

        // Prix de configuration (identique)
        const prixAchatPouletConfig = parseFloat(document.getElementById('prix-achat-poulet')?.value) || 2600;
        const prixAchatAgneauConfig = parseFloat(document.getElementById('prix-achat-agneau')?.value) || 4000;
        const prixAchatOeufConfig = parseFloat(document.getElementById('prix-achat-oeuf')?.value) || 2200;
        
        // Utiliser les données existantes si fournies, sinon récupérer (OPTIMISATION)
        let prixAchatBoeuf, prixAchatVeau, ratioBoeufDynamique, ratioVeauDynamique;
        
        if (donneesExistantes) {
            // Réutiliser les données déjà récupérées pour éviter les appels API redondants
            console.log(`♻️ Réutilisation des données existantes`);
            prixAchatBoeuf = donneesExistantes.prixAchatBoeuf;
            prixAchatVeau = donneesExistantes.prixAchatVeau;
            ratioBoeufDynamique = donneesExistantes.ratioBoeufDynamique;
            ratioVeauDynamique = donneesExistantes.ratioVeauDynamique;
        } else {
            // Récupérer les données (logique originale)
            console.log(`🔄 Récupération des données via API`);
            prixAchatBoeuf = 3500;
            prixAchatVeau = 3300;
            ratioBoeufDynamique = proxyMargesControls.ratioPerteBoeuf / 100;
            ratioVeauDynamique = proxyMargesControls.ratioPerteVeau / 100;
            
            // Essayer d'utiliser les ratios calculés par les Proxy Marges si disponibles
            if (ratiosCalculesProxyMarges.ratioBoeuf !== null && ratiosCalculesProxyMarges.ratioVeau !== null) {
                ratioBoeufDynamique = ratiosCalculesProxyMarges.ratioBoeuf;
                ratioVeauDynamique = ratiosCalculesProxyMarges.ratioVeau;
                console.log(`♻️ Utilisation des ratios des Proxy Marges dans calculerTotauxMargeStockSoir:`);
                console.log(`   - Boeuf: ${(ratioBoeufDynamique * 100).toFixed(2)}%`);
                console.log(`   - Veau: ${(ratioVeauDynamique * 100).toFixed(2)}%`);
            }

            try {
                const dateDebutObj = new Date(dateDebut.split('/').reverse().join('-'));
                const dateFinObj = new Date(dateFin.split('/').reverse().join('-'));
                const dateDebutFormatted = dateDebutObj.toISOString().split('T')[0];
                const dateFinFormatted = dateFinObj.toISOString().split('T')[0];
                
                const response = await fetch(`/api/external/achats-boeuf?startDate=${dateDebutFormatted}&endDate=${dateFinFormatted}`, {
                    headers: { 'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1' }
                });
                
                if (response.ok) {
                    const achatsData = await response.json();
                    if (achatsData.success && achatsData.data && achatsData.data.totals) {
                        const totals = achatsData.data.totals;
                        if (totals.avgPrixKgBoeuf && totals.avgPrixKgBoeuf > 0) {
                            prixAchatBoeuf = totals.avgPrixKgBoeuf;
                        }
                        if (totals.avgPrixKgVeau && totals.avgPrixKgVeau > 0) {
                            prixAchatVeau = totals.avgPrixKgVeau;
                        }
                    }
                }

                // Récupérer les ratios dynamiques (OPTIMISÉ)
                if (pointVente && pointVente !== 'Sélectionner un point de vente') {
                    const ratios = await calculerRatiosPerteOptimise(dateDebut, dateFin, pointVente);
                    
                    if (ratios.boeuf !== null && ratios.boeuf !== undefined) {
                        ratioBoeufDynamique = ratios.boeuf;
                    }
                    if (ratios.veau !== null && ratios.veau !== undefined) {
                        ratioVeauDynamique = ratios.veau;
                    }
                }
            } catch (error) {
                console.warn('Erreur lors de la récupération des prix/ratios:', error);
            }
        }

        // Calculer les marges par produit (logique identique)
        Object.entries(variationsParProduit).forEach(([produit, data]) => {
            const quantiteVendue = parseFloat(data.Quantite) || 0;
            if (Math.abs(quantiteVendue) < 0.01) return;

            let prixAchatProduit, prixVenteProduit, quantiteAbattue;

            if (produit.toLowerCase() === 'boeuf') {
                prixAchatProduit = prixAchatBoeuf;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenBoeuf || parseFloat(data.PU) || prixAchatBoeuf;
                quantiteAbattue = quantiteVendue / (1 + ratioBoeufDynamique);
            } else if (produit.toLowerCase() === 'veau') {
                prixAchatProduit = prixAchatVeau;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenVeau || parseFloat(data.PU) || prixAchatVeau;
                quantiteAbattue = quantiteVendue / (1 + ratioVeauDynamique);
            } else if (produit.toLowerCase() === 'poulet') {
                prixAchatProduit = prixAchatPouletConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenPoulet || parseFloat(data.PU) || prixAchatPouletConfig;
                quantiteAbattue = quantiteVendue;
            } else if (produit.toLowerCase() === 'agneau') {
                prixAchatProduit = prixAchatAgneauConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenAgneau || parseFloat(data.PU) || prixAchatAgneauConfig;
                quantiteAbattue = quantiteVendue;
            } else if (produit.toLowerCase() === 'oeuf' || produit.toLowerCase() === 'tablette') {
                prixAchatProduit = prixAchatOeufConfig;
                // NOUVEAU: Utiliser le même prix moyen que les Proxy Marges au lieu de data.PU (Oeuf = Tablette)
                prixVenteProduit = prixMoyensProxyMarges.prixMoyenOeuf || parseFloat(data.PU) || prixAchatOeufConfig;
                quantiteAbattue = quantiteVendue;
            } else {
                // Traitement spécial pour Viande hachée : utiliser le prix d'achat du Boeuf
                if (produit.toLowerCase().includes('viande hach')) {
                    prixAchatProduit = prixAchatBoeuf; // NOUVEAU: Prix d'achat du Boeuf
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue));
                    quantiteAbattue = quantiteVendue;
                } else {
                    // Autres produits dérivés
                    prixAchatProduit = 0;
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue));
                    quantiteAbattue = quantiteVendue;
                }
            }

            const caProduit = quantiteVendue * prixVenteProduit;
            const coutProduit = quantiteAbattue * prixAchatProduit;

            totalCA += caProduit;
            totalCout += coutProduit;
        });

        return {
            totalCA: totalCA,
            totalCout: totalCout,
            marge: totalCA - totalCout
        };

    } catch (error) {
        console.error('Erreur lors du calcul des totaux de marge Stock Soir:', error);
        return { totalCA: 0, totalCout: 0, marge: 0 };
    }
}

// Fonction optimisée pour calculer les ratios Boeuf ET Veau en une seule fois (UTILISE API AGRÉGÉE)
async function calculerRatiosPerteOptimise(dateDebut, dateFin, pointVente) {
    try {
        console.log(`🚀 CALCUL SUPER-OPTIMISÉ des ratios pour ${pointVente} (${dateDebut} → ${dateFin})`);
        
        // Convertir les dates au format DD-MM-YYYY pour l'API
        const formatDateForApi = (dateStr) => {
            // dateStr est en format DD/MM/YYYY, on veut DD-MM-YYYY
            return dateStr.replace(/\//g, '-');
        };
        
        const startDateFormatted = formatDateForApi(dateDebut);
        const endDateFormatted = formatDateForApi(dateFin);
        
        console.log(`📡 UN SEUL APPEL API pour toute la période: /api/external/reconciliation/aggregated`);
        
        // RÉVOLUTIONNAIRE: UN SEUL appel pour toute la période au lieu de 31 appels × 2 produits = 62 appels !
        const response = await fetch(`/api/external/reconciliation/aggregated?startDate=${startDateFormatted}&endDate=${endDateFormatted}`, {
            headers: {
                'X-API-Key': 'b326e72b67a9b508c88270b9954c5ca1'
            }
        });
        
        if (!response.ok) {
            console.warn(`Erreur API reconciliation agrégée: ${response.status}`);
            return { boeuf: null, veau: null };
        }
        
        const data = await response.json();
        
        if (data.success && data.data && data.data.details && data.data.details[pointVente]) {
            const pointData = data.data.details[pointVente];
            
            let ratioBoeuf = null;
            let ratioVeau = null;
            
            console.log(`📊 Données agrégées reçues pour ${data.data.period.totalDays} jours`);
            
            // Calculer ratio Boeuf avec données agrégées
            if (pointData.Boeuf) {
                const ventesNombre = parseFloat(pointData.Boeuf.ventesNombre) || 0;
                const ventesTheoriquesNombre = parseFloat(pointData.Boeuf.ventesTheoriquesNombre) || 0;
                
                if (ventesTheoriquesNombre > 0) {
                    ratioBoeuf = (ventesNombre / ventesTheoriquesNombre) - 1;
                    console.log(`🐄 BOEUF AGRÉGÉ (${data.data.period.totalDays} jours): ${ventesNombre}/${ventesTheoriquesNombre} = ${(ratioBoeuf * 100).toFixed(2)}%`);
                }
            }
            
            // Calculer ratio Veau avec données agrégées
            if (pointData.Veau) {
                const ventesNombre = parseFloat(pointData.Veau.ventesNombre) || 0;
                const ventesTheoriquesNombre = parseFloat(pointData.Veau.ventesTheoriquesNombre) || 0;
                
                if (ventesTheoriquesNombre > 0) {
                    ratioVeau = (ventesNombre / ventesTheoriquesNombre) - 1;
                    console.log(`🐂 VEAU AGRÉGÉ (${data.data.period.totalDays} jours): ${ventesNombre}/${ventesTheoriquesNombre} = ${(ratioVeau * 100).toFixed(2)}%`);
                }
            }
            
            // Calculer ratio Agneau avec données agrégées
            let ratioAgneau = null;
            if (pointData.Agneau) {
                const ventesNombre = parseFloat(pointData.Agneau.ventesNombre) || 0;
                const ventesTheoriquesNombre = parseFloat(pointData.Agneau.ventesTheoriquesNombre) || 0;
                
                if (ventesTheoriquesNombre > 0) {
                    ratioAgneau = (ventesNombre / ventesTheoriquesNombre) - 1;
                    console.log(`🐑 AGNEAU AGRÉGÉ (${data.data.period.totalDays} jours): ${ventesNombre}/${ventesTheoriquesNombre} = ${(ratioAgneau * 100).toFixed(2)}%`);
                }
            }
            
            console.log(`✅ OPTIMISATION RÉUSSIE: 1 appel au lieu de ${data.data.period.totalDays * 3} appels !`);
            return { boeuf: ratioBoeuf, veau: ratioVeau, agneau: ratioAgneau };
        }
        
        return { boeuf: null, veau: null, agneau: null };
        
    } catch (error) {
        console.error('Erreur lors du calcul super-optimisé des ratios:', error);
        return { boeuf: null, veau: null };
    }
}

// Fonction pour recalculer les proxy marges quand les prix changent
async function recalculerProxyMarges() {
    // Récupérer les analytics actuelles depuis le container
    const analyticsContainer = document.getElementById('analytics-container');
    if (!analyticsContainer) return;
    
    // Recalculer les analytics depuis les ventes actuelles
    if (allVentes && allVentes.length > 0) {
        const analytics = calculerAnalyticsVentes(allVentes);
        await calculerEtAfficherProxyMarges(analytics.regroupees);
    }
}

// Fonction pour afficher le détail du stock soir par point de vente et produit
async function afficherDetailStockSoir() {
    try {
        // Récupérer la date de fin depuis les filtres
        const dateFin = document.getElementById('date-fin').value;
        if (!dateFin) {
            alert('Veuillez sélectionner une date de fin pour voir le détail du stock soir.');
            return;
        }

        // Convertir la date au format API
        const [jour, mois, annee] = dateFin.split('/');
        const dateApi = `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}`;

        // Récupérer les données du stock soir depuis l'API
        const response = await fetch(`/api/stock/soir?date=${dateApi}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la récupération des données du stock soir');
        }

        const data = await response.json();
        
        // L'API retourne directement les données du stock soir
        if (!data || Object.keys(data).length === 0) {
            throw new Error('Aucune donnée de stock soir trouvée pour cette date');
        }

        // Organiser les données par point de vente
        const stockParPointVente = {};
        let totalGeneral = 0;
        let nombreItemsGeneral = 0;

        Object.entries(data).forEach(([key, item]) => {
            const [pointVente, produit] = key.split('-');
            
            if (!stockParPointVente[pointVente]) {
                stockParPointVente[pointVente] = {
                    produits: [],
                    total: 0,
                    nombreItems: 0
                };
            }

            const montant = parseFloat(item.Montant) || 0;
            const quantite = parseFloat(item.Quantite || item.Nombre) || 0;
            const prixUnitaire = parseFloat(item.PU) || 0;

            stockParPointVente[pointVente].produits.push({
                produit: produit,
                quantite: quantite,
                prixUnitaire: prixUnitaire,
                montant: montant
            });

            stockParPointVente[pointVente].total += montant;
            stockParPointVente[pointVente].nombreItems++;
            totalGeneral += montant;
            nombreItemsGeneral++;
        });

        // Créer le contenu HTML du modal
        let html = `
            <div class="modal fade" id="modalDetailStockSoir" tabindex="-1" aria-labelledby="modalDetailStockSoirLabel" aria-hidden="true">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="modalDetailStockSoirLabel">
                                <i class="fas fa-boxes me-2"></i>Détail du Stock Soir - ${dateFin}
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row mb-3">
                                <div class="col-md-6">
                                    <div class="card border-info">
                                        <div class="card-body text-center">
                                            <h6 class="card-title text-info">Total Général</h6>
                                            <div class="h4 text-info">${totalGeneral.toLocaleString('fr-FR')} FCFA</div>
                                            <small class="text-muted">${nombreItemsGeneral} items</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="card border-secondary">
                                        <div class="card-body text-center">
                                            <h6 class="card-title text-secondary">Points de Vente</h6>
                                            <div class="h4 text-secondary">${Object.keys(stockParPointVente).length}</div>
                                            <small class="text-muted">avec stock</small>
                                        </div>
                                    </div>
                                </div>
                            </div>
        `;

        // Afficher le détail par point de vente
        Object.entries(stockParPointVente)
            .sort(([,a], [,b]) => b.total - a.total) // Trier par montant décroissant
            .forEach(([pointVente, data]) => {
                const pourcentage = totalGeneral > 0 ? (data.total / totalGeneral * 100) : 0;
                
                html += `
                    <div class="card mb-3">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h6 class="mb-0">
                                <i class="fas fa-store me-2"></i>${pointVente}
                            </h6>
                            <div>
                                <span class="badge bg-primary me-2">${data.total.toLocaleString('fr-FR')} FCFA</span>
                                <span class="badge bg-secondary">${pourcentage.toFixed(1)}%</span>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-sm table-hover">
                                    <thead class="table-light">
                                        <tr>
                                            <th>Produit</th>
                                            <th class="text-end">Quantité</th>
                                            <th class="text-end">Prix Unitaire</th>
                                            <th class="text-end">Montant</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                `;

                // Trier les produits par montant décroissant
                data.produits
                    .sort((a, b) => b.montant - a.montant)
                    .forEach(produit => {
                        html += `
                            <tr>
                                <td>${produit.produit}</td>
                                <td class="text-end">${produit.quantite.toFixed(2)}</td>
                                <td class="text-end">${produit.prixUnitaire.toLocaleString('fr-FR')} FCFA</td>
                                <td class="text-end fw-bold">${produit.montant.toLocaleString('fr-FR')} FCFA</td>
                            </tr>
                        `;
                    });

                html += `
                                    </tbody>
                                    <tfoot class="table-light">
                                        <tr>
                                            <th colspan="3">Total ${pointVente}</th>
                                            <th class="text-end">${data.total.toLocaleString('fr-FR')} FCFA</th>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
            });

        html += `
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Supprimer le modal existant s'il y en a un
        const existingModal = document.getElementById('modalDetailStockSoir');
        if (existingModal) {
            existingModal.remove();
        }

        // Ajouter le modal au DOM
        document.body.insertAdjacentHTML('beforeend', html);

        // Afficher le modal
        const modal = new bootstrap.Modal(document.getElementById('modalDetailStockSoir'));
        modal.show();

    } catch (error) {
        console.error('Erreur lors de l\'affichage du détail du stock soir:', error);
        alert('Erreur lors de la récupération des données du stock soir: ' + error.message);
    }
}