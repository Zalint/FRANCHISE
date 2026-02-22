// ========================================
// INVENTAIRE DU JOUR - POS
// ========================================

// Variables globales
let inventaireConfig = null;
let inventaireData = null;
let heureIntervalId = null; // ID de l'intervalle pour la mise à jour de l'heure

/**
 * Fonction pour échapper les caractères HTML (sécurité XSS)
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Charger la configuration de l'inventaire
 */
async function chargerInventaireConfig() {
    try {
        const response = await fetch('/inventaire-config.json');
        if (!response.ok) {
            throw new Error('Impossible de charger la configuration');
        }
        inventaireConfig = await response.json();
        console.log('✅ Configuration inventaire chargée:', inventaireConfig);
        return inventaireConfig;
    } catch (error) {
        console.error('❌ Erreur chargement config inventaire:', error);
        throw error;
    }
}

/**
 * Trouver la catégorie d'un produit à partir de son libellé
 * @param {string} libelleProduit - Libellé du produit à mapper
 * @param {object} config - Configuration de l'inventaire
 * @returns {object|null} Informations sur la catégorie ou null si non trouvé
 */
function getCategorieFromProduit(libelleProduit, config) {
    if (!config || !libelleProduit) return null;
    
    // Normaliser le libellé (enlever accents, minuscules, trim)
    const normalizedLibelle = libelleProduit.trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    let wildcardMatch = null; // Stocker le premier wildcard trouvé
    
    // Parcourir les catégories - première passe: chercher une correspondance exacte
    for (const [superCatKey, superCat] of Object.entries(config.categories)) {
        for (const [sousCatKey, sousCat] of Object.entries(superCat.sousCategories)) {
            // Vérifier chaque produit dans la liste
            for (const produit of sousCat.produits) {
                // Si c'est un wildcard, le stocker pour plus tard
                if (produit === '*') {
                    if (!wildcardMatch) {
                        wildcardMatch = {
                            superCategorie: superCatKey,
                            superCategorieLabel: superCat.label,
                            superCategorieIcon: superCat.icon,
                            superCategorieColor: superCat.color,
                            superCategorieOrdre: superCat.ordre,
                            sousCategorie: sousCatKey,
                            sousCategorieLabel: sousCat.label,
                            sousCategorieIcon: sousCat.icon,
                            sousCategorieOrdre: sousCat.ordre,
                            isWildcard: true
                        };
                    }
                    continue; // Continuer la recherche pour trouver une correspondance exacte
                }
                
                // Normaliser le produit de la config
                const normalizedProduit = produit.trim().toLowerCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                
                // Comparer
                if (normalizedLibelle === normalizedProduit) {
                    return {
                        superCategorie: superCatKey,
                        superCategorieLabel: superCat.label,
                        superCategorieIcon: superCat.icon,
                        superCategorieColor: superCat.color,
                        superCategorieOrdre: superCat.ordre,
                        sousCategorie: sousCatKey,
                        sousCategorieLabel: sousCat.label,
                        sousCategorieIcon: sousCat.icon,
                        sousCategorieOrdre: sousCat.ordre,
                        isWildcard: false
                    };
                }
            }
        }
    }
    
    // Aucune correspondance exacte trouvée, retourner le wildcard s'il existe
    return wildcardMatch;
}

/**
 * Ouvrir le modal inventaire du jour
 */
async function ouvrirInventaireDuJour() {
    try {
        // Charger la config si pas encore chargée
        if (!inventaireConfig) {
            await chargerInventaireConfig();
        }
        
        // Récupérer le point de vente sélectionné dans le POS
        const pointVenteSelect = document.getElementById('pointVenteSelect');
        const pointVente = pointVenteSelect ? pointVenteSelect.value : null;
        
        if (!pointVente) {
            showToast('Veuillez sélectionner un point de vente', 'error');
            return;
        }
        
        // Afficher le modal avec loading
        afficherModalInventaire(pointVente);
        
        // Charger les données
        await chargerInventaire(pointVente);
        
    } catch (error) {
        console.error('❌ Erreur ouverture inventaire:', error);
        showToast('Erreur lors de l\'ouverture de l\'inventaire', 'error');
    }
}

/**
 * Afficher le modal inventaire
 */
function afficherModalInventaire(pointVente) {
    const modalHTML = `
        <div class="modal-overlay" id="modalInventaire" style="display: flex;">
            <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h2>
                        <i class="fas fa-boxes"></i> Inventaire du Jour
                    </h2>
                    <button class="modal-close" onclick="fermerInventaire()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="modal-subheader" style="background: #f8f9fa; padding: 15px; border-bottom: 1px solid #dee2e6;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-store"></i>
                                <strong>${escapeHtml(pointVente)}</strong>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-calendar-day"></i>
                                <span id="inventaireDateDisplay">${new Date().toLocaleDateString('fr-FR')}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-clock"></i>
                                <span id="inventaireHeureDisplay">--:--:--</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button id="stockTempsReelBtn" 
                                    style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                                <i class="fas fa-box-open"></i> Stock Temps Réel
                            </button>
                            <button id="actualiserInventaireBtn" 
                                    data-point-vente="${escapeHtml(pointVente)}"
                                    style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                                <i class="fas fa-sync-alt"></i> Actualiser
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="modal-body" id="inventaireContent" style="padding: 24px;">
                    <div style="text-align: center; padding: 40px;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #667eea;"></i>
                        <p style="margin-top: 15px; color: #666;">Chargement de l'inventaire...</p>
                    </div>
                </div>
                
                <div class="modal-footer" style="background: #f8f9fa; padding: 16px 24px; border-top: 2px solid #dee2e6; display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="imprimerInventaire()" style="background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">
                        <i class="fas fa-print"></i> Imprimer
                    </button>
                    <button onclick="fermerInventaire()" style="background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">
                        <i class="fas fa-times"></i> Fermer
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Supprimer le modal existant s'il y en a un
    const existingModal = document.getElementById('modalInventaire');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Nettoyer l'intervalle existant avant d'en créer un nouveau
    if (heureIntervalId) {
        clearInterval(heureIntervalId);
        heureIntervalId = null;
    }
    
    // Ajouter le modal au body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Attacher l'événement au bouton Actualiser
    const actualiserBtn = document.getElementById('actualiserInventaireBtn');
    if (actualiserBtn) {
        actualiserBtn.addEventListener('click', function() {
            const pointVenteValue = this.dataset.pointVente;
            chargerInventaire(pointVenteValue);
        });
    }
    
    // Attacher l'événement au bouton Stock Temps Réel
    const stockTempsReelBtn = document.getElementById('stockTempsReelBtn');
    if (stockTempsReelBtn) {
        stockTempsReelBtn.addEventListener('click', function() {
            ouvrirStockTempsReel();
        });
    }
    
    // Mettre à jour l'heure toutes les secondes
    heureIntervalId = setInterval(() => {
        const heureDisplay = document.getElementById('inventaireHeureDisplay');
        if (heureDisplay) {
            heureDisplay.textContent = new Date().toLocaleTimeString('fr-FR');
        }
    }, 1000);
}

/**
 * Charger les données de l'inventaire
 */
async function chargerInventaire(pointVente) {
    try {
        // Format YYYY-MM-DD using local date (not UTC)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const today = `${year}-${month}-${day}`;
        
        console.log('📊 Chargement inventaire pour:', pointVente, 'Date:', today);
        
        // Charger en parallèle (y compris les packs)
        const [stockMatin, transferts, ventes, packs] = await Promise.all([
            chargerStockMatin(pointVente, today),
            chargerTransferts(pointVente, today),
            chargerVentesDuJour(pointVente, today),
            chargerPacksDuJour(pointVente, today)
        ]);
        
        console.log('✅ Données chargées:', { stockMatin, transferts, ventes, packs });
        
        // Calculer l'inventaire (avec packs)
        inventaireData = await calculerInventaire(stockMatin, transferts, ventes, packs);
        
        console.log('✅ Inventaire calculé:', inventaireData);
        
        // Afficher
        afficherInventaire(inventaireData);
        
    } catch (error) {
        console.error('❌ Erreur chargement inventaire:', error);
        const contentDiv = document.getElementById('inventaireContent');
        if (contentDiv) {
            contentDiv.innerHTML = '';
            
            // Créer les éléments de manière sécurisée
            const errorContainer = document.createElement('div');
            errorContainer.style.cssText = 'text-align: center; padding: 40px; color: #dc3545;';
            
            const icon = document.createElement('i');
            icon.className = 'fas fa-exclamation-triangle';
            icon.style.fontSize = '2rem';
            
            const message = document.createElement('p');
            message.style.marginTop = '15px';
            message.textContent = 'Erreur lors du chargement de l\'inventaire';
            
            const detail = document.createElement('small');
            detail.textContent = error.message;
            
            errorContainer.appendChild(icon);
            errorContainer.appendChild(message);
            errorContainer.appendChild(detail);
            contentDiv.appendChild(errorContainer);
        }
    }
}

/**
 * Charger le stock du matin
 */
async function chargerStockMatin(pointVente, date) {
    try {
        console.log('📦 Chargement stock matin...');
        
        // Convertir la date au format DD-MM-YYYY pour les APIs existantes
        const dateParts = date.split('-'); // date est en format YYYY-MM-DD
        const dateFormatted = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // DD-MM-YYYY
        
        console.log('🔍 Date originale:', date, '→ Date formatée:', dateFormatted);
        console.log('🔍 Point de vente recherché:', pointVente);
        
        // Utiliser l'API existante: GET /api/stock/matin?date=DD-MM-YYYY
        const url = `/api/stock/matin?date=${encodeURIComponent(dateFormatted)}`;
        console.log('🔍 URL appelée:', url);
        
        const response = await fetch(url, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur chargement stock matin');
        }
        
        const data = await response.json();
        console.log('🔍 Réponse API complète:', data);
        console.log('🔍 Clés disponibles:', Object.keys(data));
        
        // Le format retourné est un objet avec clés au format "PointVente-Produit"
        // Ex: { "O.Foire-Boeuf": { Nombre: "120", ... }, "O.Foire-Veau": { ... } }
        const stockData = [];
        
        // Filtrer les entrées pour le point de vente
        for (const [key, info] of Object.entries(data)) {
            // La clé est au format "PointVente-Produit"
            if (key.startsWith(pointVente + '-')) {
                const produit = info.Produit || key.split('-').slice(1).join('-');
                const quantite = parseFloat(info.Nombre || info.quantite || 0);
                
                stockData.push({
                    produit: produit,
                    quantite: quantite,
                    unite: 'kg'
                });
            }
        }
        
        console.log('🔍 Stocks filtrés pour', pointVente, ':', stockData);
        
        console.log('✅ Stock matin chargé:', stockData);
        return stockData;
        
    } catch (error) {
        console.error('❌ Erreur chargement stock matin:', error);
        // Ne pas bloquer en cas d'erreur
        return [];
    }
}

/**
 * Charger les transferts du jour
 */
async function chargerTransferts(pointVente, date) {
    try {
        console.log('🔄 Chargement transferts...');
        
        // Convertir la date au format DD-MM-YYYY pour les APIs existantes
        const dateParts = date.split('-'); // date est en format YYYY-MM-DD
        const dateFormatted = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // DD-MM-YYYY
        
        // Utiliser l'API existante: GET /api/transferts?date=DD-MM-YYYY
        const response = await fetch(`/api/transferts?date=${encodeURIComponent(dateFormatted)}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur chargement transferts');
        }
        
        const result = await response.json();
        
        if (!result.success || !result.transferts) {
            return [];
        }
        
        // Filtrer par point de vente et agréger
        const transfertsPointVente = result.transferts.filter(t => t.pointVente === pointVente);
        
        // Agréger par produit
        const transfertsParProduit = {};
        transfertsPointVente.forEach(t => {
            const produit = t.produit;
            const quantite = parseFloat(t.quantite || 0);
            const impact = t.impact; // 1 (entrée) ou -1 (sortie) ou 'Entrée'/'Sortie'
            
            console.log('🔍 Transfert individuel:', { produit, quantite, impact, type: typeof impact });
            
            if (!transfertsParProduit[produit]) {
                transfertsParProduit[produit] = {
                    produit: produit,
                    entrees: 0,
                    sorties: 0
                };
            }
            
            // Gérer les deux formats : nombre (1/-1) ou chaîne ('Entrée'/'Sortie')
            if (impact === 1 || impact === 'Entrée' || impact === 'entree') {
                transfertsParProduit[produit].entrees += quantite;
            } else if (impact === -1 || impact === 'Sortie' || impact === 'sortie') {
                transfertsParProduit[produit].sorties += quantite;
            }
        });
        
        const transfertsData = Object.values(transfertsParProduit);
        console.log('✅ Transferts chargés:', transfertsData);
        return transfertsData;
        
    } catch (error) {
        console.error('❌ Erreur chargement transferts:', error);
        return [];
    }
}

/**
 * Charger les ventes du jour
 */
async function chargerVentesDuJour(pointVente, date) {
    try {
        console.log('💰 Chargement ventes...');
        
        // Convertir la date au format DD-MM-YYYY pour les APIs existantes
        const dateParts = date.split('-'); // date est en format YYYY-MM-DD
        const dateFormatted = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // DD-MM-YYYY
        
        // Utiliser l'API existante: GET /api/ventes-date?date=DD-MM-YYYY&pointVente=X
        const response = await fetch(`/api/ventes-date?date=${encodeURIComponent(dateFormatted)}&pointVente=${encodeURIComponent(pointVente)}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur chargement ventes');
        }
        
        const result = await response.json();
        
        if (!result.success) {
            return [];
        }
        
        // Le format retourné a les ventes avec "Point de Vente", "Produit", "Nombre"
        const ventes = result.ventes || [];
        
        // Agréger par produit
        const ventesParProduit = {};
        ventes.forEach(v => {
            const produit = v.Produit;
            const quantite = parseFloat(v.Nombre || 0);
            
            console.log('🔍 Vente individuelle:', { produit, quantite });
            
            if (!ventesParProduit[produit]) {
                ventesParProduit[produit] = {
                    produit: produit,
                    quantite: 0
                };
            }
            
            ventesParProduit[produit].quantite += quantite;
        });
        
        const ventesData = Object.values(ventesParProduit);
        console.log('✅ Ventes chargées:', ventesData);
        return ventesData;
        
    } catch (error) {
        console.error('❌ Erreur chargement ventes:', error);
        return [];
    }
}

/**
 * Charger les ventes de packs du jour
 */
async function chargerPacksDuJour(pointVente, date) {
    try {
        console.log('📦 Chargement packs...');
        
        // Utiliser l'API des packs: GET /api/realtime/packs?date=YYYY-MM-DD
        const response = await fetch(`/api/realtime/packs?date=${date}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.warn('⚠️ Erreur chargement packs (peut être normal si pas de packs)');
            return null;
        }
        
        const result = await response.json();
        
        if (!result.success || !result.pointsVente) {
            return null;
        }
        
        // Récupérer les données pour ce point de vente
        const pdvData = result.pointsVente[pointVente];
        
        if (!pdvData || !pdvData.compositionAgregee) {
            console.log('ℹ️ Aucun pack pour ce PDV');
            return null;
        }
        
        // Mapper les noms de produits de l'API vers les noms utilisés dans l'inventaire
        const productMapping = {
            'boeuf en détail': 'Boeuf en détail',
            'boeuf en gros': 'Boeuf en gros',
            'boeuf': 'Boeuf',
            'veau en détail': 'Veau en détail',
            'veau en gros': 'Veau en gros',
            'veau': 'Veau',
            'agneau': 'Agneau',
            'poulet en détail': 'Poulet en détail',
            'poulet en gros': 'Poulet en gros',
            'poulet': 'Poulet'
        };
        
        // Convertir en format utilisable
        const packsData = {};
        Object.entries(pdvData.compositionAgregee).forEach(([produitAPI, info]) => {
            const produitNom = productMapping[produitAPI.toLowerCase()] || produitAPI;
            packsData[produitNom] = {
                quantite: parseFloat(info.quantite) || 0,
                unite: info.unite
            };
        });
        
        // Récupérer la liste des packs vendus
        const packsVendus = [];
        if (pdvData.packsVendus) {
            Object.entries(pdvData.packsVendus).forEach(([packName, packInfo]) => {
                packsVendus.push({
                    nom: packName,
                    quantite: packInfo.quantite
                });
            });
        }
        
        console.log('✅ Packs chargés:', { packsData, packsVendus });
        return { packsData, packsVendus };
        
    } catch (error) {
        console.error('❌ Erreur chargement packs:', error);
        return null;
    }
}

/**
 * Formater une quantité avec son unité
 * @param {number} quantite - La quantité à formater
 * @param {string} unite - L'unité (kg ou pcs)
 * @returns {string} La quantité formatée
 */
function formaterQuantite(quantite, unite = 'kg') {
    // Coercer et valider la quantité
    const num = Number(quantite);
    
    // Gérer les valeurs invalides
    if (!Number.isFinite(num)) {
        return unite === 'pcs' ? '0 pcs' : `0.0 ${unite}`;
    }
    
    if (unite === 'pcs') {
        return `${Math.round(num)} ${unite}`;
    }
    return `${num.toFixed(1)} ${unite}`;
}

/**
 * Calculer l'inventaire à partir des données
 */
async function calculerInventaire(stockMatin, transferts, ventes, packs = null) {
    // Vérifier que la config est chargée
    if (!inventaireConfig) {
        console.warn('⚠️ Config inventaire non chargée, chargement...');
        await chargerInventaireConfig();
    }
    
    if (!inventaireConfig) {
        throw new Error('Impossible de charger la configuration de l\'inventaire');
    }
    
    const inventaire = {};
    
    // Créer la structure pour chaque catégorie
    for (const [superCatKey, superCat] of Object.entries(inventaireConfig.categories)) {
        inventaire[superCatKey] = {
            label: superCat.label,
            icon: superCat.icon,
            color: superCat.color,
            ordre: superCat.ordre,
            total: 0,
            sousCategories: {}
        };
        
        for (const [sousCatKey, sousCat] of Object.entries(superCat.sousCategories)) {
            inventaire[superCatKey].sousCategories[sousCatKey] = {
                label: sousCat.label,
                icon: sousCat.icon,
                ordre: sousCat.ordre,
                unite: sousCat.unite || 'kg', // Par défaut kg
                stockMatin: 0,
                transfertsEntrees: 0,
                transfertsSorties: 0,
                transfertsNet: 0,
                ventesTotal: 0,
                ventesDetails: [],
                packsImpact: 0,
                packsDetails: [],
                stockActuel: 0
            };
        }
    }
    
    // Traiter le stock du matin
    stockMatin.forEach(item => {
        const cat = getCategorieFromProduit(item.produit, inventaireConfig);
        console.log('🔍 Mapping stock:', item.produit, '→', cat);
        if (cat) {
            const sousCat = inventaire[cat.superCategorie].sousCategories[cat.sousCategorie];
            sousCat.stockMatin += item.quantite;
        }
    });
    
    // Traiter les transferts
    transferts.forEach(item => {
        const cat = getCategorieFromProduit(item.produit, inventaireConfig);
        console.log('🔍 Mapping transfert:', item.produit, '→', cat);
        if (cat) {
            const sousCat = inventaire[cat.superCategorie].sousCategories[cat.sousCategorie];
            sousCat.transfertsEntrees += item.entrees || 0;
            sousCat.transfertsSorties += item.sorties || 0;
            sousCat.transfertsNet += (item.entrees || 0) - (item.sorties || 0);
        }
    });
    
    // Traiter les ventes
    ventes.forEach(item => {
        const cat = getCategorieFromProduit(item.produit, inventaireConfig);
        console.log('🔍 Mapping vente:', item.produit, '→', cat);
        if (cat) {
            const sousCat = inventaire[cat.superCategorie].sousCategories[cat.sousCategorie];
            sousCat.ventesTotal += item.quantite;
            sousCat.ventesDetails.push({
                produit: item.produit,
                quantite: item.quantite
            });
        }
    });
    
    // Traiter les packs
    if (packs && packs.packsData) {
        console.log('📦 Traitement des packs:', packs);
        Object.entries(packs.packsData).forEach(([produit, info]) => {
            const cat = getCategorieFromProduit(produit, inventaireConfig);
            console.log('🔍 Mapping pack:', produit, '→', cat);
            if (cat) {
                const sousCat = inventaire[cat.superCategorie].sousCategories[cat.sousCategorie];
                sousCat.packsImpact += info.quantite;
                sousCat.packsDetails.push({
                    produit: produit,
                    quantite: info.quantite
                });
            }
        });
        
        // Stocker la liste des packs vendus pour l'affichage
        if (packs.packsVendus) {
            inventaire._packsVendus = packs.packsVendus;
        }
    }
    
    // Calculer les stocks actuels et totaux (en incluant l'impact des packs)
    for (const [superCatKey, superCat] of Object.entries(inventaire)) {
        // Ignorer la clé spéciale _packsVendus
        if (superCatKey === '_packsVendus') continue;
        
        let totalSuperCat = 0;
        let uniteCommune = null;
        let uniteMixte = false;
        
        for (const [sousCatKey, sousCat] of Object.entries(superCat.sousCategories)) {
            sousCat.stockActuel = sousCat.stockMatin + sousCat.transfertsNet - sousCat.ventesTotal - sousCat.packsImpact;
            totalSuperCat += sousCat.stockActuel;
            
            // Déterminer l'unité commune
            if (uniteCommune === null) {
                uniteCommune = sousCat.unite;
            } else if (uniteCommune !== sousCat.unite) {
                uniteMixte = true;
            }
        }
        
        superCat.total = totalSuperCat;
        superCat.unite = uniteMixte ? 'kg' : (uniteCommune || 'kg'); // Par défaut kg si mixte
    }
    
    return inventaire;
}

/**
 * Afficher l'inventaire
 */
function afficherInventaire(inventaire) {
    const content = document.getElementById('inventaireContent');
    if (!content) return;
    
    let html = '';
    
    // Afficher les packs vendus (si disponibles)
    if (inventaire._packsVendus && inventaire._packsVendus.length > 0) {
        html += `
            <div style="background: linear-gradient(135deg, #6a1b9a 0%, #8e24aa 100%); border-radius: 12px; padding: 20px; margin-bottom: 30px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 15px 0; font-size: 1.3rem; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.5rem;">📦</span>
                    Packs Vendus Aujourd'hui
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
        `;
        
        inventaire._packsVendus.forEach(pack => {
            html += `
                <div style="background: rgba(255,255,255,0.2); padding: 12px; border-radius: 8px; backdrop-filter: blur(10px);">
                    <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 5px;">${escapeHtml(pack.nom)}</div>
                    <div style="font-size: 0.9rem; opacity: 0.9;">Quantité: ${escapeHtml(String(pack.quantite))}</div>
                </div>
            `;
        });
        
        html += `
                </div>
                <div style="margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px; font-size: 0.9rem;">
                    <i class="fas fa-info-circle"></i> L'impact de ces packs sur le stock est détaillé ci-dessous dans chaque catégorie
                </div>
            </div>
        `;
    }
    
    // Trier les catégories par ordre (filtrer _packsVendus et gérer ordre manquant)
    const categoriesTriees = Object.entries(inventaire)
        .filter(([superCatKey]) => superCatKey !== '_packsVendus')
        .sort((a, b) => {
            const ordreA = a[1].ordre ?? Infinity;
            const ordreB = b[1].ordre ?? Infinity;
            return ordreA - ordreB;
        });
    
    categoriesTriees.forEach(([superCatKey, superCat]) => {
        
        // Ignorer les catégories vides
        const hasData = Object.values(superCat.sousCategories).some(sc => 
            sc.stockMatin > 0 || sc.ventesTotal > 0 || sc.transfertsNet !== 0 || sc.packsImpact > 0
        );
        
        if (!hasData) return;
        
        html += `
            <div class="inventaire-super-categorie" style="margin-bottom: 30px; border: 2px solid ${superCat.color}; border-radius: 12px; overflow: hidden;">
                <div class="inventaire-super-categorie-header" onclick="toggleSuperCategorie('${superCatKey}')" 
                     style="background: ${superCat.color}; color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <h3 style="margin: 0; font-size: 1.3rem;">
                        <span id="icon-${superCatKey}" style="transition: transform 0.3s;">▼</span>
                        ${superCat.icon} ${superCat.label}
                    </h3>
                    <div style="font-size: 1.2rem; font-weight: bold;">
                        Total: ${formaterQuantite(superCat.total, superCat.unite)}
                    </div>
                </div>
                <div id="content-${superCatKey}" class="inventaire-super-categorie-content" style="padding: 20px; background: white; display: block;">
        `;
        
        // Trier les sous-catégories par ordre
        const sousCategoriesTriees = Object.entries(superCat.sousCategories).sort((a, b) => a[1].ordre - b[1].ordre);
        
        sousCategoriesTriees.forEach(([sousCatKey, sousCat]) => {
            // Ignorer les sous-catégories vides
            if (sousCat.stockMatin === 0 && sousCat.ventesTotal === 0 && sousCat.transfertsNet === 0 && sousCat.packsImpact === 0) {
                return;
            }
            
            // Déterminer la couleur d'alerte
            let alerteColor = '#28a745'; // Vert
            let alerteIcon = '✅';
            const pourcentageStock = sousCat.stockMatin > 0 ? (sousCat.stockActuel / sousCat.stockMatin) : 1;
            
            if (pourcentageStock < 0.2) {
                alerteColor = '#dc3545'; // Rouge
                alerteIcon = '❌';
            } else if (pourcentageStock < 0.5) {
                alerteColor = '#ffc107'; // Orange
                alerteIcon = '⚠️';
            }
            
            html += `
                <div class="inventaire-sous-categorie" style="margin-bottom: 25px; padding-bottom: 20px; border-bottom: 1px solid #e0e0e0;">
                    <h4 onclick="toggleSousCategorie('${superCatKey}-${sousCatKey}')" 
                        style="margin: 0 0 15px 0; font-size: 1.1rem; color: #333; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        <span id="icon-${superCatKey}-${sousCatKey}" style="transition: transform 0.3s; font-size: 0.8rem;">▼</span>
                        ${sousCat.icon} ${sousCat.label}
                    </h4>
                    <div id="content-${superCatKey}-${sousCatKey}" class="inventaire-sous-categorie-content" style="display: block;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 10px;">
                            <div style="background: #f8f9fa; padding: 10px; border-radius: 6px;">
                                <div style="font-size: 0.85rem; color: #666; margin-bottom: 3px;">Stock Matin</div>
                                <div style="font-size: 1.2rem; font-weight: 600;">${formaterQuantite(sousCat.stockMatin, sousCat.unite)}</div>
                            </div>
                            <div style="background: #e3f2fd; padding: 10px; border-radius: 6px;">
                                <div style="font-size: 0.85rem; color: #666; margin-bottom: 3px;">Transferts</div>
                                <div style="font-size: 1.2rem; font-weight: 600; color: ${sousCat.transfertsNet >= 0 ? '#28a745' : '#dc3545'};">
                                    ${sousCat.transfertsNet >= 0 ? '+' : ''}${formaterQuantite(Math.abs(sousCat.transfertsNet), sousCat.unite)}
                                </div>
                            </div>
                            <div style="background: #fff3e0; padding: 10px; border-radius: 6px;">
                                <div style="font-size: 0.85rem; color: #666; margin-bottom: 3px;">Ventes</div>
                                <div style="font-size: 1.2rem; font-weight: 600; color: #dc3545;">
                                    -${formaterQuantite(sousCat.ventesTotal, sousCat.unite)}
                                </div>
                            </div>
                            ${sousCat.packsImpact > 0 ? `
                            <div style="background: #fce4ec; padding: 10px; border-radius: 6px;">
                                <div style="font-size: 0.85rem; color: #666; margin-bottom: 3px;">Impact Packs</div>
                                <div style="font-size: 1.2rem; font-weight: 600; color: #c2185b;">
                                    -${formaterQuantite(sousCat.packsImpact, sousCat.unite)}
                                </div>
                            </div>
                            ` : ''}
                            <div style="background: linear-gradient(135deg, ${alerteColor}15 0%, ${alerteColor}25 100%); padding: 10px; border-radius: 6px; border: 2px solid ${alerteColor};">
                                <div style="font-size: 0.85rem; color: #666; margin-bottom: 3px;">Stock Actuel</div>
                                <div style="font-size: 1.3rem; font-weight: 700; color: ${alerteColor};">
                                    ${formaterQuantite(sousCat.stockActuel, sousCat.unite)} ${alerteIcon}
                                </div>
                            </div>
                        </div>
            `;
            
            // Détails des ventes avec décomposition
            if (sousCat.ventesDetails.length > 0 || sousCat.packsImpact > 0) {
                html += `
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer; padding: 8px; background: #f0f0f0; border-radius: 4px; font-size: 0.9rem;">
                            📊 Détail des ventes ${sousCat.packsImpact > 0 ? '(dont packs)' : `(${sousCat.ventesDetails.length} produit(s))`}
                        </summary>
                        <div style="margin-top: 10px; padding-left: 15px;">
                `;
                
                // Afficher les ventes saisies
                if (sousCat.ventesDetails.length > 0) {
                    html += `
                        <div style="margin-bottom: 10px;">
                            <div style="font-weight: 600; color: #dc3545; margin-bottom: 5px;">Ventes Saisies (-${formaterQuantite(sousCat.ventesTotal, sousCat.unite)}):</div>
                    `;
                    sousCat.ventesDetails.forEach(vente => {
                        html += `
                            <div style="padding: 5px 0; font-size: 0.9rem; display: flex; justify-content: space-between;">
                                <span>├─ ${escapeHtml(vente.produit)}</span>
                                <span style="font-weight: 600;">-${formaterQuantite(vente.quantite, sousCat.unite)}</span>
                            </div>
                        `;
                    });
                    html += `</div>`;
                }
                
                // Afficher l'impact des packs
                if (sousCat.packsImpact > 0) {
                    html += `
                        <div style="margin-bottom: 10px; padding-top: 10px; border-top: 1px dashed #ddd;">
                            <div style="font-weight: 600; color: #c2185b; margin-bottom: 5px;">Impact Packs (-${formaterQuantite(sousCat.packsImpact, sousCat.unite)}):</div>
                    `;
                    sousCat.packsDetails.forEach(pack => {
                        html += `
                            <div style="padding: 5px 0; font-size: 0.9rem; display: flex; justify-content: space-between;">
                                <span>├─ ${escapeHtml(pack.produit)}</span>
                                <span style="font-weight: 600;">-${formaterQuantite(pack.quantite, sousCat.unite)}</span>
                            </div>
                        `;
                    });
                    html += `</div>`;
                }
                
                // Total sorties
                const totalSorties = sousCat.ventesTotal + sousCat.packsImpact;
                if (sousCat.ventesDetails.length > 0 && sousCat.packsImpact > 0) {
                    html += `
                        <div style="padding-top: 10px; border-top: 2px solid #ddd; font-weight: 700; font-size: 1rem; display: flex; justify-content: space-between;">
                            <span>Total Sorties:</span>
                            <span style="color: #dc3545;">-${formaterQuantite(totalSorties, sousCat.unite)}</span>
                        </div>
                    `;
                }
                
                html += `
                        </div>
                    </details>
                `;
            }
            
            html += `
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    if (html === '') {
        html = `
            <div style="text-align: center; padding: 40px; color: #999;">
                <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 15px;"></i>
                <p>Aucune donnée d'inventaire disponible pour ce point de vente</p>
            </div>
        `;
    }
    
    content.innerHTML = html;
}

/**
 * Toggle l'affichage d'une super catégorie
 */
function toggleSuperCategorie(superCatKey) {
    const content = document.getElementById(`content-${superCatKey}`);
    const icon = document.getElementById(`icon-${superCatKey}`);
    
    if (!content || !icon) return;
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    } else {
        content.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
        icon.textContent = '▶';
    }
}

/**
 * Toggle l'affichage d'une sous-catégorie
 */
function toggleSousCategorie(sousCatKey) {
    const content = document.getElementById(`content-${sousCatKey}`);
    const icon = document.getElementById(`icon-${sousCatKey}`);
    
    if (!content || !icon) return;
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    } else {
        content.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
        icon.textContent = '▶';
    }
}

/**
 * Fermer le modal inventaire
 */
function fermerInventaire() {
    // Nettoyer l'intervalle de mise à jour de l'heure
    if (heureIntervalId) {
        clearInterval(heureIntervalId);
        heureIntervalId = null;
    }
    
    const modal = document.getElementById('modalInventaire');
    if (modal) {
        modal.remove();
    }
}

/**
 * Imprimer l'inventaire
 */
function imprimerInventaire() {
    window.print();
}

/**
 * Ouvrir la popup Stock Temps Réel
 */
function ouvrirStockTempsReel() {
    // Ouvrir une popup centrée avec le tableau de bord temps réel
    const width = 1400;
    const height = 800;
    const left = (window.screen.width / 2) - (width / 2);
    const top = (window.screen.height / 2) - (height / 2);
    
    const popup = window.open(
        'stock-temps-reel-popup.html',
        'StockTempsReel',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    
    if (!popup) {
        alert('Veuillez autoriser les pop-ups pour afficher le Stock Temps Réel');
    }
}

