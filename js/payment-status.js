// ========================================
// GESTION DES STATUTS DE PAIEMENT POS
// ========================================
// 3 statuts: A (En attente), M (Payé), C (Créance)

/**
 * Configuration des statuts de paiement
 */
const PAYMENT_STATUS_CONFIG = {
    'A': {
        label: 'A',
        title: 'En attente de paiement',
        class: 'bg-warning text-dark',
        icon: '',
        clickable: true
    },
    'P': {
        label: 'P',
        title: 'Payé',
        class: 'bg-success',
        icon: '✅',
        clickable: true
    },
    'C': {
        label: 'C',
        title: 'Créance (montant restant dû)',
        class: 'bg-danger',
        icon: '⚠️',
        clickable: true
    }
};

/**
 * Générer le HTML du badge de statut de paiement
 * @param {string} status - Le statut (A, O, E, P, M)
 * @param {string} commandeId - L'ID de la commande
 * @returns {string} HTML du badge
 */
function getPaymentStatusBadge(status, commandeId) {
    const config = PAYMENT_STATUS_CONFIG[status] || PAYMENT_STATUS_CONFIG['A'];
    const cursorClass = config.clickable ? 'cursor-pointer' : '';
    
    return `
        <span class="badge ${config.class} payment-status-badge ${cursorClass}" 
              data-status="${status}"
              data-commande-id="${commandeId}"
              data-clickable="${config.clickable}"
              title="${config.title}">
            ${config.icon} ${config.label}
        </span>
    `;
}

/**
 * Récupérer le statut de paiement d'une commande
 * @param {string} commandeId - L'ID de la commande
 * @returns {Promise<object>} Résultat avec le statut
 */
async function getCommandePaymentStatus(commandeId) {
    try {
        const response = await fetch(`/api/orders/${commandeId}/payment-status`, {
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success) {
            return result.data;
        } else {
            console.error('Erreur récupération statut:', result.message);
            return { posStatus: 'A', hasPaymentLink: false };
        }
    } catch (error) {
        console.error('Erreur récupération statut:', error);
        return { posStatus: 'A', hasPaymentLink: false };
    }
}

/**
 * Récupérer les statuts de paiement pour plusieurs commandes
 * @param {Array} commandeIds - Liste des IDs de commandes
 * @returns {Promise<Map>} Map commandeId → statut
 */
async function loadPaymentStatuses(commandeIds) {
    const statusMap = new Map();
    
    // Traiter par lots de 10 pour éviter de surcharger le serveur
    const batchSize = 10;
    for (let i = 0; i < commandeIds.length; i += batchSize) {
        const batch = commandeIds.slice(i, i + batchSize);
        
        const promises = batch.map(async (commandeId) => {
            try {
                const data = await getCommandePaymentStatus(commandeId);
                statusMap.set(commandeId, data.posStatus);
            } catch (error) {
                console.error(`Erreur statut ${commandeId}:`, error);
                statusMap.set(commandeId, 'A');
            }
        });
        
        await Promise.all(promises);
    }
    
    return statusMap;
}

/**
 * Afficher le menu contextuel pour un statut de paiement
 * @param {string} commandeId - L'ID de la commande
 * @param {string} status - Le statut actuel
 * @param {HTMLElement} badgeElement - L'élément du badge
 */
function showPaymentStatusMenu(commandeId, status, badgeElement) {
    // Fermer les menus existants
    document.querySelectorAll('.payment-status-menu').forEach(m => m.remove());
    
    const rect = badgeElement.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'payment-status-menu';
    menu.style.cssText = `
        position: fixed;
        top: ${rect.bottom + 5}px;
        left: ${rect.left}px;
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 250px;
    `;
    
    let menuHTML = '';
    
    // Option: Rafraîchir le statut (pour O, E, PP et M)
    if (status === 'O' || status === 'E' || status === 'PP' || status === 'M') {
        let buttonText = 'Vérifier le statut';
        let icon = '🔄';
        
        // Message spécifique pour les paiements manuels
        if (status === 'M') {
            buttonText = 'Vérifier paiement Bictorys';
            icon = '⚠️';
        }
        
        menuHTML += `
            <button class="payment-menu-item" onclick="refreshPaymentStatus('${commandeId}')">
                <span class="menu-icon">${icon}</span>
                <span class="menu-text">${buttonText}</span>
            </button>
        `;
    }
    
    // Option: Réinitialiser le paiement manuel (pour M)
    if (status === 'M') {
        menuHTML += `
            <button class="payment-menu-item" onclick="resetManualPayment('${commandeId}')">
                <span class="menu-icon">↩️</span>
                <span class="menu-text">Réinitialiser (remettre en Attente)</span>
            </button>
        `;
    }
    
    // Option: Marquer reste comme payé manuellement (pour PP)
    if (status === 'PP') {
        menuHTML += `
            <button class="payment-menu-item" onclick="markRestAsManualPayment('${commandeId}')">
                <span class="menu-icon">🟣</span>
                <span class="menu-text">Marquer reste comme payé manuellement</span>
            </button>
        `;
    }
    
    // Option: Marquer comme payé manuellement (pour A, O, E, C)
    if (status === 'A' || status === 'O' || status === 'E' || status === 'C') {
        let buttonText = 'Marquer comme payé manuellement';
        
        if (status === 'C') {
            buttonText = 'Marquer comme payé (créance réglée)';
        } else if (status === 'O') {
            buttonText = 'Marquer comme payé en cash';
        }
        
        menuHTML += `
            <button class="payment-menu-item" onclick="markAsManualPayment('${commandeId}')">
                <span class="menu-icon">🟣</span>
                <span class="menu-text">${buttonText}</span>
            </button>
        `;
    }
    
    // Info du statut actuel
    const statusInfo = PAYMENT_STATUS_CONFIG[status];
    menuHTML += `
        <div class="payment-menu-divider"></div>
        <div class="payment-menu-info">
            ${statusInfo.icon} Statut actuel: <strong>${statusInfo.title}</strong>
        </div>
    `;
    
    menu.innerHTML = menuHTML;
    document.body.appendChild(menu);
    
    // Fermer au clic extérieur
    setTimeout(() => {
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !badgeElement.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }, 100);
}

/**
 * Marquer une commande comme payée manuellement
 * @param {string} commandeId - L'ID de la commande
 */
async function markAsManualPayment(commandeId) {
    // Fermer les menus
    document.querySelectorAll('.payment-status-menu').forEach(m => m.remove());
    
    // Utiliser la popup moderne au lieu de confirm()
    const confirmed = await showModernConfirm({
        title: 'Confirmer le paiement manuel',
        message: 'Confirmer que cette commande a été payée par un autre moyen (cash, mobile money, etc.) ?',
        type: 'warning',
        confirmText: 'Oui, marquer comme payé',
        cancelText: 'Annuler'
    });
    
    if (!confirmed) {
        return;
    }
    
    try {
        showToast('Mise à jour du statut...', 'info');
        
        const response = await fetch(`/api/orders/${commandeId}/mark-manual-payment`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            showToast('✅ Paiement marqué comme manuel', 'success');
            
            // Rafraîchir l'affichage
            if (typeof chargerResume === 'function') {
                await chargerResume();
                await loadPaymentStatusesForDisplayedCommandes();
            }
            
            // Ajouter le tampon "PAYÉ" immédiatement
            if (typeof addPaidStampIfNeeded === 'function') {
                addPaidStampIfNeeded(commandeId, 'M');
            }
        } else {
            showToast('❌ ' + (result.message || 'Erreur'), 'error');
        }
    } catch (error) {
        console.error('Erreur marquage paiement:', error);
        showToast('❌ Erreur de connexion', 'error');
    }
}

/**
 * Marquer le reste d'une commande PP comme payé manuellement
 * @param {string} commandeId - L'ID de la commande
 */
async function markRestAsManualPayment(commandeId) {
    // Fermer les menus
    document.querySelectorAll('.payment-status-menu').forEach(m => m.remove());
    
    // Récupérer les détails de la commande pour afficher le montant restant
    try {
        const statusResponse = await fetch(`/api/orders/${commandeId}/payment-status`, {
            credentials: 'include'
        });
        
        const statusResult = await statusResponse.json();
        
        if (!statusResult.success || !statusResult.data) {
            throw new Error('Impossible de récupérer les informations de la commande');
        }
        
        const montantRestantDu = statusResult.data.montantRestantDu || 0;
        
        if (montantRestantDu <= 0) {
            showToast('❌ Aucun montant restant à payer', 'error');
            return;
        }
        
        // Confirmer avec le montant
        const confirmed = await showModernConfirm({
            title: 'Confirmer le paiement du reste',
            message: `Le montant restant dû est de ${montantRestantDu} FCFA.\n\nConfirmer que ce montant a été payé par un autre moyen (cash, mobile money, etc.) ?`,
            type: 'warning',
            confirmText: 'Oui, marquer comme payé',
            cancelText: 'Annuler'
        });
        
        if (!confirmed) {
            return;
        }
        
        showToast('Mise à jour du statut...', 'info');
        
        const response = await fetch(`/api/orders/${commandeId}/mark-manual-payment`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            showToast('✅ Paiement complet marqué comme manuel', 'success');
            
            // Rafraîchir l'affichage
            if (typeof chargerResume === 'function') {
                await chargerResume();
                await loadPaymentStatusesForDisplayedCommandes();
            }
            
            // Ajouter le tampon "PAYÉ" immédiatement
            if (typeof addPaidStampIfNeeded === 'function') {
                addPaidStampIfNeeded(commandeId, 'M');
            }
        } else {
            showToast('❌ ' + (result.message || 'Erreur'), 'error');
        }
    } catch (error) {
        console.error('Erreur marquage paiement reste:', error);
        showToast('❌ Erreur: ' + error.message, 'error');
    }
}

/**
 * Réinitialiser le paiement manuel (remettre de M à A)
 * @param {string} commandeId - L'ID de la commande
 */
async function resetManualPayment(commandeId) {
    // Fermer les menus
    document.querySelectorAll('.payment-status-menu').forEach(m => m.remove());
    
    // Demander confirmation
    const confirmed = await showModernConfirm({
        title: 'Réinitialiser le paiement manuel ?',
        message: 'Cette commande sera remise en statut "En Attente" (A).\n\nCette action est utile si vous avez marqué la commande comme payée par erreur.\n\nConfirmer ?',
        type: 'warning',
        confirmText: 'Oui, réinitialiser',
        cancelText: 'Annuler'
    });
    
    if (!confirmed) {
        return;
    }
    
    try {
        showToast('⏳ Réinitialisation en cours...', 'info');
        
        const response = await fetch(`/api/orders/${commandeId}/reset-manual-payment`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Erreur serveur' }));
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            showToast('✅ Paiement réinitialisé, commande remise en attente', 'success');
            
            // Rafraîchir l'affichage
            if (typeof chargerResume === 'function') {
                await chargerResume();
                await loadPaymentStatusesForDisplayedCommandes();
            }
            
            // Supprimer le tampon "PAYÉ" s'il existe
            const transactionItem = document.querySelector(`[data-commande-id="${commandeId}"]`)?.closest('.transaction-item');
            if (transactionItem) {
                const stamp = transactionItem.querySelector('.paid-stamp');
                if (stamp) {
                    stamp.remove();
                }
            }
        } else {
            showToast('❌ ' + (result.message || 'Erreur'), 'error');
        }
    } catch (error) {
        console.error('❌ Erreur réinitialisation paiement:', error);
        showToast('❌ Erreur: ' + error.message, 'error');
    }
}

/**
 * Rafraîchir le statut de paiement depuis Bictorys
 * @param {string} commandeId - L'ID de la commande
 */
async function refreshPaymentStatus(commandeId) {
    // Fermer les menus
    document.querySelectorAll('.payment-status-menu').forEach(m => m.remove());
    
    try {
        showToast('Vérification du statut...', 'info');
        
        const response = await fetch(`/api/orders/${commandeId}/refresh-payment-status`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Cas spécial : correction M → P (paiement manuel devenu Bictorys)
            if (result.corrected && result.data.posStatus === 'P') {
                await showModernConfirm({
                    title: '⚠️ Paiement Bictorys Détecté !',
                    message: `Le client a finalement payé via Bictorys.\n\nLe statut "Payé manuellement" a été corrigé en "Payé via Bictorys".\n\nMontant : ${result.data.montantPaye || 0} FCFA`,
                    type: 'warning',
                    confirmText: 'OK',
                    cancelText: null  // Pas de bouton annuler, juste info
                });
                showToast('✅ Statut corrigé : Payé via Bictorys', 'success');
            }
            // Cas spécial : correction M → PP (paiement partiel)
            else if (result.corrected && result.data.posStatus === 'PP') {
                await showModernConfirm({
                    title: '⚠️ Paiement Partiel Bictorys Détecté !',
                    message: `Le client a payé partiellement via Bictorys.\n\nMontant payé : ${result.data.montantPaye || 0} FCFA\nMontant restant : ${result.data.montantRestantDu || 0} FCFA\n\nLe statut a été mis à jour.`,
                    type: 'warning',
                    confirmText: 'OK',
                    cancelText: null
                });
                showToast('⚠️ Paiement partiel détecté', 'warning');
            }
            // Cas normal : autres changements de statut
            else {
                const statusLabels = {
                    'P': '✅ Payé !',
                    'PP': '💳 Payé partiellement',
                    'O': 'ℹ️ En attente de paiement',
                    'E': '⏱️ Lien expiré',
                    'M': '🟣 Payé manuellement',
                    'C': '⚠️ Créance détectée'
                };
                const message = statusLabels[result.data.posStatus] || 'ℹ️ Statut mis à jour';
                const type = (result.data.posStatus === 'P' || result.data.posStatus === 'M') ? 'success' : 
                             (result.data.posStatus === 'PP') ? 'info' : 'info';
                
                showToast(message, type);
            }
            
            // Rafraîchir l'affichage du badge
            const badgeContainer = document.querySelector(`[data-commande-id="${commandeId}"] .payment-badge-container`);
            if (badgeContainer) {
                badgeContainer.innerHTML = getPaymentStatusBadge(result.data.posStatus, commandeId);
            }
            
            // Rafraîchir toute la liste si possible
            if (typeof chargerResume === 'function') {
                await chargerResume();
                await loadPaymentStatusesForDisplayedCommandes();
            }
            
            // Ajouter le tampon "PAYÉ" si le statut est P, PP ou M
            if ((result.data.posStatus === 'P' || result.data.posStatus === 'PP' || result.data.posStatus === 'M') && typeof addPaidStampIfNeeded === 'function') {
                const montantRestantDu = result.data.montantRestantDu || 0;
                const montantPaye = result.data.montantPaye || 0;
                addPaidStampIfNeeded(commandeId, result.data.posStatus, montantRestantDu, montantPaye);
            }
        } else {
            showToast('⚠️ ' + (result.message || 'Impossible de vérifier'), 'warning');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showToast('❌ Erreur de connexion', 'error');
    }
}

/**
 * Rafraîchir automatiquement tous les statuts Bictorys des commandes visibles
 * (pour les statuts O, E et PP uniquement)
 */
async function refreshAllBictorysStatuses() {
    console.log('🔄 [AUTO-REFRESH] Début du rafraîchissement des statuts Bictorys...');
    
    // Récupérer tous les badges avec statut O, E ou PP
    const badges = document.querySelectorAll('.payment-status-badge[data-status="O"], .payment-status-badge[data-status="E"], .payment-status-badge[data-status="PP"]');
    
    if (badges.length === 0) {
        console.log('ℹ️ [AUTO-REFRESH] Aucun lien Bictorys actif à rafraîchir');
        return;
    }
    
    console.log(`🔄 [AUTO-REFRESH] ${badges.length} lien(s) Bictorys à vérifier`);
    
    // Créer un toast pour informer l'utilisateur
    showToast(`🔄 Vérification de ${badges.length} lien(s) Bictorys...`, 'info');
    
    let updated = 0;
    let errors = 0;
    
    // Rafraîchir chaque lien avec un délai pour ne pas surcharger l'API
    for (let i = 0; i < badges.length; i++) {
        const badge = badges[i];
        const commandeId = badge.dataset.commandeId;
        
        if (!commandeId) continue;
        
        try {
            console.log(`🔄 [AUTO-REFRESH] ${i + 1}/${badges.length} - Vérification ${commandeId}...`);
            
            const response = await fetch(`/api/orders/${commandeId}/refresh-payment-status`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const result = await response.json();
            
            if (result.success) {
                updated++;
                console.log(`✅ [AUTO-REFRESH] ${commandeId} → ${result.data.posStatus}`);
            } else {
                console.log(`⚠️ [AUTO-REFRESH] ${commandeId} - ${result.message}`);
            }
            
            // Délai de 500ms entre chaque appel pour ne pas surcharger l'API
            if (i < badges.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
        } catch (error) {
            errors++;
            console.error(`❌ [AUTO-REFRESH] Erreur pour ${commandeId}:`, error);
        }
    }
    
    console.log(`✅ [AUTO-REFRESH] Terminé - ${updated} mis à jour, ${errors} erreur(s)`);
    
    // Rafraîchir l'affichage complet
    if (typeof chargerResume === 'function') {
        await chargerResume();
        await loadPaymentStatusesForDisplayedCommandes();
    }
    
    // Toast final
    if (updated > 0) {
        showToast(`✅ ${updated} statut(s) Bictorys mis à jour`, 'success');
    } else {
        showToast(`ℹ️ Aucune mise à jour nécessaire`, 'info');
    }
}

/**
 * Initialiser les gestionnaires d'événements pour les badges de paiement
 */
function initPaymentStatusHandlers() {
    // Gestionnaire de clic sur les badges
    document.addEventListener('click', (e) => {
        const badge = e.target.closest('.payment-status-badge');
        if (!badge) return;
        
        const clickable = badge.dataset.clickable === 'true';
        if (!clickable) return;
        
        const commandeId = badge.dataset.commandeId;
        const status = badge.dataset.status;
        
        if (!commandeId || !status) return;
        
        showPaymentStatusMenu(commandeId, status, badge);
    });
    
    console.log('✅ Gestionnaires de statut de paiement initialisés');
}

/**
 * Polling automatique pour les statuts ouverts (optionnel)
 * @param {number} intervalMs - Intervalle en millisecondes (défaut: 60000 = 1 minute)
 */
let paymentStatusPollingInterval = null;

function startPaymentStatusPolling(intervalMs = 60000) {
    if (paymentStatusPollingInterval) {
        console.log('⚠️ Polling déjà actif');
        return;
    }
    
    paymentStatusPollingInterval = setInterval(async () => {
        // Récupérer les commandes avec statut O ou E visibles à l'écran
        const openBadges = document.querySelectorAll('.payment-status-badge[data-status="O"], .payment-status-badge[data-status="E"]');
        
        if (openBadges.length === 0) return;
        
        console.log(`🔄 Vérification auto de ${openBadges.length} paiement(s) ouverts/expirés`);
        
        for (const badge of openBadges) {
            const commandeId = badge.dataset.commandeId;
            if (commandeId) {
                try {
                    await refreshPaymentStatus(commandeId);
                } catch (error) {
                    console.error(`Erreur polling ${commandeId}:`, error);
                }
            }
        }
    }, intervalMs);
    
    console.log(`✅ Polling des paiements démarré (intervalle: ${intervalMs / 1000}s)`);
}

function stopPaymentStatusPolling() {
    if (paymentStatusPollingInterval) {
        clearInterval(paymentStatusPollingInterval);
        paymentStatusPollingInterval = null;
        console.log('⏹️ Polling des paiements arrêté');
    }
}

// Auto-initialisation au chargement de la page
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPaymentStatusHandlers);
} else {
    initPaymentStatusHandlers();
}

// Arrêter le polling avant de quitter
window.addEventListener('beforeunload', stopPaymentStatusPolling);

