/**
 * Script pour la gestion des liens de paiement
 */

// Variables globales
let currentUser = null;
let generatedPaymentLinks = [];
let filteredPaymentLinks = [];
let currentPage = 1;
const itemsPerPage = 30;

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initialisation du module de paiement');
    console.log('🔍 Vérification du contexte:', window.location.href);
    console.log('🔍 Element payment-links-tbody existe au chargement:', !!document.getElementById('payment-links-tbody'));

    // Vérifier l'authentification
    checkAuthentication();

    // Initialiser les événements
    initEventListeners();
    
    // Charger les points de vente accessibles
    loadAccessiblePointsVente();
    
        // Écouter les messages du parent (pour recharger les liens quand l'onglet est cliqué)
        window.addEventListener('message', function(event) {
            if (event.data && event.data.action === 'loadPaymentLinks') {
                console.log('Message reçu du parent: recharger les liens de paiement');
                loadExistingPaymentLinks();
            }
        });
    
    // Initialiser les filtres
    initFilters();
});

/**
 * Vérifier l'authentification de l'utilisateur
 * Cette fonction gère le flux d'authentification et initialise les composants
 * qui dépendent de l'état d'authentification (liens de paiement, date d'expiration, etc.)
 */
async function checkAuthentication() {
    try {
        const response = await fetch('/api/check-session', {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.user) {
            currentUser = result.user;
            console.log('Utilisateur authentifié:', currentUser);
            console.log('🔍 Debug utilisateur:');
            console.log('  - Username:', currentUser.username);
            console.log('  - Role:', currentUser.role);
            console.log('  - canAccessAllPointsVente:', currentUser.canAccessAllPointsVente);
            console.log('  - canWrite:', currentUser.canWrite);
            
            // Configurer l'affichage des colonnes admin
            configureAdminColumns();
            
            // Initialiser la date d'expiration par défaut après authentification
            initializeDefaultDueDate();
            
            // Charger les liens de paiement existants après authentification
            console.log('🔄 Chargement automatique des liens de paiement après authentification...');
            try {
                await loadExistingPaymentLinks();
            } catch (error) {
                console.error('❌ Erreur lors du chargement des liens de paiement:', error);
            }
        } else {
            // Rediriger vers la page de connexion
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'authentification:', error);
        window.location.href = '/login.html';
    }
}


/**
 * Obtenir le nom d'affichage du rôle utilisateur
 */
function getUserRoleDisplayName(role) {
    const roleNames = {
        'admin': 'Administrateur',
        'superviseur': 'Superviseur',
        'superutilisateur': 'SuperUtilisateur',
        'user': 'Utilisateur',
        'lecteur': 'Lecteur'
    };
    return roleNames[role] || role;
}

/**
 * Initialiser les écouteurs d'événements
 */
function initEventListeners() {
    // Formulaire de paiement
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) {
        paymentForm.addEventListener('submit', handlePaymentFormSubmit);
    }
    
    
    // Validation en temps réel du montant
    const amountInput = document.getElementById('amount');
    if (amountInput) {
        amountInput.addEventListener('input', validateAmount);
    }
    
    // Checkbox versement
    const versementCheckbox = document.getElementById('versement-checkbox');
    if (versementCheckbox) {
        versementCheckbox.addEventListener('change', handleVersementToggle);
    }
    
    // Point de vente pour générer le nom client automatique
    const pointVenteSelect = document.getElementById('point-vente');
    if (pointVenteSelect) {
        pointVenteSelect.addEventListener('change', handlePointVenteChange);
    }
    
    // Bouton d'archivage
    const archiveButton = document.getElementById('archive-button');
    if (archiveButton) {
        archiveButton.addEventListener('click', handleArchiveOldLinks);
    }
    
    // Bouton voir archives (admin seulement)
    const viewArchivesButton = document.getElementById('view-archives-button');
    if (viewArchivesButton) {
        viewArchivesButton.addEventListener('click', handleViewArchives);
    }
    
    // Bouton vérifier paiement par URL
    const verifyPaymentBtn = document.getElementById('verify-payment-btn');
    if (verifyPaymentBtn) {
        verifyPaymentBtn.addEventListener('click', verifyPaymentByUrl);
    }
    
    // Bouton actualiser tous les paiements ouverts
    const updateAllPaymentsBtn = document.getElementById('update-all-payments-btn');
    if (updateAllPaymentsBtn) {
        updateAllPaymentsBtn.addEventListener('click', updateAllOpenPayments);
    }
    
    // Permettre la vérification en appuyant sur Entrée dans le champ URL
    const paymentUrlInput = document.getElementById('payment-url-input');
    if (paymentUrlInput) {
        paymentUrlInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                verifyPaymentByUrl();
            }
        });
    }
}

/**
 * Configurer l'affichage des colonnes admin selon les permissions utilisateur
 */
function configureAdminColumns() {
    const adminColumns = document.querySelectorAll('.admin-only');
    
    console.log('🔍 Debug configureAdminColumns:');
    console.log('  - currentUser:', currentUser);
    console.log('  - canAccessAllPointsVente:', currentUser ? currentUser.canAccessAllPointsVente : 'undefined');
    console.log('  - Nombre de colonnes admin trouvées:', adminColumns.length);
    
    if (currentUser && currentUser.canAccessAllPointsVente) {
        // Afficher les colonnes admin pour superutilisateur/superviseur
        adminColumns.forEach(column => {
            column.style.display = '';
        });
        console.log('📊 Colonnes admin affichées pour utilisateur privilégié');
    } else {
        // Masquer les colonnes admin pour les utilisateurs simples
        adminColumns.forEach(column => {
            column.style.display = 'none';
        });
        console.log('📊 Colonnes admin masquées pour utilisateur simple');
    }
}

/**
 * Initialiser la date d'expiration par défaut (24h après maintenant)
 */
function initializeDefaultDueDate() {
    const dueDateInput = document.getElementById('due-date');
    if (dueDateInput) {
        // Créer une date 24h après maintenant
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        
        // Formater pour datetime-local (YYYY-MM-DDTHH:MM)
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        const hours = String(tomorrow.getHours()).padStart(2, '0');
        const minutes = String(tomorrow.getMinutes()).padStart(2, '0');
        
        const defaultDueDate = `${year}-${month}-${day}T${hours}:${minutes}`;
        dueDateInput.value = defaultDueDate;
        
        // Forcer la mise à jour de l'affichage
        dueDateInput.dispatchEvent(new Event('input', { bubbles: true }));
        dueDateInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Toujours définir la date par défaut, même si le champ est désactivé
        console.log('📅 Date d\'expiration par défaut définie:', defaultDueDate);
        console.log('📅 Valeur actuelle du champ:', dueDateInput.value);
        
        // Vérifier les permissions utilisateur pour la date d'expiration
        if (currentUser && !currentUser.canAccessAllPointsVente) {
            // Simple user - désactiver et griser le champ
            dueDateInput.disabled = true;
            dueDateInput.style.backgroundColor = '#f8f9fa';
            dueDateInput.style.color = '#6c757d';
            console.log('📅 Date d\'expiration désactivée pour utilisateur simple');
        } else if (currentUser) {
            // Admin/Superviseur - champ activé
            dueDateInput.disabled = false;
            dueDateInput.style.backgroundColor = '';
            dueDateInput.style.color = '';
            console.log('📅 Date d\'expiration activée pour utilisateur admin/superviseur');
        }
        // Si currentUser est null, on ne fait rien (sera géré plus tard)
    }
}

/**
 * Charger les points de vente accessibles par l'utilisateur
 */
async function loadAccessiblePointsVente() {
    try {
        const response = await fetch('/api/payment-links/points-vente', {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            populatePointsVenteSelect(result.data);
        } else {
            showError('Erreur lors du chargement des points de vente');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
        showError('Erreur lors du chargement des points de vente');
    }
}

/**
 * Remplir le select des points de vente
 */
function populatePointsVenteSelect(pointsVente) {
    const select = document.getElementById('point-vente');
    if (!select) return;
    
    // Vider le select
    select.innerHTML = '<option value="">Sélectionner un point de vente</option>';
    
    // Ajouter les options
    pointsVente.forEach(pointVente => {
        const option = document.createElement('option');
        option.value = pointVente;
        option.textContent = pointVente;
        select.appendChild(option);
    });
    
    // Si il n'y a qu'un seul point de vente, le sélectionner automatiquement
    if (pointsVente.length === 1) {
        select.value = pointsVente[0];
        console.log('Point de vente unique sélectionné automatiquement:', pointsVente[0]);
    }
    
    console.log('Points de vente chargés:', pointsVente);
}

/**
 * Valider le montant en temps réel
 */
function validateAmount(event) {
    const amount = parseFloat(event.target.value);
    const input = event.target;
    
    // Supprimer les classes d'erreur précédentes
    input.classList.remove('is-invalid', 'is-valid');
    
    if (isNaN(amount) || amount <= 0) {
        input.classList.add('is-invalid');
        return false;
    } else {
        input.classList.add('is-valid');
        return true;
    }
}

/**
 * Gérer le toggle du checkbox versement
 */
function handleVersementToggle(event) {
    const isVersement = event.target.checked;
    const clientNameInput = document.getElementById('client-name');
    const phoneNumberInput = document.getElementById('phone-number');
    const pointVenteSelect = document.getElementById('point-vente');
    
    if (isVersement) {
        // Mode versement : griser les champs client et téléphone
        clientNameInput.disabled = true;
        clientNameInput.style.backgroundColor = '#f8f9fa';
        clientNameInput.style.color = '#6c757d';
        
        phoneNumberInput.disabled = true;
        phoneNumberInput.style.backgroundColor = '#f8f9fa';
        phoneNumberInput.style.color = '#6c757d';
        
        // Générer le nom client automatique si un point de vente est sélectionné
        if (pointVenteSelect.value) {
            generateVersementClientName();
        }
    } else {
        // Mode normal : réactiver les champs
        clientNameInput.disabled = false;
        clientNameInput.style.backgroundColor = '';
        clientNameInput.style.color = '';
        
        phoneNumberInput.disabled = false;
        phoneNumberInput.style.backgroundColor = '';
        phoneNumberInput.style.color = '';
        
        // Vider le champ nom client
        clientNameInput.value = '';
    }
}

/**
 * Gérer le changement de point de vente pour générer le nom client automatique
 */
function handlePointVenteChange(event) {
    const versementCheckbox = document.getElementById('versement-checkbox');
    if (versementCheckbox && versementCheckbox.checked) {
        generateVersementClientName();
    }
}

/**
 * Générer le nom client automatique pour un versement
 */
function generateVersementClientName() {
    const pointVenteSelect = document.getElementById('point-vente');
    const clientNameInput = document.getElementById('client-name');
    
    if (pointVenteSelect.value) {
        // Générer un timestamp au format YYYY-MM-DD_HH-MM-SS
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
        const clientName = `${pointVenteSelect.value}_V_${timestamp}`;
        
        clientNameInput.value = clientName;
    }
}

/**
 * Gérer la soumission du formulaire de paiement
 */
async function handlePaymentFormSubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    
    // S'assurer que la date d'expiration est définie (24h par défaut si vide)
    let dueDate = formData.get('dueDate');
    if (!dueDate) {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        const hours = String(tomorrow.getHours()).padStart(2, '0');
        const minutes = String(tomorrow.getMinutes()).padStart(2, '0');
        dueDate = `${year}-${month}-${day}T${hours}:${minutes}`;
        console.log('📅 Date d\'expiration auto-définie à +24h:', dueDate);
    }
    
    // Vérifier si c'est un versement et générer le nom client automatiquement
    const versementCheckbox = document.getElementById('versement-checkbox');
    const isVersement = versementCheckbox && versementCheckbox.checked;
    
    let clientName = formData.get('clientName');
    if (isVersement && !clientName) {
        // Générer le nom client automatiquement pour un versement
        generateVersementClientName();
        clientName = document.getElementById('client-name').value;
    }
    
    // Validation des données
    const paymentData = {
        pointVente: formData.get('pointVente'),
        clientName: clientName,
        phoneNumber: formData.get('phoneNumber'),
        amount: parseFloat(formData.get('amount')),
        address: formData.get('address'),
        dueDate: dueDate,
        isVersement: isVersement
    };
    
    // Validation côté client
    if (!validatePaymentData(paymentData)) {
        return;
    }
    
    // Afficher le spinner de chargement
    showLoadingSpinner(true);
    
    try {
        const response = await fetch('/api/payment-links/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(paymentData)
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            // Ajouter le lien généré à la liste
            generatedPaymentLinks.unshift(result.data);
            
            // Mettre à jour l'affichage
            updatePaymentLinksDisplay();
            
            // Réinitialiser le formulaire
            form.reset();
            
            // Afficher un message de succès
            showSuccess('Lien de paiement généré avec succès!');
            
            console.log('Lien de paiement généré:', result.data);
        } else {
            showError(result.message || 'Erreur lors de la génération du lien de paiement');
        }
    } catch (error) {
        console.error('Erreur lors de la génération du lien de paiement:', error);
        showError('Erreur lors de la génération du lien de paiement');
    } finally {
        showLoadingSpinner(false);
    }
}

/**
 * Valider les données de paiement
 */
function validatePaymentData(data) {
    if (!data.pointVente) {
        showError('Veuillez sélectionner un point de vente');
        return false;
    }
    
    if (!data.amount || data.amount <= 0) {
        showError('Le montant doit être un nombre positif');
        return false;
    }
    
    // Vérifier si c'est un versement
    const versementCheckbox = document.getElementById('versement-checkbox');
    const isVersement = versementCheckbox && versementCheckbox.checked;
    
    if (isVersement) {
        // Pour un versement, le nom client est généré automatiquement
        // Pas de validation nécessaire pour les champs client et téléphone
        console.log('Mode versement détecté - validation simplifiée');
    } else {
        // Validation optionnelle des champs client en mode normal
        if (data.clientName && data.clientName.trim().length < 2) {
            showError('Le nom du client doit contenir au moins 2 caractères');
            return false;
        }
        
        // Validation du numéro de téléphone (accepte + et numéros, pas de minimum)
        if (data.phoneNumber && data.phoneNumber.trim()) {
            const phoneRegex = /^[\d\s\+\-\(\)]+$/;
            if (!phoneRegex.test(data.phoneNumber.trim())) {
                showError('Le numéro de téléphone ne peut contenir que des chiffres, espaces, +, - et ()');
                return false;
            }
        }
    }
    
    // Pas de validation minimale pour l'adresse
    
    return true;
}

/**
 * Mettre à jour l'affichage des liens de paiement dans le tableau
 */
function updatePaymentLinksDisplay() {
    console.log('🔄 Mise à jour de l\'affichage des liens de paiement');
    console.log('Liens générés:', generatedPaymentLinks.length);
    
    // Vérifier que le DOM est prêt
    if (!document.getElementById('payment-links-tbody')) {
        console.log('⏳ DOM pas encore prêt, attente de 200ms...');
        setTimeout(() => {
            updatePaymentLinksDisplay();
        }, 200);
        return;
    }
    
    // Appliquer les filtres
    applyFilters();
    console.log('Liens filtrés:', filteredPaymentLinks.length);
    
    // Trier par date de création (décroissant)
    filteredPaymentLinks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Mettre à jour le tableau
    updateTable();
    
    // Mettre à jour la pagination
    updatePagination();
    
    // Notifier le parent que le contenu a changé pour ajuster la hauteur de l'iframe
    notifyParentContentChanged();
}

/**
 * Notifier le parent que le contenu a changé pour ajuster la hauteur de l'iframe
 */
function notifyParentContentChanged() {
    try {
        // Calculer la hauteur du contenu
        const body = document.body;
        const html = document.documentElement;
        
        const height = Math.max(
            body.scrollHeight,
            body.offsetHeight,
            html.clientHeight,
            html.scrollHeight,
            html.offsetHeight
        );
        
        // Envoyer un message au parent avec la nouvelle hauteur
        window.parent.postMessage({
            action: 'resizeIframe',
            height: height
        }, '*');
        
        console.log('📏 Hauteur du contenu notifiée au parent:', height + 'px');
        
    } catch (error) {
        console.error('Erreur lors de la notification de changement de contenu:', error);
    }
}

/**
 * Créer une carte pour un lien de paiement
 */
function createPaymentLinkCard(link) {
    const statusClass = getStatusClass(link.status);
    const statusText = getStatusText(link.status);
    
    return `
        <div class="payment-link-card" data-payment-id="${link.paymentLinkId}">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <h6 class="mb-1">${link.clientName}</h6>
                    <small class="text-muted">${link.pointVente}</small>
                </div>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            
            <div class="row mb-3">
                <div class="col-6">
                    <small class="text-muted">Montant</small>
                    <div class="fw-bold">${formatCurrency(link.amount)} ${link.currency}</div>
                </div>
                <div class="col-6">
                    <small class="text-muted">Téléphone</small>
                    <div>${link.phoneNumber}</div>
                </div>
            </div>
            
            <div class="mb-3">
                <small class="text-muted">Adresse</small>
                <div>${link.address}</div>
            </div>
            
            <div class="d-flex gap-2">
                <button class="btn btn-outline-primary btn-sm" onclick="copyPaymentLink('${link.paymentUrl}')">
                    <i class="bi bi-copy"></i> Copier Lien
                </button>
                <button class="btn btn-outline-info btn-sm" onclick="checkPaymentStatus('${link.paymentLinkId}')">
                    <i class="bi bi-arrow-clockwise"></i> Vérifier Statut
                </button>
                <a href="${link.paymentUrl}" target="_blank" class="btn btn-outline-success btn-sm">
                    <i class="bi bi-box-arrow-up-right"></i> Ouvrir
                </a>
            </div>
            
            <div class="mt-2">
                <small class="text-muted">
                    Généré le ${formatDateTime(link.createdAt)}
                </small>
            </div>
        </div>
    `;
}

/**
 * Obtenir la classe CSS pour le statut
 */
function getStatusClass(status) {
    const statusClasses = {
        'opened': 'status-pending',
        'paid': 'status-completed',
        'paid_in_cash': 'status-completed',
        'expired': 'status-failed'
    };
    return statusClasses[status] || 'status-pending';
}

/**
 * Formater le montant
 */
function formatAmount(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'XOF',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

/**
 * Formater la date et l'heure
 */
function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Obtenir le texte du statut
 */
function getStatusText(status) {
    const statusTexts = {
        'opened': 'Ouvert',
        'paid': 'Payé',
        'paid_in_cash': 'Payé en espèces',
        'expired': 'Expiré'
    };
    return statusTexts[status] || 'Inconnu';
}

/**
 * Vérifier le statut d'un paiement
 */
async function checkPaymentStatus(paymentLinkId) {
    try {
        const response = await fetch(`/api/payment-links/status/${paymentLinkId}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            // Mettre à jour le lien dans la liste
            const linkIndex = generatedPaymentLinks.findIndex(link => link.paymentLinkId === paymentLinkId);
            if (linkIndex !== -1) {
                generatedPaymentLinks[linkIndex] = { ...generatedPaymentLinks[linkIndex], ...result.data };
                updatePaymentLinksDisplay();
                
                // Afficher une notification avec les informations du payeur si disponibles
                let message = 'Statut mis à jour';
                if (result.data.payerName) {
                    message += ` - Payeur: ${result.data.payerName}`;
                }
                showSuccess(message);
            }
        } else {
            showError(result.message || 'Erreur lors de la vérification du statut');
        }
    } catch (error) {
        console.error('Erreur lors de la vérification du statut:', error);
        showError('Erreur lors de la vérification du statut');
    }
}

/**
 * Copier le lien de paiement dans le presse-papiers
 */
async function copyPaymentLink(url) {
    try {
        await navigator.clipboard.writeText(url);
        showSuccess('Lien copié dans le presse-papiers');
    } catch (error) {
        console.error('Erreur lors de la copie:', error);
        showError('Erreur lors de la copie du lien');
    }
}

/**
 * Gérer la déconnexion
 */
async function handleLogout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
        window.location.href = '/login.html';
    }
}

/**
 * Afficher le spinner de chargement
 */
function showLoadingSpinner(show) {
    const spinner = document.querySelector('.loading-spinner');
    if (spinner) {
        if (show) {
            spinner.classList.add('show');
        } else {
            spinner.classList.remove('show');
        }
    }
}

/**
 * Afficher un message de succès
 */
function showSuccess(message) {
    // Créer une alerte Bootstrap
    const alert = document.createElement('div');
    alert.className = 'alert alert-success alert-dismissible fade show position-fixed';
    alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alert.innerHTML = `
        <i class="bi bi-check-circle"></i> ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alert);
    
    // Supprimer automatiquement après 5 secondes
    setTimeout(() => {
        if (alert.parentNode) {
            alert.parentNode.removeChild(alert);
        }
    }, 5000);
}

/**
 * Afficher un message d'erreur
 */
function showError(message) {
    // Créer une alerte Bootstrap
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger alert-dismissible fade show position-fixed';
    alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alert.innerHTML = `
        <i class="bi bi-exclamation-triangle"></i> ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alert);
    
    // Supprimer automatiquement après 7 secondes
    setTimeout(() => {
        if (alert.parentNode) {
            alert.parentNode.removeChild(alert);
        }
    }, 7000);
}

/**
 * Afficher un popup détaillé avec le statut du paiement
 */
function showPaymentStatusPopup(paymentData) {
    // Supprimer tout modal existant
    const existingModal = document.getElementById('payment-status-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Préparer les informations à afficher
    const statusText = getStatusText(paymentData.status);
    const statusClass = getStatusClass(paymentData.status);
    const statusIcon = getStatusIcon(paymentData.status);
    
    // Formater la date si disponible
    let createdDate = 'Non disponible';
    if (paymentData.createdAt) {
        const date = new Date(paymentData.createdAt);
        createdDate = date.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // Créer le modal HTML
    const modalHTML = `
        <div class="modal fade" id="payment-status-modal" tabindex="-1" aria-labelledby="paymentStatusModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title" id="paymentStatusModalLabel">
                            <i class="bi bi-search-heart"></i> Statut du Paiement
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-12 text-center mb-4">
                                <div class="status-display">
                                    <i class="${statusIcon} fs-1 ${statusClass === 'status-completed' ? 'text-success' : statusClass === 'status-failed' ? 'text-danger' : 'text-warning'}"></i>
                                    <h3 class="mt-2 ${statusClass === 'status-completed' ? 'text-success' : statusClass === 'status-failed' ? 'text-danger' : 'text-warning'}">${statusText}</h3>
                                </div>
                            </div>
                        </div>
                        
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="form-label fw-bold">ID de Paiement</label>
                                <div class="form-control-plaintext bg-light p-2 rounded">${paymentData.paymentLinkId || 'N/A'}</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label class="form-label fw-bold">Point de Vente</label>
                                <div class="form-control-plaintext bg-light p-2 rounded">${paymentData.pointVente || 'N/A'}</div>
                            </div>
                        </div>
                        
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="form-label fw-bold">Client</label>
                                <div class="form-control-plaintext bg-light p-2 rounded">${paymentData.clientName || 'N/A'}</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label class="form-label fw-bold">Téléphone</label>
                                <div class="form-control-plaintext bg-light p-2 rounded">${paymentData.phoneNumber || 'N/A'}</div>
                            </div>
                        </div>
                        
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="form-label fw-bold">Montant</label>
                                <div class="form-control-plaintext bg-light p-2 rounded text-success fs-5 fw-bold">
                                    ${formatCurrency(paymentData.amount)} ${paymentData.currency || 'XOF'}
                                </div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label class="form-label fw-bold">Date de Création</label>
                                <div class="form-control-plaintext bg-light p-2 rounded">${createdDate}</div>
                            </div>
                        </div>
                        
                        ${paymentData.payerName ? `
                        <div class="row">
                            <div class="col-12 mb-3">
                                <label class="form-label fw-bold">Payeur</label>
                                <div class="form-control-plaintext bg-success text-white p-2 rounded fw-bold">
                                    <i class="bi bi-person-check"></i> ${paymentData.payerName}
                                </div>
                            </div>
                        </div>
                        ` : ''}
                        
                        ${paymentData.address ? `
                        <div class="row">
                            <div class="col-12 mb-3">
                                <label class="form-label fw-bold">Adresse</label>
                                <div class="form-control-plaintext bg-light p-2 rounded">${paymentData.address}</div>
                            </div>
                        </div>
                        ` : ''}
                        
                        <div class="row">
                            <div class="col-12">
                                <label class="form-label fw-bold">Référence</label>
                                <div class="form-control-plaintext bg-light p-2 rounded font-monospace">${paymentData.reference || 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-primary" onclick="copyPaymentLink('${paymentData.paymentUrl || ''}')">
                            <i class="bi bi-copy"></i> Copier Lien
                        </button>
                        <a href="${paymentData.paymentUrl || '#'}" target="_blank" class="btn btn-success">
                            <i class="bi bi-box-arrow-up-right"></i> Ouvrir Paiement
                        </a>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Ajouter le modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('payment-status-modal'));
    modal.show();
    
    // Supprimer le modal du DOM quand il est fermé
    document.getElementById('payment-status-modal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

/**
 * Obtenir l'icône appropriée pour le statut
 */
function getStatusIcon(status) {
    const statusIcons = {
        'opened': 'bi-clock-history',
        'paid': 'bi-check-circle-fill',
        'expired': 'bi-x-circle-fill',
        'cancelled': 'bi-x-circle'
    };
    return statusIcons[status] || 'bi-question-circle';
}

/**
 * Afficher un popup de résumé après l'actualisation de tous les paiements
 */
function showUpdateSummaryPopup(totalChecked, updated) {
    // Supprimer tout modal existant
    const existingModal = document.getElementById('update-summary-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Déterminer l'icône et la couleur en fonction des résultats
    const hasUpdates = updated > 0;
    const summaryIcon = hasUpdates ? 'bi-check-circle-fill text-success' : 'bi-info-circle-fill text-info';
    const headerClass = hasUpdates ? 'bg-success' : 'bg-info';
    
    // Créer le modal HTML
    const modalHTML = `
        <div class="modal fade" id="update-summary-modal" tabindex="-1" aria-labelledby="updateSummaryModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header ${headerClass} text-white">
                        <h5 class="modal-title" id="updateSummaryModalLabel">
                            <i class="bi bi-arrow-clockwise"></i> Actualisation Terminée
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body text-center">
                        <div class="mb-4">
                            <i class="${summaryIcon} fs-1"></i>
                        </div>
                        
                        <div class="row">
                            <div class="col-6">
                                <div class="card bg-light">
                                    <div class="card-body">
                                        <h4 class="card-title text-primary">${totalChecked}</h4>
                                        <p class="card-text">Paiement(s) vérifiés</p>
                                    </div>
                                </div>
                            </div>
                            <div class="col-6">
                                <div class="card ${hasUpdates ? 'bg-success text-white' : 'bg-light'}">
                                    <div class="card-body">
                                        <h4 class="card-title">${updated}</h4>
                                        <p class="card-text">Mis à jour</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="mt-4">
                            <p class="mb-0">
                                ${hasUpdates ? 
                                    `<strong class="text-success">✅ ${updated} paiement(s) ont été mis à jour avec leur nouveau statut.</strong>` :
                                    `<span class="text-muted">ℹ️ Tous les paiements vérifiés sont déjà à jour.</span>`
                                }
                            </p>
                        </div>
                        
                        <small class="text-muted">
                            <i class="bi bi-clock"></i> Vérification des paiements ouverts des 2 derniers jours terminée
                        </small>
                    </div>
                    <div class="modal-footer justify-content-center">
                        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                            <i class="bi bi-check"></i> Parfait !
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Ajouter le modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('update-summary-modal'));
    modal.show();
    
    // Supprimer le modal du DOM quand il est fermé
    document.getElementById('update-summary-modal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

/**
 * Formater une valeur monétaire
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'XOF',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}


/**
 * Charger les liens de paiement existants depuis la base de données
 */
async function loadExistingPaymentLinks() {
    try {
        console.log('🔄 Chargement des liens de paiement existants...');
        
        const response = await fetch('/api/payment-links/list', {
            method: 'GET',
            credentials: 'include'
        });
        
        console.log('Réponse de l\'API /api/payment-links/list:', response.status);
        
        const result = await response.json();
        console.log('Données reçues:', result);
        
                if (result.success && result.data) {
                    generatedPaymentLinks = result.data;
                    console.log('✅ Liens de paiement chargés:', generatedPaymentLinks.length);
                    console.log('Détails des liens:', generatedPaymentLinks);
                    
                    // Debug: vérifier les données créateur/timestamp
                    if (generatedPaymentLinks.length > 0) {
                        console.log('🔍 Debug premier lien:');
                        const firstLink = generatedPaymentLinks[0];
                        console.log('  - createdBy:', firstLink.createdBy);
                        console.log('  - updatedAt:', firstLink.updatedAt);
                        console.log('  - createdAt:', firstLink.createdAt);
                    }
            
            // Forcer l'affichage du tableau
            setTimeout(() => {
                updatePaymentLinksDisplay();
                // Notifier le parent après le chargement initial
                setTimeout(() => {
                    notifyParentContentChanged();
                }, 200);
            }, 100);
        } else {
            console.error('❌ Erreur lors du chargement des liens de paiement:', result.message);
        }
    } catch (error) {
        console.error('❌ Erreur lors du chargement des liens de paiement:', error);
    }
}

/**
 * Initialiser les filtres
 */
function initFilters() {
    // Event listeners pour les filtres
    document.getElementById('apply-filters')?.addEventListener('click', function() {
        currentPage = 1;
        updatePaymentLinksDisplay();
    });
    
    document.getElementById('clear-filters')?.addEventListener('click', function() {
        document.getElementById('filter-status').value = '';
        document.getElementById('filter-name').value = '';
        document.getElementById('filter-phone').value = '';
        currentPage = 1;
        updatePaymentLinksDisplay();
    });
    
    // Filtrage automatique lors de la saisie
    document.getElementById('filter-name')?.addEventListener('input', function() {
        currentPage = 1;
        updatePaymentLinksDisplay();
    });
    
    document.getElementById('filter-phone')?.addEventListener('input', function() {
        currentPage = 1;
        updatePaymentLinksDisplay();
    });
    
    document.getElementById('filter-status')?.addEventListener('change', function() {
        currentPage = 1;
        updatePaymentLinksDisplay();
    });
}

/**
 * Appliquer les filtres
 */
function applyFilters() {
    const statusFilter = document.getElementById('filter-status')?.value || '';
    const nameFilter = document.getElementById('filter-name')?.value.toLowerCase() || '';
    const phoneFilter = document.getElementById('filter-phone')?.value || '';
    
    filteredPaymentLinks = generatedPaymentLinks.filter(link => {
        const matchesStatus = !statusFilter || link.status === statusFilter;
        const matchesName = !nameFilter || (link.clientName && link.clientName.toLowerCase().includes(nameFilter));
        const matchesPhone = !phoneFilter || (link.phoneNumber && link.phoneNumber.includes(phoneFilter));
        
        return matchesStatus && matchesName && matchesPhone;
    });
}

/**
 * Mettre à jour le tableau
 */
function updateTable() {
    const tbody = document.getElementById('payment-links-tbody');
    console.log('🔄 Mise à jour du tableau');
    console.log('Element tbody trouvé:', !!tbody);
    console.log('Liens filtrés à afficher:', filteredPaymentLinks.length);
    
    if (!tbody) {
        console.error('❌ Element tbody non trouvé - attente de 100ms et nouvelle tentative');
        setTimeout(() => {
            updateTable();
        }, 100);
        return;
    }
    
        if (filteredPaymentLinks.length === 0) {
            console.log('📝 Affichage du message "Aucun lien trouvé"');
            
            // Calculer le nombre de colonnes selon les permissions
            const baseColumns = 8; // Actions, Client, Téléphone, Montant, Statut, Date Création, Date d'expiration, Point de Vente
            const adminColumns = (currentUser && currentUser.canAccessAllPointsVente) ? 2 : 0; // Créateur, Timestamp
            const totalColumns = baseColumns + adminColumns;
            
            console.log('🔍 Debug colspan:');
            console.log('  - baseColumns:', baseColumns);
            console.log('  - adminColumns:', adminColumns);
            console.log('  - totalColumns:', totalColumns);
            console.log('  - canAccessAllPointsVente:', currentUser ? currentUser.canAccessAllPointsVente : 'undefined');
            
            tbody.innerHTML = `
                <tr>
                    <td colspan="${totalColumns}" class="text-center text-muted py-4">
                        <i class="bi bi-credit-card-2-front display-6"></i>
                        <p class="mt-2">Aucun lien de paiement trouvé</p>
                    </td>
                </tr>
            `;
            return;
        }
    
    // Calculer les liens à afficher pour la page courante
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const linksToShow = filteredPaymentLinks.slice(startIndex, endIndex);
    
    console.log('📊 Génération des lignes du tableau pour la page', currentPage);
    console.log('  - Liens totaux:', filteredPaymentLinks.length);
    console.log('  - Liens à afficher:', linksToShow.length);
    console.log('  - Index de début:', startIndex, 'Index de fin:', endIndex);
    
    tbody.innerHTML = linksToShow.map(link => createTableRow(link)).join('');
    console.log('✅ Tableau mis à jour avec', linksToShow.length, 'lignes');
}

/**
 * Créer une ligne de tableau pour un lien de paiement
 */
function createTableRow(link) {
    const statusClass = getStatusClass(link.status);
    const statusText = getStatusText(link.status);
    const formattedAmount = formatAmount(link.amount);
    const formattedDate = formatDateTime(link.createdAt);
    
    // Formater la date d'expiration
    const formattedDueDate = link.dueDate ? formatDateTime(link.dueDate) : '-';

    // Formater le timestamp (updatedAt)
    const formattedTimestamp = link.updatedAt ? formatDateTime(link.updatedAt) : '-';

    // Debug: vérifier les données du lien
    console.log('🔍 Debug createTableRow pour:', link.paymentLinkId);
    console.log('  - createdBy:', link.createdBy);
    console.log('  - updatedAt:', link.updatedAt);
    console.log('  - formattedTimestamp:', formattedTimestamp);

    return `
        <tr>
            <td>
                <div class="actions-container">
                    <button class="btn btn-primary btn-sm" onclick="copyPaymentUrl('${link.paymentLinkId}')" title="Copier le lien">
                        <i class="bi bi-copy me-1"></i>Copier
                    </button>
                    <button class="btn btn-outline-info btn-sm" onclick="checkPaymentStatus('${link.paymentLinkId}')" title="Vérifier le statut">
                        <i class="bi bi-arrow-clockwise"></i>
                    </button>
                    <button class="btn btn-outline-success btn-sm" onclick="openPaymentUrl('${link.paymentLinkId}')" title="Ouvrir le lien">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </button>
                    ${link.status === 'paid' && currentUser && currentUser.role === 'superviseur' ? `
                    <button class="btn btn-outline-warning btn-sm" onclick="archivePaymentLink('${link.paymentLinkId}')" title="Archiver le lien">
                        <i class="bi bi-archive"></i>
                    </button>
                    ` : ''}
                    ${['opened', 'expired'].includes(link.status) ? `
                    <button class="btn btn-outline-danger btn-sm" onclick="deletePaymentLink('${link.paymentLinkId}')" title="Supprimer le lien">
                        <i class="bi bi-trash"></i>
                    </button>
                    ` : ''}
                </div>
            </td>
            <td>${link.clientName || '-'}</td>
            <td>${link.phoneNumber || '-'}</td>
            <td>${formattedAmount}</td>
            <td>
                <span class="badge ${statusClass}">${statusText}</span>
            </td>
            <td>
                <small>${formattedDate}</small>
            </td>
            <td>
                <small>${formattedDueDate}</small>
            </td>
            <td>${link.pointVente}</td>
            <td class="admin-only" style="display: ${(currentUser && currentUser.canAccessAllPointsVente) ? '' : 'none'};">
                <small>${link.createdBy || '-'}</small>
            </td>
            <td class="admin-only" style="display: ${(currentUser && currentUser.canAccessAllPointsVente) ? '' : 'none'};">
                <small>${formattedTimestamp}</small>
            </td>
        </tr>
    `;
}

/**
 * Mettre à jour la pagination
 */
function updatePagination() {
    const pagination = document.getElementById('pagination');
    const paginationInfo = document.getElementById('pagination-info');
    
    if (!pagination || !paginationInfo) return;
    
    const totalPages = Math.ceil(filteredPaymentLinks.length / itemsPerPage);
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, filteredPaymentLinks.length);
    
    // Afficher les informations de pagination
    if (filteredPaymentLinks.length > 0) {
        paginationInfo.textContent = `Affichage de ${startItem} à ${endItem} sur ${filteredPaymentLinks.length} liens`;
    } else {
        paginationInfo.textContent = 'Aucun lien trouvé';
    }

    // Générer les boutons de pagination
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let paginationHTML = '';

    // Bouton Précédent
    if (currentPage > 1) {
        paginationHTML += `
            <li class="page-item">
                <a class="page-link" href="#" onclick="changePage(${currentPage - 1}); return false;">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;
    } else {
        paginationHTML += `
            <li class="page-item disabled">
                <span class="page-link">
                    <i class="bi bi-chevron-left"></i>
                </span>
            </li>
        `;
    }

    // Numéros de pages
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    // Page 1 si pas dans la plage visible
    if (startPage > 1) {
        paginationHTML += `
            <li class="page-item">
                <a class="page-link" href="#" onclick="changePage(1); return false;">1</a>
            </li>
        `;
        if (startPage > 2) {
            paginationHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }

    // Pages visibles
    for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
            paginationHTML += `
                <li class="page-item active">
                    <span class="page-link">${i}</span>
                </li>
            `;
        } else {
            paginationHTML += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="changePage(${i}); return false;">${i}</a>
                </li>
            `;
        }
    }

    // Dernière page si pas dans la plage visible
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        paginationHTML += `
            <li class="page-item">
                <a class="page-link" href="#" onclick="changePage(${totalPages}); return false;">${totalPages}</a>
            </li>
        `;
    }

    // Bouton Suivant
    if (currentPage < totalPages) {
        paginationHTML += `
            <li class="page-item">
                <a class="page-link" href="#" onclick="changePage(${currentPage + 1}); return false;">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;
    } else {
        paginationHTML += `
            <li class="page-item disabled">
                <span class="page-link">
                    <i class="bi bi-chevron-right"></i>
                </span>
            </li>
        `;
    }

    pagination.innerHTML = paginationHTML;
}

/**
 * Changer de page
 */
function changePage(newPage) {
    if (newPage < 1 || newPage > Math.ceil(filteredPaymentLinks.length / itemsPerPage)) {
        return;
    }
    
    currentPage = newPage;
    console.log('📄 Changement vers la page:', currentPage);
    
    // Mettre à jour le tableau et la pagination
    updateTable();
    updatePagination();
}

/**
 * Archiver les anciens liens de paiement (statut "Payé" et date d'expiration > 1 semaine)
 */
async function handleArchiveOldLinks() {
    // Demander confirmation
    const confirmationMessage = `
Archiver les anciens liens de paiement ?

Cette action va archiver tous les liens avec le statut "Payé" 
dont la date d'expiration est antérieure à il y a une semaine.

Les liens archivés ne seront plus visibles dans le tableau principal 
mais resteront consultables dans les archives.
    `.trim();

    if (!confirm(confirmationMessage)) {
        return;
    }

    try {
        console.log('🗄️ Début de l\'archivage des anciens liens...');

        const response = await fetch('/api/payment-links/archive-old', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success) {
            showSuccess(`Archivage terminé : ${result.archivedCount} liens archivés`);
            
            // Recharger la liste des liens
            loadExistingPaymentLinks();
        } else {
            showError(result.message || 'Erreur lors de l\'archivage');
        }
    } catch (error) {
        console.error('Erreur lors de l\'archivage:', error);
        showError('Erreur lors de l\'archivage des liens');
    }
}

/**
 * Voir les archives (pour superviseurs seulement)
 */
async function handleViewArchives() {
    try {
        console.log('📚 Ouverture des archives...');

        const response = await fetch('/api/payment-links/archives', {
            method: 'GET',
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success) {
            // Afficher les archives dans une modal ou nouvelle section
            showArchivesModal(result.data);
        } else {
            showError(result.message || 'Erreur lors du chargement des archives');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des archives:', error);
        showError('Erreur lors du chargement des archives');
    }
}

/**
 * Afficher les archives dans une modal
 */
function showArchivesModal(archives) {
    // Créer le contenu HTML pour les archives
    let archivesHTML = '<div class="table-responsive"><table class="table table-striped">';
    archivesHTML += '<thead class="table-dark"><tr>';
    archivesHTML += '<th>Semaine</th><th>Nombre de liens</th><th>Actions</th>';
    archivesHTML += '</tr></thead><tbody>';

    archives.forEach(week => {
        archivesHTML += `
            <tr>
                <td>${week.weekLabel}</td>
                <td>${week.count} liens</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="viewWeekArchives('${week.weekStart}')">
                        <i class="bi bi-eye"></i> Voir
                    </button>
                </td>
            </tr>
        `;
    });

    archivesHTML += '</tbody></table></div>';

    // Créer et afficher la modal
    const modalHTML = `
        <div class="modal fade" id="archivesModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="bi bi-clock-history"></i> Archives des Liens de Paiement
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${archivesHTML}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Supprimer l'ancienne modal si elle existe
    const existingModal = document.getElementById('archivesModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Ajouter la nouvelle modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Afficher la modal
    const modal = new bootstrap.Modal(document.getElementById('archivesModal'));
    modal.show();
}

/**
 * Voir les archives d'une semaine spécifique
 */
async function viewWeekArchives(weekStart) {
    try {
        console.log('📅 Chargement des archives pour la semaine:', weekStart);

        const response = await fetch(`/api/payment-links/archives/${weekStart}`, {
            method: 'GET',
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success) {
            showWeekArchivesModal(weekStart, result.data);
        } else {
            showError(result.message || 'Erreur lors du chargement des archives de la semaine');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des archives de la semaine:', error);
        showError('Erreur lors du chargement des archives de la semaine');
    }
}

/**
 * Afficher les archives d'une semaine spécifique
 */
function showWeekArchivesModal(weekStart, links) {
    // Créer le contenu HTML pour les liens de la semaine
    let linksHTML = '<div class="table-responsive"><table class="table table-striped table-sm">';
    linksHTML += '<thead class="table-dark"><tr>';
    linksHTML += '<th>Client</th><th>Montant</th><th>Point de Vente</th><th>Date Création</th><th>Date Expiration</th>';
    linksHTML += '</tr></thead><tbody>';

    links.forEach(link => {
        const formattedAmount = formatAmount(link.amount);
        const formattedCreatedDate = formatDateTime(link.createdAt);
        const formattedDueDate = link.dueDate ? formatDateTime(link.dueDate) : '-';

        linksHTML += `
            <tr>
                <td>${link.clientName || '-'}</td>
                <td>${formattedAmount}</td>
                <td>${link.pointVente}</td>
                <td><small>${formattedCreatedDate}</small></td>
                <td><small>${formattedDueDate}</small></td>
            </tr>
        `;
    });

    linksHTML += '</tbody></table></div>';

    // Créer et afficher la modal
    const modalHTML = `
        <div class="modal fade" id="weekArchivesModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="bi bi-calendar-week"></i> Archives - Semaine du ${weekStart}
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-muted">${links.length} liens archivés pour cette semaine</p>
                        ${linksHTML}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Supprimer l'ancienne modal si elle existe
    const existingModal = document.getElementById('weekArchivesModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Ajouter la nouvelle modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Afficher la modal
    const modal = new bootstrap.Modal(document.getElementById('weekArchivesModal'));
    modal.show();
}

/**
 * Copier l'URL de paiement
 */
function copyPaymentUrl(paymentLinkId) {
    const link = generatedPaymentLinks.find(l => l.paymentLinkId === paymentLinkId);
    if (link && link.paymentUrl) {
        navigator.clipboard.writeText(link.paymentUrl).then(() => {
            showSuccess('Lien copié dans le presse-papiers');
        }).catch(() => {
            showError('Erreur lors de la copie du lien');
        });
    }
}

/**
 * Ouvrir l'URL de paiement
 */
function openPaymentUrl(paymentLinkId) {
    const link = generatedPaymentLinks.find(l => l.paymentLinkId === paymentLinkId);
    if (link && link.paymentUrl) {
        window.open(link.paymentUrl, '_blank');
    }
}

/**
 * Archiver un lien de paiement individuel (pour superviseurs seulement)
 */
async function archivePaymentLink(paymentLinkId) {
    const link = generatedPaymentLinks.find(l => l.paymentLinkId === paymentLinkId);
    if (!link) {
        showError('Lien de paiement non trouvé');
        return;
    }

    // Vérifier que le lien a le statut "paid"
    if (link.status !== 'paid') {
        showError('Seuls les liens avec le statut "Payé" peuvent être archivés');
        return;
    }

    // Demander confirmation
    const confirmationMessage = `
Archiver ce lien de paiement ?

Client: ${link.clientName}
Montant: ${formatAmount(link.amount)} ${link.currency}
Date de création: ${formatDateTime(link.createdAt)}

Cette action va archiver ce lien de paiement.
Le lien archivé ne sera plus visible dans le tableau principal 
mais restera consultable dans les archives.
    `.trim();

    if (!confirm(confirmationMessage)) {
        return;
    }

    try {
        console.log('🗄️ Archivage du lien de paiement:', paymentLinkId);

        const response = await fetch('/api/payment-links/archive-individual', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                paymentLinkId: paymentLinkId
            })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Lien de paiement archivé avec succès');
            
            // Recharger la liste des liens
            loadExistingPaymentLinks();
        } else {
            showError(result.message || 'Erreur lors de l\'archivage du lien');
        }
    } catch (error) {
        console.error('Erreur lors de l\'archivage du lien:', error);
        showError('Erreur lors de l\'archivage du lien de paiement');
    }
}

/**
 * Supprimer un lien de paiement
 */
async function deletePaymentLink(paymentLinkId) {
    // Trouver le lien à supprimer
    const link = generatedPaymentLinks.find(l => l.paymentLinkId === paymentLinkId);
    if (!link) {
        showError('Lien de paiement non trouvé');
        return;
    }
    
    // Créer un message de confirmation détaillé
    const confirmationMessage = `
Êtes-vous sûr de vouloir supprimer ce lien de paiement ?

📋 Détails du lien :
• Point de Vente : ${link.pointVente}
• Client : ${link.clientName || 'Non renseigné'}
• Montant : ${formatAmount(link.amount)}
• Statut : ${getStatusText(link.status)}

⚠️ Cette action est irréversible et supprimera définitivement le lien.
    `.trim();
    
    // Demander confirmation avec les détails
    if (!confirm(confirmationMessage)) {
        return;
    }
    
    try {
        console.log('🗑️ Suppression du lien de paiement:', paymentLinkId);
        
        const response = await fetch(`/api/payment-links/${paymentLinkId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Supprimer le lien de la liste locale
            generatedPaymentLinks = generatedPaymentLinks.filter(link => link.paymentLinkId !== paymentLinkId);
            
            // Mettre à jour l'affichage
            updatePaymentLinksDisplay();
            
            showSuccess('Lien de paiement supprimé avec succès');
        } else {
            showError(result.message || 'Erreur lors de la suppression du lien');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        showError('Erreur lors de la suppression du lien');
    }
}

/**
 * Extraire l'ID de paiement d'une URL de paiement Bictorys
 */
function extractPaymentIdFromUrl(url) {
    try {
        // Pattern pour extraire l'ID du lien de paiement
        // Ex: https://api.bictorys.com/paymentlink-management/v1/pay/b365cb6b-fd74-4555-b39c-8e5a9f332e4d?token=...
        const regex = /\/pay\/([a-f0-9-]{36})/i;
        const match = url.match(regex);
        
        if (match && match[1]) {
            return match[1];
        }
        
        console.error('Format d\'URL invalide:', url);
        return null;
    } catch (error) {
        console.error('Erreur lors de l\'extraction de l\'ID:', error);
        return null;
    }
}

/**
 * Vérifier le statut d'un paiement en utilisant son URL complète
 */
async function verifyPaymentByUrl() {
    const urlInput = document.getElementById('payment-url-input');
    const verifyBtn = document.getElementById('verify-payment-btn');
    
    if (!urlInput || !verifyBtn) {
        console.error('Éléments DOM introuvables');
        return;
    }
    
    const paymentUrl = urlInput.value.trim();
    
    if (!paymentUrl) {
        showError('Veuillez coller un lien de paiement');
        return;
    }
    
    // Extraire l'ID du paiement de l'URL
    const paymentId = extractPaymentIdFromUrl(paymentUrl);
    
    if (!paymentId) {
        showError('URL de paiement invalide. Vérifiez le format du lien.');
        return;
    }
    
    // Désactiver le bouton et afficher le chargement
    const originalText = verifyBtn.innerHTML;
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Vérification...';
    
    try {
        console.log('Vérification du statut pour le paiement:', paymentId);
        
        const response = await fetch(`/api/payment-links/status/${paymentId}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            // Afficher un popup détaillé avec toutes les informations du paiement
            showPaymentStatusPopup(result.data)
            
            // Mettre à jour l'affichage si le paiement est dans la liste actuelle
            const linkIndex = generatedPaymentLinks.findIndex(link => link.paymentLinkId === paymentId);
            if (linkIndex !== -1) {
                generatedPaymentLinks[linkIndex] = { ...generatedPaymentLinks[linkIndex], ...result.data };
                updatePaymentLinksDisplay();
            } else {
                // Recharger la liste pour inclure le paiement vérifié s'il n'était pas visible
                loadPaymentLinks();
            }
            
            // Vider le champ
            urlInput.value = '';
            
        } else {
            showError(result.message || 'Erreur lors de la vérification du statut');
        }
        
    } catch (error) {
        console.error('Erreur lors de la vérification:', error);
        showError('Erreur lors de la vérification du statut');
    } finally {
        // Réactiver le bouton
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = originalText;
    }
}

/**
 * Actualiser tous les paiements ouverts des 2 derniers jours
 */
async function updateAllOpenPayments() {
    const updateBtn = document.getElementById('update-all-payments-btn');
    
    if (!updateBtn) {
        console.error('Bouton d\'actualisation introuvable');
        return;
    }
    
    // Demander confirmation
    const confirmUpdate = confirm(
        'Voulez-vous vraiment vérifier le statut de tous les paiements ouverts des 2 derniers jours ? ' +
        'Cette opération peut prendre quelques instants.'
    );
    
    if (!confirmUpdate) {
        return;
    }
    
    // Désactiver le bouton et afficher le chargement
    const originalText = updateBtn.innerHTML;
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Actualisation...';
    
    try {
        console.log('Début de l\'actualisation des paiements ouverts des 2 derniers jours');
        
        const response = await fetch('/api/payment-links/update-open-payments', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            const { totalChecked, updated } = result.data;
            
            // Afficher un popup de résumé de l'actualisation
            showUpdateSummaryPopup(totalChecked, updated);
            
            // Recharger la liste des paiements pour afficher les mises à jour
            loadPaymentLinks();
            
        } else {
            showError(result.message || 'Erreur lors de l\'actualisation des paiements');
        }
        
    } catch (error) {
        console.error('Erreur lors de l\'actualisation:', error);
        showError('Erreur lors de l\'actualisation des paiements');
    } finally {
        // Réactiver le bouton
        updateBtn.disabled = false;
        updateBtn.innerHTML = originalText;
    }
}