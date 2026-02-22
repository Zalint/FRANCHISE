// ===== DAY SCREENING =====
// Variables globales pour Day Screening
let dayScreeningCache = null;
let dayScreeningInProgress = false;
let dayScreeningPollInterval = null;
let isPanelMinimized = false;
let panelDragOffset = { x: 0, y: 0 };
let isDragging = false;

// Fonction pour afficher/masquer le badge
function updateDayScreeningBadge(hasResults) {
    const badge = document.getElementById('dayScreeningBadge');
    if (badge) {
        badge.style.display = hasResults ? 'block' : 'none';
    }
}

// Initialiser le drag & drop pour le panel
function initializePanelDragging() {
    const panel = document.getElementById('dayScreeningResultsModal');
    const header = document.getElementById('dayScreeningPanelHeader');
    
    if (!header || !panel) return;
    
    header.addEventListener('mousedown', (e) => {
        // Empêcher le drag si on clique sur un bouton
        if (e.target.closest('.panel-btn')) return;
        
        isDragging = true;
        const rect = panel.getBoundingClientRect();
        panelDragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        panel.style.transition = 'none';
        header.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const panel = document.getElementById('dayScreeningResultsModal');
        if (!panel || panel.classList.contains('minimized')) return;
        
        const x = e.clientX - panelDragOffset.x;
        const y = e.clientY - panelDragOffset.y;
        
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.style.transform = 'none';
    });
    
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            const header = document.getElementById('dayScreeningPanelHeader');
            if (header) header.style.cursor = 'move';
            
            const panel = document.getElementById('dayScreeningResultsModal');
            if (panel) panel.style.transition = 'all 0.3s ease';
        }
    });
}

// Toggle minimiser/maximiser le panel
function toggleMinimizeDayScreening() {
    const panel = document.getElementById('dayScreeningResultsModal');
    const icon = document.getElementById('minimizeIcon');
    
    if (!panel || !icon) return;
    
    isPanelMinimized = !isPanelMinimized;
    
    if (isPanelMinimized) {
        panel.classList.add('minimized');
        icon.className = 'fas fa-window-maximize';
        console.log('📦 Panel minimisé');
    } else {
        panel.classList.remove('minimized');
        icon.className = 'fas fa-window-minimize';
        console.log('📦 Panel maximisé');
    }
}

// Variable pour suivre l'état du zoom
let isPanelMaximized = false;
let panelOriginalStyle = {};

// Fonction pour mettre le panel en plein écran
function toggleMaximizeDayScreening() {
    const panel = document.getElementById('dayScreeningResultsModal');
    const icon = document.getElementById('maximizeIcon');
    
    if (!panel || !icon) return;
    
    isPanelMaximized = !isPanelMaximized;
    
    if (isPanelMaximized) {
        // Sauvegarder les styles actuels
        panelOriginalStyle = {
            top: panel.style.top,
            left: panel.style.left,
            width: panel.style.width,
            height: panel.style.height,
            transform: panel.style.transform
        };
        
        // Mettre en plein écran
        panel.style.top = '0';
        panel.style.left = '0';
        panel.style.width = '100vw';
        panel.style.height = '100vh';
        panel.style.transform = 'none';
        panel.classList.add('maximized');
        
        icon.className = 'fas fa-compress';
        console.log('🔍 Panel en plein écran');
    } else {
        // Restaurer les styles originaux
        panel.style.top = panelOriginalStyle.top || '50%';
        panel.style.left = panelOriginalStyle.left || '50%';
        panel.style.width = panelOriginalStyle.width || '90%';
        panel.style.height = panelOriginalStyle.height || '90%';
        panel.style.transform = panelOriginalStyle.transform || 'translate(-50%, -50%)';
        panel.classList.remove('maximized');
        
        icon.className = 'fas fa-expand';
        console.log('🔍 Panel restauré');
    }
}

// Ouvrir modal de confirmation ou résultats
function ouvrirDayScreening() {
    // Initialiser le dragging si pas déjà fait
    if (!isDragging && document.getElementById('dayScreeningPanelHeader')) {
        initializePanelDragging();
    }
    
    // Si on a déjà des résultats en cache, les afficher directement
    if (dayScreeningCache && dayScreeningCache.results) {
        console.log('📦 Ouverture des résultats depuis le cache');
        
        // Ouvrir directement la modal de résultats
        const resultsModal = document.getElementById('dayScreeningResultsModal');
        resultsModal.style.display = 'flex';
        
        // Restaurer en mode maximisé
        resultsModal.classList.remove('minimized');
        isPanelMinimized = false;
        const icon = document.getElementById('minimizeIcon');
        if (icon) icon.className = 'fas fa-window-minimize';
        
        // Afficher les résultats du cache
        afficherResultatsScreening(dayScreeningCache.results);
        
        const cacheAge = Math.floor((Date.now() - dayScreeningCache.timestamp) / 1000 / 60);
        updateScreeningStatus('success', `Dernière analyse : il y a ${cacheAge} min`);
        
        return;
    }
    
    // Sinon, ouvrir la modal de confirmation
    const modal = document.getElementById('dayScreeningConfirmModal');
    
    // Initialiser le champ de date avec aujourd'hui
    const dateInput = document.getElementById('dayScreeningDateInput');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
        console.log('📅 Date initialisée:', today);
    }
    
    modal.style.display = 'flex';
}

// Fermer modal de confirmation
function fermerDayScreeningConfirm() {
    const modal = document.getElementById('dayScreeningConfirmModal');
    modal.style.display = 'none';
}

// Lancer l'analyse Day Screening
async function lancerDayScreening(forceRefresh = false) {
    console.log('🔍 Lancement Day Screening', forceRefresh ? '(Force refresh)' : '');
    
    // Récupérer la date sélectionnée
    const dateInput = document.getElementById('dayScreeningDateInput');
    const selectedDate = dateInput ? dateInput.value : null;
    
    // Si pas de date sélectionnée, utiliser aujourd'hui
    const analysisDate = selectedDate || new Date().toISOString().split('T')[0];
    
    console.log('📅 Date d\'analyse:', analysisDate);
    
    // Fermer la confirmation si elle est ouverte
    fermerDayScreeningConfirm();
    
    // Initialiser le dragging si pas déjà fait
    if (!isDragging && document.getElementById('dayScreeningPanelHeader')) {
        initializePanelDragging();
    }
    
    // Ouvrir la modal de résultats si elle n'est pas déjà ouverte
    const resultsModal = document.getElementById('dayScreeningResultsModal');
    if (resultsModal.style.display !== 'flex') {
        resultsModal.style.display = 'flex';
        // S'assurer qu'elle est maximisée
        resultsModal.classList.remove('minimized');
        isPanelMinimized = false;
        const icon = document.getElementById('minimizeIcon');
        if (icon) icon.className = 'fas fa-window-minimize';
    }
    
    // Vider l'affichage précédent
    const resultsList = document.getElementById('dayScreeningResultsList');
    if (resultsList) {
        resultsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #6c757d;"><i class="fas fa-spinner fa-spin"></i> Analyse en cours...</div>';
    }
    
    // Mettre à jour l'interface
    updateScreeningStatus('loading', 'Analyse en cours...');
    
    // Marquer comme en cours
    dayScreeningInProgress = true;
    
    // Récupérer le point de vente sélectionné
    const selectedPointVente = document.getElementById('pointVenteSelect')?.value || currentUser.pointVente;
    
    try {
        // Lancer l'analyse (background)
        const response = await fetch('/api/day-screening/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                date: analysisDate,
                pointVente: selectedPointVente,
                forceRefresh: forceRefresh  // ✨ Forcer le rafraîchissement
            })
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du lancement de l\'analyse');
        }
        
        const data = await response.json();
        console.log('✅ Analyse lancée:', data);
        
        // Si résultat immédiat (depuis cache)
        if (data.fromCache && data.results) {
            afficherResultatsScreening(data.results, analysisDate);
            updateScreeningStatus('success', `Dernière analyse : ${new Date(data.timestamp).toLocaleTimeString()}`);
            
            // Mettre le cache à jour
            dayScreeningCache = {
                timestamp: data.timestamp || Date.now(),
                results: data.results,
                date: analysisDate
            };
            updateDayScreeningBadge(true);
        } else {
            // Polling pour vérifier quand c'est prêt
            startScreeningPolling(analysisDate, selectedPointVente);
        }
        
    } catch (error) {
        console.error('❌ Erreur Day Screening:', error);
        showToast('Erreur lors du lancement de l\'analyse', 'error');
        updateScreeningStatus('error', 'Erreur lors de l\'analyse');
        dayScreeningInProgress = false;
    }
}

// Polling pour vérifier l'état de l'analyse
function startScreeningPolling(analysisDate, pointVente) {
    if (dayScreeningPollInterval) {
        clearInterval(dayScreeningPollInterval);
    }
    
    console.log('📡 Démarrage polling...', { date: analysisDate, pointVente });
    
    // Poll toutes les 3 secondes
    dayScreeningPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/day-screening/status?date=${analysisDate}&pointVente=${encodeURIComponent(pointVente)}`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Erreur status');
            }
            
            const data = await response.json();
            
            if (data.status === 'completed' && data.results) {
                // Analyse terminée !
                console.log('✅ Analyse terminée !');
                clearInterval(dayScreeningPollInterval);
                dayScreeningPollInterval = null;
                dayScreeningInProgress = false;
                
                // Afficher les résultats
                afficherResultatsScreening(data.results, analysisDate);
                updateScreeningStatus('success', `Analyse terminée à ${new Date().toLocaleTimeString()}`);
                
                // Notification
                showToast('✅ Day Screening terminé ! Consultez les résultats.', 'success');
                
                // Cache les résultats
                dayScreeningCache = {
                    timestamp: Date.now(),
                    results: data.results
                };
                
                // Afficher le badge sur le bouton
                updateDayScreeningBadge(true);
            } else if (data.status === 'error') {
                clearInterval(dayScreeningPollInterval);
                dayScreeningPollInterval = null;
                dayScreeningInProgress = false;
                updateScreeningStatus('error', 'Erreur lors de l\'analyse');
                showToast('Erreur lors de l\'analyse', 'error');
            }
            
        } catch (error) {
            console.error('Erreur polling:', error);
        }
    }, 3000);
}

// Afficher les résultats du screening
function afficherResultatsScreening(results, analysisDate = null) {
    console.log('📊 Affichage résultats:', results);
    
    // Note: On ne réinitialise plus la recherche ici pour ne pas effacer ce que l'utilisateur tape
    // La recherche n'est réinitialisée que lors de la fermeture du panel
    
    // Mettre à jour les stats
    document.getElementById('totalClients').textContent = results.totalClients || 0;
    document.getElementById('highRiskCount').textContent = results.highRisk || 0;
    document.getElementById('mediumRiskCount').textContent = results.mediumRisk || 0;
    document.getElementById('lowRiskCount').textContent = results.lowRisk || 0;
    
    // Mettre à jour la date - utiliser la date d'analyse si fournie
    if (analysisDate) {
        const [year, month, day] = analysisDate.split('-');
        document.getElementById('screeningDate').textContent = `${day}/${month}/${year}`;
    } else {
        document.getElementById('screeningDate').textContent = new Date().toLocaleDateString('fr-FR');
    }
    document.getElementById('screeningTime').textContent = new Date().toLocaleTimeString('fr-FR');
    
    // Afficher la liste des clients
    const clientsList = document.getElementById('screeningClientsList');
    clientsList.innerHTML = '';
    
    if (!results.clients || results.clients.length === 0) {
        clientsList.innerHTML = '<p style="text-align: center; color: #757575; padding: 40px;">Aucun client analysé aujourd\'hui</p>';
        return;
    }
    
    // Trier par niveau de risque (élevé en premier)
    const sortedClients = [...results.clients].sort((a, b) => {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    });
    
    sortedClients.forEach(client => {
        const clientCard = creerCarteClientScreening(client);
        clientsList.appendChild(clientCard);
    });
}

// Créer une carte client pour le screening
function creerCarteClientScreening(client) {
    const card = document.createElement('div');
    card.className = 'screening-client-card';
    card.dataset.risk = client.riskLevel;
    
    // Couleurs selon le risque
    const riskColors = {
        high: { bg: '#ffebee', border: '#F44336', icon: 'exclamation-triangle', iconColor: '#F44336' },
        medium: { bg: '#fff9c4', border: '#FFC107', icon: 'exclamation-circle', iconColor: '#FF9800' },
        low: { bg: '#e8f5e9', border: '#4CAF50', icon: 'check-circle', iconColor: '#4CAF50' }
    };
    
    const colors = riskColors[client.riskLevel] || riskColors.low;
    
    card.style.cssText = `
        background: ${colors.bg};
        border-left: 4px solid ${colors.border};
        padding: 16px;
        margin-bottom: 12px;
        border-radius: 8px;
        transition: transform 150ms;
    `;
    
    // Badges de risque
    let riskLabel = '';
    if (client.riskLevel === 'high') riskLabel = 'RISQUE ÉLEVÉ';
    else if (client.riskLevel === 'medium') riskLabel = 'RISQUE MOYEN';
    else riskLabel = 'RISQUE FAIBLE';
    
    // Construction HTML
    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                    <i class="fas fa-${colors.icon}" style="color: ${colors.iconColor}; font-size: 1.2rem;"></i>
                    <h4 style="margin: 0; font-size: 1.1rem; color: #212121;">${client.nomClient || 'Client inconnu'}</h4>
                </div>
                <div style="font-size: 0.85rem; color: #757575; margin-left: 30px;">
                    <div>${client.telephone || '-'}</div>
                    <div>${client.adresse || '-'}</div>
                </div>
            </div>
            <div style="text-align: right;">
                <span style="background: ${colors.border}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 700;">
                    ${riskLabel}
                </span>
                <div style="font-size: 0.9rem; font-weight: 600; color: #212121; margin-top: 6px;">
                    ${formatCurrency(client.montantCommande || 0)}
                </div>
            </div>
        </div>
        
        <!-- Alertes -->
        <div style="margin-top: 12px;">
            ${client.alerts && client.alerts.length > 0 ? `
                <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0;">
                    <div style="font-weight: 600; font-size: 0.85rem; color: #212121; margin-bottom: 8px;">
                        <i class="fas fa-exclamation-triangle" style="color: ${colors.iconColor};"></i> Alertes
                    </div>
                    ${client.alerts.map(alert => `
                        <div style="font-size: 0.85rem; color: #424242; margin-bottom: 4px; padding-left: 20px;">
                            • ${alert}
                        </div>
                    `).join('')}
                </div>
            ` : '<div style="font-size: 0.85rem; color: #757575; padding-left: 30px;">Aucune alerte</div>'}
        </div>
        
        <!-- Historique -->
        ${client.stats ? `
            <div style="display: grid; grid-template-columns: repeat(${client.stats.nombreCommentaires ? '4' : '3'}, 1fr); gap: 10px; margin-top: 12px; background: white; padding: 10px; border-radius: 6px;">
                <div style="text-align: center;">
                    <div style="font-size: 0.75rem; color: #757575;">Total commandes</div>
                    <div style="font-size: 1.2rem; font-weight: 700; color: #212121;">${client.stats.totalCommandes || 0}</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 0.75rem; color: #757575;">Montant total</div>
                    <div style="font-size: 1rem; font-weight: 700; color: #212121;">${formatCurrency(client.stats.montantTotal || 0)}</div>
                </div>
                ${client.stats.nombreCommentaires ? `
                    <div style="text-align: center; background: #e3f2fd; border-radius: 4px;">
                        <div style="font-size: 0.75rem; color: #1976D2;">💬 Commentaires</div>
                        <div style="font-size: 1.2rem; font-weight: 700; color: #1976D2;">${client.stats.nombreCommentaires}</div>
                    </div>
                ` : ''}
                <div style="text-align: center;">
                    <div style="font-size: 0.75rem; color: #757575;">Dernière cmd</div>
                    <div style="font-size: 0.9rem; font-weight: 700; color: #212121;">${client.stats.dernierAchat || '-'}</div>
                </div>
            </div>
        ` : ''}
        
        <!-- 5 Dernières commandes -->
        ${client.dernieresCommandes && client.dernieresCommandes.length > 0 ? `
            <div style="margin-top: 12px; background: #f5f5f5; padding: 12px; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="font-size: 0.9rem;">📦 5 dernières commandes</strong>
                    ${client.commentaires && client.commentaires.length > 0 ? `
                        <button onclick="lancerAnalyseIA('${client.telephone}')" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                            <i class="fas fa-brain"></i> Analyse IA
                        </button>
                    ` : ''}
                </div>
                ${client.dernieresCommandes.map((cmd, idx) => `
                    <div style="background: white; padding: 8px; border-radius: 4px; margin-bottom: 6px; font-size: 0.85rem; border-left: 3px solid ${cmd.paymentStatus === 'paid' || cmd.paymentStatus === 'payé' ? '#4CAF50' : '#FF9800'};">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-weight: 600;">${cmd.date || 'Date inconnue'}</span>
                            <span style="font-weight: 700; color: #212121;">${formatCurrency(cmd.amount || 0)}</span>
                        </div>
                        ${cmd.comments && cmd.comments.trim() !== '' ? `
                            <div style="padding: 6px; background: #fff3e0; border-radius: 4px; color: #e65100; font-size: 0.8rem; margin-top: 4px;">
                                💬 "${cmd.comments}"
                            </div>
                        ` : '<div style="color: #9e9e9e; font-size: 0.8rem;">Pas de commentaire</div>'}
                    </div>
                `).join('')}
            </div>
        ` : ''}
        
        <!-- Résultat Analyse IA (sera ajouté dynamiquement) -->
        <div id="ia-result-${client.telephone}" style="display: none;"></div>
    `;
    
    return card;
}

// Mettre à jour le statut du screening
function updateScreeningStatus(status, message) {
    const statusElement = document.getElementById('screeningStatus');
    
    if (status === 'loading') {
        statusElement.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> ${message}`;
        statusElement.style.color = '#2196F3';
    } else if (status === 'success') {
        statusElement.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
        statusElement.style.color = '#4CAF50';
    } else if (status === 'error') {
        statusElement.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
        statusElement.style.color = '#F44336';
    }
}

// Rafraîchir le Day Screening
async function rafraichirDayScreening() {
    console.log('🔄 Rafraîchissement Day Screening');
    
    // Invalider le cache local
    dayScreeningCache = null;
    updateDayScreeningBadge(false);
    
    // Ne pas fermer la modal - on reste dedans pour voir l'analyse en cours
    
    // Relancer directement l'analyse avec forceRefresh=true
    await lancerDayScreening(true);
}

// 🤖 Lancer l'analyse IA de sentiment pour un client
async function lancerAnalyseIA(telephone) {
    console.log('🤖 Lancement analyse IA pour:', telephone);
    
    // Trouver le client dans le cache
    if (!dayScreeningCache || !dayScreeningCache.results) {
        showToast('Erreur: Données non disponibles', 'error');
        return;
    }
    
    const client = dayScreeningCache.results.clients.find(c => c.telephone === telephone);
    if (!client || !client.commentaires || client.commentaires.length === 0) {
        showToast('Aucun commentaire à analyser', 'warning');
        return;
    }
    
    // Afficher un indicateur de chargement
    const resultDiv = document.getElementById(`ia-result-${telephone}`);
    if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
            <div style="margin-top: 12px; background: #e3f2fd; padding: 12px; border-radius: 8px; text-align: center;">
                <i class="fas fa-spinner fa-spin"></i> Analyse IA en cours...
            </div>
        `;
    }
    
    try {
        const response = await fetch('/api/sentiment-analysis', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                commentaires: client.commentaires,
                nomClient: client.nomClient
            })
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors de l\'analyse IA');
        }
        
        const data = await response.json();
        console.log('✅ Analyse IA terminée:', data);
        
        // Afficher les résultats
        if (resultDiv && data.analysis) {
            const analysis = data.analysis;
            resultDiv.innerHTML = `
                <div style="margin-top: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 12px; border-radius: 8px; color: white;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <i class="fas fa-brain"></i>
                        <strong>Analyse IA des commentaires</strong>
                    </div>
                    <div style="font-size: 0.85rem; opacity: 0.95; margin-bottom: 8px;">
                        ${analysis.reasoning || 'Analyse effectuée'}
                    </div>
                    ${analysis.alerts && analysis.alerts.length > 0 ? `
                        <div style="background: rgba(255,255,255,0.2); padding: 8px; border-radius: 4px; font-size: 0.85rem;">
                            ${analysis.alerts.map(alert => `<div style="margin-bottom: 4px;">${alert}</div>`).join('')}
                        </div>
                    ` : ''}
                    ${analysis.negativeComments > 0 ? `
                        <div style="margin-top: 8px; padding: 8px; background: rgba(244, 67, 54, 0.3); border-radius: 4px; font-size: 0.8rem;">
                            ⚠️ ${analysis.negativeComments} commentaire(s) négatif(s) sur ${analysis.totalComments}
                        </div>
                    ` : ''}
                    <div style="margin-top: 8px; text-align: center;">
                        <button onclick="document.getElementById('ia-result-${telephone}').style.display='none'" style="background: rgba(255,255,255,0.3); border: none; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                            Masquer
                        </button>
                    </div>
                </div>
            `;
        }
        
        showToast('✅ Analyse IA terminée', 'success');
        
    } catch (error) {
        console.error('❌ Erreur analyse IA:', error);
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div style="margin-top: 12px; background: #ffebee; padding: 12px; border-radius: 8px; color: #c62828;">
                    <i class="fas fa-exclamation-triangle"></i> Erreur lors de l'analyse IA
                </div>
            `;
        }
        showToast('Erreur lors de l\'analyse IA', 'error');
    }
}

// Fermer modal résultats
function fermerDayScreeningResults() {
    const modal = document.getElementById('dayScreeningResultsModal');
    modal.style.display = 'none';
    
    // Arrêter le polling si en cours
    if (dayScreeningPollInterval) {
        clearInterval(dayScreeningPollInterval);
        dayScreeningPollInterval = null;
    }
    
    dayScreeningInProgress = false;
    
    // Réinitialiser la recherche
    const searchInput = document.getElementById('screeningSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    dayScreeningSearchTerm = '';
    
    // NE PAS vider le cache - on garde les résultats pour pouvoir les rouvrir
    // dayScreeningCache reste intact
    
    console.log('✅ Modal fermée - Résultats conservés en cache');
}

// 🔍 Rechercher dans les résultats du screening
let dayScreeningSearchTerm = '';
let searchDebounceTimer = null;

// Fonction de recherche avec debounce (attendre que l'utilisateur finisse de taper)
function rechercherDansScreeningDebounced(searchTerm) {
    // Annuler le timer précédent s'il existe
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }
    
    // Lancer la recherche après 400ms d'inactivité
    searchDebounceTimer = setTimeout(() => {
        rechercherDansScreening(searchTerm);
    }, 400);
}

// Fonction de recherche immédiate
function rechercherDansScreening(searchTerm) {
    dayScreeningSearchTerm = searchTerm.toLowerCase().trim();
    
    const cards = document.querySelectorAll('.screening-client-card');
    
    console.log('🔍 Recherche:', dayScreeningSearchTerm);
    
    let visibleCount = 0;
    
    cards.forEach(card => {
        if (!dayScreeningSearchTerm) {
            // Pas de recherche - tout afficher
            card.style.display = '';
            card.classList.remove('search-highlight');
            visibleCount++;
            return;
        }
        
        // Récupérer tout le contenu texte de la carte
        const cardText = card.innerText.toLowerCase();
        
        // Vérifier si le terme est présent
        if (cardText.includes(dayScreeningSearchTerm)) {
            card.style.display = '';
            card.classList.add('search-highlight');
            visibleCount++;
        } else {
            card.style.display = 'none';
            card.classList.remove('search-highlight');
        }
    });
    
    // Afficher un message si aucun résultat
    const clientsList = document.getElementById('screeningClientsList');
    let noResultsDiv = document.getElementById('noSearchResults');
    
    if (visibleCount === 0 && dayScreeningSearchTerm) {
        if (!noResultsDiv) {
            noResultsDiv = document.createElement('div');
            noResultsDiv.id = 'noSearchResults';
            noResultsDiv.style.cssText = 'text-align: center; padding: 40px; color: #757575;';
            clientsList.appendChild(noResultsDiv);
        }
        
        noResultsDiv.innerHTML = `
            <i class="fas fa-search" style="font-size: 3rem; opacity: 0.3; margin-bottom: 15px;"></i>
            <p style="font-size: 1.1rem; margin: 0;">Aucun résultat pour "${searchTerm}"</p>
            <p style="font-size: 0.9rem; margin-top: 10px; opacity: 0.7;">Essayez avec d'autres mots-clés</p>
        `;
    } else if (noResultsDiv) {
        noResultsDiv.remove();
    }
    
    console.log(`✅ ${visibleCount} résultat(s) affiché(s)`);
}

// 📥 Télécharger les résultats au format texte
function telechargerResultatsTexte() {
    if (!dayScreeningCache || !dayScreeningCache.results) {
        showToast('Aucun résultat à télécharger', 'warning');
        return;
    }
    
    const results = dayScreeningCache.results;
    const date = new Date().toLocaleDateString('fr-FR');
    const time = new Date().toLocaleTimeString('fr-FR');
    
    // Construire le contenu texte
    let txtContent = '';
    txtContent += '═══════════════════════════════════════════════════════════════\n';
    txtContent += '              DAY SCREENING - RÉSULTATS\n';
    txtContent += '═══════════════════════════════════════════════════════════════\n';
    txtContent += `Date: ${date} à ${time}\n`;
    txtContent += `Point de vente: ${currentUser.pointVente || 'N/A'}\n`;
    txtContent += `Commercial: ${currentUser.nom || 'N/A'}\n`;
    txtContent += '═══════════════════════════════════════════════════════════════\n\n';
    
    // Statistiques
    txtContent += '📊 STATISTIQUES GLOBALES\n';
    txtContent += '───────────────────────────────────────────────────────────────\n';
    txtContent += `Total clients analysés:     ${results.totalClients || 0}\n`;
    txtContent += `Risque ÉLEVÉ:              ${results.highRisk || 0}\n`;
    txtContent += `Risque MOYEN:              ${results.mediumRisk || 0}\n`;
    txtContent += `Risque FAIBLE:             ${results.lowRisk || 0}\n`;
    txtContent += '\n\n';
    
    // Trier les clients par niveau de risque
    const sortedClients = [...(results.clients || [])].sort((a, b) => {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    });
    
    // Liste des clients
    txtContent += '👥 DÉTAILS DES CLIENTS\n';
    txtContent += '═══════════════════════════════════════════════════════════════\n\n';
    
    sortedClients.forEach((client, index) => {
        const riskLabel = client.riskLevel === 'high' ? '🔴 RISQUE ÉLEVÉ' : 
                         client.riskLevel === 'medium' ? '🟡 RISQUE MOYEN' : 
                         '🟢 RISQUE FAIBLE';
        
        txtContent += `${index + 1}. ${client.nomClient || 'Client inconnu'}\n`;
        txtContent += `   ${riskLabel}\n`;
        txtContent += `   ───────────────────────────────────────────────────────────\n`;
        txtContent += `   Téléphone:         ${client.telephone || 'N/A'}\n`;
        txtContent += `   Adresse:           ${client.adresse || 'N/A'}\n`;
        txtContent += `   Montant commande:  ${formatCurrency(client.montantCommande || 0)}\n`;
        txtContent += '\n';
        
        // Alertes
        if (client.alerts && client.alerts.length > 0) {
            txtContent += '   ⚠️  ALERTES:\n';
            client.alerts.forEach(alert => {
                txtContent += `       • ${alert}\n`;
            });
            txtContent += '\n';
        }
        
        // Statistiques client
        if (client.stats) {
            txtContent += '   📈 HISTORIQUE:\n';
            txtContent += `       Total commandes:    ${client.stats.totalCommandes || 0}\n`;
            txtContent += `       Montant total:      ${formatCurrency(client.stats.montantTotal || 0)}\n`;
            if (client.stats.nombreCommentaires) {
                txtContent += `       Commentaires:       ${client.stats.nombreCommentaires}\n`;
            }
            txtContent += `       Dernière commande:  ${client.stats.dernierAchat || 'N/A'}\n`;
            txtContent += '\n';
        }
        
        // 5 dernières commandes
        if (client.dernieresCommandes && client.dernieresCommandes.length > 0) {
            txtContent += '   📦 5 DERNIÈRES COMMANDES:\n';
            client.dernieresCommandes.forEach((cmd, idx) => {
                const status = cmd.paymentStatus === 'paid' || cmd.paymentStatus === 'payé' ? '✓ Payé' : '⏳ En attente';
                txtContent += `       ${idx + 1}. ${cmd.date || 'Date inconnue'} - ${formatCurrency(cmd.amount || 0)} [${status}]\n`;
                if (cmd.comments && cmd.comments.trim() !== '') {
                    txtContent += `          💬 "${cmd.comments}"\n`;
                }
            });
            txtContent += '\n';
        }
        
        txtContent += '\n';
    });
    
    // Pied de page
    txtContent += '═══════════════════════════════════════════════════════════════\n';
    txtContent += `Rapport généré le ${date} à ${time}\n`;
    txtContent += 'Keur BALLI - Point de Vente - Caisse - Matix\n';
    txtContent += '═══════════════════════════════════════════════════════════════\n';
    
    // Créer le fichier et le télécharger
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Nom du fichier avec date
    const filename = `Day-Screening-${new Date().toISOString().split('T')[0]}-${currentUser.pointVente || 'POS'}.txt`;
    a.download = filename;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('📥 Fichier téléchargé:', filename);
    showToast(`✅ Rapport téléchargé: ${filename}`, 'success');
}

