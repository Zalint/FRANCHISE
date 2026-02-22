// ===== Statuts de paiement =====
const PAYMENT_STATUS_CONFIG = {
    'A': { label: 'A', title: 'En attente de paiement', class: 'bg-warning text-dark', icon: '', clickable: true },
    'P': { label: 'P', title: 'Payé', class: 'bg-success', icon: '✅', clickable: true },
    'C': { label: 'C', title: 'Créance (montant restant dû)', class: 'bg-danger', icon: '⚠️', clickable: true }
};

async function getCommandePaymentStatus(commandeId) {
    try {
        const response = await fetch(`/api/orders/${commandeId}/payment-status`, { credentials: 'include' });
        const result = await response.json();
        if (result.success) return result.data;
        return { posStatus: 'A', hasPaymentLink: false };
    } catch (error) {
        return { posStatus: 'A', hasPaymentLink: false };
    }
}

async function togglePaymentStatus(commandeId, badgeEl) {
    const currentStatus = badgeEl.dataset.status || 'A';
    // C (créance) ne se toggle pas via ce bouton
    if (currentStatus === 'C') {
        showToast('Statut créance non modifiable ici', 'warning');
        return;
    }
    const newStatus = currentStatus === 'A' ? 'P' : 'A';

    // Mise à jour optimiste du badge
    const config = PAYMENT_STATUS_CONFIG[newStatus];
    badgeEl.className = `badge ${config.class} payment-status-badge`;
    badgeEl.style.cursor = 'pointer';
    badgeEl.innerHTML = `${config.icon} ${config.label}`;
    badgeEl.dataset.status = newStatus;
    badgeEl.title = 'Cliquer pour changer le statut';

    try {
        const response = await fetch(`/api/orders/${commandeId}/payment-status`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.message);

        // Mettre à jour le tampon visuel
        const existingStamp = badgeEl.closest('.transaction-item')?.querySelector('.paid-stamp');
        if (existingStamp) existingStamp.remove();
        addPaidStampIfNeeded(commandeId, newStatus, 0, 0, 0);

        showToast(newStatus === 'P' ? '✅ Commande marquée comme payée' : '⏳ Commande remise en attente', 'success');

        // Recompter les filtres
        await loadPaymentStatusesForDisplayedCommandes();
    } catch (error) {
        // Annuler la mise à jour optimiste en cas d'erreur
        const oldConfig = PAYMENT_STATUS_CONFIG[currentStatus];
        badgeEl.className = `badge ${oldConfig.class} payment-status-badge`;
        badgeEl.innerHTML = `${oldConfig.icon} ${oldConfig.label}`;
        badgeEl.dataset.status = currentStatus;
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

// ===== Global Variables =====
let currentUser = null;
let cart = [];
let categories = {};
let products = {};
let currentCategory = 'all';
let currentSubCategory = 'all';
let selectedPaymentMethod = 'cash';
let brandConfig = null; // Brand configuration (MATA, SACRE_COEUR, etc.)
let commandesData = new Map(); // Store commandes data for details view
let kanbanCommandesData = []; // Store commandes for Kanban view
let livreursActifs = []; // Liste des livreurs actifs
let livreurDejaAssigne = {}; // Map des commandes avec livreur déjà assigné
let clientRatingsCache = {}; // Cache pour stocker les notes moyennes des clients (clé = numéro téléphone)
let clientCreditsCache = {}; // Cache pour stocker les crédits disponibles des clients (clé = numéro téléphone)
let clientTagsCache = {}; // Cache pour stocker les tags des clients (VVIP, VIP, etc.)

// Variables pour la modification de commande
let editingCommandeId = null; // ID de la commande en cours de modification
let savedCartBeforeEdit = null; // Sauvegarde du panier avant modification
let savedClientInfoBeforeEdit = null; // Sauvegarde des infos client avant modification

// ===== PRÉ-COMMANDES - Variables Globales =====
let precommandesData = []; // Stocker les pré-commandes
let precommandesTodayCount = 0; // Nombre de pré-commandes du jour
let checkPrecommandesInterval = null; // Intervalle pour vérifier

// ===== Helper Functions =====
/**
 * Escapes HTML special characters to prevent XSS attacks
 * @param {string} text - The text to escape
 * @returns {string} - The escaped text
 */
function escapeHtml(text) {
    if (text == null) return '';
    const str = String(text);
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return str.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Masks a phone number for logging (PII protection)
 * @param {string} phoneNumber - The phone number to mask
 * @returns {string} - The masked phone number (shows only last 4 digits)
 */
function maskPhoneNumber(phoneNumber) {
    if (phoneNumber == null) return '****';
    const phone = String(phoneNumber).trim();
    if (phone.length <= 4) return '****';
    return '***' + phone.slice(-4);
}

// ===== Modern Confirm Modal =====
function showModernConfirm(options) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modernConfirmModal');
        
        // Check if modal exists
        if (!modal) {
            console.error('❌ Modern confirm modal not found in DOM');
            // Fallback to native confirm
            const result = confirm(options.message || 'Êtes-vous sûr ?');
            resolve(result);
            return;
        }
        
        const title = document.getElementById('modernModalTitle');
        const message = document.getElementById('modernModalMessage');
        const confirmBtn = document.getElementById('modernModalConfirm');
        const cancelBtn = document.getElementById('modernModalCancel');
        const icon = modal.querySelector('.modern-modal-icon');
        
        // Double check all elements exist
        if (!title || !message || !confirmBtn || !cancelBtn || !icon) {
            console.error('❌ Modal elements not found');
            const result = confirm(options.message || 'Êtes-vous sûr ?');
            resolve(result);
            return;
        }
        
        // Set content
        title.textContent = options.title || 'Confirmation';
        message.textContent = options.message || 'Êtes-vous sûr ?';
        
        // Set icon type
        icon.className = 'modern-modal-icon';
        if (options.type === 'danger') {
            icon.classList.add('danger');
            icon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        } else if (options.type === 'warning') {
            icon.classList.add('warning');
            icon.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
        } else if (options.type === 'success') {
            icon.classList.add('success');
            icon.innerHTML = '<i class="fas fa-check-circle"></i>';
        } else {
            icon.innerHTML = '<i class="fas fa-question-circle"></i>';
        }
        
        // Set button texts
        confirmBtn.innerHTML = `<i class="fas fa-check"></i> ${options.confirmText || 'Confirmer'}`;
        cancelBtn.innerHTML = `<i class="fas fa-times"></i> ${options.cancelText || 'Annuler'}`;
        
        // Show modal
        modal.style.display = 'flex';
        
        // Handle confirm
        const handleConfirm = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        
        // Handle cancel
        const handleCancel = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        
        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        
        // Cleanup function
        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.removeEventListener('click', handleOverlayClick);
            document.removeEventListener('keydown', handleEscape);
        };
        
        // Handle overlay click
        const handleOverlayClick = (e) => {
            if (e.target === modal) {
                handleCancel();
            }
        };
        
        // Add event listeners
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        modal.addEventListener('click', handleOverlayClick);
        document.addEventListener('keydown', handleEscape);
    });
}

// ===== Helper Functions =====
// Load brand configuration
async function loadBrandConfig() {
    // Charger d'abord nomDuClient.json pour avoir le nom par défaut
    let nomClient = { nom: "Keur BALLI", site_web: "" };
    try {
        const nomResponse = await fetch('nomDuClient.json');
        if (nomResponse.ok) {
            nomClient = await nomResponse.json();
        }
    } catch (e) {
        console.warn('⚠️ nomDuClient.json non trouvé, utilisation des valeurs par défaut');
    }

    try {
        const response = await fetch('brand-config.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        brandConfig = await response.json();
        // Synchroniser KEUR_BALLI avec nomDuClient.json
        brandConfig["KEUR_BALLI"] = {
            "nom_complet": nomClient.nom || "Keur BALLI",
            "slogan": "",
            "site_web": nomClient.site_web || "",
            "telephones": [],
            "adresse_siege": "Dakar, Sénégal",
            "footer_facture": "Merci de votre confiance !",
            "footer_whatsapp": "Merci de votre confiance !"
        };
        console.log('✅ Brand configuration loaded:', Object.keys(brandConfig));
    } catch (error) {
        console.error('❌ Error loading brand config:', error);
        // Fallback sur nomDuClient.json
        brandConfig = {
            "KEUR_BALLI": {
                "nom_complet": nomClient.nom || "Keur BALLI",
                "slogan": "",
                "site_web": nomClient.site_web || "",
                "telephones": [],
                "adresse_siege": "Dakar, Sénégal",
                "footer_facture": "Merci de votre confiance !",
                "footer_whatsapp": "Merci de votre confiance !"
            }
        };
    }
}

// Get brand config based on current context (default: MATA)
function getBrandConfig(commandeId = null) {
    if (!brandConfig) return null;
    
    // Try to detect brand from commandeId (e.g., SAC1767387552645 -> SACRE_COEUR)
    if (commandeId && typeof commandeId === 'string') {
        // Extract the prefix (first 3 letters before digits)
        const prefixMatch = commandeId.match(/^([A-Z]+)/);
        if (prefixMatch) {
            const prefix = prefixMatch[1];
            
            // Check which brand has this prefix in their points_vente_codes
            for (const [brandKey, brandData] of Object.entries(brandConfig)) {
                if (brandData.points_vente_codes && brandData.points_vente_codes.includes(prefix)) {
                    console.log(`🏷️ Detected brand: ${brandKey} from commandeId: ${commandeId}`);
                    return brandData;
                }
            }
        }
    }
    
    // Fallback: Try to get from current point de vente selector
    const pointVenteSelect = document.getElementById('pointVenteSelect');
    if (pointVenteSelect && pointVenteSelect.value) {
        const pointVenteName = pointVenteSelect.value;
        
        // Check if point de vente name contains brand identifiers
        if (pointVenteName.toLowerCase().includes('sacre') || pointVenteName.toLowerCase().includes('sacré')) {
            console.log(`🏷️ Detected brand: SACRE_COEUR from point de vente: ${pointVenteName}`);
            return brandConfig['SACRE_COEUR'];
        }
    }
    
    // Default to KEUR_BALLI (nomDuClient)
    console.log('🏷️ Using default brand: KEUR_BALLI');
    return brandConfig['KEUR_BALLI'];
}

function normalizeQuantity(value) {
    console.log('🔢 [normalizeQuantity] INPUT:', value, 'type:', typeof value);
    if (typeof value === 'number') {
        // Round to 10 decimal places to eliminate floating-point precision errors
        // while preserving intentional values like 0.25, 0.125, etc.
        const result = Math.round(value * 10000000000) / 10000000000;
        console.log('🔢 [normalizeQuantity] OUTPUT (number):', result);
        return result;
    }
    let str = String(value).replace(',', '.');  // Change comma to dot
    let num = parseFloat(str);
    if (isNaN(num)) return 1;
    // Round to 10 decimal places to eliminate floating-point precision errors
    const result = Math.round(num * 10000000000) / 10000000000;
    console.log('🔢 [normalizeQuantity] OUTPUT (string):', result);
    return result;
}

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', async () => {
    // Detect and display environment
    detectEnvironment();
    
    // Load brand configuration
    await loadBrandConfig();
    
    await verifierSession();
    initialiserInterface(); // Set date FIRST
    await chargerDonnees();
    demarrerHorloge();
    
    // Check if modern modal is loaded
    const modernModal = document.getElementById('modernConfirmModal');
    if (modernModal) {
        console.log('✅ Modern confirmation modal loaded');
    } else {
        console.warn('⚠️ Modern confirmation modal not found - will use fallback');
    }
    
    // Initialize cart state - ensure cart-empty class is set initially
    const mobileCartPanel = document.querySelector('.mobile-cart-panel');
    if (mobileCartPanel) {
        if (cart.length === 0) {
            mobileCartPanel.classList.add('cart-empty');
            mobileCartPanel.classList.remove('cart-has-items');
        } else {
            mobileCartPanel.classList.add('cart-has-items');
            mobileCartPanel.classList.remove('cart-empty');
        }
    }
    
    // Initialize cart display
    afficherPanier();
    
    // Load saved cart if exists (this will override the initial state if cart has items)
    await chargerPanierSauvegarde();
    
    // Load summary AFTER date is initialized
    chargerResume();
    
    
    // 📋 Démarrer le monitoring des pré-commandes
    console.log('📋 [PRECOMMANDES] Initialisation du monitoring...');
    startPrecommandesCheck();
});

// ===== Environment Detection =====
function detectEnvironment() {
    const envBadge = document.getElementById('envBadge');
    const envText = document.getElementById('envText');
    
    if (!envBadge || !envText) return;
    
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || 
                    hostname === '127.0.0.1' || 
                    hostname.startsWith('192.168.') ||
                    hostname.startsWith('10.') ||
                    hostname.includes('local');
    
    if (isLocal) {
        envBadge.classList.add('local');
        envBadge.classList.remove('production');
        envText.textContent = 'LOCAL';
        console.log('🔧 Mode LOCAL - Environnement de développement');
    } else {
        envBadge.classList.add('production');
        envBadge.classList.remove('local');
        envText.textContent = 'PROD';
        console.log('🚀 Mode PRODUCTION - Environnement live');
    }
}

// ===== Session Management =====
async function verifierSession() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            window.location.href = 'login.html';
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.user) {
            window.location.href = 'login.html';
            return;
        }
        
        currentUser = data.user;
        
        console.log('✅ Session vérifiée pour:', currentUser.username, '- Role:', currentUser.role);
        
        // Update UI with user info
        document.getElementById('userName').textContent = currentUser.username;
        document.getElementById('userRole').textContent = currentUser.role;
        
        // Afficher le bouton Tableau de Bord uniquement pour Superviseur et SuperUtilisateur
        const userRole = currentUser.role;
        if (userRole === 'superviseur' || userRole === 'SuperUtilisateur' || userRole === 'superutilisateur') {
            const dashboardBtn = document.getElementById('realtime-dashboard-btn-pos');
            if (dashboardBtn) {
                dashboardBtn.style.display = 'inline-block';
                console.log('✅ Bouton Tableau de Bord activé pour:', userRole);
            }
        }
        
        // Vérifier les permissions pour l'export CSV
        checkCSVExportPermissions();
        
        // Load points de vente AFTER currentUser is set (non-blocking)
        chargerPointsDeVente();
        
    } catch (error) {
        console.error('Erreur de session:', error);
        window.location.href = 'login.html';
    }
}

/**
 * Vérifier si l'utilisateur peut modifier/supprimer une commande
 * @param {string} commandeId - ID de la commande
 * @returns {boolean} - true si l'utilisateur a le droit
 */
function canEditOrDeleteCommande(commandeId) {
    // Superviseurs et superutilisateurs ont tous les droits
    if (currentUser.role === 'superviseur' || currentUser.role === 'superutilisateur') {
        return true;
    }
    
    // Récupérer la commande depuis commandesData
    const commande = commandesData.get(commandeId);
    if (!commande || !commande.items || commande.items.length === 0) {
        return false;
    }
    
    // Récupérer la date de création de la commande
    const firstItem = commande.items[0];
    const commandeDate = firstItem.Date || firstItem.date;
    
    if (!commandeDate) {
        // Si pas de date, on autorise (sécurité failover)
        return true;
    }
    
    // Obtenir la date du jour au format DD-MM-YYYY
    const today = new Date();
    const todayStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
    
    // Normaliser la date de la commande au format DD-MM-YYYY
    let commandeDateStr = commandeDate;
    
    // Si la date est au format YYYY-MM-DD, la convertir
    if (commandeDate.includes('-') && commandeDate.split('-')[0].length === 4) {
        const parts = commandeDate.split('-');
        commandeDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    // Si la date est au format DD/MM/YYYY, la convertir
    else if (commandeDate.includes('/')) {
        commandeDateStr = commandeDate.replace(/\//g, '-');
    }
    
    // Autoriser seulement si la commande a été créée aujourd'hui
    return commandeDateStr === todayStr;
}

async function deconnexion() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        window.location.href = 'login.html';
    } catch (error) {
        console.error('Erreur déconnexion:', error);
        window.location.href = 'login.html';
    }
}

// ===== Load Data =====
async function chargerDonnees() {
    console.log('📦 chargerDonnees() - Chargement des produits');
    try {
        // Load categories and products
        const response = await fetch('/api/produits', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des produits');
        }
        
        products = await response.json();
        console.log('✅ Produits chargés:', Object.keys(products).length, 'catégories');
        
        // Group products by category
        categories = {};
        for (const [category, categoryProducts] of Object.entries(products)) {
            categories[category] = {
                name: category,
                products: categoryProducts
            };
        }
        
        console.log('📋 Affichage des catégories et produits...');
        afficherCategories();
        afficherProduits('all');
        
    } catch (error) {
        console.error('❌ Erreur chargement données:', error);
        alert('Erreur lors du chargement des données');
    }
}

async function chargerPointsDeVente() {
    try {
        // Ensure currentUser is loaded
        if (!currentUser) {
            console.error('❌ currentUser not loaded yet');
            return;
        }
        
        const response = await fetch('/api/points-vente?format=full', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des points de vente');
        }
        
        const pointsVente = await response.json();
        const select = document.getElementById('pointVenteSelect');
        
        if (!select) {
            console.error('❌ Element pointVenteSelect not found');
            return;
        }
        
        select.innerHTML = '';
        
        // Filter based on user access
        const userPointVente = currentUser.pointVente;
        const hasAccessToAll = userPointVente === "tous" || 
                               (Array.isArray(userPointVente) && userPointVente.includes("tous"));
        
        console.log('📍 Chargement points de vente pour:', currentUser.username, '- Accès:', userPointVente);
        
        let optionsAdded = 0;
        
        for (const [key, pdv] of Object.entries(pointsVente)) {
            if (!pdv.active) continue;
            
            // Check access
            if (hasAccessToAll) {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = key;
                select.appendChild(option);
                optionsAdded++;
            } else if (Array.isArray(userPointVente)) {
                if (userPointVente.includes(key)) {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = key;
                    select.appendChild(option);
                    optionsAdded++;
                }
            } else if (userPointVente === key) {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = key;
                select.appendChild(option);
                optionsAdded++;
            }
        }
        
        console.log(`✅ ${optionsAdded} points de vente ajoutés au sélecteur`);
        
        // Set default selection
        if (select.options.length > 0) {
            if (!hasAccessToAll && !Array.isArray(userPointVente)) {
                // Utilisateur lié à un seul point de vente : sélection automatique
                select.value = userPointVente;
            } else if (Array.isArray(userPointVente) && userPointVente.length === 1) {
                // Utilisateur avec accès à un seul point de vente (tableau) : sélection automatique
                select.value = userPointVente[0];
            } else {
                // Superviseur / accès "tous" : sélectionner le premier par défaut
                select.value = select.options[0].value;
            }
        } else {
            console.error('⚠️ Aucun point de vente accessible pour cet utilisateur');
        }
        
        // Add change listener to reload summary when point de vente changes
        select.addEventListener('change', () => {
            chargerResume();
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement points de vente:', error);
    }
}

// ===== UI Initialization =====
function initialiserInterface() {
    // Set today's date IMMEDIATELY
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayFormatted = `${year}-${month}-${day}`;
    
    const dateInput = document.getElementById('summaryDate');
    if (dateInput) {
        dateInput.value = todayFormatted;
        console.log('📅 Date initialisée:', todayFormatted);
        
        // Add change listener to reload summary when date changes
        dateInput.addEventListener('change', () => {
            chargerResume();
        });
    }
    
    // Initialize search
    document.getElementById('searchProduct').addEventListener('input', (e) => {
        rechercherProduit(e.target.value);
    });
}

function demarrerHorloge() {
    function mettreAJourHeure() {
        const now = new Date();
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        const dateStr = now.toLocaleDateString('fr-FR', options);
        document.getElementById('currentDateTime').textContent = dateStr;
    }
    
    mettreAJourHeure();
    setInterval(mettreAJourHeure, 60000); // Update every minute
}

// ===== Display Categories =====
// Regroupement des catégories : Import OCR → Superette, reste → Boucherie
const SUPERETTE_SOURCE = 'Import OCR';
function getCategoryGroup(catKey) {
    return catKey === SUPERETTE_SOURCE ? 'Superette' : 'Boucherie';
}

function afficherCategories() {
    // Desktop buttons
    const container = document.getElementById('categoriesList');
    container.innerHTML = '';

    const grouped = ['all', 'Superette', 'Boucherie'];
    const labels = { all: 'Tous', Superette: 'Superette', Boucherie: 'Boucherie' };

    grouped.forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'category-btn' + (key === 'all' ? ' active' : '');
        btn.textContent = labels[key];
        btn.dataset.group = key;
        btn.onclick = () => selectionnerCategorie(key, btn);
        container.appendChild(btn);
    });

    // Sous-catégories Boucherie (toutes les catégories sauf Import OCR)
    const subContainer = document.getElementById('subCategoriesList');
    if (subContainer) {
        subContainer.innerHTML = '';
        const boucherieSubCats = Object.keys(products).filter(k => k !== SUPERETTE_SOURCE);
        if (boucherieSubCats.length > 0) {
            // Bouton "Tous" pour réinitialiser le filtre sous-catégorie
            const allBtn = document.createElement('button');
            allBtn.className = 'subcategory-btn active';
            allBtn.textContent = 'Tous';
            allBtn.dataset.subcat = 'all';
            allBtn.onclick = () => selectionnerSousCategorie('all', allBtn);
            subContainer.appendChild(allBtn);

            boucherieSubCats.forEach(catKey => {
                const btn = document.createElement('button');
                btn.className = 'subcategory-btn';
                btn.textContent = catKey;
                btn.dataset.subcat = catKey;
                btn.onclick = () => selectionnerSousCategorie(catKey, btn);
                subContainer.appendChild(btn);
            });
        }
    }

    // Mobile dropdown
    const dropdown = document.getElementById('categoryDropdown');
    if (dropdown) {
        dropdown.innerHTML = '<option value="all">Toutes les catégories</option>';
        ['Superette', 'Boucherie'].forEach(g => {
            const option = document.createElement('option');
            option.value = g;
            option.textContent = g;
            dropdown.appendChild(option);
        });
        dropdown.onchange = (e) => {
            currentCategory = e.target.value;
            afficherProduits(e.target.value);
        };
    }
}

function selectionnerCategorie(categoryKey, btnElement) {
    document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');

    currentCategory = categoryKey;
    currentSubCategory = 'all';

    // Afficher/masquer les sous-catégories selon la catégorie sélectionnée
    const subContainer = document.getElementById('subCategoriesList');
    if (subContainer) {
        subContainer.style.display = (categoryKey === 'Boucherie') ? 'flex' : 'none';
        // Réinitialiser le bouton actif
        subContainer.querySelectorAll('.subcategory-btn').forEach(b => b.classList.remove('active'));
        const allBtn = subContainer.querySelector('[data-subcat="all"]');
        if (allBtn) allBtn.classList.add('active');
    }

    afficherProduits(categoryKey);
}

function selectionnerSousCategorie(subCatKey, btnElement) {
    document.querySelectorAll('.subcategory-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');

    currentSubCategory = subCatKey;
    afficherProduits(currentCategory);
}

// ===== Display Products =====
function afficherProduits(categoryKey) {
    console.log('🎨 afficherProduits appelée - Catégorie:', categoryKey);
    const container = document.getElementById('productsGrid');
    if (!container) {
        console.error('❌ productsGrid container not found!');
        return;
    }
    console.log('✅ productsGrid container found');
    container.innerHTML = '';
    
    let productsToShow = [];

    // Superette = Import OCR, Boucherie = tout le reste
    for (const [catKey, catProducts] of Object.entries(products)) {
        const group = getCategoryGroup(catKey);
        if (categoryKey !== 'all' && group !== categoryKey) continue;
        // Filtre sous-catégorie (uniquement pour Boucherie)
        if (group === 'Boucherie' && currentSubCategory !== 'all' && catKey !== currentSubCategory) continue;
        for (const [productName, productData] of Object.entries(catProducts)) {
            const price = typeof productData === 'object' ? (productData.default || 0) : productData;
            productsToShow.push({
                name: productName,
                price: price,
                category: group === 'Boucherie' ? catKey : group
            });
        }
    }
    
    // Create product cards
    productsToShow.forEach(product => {
        const card = creerCarteProduct(product);
        container.appendChild(card);
    });
    
    console.log(`📦 ${productsToShow.length} produits affichés`);
    
    if (productsToShow.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem;">Aucun produit trouvé</p>';
    }
}

function creerCarteProduct(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    
    // Content container
    const content = document.createElement('div');
    content.className = 'product-card-content';
    content.innerHTML = `
        <div class="product-name">${product.name}</div>
        <div class="product-price">${formatCurrency(product.price)}</div>
        <div class="product-category">${product.category === 'Import OCR' ? 'Superette' : product.category}</div>
    `;
    
    // Add button for mobile
    const addBtn = document.createElement('button');
    addBtn.className = 'product-add-btn';
    addBtn.innerHTML = '<i class="fas fa-plus"></i>';
    addBtn.onclick = (e) => {
        e.stopPropagation();
        ajouterAuPanier(product);
    };
    
    // Desktop: click on card
    card.onclick = () => {
        if (window.innerWidth > 768) {
            ajouterAuPanier(product);
        }
    };
    
    card.appendChild(content);
    card.appendChild(addBtn);
    
    return card;
}

function rechercherProduit(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    
    if (!term) {
        afficherProduits(currentCategory);
        return;
    }
    
    const container = document.getElementById('productsGrid');
    container.innerHTML = '';
    
    let found = [];
    
    for (const [catKey, catProducts] of Object.entries(products)) {
        for (const [productName, productData] of Object.entries(catProducts)) {
            if (productName.toLowerCase().includes(term)) {
                const price = typeof productData === 'object' ? (productData.default || 0) : productData;
                found.push({
                    name: productName,
                    price: price,
                    category: catKey
                });
            }
        }
    }
    
    found.forEach(product => {
        const card = creerCarteProduct(product);
        container.appendChild(card);
    });
    
    if (found.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem;">Aucun produit trouvé</p>';
    }
}

// ===== Cart Management =====
function ajouterAuPanier(product) {
    // Check if product already in cart
    const existingItem = cart.find(item => 
        item.name === product.name && item.category === product.category
    );
    
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({
            name: product.name,
            price: product.price,
            category: product.category,
            quantity: 1
        });
    }
    
    afficherPanier();
    
    // Visual feedback
    playAddToCartAnimation();
}

/**
 * Add product to cart with specific quantity (supports decimals)
 */
function ajouterAuPanierAvecQuantite(product, quantity) {
    // Normalize quantity to avoid floating point issues
    const normalizedQty = normalizeQuantity(quantity);
    
    // Reject invalid quantities (not finite or non-positive)
    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
        console.warn('⚠️ Quantité invalide, nulle ou négative, article non ajouté:', normalizedQty);
        return;
    }
    
    // Check if product already in cart
    const existingItem = cart.find(item => 
        item.name === product.name && item.category === product.category
    );
    
    if (existingItem) {
        const newQty = normalizeQuantity(existingItem.quantity + normalizedQty);
        if (Number.isFinite(newQty) && newQty > 0) {
            existingItem.quantity = newQty;
        } else {
            // Remove item from cart if quantity becomes invalid
            const index = cart.indexOf(existingItem);
            if (index > -1) {
                cart.splice(index, 1);
            }
        }
    } else {
        cart.push({
            name: product.name,
            price: product.price,
            category: product.category,
            quantity: normalizedQty
        });
    }
    
    afficherPanier();
}

function afficherPanier() {
    const container = document.getElementById('cartItems');
    const mobileContainer = document.getElementById('mobileCartItems');
    const mobileCartPanel = document.querySelector('.mobile-cart-panel');
    
    // Toggle cart state classes for adaptive behavior
    if (mobileCartPanel) {
    if (cart.length === 0) {
            mobileCartPanel.classList.remove('cart-has-items');
            mobileCartPanel.classList.add('cart-empty');
        } else {
            mobileCartPanel.classList.remove('cart-empty');
            mobileCartPanel.classList.add('cart-has-items');
        }
    }
    
    if (cart.length === 0) {
        const emptyHTML = `
            <div class="cart-empty">
                <i class="fas fa-shopping-cart"></i>
                <p>Votre panier est vide</p>
                <small>Sélectionnez des produits pour commencer</small>
            </div>
        `;
        container.innerHTML = emptyHTML;
        if (mobileContainer) {
            mobileContainer.innerHTML = emptyHTML;
        }
        mettreAJourTotaux();
        return;
    }
    
    container.innerHTML = '';
    if (mobileContainer) {
        mobileContainer.innerHTML = '';
    }
    
    cart.forEach((item, index) => {
        const itemElement = creerElementPanier(item, index);
        container.appendChild(itemElement);
        
        // Create mobile version
        if (mobileContainer) {
            const mobileItemElement = creerElementPanierMobile(item, index);
            mobileContainer.appendChild(mobileItemElement);
        }
    });
    
    mettreAJourTotaux();
}

function creerElementPanier(item, index) {
    const div = document.createElement('div');
    div.className = 'cart-item';
    
    const normalizedQty = normalizeQuantity(item.quantity);
    const total = item.price * normalizedQty;
    
    // Check if it's a pack
    const isPack = item.category === 'Pack' || item.name.toLowerCase().includes('pack');
    const packIndicator = isPack ? `<button class="btn-pack-edit" onclick="ouvrirModalPackComposition(${index})" title="Modifier la composition du pack"><i class="fas fa-box-open"></i></button>` : '';
    
    div.innerHTML = `
        <div class="cart-item-info">
            <div class="cart-item-name">
                ${item.name}
                ${packIndicator}
                ${item.composition ? '<span class="pack-modified-badge" title="Composition modifiée"><i class="fas fa-pencil-alt"></i></span>' : ''}
            </div>
            <div class="cart-item-price">
                <input type="number" class="price-input" value="${item.price}" 
                       onchange="changerPrix(${index}, this.value)" 
                       min="1" step="100"
                       title="Cliquez pour modifier le prix">
                FCFA × ${normalizedQty}
            </div>
        </div>
        <div class="cart-item-controls">
            <div class="quantity-controls">
                <button class="qty-btn" onclick="modifierQuantite(${index}, -1)">
                    <i class="fas fa-minus"></i>
                </button>
                <input type="text" class="qty-input" value="${normalizedQty}" 
                       onchange="changerQuantite(${index}, this.value)"
                       title="Entrez la quantité (ex: 1.5 ou 1,5)">
                <button class="qty-btn" onclick="modifierQuantite(${index}, 1)">
                    <i class="fas fa-plus"></i>
                </button>
            </div>
            <div class="cart-item-total">${formatCurrency(total)}</div>
            <button class="btn-remove" onclick="retirerDuPanier(${index})">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    
    return div;
}

function creerElementPanierMobile(item, index) {
    const div = document.createElement('div');
    div.className = 'cart-item';
    
    const normalizedQty = normalizeQuantity(item.quantity);
    const total = item.price * normalizedQty;
    
    // Check if it's a pack
    const isPack = item.category === 'Pack' || item.name.toLowerCase().includes('pack');
    const packIndicator = isPack ? `<button class="btn-pack-edit-mobile" onclick="ouvrirModalPackComposition(${index})" title="Modifier composition"><i class="fas fa-box-open"></i></button>` : '';
    
    div.innerHTML = `
        <div class="cart-item-info">
            <div class="cart-item-name">
                ${item.name}
                ${packIndicator}
                ${item.composition ? '<span class="pack-modified-badge" title="Modifié"><i class="fas fa-pencil-alt"></i></span>' : ''}
            </div>
            <div class="cart-item-price">${formatCurrency(item.price)} × ${normalizedQty} = ${formatCurrency(total)}</div>
        </div>
        <div class="cart-item-controls">
            <button class="btn-qty" onclick="modifierQuantite(${index}, -1)">
                <i class="fas fa-minus"></i>
            </button>
            <span class="item-quantity">${normalizedQty}</span>
            <button class="btn-qty" onclick="modifierQuantite(${index}, 1)">
                <i class="fas fa-plus"></i>
            </button>
        </div>
    `;
    
    return div;
}

function modifierQuantite(index, delta) {
    if (cart[index]) {
        cart[index].quantity = normalizeQuantity(cart[index].quantity + (delta * 0.1));
        
        if (cart[index].quantity <= 0) {
            cart.splice(index, 1);
        }
        
        afficherPanier();
    }
}

function changerQuantite(index, newValue) {
    const qty = normalizeQuantity(newValue);
    
    if (cart[index] && qty > 0) {
        cart[index].quantity = qty;
        afficherPanier();
    } else if (qty <= 0) {
        retirerDuPanier(index);
    }
}

function changerPrix(index, newValue) {
    const price = parseFloat(newValue);
    
    if (cart[index] && price > 0) {
        cart[index].price = price;
        afficherPanier();
        showToast(`Prix modifié: ${formatCurrency(price)}`, 'success');
    } else {
        showToast('Prix invalide', 'error');
        afficherPanier(); // Restore original value
    }
}

async function retirerDuPanier(index) {
    const confirmed = await showModernConfirm({
        title: 'Retirer l\'article',
        message: 'Voulez-vous retirer cet article du panier ?',
        type: 'warning',
        confirmText: 'Retirer',
        cancelText: 'Annuler'
    });
    
    if (confirmed) {
        cart.splice(index, 1);
        afficherPanier();
    }
}

async function viderPanier() {
    if (cart.length === 0) return;
    
    const confirmed = await showModernConfirm({
        title: 'Vider le panier',
        message: `Voulez-vous vider le panier ? (${cart.length} article${cart.length > 1 ? 's' : ''})`,
        type: 'danger',
        confirmText: 'Vider',
        cancelText: 'Annuler'
    });
    
    if (confirmed) {
        cart = [];
        
        // Réinitialiser l'état d'édition si on vide le panier
        editingCommandeId = null;
        savedCartBeforeEdit = null;
        savedClientInfoBeforeEdit = null;
        
        afficherPanier();
        updateCartButtons(); // Masquer le bouton "Annuler"
        
        // Clear saved cart from session
        fetch('/api/clear-cart', {
            method: 'POST',
            credentials: 'include'
        }).catch(err => console.error('Erreur lors de la suppression du panier:', err));
        
        // Clear client information when emptying cart
        document.getElementById('clientName').value = '';
        document.getElementById('clientPhone').value = '';
        document.getElementById('clientAddress').value = '';
        document.getElementById('clientInstructions').value = '';
        
        showToast('Panier vidé', 'success');
    }
}

function mettreAJourTotaux() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const total = subtotal; // Pas de taxe pour l'instant
    
    document.getElementById('subtotal').textContent = formatCurrency(subtotal);
    document.getElementById('total').textContent = formatCurrency(total);
    
    // Update mobile cart
    const mobileTotal = document.getElementById('mobileTotal');
    if (mobileTotal) {
        mobileTotal.textContent = formatCurrency(total);
    }
    
    // Update mobile cart count badge
    const mobileCartCount = document.getElementById('mobileCartCount');
    if (mobileCartCount) {
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        mobileCartCount.textContent = totalItems;
    }
}

// ===== Payment =====

async function ouvrirModalPaiement() {
    if (cart.length === 0) {
        alert('Le panier est vide');
        return;
    }
    
    const pointVente = document.getElementById('pointVenteSelect').value;
    if (!pointVente) {
        alert('Veuillez sélectionner un point de vente');
        return;
    }
    
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('paymentAmount').textContent = formatCurrency(total);
    
    // Reset payment form
    document.getElementById('receivedAmount').value = total; // Pré-remplir avec le montant à payer
    document.getElementById('changeAmount').textContent = '0 FCFA';
    
    
    // Ne réinitialiser les informations client que si elles sont vides
    // Cela permet de conserver les informations lors de la modification d'une commande
    const clientNameField = document.getElementById('clientName');
    const clientPhoneField = document.getElementById('clientPhone');
    const clientAddressField = document.getElementById('clientAddress');
    const clientInstructionsField = document.getElementById('clientInstructions');
    
    if (!clientNameField.value) {
        clientNameField.value = '';
    }
    if (!clientPhoneField.value) {
        clientPhoneField.value = '';
    }
    if (!clientAddressField.value) {
        clientAddressField.value = '';
    }
    if (!clientInstructionsField.value) {
        clientInstructionsField.value = '';
    }
    
    // 🆕 Vérifier et afficher le crédit disponible (non-bloquant)
    const clientPhone = clientPhoneField.value.trim();
    const creditSection = document.getElementById('creditSection');
    const creditAmount = document.getElementById('creditAmount');
    const useCreditCheckbox = document.getElementById('useCredit');
    
    if (clientPhone && clientCreditsCache[clientPhone]) {
        const credit = clientCreditsCache[clientPhone];
        if (credit && credit.balance > 0 && !credit.is_expired) {
            // Crédit disponible et valide → afficher la section
            if (creditSection) {
                creditSection.style.display = 'block';
                
                const availableCreditDisplay = document.getElementById('availableCreditDisplay');
                const creditExpirationInfo = document.getElementById('creditExpirationInfo');
                
                if (availableCreditDisplay) {
                    availableCreditDisplay.textContent = formatCurrency(credit.balance);
                }
                
                if (creditExpirationInfo && credit.days_remaining !== undefined) {
                    const expirationText = credit.days_remaining > 1 
                        ? `Expire dans ${credit.days_remaining} jours`
                        : credit.days_remaining === 1 
                        ? 'Expire demain !'
                        : 'Expire aujourd\'hui !';
                    creditExpirationInfo.textContent = expirationText;
                    creditExpirationInfo.style.color = credit.days_remaining <= 3 ? '#FF5722' : '#4CAF50';
                }
                
                useCreditCheckbox.checked = true; // Coché par défaut
                useCreditCheckbox.dataset.creditBalance = credit.balance;
                useCreditCheckbox.dataset.creditVersion = credit.version || 0;
                useCreditCheckbox.dataset.clientPhone = clientPhone;
                
                console.log(`🎁 Crédit disponible affiché: ${credit.balance} FCFA (version ${credit.version}) pour ${clientPhone}`);
                
                // Mettre à jour le montant à payer si crédit coché
                updatePaymentWithCredit();
            }
        } else {
            // Crédit épuisé, expiré, ou inexistant → cacher la section
            if (creditSection) creditSection.style.display = 'none';
            if (credit && credit.is_expired) {
                console.log(`⚠️ Crédit expiré pour ${clientPhone}, section cachée`);
            }
            
            // Réinitialiser la checkbox et ses données pour éviter un état obsolète
            if (useCreditCheckbox) {
                useCreditCheckbox.checked = false;
                useCreditCheckbox.dataset.creditBalance = '0';
                useCreditCheckbox.dataset.creditVersion = '0';
                useCreditCheckbox.dataset.clientPhone = '';
            }
            updatePaymentWithCredit();
        }
    } else {
        // Pas de téléphone ou pas de crédit → cacher la section
        if (creditSection) creditSection.style.display = 'none';
        
        // Réinitialiser la checkbox et ses données pour éviter un état obsolète
        if (useCreditCheckbox) {
            useCreditCheckbox.checked = false;
            useCreditCheckbox.dataset.creditBalance = '0';
            useCreditCheckbox.dataset.creditVersion = '0';
            useCreditCheckbox.dataset.clientPhone = '';
        }
        updatePaymentWithCredit();
    }
    
    // Show modal
    document.getElementById('modalPaiement').classList.add('active');
    
    // Synchroniser les montants après l'affichage
    setTimeout(() => {
        if (creditSection && creditSection.style.display !== 'none') {
            updatePaymentWithCredit();
        }
    }, 50);
}

function fermerModalPaiement() {
    document.getElementById('modalPaiement').classList.remove('active');
}

/**
 * Mettre à jour le montant à payer avec ou sans crédit
 */
function updatePaymentWithCredit() {
    const useCreditCheckbox = document.getElementById('useCredit');
    const creditAppliedDiv = document.getElementById('creditApplied');
    const finalAmountDiv = document.getElementById('finalPaymentAmount');
    const receivedAmountInput = document.getElementById('receivedAmount');
    
    if (!useCreditCheckbox || !creditAppliedDiv || !finalAmountDiv) return;
    
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const creditBalance = parseFloat(useCreditCheckbox.dataset.creditBalance || 0);
    const useCredit = useCreditCheckbox.checked;
    
    if (useCredit && creditBalance > 0) {
        // Appliquer le crédit
        const creditToUse = Math.min(creditBalance, total); // Ne pas utiliser plus que le total
        const finalAmount = Math.max(0, total - creditToUse);
        
        creditAppliedDiv.style.display = 'block';
        creditAppliedDiv.querySelector('.credit-applied-amount').textContent = formatCurrency(creditToUse);
        finalAmountDiv.textContent = formatCurrency(finalAmount);
        
        // Mettre à jour le montant reçu
        receivedAmountInput.value = finalAmount;
        
        console.log(`💳 Crédit appliqué: ${creditToUse} FCFA, Montant final: ${finalAmount} FCFA`);
        
        // Recalculer la monnaie avec le montant final (après crédit)
        calculerMonnaie(finalAmount);
    } else {
        // Ne pas appliquer le crédit
        creditAppliedDiv.style.display = 'none';
        finalAmountDiv.textContent = formatCurrency(total);
        receivedAmountInput.value = total;
        
        // Recalculer la monnaie avec le montant total (sans crédit)
        calculerMonnaie(total);
    }
}

function selectionnerMethodePaiement(method) {
    selectedPaymentMethod = method;
    
    // Update active class
    document.querySelectorAll('.payment-option').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.closest('.payment-option').classList.add('active');
    
    // Show/hide cash input section
    const cashSection = document.getElementById('cashPaymentSection');
    if (method === 'cash') {
        cashSection.style.display = 'block';
    } else {
        cashSection.style.display = 'none';
    }
}

function calculerMonnaie(amountDue) {
    // Déterminer le montant effectif à payer
    let effectiveAmount;
    
    if (amountDue !== undefined) {
        // Paramètre explicite fourni (appelé depuis updatePaymentWithCredit)
        effectiveAmount = amountDue;
    } else {
        // Pas de paramètre : détecter si le crédit est appliqué
        const useCreditCheckbox = document.getElementById('useCredit');
        const creditBalance = parseFloat(useCreditCheckbox?.dataset.creditBalance || 0);
        const useCredit = useCreditCheckbox?.checked;
        const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        if (useCredit && creditBalance > 0) {
            // Crédit appliqué : utiliser le montant après déduction
            const creditToUse = Math.min(creditBalance, cartTotal);
            effectiveAmount = Math.max(0, cartTotal - creditToUse);
        } else {
            // Pas de crédit : utiliser le total du panier
            effectiveAmount = cartTotal;
        }
    }
    
    const received = parseFloat(document.getElementById('receivedAmount').value) || 0;
    const change = received - effectiveAmount;
    
    const changeDisplay = document.getElementById('changeAmount');
    if (change >= 0) {
        changeDisplay.textContent = formatCurrency(change);
        changeDisplay.style.color = 'var(--success-color)';
    } else {
        changeDisplay.textContent = formatCurrency(Math.abs(change)) + ' manquant';
        changeDisplay.style.color = 'var(--primary-color)';
    }
}

async function confirmerPaiement(event) {
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const pointVente = document.getElementById('pointVenteSelect').value;
    
    // Capturer le montant restant dû (créance si cash insuffisant)
    let montantRestantDu = 0;
    if (selectedPaymentMethod === 'cash') {
        const received = parseFloat(document.getElementById('receivedAmount').value) || 0;
        console.log('💵 [CLIENT] Calcul créance - Total:', total, 'Reçu:', received);
        
        if (received < total) {
            // Le client n'a pas assez payé → créance
            montantRestantDu = total - received;
            console.log('💳 [CLIENT] CRÉANCE DÉTECTÉE! Montant restant dû:', montantRestantDu);
        } else {
            console.log('✅ [CLIENT] Paiement complet (pas de créance)');
        }
        // Note: On laisse passer même si received < total
    }
    
    // Si on est en mode édition, supprimer l'ancienne commande AVANT de sauvegarder la nouvelle
    if (editingCommandeId) {
        try {
            await fetch(`/api/commandes/${encodeURIComponent(editingCommandeId)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            console.log('✅ Ancienne commande supprimée:', editingCommandeId);
        } catch (error) {
            console.error('⚠️ Erreur suppression ancienne commande:', error);
            showToast('Erreur lors de la suppression de l\'ancienne commande', 'error');
            return;
        }
    }
    
    // Get client info
    const clientInfo = {
        nom: document.getElementById('clientName').value.trim() || null,
        numero: document.getElementById('clientPhone').value.trim() || null,
        adresse: document.getElementById('clientAddress').value.trim() || null,
        instructions: document.getElementById('clientInstructions').value.trim() || null,
        creance: montantRestantDu > 0 // Marquer comme créance si montant dû
    };
    
    console.log('📋 [CLIENT] Info client - Créance:', clientInfo.creance, 'Montant dû:', montantRestantDu);
    
    // Prepare sales data
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    // Calculate mois (MM/YYYY format)
    const mois = `${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    
    // Calculate semaine (week number)
    const getWeekNumber = (date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };
    const semaine = getWeekNumber(today);
    
    // Generate unique commande_id with format: PDV + timestamp
    // Ex: MBA1703620851234 for Mbao, OFO1703620851234 for O.Foire
    const pdvCode = pointVente
        .replace(/[.\s]/g, '') // Remove dots and spaces
        .substring(0, 3) // Take first 3 characters
        .toUpperCase(); // Uppercase
    const timestamp = Date.now();
    const commandeId = `${pdvCode}${timestamp}`;
    
    console.log('🆔 Génération commande_id:', commandeId, `(${pointVente} → ${pdvCode})`);
    
    // Déterminer le statut en fonction du checkbox "Sur place"
    const surPlaceCheckbox = document.getElementById('commandeSurPlace');
    const statutInitial = (surPlaceCheckbox && surPlaceCheckbox.checked) ? 'sur_place' : 'en_preparation';
    
    console.log('📍 Statut initial de la commande:', statutInitial, '(Sur place:', surPlaceCheckbox?.checked || false, ')');
    
    // 🆕 Calculer le crédit utilisé pour le stocker dans l'extension
    let creditUsed = 0;
    const useCreditCheckbox = document.getElementById('useCredit');
    if (useCreditCheckbox && useCreditCheckbox.checked && clientInfo.numero) {
        const creditBalance = parseFloat(useCreditCheckbox.dataset.creditBalance || 0);
        if (creditBalance > 0) {
            creditUsed = Math.min(creditBalance, total);
            console.log(`💳 Crédit qui sera utilisé: ${creditUsed} FCFA`);
        }
    }
    
    const ventes = cart.map(item => {
        console.log('🛒 [CLIENT] Item du panier:', { name: item.name, quantity: item.quantity, type: typeof item.quantity });
        const venteData = {
            date: dateStr,
            mois: mois,
            semaine: semaine,
            pointVente: pointVente,
            preparation: pointVente,
            categorie: item.category,
            produit: item.name,
            prixUnit: item.price,
            quantite: item.quantity, // Utiliser 'quantite' au lieu de 'nombre'
            total: item.price * item.quantity, // Utiliser 'total' au lieu de 'montant'
            nomClient: clientInfo.nom,
            numeroClient: clientInfo.numero,
            adresseClient: clientInfo.adresse,
            instructionsClient: clientInfo.instructions,
            creance: clientInfo.creance,
            paymentMethod: selectedPaymentMethod,
            commandeId: commandeId, // Add commande_id to group sales together
            montant_restant_du: montantRestantDu, // Use snake_case for consistency
            statut_preparation: statutInitial // Use snake_case for consistency
        };
        
        console.log('📦 [CLIENT] venteData pour', item.name, '- quantite:', venteData.quantite, 'montant_restant_du:', venteData.montant_restant_du, 'creance:', venteData.creance, 'statut:', venteData.statut_preparation);
        
        // Add pack composition if exists
        if (item.composition && item.composition.length > 0) {
            venteData.extension = {
                pack_type: item.name,
                composition: item.composition,
                modifie: true
            };
        }
        
        // 🆕 Note: Le crédit sera enregistré dans la table commande_credits (pas dans ventes.extension)
        // La création de l'enregistrement se fera dans applyCreditAsync() après confirmation
        
        return venteData;
    });
    
    try {
        // Show loading
        const btnConfirm = event.target;
        const originalText = btnConfirm.innerHTML;
        btnConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Traitement...';
        btnConfirm.disabled = true;
        
        console.log('📤 [CLIENT] Envoi au serveur - Nombre de ventes:', ventes.length);
        console.log('📤 [CLIENT] Payload:', JSON.stringify(ventes, null, 2));
        
        // Send to server
        const response = await fetch('/api/ventes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(ventes)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Erreur lors de l\'enregistrement');
        }
        
        // Success
        console.log('✅ Ventes enregistrées avec succès');
        
        // 🆕 Appliquer le crédit client si demandé (synchrone avec attente)
        const useCreditCheckbox = document.getElementById('useCredit');
        if (useCreditCheckbox && useCreditCheckbox.checked && clientInfo.numero) {
            const creditBalance = parseFloat(useCreditCheckbox.dataset.creditBalance || 0);
            if (creditBalance > 0) {
                const creditToUse = Math.min(creditBalance, total);
                console.log(`🎁 Application du crédit: ${creditToUse} FCFA pour ${clientInfo.numero}`);
                
                // Afficher un message de chargement
                showToast('⏳ Application du crédit en cours...', 'info');
                
                // Attendre que le crédit soit appliqué avant de continuer
                await applyCreditAsync(commandeId, clientInfo.numero, creditToUse);
            }
        }
        
        // Réinitialiser l'état d'édition
        editingCommandeId = null;
        savedCartBeforeEdit = null;
        savedClientInfoBeforeEdit = null;
        
        // Reset cart
        cart = [];
        afficherPanier();
        updateCartButtons(); // Masquer le bouton "Annuler"
        
        // Clear saved cart from session
        fetch('/api/clear-cart', {
            method: 'POST',
            credentials: 'include'
        }).catch(err => console.error('Erreur lors de la suppression du panier:', err));
        
        // Close payment modal
        fermerModalPaiement();
        
        // Update date selector to today before reloading
        const dateInput = document.getElementById('summaryDate');
        if (dateInput) {
            const today = new Date().toISOString().split('T')[0];
            dateInput.value = today;
        }
        
        // Reload summary to show the new transaction
        await chargerResume();
        
        // Clear client information after successful payment
        document.getElementById('clientName').value = '';
        document.getElementById('clientPhone').value = '';
        document.getElementById('clientAddress').value = '';
        document.getElementById('clientInstructions').value = '';
        
        // Reset checkbox "Sur place"
        const surPlaceCheckbox = document.getElementById('commandeSurPlace');
        if (surPlaceCheckbox) {
            surPlaceCheckbox.checked = false;
        }
        
        // Show success feedback
        const feedback = document.createElement('div');
        feedback.className = 'toast-success';
        feedback.innerHTML = '<i class="fas fa-check-circle"></i> Commande enregistrée !';
        document.body.appendChild(feedback);
        setTimeout(() => {
            feedback.classList.add('show');
        }, 100);
        setTimeout(() => {
            feedback.classList.remove('show');
            setTimeout(() => feedback.remove(), 300);
        }, 2000);
        
        // Reset button
        btnConfirm.innerHTML = originalText;
        btnConfirm.disabled = false;
        
    } catch (error) {
        console.error('Erreur paiement:', error);
        alert('Erreur lors du paiement: ' + error.message);
        
        // Reset button
        const btnConfirm = event.target;
        btnConfirm.innerHTML = 'Confirmer la commande';
        btnConfirm.disabled = false;
    }
}

// ===== Transactions Variables =====
// Variable supprimée - la pagination n'existe plus
// Pagination supprimée - toutes les transactions sont affichées

// ===== Save Cart =====
async function sauvegarderPanier() {
    if (cart.length === 0) {
        showToast('Le panier est vide', 'warning');
        return;
    }
    
    try {
        const pointVente = document.getElementById('pointVenteSelect').value;
        
        // Save to session cookie via API
        const cartData = {
            pointVente: pointVente,
            items: cart,
            timestamp: new Date().toISOString()
        };
        
        const response = await fetch('/api/save-cart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(cartData)
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors de la sauvegarde');
        }
        
        showToast('Panier sauvegardé !', 'success');
        
    } catch (error) {
        console.error('Erreur sauvegarde:', error);
        showToast('Erreur lors de la sauvegarde', 'error');
    }
}

async function chargerPanierSauvegarde() {
    try {
        const response = await fetch('/api/load-cart', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.cart && data.cart.items && data.cart.items.length > 0) {
                cart = data.cart.items;
                
                // Set point de vente if saved
                if (data.cart.pointVente) {
                    const select = document.getElementById('pointVenteSelect');
                    if (select) {
                        select.value = data.cart.pointVente;
                    }
                }
                
                afficherPanier(); // This will update cart state classes
                showToast('Panier restauré', 'success');
            } else {
                // Ensure empty state is set if no cart loaded
                afficherPanier();
            }
        } else {
            // Ensure empty state is set if no response
            afficherPanier();
        }
    } catch (error) {
        console.error('Erreur chargement panier:', error);
        // Ensure empty state is set on error
        afficherPanier();
    }
}

// ===== Summary =====
let allTransactionsData = []; // Stocker toutes les transactions pour la recherche
let filteredTransactionsData = []; // Transactions après filtrage
let currentSearchTerm = ''; // Terme de recherche actuel

async function chargerResume() {
    try {
        const dateInput = document.getElementById('summaryDate');
        const date = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        const pointVente = document.getElementById('pointVenteSelect').value;
        
        console.log('📊 Chargement résumé - Date:', date, 'Point de vente:', pointVente);
        
        if (!date || !pointVente) {
            console.warn('⚠️ Date ou point de vente manquant');
            return;
        }

        // Mettre à jour le bouton Faire la caisse (label + état)
        mettreAJourBoutonCloture();
        
        // Convert date format for API
        const [year, month, day] = date.split('-');
        const formattedDate = `${day}-${month}-${year}`;
        
        console.log('📅 Date formatée pour API:', formattedDate);
        
        // Fetch sales data
        const response = await fetch(`/api/ventes-date?date=${formattedDate}&pointVente=${pointVente}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des ventes');
        }
        
        const data = await response.json();
        
        // Extract ventes array from response
        const ventes = data.ventes || [];
        
    // DEBUG: log first vente to inspect backend field names
    if (ventes.length > 0) {
        const sample = ventes[0];
        console.log('🔍 SAMPLE VENTE (backend response):', sample);
        console.log('🔍 commande_id:', sample.commande_id, 'commandeId:', sample.commandeId, 'commande:', sample.commande);
    } else {
        console.log('🔍 SAMPLE VENTE: aucune vente renvoyée');
    }
    
        console.log('✅ Ventes chargées:', ventes.length, 'transactions');
        
        // Count unique commandes
        const commandesUniques = new Set();
        ventes.forEach(vente => {
            const commandeId = vente.commande_id || vente.commandeId;
            if (commandeId) {
                commandesUniques.add(commandeId);
            }
        });
        const totalCommandes = commandesUniques.size;
        
        // Calculate summary
        const totalTransactions = ventes.length;
        const totalRevenue = ventes.reduce((sum, vente) => sum + parseFloat(vente.Montant || 0), 0);
        const totalArticles = ventes.reduce((sum, vente) => sum + parseFloat(vente.Nombre || 0), 0);
        
        // Update UI
        const transactionsEl = document.getElementById('totalTransactions');
        const commandesEl = document.getElementById('totalCommandes');
        const revenueEl = document.getElementById('totalRevenue');
        const articlesEl = document.getElementById('totalArticles');
        
        if (transactionsEl) transactionsEl.textContent = totalTransactions;
        if (commandesEl) commandesEl.textContent = totalCommandes;
        if (revenueEl) revenueEl.textContent = formatCurrency(totalRevenue);
        if (articlesEl) articlesEl.textContent = Math.round(totalArticles);
        
        // Store ventes globally for search/filter
        allTransactionsData = ventes;
        
        // Apply current search filter if any
        appliquerFiltreTransactions();
        
    } catch (error) {
        console.error('Erreur chargement résumé:', error);
    }
}

function afficherTransactionsRecentes(ventes) {
    const container = document.getElementById('transactionsList');
    container.innerHTML = '';
    
    if (ventes.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:1rem;">Aucune transaction</p>';
        return;
    }
    
    // Group sales by commande_id
    const commandesMap = new Map();
    const salesWithoutCommandeId = [];
    
    ventes.forEach(vente => {
        const commandeId = vente.commande_id 
            || vente.commandeId 
            || vente.commande 
            || vente['Commande'] 
            || vente['Commande Id'] 
            || vente['commandeId']
            || vente['Commande_id']
            || vente['CommandeId']
            || vente['commande_id'];
        
        if (commandeId) {
            if (!commandesMap.has(commandeId)) {
                commandesMap.set(commandeId, []);
            }
            commandesMap.get(commandeId).push(vente);
        } else {
            // Old sales without commande_id - display individually
            salesWithoutCommandeId.push(vente);
        }
    });
    
    // Store commandesData globally for details view
    commandesData = new Map();
    commandesMap.forEach((items, commandeId) => {
        commandesData.set(commandeId, {
            commandeId: commandeId,
            items: items,
            createdAt: items[0].createdAt,
            totalAmount: items.reduce((sum, item) => sum + parseFloat(item.Montant || item.montant || 0), 0),
            livreur_assigne: items[0].livreur_assigne || null  // Preserve livreur_assigne
        });
    });
    
    // Convert to array for pagination
    const groupedTransactions = [
        // Grouped commands first (newest format)
        ...Array.from(commandesMap.entries()).map(([commandeId, items]) => ({
            type: 'commande',
            commandeId: commandeId,
            items: items,
            createdAt: items[0].createdAt,
            totalAmount: items.reduce((sum, item) => sum + parseFloat(item.Montant || item.montant || 0), 0)
        })),
        // Individual old sales (backward compatibility)
        ...salesWithoutCommandeId.map(vente => ({
            type: 'vente',
            vente: vente
        }))
    ];
    
    // Sort by creation date (newest first) — fallback sur le timestamp dans commandeId
    const getTimestamp = (t) => {
        if (t.type === 'commande') {
            const ts = parseInt((t.commandeId || '').replace(/\D/g, ''), 10);
            if (ts > 0) return ts;
            return new Date(t.createdAt).getTime() || 0;
        }
        return new Date(t.vente.createdAt).getTime() || 0;
    };
    groupedTransactions.sort((a, b) => getTimestamp(b) - getTimestamp(a));
    
    // Display ALL transactions (no pagination)
    groupedTransactions.forEach(transaction => {
        if (transaction.type === 'commande') {
            // Display grouped command
            displayCommandeGroup(transaction, container);
        } else {
            // Display individual old sale
            displayIndividualSale(transaction.vente, container);
        }
    });
    
    // Update filter counters if in tracking mode
    updateStatusFilterCounters(groupedTransactions);
    
    // Charger les statuts de paiement de manière asynchrone
    loadPaymentStatusesForDisplayedCommandes();
    
    // 🆕 Pré-charger les notes moyennes de tous les clients avec numéros de téléphone
    preloadClientRatingsForDisplayedCommandes(groupedTransactions);
}

function updateStatusFilterCounters(transactions) {
    const counts = {
        all: 0,
        en_preparation: 0,
        pret: 0,
        en_livraison: 0
    };
    
    transactions.forEach(transaction => {
        if (transaction.type === 'commande') {
            counts.all++;
            const firstItem = transaction.items[0] || {};
            const status = firstItem.statut_preparation || 'en_preparation';
            if (counts[status] !== undefined) {
                counts[status]++;
            }
        }
    });
    
    // Update counter badges
    Object.keys(counts).forEach(status => {
        const counter = document.getElementById(`count-${status}`);
        if (counter) {
            counter.textContent = counts[status];
        }
    });
}

/**
 * Pré-charge les notes moyennes de tous les clients avec numéros de téléphone
 * Permet d'afficher les indicateurs 😞 plus rapidement sans attendre les clics
 * @param {Array} transactions - Liste des transactions groupées
 */
function preloadClientRatingsForDisplayedCommandes(transactions) {
    console.log('🔄 Pré-chargement des notes moyennes des clients...');
    
    // Collecter tous les numéros de téléphone uniques
    const phoneNumbers = new Set();
    
    transactions.forEach(transaction => {
        if (transaction.type === 'commande' && transaction.items && transaction.items.length > 0) {
            const firstItem = transaction.items[0];
            const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || firstItem.numero_client;
            
            if (clientPhone && !clientRatingsCache[clientPhone]) {
                phoneNumbers.add(clientPhone);
            }
        }
    });
    
    console.log(`📊 ${phoneNumbers.size} clients uniques à vérifier`);
    
    // Pré-charger les notes en arrière-plan (avec délai pour ne pas surcharger)
    let delay = 0;
    phoneNumbers.forEach(phoneNumber => {
        setTimeout(() => {
            getClientAverageRating(phoneNumber).then(rating => {
                if (rating !== null && rating !== undefined) {
                    let emoji, status;
                    if (rating > 9) {
                        emoji = '💚';
                        status = 'excellent';
                    } else if (rating > 8 && rating <= 9) {
                        emoji = '😊';
                        status = 'très satisfait';
                    } else if (rating > 7 && rating <= 8) {
                        emoji = '😐';
                        status = 'satisfait';
                    } else if (rating > 6 && rating <= 7) {
                        emoji = '😠';
                        status = 'insatisfait';
                    } else if (rating <= 6) {
                        emoji = '😡';
                        status = 'très insatisfait';
                    }
                    
                    if (emoji) {
                        console.log(`✅ Client ${maskPhoneNumber(phoneNumber)} - Note: ${rating}/10 (${status}) - Mise à jour des indicateurs...`);
                        // Mettre à jour tous les indicateurs pour ce numéro
                        updateAllIndicatorsForPhone(phoneNumber);
                        // Mettre à jour les compteurs des filtres
                        updateClientRatingFilterCounts();
                    }
                }
            });
        }, delay);
        delay += 200; // Espacer les appels de 200ms
    });
}

/**
 * Met à jour tous les indicateurs pour un numéro de téléphone donné
 * @param {string} phoneNumber - Numéro de téléphone du client
 */
function updateAllIndicatorsForPhone(phoneNumber) {
    document.querySelectorAll('.btn-history-commande').forEach(btn => {
        if (btn.getAttribute('data-phone') === phoneNumber) {
            const commandeSummary = btn.closest('.commande-summary');
            if (commandeSummary) {
                const commandeId = commandeSummary.getAttribute('data-commande-id');
                updateClientRatingIndicator(commandeId, phoneNumber);
            }
        }
    });
}

/**
 * Mettre à jour tous les badges de crédit pour un numéro de téléphone donné
 * (pour toutes les commandes affichées avec ce numéro)
 */
function updateAllCreditIndicatorsForPhone(phoneNumber) {
    document.querySelectorAll('.btn-history-commande').forEach(btn => {
        if (btn.getAttribute('data-phone') === phoneNumber) {
            const commandeSummary = btn.closest('.commande-summary');
            if (commandeSummary) {
                const commandeId = commandeSummary.getAttribute('data-commande-id');
                updateClientCreditIndicator(commandeId, phoneNumber);
            }
        }
    });
}

function displayCommandeGroup(commande, container) {
    const item = document.createElement('div');
    item.className = 'transaction-item transaction-commande';

    const time = commande.createdAt ? new Date(commande.createdAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
    }) : 'N/A';

    // Build items list
    const itemsList = (commande.items || []).map(vente => {
        const nombre = vente.Nombre || vente.nombre || 1;
        const produit = vente.Produit || vente.produit || 'Produit';
        const montant = vente.Montant || vente.montant || 0;
        console.log('📦 [displayCommandeGroup] Item:', { nombre, produit, montant, vente });
        
        // Check if this is a pack and show composition (modified or default)
        let compositionHtml = '';
        const isPack = produit && (produit.toLowerCase().includes('pack') || produit.startsWith('Pack'));
        
        if (isPack) {
            let composition = null;
            
            // Priorité 1 : Composition modifiée dans extension
            if (vente.extension && vente.extension.composition && Array.isArray(vente.extension.composition)) {
                composition = vente.extension.composition;
            }
            // Priorité 2 : Composition par défaut depuis PACK_COMPOSITIONS
            else if (PACK_COMPOSITIONS && PACK_COMPOSITIONS[produit]) {
                composition = PACK_COMPOSITIONS[produit];
            }
            
            if (composition && composition.length > 0) {
                const compositionItems = composition.map(comp => 
                    `${escapeHtml(comp.quantite)} ${escapeHtml(comp.unite)} ${escapeHtml(comp.produit)}`
                ).join(', ');
                const isModified = vente.extension && vente.extension.composition;
                const color = isModified ? '#2196F3' : '#666';
                compositionHtml = `<div class="pack-composition" style="font-size: 0.8rem; color: ${color}; margin-left: 1rem; font-style: italic;"><i class="fas fa-box-open"></i> ${compositionItems}</div>`;
            }
        }
        
        return `<div class="commande-item">• ${nombre}× ${produit} <span class="item-price">(${formatCurrency(montant)})</span>${compositionHtml}</div>`;
    }).join('');

    // Count number of lines (not quantities)
    const nombreLignes = (commande.items || []).length;
    console.log('🧾 Détails commande', commande.commandeId, '- lignes:', nombreLignes, 'items:', commande.items);
    
    // Get client info from first item (all items in a command should have same client info)
    const firstItem = commande.items[0];
    const clientName = firstItem.nomClient || firstItem['Client Name'] || firstItem.nom_client;
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || firstItem.numero_client;
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || firstItem.adresse_client;
    const clientInstructions = firstItem.instructionsClient || firstItem['Client Instructions'] || firstItem.instructions_client;
    const currentStatus = firstItem.statut_preparation || 'en_preparation';
    
    // 🆕 Extraire le crédit depuis le champ credit (nouvelle table commande_credits)
    const credit = firstItem.credit || null;
    const creditUsed = credit?.credit_used || 0;
    const amountPaidAfterCredit = credit?.amount_paid_after_credit || null;
    const creditStatus = credit?.credit_status || null;
    
    const hasInstructions = clientInstructions && clientInstructions.trim() !== '';
    
    const hasClientInfo = clientName || clientPhone || clientAddress || clientInstructions;
    
    let clientInfoHtml = '';
    let clientInfoSummary = '';
    if (hasClientInfo) {
        clientInfoHtml = '<div class="client-info-badge">';
        clientInfoHtml += '<i class="fas fa-user"></i> ';
        if (clientName) clientInfoHtml += `<strong>${escapeHtml(clientName)}</strong>${currentStatus === 'sur_place' ? ' 🍽️' : ''}`;
        if (clientPhone) clientInfoHtml += ` • <i class="fas fa-phone"></i> ${escapeHtml(clientPhone)}`;
        if (clientAddress) clientInfoHtml += ` • <i class="fas fa-map-marker-alt"></i> ${escapeHtml(clientAddress)}`;
        clientInfoHtml += '</div>';
        
        // Ajouter les instructions dans les détails (partie dépliée)
        if (clientInstructions) {
            clientInfoHtml += `<div class="client-instructions-badge" style="background: #FFF3E0; border-left: 3px solid #FF9800; padding: 0.6rem 0.8rem; margin-top: 0.5rem; border-radius: 4px;">
                <div style="font-weight: 600; color: #E65100; font-size: 0.75rem; margin-bottom: 0.3rem;">
                    <i class="fas fa-exclamation-circle"></i> INSTRUCTIONS
                </div>
                <div style="color: #E65100; font-size: 0.85rem; line-height: 1.4;">${escapeHtml(clientInstructions)}</div>
            </div>`;
        }
        
        // 🆕 Ajouter le badge tag client si disponible (VVIP/VIP)
        let clientTagBadge = '';
        if (clientPhone && clientTagsCache[clientPhone]) {
            clientTagBadge = getClientTagBadgeHtml(clientTagsCache[clientPhone]);
        }
        
        // Résumé compact pour la ligne fermée
        clientInfoSummary = `${clientTagBadge}Client: ${clientName ? escapeHtml(clientName) : 'Inconnu'}${currentStatus === 'sur_place' ? ' 🍽️' : ''}${clientPhone ? ` • ${escapeHtml(clientPhone)}` : ''}`;
        
        // Ajouter un indicateur d'instructions dans le résumé
        if (clientInstructions) {
            clientInfoSummary += ` <span style="color: #FF9800; font-weight: 600;">⚠️ Instructions</span>`;
        }
    } else {
        clientInfoSummary = 'Client inconnu';
    }
    
    // Use the full commande_id (ex: MBA1703620851234)
    const displayId = commande.commandeId || 'N/A';
    
    // Badge de statut de paiement (chargé de manière asynchrone)
    const paymentBadgePlaceholder = `<span class="payment-status-badge bg-secondary" data-commande-id="${commande.commandeId}" title="Cliquer pour changer le statut" onclick="event.stopPropagation(); togglePaymentStatus('${commande.commandeId}', this)" style="cursor:pointer;">⏳</span>`;
    
    // Vérifier si l'utilisateur peut modifier cette commande
    const canEdit = canEditOrDeleteCommande(commande.commandeId);
    const editButtonClass = canEdit ? 'btn-edit-commande' : 'btn-edit-commande disabled';
    const editButtonStyle = canEdit ? '' : 'opacity: 0.5; cursor: not-allowed;';
    const editButtonOnClick = canEdit 
        ? `onclick="event.stopPropagation(); modifierCommande('${commande.commandeId}')"`
        : `onclick="event.stopPropagation(); showToast('❌ Vous ne pouvez modifier que les commandes du jour', 'error')"`;
    
    item.innerHTML = `
        <div class="commande-summary" data-commande-id="${commande.commandeId}" ${clientPhone ? `data-client-phone="${escapeHtml(clientPhone)}"` : ''} ${creditUsed > 0 ? `data-credit-used="${creditUsed}"` : ''}>
            <div class="commande-left">
                <div class="commande-time">${time}</div>
                <button class="commande-toggle" aria-label="Afficher le détail">
                    <i class="fas fa-chevron-down"></i>
                </button>
            </div>
            <div class="commande-main">
                <div class="commande-title">
                    ${paymentBadgePlaceholder}
                    Commande ${displayId}
                    <button onclick="event.stopPropagation(); copyToClipboard('${commande.commandeId}', 'ID commande')" 
                            style="background:none;border:none;color:#2196F3;cursor:pointer;padding:0;font-size:0.7rem;opacity:0.6;margin-left:0.3rem;" 
                            onmouseover="this.style.opacity='1'" 
                            onmouseout="this.style.opacity='0.6'" 
                            title="Copier l'ID">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
                <div class="commande-client">
                    ${clientInfoSummary}
                    ${clientPhone ? `<button onclick="event.stopPropagation(); copyToClipboard('${escapeHtml(clientPhone)}', 'Numéro')" 
                            style="background:none;border:none;color:#4CAF50;cursor:pointer;padding:0;font-size:0.7rem;opacity:0.6;margin-left:0.3rem;" 
                            onmouseover="this.style.opacity='1'" 
                            onmouseout="this.style.opacity='0.6'" 
                            title="Copier le numéro">
                        <i class="fas fa-copy"></i>
                    </button>` : ''}
                </div>
            </div>
            <div class="commande-right">
                <button class="btn-view-commande" onclick="event.stopPropagation(); afficherDetailsCommande('${commande.commandeId}')" title="Voir les détails">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="${editButtonClass}" ${editButtonOnClick} title="${canEdit ? 'Modifier la commande' : 'Modification non autorisée'}" style="${editButtonStyle}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-whatsapp-commande" onclick="event.stopPropagation(); envoyerFactureWhatsAppFromList('${commande.commandeId}')" title="Envoyer via WhatsApp">
                    <i class="fab fa-whatsapp"></i>
                </button>
            </div>
        </div>
        <div class="commande-details collapsible">
            ${clientInfoHtml}
            <div class="commande-items-list">
                ${itemsList}
            </div>
            <div class="commande-total-line">
                <strong>Total:</strong> ${formatCurrency(commande.totalAmount)}
            </div>
            ${creditUsed > 0 && creditStatus !== 'failed' ? `
            <div style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border: 1px solid #4CAF50; padding: 0.6rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; color: #2E7D32; margin-bottom: 0.3rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span><i class="fas fa-gift"></i> <strong>Bon:</strong></span>
                        ${creditStatus === 'confirmed' ? '<span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600;">✓ CONFIRMÉ</span>' : ''}
                        ${creditStatus === 'pending' ? '<span style="background: #FF9800; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600;">⏳ EN ATTENTE</span>' : ''}
                    </div>
                    <span style="font-weight: 700;">-${formatCurrency(creditUsed)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; color: #1B5E20; border-top: 1px dashed #A5D6A7; padding-top: 0.3rem;">
                    <span><strong>Montant payé:</strong></span>
                    <span style="font-weight: 700; font-size: 1.05em;">${formatCurrency(amountPaidAfterCredit || (commande.totalAmount - creditUsed))}</span>
                </div>
            </div>
            ` : ''}
            ${creditUsed > 0 && creditStatus === 'failed' ? `
            <div style="background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%); border: 1px solid #f44336; padding: 0.6rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; color: #c62828; margin-bottom: 0.3rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span><i class="fas fa-exclamation-triangle"></i> <strong>Crédit échoué</strong></span>
                        <span style="background: #f44336; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600;">✗ ÉCHEC</span>
                    </div>
                    <span style="font-weight: 700;">-${formatCurrency(creditUsed)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; color: #b71c1c; border-top: 1px dashed #ef9a9a; padding-top: 0.3rem;">
                    <span><strong>Montant À PAYER:</strong></span>
                    <span style="font-weight: 700; font-size: 1.05em;">${formatCurrency(commande.totalAmount)}</span>
                </div>
            </div>
            ` : ''}
        </div>
    `;
    
    const toggleBtn = item.querySelector('.commande-toggle');
    const details = item.querySelector('.commande-details');
    const summary = item.querySelector('.commande-summary');
    
    const toggle = () => {
        const isExpanded = item.classList.toggle('expanded');
        const icon = toggleBtn.querySelector('i');
        
        console.log('🔽 Toggle commande:', isExpanded ? 'Expanded' : 'Collapsed');
        
        // Force display via inline style to bypass CSS issues
        if (isExpanded) {
            details.style.display = 'block';
            details.style.maxHeight = '2000px';
            details.style.opacity = '1';
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
        } else {
            details.style.display = 'none';
            details.style.maxHeight = '0';
            details.style.opacity = '0';
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
        }
    };
    
    // Click on entire summary row
    summary.addEventListener('click', (e) => {
        // Don't toggle if clicking on action buttons
        if (e.target.closest('.btn-edit-commande, .btn-whatsapp-commande')) {
            return;
        }
        toggle();
    });
    
    
    // Open by default so details are visible immediately
    // We set initial state manually first to ensure sync
    item.classList.add('expanded');
    details.style.display = 'block';
    details.style.maxHeight = '2000px';
    toggleBtn.querySelector('i').classList.remove('fa-chevron-down');
    toggleBtn.querySelector('i').classList.add('fa-chevron-up');
    
    container.appendChild(item);
    
    // Mettre à jour les indicateurs (note + crédit) pour les clients récurrents
    // Différer l'exécution pour ne pas bloquer l'affichage des commandes
    if (clientPhone) {
        setTimeout(() => {
            updateClientRatingIndicator(commande.commandeId, clientPhone);
            updateClientCreditIndicator(commande.commandeId, clientPhone);
        }, 0);
    }
}

function displayIndividualSale(vente, container) {
    const item = document.createElement('div');
    item.className = 'transaction-item';
    
    const time = vente.createdAt ? new Date(vente.createdAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
    }) : 'N/A';
    
    const montant = vente.Montant || vente.montant || 0;
    const nombre = vente.Nombre || vente.nombre || 1;
    const produit = vente.Produit || vente.produit || 'Produit';
    
    // Get client info
    const clientName = vente.nomClient || vente['Client Name'];
    const clientPhone = vente.numeroClient || vente['Client Phone'];
    const clientAddress = vente.adresseClient || vente['Client Address'];
    
    const hasClientInfo = clientName || clientPhone || clientAddress;
    
    let clientInfoHtml = '';
    if (hasClientInfo) {
        clientInfoHtml = '<div class="client-info-small">';
        clientInfoHtml += '<i class="fas fa-user"></i> ';
        if (clientName) clientInfoHtml += `${clientName}`;
        if (clientPhone) clientInfoHtml += ` • ${clientPhone}`;
        clientInfoHtml += '</div>';
    }
    
    item.innerHTML = `
        <div class="transaction-info">
            <div class="transaction-time">${time}</div>
            <div class="transaction-details">${nombre}× ${produit}</div>
            ${clientInfoHtml}
            <div class="transaction-amount">${formatCurrency(montant)}</div>
        </div>
    `;
    
    container.appendChild(item);
}

// Fonction supprimée - la pagination n'existe plus

// Fonction pour charger les statuts de paiement des commandes affichées
async function loadPaymentStatusesForDisplayedCommandes() {
    const badges = document.querySelectorAll('.payment-status-badge[data-commande-id]');
    
    // Compteurs pour chaque statut - pour TOUTES les commandes
    const statusCounts = { P: 0, C: 0, A: 0 };
    
    // Compter TOUTES les commandes dans commandesData, pas seulement celles affichées
    const allCommandeIds = Array.from(commandesData.keys());
    
    // Mettre à jour les badges visibles ET compter tous les statuts
    const statusPromises = allCommandeIds.map(async (commandeId) => {
        try {
            const data = await getCommandePaymentStatus(commandeId);
            statusCounts[data.posStatus] = (statusCounts[data.posStatus] || 0) + 1;
            return { 
                commandeId, 
                status: data.posStatus, 
                montantRestantDu: data.montantRestantDu || 0,
                montantPaye: data.montantPaye || 0, // Ajout du montant payé
                creditUsed: data.creditUsed || 0 // 🆕 Montant du crédit utilisé (pour distinguer BON vs CRÉANCE)
            };
        } catch (error) {
            statusCounts.A++;
            return { commandeId, status: 'A', montantRestantDu: 0, montantPaye: 0, creditUsed: 0 };
        }
    });
    
    // Attendre que tous les statuts soient récupérés
    const allStatuses = await Promise.all(statusPromises);
    
    // Créer un map pour accès rapide
    const statusMap = new Map(allStatuses.map(s => [s.commandeId, { 
        status: s.status, 
        montantRestantDu: s.montantRestantDu,
        montantPaye: s.montantPaye,
        creditUsed: s.creditUsed // 🆕 Inclure creditUsed
    }]));
    
    // Maintenant mettre à jour les badges visibles
    for (const badge of badges) {
        const commandeId = badge.dataset.commandeId;
        if (!commandeId) continue;
        
        const statusData = statusMap.get(commandeId) || { status: 'A', montantRestantDu: 0, montantPaye: 0, creditUsed: 0 };
        const posStatus = statusData.status;
        
        // Mettre à jour le badge existant
        const config = PAYMENT_STATUS_CONFIG[posStatus] || PAYMENT_STATUS_CONFIG['A'];
        
        // Debug pour PP
        if (posStatus === 'PP') {
            console.log('🐛 [DEBUG] Badge PP pour', commandeId, '- Config:', config);
            console.log('🐛 [DEBUG] innerHTML sera:', `${config.icon} ${config.label}`);
        }
        
        badge.className = `badge ${config.class} payment-status-badge`;
        badge.style.cursor = 'pointer';
        badge.innerHTML = `${config.icon} ${config.label}`;
        badge.dataset.status = posStatus;
        badge.title = 'Cliquer pour changer le statut';
        badge.onclick = (e) => { e.stopPropagation(); togglePaymentStatus(commandeId, badge); };
        
        // 🎯 Ajouter le tampon "PAYÉ" (P/M) ou "BON RÉDUCTION/CRÉANCE" (C) ou "PAYÉ PARTIELLEMENT" (PP)
        addPaidStampIfNeeded(commandeId, posStatus, statusData.montantRestantDu, statusData.montantPaye, statusData.creditUsed);
    }
    
    // Mettre à jour les compteurs dans les boutons de filtre
    updatePaymentStatusFilterCounts(statusCounts);
}

/**
 * Mettre à jour les compteurs de filtres de statut de paiement
 */
function updatePaymentStatusFilterCounts(counts) {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    
    document.getElementById('countAll').textContent = total > 0 ? `(${total})` : '';
    const elA = document.getElementById('countA');
    const elP = document.getElementById('countP');
    const elC = document.getElementById('countC');
    if (elA) elA.textContent = counts.A > 0 ? `(${counts.A})` : '';
    if (elP) elP.textContent = counts.P > 0 ? `(${counts.P})` : '';
    if (elC) elC.textContent = counts.C > 0 ? `(${counts.C})` : '';
}

/**
 * Ajouter un tampon sur une commande si nécessaire (PAYÉ pour P/M/PP, CRÉDIT pour C)
 * @param {string} commandeId - L'ID de la commande
 * @param {string} status - Le statut de paiement (A, P, C)
 * @param {number} montantRestantDu - Le montant restant dû (pour créance)
 * @param {number} montantPaye - Non utilisé (compatibilité)
 * @param {number} creditUsed - Non utilisé (compatibilité)
 */
function addPaidStampIfNeeded(commandeId, status, montantRestantDu = 0, montantPaye = 0, creditUsed = 0) {
    // Créer le tampon pour P (Payé) ou C (Créance)
    if (status !== 'P' && status !== 'C') {
        return;
    }
    
    // Trouver l'élément transaction-item correspondant
    const commandeSummary = document.querySelector(`[data-commande-id="${commandeId}"]`);
    if (!commandeSummary) {
        return;
    }
    
    const transactionItem = commandeSummary.closest('.transaction-item');
    if (!transactionItem) {
        return;
    }
    
    // Vérifier si un tampon existe déjà
    if (transactionItem.querySelector('.paid-stamp')) {
        return; // Déjà présent
    }
    
    // Créer le tampon
    const stamp = document.createElement('div');
    stamp.className = 'paid-stamp animate';
    
    let stampText = 'PAYÉ';
    
    // Différencier le style selon le type
    if (status === 'P') {
        stamp.classList.add('manual');
    } else if (status === 'C') {
        stamp.classList.add('creance');
        stampText = `CRÉANCE (${formatCurrency(montantRestantDu)})`;
        stamp.style.fontSize = '0.7rem';
        stamp.style.letterSpacing = '1.5px';
    }
    
    stamp.textContent = stampText;
    
    // Ajouter le tampon à la transaction
    transactionItem.appendChild(stamp);
}

async function supprimerTransaction(venteId) {
    if (!confirm('Voulez-vous vraiment supprimer cette transaction ?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/ventes/${venteId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Erreur lors de la suppression');
        }
        
        showToast('Transaction supprimée !', 'success');
        
        // Reload transactions
        await chargerResume();
        
    } catch (error) {
        console.error('Erreur suppression:', error);
        showToast('Erreur lors de la suppression: ' + error.message, 'error');
    }
}

async function supprimerCommande(commandeId) {
    // Vérifier les permissions
    if (!canEditOrDeleteCommande(commandeId)) {
        showToast('❌ Vous ne pouvez supprimer que les commandes du jour', 'error');
        return;
    }
    
    const confirmed = await showModernConfirm({
        title: 'Supprimer la commande',
        message: `Voulez-vous vraiment supprimer la commande ${commandeId} ?\n\n⚠️ Toutes les ventes de cette commande seront définitivement supprimées.\n\nCette action est irréversible.`,
        type: 'danger',
        confirmText: 'Supprimer',
        cancelText: 'Annuler'
    });
    
    if (confirmed) {
        await confirmerSuppressionCommande(commandeId);
    }
}

async function confirmerSuppressionCommande(commandeId) {
    try {
        // Récupérer les informations de crédit depuis le serveur (commande_infos)
        let creditUsed = 0;
        let creditStatus = null;
        let creditPhone = null;
        
        try {
            const creditInfoResponse = await fetch(`/api/commandes/${encodeURIComponent(commandeId)}/credit`, {
                credentials: 'include'
            });
            
            if (creditInfoResponse.ok) {
                const creditInfo = await creditInfoResponse.json();
                
                if (creditInfo && creditInfo.hasCredit) {
                    creditUsed = parseFloat(creditInfo.credit?.credit_used) || 0;
                    creditStatus = creditInfo.credit?.credit_status;
                    creditPhone = creditInfo.credit?.credit_phone;
                    console.log(`📊 Crédit trouvé: ${creditUsed} FCFA, status: ${creditStatus}`);
                }
            }
        } catch (error) {
            console.warn('⚠️ Impossible de récupérer les infos de crédit:', error);
            // Fallback : essayer depuis commandesData si disponible
            const commande = commandesData.get(commandeId);
            if (commande && commande.items && commande.items.length > 0) {
                const firstItem = commande.items[0];
                creditUsed = firstItem.extension?.credit_used || 0;
                creditStatus = firstItem.extension?.credit_status || null;
                creditPhone = firstItem.extension?.credit_phone || null;
            }
        }
        
        // Si crédit confirmé, rembourser AVANT de supprimer
        if (creditUsed > 0 && creditStatus === 'confirmed' && creditPhone) {
            console.log(`💚 Remboursement crédit: ${creditUsed} FCFA pour ${creditPhone}`);
            
            try {
                // Appeler la fonction de remboursement avec retry
                await refundCreditWithRetry(creditPhone, creditUsed, commandeId);
                
                console.log(`✅ Crédit remboursé avec succès: ${creditUsed} FCFA`);
                showToast(`💚 Crédit remboursé: ${creditUsed} FCFA`, 'success');
                
                // Nettoyer le cache pour ce client
                if (clientCreditsCache[creditPhone]) {
                    delete clientCreditsCache[creditPhone];
                }
                
            } catch (refundError) {
                console.error('❌ Erreur remboursement crédit:', refundError);
                
                // Demander confirmation à l'utilisateur
                const continueDelete = confirm(
                    `⚠️ Le remboursement du crédit (${creditUsed} FCFA) a échoué.\n\n` +
                    `Erreur: ${refundError.message}\n\n` +
                    `Voulez-vous quand même supprimer la commande ?`
                );
                
                if (!continueDelete) {
                    showToast('Suppression annulée', 'info');
                    return; // Annuler la suppression
                }
            }
        } else if (creditUsed > 0 && creditStatus === 'pending') {
            console.log(`⏳ Crédit pending - pas de remboursement`);
        } else if (creditUsed > 0 && creditStatus === 'failed') {
            console.log(`❌ Crédit failed - pas de remboursement`);
        }
        
        // Supprimer la commande
        const response = await fetch(`/api/commandes/${encodeURIComponent(commandeId)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Erreur lors de la suppression');
        }
        
        showToast('Commande supprimée !', 'success');
        
        // Close the details modal if open
        const detailsModal = document.getElementById('modalDetailsCommande');
        if (detailsModal && detailsModal.classList.contains('active')) {
            fermerModalDetailsCommande();
        }
        
        // Reload transactions
        await chargerResume();
        
    } catch (error) {
        console.error('Erreur suppression commande:', error);
        showToast('Erreur lors de la suppression: ' + error.message, 'error');
    }
}

// 🆕 Fonction utilitaire : Utiliser crédit avec RETRY automatique sur 409
async function useCreditWithRetry(clientPhone, creditAmount, orderId, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 [useCreditWithRetry] Tentative ${attempt}/${maxRetries} pour ${clientPhone}`);
            
            // 1. Lire le crédit actuel pour obtenir la version
            const auditResponse = await fetch(`/api/audit-client?phone_number=${encodeURIComponent(clientPhone)}&skip_sentiment=true`, {
                credentials: 'include'
            });
            
            if (!auditResponse.ok) {
                throw new Error(`Erreur lecture crédit: ${auditResponse.status}`);
            }
            
            const auditData = await auditResponse.json();
            const credit = auditData.client_info?.credit;
            
            if (!credit) {
                throw new Error('Aucun crédit disponible');
            }
            
            if (credit.is_expired) {
                throw new Error('Crédit expiré');
            }
            
            if (credit.current_balance < creditAmount) {
                throw new Error(`Solde insuffisant (${credit.current_balance} FCFA disponible)`);
            }
            
            const version = credit.version || 0;
            console.log(`📊 Version crédit actuelle: ${version}, Solde: ${credit.current_balance} FCFA`);
            
            // 2. Utiliser le crédit avec la version
            const useResponse = await fetch('/api/credit/use', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    phone_number: clientPhone,
                    amount_used: creditAmount,
                    order_id: orderId,
                    version: version
                })
            });
            
            const result = await useResponse.json();
            
            // 3. Succès → Retourner le résultat
            if (useResponse.ok && result.success) {
                console.log(`✅ Crédit utilisé avec succès (tentative ${attempt})`);
                return {
                    success: true,
                    ...result
                };
            }
            
            // 4. Conflit 409 → RETRY
            if (useResponse.status === 409) {
                console.warn(`⚠️ Conflit de version détecté (tentative ${attempt}/${maxRetries}), retry dans 100ms...`);
                await new Promise(resolve => setTimeout(resolve, 100));
                continue; // Réessayer
            }
            
            // 5. Autre erreur → Stop
            throw new Error(result.error || result.message || `Erreur ${useResponse.status}`);
            
        } catch (error) {
            // Si dernière tentative, throw l'erreur
            if (attempt === maxRetries) {
                throw error;
            }
            // Sinon, attendre un peu et continuer
            console.warn(`⚠️ Erreur tentative ${attempt}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    throw new Error('Trop de conflits, veuillez réessayer');
}

// 🆕 Fonction utilitaire : Rembourser crédit avec RETRY automatique sur 409
async function refundCreditWithRetry(clientPhone, creditAmount, orderId, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 [refundCreditWithRetry] Tentative ${attempt}/${maxRetries} pour ${clientPhone}`);
            
            // 1. Lire le crédit actuel pour obtenir la version
            const auditResponse = await fetch(`/api/audit-client?phone_number=${encodeURIComponent(clientPhone)}&skip_sentiment=true`, {
                credentials: 'include'
            });
            
            if (!auditResponse.ok) {
                throw new Error(`Erreur lecture crédit: ${auditResponse.status}`);
            }
            
            const auditData = await auditResponse.json();
            const credit = auditData.client_info?.credit;
            const version = credit?.version || 0;
            
            console.log(`📊 Version crédit actuelle: ${version}`);
            
            // 2. Rembourser le crédit avec la version
            const refundResponse = await fetch('/api/credit/refund', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    phone_number: clientPhone,
                    amount: creditAmount,
                    order_id: orderId,
                    version: version
                })
            });
            
            const result = await refundResponse.json();
            
            // 3. Succès → Retourner le résultat
            if (refundResponse.ok && result.success) {
                console.log(`✅ Crédit remboursé avec succès (tentative ${attempt})`);
                return {
                    success: true,
                    ...result
                };
            }
            
            // 4. Conflit 409 → RETRY
            if (refundResponse.status === 409) {
                console.warn(`⚠️ Conflit de version détecté (tentative ${attempt}/${maxRetries}), retry dans 100ms...`);
                await new Promise(resolve => setTimeout(resolve, 100));
                continue; // Réessayer
            }
            
            // 5. Autre erreur → Stop
            throw new Error(result.error || result.message || `Erreur ${refundResponse.status}`);
            
        } catch (error) {
            // Si dernière tentative, throw l'erreur
            if (attempt === maxRetries) {
                throw error;
            }
            // Sinon, attendre un peu et continuer
            console.warn(`⚠️ Erreur tentative ${attempt}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    throw new Error('Trop de conflits, veuillez réessayer');
}

// 🆕 Fonction pour appliquer le crédit de manière asynchrone avec gestion d'erreur complète
async function applyCreditAsync(commandeId, clientPhone, creditAmount) {
    try {
        console.log(`🎁 [applyCreditAsync] Début - Commande: ${commandeId}, Montant: ${creditAmount} FCFA`);
        
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const amountPaidAfterCredit = Math.max(0, total - creditAmount);
        const creditVersion = clientCreditsCache[clientPhone]?.version || 0;
        
        // 0. Créer l'entrée dans commande_credits (statut: pending)
        await fetch(`/api/commandes/${commandeId}/credit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                credit_used: creditAmount,
                credit_phone: clientPhone,
                amount_paid_after_credit: amountPaidAfterCredit,
                credit_version: creditVersion
            })
        });
        
        console.log(`📝 Entrée crédit créée dans DB (statut: pending)`);
        
        // 1. Utiliser le crédit avec RETRY automatique sur 409
        const result = await useCreditWithRetry(clientPhone, creditAmount, commandeId);
        
        if (result.success) {
            console.log(`✅ Crédit appliqué avec succès: ${creditAmount} FCFA`);
            
            // 2. Mettre à jour le statut à "confirmed" dans la BDD
            await fetch(`/api/commandes/${commandeId}/update-credit-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    credit_status: 'confirmed',
                    transaction_id: result.transaction?.id || result.transaction_id || null
                })
            });
            
            // 3. Mettre à jour le cache local avec la nouvelle version
            if (result.transaction?.new_balance !== undefined) {
                if (result.transaction.new_balance > 0) {
                    // Crédit restant : mettre à jour le cache
                    clientCreditsCache[clientPhone] = {
                        balance: result.transaction.new_balance,
                        version: result.transaction.new_version || (clientCreditsCache[clientPhone]?.version || 0) + 1,
                        total: clientCreditsCache[clientPhone]?.total || result.transaction.new_balance,
                        expires_at: clientCreditsCache[clientPhone]?.expires_at,
                        days_remaining: clientCreditsCache[clientPhone]?.days_remaining,
                        is_expired: false
                    };
                    console.log(`💳 Cache mis à jour: ${clientPhone} a ${result.transaction.new_balance} FCFA (version ${result.transaction.new_version})`);
                    
                    // Rafraîchir les badges UI pour afficher le nouveau solde
                    setTimeout(() => {
                        updateAllCreditIndicatorsForPhone(clientPhone);
                    }, 100);
                } else {
                    // Crédit épuisé : retirer du cache et les badges
                    delete clientCreditsCache[clientPhone];
                    console.log(`💳 Cache nettoyé: ${clientPhone} crédit épuisé`);
                    
                    // Retirer les badges crédit affichés
                    setTimeout(() => {
                        updateAllCreditIndicatorsForPhone(clientPhone);
                    }, 100);
                }
            }
            
            // 4. Notification utilisateur
            showToast(`✅ Crédit de ${formatCurrency(creditAmount)} appliqué avec succès !`, 'success');
            
        } else {
            // Échec de l'API externe
            throw new Error(result.error || result.message || 'Erreur lors de l\'application du crédit');
        }
        
    } catch (error) {
        console.error(`❌ [applyCreditAsync] Erreur:`, error);
        
        // Mettre à jour le statut à "failed" dans la BDD
        try {
            await fetch(`/api/commandes/${commandeId}/update-credit-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    credit_status: 'failed',
                    error_message: error.message
                })
            });
        } catch (updateError) {
            console.error('❌ Erreur mise à jour statut:', updateError);
        }
        
        // Notification utilisateur avec action
        showToast(
            `⚠️ ATTENTION : Le crédit de ${formatCurrency(creditAmount)} n'a PAS été appliqué au client.\n\n` +
            `Raison: ${error.message}\n\n` +
            `Le client doit payer le montant TOTAL. Vous pouvez annuler le crédit depuis les détails de la commande.`,
            'error',
            10000 // 10 secondes
        );
    }
}

// 🆕 Fonction pour annuler le crédit utilisé sur une commande
async function annulerCredit(commandeId, clientPhone, creditAmount) {
    try {
        // 🔒 ÉTAPE 1 : Vérifications de sécurité AVANT confirmation
        
        // 1.2 Vérifier l'âge de la commande (max 7 jours)
        const commande = commandesData.get(commandeId);
        if (commande && commande.createdAt) {
            const ageInDays = (Date.now() - new Date(commande.createdAt)) / (1000 * 60 * 60 * 24);
            if (ageInDays > 7) {
                await showModernConfirm({
                    title: '❌ Annulation impossible',
                    message: `Cette commande date de ${Math.floor(ageInDays)} jours.\n\n` +
                             `Par mesure de sécurité, vous ne pouvez annuler le crédit que sur des commandes de moins de 7 jours.\n\n` +
                             `Pour les cas exceptionnels, contactez un superviseur.`,
                    type: 'danger',
                    confirmText: 'Compris',
                    cancelText: null
                });
                return;
            }
        }
        
        // 1.3 Vérifier le statut du crédit
        const firstItem = commande?.items?.[0];
        const creditStatus = firstItem?.extension?.credit_status;
        
        if (creditStatus === 'failed') {
            await showModernConfirm({
                title: '⚠️ Crédit déjà échoué',
                message: `Le crédit sur cette commande a déjà échoué lors de l'application.\n\n` +
                         `Il n'y a rien à annuler car le client n'a jamais reçu de crédit.`,
                type: 'warning',
                confirmText: 'Compris',
                cancelText: null
            });
            return;
        }
        
        // ✅ Toutes les vérifications passées, demander confirmation
        const confirmed = await showModernConfirm({
            title: 'Annuler le crédit',
            message: `Voulez-vous vraiment annuler le crédit de ${formatCurrency(creditAmount)} ?\n\n` +
                     `✅ Le crédit sera remboursé au client ${clientPhone}\n` +
                     `📊 Statut actuel: ${creditStatus || 'pending'}\n\n` +
                     `Cette action est utile si le crédit a été appliqué par erreur.`,
            type: 'warning',
            confirmText: 'Annuler le crédit',
            cancelText: 'Non, garder'
        });
        
        if (!confirmed) return;
        
        showToast('⏳ Annulation du crédit en cours...', 'info');
        
        // 1. Rembourser le crédit avec RETRY automatique sur 409
        const refundResult = await refundCreditWithRetry(clientPhone, creditAmount, commandeId);
        
        if (!refundResult.success) {
            throw new Error(refundResult.error || 'Erreur lors du remboursement du crédit');
        }
        
        console.log('✅ Crédit remboursé:', refundResult);
        
        // 2. Mettre à jour la base de données pour retirer le crédit de l'extension
        const updateResponse = await fetch(`/api/commandes/${commandeId}/remove-credit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                credit_amount: creditAmount
            })
        });
        
        if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            throw new Error(errorData.message || 'Erreur lors de la mise à jour de la commande');
        }
        
        // 3. Mettre à jour le cache du crédit client avec la nouvelle version
        if (refundResult.transaction?.new_balance !== undefined) {
            // Créer ou mettre à jour le cache avec les nouvelles infos
            clientCreditsCache[clientPhone] = {
                balance: refundResult.transaction.new_balance,
                version: refundResult.transaction.new_version || (clientCreditsCache[clientPhone]?.version || 0) + 1,
                total: clientCreditsCache[clientPhone]?.total || refundResult.transaction.new_balance,
                expires_at: clientCreditsCache[clientPhone]?.expires_at,
                days_remaining: clientCreditsCache[clientPhone]?.days_remaining,
                is_expired: false
            };
            console.log(`💳 Cache mis à jour après refund: ${clientPhone} a maintenant ${refundResult.transaction.new_balance} FCFA (version ${refundResult.transaction.new_version})`);
            
            // Mettre à jour l'affichage des badges
            setTimeout(() => {
                updateAllCreditIndicatorsForPhone(clientPhone);
            }, 100);
        }
        
        showToast(`✅ Crédit de ${formatCurrency(creditAmount)} annulé et remboursé au client !`, 'success');
        
        // 4. Fermer le modal et recharger les données
        fermerModalDetailsCommande();
        await chargerResume();
        
    } catch (error) {
        console.error('❌ Erreur annulation crédit:', error);
        showToast('❌ Erreur: ' + error.message, 'error');
    }
}

async function modifierCommande(commandeId) {
    // Vérifier les permissions
    if (!canEditOrDeleteCommande(commandeId)) {
        showToast('❌ Vous ne pouvez modifier que les commandes du jour', 'error');
        return;
    }
    
    try {
        // Sauvegarder l'état actuel du panier et des infos client AVANT de modifier
        savedCartBeforeEdit = JSON.parse(JSON.stringify(cart));
        savedClientInfoBeforeEdit = {
            name: document.getElementById('clientName')?.value || '',
            phone: document.getElementById('clientPhone')?.value || '',
            address: document.getElementById('clientAddress')?.value || '',
            instructions: document.getElementById('clientInstructions')?.value || ''
        };
        
        // Marquer qu'on est en mode édition
        editingCommandeId = commandeId;
        
        // Fetch the commande details
        const pointVente = document.getElementById('pointVenteSelect').value;
        const dateInput = document.getElementById('summaryDate');
        const date = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        const dateFormatted = date.split('-').reverse().join('-'); // Convert YYYY-MM-DD to DD-MM-YYYY
        
        const response = await fetch(`/api/ventes-date?date=${dateFormatted}&pointVente=${pointVente}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement de la commande');
        }
        
        const data = await response.json();
        const commandeItems = data.ventes.filter(v => v.commande_id === commandeId || v.commandeId === commandeId);
        
        if (commandeItems.length === 0) {
            showToast('Commande introuvable', 'error');
            // Réinitialiser l'état d'édition
            editingCommandeId = null;
            savedCartBeforeEdit = null;
            savedClientInfoBeforeEdit = null;
            return;
        }
        
        // Clear current cart
        cart = [];
        
        // Populate cart with commande items
        commandeItems.forEach(item => {
            const produit = item.Produit || item.produit;
            const nombre = parseFloat(item.Nombre || item.nombre || 0);
            const prix = parseFloat(item.PU || item.prixUnit || 0);
            const categorie = item.Catégorie || item.categorie;
            
            const cartItem = {
                name: produit,
                price: prix,
                quantity: nombre,
                category: categorie
            };
            
            // If this item has a pack composition, include it
            if (item.extension && item.extension.composition && Array.isArray(item.extension.composition)) {
                cartItem.composition = item.extension.composition;
                console.log('📦 [modifierCommande] Composition du pack restaurée:', cartItem.composition);
            }
            
            cart.push(cartItem);
        });
        
        // Update client info if available
        const firstItem = commandeItems[0];
        if (firstItem.nomClient) {
            document.getElementById('clientName').value = firstItem.nomClient || '';
        }
        if (firstItem.numeroClient) {
            document.getElementById('clientPhone').value = firstItem.numeroClient || '';
        }
        if (firstItem.adresseClient) {
            document.getElementById('clientAddress').value = firstItem.adresseClient || '';
        }
        if (firstItem.instructionsClient) {
            document.getElementById('clientInstructions').value = firstItem.instructionsClient || '';
        }
        
        // Restaurer l'état du checkbox "Sur place" en fonction du statut
        const surPlaceCheckbox = document.getElementById('commandeSurPlace');
        if (surPlaceCheckbox) {
            if (firstItem.statut_preparation) {
                surPlaceCheckbox.checked = (firstItem.statut_preparation === 'sur_place');
            } else {
                // Explicitly reset to false for older commandes without statut_preparation
                surPlaceCheckbox.checked = false;
            }
        }
        
        // NE PAS supprimer la commande maintenant - on la supprimera lors de la sauvegarde
        
        // Update UI
        afficherPanier();
        updateCartButtons(); // Afficher le bouton "Annuler"
        showToast('Commande chargée pour modification - Cliquez sur "Annuler" pour revenir en arrière', 'info');
        
        // Scroll to cart if element exists
        const cartPanel = document.querySelector('.pos-cart') || document.querySelector('.cart-panel');
        if (cartPanel) {
            cartPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
    } catch (error) {
        console.error('Erreur modification commande:', error);
        showToast('Erreur lors de la modification: ' + error.message, 'error');
        // Réinitialiser l'état d'édition en cas d'erreur
        editingCommandeId = null;
        savedCartBeforeEdit = null;
        savedClientInfoBeforeEdit = null;
    }
}

// Fonction pour annuler la modification en cours
function annulerModificationCommande() {
    if (!editingCommandeId) {
        showToast('Aucune modification en cours', 'info');
        return;
    }
    
    // Restaurer le panier et les infos client sauvegardés
    cart = savedCartBeforeEdit ? JSON.parse(JSON.stringify(savedCartBeforeEdit)) : [];
    
    if (savedClientInfoBeforeEdit) {
        document.getElementById('clientName').value = savedClientInfoBeforeEdit.name;
        document.getElementById('clientPhone').value = savedClientInfoBeforeEdit.phone;
        document.getElementById('clientAddress').value = savedClientInfoBeforeEdit.address;
        document.getElementById('clientInstructions').value = savedClientInfoBeforeEdit.instructions;
    }
    
    // Réinitialiser l'état d'édition
    editingCommandeId = null;
    savedCartBeforeEdit = null;
    savedClientInfoBeforeEdit = null;
    
    // Update UI
    afficherPanier();
    updateCartButtons(); // Masquer le bouton "Annuler"
    showToast('Modification annulée', 'success');
}

// Fonction pour mettre à jour l'affichage des boutons du panier
function updateCartButtons() {
    const cartHeaderActions = document.querySelector('.cart-header-actions');
    const mobileCartHeaderActions = document.querySelector('.mobile-cart-header-actions');
    
    if (!cartHeaderActions) return;
    
    if (editingCommandeId) {
        // Mode édition - afficher le bouton Annuler
        cartHeaderActions.innerHTML = `
            <button class="btn-cancel-edit" onclick="annulerModificationCommande()">
                <i class="fas fa-times"></i> Annuler
            </button>
            <button class="btn-clear" onclick="viderPanier()">
                <i class="fas fa-trash"></i> Vider
            </button>
            <button class="btn-save" onclick="sauvegarderPanier()">
                <i class="fas fa-save"></i> Sauvegarder
            </button>
            <button class="btn-checkout" onclick="ouvrirModalPaiement()">
                <i class="fas fa-cash-register"></i> Valider
            </button>
        `;
        
        // Mobile version
        if (mobileCartHeaderActions) {
            mobileCartHeaderActions.innerHTML = `
                <button class="btn-cancel-edit-mobile" onclick="annulerModificationCommande()" title="Annuler">
                    <i class="fas fa-times"></i>
                </button>
                <button class="btn-clear-mobile" onclick="viderPanier()">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn-mobile-save" onclick="sauvegarderPanier()">
                    <i class="fas fa-save"></i>
                </button>
                <button class="btn-mobile-checkout" onclick="ouvrirModalPaiement()">
                    <i class="fas fa-cash-register"></i>
                </button>
            `;
        }
    } else {
        // Mode normal - affichage par défaut
        cartHeaderActions.innerHTML = `
            <button class="btn-clear" onclick="viderPanier()">
                <i class="fas fa-trash"></i> Vider
            </button>
            <button class="btn-save" onclick="sauvegarderPanier()">
                <i class="fas fa-save"></i> Sauvegarder
            </button>
            <button class="btn-checkout" onclick="ouvrirModalPaiement()">
                <i class="fas fa-cash-register"></i> Valider
            </button>
        `;
        
        // Mobile version
        if (mobileCartHeaderActions) {
            mobileCartHeaderActions.innerHTML = `
                <button class="btn-clear-mobile" onclick="viderPanier()">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn-mobile-save" onclick="sauvegarderPanier()">
                    <i class="fas fa-save"></i>
                </button>
                <button class="btn-mobile-checkout" onclick="ouvrirModalPaiement()">
                    <i class="fas fa-cash-register"></i>
                </button>
            `;
        }
    }
}

function translatePaymentMethod(method) {
    const translations = {
        'cash': 'espèces',
        'card': 'carte',
        'mobile': 'mobile'
    };
    return translations[method] || method;
}

// ===== Clôture de caisse =====

async function ouvrirClotureCaisse() {
    const pointVente = document.getElementById('pointVenteSelect')?.value;
    const dateInput = document.getElementById('summaryDate');
    const today = dateInput?.value || new Date().toISOString().split('T')[0];

    if (!pointVente) {
        showToast('Point de vente non sélectionné', 'error');
        return;
    }

    // Vérification : date passée réservée aux superviseurs
    const realToday = new Date().toISOString().split('T')[0];
    const isSuperviseur = currentUser?.role === 'superviseur' || currentUser?.role === 'superutilisateur' || currentUser?.role === 'SuperUtilisateur';
    if (today < realToday && !isSuperviseur) {
        showToast('La clôture de caisse n\'est plus possible pour une date passée. Contactez un superviseur.', 'error');
        return;
    }

    // Mettre à jour le sous-titre
    const subtitle = document.getElementById('clotureCaisseSubtitle');
    if (subtitle) {
        const dateLabel = new Date(today + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        subtitle.textContent = `${pointVente} — ${dateLabel}`;
    }

    // Réinitialiser le formulaire
    const elMontant    = document.getElementById('clotureMontantEspeces');
    const elFond       = document.getElementById('clotureFondCaisse');
    const elCommercial = document.getElementById('clotureCommercial');
    const elComment    = document.getElementById('clotureCommentaire');
    const elEstimatif  = document.getElementById('clotureEstimatifDisplay');
    const elHistorique = document.getElementById('clotureHistoriqueSection');
    const elWarning    = document.getElementById('clotureUpsertWarning');

    if (elMontant)    elMontant.value    = '';
    if (elFond)       elFond.value       = '0';
    if (elCommercial) elCommercial.value = '';
    if (elComment)    elComment.value    = '';
    if (elEstimatif)  elEstimatif.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calcul en cours...';
    if (elHistorique) elHistorique.style.display = 'none';
    if (elWarning)    elWarning.style.display    = 'none';

    // Ouvrir la modal
    const modalEl = document.getElementById('clotureCaisseModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        new bootstrap.Modal(modalEl).show();
    }

    // Charger l'estimatif et l'historique en parallèle
    await Promise.all([
        chargerEstimatifCloture(today, pointVente),
        chargerHistoriqueCloture(today, pointVente)
    ]);
}

async function chargerEstimatifCloture(date, pointVente) {
    try {
        const res = await fetch(`/api/clotures-caisse/estimatif?date=${encodeURIComponent(date)}&pointVente=${encodeURIComponent(pointVente)}`, {
            credentials: 'include'
        });
        const data = await res.json();
        const el = document.getElementById('clotureEstimatifDisplay');
        if (data.success) {
            const { totalVentes, estimatif } = data.data;
            el.innerHTML = `
                <span style="font-size:1.3rem;">${formatCurrency(estimatif)}</span>
                <br><small style="font-weight:400; color:#b02a37;">
                    Total ventes (espèces): ${formatCurrency(estimatif)}
                </small>`;
        } else {
            el.innerHTML = '<span class="text-muted">Non disponible</span>';
        }
        return data.data?.estimatif || null;
    } catch (e) {
        document.getElementById('clotureEstimatifDisplay').innerHTML = '<span class="text-muted">Erreur de calcul</span>';
        return null;
    }
}

async function chargerHistoriqueCloture(date, pointVente) {
    try {
        const res = await fetch(`/api/clotures-caisse?date=${encodeURIComponent(date)}&pointVente=${encodeURIComponent(pointVente)}`, {
            credentials: 'include'
        });
        const data = await res.json();
        const section = document.getElementById('clotureHistoriqueSection');
        const list = document.getElementById('clotureHistoriqueList');

        if (data.success && data.count > 0) {
            section.style.display = 'block';
            document.getElementById('clotureUpsertWarning').style.display = 'block';

            list.innerHTML = data.data.map((c, i) => {
                const heure = new Date(c.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                const isLast = c.is_latest;
                const ecart = c.montant_estimatif !== null && c.montant_estimatif !== undefined
                    ? parseFloat(c.montant_especes) - parseFloat(c.montant_estimatif)
                    : null;
                const ecartHtml = ecart !== null
                    ? `<span style="font-size:0.82rem; font-weight:600; color:${ecart >= 0 ? '#198754' : '#dc3545'};">
                           Écart: ${ecart >= 0 ? '+' : ''}${formatCurrency(ecart)}
                       </span>`
                    : '';
                const detailId = `cloture-detail-${c.id}`;
                return `
                        <div style="border-top:${i > 0 ? '1px solid #f0f0f0' : 'none'}; ${isLast ? 'background:#fff5f5;' : ''}">
                        <div onclick="toggleClotureDetail('${detailId}')"
                             style="display:flex; align-items:center; justify-content:space-between; padding:10px 16px; cursor:pointer;">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <i class="fas fa-chevron-right" id="icon-${detailId}" style="color:#adb5bd; font-size:0.75rem; transition:transform 0.2s;"></i>
                                <span style="color:#6c757d; font-size:0.85rem; min-width:42px;">${heure}</span>
                                <span style="font-weight:600;">${escapeHtml(c.commercial)}</span>
                                ${isLast ? '<span class="badge" style="background:#dc3545; font-size:0.72rem;">Dernière</span>' : ''}
                            </div>
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="font-weight:700; font-size:1rem;">${formatCurrency(parseFloat(c.montant_especes))}</span>
                            </div>
                        </div>
                        <div id="${detailId}" style="display:none; padding:0 16px 12px 52px; font-size:0.88rem; border-top:1px dashed #e9ecef;">
                            <table style="width:100%; border-collapse:collapse; margin-top:6px;">
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0; width:160px;">Montant espèces</td>
                                    <td style="font-weight:600;">${formatCurrency(parseFloat(c.montant_especes))}</td>
                                </tr>
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0;">Fond de caisse</td>
                                    <td>${parseFloat(c.fond_de_caisse) > 0 ? formatCurrency(parseFloat(c.fond_de_caisse)) : '—'}</td>
                                </tr>
                                ${c.montant_estimatif !== null && c.montant_estimatif !== undefined ? `
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0;">Estimatif système</td>
                                    <td>${formatCurrency(parseFloat(c.montant_estimatif))}</td>
                                </tr>
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0;">Écart</td>
                                    <td style="font-weight:600; color:${ecart >= 0 ? '#198754' : '#dc3545'};">${ecart >= 0 ? '+' : ''}${formatCurrency(ecart)}</td>
                                </tr>` : ''}
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0;">Commercial(e)</td>
                                    <td>${escapeHtml(c.commercial)}</td>
                                </tr>
                                ${c.commentaire ? `
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0;">Commentaire</td>
                                    <td style="font-style:italic;">${escapeHtml(c.commentaire)}</td>
                                </tr>` : ''}
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0;">Enregistré par</td>
                                    <td>${escapeHtml(c.created_by || '—')}</td>
                                </tr>
                                <tr>
                                    <td style="color:#6c757d; padding:3px 0;">Heure exacte</td>
                                    <td>${new Date(c.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                                </tr>
                            </table>
                        </div>
                    </div>`;
            }).join('');
        } else {
            section.style.display = 'none';
        }
    } catch (e) {
        console.error('Erreur chargement historique clôture:', e);
    }
}

/**
 * Met à jour le bouton "Faire la caisse" selon :
 * - Si une clôture existe aujourd'hui → "Refaire la caisse"
 * - Si la date est passée ET l'utilisateur n'est pas superviseur → bouton désactivé
 */
async function mettreAJourBoutonCloture() {
    const btn = document.querySelector('.btn-faire-caisse');
    if (!btn) return;

    const dateInput = document.getElementById('summaryDate');
    const selectedDate = dateInput?.value || new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const pointVente = document.getElementById('pointVenteSelect')?.value;
    const isSuperviseur = currentUser?.role === 'superviseur' || currentUser?.role === 'superutilisateur' || currentUser?.role === 'SuperUtilisateur';
    const isPastDay = selectedDate < today;

    // Si date passée et pas superviseur → désactiver
    if (isPastDay && !isSuperviseur) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-lock"></i> Caisse clôturée';
        btn.title = 'La clôture n\'est plus possible après minuit. Contactez un superviseur.';
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
        return;
    }

    // Sinon, vérifier si une clôture existe pour ce jour/PdV
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.title = '';

    if (!pointVente) return;

    try {
        const res = await fetch(`/api/clotures-caisse?date=${encodeURIComponent(selectedDate)}&pointVente=${encodeURIComponent(pointVente)}`, {
            credentials: 'include'
        });
        const data = await res.json();
        if (data.success && data.count > 0) {
            btn.innerHTML = '<i class="fas fa-cash-register"></i> Refaire la caisse';
        } else {
            btn.innerHTML = '<i class="fas fa-cash-register"></i> Faire la caisse';
        }
    } catch (e) {
        btn.innerHTML = '<i class="fas fa-cash-register"></i> Faire la caisse';
    }
}

function toggleClotureDetail(detailId) {
    const el = document.getElementById(detailId);
    const icon = document.getElementById(`icon-${detailId}`);
    if (!el) return;
    const isOpen = el.style.display !== 'none';
    el.style.display = isOpen ? 'none' : 'block';
    if (icon) icon.style.transform = isOpen ? '' : 'rotate(90deg)';
}

async function validerClotureCaisse() {
    const pointVente = document.getElementById('pointVenteSelect')?.value;
    const dateInput = document.getElementById('summaryDate');
    const today = dateInput?.value || new Date().toISOString().split('T')[0];

    const montantEspeces = parseFloat(document.getElementById('clotureMontantEspeces').value);
    const fondDeCaisse = parseFloat(document.getElementById('clotureFondCaisse').value) || 0;
    const commercial = document.getElementById('clotureCommercial').value.trim();
    const commentaire = document.getElementById('clotureCommentaire').value.trim();

    if (!montantEspeces || montantEspeces <= 0) {
        showToast('Veuillez saisir le montant espèces comptées', 'error');
        return;
    }
    if (!commercial) {
        showToast('Veuillez saisir le nom du/de la commercial(e)', 'error');
        return;
    }

    // Récupérer l'estimatif affiché pour le stocker
    const estimatifText = document.getElementById('clotureEstimatifDisplay')?.textContent || '';
    const estimatifMatch = estimatifText.match(/[\d\s]+/);
    let montantEstimatif = null;
    if (estimatifMatch) {
        montantEstimatif = parseFloat(estimatifMatch[0].replace(/\s/g, '')) || null;
    }

    const btn = document.querySelector('#clotureCaisseModal .btn-success');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...'; }

    try {
        const res = await fetch('/api/clotures-caisse', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: today, pointVente, montantEspeces, fondDeCaisse, montantEstimatif, commercial, commentaire })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`Clôture enregistrée : ${formatCurrency(montantEspeces)}`, 'success');
            const modalEl = document.getElementById('clotureCaisseModal');
            if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
            mettreAJourBoutonCloture();
        } else {
            showToast(data.message || 'Erreur lors de la clôture', 'error');
        }
    } catch (e) {
        console.error('Erreur clôture:', e);
        showToast('Erreur réseau lors de la clôture', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Valider la caisse'; }
    }
}

// ===== Récapitulatif de la journée =====
async function afficherRecapitulatifJournee() {
    try {
        const pointVente = document.getElementById('pointVenteSelect').value;
        const dateInput = document.getElementById('summaryDate');
        const date = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        const dateFormatted = date.split('-').reverse().join('-'); // Convert YYYY-MM-DD to DD-MM-YYYY
        
        // Fetch all sales for the day
        const response = await fetch(`/api/ventes-date?date=${dateFormatted}&pointVente=${pointVente}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des ventes');
        }
        
        const data = await response.json();
        const ventes = data.ventes || [];
        
        if (ventes.length === 0) {
            showToast('Aucune vente pour cette journée', 'warning');
            return;
        }
        
        // Group by commande_id
        const commandesMap = new Map();
        const ventesIndividuelles = [];
        let totalJournee = 0;
        
        ventes.forEach(vente => {
            const commandeId = vente.commande_id || vente.commandeId;
            const montant = parseFloat(vente.Montant || vente.montant || 0);
            totalJournee += montant;
            
            if (commandeId) {
                if (!commandesMap.has(commandeId)) {
                    commandesMap.set(commandeId, []);
                }
                commandesMap.get(commandeId).push(vente);
            } else {
                ventesIndividuelles.push(vente);
            }
        });
        
        // Build commandes HTML
        let commandesHTML = '';
        let commandeNumber = 1;
        
        // Fetch payment statuses for all commandes
        const paymentStatuses = new Map();
        const paymentDetails = new Map(); // Pour stocker montantRestantDu et montantPaye
        for (const [commandeId] of commandesMap.entries()) {
            try {
                const paymentData = await getCommandePaymentStatus(commandeId);
                paymentStatuses.set(commandeId, paymentData.posStatus || 'A');
                paymentDetails.set(commandeId, {
                    posStatus: paymentData.posStatus || 'A',
                    montantRestantDu: paymentData.montantRestantDu || 0,
                    montantPaye: paymentData.montantPaye || 0,
                    creditUsed: paymentData.creditUsed || 0 // 🆕
                });
            } catch (error) {
                paymentStatuses.set(commandeId, 'A');
                paymentDetails.set(commandeId, { posStatus: 'A', montantRestantDu: 0, montantPaye: 0, creditUsed: 0 });
            }
        }
        
        // Display grouped commandes
        for (const [commandeId, items] of commandesMap.entries()) {
            const firstItem = items[0];
            const clientName = firstItem.nomClient || '';
            const clientPhone = firstItem.numeroClient || '';
            const heureCommande = firstItem.createdAt ? new Date(firstItem.createdAt).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit'
            }) : '';
            
            const paymentStatus = paymentStatuses.get(commandeId) || 'A';
            const paymentInfo = paymentDetails.get(commandeId) || { posStatus: 'A', montantRestantDu: 0, montantPaye: 0, creditUsed: 0 };
            const montantRestantDu = paymentInfo.montantRestantDu;
            const montantPaye = paymentInfo.montantPaye;
            const creditUsed = paymentInfo.creditUsed || 0; // 🆕
            const isPaid = (paymentStatus === 'P' || paymentStatus === 'M');
            const isPartialPaid = (paymentStatus === 'PP'); // Paiement partiel
            const isCredit = (paymentStatus === 'C' && creditUsed > 0); // ✅ Crédit/BON appliqué
            const isCreance = (paymentStatus === 'C' && creditUsed === 0); // 🆕 Créance (montant impayé)
            const stampClass = paymentStatus === 'M' ? 'manual' : '';
            const creditStampClass = isCredit ? 'credit' : ''; // Pour BON RÉDUCTION
            const creanceStampClass = isCreance ? 'creance' : ''; // 🆕 Pour CRÉANCE
            const partialStampClass = isPartialPaid ? 'partial' : '';
            
            let clientInfo = '';
            if (clientName || clientPhone) {
                clientInfo = `<div style="color: #666; margin-bottom: 10px;">
                    👤 Client: ${clientName || 'Inconnu'}${clientPhone ? ` • ${clientPhone}` : ''}
                </div>`;
            }
            
            const itemsRows = items.map(item => {
                const produit = item.Produit || item.produit;
                const nombre = parseFloat(item.Nombre || item.nombre || 0);
                const prixUnit = parseFloat(item.PU || item.prixUnit || 0);
                const montant = parseFloat(item.Montant || item.montant || 0);
                
                return `
                    <tr>
                        <td>${produit}</td>
                        <td class="text-center">${nombre}</td>
                        <td class="text-right">${formatCurrency(prixUnit)}</td>
                        <td class="text-right">${formatCurrency(montant)}</td>
                    </tr>
                `;
            }).join('');
            
            const totalCommande = items.reduce((sum, item) => sum + parseFloat(item.Montant || item.montant || 0), 0);
            
            commandesHTML += `
                <div class="commande-section" style="position: relative;">
                    ${isPaid ? `<div class="paid-stamp-recap ${stampClass}">PAYÉ</div>` : ''}
                    ${isPartialPaid ? `<div class="paid-stamp-recap ${partialStampClass}" style="font-size: 0.8em;">PAYÉ PARTIELLEMENT (${formatCurrency(montantPaye)})</div>` : ''}
                    ${isCredit ? `<div class="paid-stamp-recap ${creditStampClass}">BON RÉDUCTION (${formatCurrency(creditUsed)})</div>` : ''}
                    ${isCreance ? `<div class="paid-stamp-recap ${creanceStampClass}">CRÉANCE (${formatCurrency(montantRestantDu)})</div>` : ''}
                    <div class="commande-header">
                        <strong>Commande ${commandeNumber++} • ${commandeId}</strong>
                        ${heureCommande ? `<span style="color: #fff;">🕐 ${heureCommande}</span>` : ''}
                    </div>
                    ${clientInfo}
                    <table class="commande-table">
                        <thead>
                            <tr>
                                <th>Produit</th>
                                <th class="text-center">Qté</th>
                                <th class="text-right">Prix Unit.</th>
                                <th class="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsRows}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3" class="text-right"><strong>Sous-total</strong></td>
                                <td class="text-right"><strong>${formatCurrency(totalCommande)}</strong></td>
                            </tr>
                            ${isCredit || isPartialPaid ? `
                            <tr style="color: #dc3545; font-weight: bold;">
                                <td colspan="3" class="text-right">Déjà payé</td>
                                <td class="text-right">${formatCurrency(totalCommande - montantRestantDu)}</td>
                            </tr>
                            <tr style="color: #dc3545; font-weight: bold; border-top: 2px solid #dc3545;">
                                <td colspan="3" class="text-right">RESTE À PAYER</td>
                                <td class="text-right">${formatCurrency(montantRestantDu)}</td>
                            </tr>
                            ` : ''}
                        </tfoot>
                    </table>
                </div>
            `;
        }
        
        // Display individual sales (without commande_id)
        if (ventesIndividuelles.length > 0) {
            const itemsRows = ventesIndividuelles.map(vente => {
                const produit = vente.Produit || vente.produit;
                const nombre = parseFloat(vente.Nombre || vente.nombre || 0);
                const prixUnit = parseFloat(vente.PU || vente.prixUnit || 0);
                const montant = parseFloat(vente.Montant || vente.montant || 0);
                const clientName = vente.nomClient || '';
                
                return `
                    <tr>
                        <td>${produit}${clientName ? ` <span style="color: #666;">(${clientName})</span>` : ''}</td>
                        <td class="text-center">${nombre}</td>
                        <td class="text-right">${formatCurrency(prixUnit)}</td>
                        <td class="text-right">${formatCurrency(montant)}</td>
                    </tr>
                `;
            }).join('');
            
            const totalIndividuel = ventesIndividuelles.reduce((sum, v) => sum + parseFloat(v.Montant || v.montant || 0), 0);
            
            commandesHTML += `
                <div class="commande-section">
                    <div class="commande-header">
                        <strong>Ventes individuelles</strong>
                    </div>
                    <table class="commande-table">
                        <thead>
                            <tr>
                                <th>Produit</th>
                                <th class="text-center">Qté</th>
                                <th class="text-right">Prix Unit.</th>
                                <th class="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsRows}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3" class="text-right"><strong>Sous-total</strong></td>
                                <td class="text-right"><strong>${formatCurrency(totalIndividuel)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        }
        
        // Get brand config for header/footer
        const config = getBrandConfig();
        
        // Create print window content
        const recapHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Récapitulatif du jour - ${pointVente}</title>
                <style>
                    @media print {
                        @page { margin: 1cm; }
                        body { margin: 0; }
                    }
                    
                    body {
                        font-family: Arial, sans-serif;
                        max-width: 900px;
                        margin: 0 auto;
                        padding: 20px;
                        color: #333;
                    }
                    
                    .facture-header {
                        text-align: center;
                        margin-bottom: 30px;
                        border-bottom: 3px solid #c41e3a;
                        padding-bottom: 20px;
                    }
                    
                    .facture-header h1 {
                        color: #c41e3a;
                        margin: 0 0 10px 0;
                        font-size: 2em;
                    }
                    
                    .facture-header .website {
                        font-size: 1.2em;
                        color: #666;
                        font-weight: 600;
                    }
                    
                    .recap-title {
                        background: #f5f5f5;
                        padding: 15px;
                        border-radius: 8px;
                        margin-bottom: 30px;
                    }
                    
                    .recap-title h2 {
                        margin: 0 0 10px 0;
                        color: #c41e3a;
                    }
                    
                    .recap-info {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 10px;
                    }
                    
                    .commande-section {
                        margin-bottom: 40px;
                        page-break-inside: avoid;
                    }
                    
                    .commande-header {
                        background: #c41e3a;
                        color: white;
                        padding: 12px 15px;
                        border-radius: 8px 8px 0 0;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    
                    .commande-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 10px;
                        border: 1px solid #ddd;
                    }
                    
                    .commande-table thead {
                        background: #e8e8e8;
                        color: #333;
                    }
                    
                    .commande-table th,
                    .commande-table td {
                        padding: 10px;
                        text-align: left;
                        border-bottom: 1px solid #ddd;
                    }
                    
                    .text-center { text-align: center; }
                    .text-right { text-align: right; }
                    
                    .commande-table tbody tr:hover {
                        background: #f9f9f9;
                    }
                    
                    .commande-table tfoot {
                        background: #f5f5f5;
                        font-weight: bold;
                    }
                    
                    .commande-table tfoot td {
                        padding: 12px 10px;
                        border-top: 2px solid #c41e3a;
                    }
                    
                    .total-journee {
                        background: #c41e3a;
                        color: white;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 30px 0;
                        text-align: right;
                        font-size: 1.3em;
                    }
                    
                    .stats-box {
                        background: #e8f5e9;
                        padding: 15px;
                        border-radius: 8px;
                        margin: 20px 0;
                    }
                    
                    .stats-box h3 {
                        margin: 0 0 10px 0;
                        color: #27ae60;
                    }
                    
                    .stat-item {
                        display: flex;
                        justify-content: space-between;
                        padding: 5px 0;
                    }
                    
                    .facture-footer {
                        text-align: center;
                        margin-top: 50px;
                        padding-top: 20px;
                        border-top: 1px solid #ddd;
                        color: #666;
                        font-size: 0.9em;
                    }
                    
                    .no-print {
                        text-align: center;
                        margin: 20px 0;
                    }
                    
                    .no-print button {
                        background: #c41e3a;
                        color: white;
                        border: none;
                        padding: 12px 30px;
                        font-size: 1em;
                        border-radius: 5px;
                        cursor: pointer;
                    }
                    
                    .no-print button:hover {
                        background: #a01629;
                    }
                    
                    @media print {
                        .no-print { display: none; }
                    }
                    
                    .paid-stamp-recap {
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%) rotate(-10deg);
                        border: 3px solid #e74c3c;
                        color: #e74c3c;
                        font-size: 1.2rem;
                        font-weight: 900;
                        letter-spacing: 5px;
                        padding: 6px 25px;
                        text-transform: uppercase;
                        opacity: 0.7;
                        border-radius: 4px;
                        pointer-events: none;
                        z-index: 100;
                    }
                    
                    .paid-stamp-recap.manual {
                        border-color: #9b59b6;
                        color: #9b59b6;
                    }
                </style>
            </head>
            <body>
                <div class="facture-header">
                    <h1>${config ? config.nom_complet : ''}</h1>
                    <div class="website">${config && config.site_web ? config.site_web : ''}</div>
                    ${config && config.slogan ? `<div class="slogan" style="font-size: 0.9em; color: #666; font-style: italic;">${config.slogan}</div>` : ''}
                </div>
                
                <div class="recap-title">
                    <h2>Récapitulatif des ventes du jour</h2>
                    <div class="recap-info">
                        <div><strong>Point de vente:</strong> ${pointVente}</div>
                        <div><strong>Date:</strong> ${dateFormatted}</div>
                    </div>
                    <div class="recap-info">
                        <div><strong>Nombre de commandes:</strong> ${commandesMap.size + (ventesIndividuelles.length > 0 ? 1 : 0)}</div>
                        <div><strong>Nombre de transactions:</strong> ${ventes.length}</div>
                    </div>
                </div>
                
                ${commandesHTML}
                
                <div class="total-journee">
                    <div>TOTAL DE LA JOURNÉE: ${formatCurrency(totalJournee)}</div>
                </div>
                
                <div class="stats-box">
                    <h3>📊 Statistiques</h3>
                    <div class="stat-item">
                        <span>Nombre de commandes:</span>
                        <strong>${commandesMap.size}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Nombre de transactions:</span>
                        <strong>${ventes.length}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Chiffre d'affaires:</span>
                        <strong>${formatCurrency(totalJournee)}</strong>
                    </div>
                </div>
                
                <div class="facture-footer">
                    <p>Document généré le ${new Date().toLocaleString('fr-FR')}</p>
                    <p><strong>${config ? config.nom_complet : ''}</strong>${config && config.site_web ? ' - ' + config.site_web : ''}</p>
                    ${config && config.footer_facture ? `<p style="font-style: italic;">${config.footer_facture}</p>` : ''}
                </div>
                
                <div class="no-print">
                    <button onclick="window.print()">🖨️ Imprimer</button>
                    <button onclick="window.close()" style="background: #666; margin-left: 10px;">Fermer</button>
                </div>
            </body>
            </html>
        `;
        
        // Open print window
        const printWindow = window.open('', '_blank', 'width=900,height=600');
        
        if (!printWindow) {
            showToast('Veuillez autoriser les popups pour afficher le récapitulatif', 'warning');
            return;
        }
        
        printWindow.document.write(recapHTML);
        printWindow.document.close();
        
        // Auto-print after load
        printWindow.onload = function() {
            setTimeout(() => {
                printWindow.print();
            }, 250);
        };
        
    } catch (error) {
        console.error('Erreur récapitulatif:', error);
        showToast('Erreur lors de la génération du récapitulatif: ' + error.message, 'error');
    }
}

// ===== Close Day (deprecated) =====
function cloturerJournee() {
    // Redirect to new function
    afficherRecapitulatifJournee();
}

// ===== WhatsApp Function =====
async function envoyerFactureWhatsAppFromList(commandeId) {
    try {
        // Récupérer les données de la commande depuis l'API
        const pointVente = document.getElementById('pointVenteSelect').value;
        const dateInput = document.getElementById('summaryDate');
        const date = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        const dateFormatted = date.split('-').reverse().join('-'); // Convert YYYY-MM-DD to DD-MM-YYYY
        
        const response = await fetch(`/api/ventes-date?date=${dateFormatted}&pointVente=${pointVente}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement de la commande');
        }
        
        const data = await response.json();
        const commandeItems = data.ventes.filter(v => v.commande_id === commandeId || v.commandeId === commandeId);
        
        if (commandeItems.length === 0) {
            showToast('Commande introuvable', 'error');
            return;
        }
        
        // Get client info from first item
        const firstItem = commandeItems[0];
        const clientName = firstItem.nomClient || firstItem['Client Name'] || '';
        const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
        const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || '';
        
        // Vérifier si le client a un numéro de téléphone
        if (!clientPhone) {
            showToast('Aucun numéro de téléphone pour ce client', 'warning');
            return;
        }
        
        // Nettoyer le numéro de téléphone (enlever les espaces, +, points, etc.)
        const telNettoye = clientPhone.replace(/\D/g, '');
        
        if (telNettoye.length < 8) {
            showToast('Numéro de téléphone invalide', 'error');
            return;
        }
        
        // Get point de vente
        const pointVenteName = pointVente || 'Point de vente';
        
        // Get date
        const dateCommande = firstItem.Date || firstItem.date || new Date().toLocaleDateString('fr-FR');
        const heureCommande = firstItem.createdAt ? new Date(firstItem.createdAt).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
        }) : '';
        
        // Calculer le total
        const totalAmount = commandeItems.reduce((sum, item) => sum + parseFloat(item.Montant || item.montant || 0), 0);
        
        // 🆕 Extraire les infos de crédit depuis le champ credit (nouvelle table commande_credits)
        const credit = firstItem.credit || null;
        const creditUsed = credit?.credit_used || 0;
        const creditStatus = credit?.credit_status || null;
        const amountPaidAfterCredit = credit?.amount_paid_after_credit || null;
        
        // Crédit valide si > 0 et status !== 'failed'
        const hasValidCredit = creditUsed > 0 && creditStatus !== 'failed';
        const finalAmount = hasValidCredit ? (amountPaidAfterCredit || (totalAmount - creditUsed)) : totalAmount;
        
        
        // Construire le message WhatsApp (avec ou sans lien de paiement)
        let message = `Bonjour ${clientName || 'Client'},\n\n`;
        message += `Voici les détails de votre commande n°${commandeId} :\n\n`;
        message += `📅 Date: ${dateCommande} ${heureCommande}\n`;
        message += `🏪 Point de vente: ${pointVenteName}\n\n`;
        message += `📦 Articles :\n`;
        
        // Ajouter chaque article
        commandeItems.forEach((item, index) => {
            const nombre = item.Nombre || item.nombre || 1;
            const produit = item.Produit || item.produit || 'Produit';
            const prixUnit = item.PU || item.prixUnit || 0;
            const montant = item.Montant || item.montant || 0;
            
            message += `${index + 1}. ${produit}\n`;
            message += `   Quantité: ${nombre}\n`;
            message += `   Prix unitaire: ${formatCurrency(prixUnit)}\n`;
            message += `   Total: ${formatCurrency(montant)}\n\n`;
        });
        
        // 🆕 Afficher les montants avec crédit si applicable
        if (hasValidCredit) {
            message += `Sous-total: ${formatCurrency(totalAmount)}\n`;
            message += `🎁 Bon: -${formatCurrency(creditUsed)}\n`;
            message += `━━━━━━━━━━━━━━━━━━━\n`;
            message += `✅ MONTANT À PAYER: ${formatCurrency(finalAmount)}\n\n`;
        } else {
            message += `TOTAL: ${formatCurrency(totalAmount)}\n\n`;
        }
        
        
        // Get brand config and use its footer (pass commandeId to detect brand)
        const config = getBrandConfig(commandeId);
        if (config && config.footer_whatsapp) {
            message += config.footer_whatsapp;
        } else {
            // Fallback
            message += `Merci de votre confiance !`;
        }
        
        // Encoder le message pour l'URL
        const messageEncode = encodeURIComponent(message);
        
        // Construire l'URL WhatsApp
        const urlWhatsApp = `https://wa.me/${telNettoye}?text=${messageEncode}`;
        
        // Ouvrir dans un nouvel onglet/fenêtre
        window.open(urlWhatsApp, '_blank');
        
        showToast('Ouverture de WhatsApp...', 'success');
        
    } catch (error) {
        console.error('Erreur envoi WhatsApp:', error);
        showToast('Erreur lors de l\'envoi: ' + error.message, 'error');
    }
}

// ===== Utilities =====

// Fonction pour copier dans le clipboard
function copyToClipboard(text, label = 'Texte') {
    navigator.clipboard.writeText(text).then(() => {
        showToast(`📋 ${label} copié !`, 'success');
    }).catch(err => {
        console.error('Erreur copie:', err);
        showToast(`❌ Erreur lors de la copie`, 'error');
    });
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount) + ' FCFA';
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast-${type}`;
    
    const iconMap = {
        'success': 'check-circle',
        'warning': 'exclamation-circle',
        'error': 'times-circle'
    };
    
    toast.innerHTML = `
        <i class="fas fa-${iconMap[type] || 'info-circle'}"></i>
        ${message}
    `;
    
    document.body.appendChild(toast);
    
    // Show toast
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Hide and remove toast
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function playAddToCartAnimation() {
    // Simple visual feedback - could be enhanced with CSS animations
    const cartHeader = document.querySelector('.cart-header');
    if (cartHeader) {
        cartHeader.style.transform = 'scale(1.05)';
        setTimeout(() => {
            cartHeader.style.transform = 'scale(1)';
        }, 200);
    }
}

// ===== Toggle Transactions View =====
let transactionsExpanded = false;

function toggleSummaryCards() {
    const container = document.getElementById('summaryCardsContainer');
    const icon = document.getElementById('iconToggleSummaryCards');
    if (!container || !icon) return;

    const isHidden = container.classList.toggle('hidden');
    icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';

    // Persister la préférence
    try { localStorage.setItem('summaryCardsHidden', isHidden ? '1' : '0'); } catch(e) {}
}

// Restaurer la préférence au chargement
(function restoreSummaryCardsState() {
    document.addEventListener('DOMContentLoaded', () => {
        try {
            const hidden = localStorage.getItem('summaryCardsHidden') !== '0';
            if (hidden) {
                const container = document.getElementById('summaryCardsContainer');
                const icon = document.getElementById('iconToggleSummaryCards');
                if (container) container.classList.add('hidden');
                if (icon) icon.className = 'fas fa-eye-slash';
            }
        } catch(e) {}
    });
})();

function toggleTransactionsView() {
    const posMain = document.querySelector('.pos-main');
    const btn = document.querySelector('.btn-expand-transactions i');
    const searchBox = document.querySelector('.transactions-search-box');
    
    transactionsExpanded = !transactionsExpanded;
    
    if (transactionsExpanded) {
        posMain.classList.add('transactions-expanded');
        btn.className = 'fas fa-compress';
        btn.parentElement.title = 'Réduire les transactions';
        if (searchBox) searchBox.style.display = 'block';
    } else {
        posMain.classList.remove('transactions-expanded');
        btn.className = 'fas fa-expand';
        btn.parentElement.title = 'Agrandir les transactions';
        if (searchBox) searchBox.style.display = 'none';
        // Clear search when exiting expanded mode
        viderRechercheTransactions();
        
        // Réinitialiser le filtre de statut de paiement
        if (typeof filterByPaymentStatus === 'function') {
            filterByPaymentStatus('all');
        }
    }
}

// Fonction pour appliquer le filtre de recherche sur toutes les transactions
function appliquerFiltreTransactions() {
    const searchTerm = currentSearchTerm.toLowerCase().trim();
    
    // Si pas de recherche, utiliser toutes les transactions
    if (!searchTerm) {
        filteredTransactionsData = allTransactionsData;
    } else {
        // Filtrer les transactions selon le terme de recherche
        filteredTransactionsData = allTransactionsData.filter(vente => {
            const commandeId = vente.commande_id || vente.commandeId || '';
            const clientName = vente.nomClient || vente['Client Name'] || vente.nom_client || '';
            const clientPhone = vente.numeroClient || vente['Client Phone'] || vente.numero_client || '';
            const clientAddress = vente.adresseClient || vente['Client Address'] || vente.adresse_client || '';
            const produit = vente.Produit || vente.produit || '';
            
            // Créer une chaîne de recherche combinée
            const searchableText = `${commandeId} ${clientName} ${clientPhone} ${clientAddress} ${produit}`.toLowerCase();
            
            return searchableText.includes(searchTerm);
        });
        
        console.log(`🔍 Recherche "${searchTerm}": ${filteredTransactionsData.length} résultat(s) sur ${allTransactionsData.length} transaction(s)`);
    }
    
    // Afficher toutes les transactions filtrées (sans pagination)
    afficherTransactionsRecentes(filteredTransactionsData);
}

function filtrerTransactions() {
    const searchInput = document.getElementById('transactionsSearch');
    const searchTerm = searchInput.value.toLowerCase().trim();
    const clearBtn = document.querySelector('.btn-clear-search');
    
    // Show/hide clear button
    if (searchTerm) {
        clearBtn.style.display = 'flex';
    } else {
        clearBtn.style.display = 'none';
    }
    
    // Mettre à jour le terme de recherche global
    currentSearchTerm = searchTerm;
    
    // Appliquer le filtre (sans page, tout est affiché)
    appliquerFiltreTransactions();
}

function viderRechercheTransactions() {
    const searchInput = document.getElementById('transactionsSearch');
    const clearBtn = document.querySelector('.btn-clear-search');
    
    if (searchInput) {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        
        // Réinitialiser le terme de recherche global
        currentSearchTerm = '';
        
        // Réappliquer le filtre (affichera toutes les transactions)
        appliquerFiltreTransactions();
    }
}

// ===== Pack Composition Management =====
// Configuration des compositions de packs par défaut
const PACK_COMPOSITIONS = {
  "Pack25000": [
    { produit: "Veau en détail", quantite: 4, unite: "kg" },
    { produit: "Poulet en détail", quantite: 2, unite: "pièce" },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack20000": [
    { produit: "Veau en détail", quantite: 3.5, unite: "kg" },
    { produit: "Poulet en détail", quantite: 1, unite: "pièce" },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack50000": [
    { produit: "Agneau", quantite: 2.5, unite: "kg" },
    { produit: "Veau en détail", quantite: 6, unite: "kg" },
    { produit: "Poulet en détail", quantite: 4, unite: "pièce" },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack35000": [
    { produit: "Veau en détail", quantite: 4, unite: "kg" },
    { produit: "Poulet en détail", quantite: 2, unite: "pièce" },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack30000": [
    { produit: "Veau en détail", quantite: 2, unite: "kg" },
    { produit: "Poulet en détail", quantite: 6, unite: "pièce" },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack75000": [
    { produit: "Veau en détail", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 5, unite: "kg" },
    { produit: "Poulet en détail", quantite: 5, unite: "pièce" },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack100000": [
    { produit: "Veau en détail", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 1, unite: "kg" },
    { produit: "Poulet en détail", quantite: 5, unite: "pièce" },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ]
};

let currentPackIndex = null;

function ouvrirModalPackComposition(cartIndex) {
    currentPackIndex = cartIndex;
    const item = cart[cartIndex];
    
    // Get pack name (e.g., "Pack25000")
    const packName = item.name;
    
    // Update modal title
    document.getElementById('pack-modal-title').textContent = `Composition du ${packName}`;
    
    // Load composition (existing or default)
    let composition;
    if (item.composition && item.composition.length > 0) {
        composition = item.composition;
    } else if (PACK_COMPOSITIONS[packName]) {
        composition = JSON.parse(JSON.stringify(PACK_COMPOSITIONS[packName]));
    } else {
        // Default empty composition
        composition = [
            { produit: "", quantite: 0, unite: "kg" }
        ];
    }
    
    // Render composition in table
    afficherCompositionPack(composition);
    
    // Show modal
    document.getElementById('packCompositionModal').style.display = 'flex';
}

function afficherCompositionPack(composition) {
    const tbody = document.getElementById('pack-composition-body');
    tbody.innerHTML = '';
    
    composition.forEach((item, index) => {
        const row = creerLignePackComposition(item, index);
        tbody.appendChild(row);
    });
}

function creerLignePackComposition(item, index) {
    const tr = document.createElement('tr');
    tr.style.cssText = 'border: 1px solid #ddd;';
    
    // Create product dropdown
    let productOptions = '<option value="">Sélectionner un produit...</option>';
    
    // Add products from all categories
    for (const category in products) {
        if (products[category] && typeof products[category] === 'object') {
            productOptions += `<optgroup label="${category}">`;
            for (const productName in products[category]) {
                const selected = productName === item.produit ? 'selected' : '';
                productOptions += `<option value="${productName}" ${selected}>${productName}</option>`;
            }
            productOptions += '</optgroup>';
        }
    }
    
    tr.innerHTML = `
        <td style="padding: 10px; border: 1px solid #ddd;">
            <select class="pack-produit" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                ${productOptions}
            </select>
        </td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
            <input type="number" class="pack-quantite" value="${item.quantite}" 
                   step="0.01" min="0"
                   style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; text-align: center;">
        </td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
            <input type="text" class="pack-unite" value="${item.unite}" 
                   placeholder="kg/pièce"
                   style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; text-align: center;">
        </td>
        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
            <button onclick="supprimerLignePackComposition(this)" 
                    style="background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;
    
    return tr;
}

function ajouterLignePackComposition() {
    const tbody = document.getElementById('pack-composition-body');
    const newItem = { produit: "", quantite: 0, unite: "kg" };
    const index = tbody.children.length;
    const row = creerLignePackComposition(newItem, index);
    tbody.appendChild(row);
}

function supprimerLignePackComposition(button) {
    const row = button.closest('tr');
    row.remove();
}

function reinitialiserPackComposition() {
    if (currentPackIndex === null) return;
    
    const item = cart[currentPackIndex];
    const packName = item.name;
    
    if (PACK_COMPOSITIONS[packName]) {
        const defaultComposition = JSON.parse(JSON.stringify(PACK_COMPOSITIONS[packName]));
        afficherCompositionPack(defaultComposition);
        showToast('Composition réinitialisée', 'info');
    }
}

function sauvegarderPackComposition() {
    if (currentPackIndex === null) return;
    
    const tbody = document.getElementById('pack-composition-body');
    const rows = tbody.querySelectorAll('tr');
    
    const composition = [];
    let hasError = false;
    
    rows.forEach(row => {
        const produit = row.querySelector('.pack-produit').value.trim();
        const quantite = parseFloat(row.querySelector('.pack-quantite').value);
        const unite = row.querySelector('.pack-unite').value.trim();
        
        if (!produit || quantite <= 0 || !unite) {
            hasError = true;
            return;
        }
        
        composition.push({ produit, quantite, unite });
    });
    
    if (hasError) {
        showToast('Veuillez remplir tous les champs correctement', 'error');
        return;
    }
    
    if (composition.length === 0) {
        showToast('La composition ne peut pas être vide', 'error');
        return;
    }
    
    // Save composition to cart item
    cart[currentPackIndex].composition = composition;
    
    // Update cart display
    afficherPanier();
    
    // Close modal
    fermerModalPackComposition();
    
    showToast('Composition sauvegardée !', 'success');
}

function fermerModalPackComposition() {
    document.getElementById('packCompositionModal').style.display = 'none';
    currentPackIndex = null;
}

// ===== Order Tracking System =====
let currentOrderTrackingStatus = 'all';
let selectedOrderId = null;

function toggleOrderTrackingView() {
    const posMain = document.querySelector('.pos-main');
    const orderDetailsPanel = document.getElementById('orderDetailsPanel');
    const statusFilters = document.querySelector('.order-status-filters');
    const searchBox = document.querySelector('.transactions-search-box');
    const btnTracking = document.querySelector('.btn-order-tracking');
    
    const isTracking = posMain.classList.contains('order-tracking-mode');
    
    if (isTracking) {
        // Exit tracking mode
        posMain.classList.remove('order-tracking-mode');
        orderDetailsPanel.style.display = 'none';
        statusFilters.style.display = 'none';
        searchBox.style.display = 'none';
        btnTracking.innerHTML = '<i class="fas fa-clipboard-list"></i>';
        selectedOrderId = null;
    } else {
        // Enter tracking mode
        posMain.classList.add('order-tracking-mode');
        orderDetailsPanel.style.display = 'block';
        statusFilters.style.display = 'flex';
        searchBox.style.display = 'none';
        btnTracking.innerHTML = '<i class="fas fa-times"></i>';
        
        // Reload orders with status
        chargerResume();
    }
}

async function changerStatutCommande(commandeId, newStatus) {
    console.log(`🔄 changerStatutCommande: ${commandeId} → ${newStatus}`);
    try {
        const response = await fetch('/api/commandes/statut', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ commandeId, statut: newStatus })
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors de la mise à jour du statut');
        }
        
        showToast('Statut mis à jour !', 'success');
        console.log('✅ Statut mis à jour avec succès');
        
        // Check if we're in Kanban mode
        const kanbanBoard = document.getElementById('kanbanBoard');
        if (kanbanBoard && kanbanBoard.style.display === 'flex') {
            console.log('📊 Rechargement du Kanban...');
            await chargerCommandesKanban();
        } else {
            // Reload normal view
            console.log('📊 Rechargement des transactions normales...');
            await chargerResume();
        }
        
        // If this order is selected, refresh details
        if (selectedOrderId === commandeId) {
            afficherDetailsCommande(commandeId);
        }
    } catch (error) {
        console.error('❌ Erreur changement statut:', error);
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

function filtrerParStatut(status) {
    currentOrderTrackingStatus = status;
    
    // Update active button
    document.querySelectorAll('.status-filter').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.status === status) {
            btn.classList.add('active');
        }
    });
    
    // Filter transactions
    const container = document.getElementById('transactionsList');
    const items = container.querySelectorAll('.transaction-commande');
    
    items.forEach(item => {
        const itemStatus = item.dataset.status || 'en_preparation';
        if (status === 'all' || itemStatus === status) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

function afficherDetailsCommande(commandeId) {
    selectedOrderId = commandeId;
    const commande = commandesData.get(commandeId);
    
    if (!commande) {
        console.error('Commande non trouvée:', commandeId);
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Get client info
    const firstItem = commande.items[0] || {};
    
    const clientName = firstItem.nomClient || firstItem['Client Name'] || firstItem.nom_client || 'Client inconnu';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || firstItem.numero_client || '';
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || firstItem.adresse_client || '';
    const clientInstructions = firstItem.instructionsClient || firstItem['Client Instructions'] || firstItem.instructions_client || '';
    const currentStatus = firstItem.statut_preparation || 'en_preparation';
    const montantRestantDu = parseFloat(firstItem.montant_restant_du || 0);
    
    const hasInstructions = clientInstructions && clientInstructions.trim() !== '';
    
    afficherModalPosAvecBictorys(commandeId, commande, clientName, clientPhone, clientAddress, clientInstructions, currentStatus, montantRestantDu);
}

function afficherModalPosAvecBictorys(commandeId, commande, clientName, clientPhone, clientAddress, clientInstructions, currentStatus, montantRestantDu) {
    const firstItem = commande.items[0] || {};
    const hasInstructions = clientInstructions && clientInstructions.trim() !== '';
    
    // 🆕 Extraire le crédit depuis le champ credit (nouvelle table commande_credits)
    const credit = firstItem.credit || null;
    const creditUsed = credit?.credit_used || 0;
    const amountPaidAfterCredit = credit?.amount_paid_after_credit || null;
    const creditStatus = credit?.credit_status || 'pending';
    const creditErrorMessage = credit?.error_message || null;
    
    console.log('💳 [Modal] Crédit utilisé:', creditUsed, 'Montant payé:', amountPaidAfterCredit, 'Statut:', creditStatus);
    
    // Build items list
    const itemsHtml = commande.items.map(item => {
        const produit = item.Produit || item.produit || '';
        const nombre = item.Nombre || item.nombre || 0;
        const prixUnit = item.PU || item.prixUnit || 0;
        const montant = item.Montant || item.montant || 0;
        
        // Check if this is a pack and show composition (modified or default)
        let compositionHtml = '';
        const isPack = produit && (produit.toLowerCase().includes('pack') || produit.startsWith('Pack'));
        
        if (isPack) {
            let composition = null;
            
            // Priorité 1 : Composition modifiée dans extension
            if (item.extension && item.extension.composition && Array.isArray(item.extension.composition)) {
                composition = item.extension.composition;
            }
            // Priorité 2 : Composition par défaut depuis PACK_COMPOSITIONS
            else if (PACK_COMPOSITIONS && PACK_COMPOSITIONS[produit]) {
                composition = PACK_COMPOSITIONS[produit];
            }
            
            if (composition && composition.length > 0) {
                const compositionItems = composition.map(comp => 
                    `${escapeHtml(comp.quantite)} ${escapeHtml(comp.unite)} ${escapeHtml(comp.produit)}`
                ).join(', ');
                const isModified = item.extension && item.extension.composition;
                const color = isModified ? '#2196F3' : '#666';
                compositionHtml = `
                    <div style="color: ${color}; font-size: 0.85rem; margin-top: 0.3rem; font-style: italic;">
                        <i class="fas fa-box-open"></i> ${compositionItems}
                    </div>
                `;
            }
        }
        
        return `
            <div style="padding: 0.8rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 0.3rem;">${produit}</div>
                    <div style="color: #666; font-size: 0.9rem;">${nombre} × ${formatCurrency(prixUnit)}</div>
                    ${compositionHtml}
                </div>
                <div style="font-weight: 700; color: var(--primary-color);">${formatCurrency(montant)}</div>
            </div>
        `;
    }).join('');
    
    // Status badge
    const statusLabels = {
        'sur_place': { label: 'Sur place', icon: 'utensils', color: '#8BC34A', bgColor: '#F1F8E9' },
        'en_preparation': { label: 'En préparation', icon: 'clock', color: '#FF9800', bgColor: '#FFF3E0' },
        'pret': { label: 'Prêt', icon: 'check-circle', color: '#4CAF50', bgColor: '#E8F5E9' },
        'en_livraison': { label: 'En livraison', icon: 'shipping-fast', color: '#2196F3', bgColor: '#E3F2FD' }
    };
    
    const statusInfo = statusLabels[currentStatus] || statusLabels['en_preparation'];
    
    // Toggle button "Sur place" / "À livrer"
    let toggleSurPlaceButton = '';
    if (currentStatus === 'sur_place') {
        // Bouton pour basculer vers "À livrer"
        toggleSurPlaceButton = `
            <button onclick="changerStatutCommande('${commandeId}', 'en_preparation')" 
                    style="background: #FF9800; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; flex: 1;">
                <i class="fas fa-shipping-fast"></i> Passer en "À livrer"
            </button>
        `;
    } else if (currentStatus === 'en_preparation') {
        // Bouton pour basculer vers "Sur place"
        toggleSurPlaceButton = `
            <button onclick="changerStatutCommande('${commandeId}', 'sur_place')" 
                    style="background: #8BC34A; color: white; border: none; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; flex: 1;">
                <i class="fas fa-utensils"></i> Marquer "Sur place"
            </button>
        `;
    }
    
    // Status change buttons
    let statusButtons = '';
    if (currentStatus === 'sur_place') {
        // Pour les commandes sur place, pas de workflow de livraison
        statusButtons = toggleSurPlaceButton;
    } else if (currentStatus === 'en_preparation') {
        statusButtons = `
            ${toggleSurPlaceButton}
            <button onclick="changerStatutCommande('${commandeId}', 'pret')" 
                    style="background: #4CAF50; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; flex: 1; margin-left: 0.5rem;">
                <i class="fas fa-check-circle"></i> Marquer prêt
            </button>
        `;
    } else if (currentStatus === 'pret') {
        statusButtons = `
            <button onclick="changerStatutCommande('${commandeId}', 'en_preparation')" 
                    style="background: #FF9800; color: white; border: none; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; flex: 1;">
                <i class="fas fa-arrow-left"></i> En préparation
            </button>
            <button onclick="changerStatutCommande('${commandeId}', 'en_livraison')" 
                    style="background: #2196F3; color: white; border: none; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; flex: 1; margin-left: 0.5rem;">
                <i class="fas fa-shipping-fast"></i> En livraison
            </button>
        `;
    } else if (currentStatus === 'en_livraison') {
        statusButtons = `
            <button onclick="changerStatutCommande('${commandeId}', 'pret')" 
                    style="background: #4CAF50; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; flex: 1;">
                <i class="fas fa-arrow-left"></i> Retour Prêt
            </button>
        `;
    }
    
    // Dropdown livreur pour statut en_livraison
    let livreurSection = '';
    if (currentStatus === 'en_livraison') {
        const livreurDejaAssigneValue = commande.livreur_assigne || firstItem.livreur_assigne || null;
        let livreurInfoBadge = '';
        if (livreurDejaAssigneValue) {
            livreurInfoBadge = `
            <div style="background: #E8F5E9; border: 2px solid #4CAF50; padding: 0.8rem; border-radius: 6px; margin-bottom: 0.8rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; color: #2E7D32; font-weight: 600;">
                    <i class="fas fa-check-circle" style="font-size: 1.2rem;"></i>
                    <span>Livreur assigné: ${livreurDejaAssigneValue}</span>
                </div>
            </div>
            `;
        }
        
        livreurSection = `
        <div style="background: #E3F2FD; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
            <h4 style="color: #1976D2; margin-bottom: 0.8rem; font-size: 0.95rem;">
                <i class="fas fa-user-tie"></i> ${livreurDejaAssigneValue ? 'Changer le livreur' : 'Assigner un livreur'}
            </h4>
            ${livreurInfoBadge}
            <div style="display: flex; gap: 0.5rem;">
                <select id="livreurSelect_${commandeId}" 
                        style="flex: 1; padding: 0.6rem; border: 1px solid #2196F3; border-radius: 6px;">
                    <option value="">Sélectionner...</option>
                </select>
                <button onclick="assignerLivreur('${commandeId}')" 
                        style="background: #2196F3; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer;">
                    <i class="fas fa-check"></i> Valider
                </button>
            </div>
        </div>
        `;
    }
    
    // Fill modal
    document.getElementById('modalCommandeTitle').textContent = `Commande ${commandeId}`;
    
    // Vérifier si l'utilisateur peut modifier/supprimer cette commande
    const canEdit = canEditOrDeleteCommande(commandeId);
    const isCreditPending = creditUsed > 0 && creditStatus === 'pending';
    const canDelete = canEdit && !isCreditPending;
    
    let deleteButtonStyle, deleteButtonOnClick, deleteButtonTitle;
    
    if (!canEdit) {
        // Pas de permission
        deleteButtonStyle = "background: #ccc; color: #666; border: none; padding: 0.7rem 1rem; border-radius: 6px; cursor: not-allowed; flex: 1; min-width: 120px; opacity: 0.5;";
        deleteButtonOnClick = `onclick="showToast('❌ Vous ne pouvez supprimer que les commandes du jour', 'error')"`;
        deleteButtonTitle = "Suppression non autorisée";
    } else if (isCreditPending) {
        // Crédit en attente
        deleteButtonStyle = "background: #FF9800; color: white; border: none; padding: 0.7rem 1rem; border-radius: 6px; cursor: not-allowed; flex: 1; min-width: 120px; opacity: 0.6;";
        deleteButtonOnClick = `onclick="showToast('⏳ Impossible de supprimer : crédit en cours de traitement', 'warning')"`;
        deleteButtonTitle = "Crédit en cours de traitement";
    } else {
        // Peut supprimer
        deleteButtonStyle = "background: #dc3545; color: white; border: none; padding: 0.7rem 1rem; border-radius: 6px; cursor: pointer; flex: 1; min-width: 120px;";
        deleteButtonOnClick = `onclick="supprimerCommande('${commandeId}')"`;
        deleteButtonTitle = "Supprimer la commande";
    }
    
    document.getElementById('modalCommandeBody').innerHTML = `
        <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem;">
                <span class="order-status-badge ${currentStatus}">
                    <i class="fas fa-${statusInfo.icon}"></i> ${statusInfo.label}
                </span>
            </div>
            <div style="display: flex; gap: 1rem; margin-bottom: 0.8rem;">
                ${statusButtons}
            </div>
            ${livreurSection}
        </div>
        
        <div style="margin-bottom: 1.5rem;">
            <h4 style="color: #666; margin-bottom: 0.8rem; font-size: 0.95rem;">
                👤 CLIENT
                <button onclick="copyToClipboard('${commandeId}', 'ID commande')" 
                        style="background:none;border:1px solid #2196F3;color:#2196F3;padding:0.2rem 0.4rem;border-radius:3px;cursor:pointer;font-size:0.7rem;margin-left:0.5rem;" 
                        title="Copier l'ID">
                    <i class="fas fa-copy"></i> ID
                </button>
            </h4>
            <div style="background: #f8f9fa; border-radius: 8px; padding: 1rem;">
                <div style="margin-bottom: 0.5rem;"><strong>${clientName}</strong></div>
                ${clientPhone ? `<div style="color: #666; font-size: 0.9rem; display: flex; align-items: center; gap: 0.3rem;">
                    <span><i class="fas fa-phone"></i> ${clientPhone}</span>
                    <button onclick="copyToClipboard('${clientPhone}', 'Numéro')" 
                            style="background:none;border:1px solid #4CAF50;color:#4CAF50;padding:0.15rem 0.3rem;border-radius:3px;cursor:pointer;font-size:0.65rem;" 
                            title="Copier le numéro">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>` : ''}
                ${clientAddress ? `<div style="color: #666; font-size: 0.9rem; margin-top: 0.3rem;"><i class="fas fa-map-marker-alt"></i> ${clientAddress}</div>` : ''}
            </div>
            ${clientInstructions ? `
            <div style="background: #FFF3E0; border-left: 4px solid #FF9800; padding: 1rem; margin-top: 0.8rem; border-radius: 4px;">
                <div style="font-weight: 600; color: #E65100; font-size: 0.85rem; margin-bottom: 0.5rem;">
                    <i class="fas fa-exclamation-circle"></i> INSTRUCTIONS
                </div>
                <div style="color: #E65100; font-size: 0.95rem; line-height: 1.5;">${clientInstructions}</div>
            </div>
            ` : ''}
        </div>
        
        <div style="margin-bottom: 1.5rem;">
            <h4 style="color: #666; margin-bottom: 0.8rem; font-size: 0.95rem;">📦 ARTICLES</h4>
            <div style="background: white; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                ${itemsHtml}
            </div>
        </div>
        
        <div style="background: var(--primary-color); color: white; padding: 1rem; border-radius: 8px; text-align: center; margin-bottom: 1.5rem;">
            <div style="font-size: 0.9rem; margin-bottom: 0.3rem;">TOTAL</div>
            <div style="font-size: 1.8rem; font-weight: 700;">${formatCurrency(commande.totalAmount)}</div>
        </div>
        
        ${creditUsed > 0 ? `
        <div style="background: linear-gradient(135deg, ${creditStatus === 'confirmed' ? '#e8f5e9' : creditStatus === 'failed' ? '#ffebee' : '#fff3e0'} 0%, ${creditStatus === 'confirmed' ? '#c8e6c9' : creditStatus === 'failed' ? '#ffcdd2' : '#ffe0b2'} 100%); border: 2px solid ${creditStatus === 'confirmed' ? '#4CAF50' : creditStatus === 'failed' ? '#f44336' : '#FF9800'}; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 3px 8px rgba(${creditStatus === 'confirmed' ? '76,175,80' : creditStatus === 'failed' ? '244,67,54' : '255,152,0'},0.2);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <div style="color: ${creditStatus === 'confirmed' ? '#2E7D32' : creditStatus === 'failed' ? '#c62828' : '#E65100'}; font-size: 0.95rem; font-weight: 600;">
                    <i class="fas fa-gift"></i> CRÉDIT ${creditStatus === 'failed' ? 'NON APPLIQUÉ' : 'APPLIQUÉ'}
                </div>
                <div style="color: ${creditStatus === 'confirmed' ? '#2E7D32' : creditStatus === 'failed' ? '#c62828' : '#E65100'}; font-size: 1.3rem; font-weight: 700;">-${formatCurrency(creditUsed)}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.8rem;">
                <span style="display: inline-block; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; background: ${creditStatus === 'confirmed' ? '#4CAF50' : creditStatus === 'failed' ? '#f44336' : '#FF9800'}; color: white;">
                    ${creditStatus === 'confirmed' ? '✅ CONFIRMÉ' : creditStatus === 'failed' ? '❌ ÉCHEC' : '⏳ EN ATTENTE'}
                </span>
                ${creditStatus === 'pending' ? '<span style="font-size: 0.8rem; color: #666; font-style: italic;">Vérification en cours...</span>' : ''}
            </div>
            ${creditStatus === 'failed' ? `
            <div style="background: rgba(244,67,54,0.1); border-left: 3px solid #f44336; padding: 0.5rem 0.8rem; margin-bottom: 0.8rem; border-radius: 4px;">
                <div style="font-size: 0.85rem; color: #c62828; font-weight: 600;">⚠️ ${creditErrorMessage || 'Erreur inconnue'}</div>
                <div style="font-size: 0.75rem; color: #d32f2f; margin-top: 0.3rem;">Le client doit payer le montant TOTAL (${formatCurrency(commande.totalAmount)})</div>
            </div>
            ` : ''}
            <div style="border-top: 1px dashed ${creditStatus === 'confirmed' ? '#A5D6A7' : creditStatus === 'failed' ? '#ef9a9a' : '#ffcc80'}; padding-top: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
                <div style="color: ${creditStatus === 'confirmed' ? '#1B5E20' : creditStatus === 'failed' ? '#b71c1c' : '#BF360C'}; font-weight: 600;">Montant ${creditStatus === 'failed' ? 'À PAYER' : 'payé'}:</div>
                <div style="color: ${creditStatus === 'confirmed' ? '#1B5E20' : creditStatus === 'failed' ? '#b71c1c' : '#BF360C'}; font-size: 1.2rem; font-weight: 700;">${formatCurrency(creditStatus === 'failed' ? commande.totalAmount : (amountPaidAfterCredit || (commande.totalAmount - creditUsed)))}</div>
            </div>
            ${creditStatus !== 'failed' ? `
            <button onclick="annulerCredit('${commandeId}', '${clientPhone}', ${creditUsed})" 
                    style="background: #FF9800; color: white; border: none; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; width: 100%; margin-top: 0.8rem; font-weight: 600;">
                <i class="fas fa-undo"></i> Annuler le crédit (Rembourser ${formatCurrency(creditUsed)})
            </button>
            ` : `
            <button onclick="annulerCredit('${commandeId}', '${clientPhone}', ${creditUsed})" 
                    style="background: #666; color: white; border: none; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; width: 100%; margin-top: 0.8rem; font-weight: 600;">
                <i class="fas fa-trash"></i> Retirer cette mention de crédit
            </button>
            `}
        </div>
        ` : ''}
        
        ${montantRestantDu > 0 ? `
        <div style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%); color: white; padding: 1rem; border-radius: 8px; text-align: center; margin-bottom: 1.5rem; box-shadow: 0 3px 8px rgba(255,107,107,0.3);">
            <div style="font-size: 0.85rem; margin-bottom: 0.3rem; opacity: 0.95;">⚠️ MONTANT RESTANT DÛ</div>
            <div style="font-size: 1.5rem; font-weight: 700;">${formatCurrency(montantRestantDu)}</div>
        </div>
        ` : ''}
        
        
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button onclick="imprimerFacture('${commandeId}')" 
                    style="background: #666; color: white; border: none; padding: 0.7rem 1rem; border-radius: 6px; cursor: pointer; flex: 1; min-width: 120px;">
                <i class="fas fa-print"></i> Imprimer
            </button>
            <button onclick="imprimerTicketThermique('${commandeId}')" 
                    style="background: #795548; color: white; border: none; padding: 0.7rem 1rem; border-radius: 6px; cursor: pointer; flex: 1; min-width: 120px;">
                <i class="fas fa-receipt"></i> Ticket
            </button>
            <button onclick="envoyerFactureWhatsAppFromList('${commandeId}')" 
                    style="background: #25D366; color: white; border: none; padding: 0.7rem 1rem; border-radius: 6px; cursor: pointer; flex: 1; min-width: 120px;">
                <i class="fab fa-whatsapp"></i> WhatsApp
            </button>
            <button ${deleteButtonOnClick}
                    style="${deleteButtonStyle}"
                    title="${deleteButtonTitle}">
                <i class="fas fa-trash"></i> Supprimer
            </button>
        </div>
    `;
    
    // Show modal
    document.getElementById('modalDetailsCommande').style.display = 'flex';
    
    // Charger les livreurs si statut en_livraison
    if (currentStatus === 'en_livraison') {
        chargerListeLivreurs(commandeId);
        verifierLivreurAssigne(commandeId);
    }
}


// Adapter le layout de la section livreur lors du redimensionnement
function adapterLayoutLivreurSection(commandeId) {
    const section = document.getElementById(`livreurSection_${commandeId}`);
    if (!section) return;
    
    const container = section.querySelector('div[style*="display: flex"]');
    if (!container) return;
    
    const isMobile = window.innerWidth <= 767;
    const button = container.querySelector('button');
    const select = container.querySelector('select');
    
    if (isMobile) {
        container.style.flexDirection = 'column';
        container.style.alignItems = 'stretch';
        if (button) {
            button.style.width = '100%';
            button.style.marginTop = '0.5rem';
        }
    } else {
        container.style.flexDirection = 'row';
        container.style.alignItems = 'center';
        if (button) {
            button.style.width = 'auto';
            button.style.marginTop = '0';
        }
    }
}

// Écouter les changements d'orientation et redimensionnement
if (typeof window !== 'undefined') {
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (selectedOrderId) {
                adapterLayoutLivreurSection(selectedOrderId);
            }
        }, 250);
    });
    
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            if (selectedOrderId) {
                adapterLayoutLivreurSection(selectedOrderId);
            }
        }, 300);
    });
}

function fermerDetailsCommande() {
    selectedOrderId = null;
    const panel = document.getElementById('orderDetailsContent');
    panel.innerHTML = `
        <div class="no-order-selected">
            <i class="fas fa-hand-pointer"></i>
            <p>Sélectionnez une commande pour voir les détails</p>
        </div>
    `;
}

// ===== GESTION LIVREURS =====
// Variables globales pour les livreurs sont déclarées en haut du fichier

async function chargerListeLivreurs(commandeId) {
    try {
        const response = await fetch('/api/livreur/actifs', {
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des livreurs');
        }
        const data = await response.json();
        livreursActifs = data.livreurs_actifs || [];
        
        // Remplir le dropdown
        const selectElement = document.getElementById(`livreurSelect_${commandeId}`);
        if (selectElement) {
            livreursActifs.forEach(livreur => {
                const option = document.createElement('option');
                option.value = livreur;
                option.textContent = livreur;
                selectElement.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur chargement livreurs:', error);
        showToast('Erreur lors du chargement des livreurs', 'error');
    }
}

async function verifierLivreurAssigne(commandeId) {
    try {
        const response = await fetch(`/api/livreur/check/${commandeId}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur vérification livreur');
        }
        
        const data = await response.json();
        
        if (data.hasLivreur && data.livreur) {
            // Stocker l'info du livreur assigné
            livreurDejaAssigne[commandeId] = data.livreur;
            
            // Pré-sélectionner le livreur dans le dropdown
            const selectElement = document.getElementById(`livreurSelect_${commandeId}`);
            if (selectElement) {
                selectElement.value = data.livreur;
                selectElement.style.background = '#E8F5E9';
                selectElement.style.fontWeight = '600';
                
                // Ajouter un badge "Déjà assigné"
                const container = selectElement.parentElement;
                if (container && !container.querySelector('.livreur-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'livreur-badge';
                    badge.style.cssText = 'margin-top: 0.5rem; padding: 0.4rem 0.6rem; background: #4CAF50; color: white; border-radius: 4px; font-size: 0.85rem; text-align: center;';
                    badge.innerHTML = `<i class="fas fa-check-circle"></i> Déjà assigné à ${data.livreur}`;
                    container.appendChild(badge);
                }
            }
        }
    } catch (error) {
        console.error('Erreur vérification livreur:', error);
        // Ne pas bloquer si erreur
    }
}

async function assignerLivreur(commandeId) {
    const selectElement = document.getElementById(`livreurSelect_${commandeId}`);
    const livreurNom = selectElement ? selectElement.value : '';
    
    if (!livreurNom) {
        showToast('Veuillez sélectionner un livreur', 'error');
        return;
    }
    
    // Vérifier si un livreur est déjà assigné et si on essaie de le changer
    const livreurActuel = livreurDejaAssigne[commandeId];
    if (livreurActuel && livreurActuel !== livreurNom) {
        const confirmation = confirm(
            `⚠️ ATTENTION\n\n` +
            `Un livreur est déjà assigné à cette commande :\n` +
            `▶ Livreur actuel : ${livreurActuel}\n` +
            `▶ Nouveau livreur : ${livreurNom}\n\n` +
            `Voulez-vous vraiment changer le livreur ?`
        );
        
        if (!confirmation) {
            // L'utilisateur a annulé, remettre l'ancien livreur
            selectElement.value = livreurActuel;
            return;
        }
    }
    
    // Récupérer les informations de la commande
    const commande = commandesData.get(commandeId);
    if (!commande) {
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Extraire les informations client
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'] || 'Client inconnu';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || '';
    
    console.log('📦 Données client extraites:', { clientName, clientPhone, clientAddress });
    
    // Construire la liste des articles
    const articles = commande.items.map(item => ({
        produit: item.Produit || item.produit || '',
        quantite: item.Nombre || item.nombre || 0,
        prix: item.Montant || item.montant || 0
    }));
    
    // Obtenir le point de vente actuel
    const pointVenteSelect = document.getElementById('pointVenteSelect');
    const pointVente = pointVenteSelect ? pointVenteSelect.value : '';
    
    // Préparer le body de la requête
    const requestBody = {
        commande_id: commandeId,
        livreur_id: livreurNom,
        livreur_nom: livreurNom,
        client: {
            nom: clientName,
            telephone: clientPhone,
            adresse: clientAddress
        },
        articles: articles,
        total: commande.totalAmount || 0,
        point_vente: pointVente,
        date_commande: firstItem.createdAt || new Date().toISOString(),
        statut: "en_livraison"
    };
    
    // Afficher un indicateur de chargement
    selectElement.disabled = true;
    const validateBtn = selectElement.nextElementSibling;
    if (validateBtn) {
        validateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
        validateBtn.disabled = true;
    }
    
    try {
        // Envoyer via le proxy backend local
        const response = await fetch('/api/livreur/assigner', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include', // Important pour envoyer les cookies de session
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `Erreur HTTP: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Réponse API livreur:', result);
        
        showToast(`Commande assignée à ${livreurNom} avec succès!`, 'success');
        
        // Mettre à jour la variable locale
        livreurDejaAssigne[commandeId] = livreurNom;
        
        // Réinitialiser le formulaire
        if (validateBtn) {
            validateBtn.innerHTML = '<i class="fas fa-check"></i> ✓ Envoyé';
            validateBtn.style.background = '#4CAF50';
        }
        
        // Rafraîchir après 2 secondes
        setTimeout(() => {
            afficherDetailsCommande(commandeId);
        }, 2000);
        
    } catch (error) {
        console.error('Erreur assignation livreur:', error);
        showToast(`Erreur: ${error.message}`, 'error');
        
        // Réactiver les contrôles en cas d'erreur
        if (selectElement) selectElement.disabled = false;
        if (validateBtn) {
            validateBtn.innerHTML = '<i class="fas fa-check"></i> Valider';
            validateBtn.disabled = false;
        }
    }
}

// ===== KANBAN BOARD =====
// Global variables are declared at the top of the file

// Fonctions livreur pour Kanban
async function chargerListeLivreursKanban(commandeId) {
    try {
        // Utiliser les livreurs déjà chargés si disponibles
        if (livreursActifs.length === 0) {
            const response = await fetch('/api/livreur/actifs', {
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error('Erreur lors du chargement des livreurs');
            }
            const data = await response.json();
            livreursActifs = data.livreurs_actifs || [];
        }
        
        // Remplir le dropdown
        const selectElement = document.getElementById(`livreurSelectKanban_${commandeId}`);
        if (selectElement && selectElement.options.length === 1) { // Seulement l'option par défaut
            livreursActifs.forEach(livreur => {
                const option = document.createElement('option');
                option.value = livreur;
                option.textContent = livreur;
                selectElement.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur chargement livreurs Kanban:', error);
    }
}

// Fonction pour recharger la liste des livreurs
async function rechargerLivreursKanban(commandeId) {
    try {
        console.log('🔄 Rechargement des livreurs pour commande:', commandeId);
        
        // Forcer le rechargement depuis le serveur
        const response = await fetch('/api/livreur/actifs', {
            credentials: 'include',
            cache: 'no-cache'  // Force pas de cache
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du rechargement des livreurs');
        }
        
        const data = await response.json();
        livreursActifs = data.livreurs_actifs || [];
        
        console.log('✅ Livreurs rechargés:', livreursActifs);
        
        // Vider et remplir le dropdown
        const selectElement = document.getElementById(`livreurSelectKanban_${commandeId}`);
        if (selectElement) {
            // Sauvegarder la valeur actuelle
            const currentValue = selectElement.value;
            
            // Vider toutes les options sauf la première
            while (selectElement.options.length > 1) {
                selectElement.remove(1);
            }
            
            // Ajouter les nouveaux livreurs
            livreursActifs.forEach(livreur => {
                const option = document.createElement('option');
                option.value = livreur;
                option.textContent = livreur;
                selectElement.appendChild(option);
            });
            
            // Restaurer la valeur si elle existe toujours
            if (currentValue && livreursActifs.includes(currentValue)) {
                selectElement.value = currentValue;
            }
            
            showToast('✅ Liste des livreurs mise à jour', 'success');
        }
        
    } catch (error) {
        console.error('❌ Erreur rechargement livreurs:', error);
        showToast('Erreur lors du rechargement des livreurs', 'error');
    }
}

// Fonction pour recharger TOUS les livreurs de toutes les commandes en une fois
async function rechargerTousLesLivreurs() {
    try {
        console.log('🔄 Rechargement de tous les livreurs...');
        
        // Afficher un indicateur de chargement
        const btn = event.target.closest('.btn-refresh-livreurs-kanban');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement...';
        btn.disabled = true;
        
        // Forcer le rechargement depuis le serveur
        const response = await fetch('/api/livreur/actifs', {
            credentials: 'include',
            cache: 'no-cache'
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du rechargement des livreurs');
        }
        
        const data = await response.json();
        livreursActifs = data.livreurs_actifs || [];
        
        console.log('✅ Livreurs rechargés:', livreursActifs);
        
        // Trouver TOUS les dropdowns de livreurs dans le Kanban
        const allSelects = document.querySelectorAll('[id^="livreurSelectKanban_"]');
        let updatedCount = 0;
        
        allSelects.forEach(selectElement => {
            // Extraire l'ID de la commande
            const commandeId = selectElement.id.replace('livreurSelectKanban_', '');
            
            // Sauvegarder la valeur actuelle
            const currentValue = selectElement.value;
            
            // Vider toutes les options sauf la première
            while (selectElement.options.length > 1) {
                selectElement.remove(1);
            }
            
            // Ajouter les nouveaux livreurs
            livreursActifs.forEach(livreur => {
                const option = document.createElement('option');
                option.value = livreur;
                option.textContent = livreur;
                selectElement.appendChild(option);
            });
            
            // Restaurer la valeur si elle existe toujours, sinon recharger depuis le backend
            if (currentValue && livreursActifs.includes(currentValue)) {
                selectElement.value = currentValue;
            } else {
                // Vérifier si un livreur est assigné dans le backend
                verifierLivreurAssigneKanban(commandeId);
            }
            
            updatedCount++;
        });
        
        // Restaurer le bouton
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        
        showToast(`✅ ${updatedCount} liste(s) de livreurs mise(s) à jour`, 'success');
        
    } catch (error) {
        console.error('❌ Erreur rechargement tous les livreurs:', error);
        showToast('Erreur lors du rechargement des livreurs', 'error');
        
        // Restaurer le bouton en cas d'erreur
        const btn = event.target.closest('.btn-refresh-livreurs-kanban');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-sync-alt"></i> Livreurs';
            btn.disabled = false;
        }
    }
}

async function verifierLivreurAssigneKanban(commandeId) {
    try {
        const response = await fetch(`/api/livreur/check/${commandeId}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur vérification livreur');
        }
        
        const data = await response.json();
        
        if (data.hasLivreur && data.livreur) {
            // Stocker l'info du livreur assigné
            livreurDejaAssigne[commandeId] = data.livreur;
            
            // Pré-sélectionner le livreur dans le dropdown
            const selectElement = document.getElementById(`livreurSelectKanban_${commandeId}`);
            if (selectElement) {
                selectElement.value = data.livreur;
                selectElement.style.background = '#E8F5E9';
                selectElement.style.color = '#2E7D32';
                selectElement.style.fontWeight = '600';
            }
        }
    } catch (error) {
        console.error('Erreur vérification livreur Kanban:', error);
        // Ne pas bloquer si erreur
    }
}

async function assignerLivreurKanban(commandeId) {
    const selectElement = document.getElementById(`livreurSelectKanban_${commandeId}`);
    const livreurNom = selectElement ? selectElement.value : '';
    
    if (!livreurNom) {
        showToast('Veuillez sélectionner un livreur', 'error');
        return;
    }
    
    // Vérifier si un livreur est déjà assigné et si on essaie de le changer
    const livreurActuel = livreurDejaAssigne[commandeId];
    if (livreurActuel && livreurActuel !== livreurNom) {
        const confirmation = confirm(
            `⚠️ ATTENTION\n\n` +
            `Un livreur est déjà assigné à cette commande :\n` +
            `▶ Livreur actuel : ${livreurActuel}\n` +
            `▶ Nouveau livreur : ${livreurNom}\n\n` +
            `Voulez-vous vraiment changer le livreur ?`
        );
        
        if (!confirmation) {
            // L'utilisateur a annulé, remettre l'ancien livreur
            selectElement.value = livreurActuel;
            return;
        }
    }
    
    // Trouver la commande dans kanbanCommandesData
    const commande = kanbanCommandesData.find(c => c.commandeId === commandeId);
    if (!commande) {
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Extraire les informations client
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'] || 'Client inconnu';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || '';
    
    console.log('📦 Données client extraites (Kanban):', { clientName, clientPhone, clientAddress });
    
    // Avertissements pour informations client manquantes (non bloquant)
    const warnings = [];
    if (!clientName || clientName === 'Client inconnu') {
        warnings.push('nom du client');
    }
    if (!clientPhone) {
        warnings.push('numéro de téléphone');
    }
    if (!clientAddress) {
        warnings.push('adresse');
    }
    
    if (warnings.length > 0) {
        const warningMessage = `⚠️ Informations manquantes : ${warnings.join(', ')}. L'assignation continuera quand même.`;
        showToast(warningMessage, 'warning');
        console.warn('⚠️ Données client incomplètes:', { clientName, clientPhone, clientAddress });
    }
    
    // Construire la liste des articles
    const articles = commande.items.map(item => ({
        produit: item.Produit || item.produit || '',
        quantite: item.Nombre || item.nombre || 0,
        prix: item.Montant || item.montant || 0
    }));
    
    // Si le nom est "Client inconnu", utiliser un placeholder avec l'ID de commande
    let finalClientName = clientName;
    if (!clientName || clientName === 'Client inconnu') {
        finalClientName = `Client-${commandeId.slice(-6)}`;
    }
    
    // Obtenir le point de vente actuel
    const pointVenteSelect = document.getElementById('pointVenteSelect');
    const pointVente = pointVenteSelect ? pointVenteSelect.value : '';
    
    // Préparer le body de la requête
    const requestBody = {
        commande_id: commandeId,
        livreur_id: livreurNom,
        livreur_nom: livreurNom,
        client: {
            nom: finalClientName,
            telephone: clientPhone || 'Non renseigné',
            adresse: clientAddress || 'Non renseignée'
        },
        articles: articles,
        total: commande.totalAmount || 0,
        point_vente: pointVente,
        date_commande: firstItem.createdAt || new Date().toISOString(),
        statut: "en_livraison"
    };
    
    // Afficher un indicateur de chargement
    selectElement.disabled = true;
    const validateBtn = selectElement.nextElementSibling;
    if (validateBtn) {
        validateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        validateBtn.disabled = true;
    }
    
    try {
        // Envoyer la requête au backend qui fera le proxy vers l'API externe
        const response = await fetch('/api/livreur/assigner', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include', // Important pour envoyer les cookies de session
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `Erreur HTTP: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Réponse API livreur (Kanban):', result);
        
        showToast(`✓ Commande assignée à ${livreurNom}`, 'success');
        
        // Mettre à jour la variable locale
        livreurDejaAssigne[commandeId] = livreurNom;
        
        // Update card's data attribute for filtering
        const card = document.querySelector(`.kanban-card[data-commande-id="${commandeId}"]`);
        if (card) {
            card.dataset.livreurAssigne = livreurNom;
        }
        
        // Mettre à jour le bouton pour indiquer le succès
        if (validateBtn) {
            validateBtn.innerHTML = '<i class="fas fa-check"></i>';
            validateBtn.style.background = '#4CAF50';
        }
        
        // Désactiver le select et montrer le livreur assigné
        if (selectElement) {
            selectElement.style.background = '#E8F5E9';
            selectElement.style.color = '#2E7D32';
            selectElement.style.fontWeight = '600';
        }
        
    } catch (error) {
        console.error('Erreur assignation livreur Kanban:', error);
        showToast(`Erreur: ${error.message}`, 'error');
        
        // Réactiver les contrôles en cas d'erreur
        if (selectElement) selectElement.disabled = false;
        if (validateBtn) {
            validateBtn.innerHTML = '<i class="fas fa-check"></i>';
            validateBtn.disabled = false;
        }
    }
}

async function ouvrirKanban() {
    console.log('🎯 ouvrirKanban() - Démarrage');
    
    // Hide main POS
    const posMain = document.querySelector('.pos-main');
    if (posMain) {
        posMain.style.display = 'none';
        console.log('✅ .pos-main caché');
    } else {
        console.error('❌ .pos-main non trouvé');
    }
    
    // Show Kanban
    const kanbanBoard = document.getElementById('kanbanBoard');
    if (kanbanBoard) {
        kanbanBoard.style.display = 'flex';
        console.log('✅ kanbanBoard affiché');
        
        // Debug: Check computed style
        const computedStyle = window.getComputedStyle(kanbanBoard);
        console.log('🔍 Kanban Board styles:', {
            display: computedStyle.display,
            position: computedStyle.position,
            zIndex: computedStyle.zIndex,
            background: computedStyle.background,
            width: computedStyle.width,
            height: computedStyle.height,
            top: computedStyle.top,
            left: computedStyle.left
        });
    } else {
        console.error('❌ kanbanBoard non trouvé');
        return;
    }
    
    // Load orders
    console.log('📥 Chargement des commandes...');
    await chargerCommandesKanban();
    
    // Populate filters
    await populerFiltresKanban();
    
    console.log('✅ Kanban ouvert avec succès');
}

async function populerFiltresKanban() {
    try {
        // Populate Point de Vente dropdown
        const pointsVente = new Set();
        kanbanCommandesData.forEach(commande => {
            const items = commande.items || commande.panier || [];
            if (items.length > 0) {
                const pointVente = items[0]['Point de Vente'] || items[0].pointVente || items[0].Point_de_vente || items[0].point_vente || '';
                if (pointVente) {
                    pointsVente.add(pointVente);
                }
            }
        });
        
        const filterPointVente = document.getElementById('kanbanFilterPointVente');
        if (filterPointVente) {
            // Clear existing options except first
            filterPointVente.innerHTML = '<option value="">Tous les points de vente</option>';
            
            // Add unique points de vente
            Array.from(pointsVente).sort().forEach(pv => {
                const option = document.createElement('option');
                option.value = pv;
                option.textContent = pv;
                filterPointVente.appendChild(option);
            });
        }
        
        // Populate Livreur dropdown
        const response = await fetch('/api/livreur/actifs', {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            const filterLivreur = document.getElementById('kanbanFilterLivreur');
            if (filterLivreur && data.livreurs_actifs) {
                // Clear existing options except first two (Tous and Non assigné)
                filterLivreur.innerHTML = '<option value="">Tous les livreurs</option><option value="non_assigne">Non assigné</option>';
                
                // Add livreurs
                data.livreurs_actifs.forEach(livreur => {
                    const option = document.createElement('option');
                    option.value = livreur;
                    option.textContent = livreur;
                    filterLivreur.appendChild(option);
                });
            }
        }
        
        // Set today's date as default
        const filterDate = document.getElementById('kanbanFilterDate');
        if (filterDate) {
            const today = new Date().toISOString().split('T')[0];
            filterDate.value = today;
        }
        
        console.log('✅ Filtres Kanban populés');
    } catch (error) {
        console.error('❌ Erreur lors du remplissage des filtres:', error);
    }
}

function fermerKanban() {
    console.log('🔙 fermerKanban() - Retour au POS');
    
    // Hide Kanban
    const kanbanBoard = document.getElementById('kanbanBoard');
    if (kanbanBoard) {
        kanbanBoard.style.display = 'none';
        console.log('✅ kanbanBoard caché');
    }
    
    // Show main POS
    const posMain = document.querySelector('.pos-main');
    if (posMain) {
        posMain.style.display = 'grid';
        console.log('✅ .pos-main affiché');
    }
    
    // Reload normal transactions
    console.log('🔄 Rechargement des transactions...');
    chargerResume();
}

async function chargerCommandesKanban() {
    console.log('📊 chargerCommandesKanban() - Démarrage');
    try {
        const pointVente = document.getElementById('pointVenteSelect').value;
        const dateInput = document.getElementById('summaryDate');
        const date = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        const dateFormatted = date.split('-').reverse().join('-');
        
        console.log(`📅 Chargement pour: ${pointVente} - Date: ${dateFormatted}`);
        
        const response = await fetch(`/api/ventes-date?date=${dateFormatted}&pointVente=${pointVente}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Erreur chargement');
        }
        
        const data = await response.json();
        const ventes = data.ventes || [];
        
        console.log(`✅ ${ventes.length} ventes récupérées`);
        
        // Group by commande_id
        const commandesMap = new Map();
        
        ventes.forEach(vente => {
            const commandeId = vente.commande_id || vente.commandeId;
            if (commandeId) {
                if (!commandesMap.has(commandeId)) {
                    commandesMap.set(commandeId, {
                        commandeId: commandeId,
                        items: [],
                        totalAmount: 0,
                        createdAt: vente.createdAt || vente.created_at || new Date()
                    });
                }
                
                commandesMap.get(commandeId).items.push(vente);
                commandesMap.get(commandeId).totalAmount += parseFloat(vente.Montant || vente.montant || 0);
                
                // Preserve livreur_assigne from first item
                if (!commandesMap.get(commandeId).livreur_assigne && vente.livreur_assigne) {
                    commandesMap.get(commandeId).livreur_assigne = vente.livreur_assigne;
                }
            }
        });
        
        // Store globally for details view
        commandesData = commandesMap;
        
        // Convert to array
        kanbanCommandesData = Array.from(commandesMap.values());
        
        console.log(`🗂️ ${kanbanCommandesData.length} commandes groupées`);
        
        // Display in Kanban
        afficherKanban();
        
    } catch (error) {
        console.error('Erreur chargement Kanban:', error);
        showToast('Erreur chargement des commandes', 'error');
    }
}

function afficherKanban() {
    console.log('🎨 afficherKanban() - Affichage des cartes');
    
    // Clear columns - with null checks
    const kanbanColumns = ['sur_place', 'en_preparation', 'pret', 'en_livraison'];
    kanbanColumns.forEach(columnId => {
        const column = document.getElementById(`kanban-${columnId}`);
        if (column) {
            column.innerHTML = '';
        } else {
            console.warn(`⚠️ Colonne kanban-${columnId} non trouvée`);
        }
    });
    
    // Count by status
    const counts = {
        sur_place: 0,
        en_preparation: 0,
        pret: 0,
        en_livraison: 0
    };
    
    // Display cards
    kanbanCommandesData.forEach(commande => {
        const firstItem = commande.items[0] || {};
        const status = firstItem.statut_preparation || 'en_preparation';
        counts[status]++;
        
        const card = creerCarteKanban(commande);
        const column = document.getElementById(`kanban-${status}`);
        if (column) {
            column.appendChild(card);
        } else {
            console.error(`❌ Colonne kanban-${status} non trouvée`);
        }
    });
    
    console.log('📊 Compteurs:', counts);
    
    // Update counters in column headers - avoid fixed order assumptions
    const statusConfig = [
        { id: 'sur_place', title: 'SUR PLACE' },
        { id: 'en_preparation', title: 'EN PRÉPARATION' },
        { id: 'pret', title: 'PRÊT' },
        { id: 'en_livraison', title: 'EN LIVRAISON' }
    ];
    
    statusConfig.forEach((config, index) => {
        const headers = document.querySelectorAll('.kanban-column-header h3');
        if (headers[index]) {
            const count = counts[config.id] || 0;
            headers[index].textContent = `${config.title} (${count})`;
        }
    });
    
    console.log('✅ Kanban affiché avec succès');
}

function creerCarteKanban(commande) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.dataset.commandeId = commande.commandeId;
    
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'] || 'Client inconnu';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || '';
    const clientInstructions = firstItem.instructionsClient || firstItem['Client Instructions'] || '';
    const currentStatus = firstItem.statut_preparation || 'en_preparation';
    const pointVente = firstItem['Point de Vente'] || firstItem.pointVente || firstItem.Point_de_vente || firstItem.point_vente || '';
    const livreurAssigne = firstItem.livreur_assigne || '';
    
    // Store data for filtering
    card.dataset.pointVente = pointVente;
    card.dataset.livreurAssigne = livreurAssigne;
    card.dataset.date = commande.createdAt ? new Date(commande.createdAt).toISOString().split('T')[0] : '';
    
    const time = commande.createdAt ? new Date(commande.createdAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
    }) : '';
    
    const date = commande.createdAt ? new Date(commande.createdAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }) : '';
    
    // Build items list with prices
    const itemsHtml = commande.items.map(item => {
        const produit = item.Produit || item.produit || '';
        const nombre = item.Nombre || item.nombre || 0;
        const montant = parseFloat(item.Montant || item.montant || 0);
        const unite = item.unite || 'kg';
        
        // Check if this is a pack with a modified composition
        let compositionIndicator = '';
        if (item.extension && item.extension.composition && Array.isArray(item.extension.composition)) {
            const compositionItems = item.extension.composition.map(comp => 
                `${comp.quantite}${comp.unite} ${comp.produit}`
            ).join(', ');
            compositionIndicator = `<div class="kanban-item-composition" style="font-size: 0.75rem; color: #2196F3; font-style: italic; margin-top: 0.2rem;"><i class="fas fa-box-open"></i> ${compositionItems}</div>`;
        }
        
        return `<div class="kanban-item">
            <span class="kanban-item-product">${nombre}${unite} ${produit}${compositionIndicator}</span>
            <span class="kanban-item-price">${formatCurrency(montant)}</span>
        </div>`;
    }).join('');
    
    // Status navigation arrows (DANS LE HEADER maintenant)
    let statusArrowsHtml = '';
    if (currentStatus === 'sur_place') {
        // Les commandes sur place n'ont pas de flèches de navigation
        statusArrowsHtml = '';
    } else if (currentStatus === 'en_preparation') {
        statusArrowsHtml = `<button class="btn-status-arrow-mini btn-next" onclick="changerStatutCommande('${commande.commandeId}', 'pret')" title="Marquer comme Prêt"><i class="fas fa-arrow-right"></i></button>`;
    } else if (currentStatus === 'pret') {
        statusArrowsHtml = `
            <button class="btn-status-arrow-mini btn-prev" onclick="changerStatutCommande('${commande.commandeId}', 'en_preparation')" title="Retour"><i class="fas fa-arrow-left"></i></button>
            <button class="btn-status-arrow-mini btn-next" onclick="changerStatutCommande('${commande.commandeId}', 'en_livraison')" title="En livraison"><i class="fas fa-arrow-right"></i></button>
        `;
    } else if (currentStatus === 'en_livraison') {
        statusArrowsHtml = `<button class="btn-status-arrow-mini btn-prev" onclick="changerStatutCommande('${commande.commandeId}', 'pret')" title="Retour Prêt"><i class="fas fa-arrow-left"></i></button>`;
    }
    
    // Actions (only for pret and en_livraison)
    let actionsHtml = '';
    if (currentStatus === 'pret' || currentStatus === 'en_livraison') {
        actionsHtml = `
            <div class="kanban-card-actions">
                <button class="btn-kanban-print" onclick="imprimerFactureKanban('${commande.commandeId}')">
                    <i class="fas fa-print"></i>
                </button>
                <button class="btn-kanban-whatsapp" onclick="envoyerFactureWhatsAppKanban('${commande.commandeId}')">
                    <i class="fab fa-whatsapp"></i>
                </button>
            </div>
        `;
    }
    
    // Section livreur pour en_livraison
    let livreurSectionKanban = '';
    if (currentStatus === 'en_livraison') {
        livreurSectionKanban = `
            <div class="kanban-livreur-section" style="background: #E3F2FD; padding: 0.8rem; margin-top: 0.5rem; border-radius: 6px; border: 1px solid #2196F3;">
                <div style="font-size: 0.85rem; color: #1976D2; font-weight: 600; margin-bottom: 0.5rem;">
                    <i class="fas fa-user-tie"></i> Livreur
                </div>
                <div style="display: flex; gap: 0.4rem;">
                    <select id="livreurSelectKanban_${commande.commandeId}" 
                            style="flex: 1; padding: 0.5rem; border: 1px solid #2196F3; border-radius: 4px; font-size: 0.85rem; background: white;">
                        <option value="">Sélectionner...</option>
                    </select>
                    <button onclick="assignerLivreurKanban('${commande.commandeId}')" 
                            style="background: #2196F3; color: white; border: none; padding: 0.5rem 0.8rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
                        <i class="fas fa-check"></i>
                    </button>
                </div>
            </div>
        `;
    }
    
    card.innerHTML = `
        <div class="kanban-card-header">
            <div>
                <div class="kanban-card-id">${commande.commandeId}</div>
                ${pointVente ? `<div class="kanban-card-point-vente" style="font-size: 0.8rem; color: #666; margin-top: 0.2rem;"><i class="fas fa-store"></i> ${pointVente}</div>` : ''}
                <div class="kanban-card-time"><i class="fas fa-clock"></i> ${time} ${date ? `<span style="margin-left: 0.3rem;">• ${date}</span>` : ''}</div>
            </div>
            <div class="kanban-card-header-actions">
                ${statusArrowsHtml}
                <button class="kanban-card-menu" onclick="menuKanbanCard(event, '${commande.commandeId}')">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </div>
        </div>
        
        <div class="kanban-card-client">
            <div class="kanban-client-name">
                <i class="fas fa-user"></i> ${clientName}${currentStatus === 'sur_place' ? ' 🍽️' : ''}
            </div>
            ${clientPhone ? `<div class="kanban-client-phone"><i class="fas fa-phone"></i> ${clientPhone}</div>` : ''}
            ${clientAddress ? `<div class="kanban-client-address"><i class="fas fa-map-marker-alt"></i> ${clientAddress}</div>` : ''}
            ${clientInstructions ? `<div class="kanban-client-instructions" style="background: #FFF3E0; border-left: 3px solid #FF9800; padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
                <div style="font-weight: 600; color: #E65100; font-size: 0.75rem; margin-bottom: 0.2rem;">
                    <i class="fas fa-exclamation-circle"></i> INSTRUCTIONS
                </div>
                <div style="color: #E65100; font-size: 0.8rem; line-height: 1.3;">${clientInstructions}</div>
            </div>` : ''}
        </div>
        
        <div class="kanban-card-items">
            <div class="kanban-items-title">
                <i class="fas fa-box"></i> ARTICLES
            </div>
            ${itemsHtml}
        </div>
        
        <div class="kanban-card-total">
            ${formatCurrency(commande.totalAmount)}
        </div>
        
        ${livreurSectionKanban}
        
        ${actionsHtml}
    `;
    
    // Charger les livreurs si statut en_livraison
    if (currentStatus === 'en_livraison') {
        setTimeout(() => {
            chargerListeLivreursKanban(commande.commandeId);
            verifierLivreurAssigneKanban(commande.commandeId);
        }, 100);
    }
    
    return card;
}

// Search & Filter
function filtrerKanban() {
    const searchInput = document.getElementById('kanbanSearchInput');
    const searchTerm = searchInput.value.toLowerCase().trim();
    const clearBtn = document.querySelector('.btn-clear-kanban-search');
    
    // Get filter values
    const filterPointVente = document.getElementById('kanbanFilterPointVente')?.value || '';
    const filterDate = document.getElementById('kanbanFilterDate')?.value || '';
    const filterLivreur = document.getElementById('kanbanFilterLivreur')?.value || '';
    
    if (searchTerm) {
        clearBtn.style.display = 'flex';
    } else {
        clearBtn.style.display = 'none';
    }
    
    document.querySelectorAll('.kanban-card').forEach(card => {
        const cardText = card.textContent.toLowerCase();
        let showCard = true;
        
        // Search term filter
        if (searchTerm !== '' && !cardText.includes(searchTerm)) {
            showCard = false;
        }
        
        // Point de Vente filter
        if (filterPointVente !== '' && card.dataset.pointVente !== filterPointVente) {
            showCard = false;
        }
        
        // Date filter
        if (filterDate !== '' && card.dataset.date !== filterDate) {
            showCard = false;
        }
        
        // Livreur filter
        if (filterLivreur !== '') {
            if (filterLivreur === 'non_assigne') {
                if (card.dataset.livreurAssigne !== '') {
                    showCard = false;
                }
            } else {
                if (card.dataset.livreurAssigne !== filterLivreur) {
                    showCard = false;
                }
            }
        }
        
        if (showCard) {
            card.classList.remove('filtered');
        } else {
            card.classList.add('filtered');
        }
    });
    
    // Update column counters
    updateKanbanCounters();
}

function updateKanbanCounters() {
    const counts = {
        sur_place: 0,
        en_preparation: 0,
        pret: 0,
        en_livraison: 0
    };
    
    // Count visible cards by status
    document.querySelectorAll('.kanban-card:not(.filtered)').forEach(card => {
        const column = card.closest('.kanban-column');
        if (column) {
            const status = column.dataset.status;
            if (counts.hasOwnProperty(status)) {
                counts[status]++;
            }
        }
    });
    
    // Update headers - avoid fixed order assumptions
    const statusConfig = [
        { id: 'sur_place', title: 'SUR PLACE' },
        { id: 'en_preparation', title: 'EN PRÉPARATION' },
        { id: 'pret', title: 'PRÊT' },
        { id: 'en_livraison', title: 'EN LIVRAISON' }
    ];
    
    statusConfig.forEach((config, index) => {
        const headers = document.querySelectorAll('.kanban-column-header h3');
        if (headers[index]) {
            const count = counts[config.id] || 0;
            headers[index].textContent = `${config.title} (${count})`;
        }
    });
}

function effacerRechercheKanban() {
    document.getElementById('kanbanSearchInput').value = '';
    document.querySelector('.btn-clear-kanban-search').style.display = 'none';
    
    // Also reset other filters
    const filterPointVente = document.getElementById('kanbanFilterPointVente');
    const filterDate = document.getElementById('kanbanFilterDate');
    const filterLivreur = document.getElementById('kanbanFilterLivreur');
    
    if (filterPointVente) filterPointVente.value = '';
    if (filterDate) {
        const today = new Date().toISOString().split('T')[0];
        filterDate.value = today;
    }
    if (filterLivreur) filterLivreur.value = '';
    
    filtrerKanban();
}

function menuKanbanCard(event, commandeId) {
    event.stopPropagation();
    // TODO: Show menu with options (delete, edit, etc.)
    console.log('Menu for:', commandeId);
}

// Kanban Print & WhatsApp functions
function imprimerFactureKanban(commandeId) {
    // Use existing imprimerFacture function from pos-modal-details.js
    if (typeof imprimerFacture === 'function') {
        imprimerFacture(commandeId);
    } else {
        showToast('Fonction d\'impression non disponible', 'error');
    }
}

function envoyerFactureWhatsAppKanban(commandeId) {
    // Use existing envoyerFactureWhatsAppFromList function
    if (typeof envoyerFactureWhatsAppFromList === 'function') {
        envoyerFactureWhatsAppFromList(commandeId);
    } else {
        showToast('Fonction WhatsApp non disponible', 'error');
    }
}

// Update toggleOrderTrackingView to use Kanban
function toggleOrderTrackingView() {
    console.log('🎯 toggleOrderTrackingView() appelée - Ouverture du Kanban');
    ouvrirKanban();
}

// ===== HISTORIQUE CLIENT =====

/**
 * Récupère la note moyenne d'un client de manière asynchrone
 * @param {string} phoneNumber - Numéro de téléphone du client
 * @returns {Promise<number|null>} - Note moyenne ou null si indisponible
 */
async function getClientAverageRating(phoneNumber) {
    // Vérifier si la note est déjà en cache
    if (clientRatingsCache[phoneNumber] !== undefined) {
        // Ne pas logger si c'est null (pour éviter le spam dans la console)
        if (clientRatingsCache[phoneNumber] !== null) {
            console.log(`📊 Note moyenne récupérée du cache pour ${maskPhoneNumber(phoneNumber)}: ${clientRatingsCache[phoneNumber]}/10`);
        }
        return clientRatingsCache[phoneNumber];
    }
    
    try {
        // Appeler l'API d'audit client avec un timeout de 2 minutes (en arrière-plan)
        // skip_sentiment=true pour réduire la latence
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // Timeout de 2 minutes (120 secondes)
        
        const response = await fetch(`/api/audit-client?phone_number=${encodeURIComponent(phoneNumber)}&skip_sentiment=true`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            console.warn(`⚠️ API erreur ${response.status} pour ${phoneNumber}`);
            // Mettre null en cache pour éviter de réessayer immédiatement
            clientRatingsCache[phoneNumber] = null;
            return null;
        }
        
        const data = await response.json();
        
        // Vérifier que l'API a réussi
        if (!data.success) {
            console.warn(`⚠️ API retourne success=false pour ${phoneNumber}:`, data.error || 'Erreur inconnue');
            clientRatingsCache[phoneNumber] = null;
            return null;
        }
        
        // 🆕 D'abord, récupérer le crédit client (si disponible)
        if (data.success && data.client_info && data.client_info.credit) {
            const credit = data.client_info.credit;
            
            // Vérifier que le crédit est valide et non expiré
            if (credit.current_balance && credit.current_balance > 0 && !credit.is_expired) {
                clientCreditsCache[phoneNumber] = {
                    balance: parseFloat(credit.current_balance),
                    total: parseFloat(credit.amount || credit.current_balance),
                    expires_at: credit.expires_at,
                    days_remaining: credit.days_remaining,
                    is_expired: credit.is_expired || false,
                    version: credit.version || 0  // 🆕 Nécessaire pour l'optimistic locking
                };
                console.log(`🎁 Crédit disponible pour ${maskPhoneNumber(phoneNumber)}: ${credit.current_balance} FCFA (version: ${credit.version || 0}, expire dans ${credit.days_remaining} jours)`);
                
                // Mettre à jour l'affichage du badge crédit (async, non-bloquant)
                setTimeout(() => {
                    updateAllCreditIndicatorsForPhone(phoneNumber);
                }, 0);
            } else {
                // Crédit épuisé, expiré, ou inexistant
                if (credit && credit.current_balance === 0) {
                    console.log(`ℹ️ Crédit épuisé pour ${maskPhoneNumber(phoneNumber)} (version: ${credit.version || 0})`);
                }
                clientCreditsCache[phoneNumber] = null;
                
                // Retirer les badges crédit affichés
                setTimeout(() => {
                    updateAllCreditIndicatorsForPhone(phoneNumber);
                }, 0);
            }
        } else {
            clientCreditsCache[phoneNumber] = null;
        }
        
        // 🆕 Récupérer le tag client (VVIP, VIP, etc.)
        if (data.success && data.client_info && data.client_info.client_tag) {
            const clientTag = data.client_info.client_tag;
            clientTagsCache[phoneNumber] = clientTag;
            console.log(`👑 Tag client pour ${maskPhoneNumber(phoneNumber)}: ${clientTag}`);
            
            // Mettre à jour l'affichage du badge tag (async, non-bloquant)
            setTimeout(() => {
                updateAllClientTagsForPhone(phoneNumber);
            }, 0);
        } else {
            clientTagsCache[phoneNumber] = null;
            // Clear any existing badge for this phone number
            setTimeout(() => {
                updateAllClientTagsForPhone(phoneNumber);
            }, 0);
        }
        
        // Chercher la note moyenne dans les commandes (en commençant par la plus récente)
        if (data.success && data.orders_history && data.orders_history.length > 0) {
            // Parcourir les commandes de la plus récente à la plus ancienne
            for (let i = 0; i < data.orders_history.length; i++) {
                const order = data.orders_history[i];
                if (order.ratings && order.ratings.average !== undefined && order.ratings.average !== null) {
                    const rating = parseFloat(order.ratings.average);
                    // Vérifier que le rating est un nombre valide
                    if (!isNaN(rating)) {
                        clientRatingsCache[phoneNumber] = rating;
                        console.log(`📊 Note moyenne récupérée via API pour ${maskPhoneNumber(phoneNumber)}: ${rating}/10 (commande du ${order.date})`);
                        return rating;
                    }
                }
            }
            console.log(`ℹ️ Aucune note trouvée dans l'historique pour ${maskPhoneNumber(phoneNumber)}`);
        }
        
        // Fallback: si pas de ratings dans la dernière commande, essayer statistics
        if (data.success && data.statistics && data.statistics.avg_rating !== undefined && data.statistics.avg_rating !== null) {
            const rating = parseFloat(data.statistics.avg_rating);
            if (!isNaN(rating)) {
                clientRatingsCache[phoneNumber] = rating;
                console.log(`📊 Note moyenne récupérée via API pour ${maskPhoneNumber(phoneNumber)}: ${rating}/10 (depuis statistics)`);
                return rating;
            }
        }
        
        // Pas de note disponible, mettre null en cache
        clientRatingsCache[phoneNumber] = null;
        return null;
    } catch (error) {
        if (error.name === 'AbortError') {
            // Timeout après 2 minutes - l'API externe est vraiment indisponible
            console.log(`⏱️ Timeout (2 min) pour ${maskPhoneNumber(phoneNumber)} - API externe indisponible`);
        } else {
            console.warn(`⚠️ Erreur API pour ${maskPhoneNumber(phoneNumber)}:`, error.message);
        }
        // Mettre null en cache pour éviter de réessayer immédiatement
        clientRatingsCache[phoneNumber] = null;
        return null;
    }
}

/**
 * Met à jour l'affichage des indicateurs de note pour une commande
 * @param {string} commandeId - ID de la commande
 * @param {string} phoneNumber - Numéro de téléphone du client
 */
async function updateClientRatingIndicator(commandeId, phoneNumber) {
    if (!phoneNumber) return;
    
    // Utiliser requestIdleCallback pour ne pas impacter les performances
    const updateIndicator = async () => {
        const rating = await getClientAverageRating(phoneNumber);
        
        if (rating !== null) {
            let emoji = '';
            let color = '';
            let shouldDisplay = false;
            
            // Client excellent (note > 9)
            if (rating > 9) {
                emoji = ' 💚';
                color = '#4CAF50'; // Vert
                shouldDisplay = true;
                console.log(`💚 Client excellent - commande ${commandeId} (note: ${rating}/10)`);
            }
            // Client très satisfait (note > 8 et <= 9)
            else if (rating > 8 && rating <= 9) {
                emoji = ' 😊';
                color = '#2196F3'; // Bleu
                shouldDisplay = true;
                console.log(`😊 Client très satisfait - commande ${commandeId} (note: ${rating}/10)`);
            }
            // Client satisfait (note > 7 et <= 8)
            else if (rating > 7 && rating <= 8) {
                emoji = ' 😐';
                color = '#9E9E9E'; // Gris
                shouldDisplay = true;
                console.log(`😐 Client satisfait - commande ${commandeId} (note: ${rating}/10)`);
            }
            // Client insatisfait (note > 6 et <= 7)
            else if (rating > 6 && rating <= 7) {
                emoji = ' 😠';
                color = '#FF9800'; // Orange
                shouldDisplay = true;
                console.log(`😠 Client insatisfait - commande ${commandeId} (note: ${rating}/10)`);
            }
            // Client très insatisfait (note <= 6)
            else if (rating <= 6) {
                emoji = ' 😡';
                color = '#F44336'; // Rouge
                shouldDisplay = true;
                console.log(`😡 Client très insatisfait - commande ${commandeId} (note: ${rating}/10)`);
            }
            
            if (shouldDisplay) {
                // Trouver l'élément de la commande et ajouter l'indicateur
                const commandeElements = document.querySelectorAll(`[data-commande-id="${commandeId}"]`);
                commandeElements.forEach(element => {
                    const clientDiv = element.querySelector('.commande-client');
                    if (clientDiv && !clientDiv.querySelector('.low-rating-indicator')) {
                        const indicator = document.createElement('span');
                        indicator.className = 'low-rating-indicator';
                        indicator.title = `Note moyenne: ${rating}/10`;
                        indicator.textContent = emoji;
                        indicator.style.fontSize = '1.1em';
                        indicator.style.marginLeft = '5px';
                        if (rating > 9) {
                            // Effet lumineux vert pour les excellents clients
                            indicator.style.filter = 'drop-shadow(0 0 3px rgba(76, 175, 80, 0.8))';
                        } else if (rating > 8 && rating <= 9) {
                            // Effet lumineux bleu pour les très satisfaits
                            indicator.style.filter = 'drop-shadow(0 0 3px rgba(33, 150, 243, 0.8))';
                        } else if (rating > 7 && rating <= 8) {
                            // Effet lumineux gris pour les satisfaits
                            indicator.style.filter = 'drop-shadow(0 0 3px rgba(158, 158, 158, 0.6))';
                        } else if (rating > 6 && rating <= 7) {
                            // Effet lumineux orange pour les insatisfaits
                            indicator.style.filter = 'drop-shadow(0 0 3px rgba(255, 152, 0, 0.8))';
                        } else if (rating <= 6) {
                            // Effet lumineux rouge pour les très insatisfaits
                            indicator.style.filter = 'drop-shadow(0 0 3px rgba(244, 67, 54, 0.8))';
                        }
                        clientDiv.appendChild(indicator);
                    }
                });
            }
        }
    };
    
    // Utiliser requestIdleCallback si disponible, sinon setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => updateIndicator(), { timeout: 2000 });
    } else {
        setTimeout(() => updateIndicator(), 100);
    }
}

/**
 * Afficher le badge de crédit disponible pour un client (async, non-bloquant)
 */
async function updateClientCreditIndicator(commandeId, phoneNumber) {
    if (!phoneNumber) return;
    
    // Non-bloquant: vérifier le cache immédiatement
    const credit = clientCreditsCache[phoneNumber];
    
    if (credit && credit.balance > 0) {
        // Crédit disponible → afficher le badge
        const updateCreditBadge = () => {
            const commandeElements = document.querySelectorAll(`[data-commande-id="${commandeId}"]`);
            console.log(`🔍 Recherche badges crédit pour ${commandeId}: ${commandeElements.length} éléments trouvés`);
            
            commandeElements.forEach(element => {
                // ⚠️ Ne PAS afficher le badge si cette commande a déjà utilisé du crédit
                const creditUsedAttr = element.getAttribute('data-credit-used');
                if (creditUsedAttr && parseFloat(creditUsedAttr) > 0) {
                    console.log(`ℹ️ Badge crédit NON affiché pour ${commandeId} (crédit déjà utilisé: ${creditUsedAttr} FCFA)`);
                    return; // Skip cette commande
                }
                
                const clientDiv = element.querySelector('.commande-client');
                console.log(`🔍 clientDiv trouvé:`, clientDiv ? 'OUI' : 'NON', clientDiv?.textContent);
                
                if (clientDiv && !clientDiv.querySelector('.credit-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'credit-badge';
                    badge.title = `Crédit disponible: ${credit.balance} FCFA\nExpire dans ${credit.days_remaining} jours`;
                    badge.innerHTML = ` 🎁 <strong>${formatCurrency(credit.balance)}</strong>`;
                    badge.style.cssText = `
                        font-size: 0.9em !important;
                        margin-left: 8px !important;
                        padding: 2px 8px !important;
                        background: linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%) !important;
                        border: 1px solid #4CAF50 !important;
                        border-radius: 12px !important;
                        color: #2E7D32 !important;
                        font-weight: 600 !important;
                        box-shadow: 0 2px 4px rgba(76, 175, 80, 0.2) !important;
                        display: inline-flex !important;
                        align-items: center !important;
                        gap: 3px !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                    `;
                    clientDiv.appendChild(badge);
                    console.log(`🎁 Badge crédit AJOUTÉ à - commande ${commandeId} (${credit.balance} FCFA)`);
                    console.log(`🎁 Contenu après ajout:`, clientDiv.innerHTML);
                } else if (clientDiv && clientDiv.querySelector('.credit-badge')) {
                    console.log(`ℹ️ Badge crédit déjà présent pour ${commandeId}`);
                }
            });
        };
        
        // Utiliser requestIdleCallback si disponible, sinon setTimeout
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => updateCreditBadge(), { timeout: 2000 });
        } else {
            setTimeout(() => updateCreditBadge(), 0);
        }
    } else {
        // Pas de crédit ou crédit épuisé → retirer les badges existants
        const removeCreditBadge = () => {
            const commandeElements = document.querySelectorAll(`[data-commande-id="${commandeId}"]`);
            
            commandeElements.forEach(element => {
                const clientDiv = element.querySelector('.commande-client');
                const existingBadge = clientDiv?.querySelector('.credit-badge');
                
                if (existingBadge) {
                    existingBadge.remove();
                    console.log(`🗑️ Badge crédit retiré pour ${commandeId} (crédit épuisé ou inexistant)`);
                }
            });
        };
        
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => removeCreditBadge(), { timeout: 2000 });
        } else {
            setTimeout(() => removeCreditBadge(), 0);
        }
    }
}

/**
 * Générer le badge HTML pour le tag client (VVIP, VIP, etc.)
 */
function getClientTagBadgeHtml(clientTag) {
    if (!clientTag) return '';
    
    const tagUpper = clientTag.toUpperCase();
    
    if (tagUpper === 'VVIP') {
        return `<span class="client-tag-badge vvip-badge" style="
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
            color: #000;
            font-size: 0.7rem;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 10px;
            margin-right: 6px;
            border: 1px solid #FF8C00;
            box-shadow: 0 2px 4px rgba(255, 215, 0, 0.3);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        ">👑 VVIP</span>`;
    } else if (tagUpper === 'VIP') {
        return `<span class="client-tag-badge vip-badge" style="
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%);
            color: #000;
            font-size: 0.7rem;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 10px;
            margin-right: 6px;
            border: 1px solid #909090;
            box-shadow: 0 2px 4px rgba(192, 192, 192, 0.3);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        ">🏆 VIP</span>`;
    }
    
    return '';
}

/**
 * Mettre à jour tous les badges de tag client pour un numéro de téléphone
 */
function updateAllClientTagsForPhone(phoneNumber) {
    if (!phoneNumber) return;
    
    const clientTag = clientTagsCache[phoneNumber];
    
    // Escape phone number for CSS selector (handle +, spaces, -, parentheses, etc.)
    const escapedPhone = (typeof CSS !== 'undefined' && CSS.escape) 
        ? CSS.escape(phoneNumber) 
        : phoneNumber.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
    
    // Trouver tous les éléments avec ce numéro de téléphone
    const commandeElements = document.querySelectorAll(`[data-client-phone="${escapedPhone}"]`);
    
    commandeElements.forEach(element => {
        const clientDiv = element.querySelector('.commande-client');
        if (!clientDiv) return;
        
        // Retirer l'ancien badge s'il existe
        const existingBadge = clientDiv.querySelector('.client-tag-badge');
        if (existingBadge) {
            existingBadge.remove();
        }
        
        // Ajouter le nouveau badge si le tag existe
        if (clientTag) {
            const badgeHtml = getClientTagBadgeHtml(clientTag);
            if (badgeHtml) {
                // Insérer le badge au début du clientDiv
                clientDiv.insertAdjacentHTML('afterbegin', badgeHtml);
                console.log(`👑 Badge tag "${clientTag}" ajouté pour ${maskPhoneNumber(phoneNumber)}`);
            }
        }
    });
}

/**
 * Ouvre la modal d'historique client et charge les données
 */
async function ouvrirHistoriqueClient(phoneNumber, clientName = '') {
    console.log('📊 Ouverture historique pour:', maskPhoneNumber(phoneNumber));
    
    const modal = document.getElementById('historiqueClientModal');
    if (!modal) {
        console.error('❌ Modal historique non trouvée');
        return;
    }
    
    // Afficher la modal
    modal.style.display = 'flex';
    
    // Sur mobile, désactiver le scroll du body pour éviter les problèmes
    if (window.innerWidth <= 768) {
        document.body.style.overflow = 'hidden';
    }
    
    // Mettre à jour le titre (avec badge tag si disponible)
    const clientTag = clientTagsCache[phoneNumber];
    const clientTagBadge = clientTag ? getClientTagBadgeHtml(clientTag) : '';
    const historiqueNomElement = document.getElementById('historiqueNomClient');
    
    if (clientTagBadge) {
        // Escape client name to prevent XSS when using innerHTML
        const escapedClientName = escapeHtml(clientName || 'Client');
        historiqueNomElement.innerHTML = `${clientTagBadge}${escapedClientName}`;
    } else {
        historiqueNomElement.textContent = clientName || 'Client';
    }
    
    document.getElementById('historiqueTelClient').textContent = phoneNumber;
    
    // Réinitialiser le conteneur
    const container = document.getElementById('historiqueCommandesContainer');
    container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #999;">
            <i class="fas fa-spinner fa-spin fa-3x"></i>
            <div style="margin-top: 15px;">Chargement de l'historique...</div>
        </div>
    `;
    
    try {
        // Appeler l'API d'audit client avec skip_sentiment=true pour réduire la latence
        const response = await fetch(`/api/audit-client?phone_number=${encodeURIComponent(phoneNumber)}&skip_sentiment=true`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Erreur lors du chargement');
        }
        
        // 🆕 Mettre à jour le cache du tag client si disponible
        if (data.client_info && data.client_info.client_tag) {
            clientTagsCache[phoneNumber] = data.client_info.client_tag;
            console.log(`👑 Tag client récupéré: ${data.client_info.client_tag} pour ${maskPhoneNumber(phoneNumber)}`);
            
            // Mettre à jour le titre de la modal avec le badge
            const clientTag = data.client_info.client_tag;
            const clientTagBadge = getClientTagBadgeHtml(clientTag);
            const historiqueNomElement = document.getElementById('historiqueNomClient');
            const clientName = data.client_info.name || historiqueNomElement.textContent;
            
            if (clientTagBadge) {
                // Escape client name to prevent XSS when using innerHTML
                const escapedClientName = escapeHtml(clientName);
                historiqueNomElement.innerHTML = `${clientTagBadge}${escapedClientName}`;
            }
            
            // Mettre à jour tous les badges de tag pour ce client dans la liste des commandes
            setTimeout(() => {
                updateAllClientTagsForPhone(phoneNumber);
            }, 0);
        }
        
        // Afficher les données
        afficherHistoriqueClient(data);
        
        // Mettre à jour les indicateurs de note pour toutes les commandes de ce client
        // Différer pour ne pas bloquer la fermeture de la modal
        if (phoneNumber && data.orders_history && data.orders_history.length > 0) {
            // Chercher la première commande avec une note valide
            let rating = null;
            
            for (let i = 0; i < data.orders_history.length; i++) {
                const order = data.orders_history[i];
                if (order.ratings && order.ratings.average !== undefined && order.ratings.average !== null) {
                    rating = parseFloat(order.ratings.average);
                    if (!isNaN(rating)) {
                        break;
                    }
                }
            }
            
            // Fallback vers statistics si aucune note trouvée
            if (rating === null && data.statistics && data.statistics.avg_rating !== undefined) {
                rating = parseFloat(data.statistics.avg_rating);
            }
            
            // Afficher l'indicateur pour toutes les notes sauf note vide
            if (rating !== null && !isNaN(rating)) {
                setTimeout(() => {
                    // Trouver toutes les commandes avec ce numéro et ajouter l'indicateur
                    document.querySelectorAll('.btn-history-commande').forEach(btn => {
                        if (btn.getAttribute('data-phone') === phoneNumber) {
                            const commandeSummary = btn.closest('.commande-summary');
                            if (commandeSummary) {
                                const commandeId = commandeSummary.getAttribute('data-commande-id');
                                updateClientRatingIndicator(commandeId, phoneNumber);
                            }
                        }
                    });
                }, 0);
            }
        }
        
    } catch (error) {
        console.error('❌ Erreur chargement historique:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #dc3545;">
                <i class="fas fa-exclamation-triangle fa-3x"></i>
                <div style="margin-top: 15px; font-size: 1.1rem;">Erreur lors du chargement</div>
                <div style="margin-top: 10px; font-size: 0.9rem; color: #666;">${error.message}</div>
            </div>
        `;
    }
}

/**
 * Affiche les données d'historique dans la modal (version compacte pour tablette)
 */
function afficherHistoriqueClient(data) {
    const clientInfo = data.client_info || {};
    const commandes = data.orders_history || [];
    
    // Stocker la note moyenne dans le cache si un numéro de téléphone est disponible
    const clientPhone = clientInfo.phone_number || document.getElementById('historiqueTelClient').textContent;
    if (clientPhone && commandes.length > 0) {
        // Chercher la première commande avec une note valide (de la plus récente à la plus ancienne)
        let foundRating = false;
        for (let i = 0; i < commandes.length; i++) {
            const order = commandes[i];
            if (order.ratings && order.ratings.average !== undefined && order.ratings.average !== null) {
                const rating = parseFloat(order.ratings.average);
                if (!isNaN(rating)) {
                    clientRatingsCache[clientPhone] = rating;
                    console.log(`📊 Note moyenne mise en cache pour ${clientPhone}: ${rating}/10 (commande du ${order.date})`);
                    foundRating = true;
                    break;
                }
            }
        }
        
        // Fallback vers statistics si pas de ratings trouvés
        if (!foundRating && data.statistics && data.statistics.avg_rating !== undefined) {
            clientRatingsCache[clientPhone] = parseFloat(data.statistics.avg_rating);
            console.log(`📊 Note moyenne mise en cache pour ${clientPhone}: ${data.statistics.avg_rating}/10 (depuis statistics)`);
        }
    }
    
    // Mettre à jour les stats
    document.getElementById('histStatTotal').textContent = clientInfo.total_orders || 0;
    document.getElementById('histStatFirst').textContent = clientInfo.first_order ? clientInfo.first_order.split('-').reverse().join('/') : '-';
    document.getElementById('histStatLast').textContent = clientInfo.last_order ? clientInfo.last_order.split('-').reverse().join('/') : '-';
    
    const container = document.getElementById('historiqueCommandesContainer');
    
    if (commandes.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: #999;">
                <i class="fas fa-inbox fa-2x"></i>
                <div style="margin-top: 10px;">Aucune commande</div>
            </div>
        `;
        return;
    }
    
    // Afficher les commandes en format compact
    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
    
    commandes.forEach(commande => {
        const montantTotal = parseFloat(commande.montant) || 0;
        const montantColor = montantTotal > 50000 ? '#2E7D32' : montantTotal > 20000 ? '#F57C00' : '#666';
        
        const date = commande.date || '-';
        const pointVente = commande.point_vente || 'Point de vente';
        const destination = commande.destination || '';
        const livreur = commande.livreur || '';
        const commentaire = commande.commentaire || '';
        
        html += `
            <div style="background: white; border-left: 4px solid ${montantColor}; border-radius: 8px; padding: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <div style="flex: 1;">
                        <div style="font-size: 0.8rem; color: #999; margin-bottom: 3px;">
                            📅 ${date}
                        </div>
                        <div style="font-size: 1rem; font-weight: 600; color: #333;">
                            📍 ${pointVente}
                        </div>
                        ${destination ? `
                            <div style="font-size: 0.85rem; color: #666; margin-top: 3px;">
                                🎯 ${destination}
                            </div>
                        ` : ''}
                    </div>
                    <div style="text-align: right; margin-left: 10px;">
                        <div style="font-size: 1.2rem; font-weight: 700; color: ${montantColor}; white-space: nowrap;">
                            ${formatCurrency(montantTotal)}
                        </div>
                        ${livreur ? `
                            <div style="font-size: 0.75rem; color: #9C27B0; margin-top: 2px;">
                                🚚 ${livreur}
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                ${commentaire ? `
                    <div style="background: #f0f7ff; padding: 8px; border-radius: 4px; margin-top: 8px; border-left: 3px solid #2196F3;">
                        <div style="font-size: 0.8rem; color: #666;">
                            💬 ${commentaire}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Ferme la modal d'historique client
 */
function fermerHistoriqueClient() {
    const modal = document.getElementById('historiqueClientModal');
    if (modal) {
        modal.style.display = 'none';
        
        // Réactiver le scroll du body
        if (window.innerWidth <= 768) {
            document.body.style.overflow = '';
        }
    }
}

// ===== MODAL DETAILS COMMANDE =====

function fermerModalDetailsCommande() {
    document.getElementById('modalDetailsCommande').style.display = 'none';
}

// ===== IMPRESSION THERMIQUE =====

/**
 * Imprimer un ticket thermique pour une commande
 */
async function imprimerTicketThermique(commandeId) {
    // Fermer le modal de commande d'abord
    const modalCommande = document.getElementById('modalDetailsCommande');
    if (modalCommande) {
        modalCommande.style.display = 'none';
    }
    
    const commande = commandesData.get(commandeId);
    if (!commande) {
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Récupérer le statut de paiement
    let paymentStatus = 'A';
    let montantRestantDu = 0;
    try {
        const paymentData = await getCommandePaymentStatus(commandeId);
        paymentStatus = paymentData.posStatus || 'A';
        montantRestantDu = paymentData.montantRestantDu || 0;
    } catch (error) {
        console.warn('Impossible de récupérer le statut de paiement:', error);
    }
    
    // Get client info
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'] || '';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || '';
    const clientInstructions = firstItem.instructionsClient || firstItem['Client Instructions'] || '';
    
    // 🆕 Extraire les infos de crédit depuis le champ credit (nouvelle table commande_credits)
    const credit = firstItem.credit || null;
    const creditUsed = credit?.credit_used || 0;
    const creditStatus = credit?.credit_status || null;
    const amountPaidAfterCredit = credit?.amount_paid_after_credit || null;
    
    // Crédit valide si > 0 et status !== 'failed'
    const hasValidCredit = creditUsed > 0 && creditStatus !== 'failed';
    const finalAmount = hasValidCredit ? (amountPaidAfterCredit || (commande.totalAmount - creditUsed)) : commande.totalAmount;
    
    // Configuration du ticket (32 caractères de large pour imprimante 58mm)
    const LARGEUR = 32;
    const SEPARATEUR = '='.repeat(LARGEUR);
    const LIGNE = '-'.repeat(LARGEUR);
    
    // Fonction helper pour centrer le texte
    const centrer = (texte) => {
        const espaces = Math.max(0, Math.floor((LARGEUR - texte.length) / 2));
        return ' '.repeat(espaces) + texte;
    };
    
    // Fonction helper pour aligner à droite
    const alignerDroite = (texte) => {
        return ' '.repeat(Math.max(0, LARGEUR - texte.length)) + texte;
    };
    
    // Fonction pour formater une ligne produit (58mm = 32 car)
    const formatLigneProduit = (produit, qte, pu, total) => {
        // Pour 32 caractères : Produit(15) Qte(2) Total(15)
        // On simplifie pour 58mm : pas de prix unitaire
        let ligneProduit = produit.substring(0, 15).padEnd(15);
        // Quantité (2 char)
        ligneProduit += String(qte).padStart(2) + ' ';
        // Total (14 char)
        ligneProduit += String(total).padStart(14);
        return ligneProduit;
    };
    
    // Construction du ticket
    let ticket = '';
    
    // Get brand config (pass commandeId to detect brand)
    const config = typeof getBrandConfig === 'function' ? getBrandConfig(commandeId) : null;
    
    // En-tête
    ticket += SEPARATEUR + '\n';
    ticket += centrer(config ? config.nom_complet : '') + '\n';
    if (config && config.site_web) {
        ticket += centrer(config.site_web) + '\n';
    }
    // Ne rien afficher si site_web est vide
    ticket += '\n';
    
    // Téléphones - use config if available
    if (config && config.telephones && config.telephones.length > 0) {
        config.telephones.forEach(tel => {
            // Formater le numéro : enlever +221 et espaces, puis reformater
            let numero = tel.numero.replace(/\+221\s*/g, '').replace(/\s+/g, '');
            // Format: XX XXX XX XX (standard sénégalais)
            if (numero.length === 9) {
                numero = numero.substring(0, 2) + ' ' + numero.substring(2, 5) + ' ' + numero.substring(5, 7) + ' ' + numero.substring(7, 9);
            }
            const telLine = tel.point_vente ? `${tel.point_vente} ${numero}` : numero;
            ticket += centrer(telLine) + '\n';
        });
    } else {
        // Fallback
        ticket += centrer('O.Foire 78 480 95 95') + '\n';
        ticket += centrer('Mbao 77 858 96 96') + '\n';
        ticket += centrer('Keur Massar 78 777 26 26') + '\n';
    }
    ticket += SEPARATEUR + '\n';
    ticket += '\n';
    
    // Numéro de commande et date
    ticket += 'COMMANDE: ' + commandeId + '\n';
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    ticket += `DATE: ${dateStr} ${timeStr}\n`;
    ticket += '\n';
    
    // Informations client (si présentes)
    if (clientName || clientPhone || clientAddress || clientInstructions) {
        ticket += LIGNE + '\n';
        ticket += 'INFORMATIONS CLIENT\n';
        ticket += LIGNE + '\n';
        if (clientName) ticket += 'Nom: ' + clientName + '\n';
        if (clientPhone) ticket += 'Tel: ' + clientPhone + '\n';
        if (clientAddress) ticket += 'Adresse: ' + clientAddress + '\n';
        if (clientInstructions) {
            ticket += LIGNE + '\n';
            ticket += '*** INSTRUCTIONS ***\n';
            ticket += clientInstructions + '\n';
        }
        ticket += '\n';
    }
    
    // Articles
    ticket += LIGNE + '\n';
    ticket += 'ARTICLES\n';
    ticket += LIGNE + '\n';
    ticket += formatLigneProduit('Produit', 'Qte', '', 'Total') + '\n';
    ticket += LIGNE + '\n';
    
    commande.items.forEach(item => {
        const nombre = item.Nombre || item.nombre || 1;
        const produit = item.Produit || item.produit || 'Produit';
        const prixUnit = item.PU || item.prixUnit || 0;
        const montant = item.Montant || item.montant || 0;
        
        ticket += formatLigneProduit(
            produit,
            nombre,
            '', // Pas de PU pour 58mm
            formatCurrency(montant)
        ) + '\n';
    });
    
    // Total (avec crédit si applicable)
    ticket += '\n';
    ticket += SEPARATEUR + '\n';
    
    if (hasValidCredit) {
        // Afficher sous-total, crédit et montant à payer
        const soustotalStr = 'Sous-total' + formatCurrency(commande.totalAmount).padStart(LARGEUR - 10);
        ticket += soustotalStr + '\n';
        
        const creditStr = 'Credit' + ('-' + formatCurrency(creditUsed)).padStart(LARGEUR - 6);
        ticket += creditStr + '\n';
        
        ticket += LIGNE + '\n';
        
        const apayerStr = 'A PAYER' + formatCurrency(finalAmount).padStart(LARGEUR - 7);
        ticket += apayerStr + '\n';
    } else {
        // Afficher seulement le total
        const totalStr = 'TOTAL' + formatCurrency(commande.totalAmount).padStart(LARGEUR - 5);
        ticket += totalStr + '\n';
    }
    
    ticket += SEPARATEUR + '\n';
    ticket += '\n';
    
    // Statut de paiement (si payé ou créance)
    if (paymentStatus === 'P') {
        ticket += centrer('*** PAYE ***') + '\n';
        ticket += '\n';
    } else if (paymentStatus === 'M') {
        ticket += centrer('*** PAYE (CASH/MANUEL) ***') + '\n';
        ticket += '\n';
    } else if (paymentStatus === 'C') {
        const dejaPaye = commande.totalAmount - montantRestantDu;
        ticket += centrer('*** CREANCE ***') + '\n';
        ticket += centrer(`Montant du: ${formatCurrency(montantRestantDu)}`) + '\n';
        ticket += centrer(`Deja paye: ${formatCurrency(dejaPaye)}`) + '\n';
        ticket += '\n';
    }
    
    
    // Footer - use config if available
    if (config && config.footer_facture) {
        ticket += centrer(config.footer_facture) + '\n';
    } else {
        ticket += centrer('Merci de votre confiance!') + '\n';
    }
    if (config && config.slogan) {
        ticket += centrer(config.slogan) + '\n';
    } else {
        ticket += centrer('Bon appetit!') + '\n';
    }
    ticket += SEPARATEUR;
    // No trailing newlines to minimize bottom whitespace
    
    // 🖨️ Create ESC/POS version for thermal printers (with QR code)
    // This version contains control bytes and should ONLY be used for RawBT/USB/Bluetooth printing
    let ticketEscPos = ticket; // Start with the clean text version
    
    
    // Store both versions globally for use by share functions
    window.currentTicketText = ticket;      // Human-readable for WhatsApp/SMS/Email/preview
    window.currentTicketEscPos = ticketEscPos; // With ESC/POS codes for thermal printers
    window.currentCommandeId = commandeId;
    
    // Partage direct via navigator.share (plus rapide)
    if (navigator.share) {
        navigator.share({
            title: `Ticket - ${commandeId}`,
            text: ticket
        }).then(() => {
            console.log('Ticket partagé avec succès');
        }).catch((error) => {
            // Si annulé ou erreur, ouvrir le modal avec options
            console.log('Partage annulé, ouverture modal:', error);
            ouvrirModalPartageTicket(ticket, commandeId);
        });
    } else {
        // Desktop ou navigateur sans support : ouvrir le modal
        ouvrirModalPartageTicket(ticket, commandeId);
    }
}

/**
 * Ouvre un modal de partage avec plusieurs options
 */
function ouvrirModalPartageTicket(ticket, commandeId) {
    // Encoder le ticket TEXTE SEULEMENT (sans ESC/POS) pour les URLs
    const ticketEncoded = encodeURIComponent(ticket);
    
    // Encoder la version ESC/POS séparément pour l'impression
    const ticketEscPosEncoded = encodeURIComponent(window.currentTicketEscPos || ticket);
    
    // Créer le modal avec aperçu
    const modalHTML = `
        <div id="modalPartageTicket" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        ">
            <div style="
                background: white;
                border-radius: 12px;
                padding: 25px;
                max-width: 600px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
            ">
                <h2 style="margin-top: 0; color: #333;">📤 Partager le ticket</h2>
                <p style="color: #666; margin-bottom: 15px;">Commande: ${commandeId}</p>
                
                <!-- Aperçu du ticket -->
                <div style="
                    background: #f5f5f5;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 20px;
                    max-height: 200px;
                    overflow-y: auto;
                    font-family: 'Courier New', monospace;
                    font-size: 11px;
                    white-space: pre;
                    line-height: 1.4;
                ">${ticket}</div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <!-- WhatsApp -->
                    <button onclick="partagerWhatsApp('${ticketEncoded}')" style="
                        padding: 12px;
                        background: #25D366;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">💬</span>
                        WhatsApp
                    </button>
                    
                    <!-- RawBT Printer (Samsung A9) - utilise currentTicketEscPos (QR code) via variable globale -->
                    <button onclick="partagerRawBT()" style="
                        padding: 12px;
                        background: #FF6B35;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">🖨️</span>
                        RawBT
                    </button>
                    
                    <!-- Email -->
                    <button onclick="partagerEmail('${ticketEncoded}', '${commandeId}')" style="
                        padding: 12px;
                        background: #EA4335;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">📧</span>
                        Email
                    </button>
                    
                    <!-- SMS -->
                    <button onclick="partagerSMS('${ticketEncoded}')" style="
                        padding: 12px;
                        background: #34B7F1;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">💬</span>
                        SMS
                    </button>
                    
                    <!-- Copier -->
                    <button onclick="copierTicket(\`${ticket.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" style="
                        padding: 12px;
                        background: #5865F2;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">📋</span>
                        Copier
                    </button>
                    
                    <!-- Imprimer -->
                    <button onclick="fermerModalPartage(); imprimerTicketClassique(\`${ticket.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, '${commandeId}')" style="
                        padding: 12px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">🖨️</span>
                        Imprimer
                    </button>
                </div>
                
                <button onclick="fermerModalPartage()" style="
                    margin-top: 15px;
                    padding: 10px;
                    background: #666;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    width: 100%;
                    font-size: 14px;
                ">
                    Annuler
                </button>
            </div>
        </div>
    `;
    
    // Ajouter le modal au body
    const modalDiv = document.createElement('div');
    modalDiv.innerHTML = modalHTML;
    document.body.appendChild(modalDiv.firstElementChild);
}

/**
 * Partager via WhatsApp
 */
function partagerWhatsApp(ticketEncoded) {
    const text = decodeURIComponent(ticketEncoded);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    fermerModalPartage();
}

/**
 * Partager via RawBT (imprimante Bluetooth Samsung A9)
 * Sans argument : utilise window.currentTicketEscPos (version ESC/POS avec QR code)
 */
async function partagerRawBT(ticketEncoded) {
    const text = ticketEncoded != null
        ? decodeURIComponent(ticketEncoded)
        : (window.currentTicketEscPos || '');
    
    // Utiliser navigator.share pour que RawBT apparaisse dans les options
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Ticket',
                text: text
            });
            fermerModalPartage();
        } catch (error) {
            console.log('Partage annulé ou erreur:', error);
            // Si l'utilisateur annule, on ne fait rien
        }
    } else {
        // Fallback : copier dans le presse-papier
        try {
            await navigator.clipboard.writeText(text);
            showToast('Ticket copié ! Ouvrez RawBT manuellement.', 'info');
            fermerModalPartage();
        } catch (error) {
            showToast('Impossible de partager. Utilisez le bouton Copier.', 'error');
        }
    }
}

/**
 * Partager via Email
 */
function partagerEmail(ticketEncoded, commandeId) {
    const text = decodeURIComponent(ticketEncoded);
    const subject = `Ticket - ${commandeId}`;
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    window.location.href = url;
    fermerModalPartage();
}

/**
 * Partager via SMS
 */
function partagerSMS(ticketEncoded) {
    const text = decodeURIComponent(ticketEncoded);
    const url = `sms:?body=${encodeURIComponent(text)}`;
    window.location.href = url;
    fermerModalPartage();
}

/**
 * Copier le ticket dans le presse-papier
 */
async function copierTicket(ticket) {
    try {
        await navigator.clipboard.writeText(ticket);
        showToast('Ticket copié dans le presse-papier !', 'success');
        fermerModalPartage();
    } catch (error) {
        console.error('Erreur copie:', error);
        showToast('Erreur lors de la copie', 'error');
    }
}

/**
 * Partage natif (fallback vers le menu système)
 */
async function partagerNatif(ticketEncoded, commandeId) {
    const text = decodeURIComponent(ticketEncoded);
    try {
        await navigator.share({
            title: `Ticket - ${commandeId}`,
            text: text
        });
        fermerModalPartage();
    } catch (error) {
        console.log('Partage annulé ou erreur:', error);
    }
}

/**
 * Fermer le modal de partage
 */
function fermerModalPartage() {
    const modal = document.getElementById('modalPartageTicket');
    if (modal) {
        modal.remove();
    }
}

/**
 * Impression classique via fenêtre popup (fallback desktop)
 */
function imprimerTicketClassique(ticket, commandeId) {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
        showToast('Impossible d\'ouvrir la fenêtre d\'impression. Vérifiez les popups bloqués.', 'error');
        return;
    }
    
    // Get the ESC/POS version for USB/Bluetooth printing
    const ticketEscPos = window.currentTicketEscPos || ticket;
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ticket - ${commandeId}</title>
            <meta charset="utf-8">
            <style>
                body {
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    margin: 0;
                    padding: 10px;
                    white-space: pre;
                    line-height: 1.3;
                }
                @media print {
                    @page {
                        margin: 0;
                        size: auto;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                    }
                    html {
                        margin: 0;
                        padding: 0;
                    }
                    .no-print {
                        display: none;
                    }
                }
                .no-print {
                    margin-top: 20px;
                    text-align: center;
                }
                .no-print button {
                    padding: 10px 20px;
                    font-size: 14px;
                    cursor: pointer;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    margin: 5px;
                }
                .no-print button:hover {
                    background: #45a049;
                }
                .no-print button.secondary {
                    background: #666;
                }
                .no-print button.usb {
                    background: #2196F3;
                }
                .no-print button.bluetooth {
                    background: #9C27B0;
                }
            </style>
        </head>
        <body>${ticket}<div class="no-print">
                <button onclick="window.print()">🖨️ Imprimer</button>
                <button class="usb" onclick="imprimerUSB()">🔌 Imprimante USB</button>
                <button class="bluetooth" onclick="imprimerBluetooth()">📡 Bluetooth</button>
                <button class="secondary" onclick="window.close()">Fermer</button>
            </div>
            <script>
                // Store ESC/POS version for thermal printers
                const ticketEscPosData = ${JSON.stringify(ticketEscPos)};
                
                // Fonction pour imprimer via USB
                async function imprimerUSB() {
                    try {
                        if (!navigator.usb) {
                            alert('WebUSB n\\'est pas supporté par votre navigateur. Utilisez Chrome ou Edge.');
                            return;
                        }
                        
                        // Demander l'accès à un périphérique USB
                        const device = await navigator.usb.requestDevice({ filters: [] });
                        alert('Périphérique USB sélectionné: ' + device.productName);
                        
                        // Ouvrir la connexion
                        await device.open();
                        await device.selectConfiguration(1);
                        await device.claimInterface(0);
                        
                        // Use ESC/POS version with QR codes for thermal printers
                        const encoder = new TextEncoder();
                        const data = encoder.encode(ticketEscPosData + '\\n\\n\\n\\n');
                        
                        // Envoyer les données à l'imprimante
                        await device.transferOut(1, data);
                        
                        // Fermer la connexion
                        await device.close();
                        
                        alert('Impression USB réussie!');
                        window.close();
                    } catch (error) {
                        console.error('Erreur USB:', error);
                        alert('Erreur d\\'impression USB: ' + error.message);
                    }
                }
                
                // Fonction pour imprimer via Bluetooth
                async function imprimerBluetooth() {
                    try {
                        if (!navigator.bluetooth) {
                            alert('Bluetooth n\\'est pas supporté par votre navigateur. Utilisez Chrome ou Edge.');
                            return;
                        }
                        
                        // Rechercher un périphérique Bluetooth
                        const device = await navigator.bluetooth.requestDevice({
                            acceptAllDevices: true,
                            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
                        });
                        
                        alert('Périphérique Bluetooth sélectionné: ' + device.name);
                        
                        // Se connecter au périphérique
                        const server = await device.gatt.connect();
                        
                        // Récupérer le service d'impression
                        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
                        const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
                        
                        // Use ESC/POS version with QR codes for thermal printers
                        const encoder = new TextEncoder();
                        const data = encoder.encode(ticketEscPosData + '\\n\\n\\n\\n');
                        
                        await characteristic.writeValue(data);
                        
                        alert('Impression Bluetooth réussie!');
                        window.close();
                    } catch (error) {
                        console.error('Erreur Bluetooth:', error);
                        alert('Erreur d\\'impression Bluetooth: ' + error.message + '\\n\\nVérifiez que l\\'imprimante est allumée et appairée.');
                    }
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * Lister les périphériques USB disponibles
 */
async function listerPeripheriquesUSB() {
    if (!navigator.usb) {
        showToast('WebUSB n\'est pas supporté. Utilisez Chrome ou Edge.', 'error');
        return [];
    }
    
    try {
        const devices = await navigator.usb.getDevices();
        console.log('📱 Périphériques USB trouvés:', devices);
        
        devices.forEach((device, index) => {
            console.log(`  ${index + 1}. ${device.productName || 'Périphérique inconnu'}`);
            console.log(`     Fabricant: ${device.manufacturerName || 'N/A'}`);
            console.log(`     Vendor ID: ${device.vendorId}, Product ID: ${device.productId}`);
        });
        
        return devices;
    } catch (error) {
        console.error('Erreur lors de la liste des périphériques USB:', error);
        return [];
    }
}

/**
 * Lister les périphériques Bluetooth disponibles
 */
async function listerPeripheriquesBluetooth() {
    if (!navigator.bluetooth) {
        showToast('Bluetooth n\'est pas supporté. Utilisez Chrome ou Edge.', 'error');
        return [];
    }
    
    try {
        // Note: Bluetooth nécessite une interaction utilisateur
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
        });
        
        console.log('📡 Périphérique Bluetooth sélectionné:', device.name);
        return [device];
    } catch (error) {
        console.error('Erreur lors de la recherche Bluetooth:', error);
        return [];
    }
}

// ===== MODAL TOTAUX DU JOUR =====

/**
 * Toggle POS header visibility
 */
function togglePosHeader() {
    const container = document.querySelector('.pos-container');
    const icon = document.getElementById('headerToggleIcon');
    const revealTab = document.getElementById('headerRevealTab');
    if (!container) return;

    const isHidden = container.classList.toggle('header-hidden');
    document.body.classList.toggle('header-hidden-state', isHidden);

    if (icon) {
        icon.classList.toggle('fa-chevron-up', !isHidden);
        icon.classList.toggle('fa-chevron-down', isHidden);
    }
    if (revealTab) {
        revealTab.style.display = isHidden ? 'block' : 'none';
    }

    localStorage.setItem('pos_header_hidden', isHidden ? '1' : '0');
}

// Restore header state on load
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('pos_header_hidden') === '1') {
        const container = document.querySelector('.pos-container');
        const icon = document.getElementById('headerToggleIcon');
        const revealTab = document.getElementById('headerRevealTab');
        if (container) {
            container.classList.add('header-hidden');
            document.body.classList.add('header-hidden-state');
        }
        if (icon) {
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
        }
        if (revealTab) revealTab.style.display = 'block';
    }
});

/**
 * Toggle Admin Menu Dropdown
 */
function toggleAdminMenu() {
    const dropdown = document.getElementById('adminMenuDropdown');
    if (!dropdown) {
        return; // Element not found, exit gracefully
    }
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
}

// Fermer le menu admin si on clique ailleurs
document.addEventListener('click', function(event) {
    const adminMenuContainer = document.querySelector('.admin-menu-container');
    const dropdown = document.getElementById('adminMenuDropdown');
    
    if (adminMenuContainer && !adminMenuContainer.contains(event.target)) {
        if (dropdown) {
            dropdown.style.display = 'none';
        }
    }
});

/**
 * Ouvre le modal des totaux du jour
 */
async function ouvrirTotauxDuJour() {
    const modal = document.getElementById('totauxDuJourModal');
    const dateInput = document.getElementById('totauxDateInput');
    
    // Show modal
    modal.style.display = 'flex';
    
    // Set date to today if not already set
    if (!dateInput.value) {
        const today = new Date();
        dateInput.value = today.toISOString().split('T')[0]; // Format YYYY-MM-DD
    }
    
    // Load totaux for the selected date
    await chargerTotauxDate();
}

// Nouvelle fonction pour charger les totaux pour une date spécifique
async function chargerTotauxDate() {
    const content = document.getElementById('totauxContent');
    const dateInput = document.getElementById('totauxDateInput');
    const pointVenteSelect = document.getElementById('pointVenteSelect');
    
    if (!dateInput.value) {
        showToast('Veuillez sélectionner une date', 'warning');
        return;
    }
    
    // Show loading
    content.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #999;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem;"></i>
            <p style="margin-top: 12px;">Chargement des totaux...</p>
        </div>
    `;
    
    // Convert YYYY-MM-DD to DD-MM-YYYY for the aggregated API
    const [year, month, day] = dateInput.value.split('-');
    const dateFormatted = `${day}-${month}-${year}`;
    const dateFormattedYYYYMMDD = dateInput.value;
    const pointVente = pointVenteSelect.value;
    
    // Update display
    document.getElementById('totauxPointVente').textContent = pointVente || 'Tous les points de vente';
    
    try {
        // Call aggregated API (uses DD-MM-YYYY format)
        const response = await fetch(`/api/external/ventes-date/aggregated?start_date=${dateFormatted}&end_date=${dateFormatted}${pointVente ? '&pointVente=' + encodeURIComponent(pointVente) : ''}`, {
            credentials: 'include',
            headers: {
                'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4'
            }
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors de la récupération des données');
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Erreur inconnue');
        }
        
        // Also call pack API to get pack composition (uses YYYY-MM-DD format)
        let packData = null;
        try {
            console.log(`🔍 Appel API pack avec dates: ${dateFormattedYYYYMMDD}`);
            const packResponse = await fetch(`/api/external/ventes-date/pack/aggregated?start_date=${dateFormattedYYYYMMDD}&end_date=${dateFormattedYYYYMMDD}${pointVente ? '&pointVente=' + encodeURIComponent(pointVente) : ''}`, {
                credentials: 'include',
                headers: {
                    'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4'
                }
            });
            
            if (packResponse.ok) {
                packData = await packResponse.json();
                console.log('✅ Pack data reçue:', packData);
            } else {
                const errorText = await packResponse.text();
                console.error('❌ Erreur pack API:', packResponse.status, errorText);
            }
        } catch (packError) {
            console.error('❌ Erreur lors de l\'appel pack API:', packError);
        }
        
        // Display data
        afficherTotauxDuJour(data, packData);
        
    } catch (error) {
        console.error('❌ Erreur:', error);
        content.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #dc3545;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem;"></i>
                <p style="margin-top: 12px; font-size: 1.1rem;">Erreur lors du chargement</p>
                <p style="margin-top: 8px; font-size: 0.9rem; color: #666;">${error.message}</p>
            </div>
        `;
    }
}

/**
 * Affiche les totaux du jour dans le modal
 */
async function afficherTotauxDuJour(data, packData) {
    const content = document.getElementById('totauxContent');
    const nombreVentesSpan = document.getElementById('totauxNombreVentes');
    
    if (!data.aggregations || data.aggregations.length === 0) {
        content.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #999;">
                <i class="fas fa-inbox" style="font-size: 2rem;"></i>
                <p style="margin-top: 12px;">Aucune vente pour cette période</p>
            </div>
        `;
        nombreVentesSpan.textContent = '0';
        return;
    }
    
    // Get first point de vente (or combine all if multiple)
    const pdvData = data.aggregations[0];
    const categories = pdvData.categories || [];
    
    // Get pack composition from compositionAgregee (total for ALL packs sold)
    let compositionAgregee = {};
    if (packData && packData.success && packData.pointsVente) {
        const pointVenteName = Object.keys(packData.pointsVente)[0];
        if (pointVenteName) {
            compositionAgregee = packData.pointsVente[pointVenteName].compositionAgregee || {};
            console.log('📦 Pack Data:', packData.pointsVente[pointVenteName]);
            console.log('📦 Composition Agrégée:', compositionAgregee);
        }
    } else {
        console.warn('⚠️ Pas de données pack disponibles');
    }
    
    nombreVentesSpan.textContent = data.metadata.nombreVentesTotales || 0;
    
    // Define fixed category order
    const categoryOrder = ['BOVIN', 'OVIN', 'VOLAILLE', 'PACK'];
    
    // Sort categories by fixed order
    const sortedCategories = categories.sort((a, b) => {
        const aIndex = categoryOrder.findIndex(cat => a.categorie.toUpperCase().includes(cat));
        const bIndex = categoryOrder.findIndex(cat => b.categorie.toUpperCase().includes(cat));
        
        // If not found, put at the end
        const aOrder = aIndex === -1 ? 999 : aIndex;
        const bOrder = bIndex === -1 ? 999 : bIndex;
        
        return aOrder - bOrder;
    });
    
    let html = '';
    
    for (const category of sortedCategories) {
        const categoryIcon = getCategoryIcon(category.categorie);
        const products = category.produits || [];
        const isPack = category.categorie.toLowerCase().includes('pack');
        
        html += `
            <div class="totaux-category">
                <div class="totaux-category-header">
                    <div class="totaux-category-title">
                        ${categoryIcon} ${category.categorie.toUpperCase()}
                    </div>
                    <div class="totaux-category-total">
                        ${isPack ? formatPackQuantity(category.totalNombre) : formatQuantity(category.totalNombre)}
                    </div>
                </div>
                <div class="totaux-products-list">
        `;
        
        // Display products
        for (const product of products) {
            html += `
                <div class="totaux-product-line">
                    <div class="totaux-product-name">
                        ${product.produit}${isPack ? ` (x${product.nombreVentes})` : ''}
                    </div>
                    <div class="totaux-product-dots"></div>
                    <div class="totaux-product-quantity">
                        ${isPack ? formatPackQuantity(product.totalNombre) : formatQuantity(product.totalNombre)}
                    </div>
                </div>
            `;
        }
        
        // Show TOTAL composition for ALL packs (including modified compositions)
        if (isPack && Object.keys(compositionAgregee).length > 0) {
            const compositionItems = Object.entries(compositionAgregee)
                .map(([produit, data]) => {
                    // Format with proper decimals
                    const qty = parseFloat(data.quantite || 0);
                    const formattedQty = qty % 1 === 0 ? qty : qty.toFixed(1);
                    return `${formattedQty}${data.unite} ${produit}`;
                })
                .join(', ');
            
            html += `
                <div class="totaux-pack-composition" style="margin-top: 12px;">
                    ${compositionItems}
                </div>
            `;
        } else if (isPack) {
            console.warn('⚠️ Aucune composition agrégée trouvée pour les packs');
        }
        
        html += `
                </div>
            </div>
        `;
    }
    
    // Add summary
    html += `
        <div class="totaux-summary">
            <div class="totaux-summary-item">
                <div class="totaux-summary-label">Chiffre d'Affaires</div>
                <div class="totaux-summary-value">${formatCurrency(pdvData.totalPointVente)}</div>
            </div>
        </div>
    `;
    
    content.innerHTML = html;
}

/**
 * Get icon for category
 */
function getCategoryIcon(category) {
    const icons = {
        'bovin': '🥩',
        'ovin': '🐑',
        'caprin': '🐐',
        'volaille': '🐔',
        'pack': '📦',
        'oeuf': '🥚',
        'poisson': '🐟',
        'divers': '📋'
    };
    
    const categoryLower = category.toLowerCase();
    for (const [key, icon] of Object.entries(icons)) {
        if (categoryLower.includes(key)) {
            return icon;
        }
    }
    return '📦';
}

/**
 * Get pack composition description
 */
function getPackComposition(packName) {
    // This should match the pack definitions in the system
    // For now, return a generic message
    return 'Voir composition détaillée dans la gestion des packs';
}

/**
 * Format quantity with unit
 */
function formatQuantity(quantity) {
    const num = parseFloat(quantity) || 0;
    if (num === Math.floor(num)) {
        return `${num} kg`;
    }
    return `${num.toFixed(2)} kg`;
}

/**
 * Format pack quantity (in pieces, not kg)
 */
function formatPackQuantity(quantity) {
    const num = parseFloat(quantity) || 0;
    const pcs = Math.floor(num);
    return pcs === 1 ? `${pcs} pc` : `${pcs} pcs`;
}

/**
 * Close totaux modal
 */
function fermerTotauxDuJour() {
    document.getElementById('totauxDuJourModal').style.display = 'none';
}

/**
 * Print totaux
 */
function imprimerTotaux() {
    window.print();
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    // ESC to close modal
    if (e.key === 'Escape') {
        fermerModalPaiement();
    }
    
    // Enter in received amount input to confirm
    if (e.key === 'Enter' && document.getElementById('receivedAmount') === document.activeElement) {
        confirmerPaiement();
    }
});

// ===== Filtrage par statut de paiement =====

/**
 * Filtre actuel pour les statuts de paiement
 */
let currentPaymentStatusFilter = 'all';
let currentClientRatingFilter = 'all';

/**
 * Filtrer les transactions par statut de paiement
 * @param {string} status - Le statut à filtrer ('all', 'P', 'O', 'E', 'M', 'A')
 */
async function filterByPaymentStatus(status) {
    console.log(`🔍 Filtrage par statut: ${status}`);
    
    currentPaymentStatusFilter = status;
    
    // Mettre à jour les boutons actifs
    document.querySelectorAll('#paymentStatusFilters .psf-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`#paymentStatusFilters .psf-btn[data-status="${status}"]`)?.classList.add('active');
    
    // Appliquer les filtres combinés
    await applyCombinedFilters();
}

/**
 * Filtrer les transactions par satisfaction client
 * @param {string} ratingType - Le type de satisfaction ('all', 'excellent', 'very-satisfied', 'satisfied', 'unsatisfied', 'very-unsatisfied')
 */
async function filterByClientRating(ratingType) {
    console.log(`😊 Filtrage par satisfaction: ${ratingType}`);
    
    currentClientRatingFilter = ratingType;
    
    // Mettre à jour les boutons actifs
    document.querySelectorAll('.client-rating-filters .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.client-rating-filters .filter-btn[data-rating="${ratingType}"]`)?.classList.add('active');
    
    // Appliquer les filtres combinés
    await applyCombinedFilters();
}

/**
 * Appliquer les filtres combinés (statut de paiement + satisfaction client)
 */
async function applyCombinedFilters() {
    const allCommandes = document.querySelectorAll('.transaction-item.transaction-commande');
    console.log(`📦 Application des filtres combinés sur ${allCommandes.length} commandes`);
    console.log(`🔍 Filtre paiement actif: ${currentPaymentStatusFilter}`);
    console.log(`😊 Filtre satisfaction actif: ${currentClientRatingFilter}`);
    
    let visibleCount = 0;
    let totalSum = 0; // Somme des commandes visibles
    
    for (const commandeItem of allCommandes) {
        let shouldShow = true;
        
        // Filtre 1: Statut de paiement
        if (currentPaymentStatusFilter !== 'all') {
            const commandeSummary = commandeItem.querySelector('.commande-summary');
            const commandeId = commandeSummary?.dataset.commandeId;
            
            if (commandeId) {
                const statusBadge = commandeItem.querySelector('.payment-status-badge');
                let currentStatus = 'A'; // Par défaut
                
                if (statusBadge) {
                    // Utiliser data-status pour une détection fiable
                    currentStatus = statusBadge.dataset.status || 'A';
                }
                
                if (currentStatus !== currentPaymentStatusFilter) {
                    shouldShow = false;
                }
            }
        }
        
        // Filtre 2: Satisfaction client
        if (shouldShow && currentClientRatingFilter !== 'all') {
            const commandeSummary = commandeItem.querySelector('.commande-summary');
            const clientPhone = commandeSummary?.dataset.clientPhone;
            
            if (!clientPhone) {
                // Pas de téléphone = pas de note = masquer si filtre actif
                console.log(`⚠️ Commande sans téléphone masquée`);
                shouldShow = false;
            } else {
                // Récupérer la note du cache
                const rating = clientRatingsCache[clientPhone];
                console.log(`📱 Client ${clientPhone} - Note: ${rating} - Filtre: ${currentClientRatingFilter}`);
                
                if (rating === null || rating === undefined || isNaN(rating)) {
                    // Pas de note disponible
                    console.log(`⚠️ Pas de note disponible pour ${clientPhone}`);
                    shouldShow = false;
                } else {
                    // Vérifier si la note correspond au filtre
                    let matchesFilter = false;
                    
                    switch (currentClientRatingFilter) {
                        case 'excellent':
                            matchesFilter = rating > 9;
                            break;
                        case 'very-satisfied':
                            matchesFilter = rating > 8 && rating <= 9;
                            break;
                        case 'satisfied':
                            matchesFilter = rating > 7 && rating <= 8;
                            break;
                        case 'unsatisfied':
                            matchesFilter = rating > 6 && rating <= 7;
                            break;
                        case 'very-unsatisfied':
                            matchesFilter = rating <= 6;
                            break;
                    }
                    
                    if (!matchesFilter) {
                        console.log(`❌ Note ${rating} ne correspond pas au filtre ${currentClientRatingFilter}`);
                        shouldShow = false;
                    } else {
                        console.log(`✅ Note ${rating} correspond au filtre ${currentClientRatingFilter}`);
                    }
                }
            }
        }
        
        // Afficher ou masquer la commande
        commandeItem.style.display = shouldShow ? '' : 'none';
        
        if (shouldShow) {
            visibleCount++;
            
            // Calculer la somme des commandes visibles
            // Le montant total est dans .commande-total-line dans le format "Total: 12 400 FCFA"
            const totalLine = commandeItem.querySelector('.commande-total-line');
            if (totalLine) {
                const totalText = totalLine.textContent || '';
                // Extraire le montant (enlever "Total:", espaces, et "FCFA")
                const montantMatch = totalText.replace(/Total:/gi, '').replace(/FCFA/gi, '').replace(/\s/g, '').replace(/\u202F/g, '');
                const totalAmount = parseFloat(montantMatch) || 0;
                totalSum += totalAmount;
                
                console.log(` [applyCombinedFilters] Commande: ${totalAmount} FCFA (extrait de: "${totalText}")`);
            } else {
                console.warn('⚠️ [applyCombinedFilters] .commande-total-line non trouvé');
            }
        }
    }
    
    console.log(`📊 ${visibleCount} commande(s) affichée(s) après filtres combinés`);
    console.log(` Somme totale: ${totalSum} FCFA`);
    
    // Mettre à jour l'affichage de la somme filtrée
    updateFilteredOrdersSum(totalSum, visibleCount);
    
    // Mettre à jour les compteurs
    updateClientRatingFilterCounts();
    
    // Supprimer l'ancien message "aucun résultat" s'il existe
    document.querySelector('.no-filter-result')?.remove();
    
    if (visibleCount === 0) {
        const container = document.getElementById('transactionsList');
        const noResult = document.createElement('div');
        noResult.className = 'no-filter-result';
        noResult.style.cssText = 'text-align:center;color:#999;padding:2rem;';
        noResult.innerHTML = `
            <i class="fas fa-filter" style="font-size:3rem;margin-bottom:1rem;"></i>
            <p>Aucune commande ne correspond aux filtres sélectionnés</p>
        `;
        container.appendChild(noResult);
    }
}

/**
 * Mettre à jour l'affichage de la somme des commandes filtrées
 */
function updateFilteredOrdersSum(totalSum, visibleCount) {
    // Masquer la bannière (on n'en a plus besoin)
    const sumContainer = document.getElementById('filteredOrdersSum');
    if (sumContainer) {
        sumContainer.style.display = 'none';
    }
    
    // Afficher le total directement dans le bouton filtre actif
    if (currentPaymentStatusFilter === 'all') {
        return; // Pas de mise à jour pour "Tous"
    }
    
    // Trouver le bouton actif
    const activeButton = document.querySelector(`.payment-status-filters .filter-btn[data-status="${currentPaymentStatusFilter}"]`);
    if (!activeButton) return;
    
    // Formater le total
    const formattedTotal = new Intl.NumberFormat('fr-FR').format(totalSum);
    
    // Trouver le span filter-count dans ce bouton
    const countSpan = activeButton.querySelector('.filter-count');
    if (countSpan) {
        // Mettre à jour avec : (nombre) : montant FCFA
        countSpan.innerHTML = `(${visibleCount}) : <span style="color: #000; font-weight: 700;">${formattedTotal} FCFA</span>`;
    }
}

/**
 * Mettre à jour les compteurs des filtres de satisfaction client
 */
function updateClientRatingFilterCounts() {
    const allCommandes = document.querySelectorAll('.transaction-item.transaction-commande');
    
    let counts = {
        all: 0,
        excellent: 0,
        'very-satisfied': 0,
        satisfied: 0,
        unsatisfied: 0,
        'very-unsatisfied': 0
    };
    
    allCommandes.forEach(commandeItem => {
        const commandeSummary = commandeItem.querySelector('.commande-summary');
        const clientPhone = commandeSummary?.dataset.clientPhone;
        
        if (clientPhone) {
            counts.all++;
            
            const rating = clientRatingsCache[clientPhone];
            
            if (rating !== null && rating !== undefined && !isNaN(rating)) {
                if (rating > 9) counts.excellent++;
                else if (rating > 8 && rating <= 9) counts['very-satisfied']++;
                else if (rating > 7 && rating <= 8) counts.satisfied++;
                else if (rating > 6 && rating <= 7) counts.unsatisfied++;
                else if (rating <= 6) counts['very-unsatisfied']++;
            }
        }
    });
    
    // Mettre à jour l'affichage des compteurs (les éléments peuvent ne pas exister selon la vue)
    const countMap = {
        'countRatingAll': counts.all,
        'countRatingExcellent': counts.excellent,
        'countRatingVerySatisfied': counts['very-satisfied'],
        'countRatingSatisfied': counts.satisfied,
        'countRatingUnsatisfied': counts.unsatisfied,
        'countRatingVeryUnsatisfied': counts['very-unsatisfied']
    };
    Object.entries(countMap).forEach(([id, count]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = count > 0 ? `(${count})` : '';
    });
}

/**
 * 📥 Exporter toutes les commandes en CSV
 * Disponible uniquement pour Superviseur et Superutilisateur
 */
async function exportCommandesToCSV() {
    try {
        console.log('📥 Début de l\'export CSV...');
        
        // Récupérer la date et le point de vente actuels
        const dateInput = document.getElementById('summaryDate');
        const pointVenteSelect = document.getElementById('pointVenteSelect');
        const selectedDate = dateInput?.value;
        const selectedPointVente = pointVenteSelect?.value;
        
        if (!selectedDate || !selectedPointVente) {
            showToast('⚠️ Veuillez sélectionner une date et un point de vente', 'error');
            return;
        }
        
        // Afficher un message de préparation
        showToast('⏳ Préparation de l\'export CSV...', 'info');
        
        // Récupérer TOUTES les commandes depuis commandesData
        if (!commandesData || commandesData.size === 0) {
            showToast('⚠️ Aucune commande à exporter', 'warning');
            return;
        }
        
        // Fetch ALL payment links once with authentication
        let paymentLinksMap = new Map();
        try {
            const response = await fetch('/api/payment-links/list', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                console.warn('⚠️ Impossible de récupérer les liens de paiement:', response.status);
            } else {
                try {
                    const data = await response.json();
                    if (data.success && data.data && Array.isArray(data.data)) {
                        // Map by reference (commande_id)
                        data.data.forEach(payment => {
                            if (payment.reference) {
                                paymentLinksMap.set(payment.reference, payment);
                            }
                        });
                        console.log('✅ Payment links récupérés:', paymentLinksMap.size);
                    }
                } catch (parseError) {
                    console.error('❌ Erreur parsing JSON payment links:', parseError);
                }
            }
        } catch (fetchError) {
            console.error('❌ Erreur fetch payment links:', fetchError);
        }
        
        // Préparer les données CSV
        const csvData = [];
        
        // En-têtes CSV
        const headers = [
            'Numéro Commande',
            'Date',
            'Heure',
            'Client',
            'Téléphone',
            'Produits',
            'Quantité Totale',
            'Montant Total',
            'Montant Payé',
            'Reste à Payer',
            'Statut Paiement',
            'Point de Vente',
            'Créé par',
            'Note Client',
            'Adresse Livraison'
        ];
        csvData.push(headers);
        
        // Parcourir toutes les commandes depuis commandesData
        for (const [commandeId, commande] of commandesData.entries()) {
            // Extract data from commande object
            const firstItem = commande.items && commande.items[0] ? commande.items[0] : {};
            
            const clientName = firstItem.nomClient || firstItem['Client Name'] || firstItem.nom_client || 'Inconnu';
            const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || firstItem.numero_client || '';
            const deliveryAddress = firstItem.adresseClient || firstItem['Client Address'] || firstItem.adresse_client || '';
            const createdBy = firstItem.created_by || firstItem.createdBy || '';
            
            // Extract time from createdAt
            const heureText = commande.createdAt ? new Date(commande.createdAt).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit'
            }) : '';
            
            // Get payment status using getCommandePaymentStatus
            let paymentStatus = 'A';
            let montantPaye = 0;
            let resteAPayer = 0;
            
            try {
                const paymentData = await getCommandePaymentStatus(commandeId);
                paymentStatus = paymentData.posStatus || 'A';
                montantPaye = paymentData.montantPaye || 0;
                resteAPayer = paymentData.montantRestantDu || 0;
                
                // If montantPaye is 0 and status is P or M, use totalAmount
                if ((paymentStatus === 'P' || paymentStatus === 'M') && montantPaye === 0) {
                    montantPaye = commande.totalAmount || 0;
                    resteAPayer = 0;
                } else if (paymentStatus === 'A' && montantPaye === 0) {
                    // Not paid at all
                    montantPaye = 0;
                    resteAPayer = commande.totalAmount || 0;
                }
            } catch (error) {
                console.error('❌ Erreur récupération statut paiement:', commandeId, error);
                // Fallback
                montantPaye = 0;
                resteAPayer = commande.totalAmount || 0;
            }
            
            // Récupérer la note client
            const rating = clientRatingsCache[clientPhone];
            const noteClient = (rating !== null && rating !== undefined && !isNaN(rating)) ? `${rating}/10` : '';
            
            // Build products list from commande.items
            let produitsArray = [];
            let quantiteTotale = 0;
            
            if (commande.items && Array.isArray(commande.items)) {
                commande.items.forEach(item => {
                    const nombre = item.Nombre || item.nombre || 1;
                    const produit = item.Produit || item.produit || 'Produit';
                    
                    produitsArray.push(`${produit} x${nombre}`);
                    quantiteTotale += parseFloat(nombre) || 0;
                });
            }
            
            const produitsString = produitsArray.join(' - ');
            
            // Total amount
            const totalAmount = commande.totalAmount || 0;
            
            // Formater le statut de paiement
            const statusLabels = {
                'P': 'Payé',
                'PP': 'Paiement Partiel',
                'M': 'Manuel (Cash)',
                'C': 'Crédit/Bon',
                'A': 'En Attente',
                'O': 'Ouvert',
                'E': 'Expiré'
            };
            const statusLabel = statusLabels[paymentStatus] || paymentStatus;
            
            // Ajouter la ligne CSV
            csvData.push([
                commandeId,
                selectedDate,
                heureText,
                clientName,
                clientPhone,
                produitsString,
                quantiteTotale,
                totalAmount,
                montantPaye,
                resteAPayer,
                statusLabel,
                selectedPointVente,
                createdBy,
                noteClient,
                deliveryAddress
            ]);
        }
        
        // Convertir en CSV avec séparateur point-virgule (meilleur pour Excel français)
        // + Protection contre CSV injection
        const csvContent = csvData.map(row => {
            return row.map(cell => {
                let cellStr = String(cell || '');
                
                // CSV Formula Injection Protection
                // Detect if string starts with formula-init characters
                if (cellStr.length > 0 && ['=', '+', '-', '@'].includes(cellStr[0])) {
                    // Prefix with single quote to neutralize formula
                    cellStr = '\'' + cellStr;
                }
                
                // Échapper les guillemets et entourer de guillemets si nécessaire
                if (cellStr.includes(';') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                }
                return cellStr;
            }).join(';');
        }).join('\n');
        
        // Ajouter le BOM UTF-8 pour Excel
        const BOM = '\uFEFF';
        const finalContent = BOM + csvContent;
        
        // Créer le fichier et télécharger
        const blob = new Blob([finalContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        // Formater le nom du fichier
        const dateFormatted = selectedDate.replace(/\//g, '-');
        const now = new Date();
        const timeFormatted = `${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`;
        const fileName = `commandes_${selectedPointVente}_${dateFormatted}_${timeFormatted}.csv`;
        
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // Calculer le total exporté
        const totalExported = csvData.slice(1).reduce((sum, row) => sum + (parseFloat(row[7]) || 0), 0);
        
        // Afficher un message de succès
        showToast(`✅ ${commandesData.size} commandes exportées (${formatCurrency(totalExported)})`, 'success');
        
        console.log(`✅ Export CSV terminé : ${fileName}`);
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'export CSV:', error);
        showToast('❌ Erreur lors de l\'export CSV', 'error');
    }
}

/**
 * Vérifier les permissions et afficher le bouton CSV
 */
function checkCSVExportPermissions() {
    // Utiliser currentUser au lieu de sessionStorage
    if (!currentUser) {
        console.log('⚠️ currentUser non défini, attente...');
        return;
    }
    
    const userRole = currentUser.role || '';
    
    // Rôles autorisés : superviseur et superutilisateur (en minuscules)
    const authorizedRoles = ['superviseur', 'Superviseur', 'SuperUtilisateur', 'superutilisateur'];
    
    if (authorizedRoles.includes(userRole)) {
        const exportBtn = document.getElementById('exportCsvBtn');
        if (exportBtn) {
            exportBtn.style.display = 'inline-block';
            console.log('✅ Bouton Export CSV activé pour:', userRole);
        }
    } else {
        console.log('🔒 Export CSV non autorisé pour:', userRole);
    }
}

/**
 * Configuration du fuseau horaire métier (Dakar, Sénégal)
 */
const BUSINESS_TIMEZONE = 'Africa/Dakar';

/**
 * Formater la date en utilisant le fuseau horaire métier
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        const formatter = new Intl.DateTimeFormat('fr-FR', {
            timeZone: BUSINESS_TIMEZONE,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        return formatter.format(date);
    } catch (error) {
        console.error('Erreur formatDate:', error);
        return 'N/A';
    }
}

/**
 * Formater l'heure en utilisant le fuseau horaire métier
 */
function formatTime(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        const formatter = new Intl.DateTimeFormat('fr-FR', {
            timeZone: BUSINESS_TIMEZONE,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        return formatter.format(date);
    } catch (error) {
        console.error('Erreur formatTime:', error);
        return 'N/A';
    }
}

/**
 * Formater date et heure en utilisant le fuseau horaire métier
 */
function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    return `${formatDate(dateString)} ${formatTime(dateString)}`;
}

// ========================================
// PRÉ-COMMANDES POS - FONCTIONS
// ========================================

/**
 * Récupérer les informations client du formulaire
 */
function getClientInfo() {
    return {
        nom: document.getElementById('clientName')?.value || '',
        telephone: document.getElementById('clientPhone')?.value || '',
        adresse: document.getElementById('clientAddress')?.value || '',
        instructions: document.getElementById('clientInstructions')?.value || ''
    };
}

/**
 * Afficher un spinner de chargement
 */
function showLoadingSpinner() {
    let spinner = document.getElementById('loadingSpinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'loadingSpinner';
        spinner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            backdrop-filter: blur(3px);
        `;
        spinner.innerHTML = `
            <div style="
                background: white;
                padding: 30px;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                text-align: center;
            ">
                <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: #3b82f6; margin-bottom: 10px;"></i>
                <p style="margin: 0; color: #374151; font-weight: 500;">Chargement...</p>
            </div>
        `;
        document.body.appendChild(spinner);
    }
    spinner.style.display = 'flex';
}

/**
 * Masquer le spinner de chargement
 */
function hideLoadingSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.style.display = 'none';
    }
}

/**
 * Charger les pré-commandes pour le point de vente actuel
 */
async function loadPrecommandes() {
    try {
        const pointVente = document.getElementById('pointVenteSelect')?.value;
        if (!pointVente) return;
        
        const response = await fetch(
            `/api/precommandes?pointVente=${encodeURIComponent(pointVente)}&statut=ouvert`,
            {
                credentials: 'include'
            }
        );
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des pré-commandes');
        }
        
        const data = await response.json();
        precommandesData = data.precommandes || [];
        
        // DEBUG: Afficher la structure d'une pré-commande
        if (precommandesData.length > 0) {
            console.log('🔍 Structure pré-commande:', precommandesData[0]);
            console.log('🔍 Clés disponibles:', Object.keys(precommandesData[0]));
        }
        
        console.log(`📋 ${precommandesData.length} pré-commande(s) chargée(s)`);
        if (precommandesData.length > 0) {
            console.log('🔍 Exemple de données:', precommandesData[0]);
        }
        
        // Mettre à jour le badge
        updatePrecommandesTodayBadge();
        
    } catch (error) {
        console.error('❌ Erreur loadPrecommandes:', error);
    }
}

/**
 * Compter les pré-commandes (commandes uniques, pas articles) à récupérer aujourd'hui
 */
function countPrecommandesToday() {
    // Get today's date as YYYY-MM-DD string in business timezone
    const todayDate = new Date();
    const businessDateParts = todayDate.toLocaleDateString('fr-FR', { 
        timeZone: BUSINESS_TIMEZONE,
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
    }).split('/');
    const todayStr = `${businessDateParts[2]}-${businessDateParts[1]}-${businessDateParts[0]}`;
    
    console.log('🔍 [BADGE] Comptage des pré-commandes urgentes...');
    console.log('📅 [BADGE] Date du jour (timezone affaires):', todayStr, '(', todayDate.toLocaleDateString('fr-FR', { timeZone: BUSINESS_TIMEZONE }), ')');
    
    // Grouper par client + date de réception pour compter les commandes uniques, pas les articles
    const uniqueCommandes = new Set();
    
    precommandesData.forEach(p => {
        let dateReception = p['Date Réception'] || p.dateReception;
        const nomClient = p.nomClient || p['Nom Client'] || 'Client';
        
        // Guard against missing, falsy, or non-string dateReception
        if (!dateReception) {
            console.warn('⚠️ [BADGE] Date de réception manquante pour:', nomClient);
            return;
        }
        
        // Coerce to string and trim
        dateReception = String(dateReception).trim();
        
        if (dateReception === '') {
            console.warn('⚠️ [BADGE] Date de réception vide pour:', nomClient);
            return;
        }
        
        // Validate format with regex (DD/MM/YYYY, YYYY-MM-DD, or DD-MM-YYYY)
        if (!/^\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}$/.test(dateReception)) {
            console.warn('⚠️ [BADGE] Format de date invalide:', dateReception, 'pour:', nomClient);
            return;
        }
        
        // Normalize date to YYYY-MM-DD string
        let dateStr;
        
        // Gérer les différents formats de date
        if (dateReception.includes('/')) {
            // Format DD/MM/YYYY
            const parts = dateReception.split('/');
            dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        } else if (dateReception.includes('-')) {
            const parts = dateReception.split('-');
            // Détecter le format: YYYY-MM-DD ou DD-MM-YYYY
            if (parts[0].length === 4) {
                // Format YYYY-MM-DD (format PostgreSQL standard)
                dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else {
                // Format DD-MM-YYYY
                dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        } else {
            console.warn('⚠️ [BADGE] Format de date non reconnu:', dateReception);
            return;
        }
        
        // Validate date string using a simple Date parse
        const testDate = new Date(dateStr + 'T00:00:00');
        if (isNaN(testDate.getTime())) {
            console.warn('⚠️ [BADGE] Date invalide après parsing:', dateReception, 'pour:', nomClient);
            return;
        }
        
        // Compare using lexicographic string comparison (YYYY-MM-DD format)
        const isUrgent = dateStr <= todayStr;
        
        if (isUrgent) {
            // Créer une clé unique par commande (client + date normalisée)
            const key = `${nomClient}_${dateStr}`;
            uniqueCommandes.add(key);
            console.log('⏰ [BADGE] Commande urgente:', key, '- Date:', dateStr);
        }
    });
    
    const count = uniqueCommandes.size;
    console.log('🎯 [BADGE] Total commandes uniques urgentes:', count);
    return count;
}

/**
 * Mettre à jour le badge de notification
 */
function updatePrecommandesTodayBadge() {
    precommandesTodayCount = countPrecommandesToday();
    
    console.log('🔔 [BADGE] Mise à jour badge - Count:', precommandesTodayCount);
    
    // Afficher/masquer l'indicateur clignotant
    const indicator = document.getElementById('precommandesIndicator');
    if (indicator) {
        if (precommandesTodayCount > 0) {
            indicator.style.display = 'block';
            console.log('✅ [INDICATOR] Indicateur clignotant affiché');
        } else {
            indicator.style.display = 'none';
            console.log('❌ [INDICATOR] Indicateur masqué');
        }
    }
    
    // Badge sur le bouton (ancien code)
    const btn = document.querySelector('.btn-voir-precommandes');
    if (!btn) {
        console.warn('⚠️ [BADGE] Bouton non trouvé');
        return;
    }
    
    let badge = btn.querySelector('.precommande-badge-today');
    
    if (precommandesTodayCount > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'precommande-badge-today';
            btn.appendChild(badge);
            console.log('✨ [BADGE] Badge créé');
        }
        badge.textContent = precommandesTodayCount;
        badge.style.display = 'flex';
        console.log('✅ [BADGE] Badge affiché avec:', precommandesTodayCount);
    } else {
        if (badge) {
            badge.style.display = 'none';
            console.log('❌ [BADGE] Badge masqué (count = 0)');
        }
    }
}

/**
 * Gérer le clic sur le bouton Pré-commande
 */
async function handlePrecommandeClick() {
    // Vérifier que le panier n'est pas vide
    if (cart.length === 0) {
        showToast('⚠️ Le panier est vide', 'warning');
        return;
    }
    
    // Ouvrir directement le formulaire (les infos client seront saisies dans le modal)
    openPrecommandeForm();
}

/**
 * Ouvrir le formulaire de pré-commande (modal style POS)
 */
/**
 * Ouvrir le formulaire de pré-commande (modal style POS)
 */
function openPrecommandeForm() {
    // Récupérer le total du panier
    const cartTotal = cart.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    
    // Remplir le récapitulatif du panier
    let panierHTML = '';
    cart.forEach(item => {
        panierHTML += `
            <div style="display: flex; justify-content: space-between; padding: 10px; background: white; margin-bottom: 6px; border-radius: 6px; border: 1px solid #d1fae5;">
                <div>
                    <strong style="color: #065f46;">${escapeHtml(item.name)}</strong>
                    <small style="color: #6b7280;"> × ${item.quantity}</small>
                </div>
                <span style="color: #065f46; font-weight: 600;">${(item.quantity * item.price).toLocaleString('fr-FR')} FCFA</span>
            </div>
        `;
    });
    
    document.getElementById('precommandePanierRecap').innerHTML = panierHTML;
    document.getElementById('precommandeTotal').textContent = `${cartTotal.toLocaleString('fr-FR')} FCFA`;
    
    // Pré-remplir les infos client si déjà saisies dans le POS
    const clientInfo = getClientInfo();
    document.getElementById('precommandeClientName').value = clientInfo.nom || '';
    document.getElementById('precommandeClientPhone').value = clientInfo.telephone || '';
    document.getElementById('precommandeClientAddress').value = clientInfo.adresse || '';
    
    // Réinitialiser les autres champs
    document.getElementById('precommandeLabel').value = '';
    document.getElementById('precommandeCommentaire').value = '';
    
    // Set min date to today in business timezone (Dakar) to prevent selecting past dates
    const dateReceptionInput = document.getElementById('precommandeDateReception');
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const todayISO = formatter.format(new Date()); // YYYY-MM-DD in business timezone
    dateReceptionInput.min = todayISO;
    dateReceptionInput.value = ''; // Clear any previous value - force user to select
    
    // Afficher le modal
    document.getElementById('modalPrecommande').style.display = 'flex';
    
    // Focus sur le champ nom client si vide, sinon sur le label
    setTimeout(() => {
        if (!clientInfo.nom) {
            document.getElementById('precommandeClientName')?.focus();
        } else {
            document.getElementById('precommandeLabel')?.focus();
        }
    }, 300);
}

/**
 * Fermer le modal de pré-commande
 */
function fermerModalPrecommande() {
    document.getElementById('modalPrecommande').style.display = 'none';
}

/**
 * Confirmer la création de la pré-commande
 */
async function confirmerPrecommande() {
    // Récupérer les infos du modal
    const clientName = document.getElementById('precommandeClientName').value.trim();
    const clientPhone = document.getElementById('precommandeClientPhone').value.trim();
    const clientAddress = document.getElementById('precommandeClientAddress').value.trim();
    const dateReception = document.getElementById('precommandeDateReception').value;
    const label = document.getElementById('precommandeLabel').value;
    const commentaire = document.getElementById('precommandeCommentaire').value;
    
    // Validation
    if (!clientName || !clientPhone) {
        showToast('⚠️ Le nom et le téléphone du client sont obligatoires', 'warning');
        return;
    }
    
    if (!dateReception) {
        showToast('⚠️ La date de réception est obligatoire', 'warning');
        return;
    }
    
    // Convertir la date au format français
    const [year, month, day] = dateReception.split('-');
    const dateReceptionFR = `${day}/${month}/${year}`;
    
    const pointVente = document.getElementById('pointVenteSelect').value;
    
    const precommandeData = {
        cart: cart,
        clientInfo: {
            nom: clientName,
            telephone: clientPhone,
            adresse: clientAddress || null,
            instructions: ''
        },
        dateReception: dateReceptionFR,
        label: label || null,
        commentaire: commentaire || null,
        pointVente: pointVente
    };
    
    try {
        showLoadingSpinner();
        
        const response = await fetch('/api/precommandes/pos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(precommandeData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`✅ ${data.message}`, 'success');
            
            // Fermer le modal
            fermerModalPrecommande();
            
            // Vider le panier et réinitialiser
            viderPanier();
            
            // Recharger les pré-commandes
            await loadPrecommandes();
            
        } else {
            showToast(`❌ ${data.message}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Erreur confirmerPrecommande:', error);
        showToast('❌ Erreur lors de la création de la pré-commande', 'error');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Afficher le modal des pré-commandes
 */
function showPrecommandesModal() {
    const formatter = new Intl.DateTimeFormat('fr-FR', {
        timeZone: BUSINESS_TIMEZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const today = formatter.format(new Date());
    
    let html = `
        <div class="modal-precommandes" id="modalPrecommandes">
            <div class="modal-precommandes-content">
                <div class="modal-precommandes-header">
                    <h3><i class="fas fa-clipboard-list"></i> Pré-commandes en attente</h3>
                    <button class="btn-close" onclick="closePrecommandesModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-precommandes-body">
    `;
    
    if (precommandesData.length === 0) {
        html += `
            <div class="precommandes-empty">
                <i class="fas fa-inbox"></i>
                <p>Aucune pré-commande en attente</p>
            </div>
        `;
    } else {
        // Regrouper les pré-commandes par client + date de réception
        const groupedPrecommandes = {};
        
        precommandesData.forEach(precommande => {
            const key = `${precommande.nomClient || 'Client'}_${precommande['Date Réception'] || precommande.dateReception}`;
            
            if (!groupedPrecommandes[key]) {
                groupedPrecommandes[key] = {
                    nomClient: precommande.nomClient || 'Client',
                    numeroClient: precommande.numeroClient || precommande['Numero Client'] || '',
                    dateReception: precommande['Date Réception'] || precommande.dateReception,
                    label: precommande.Label || precommande.label,
                    produits: [],
                    ids: [],
                    montantTotal: 0
                };
            }
            
            groupedPrecommandes[key].produits.push({
                nom: precommande.Produit || precommande.produit,
                quantite: precommande.Nombre || precommande.nombre,
                prixUnit: precommande.PU || 0,  // <-- FIX: C'est "PU" dans la DB
                montant: precommande.Montant || precommande.montant
            });
            groupedPrecommandes[key].ids.push(precommande.id);
            groupedPrecommandes[key].montantTotal += parseFloat(precommande.Montant || precommande.montant || 0);
        });
        
        html += `
            <table class="precommandes-table">
                <thead>
                    <tr>
                        <th>Client</th>
                        <th>Produits</th>
                        <th>Qté</th>
                        <th>Montant</th>
                        <th>Date Réception</th>
                        <th style="width: 280px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        Object.values(groupedPrecommandes).forEach(group => {
            // Guard against missing, non-string, or invalid dateReception
            if (!group.dateReception) {
                console.warn('⚠️ Date de réception manquante pour le groupe:', group);
                return; // Skip this group
            }
            
            // Coerce to string and trim
            const dateReceptionStr = String(group.dateReception).trim();
            
            if (dateReceptionStr === '') {
                console.warn('⚠️ Date de réception vide pour le groupe:', group);
                return; // Skip this group
            }
            
            // Validate format with regex
            if (!/^\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}$/.test(dateReceptionStr)) {
                console.warn('⚠️ Format de date invalide:', dateReceptionStr, 'pour le groupe:', group);
                return; // Skip this group
            }
            
            // Normalize date to YYYY-MM-DD string
            let dateStr;
            
            if (dateReceptionStr.includes('/')) {
                // Format DD/MM/YYYY
                const parts = dateReceptionStr.split('/');
                dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            } else if (dateReceptionStr.includes('-')) {
                const parts = dateReceptionStr.split('-');
                // Détecter le format: YYYY-MM-DD ou DD-MM-YYYY
                if (parts[0].length === 4) {
                    // Format YYYY-MM-DD (format PostgreSQL standard)
                    dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                } else {
                    // Format DD-MM-YYYY
                    dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
            }
            
            // Validate date string using a simple Date parse
            const testDate = new Date(dateStr + 'T00:00:00');
            if (isNaN(testDate.getTime())) {
                console.warn('⚠️ Date invalide après parsing:', dateReceptionStr, 'pour le groupe:', group);
                return; // Skip this group
            }
            
            // Get today's date as YYYY-MM-DD string in business timezone
            const todayDate = new Date();
            const businessDateParts = todayDate.toLocaleDateString('fr-FR', { 
                timeZone: BUSINESS_TIMEZONE,
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit' 
            }).split('/');
            const todayStr = `${businessDateParts[2]}-${businessDateParts[1]}-${businessDateParts[0]}`;
            
            // Compare using lexicographic string comparison (YYYY-MM-DD format)
            const isToday = dateStr === todayStr;
            const isPast = dateStr < todayStr;
            const isUrgent = isToday || isPast;
            
            // Formater la date pour l'affichage en français (DD/MM/YYYY)
            const dateParts = dateStr.split('-');
            const dateFormatted = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            
            let badgeHTML = '';
            if (isPast) {
                badgeHTML = '<span class="badge-urgent-past"><i class="fas fa-exclamation-triangle"></i> EN RETARD</span>';
            } else if (isToday) {
                badgeHTML = '<span class="badge-urgent-today"><i class="fas fa-bell"></i> AUJOURD\'HUI</span>';
            }
            
            // Construire le détail des produits avec prix
            const produitsHTML = group.produits.map(p => 
                `<div style="margin-bottom: 4px;">
                    <strong>${escapeHtml(p.nom)}</strong>: ${p.prixUnit.toLocaleString('fr-FR')} × ${p.quantite}
                </div>`
            ).join('');
            
            const totalQuantite = group.produits.reduce((sum, p) => sum + parseFloat(p.quantite || 0), 0);
            
            html += `
                <tr class="${isUrgent ? 'precommande-urgent' : ''}">
                    <td>
                        <strong>${escapeHtml(group.nomClient)}</strong>
                        ${group.numeroClient ? `<br><small style="color: #059669; font-weight: 500;"><i class="fas fa-phone"></i> ${escapeHtml(group.numeroClient)}</small>` : ''}
                        ${group.label ? `<br><small style="color: #6b7280;"><i class="fas fa-tag"></i> ${escapeHtml(group.label)}</small>` : ''}
                    </td>
                    <td>${produitsHTML}</td>
                    <td style="text-align: center;">${totalQuantite.toFixed(2)}</td>
                    <td>
                        <div style="text-align: right;">
                            ${group.produits.map(p => 
                                `<div style="margin-bottom: 4px; color: #6b7280;">${(p.prixUnit * p.quantite).toLocaleString('fr-FR')} FCFA</div>`
                            ).join('')}
                            <div style="border-top: 2px solid #10b981; padding-top: 4px; margin-top: 4px;">
                                <strong style="color: #10b981; font-size: 1.1em;">${group.montantTotal.toLocaleString('fr-FR')} FCFA</strong>
                            </div>
                        </div>
                    </td>
                    <td>
                        ${dateFormatted}
                        ${badgeHTML}
                    </td>
                    <td class="precommandes-actions">
                        <button class="btn-convertir" onclick="convertPrecommandeGroupToOrder([${group.ids.join(',')}])">
                            <i class="fas fa-check"></i> Convertir
                        </button>
                        <button class="btn-archiver" onclick="archiverPrecommandeGroup([${group.ids.join(',')}])">
                            <i class="fas fa-archive"></i> Archiver
                        </button>
                        <button class="btn-supprimer" onclick="supprimerPrecommandeGroup([${group.ids.join(',')}])">
                            <i class="fas fa-trash"></i> Supprimer
                        </button>
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
    }
    
    html += `
                </div>
            </div>
        </div>
    `;
    
    // Supprimer modal existant
    const existingModal = document.getElementById('modalPrecommandes');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Ajouter le nouveau modal
    document.body.insertAdjacentHTML('beforeend', html);
    
    // Fermer en cliquant sur l'overlay
    document.getElementById('modalPrecommandes').addEventListener('click', (e) => {
        if (e.target.id === 'modalPrecommandes') {
            closePrecommandesModal();
        }
    });
}

/**
 * Fermer le modal des pré-commandes
 */
function closePrecommandesModal() {
    const modal = document.getElementById('modalPrecommandes');
    if (modal) {
        modal.remove();
    }
}

/**
 * Convertir une pré-commande en commande
 */
async function convertPrecommandeToOrder(precommandeId) {
    const precommande = precommandesData.find(p => p.id === precommandeId);
    
    if (!precommande) {
        showToast('❌ Pré-commande non trouvée', 'error');
        return;
    }
    
    const confirmed = await showModernConfirm({
        title: '✓ Convertir en commande',
        message: `Convertir la pré-commande de ${precommande.nomClient || 'ce client'} en commande réelle ?`,
        confirmText: 'OUI, CONVERTIR',
        cancelText: 'ANNULER',
        type: 'success'
    });
    
    if (!confirmed) return;
    
    try {
        showLoadingSpinner();
        
        const response = await fetch(`/api/precommandes/${precommandeId}/convert-to-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`✅ Commande créée avec succès !`, 'success');
            
            // Recharger les pré-commandes
            await loadPrecommandes();
            
            // Recharger le résumé du jour pour afficher la nouvelle commande
            if (typeof chargerResume === 'function') {
                await chargerResume();
            }
            
            // Fermer le modal
            closePrecommandesModal();
            
        } else {
            showToast(`❌ ${data.message}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Erreur conversion:', error);
        showToast('❌ Erreur lors de la conversion', 'error');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Convertir un groupe de pré-commandes en commande
 */
async function convertPrecommandeGroupToOrder(precommandeIds) {
    console.log('🔄 [CONVERT] Début conversion groupe, IDs:', precommandeIds);
    
    if (!precommandeIds || precommandeIds.length === 0) {
        showToast('❌ Aucune pré-commande à convertir', 'error');
        return;
    }
    
    // Récupérer les infos du premier élément pour l'affichage
    const firstPrecommande = precommandesData.find(p => p.id === precommandeIds[0]);
    console.log('🔍 [CONVERT] Première pré-commande:', firstPrecommande);
    
    if (!firstPrecommande) {
        showToast('❌ Pré-commande non trouvée', 'error');
        return;
    }
    
    const confirmed = await showModernConfirm({
        title: '✓ Convertir en commande',
        message: `Convertir la pré-commande de ${firstPrecommande.nomClient || 'ce client'} (${precommandeIds.length} produit${precommandeIds.length > 1 ? 's' : ''}) en commande réelle ?`,
        confirmText: 'OUI, CONVERTIR',
        cancelText: 'ANNULER',
        type: 'success'
    });
    
    console.log('🤔 [CONVERT] Confirmation:', confirmed);
    
    if (!confirmed) return;
    
    try {
        showLoadingSpinner();
        
        console.log('🔄 [CONVERT] Conversion de', precommandeIds.length, 'pré-commande(s)');
        
        // Générer un ID de commande unique pour tout le groupe (reuse firstPrecommande from outer scope)
        const pointVente = firstPrecommande['Point de Vente'];
        
        // Générer l'ID de commande basé sur le point de vente
        const prefixes = {
            'Mbao': 'MBA',
            'O.Foire': 'OFO',
            'Keur Massar': 'KMA',
            'Linguere': 'LIN',
            'Dahra': 'DAH',
            'Abattage': 'ABA',
            'Sacre Coeur': 'SAC'
        };
        const prefix = prefixes[pointVente] || 'CMD';
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const commandeId = `${prefix}_P_${timestamp}${random}`;
        
        console.log(`📦 [CONVERT] ID de commande généré: ${commandeId} pour ${precommandeIds.length} produit(s)`);
        
        // Convertir chaque pré-commande du groupe avec le même commandeId
        for (const id of precommandeIds) {
            console.log('➡️ [CONVERT] Conversion pré-commande ID:', id);
            const response = await fetch(`/api/precommandes/${id}/convert-to-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ commandeId }) // Envoyer le commandeId pour grouper
            });
            
            const data = await response.json();
            console.log('✅ [CONVERT] Réponse API pour ID', id, ':', data);
            
            if (!data.success) {
                throw new Error(data.message || `Erreur lors de la conversion de la pré-commande ${id}`);
            }
        }
        
        showToast(`✅ Commande ${commandeId} créée avec succès (${precommandeIds.length} produit${precommandeIds.length > 1 ? 's' : ''}) !`, 'success');
        
        console.log('🔄 [CONVERT] Rechargement des pré-commandes...');
        // Recharger les pré-commandes
        await loadPrecommandes();
        
        console.log('🔄 [CONVERT] Rechargement du résumé...');
        // Recharger le résumé du jour pour afficher la nouvelle commande
        if (typeof chargerResume === 'function') {
            await chargerResume();
            console.log('✅ [CONVERT] Résumé rechargé');
        } else {
            console.warn('⚠️ [CONVERT] chargerResume non disponible');
        }
        
        // Rafraîchir le modal
        console.log('🔄 [CONVERT] Fermeture/rafraîchissement du modal...');
        closePrecommandesModal();
        setTimeout(() => showPrecommandesModal(), 500);
        
        console.log('✅ [CONVERT] Conversion terminée avec succès');
        
    } catch (error) {
        console.error('❌ [CONVERT] Erreur conversion groupe:', error);
        showToast(`❌ ${error.message || 'Erreur lors de la conversion'}`, 'error');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Archiver une pré-commande
 */
async function archiverPrecommande(precommandeId) {
    const precommande = precommandesData.find(p => p.id === precommandeId);
    
    if (!precommande) {
        showToast('❌ Pré-commande non trouvée', 'error');
        return;
    }
    
    // Demander un commentaire obligatoire
    const commentaire = prompt('📦 Raison de l\'archivage (obligatoire):');
    
    if (!commentaire || commentaire.trim() === '') {
        showToast('⚠️ Le commentaire est obligatoire', 'warning');
        return;
    }
    
    const confirmed = await showModernConfirm({
        title: '📦 Archiver',
        message: `Archiver la pré-commande de ${precommande.nomClient || 'ce client'} ?`,
        confirmText: 'OUI, ARCHIVER',
        cancelText: 'ANNULER',
        type: 'warning'
    });
    
    if (!confirmed) return;
    
    try {
        showLoadingSpinner();
        
        const response = await fetch(`/api/precommandes/${precommandeId}/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ commentaire: commentaire.trim() })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('📦 Pré-commande archivée avec succès', 'success');
            await loadPrecommandes();
        } else {
            showToast(`❌ ${data.message}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Erreur archivage:', error);
        showToast('❌ Erreur lors de l\'archivage', 'error');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Archiver un groupe de pré-commandes
 */
async function archiverPrecommandeGroup(precommandeIds) {
    if (!precommandeIds || precommandeIds.length === 0) {
        showToast('❌ Aucune pré-commande à archiver', 'error');
        return;
    }
    
    const firstPrecommande = precommandesData.find(p => p.id === precommandeIds[0]);
    
    if (!firstPrecommande) {
        showToast('❌ Pré-commande non trouvée', 'error');
        return;
    }
    
    // Demander un commentaire obligatoire
    const commentaire = prompt('📦 Raison de l\'archivage (obligatoire):');
    
    if (!commentaire || commentaire.trim() === '') {
        showToast('⚠️ Le commentaire est obligatoire', 'warning');
        return;
    }
    
    const confirmed = await showModernConfirm({
        title: '📦 Archiver',
        message: `Archiver la pré-commande de ${firstPrecommande.nomClient || 'ce client'} (${precommandeIds.length} produit${precommandeIds.length > 1 ? 's' : ''}) ?`,
        confirmText: 'OUI, ARCHIVER',
        cancelText: 'ANNULER',
        type: 'warning'
    });
    
    if (!confirmed) return;
    
    try {
        showLoadingSpinner();
        
        // Archiver chaque pré-commande du groupe
        for (const id of precommandeIds) {
            const response = await fetch(`/api/precommandes/${id}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ commentaire: commentaire.trim() })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || `Erreur lors de l'archivage de la pré-commande ${id}`);
            }
        }
        
        showToast(`📦 Pré-commande${precommandeIds.length > 1 ? 's' : ''} archivée${precommandeIds.length > 1 ? 's' : ''} avec succès`, 'success');
        
        // Recharger les pré-commandes
        await loadPrecommandes();
        
        // Rafraîchir le modal
        closePrecommandesModal();
        setTimeout(() => showPrecommandesModal(), 500);
        
    } catch (error) {
        console.error('❌ Erreur archivage groupe:', error);
        showToast(`❌ ${error.message || 'Erreur lors de l\'archivage'}`, 'error');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Supprimer définitivement une pré-commande
 */
async function supprimerPrecommande(precommandeId) {
    const precommande = precommandesData.find(p => p.id === precommandeId);
    
    if (!precommande) {
        showToast('❌ Pré-commande non trouvée', 'error');
        return;
    }
    
    const confirmed = await showModernConfirm({
        title: '⚠️ ATTENTION',
        message: `SUPPRIMER DÉFINITIVEMENT la pré-commande de ${precommande.nomClient || 'ce client'} ?\n\n⚠️ Cette action est IRRÉVERSIBLE !`,
        confirmText: 'OUI, SUPPRIMER',
        cancelText: 'ANNULER',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    try {
        showLoadingSpinner();
        
        const response = await fetch(`/api/precommandes/${precommandeId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('🗑️ Pré-commande supprimée définitivement', 'success');
            await loadPrecommandes();
        } else {
            showToast(`❌ ${data.message}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Erreur suppression:', error);
        showToast('❌ Erreur lors de la suppression', 'error');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Supprimer un groupe de pré-commandes
 */
async function supprimerPrecommandeGroup(precommandeIds) {
    if (!precommandeIds || precommandeIds.length === 0) {
        showToast('❌ Aucune pré-commande à supprimer', 'error');
        return;
    }
    
    const firstPrecommande = precommandesData.find(p => p.id === precommandeIds[0]);
    
    if (!firstPrecommande) {
        showToast('❌ Pré-commande non trouvée', 'error');
        return;
    }
    
    const confirmed = await showModernConfirm({
        title: '⚠️ ATTENTION',
        message: `SUPPRIMER DÉFINITIVEMENT la pré-commande de ${firstPrecommande.nomClient || 'ce client'} (${precommandeIds.length} produit${precommandeIds.length > 1 ? 's' : ''}) ?\n\n⚠️ Cette action est IRRÉVERSIBLE !`,
        confirmText: 'OUI, SUPPRIMER',
        cancelText: 'ANNULER',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    try {
        showLoadingSpinner();
        
        // Supprimer chaque pré-commande du groupe
        for (const id of precommandeIds) {
            const response = await fetch(`/api/precommandes/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || `Erreur lors de la suppression de la pré-commande ${id}`);
            }
        }
        
        showToast(`🗑️ Pré-commande${precommandeIds.length > 1 ? 's' : ''} supprimée${precommandeIds.length > 1 ? 's' : ''} définitivement`, 'success');
        
        // Recharger les pré-commandes
        await loadPrecommandes();
        
        // Rafraîchir le modal
        closePrecommandesModal();
        setTimeout(() => showPrecommandesModal(), 500);
        
    } catch (error) {
        console.error('❌ Erreur suppression groupe:', error);
        showToast(`❌ ${error.message || 'Erreur lors de la suppression'}`, 'error');
    } finally {
        hideLoadingSpinner();
    }
}

/**
 * Démarrer la vérification périodique des pré-commandes
 */
function startPrecommandesCheck() {
    // Charger immédiatement
    loadPrecommandes();
    
    // Puis vérifier toutes les 5 minutes
    if (checkPrecommandesInterval) {
        clearInterval(checkPrecommandesInterval);
    }
    
    checkPrecommandesInterval = setInterval(() => {
        loadPrecommandes();
    }, 5 * 60 * 1000); // 5 minutes
}

