// Variables globales
let currentUser = null;
let selectedClientId = null;
let clients = [];
let clientModal, detailsModal, paiementModal, commandesModal;

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', async () => {
    // Vérifier l'authentification
    await checkSession();
    
    // Initialiser les modals Bootstrap
    clientModal = new bootstrap.Modal(document.getElementById('clientModal'));
    detailsModal = new bootstrap.Modal(document.getElementById('detailsModal'));
    paiementModal = new bootstrap.Modal(document.getElementById('paiementModal'));
    commandesModal = new bootstrap.Modal(document.getElementById('commandesModal'));
    
    // Charger les points de vente
    await loadPointsVente();
    
    // Charger les clients
    await loadClients();
    
    // Configurer les événements de recherche et filtres
    document.getElementById('search-input').addEventListener('input', filterClients);
    document.getElementById('filter-statut').addEventListener('change', filterClients);
    document.getElementById('filter-point-vente').addEventListener('change', filterClients);
    
    // Définir la date par défaut pour le paiement
    document.getElementById('paiement-date').valueAsDate = new Date();
    
    // Définir le mois actuel par défaut
    const now = new Date();
    const moisActuel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('paiement-mois').value = moisActuel;
});

// Vérifier la session utilisateur
async function checkSession() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!data.success || !data.user) {
            window.location.href = '/login.html';
            return;
        }
        
        currentUser = data.user;
        document.getElementById('current-user').textContent = currentUser.username;
        
        // Vérifier les permissions (seuls admin et superadmin peuvent gérer les abonnements)
        if (currentUser.role === 'lecteur') {
            alert('Accès refusé : vous n\'avez pas les permissions nécessaires');
            window.location.href = '/index.html';
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de session:', error);
        window.location.href = '/login.html';
    }
}

// Charger les points de vente
async function loadPointsVente() {
    try {
        const response = await fetch('/api/points-vente', {
            credentials: 'include'
        });
        
        const pointsVente = await response.json();
        
        const selects = [
            document.getElementById('client-point-vente'),
            document.getElementById('filter-point-vente')
        ];
        
        selects.forEach((select, index) => {
            pointsVente.forEach(pv => {
                const option = document.createElement('option');
                option.value = pv;
                option.textContent = pv;
                select.appendChild(option);
            });
        });
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

// Charger les clients abonnés
async function loadClients() {
    try {
        const response = await fetch('/api/abonnements/clients', {
            credentials: 'include'
        });
        
        // Gérer les erreurs HTTP
        if (!response.ok) {
            if (response.status === 500) {
                console.error('Erreur serveur 500 - Les tables d\'abonnement n\'existent peut-être pas encore');
                showNotification('Initialisation en cours... Veuillez redémarrer le serveur si le problème persiste.', 'error');
                // Afficher le message "aucun client" au lieu de l'erreur
                clients = [];
                displayClients(clients);
                return;
            }
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            clients = data.data || [];
            displayClients(clients);
            console.log(`✅ ${clients.length} client(s) chargé(s)`);
        } else {
            showNotification(data.message || 'Erreur lors du chargement des clients', 'error');
            clients = [];
            displayClients(clients);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des clients:', error);
        showNotification('Impossible de charger les clients. Vérifiez que le serveur est démarré.', 'error');
        // Afficher le message "aucun client" même en cas d'erreur
        clients = [];
        displayClients(clients);
    }
}

// Afficher les clients
async function displayClients(clientsToDisplay) {
    const container = document.getElementById('clients-container');
    const noClientsMessage = document.getElementById('no-clients-message');
    
    container.innerHTML = '';
    
    if (clientsToDisplay.length === 0) {
        noClientsMessage.style.display = 'block';
        return;
    }
    
    noClientsMessage.style.display = 'none';
    
    // Charger les statistiques de ventes pour tous les clients
    for (const client of clientsToDisplay) {
        const card = document.createElement('div');
        card.className = 'col-md-6 col-lg-4 mb-4';
        
        const statusBadge = client.statut === 'actif' 
            ? '<span class="badge badge-actif"><i class="bi bi-check-circle me-1"></i>Actif</span>'
            : '<span class="badge badge-inactif"><i class="bi bi-x-circle me-1"></i>Inactif</span>';
        
        // Badge de paiement
        let paiementBadge = '';
        if (client.dernierPaiement) {
            if (client.paiementAJour) {
                paiementBadge = `
                    <span class="badge bg-success">
                        <i class="bi bi-check-circle-fill me-1"></i>À jour
                    </span>
                `;
            } else {
                paiementBadge = `
                    <span class="badge bg-warning text-dark">
                        <i class="bi bi-exclamation-triangle-fill me-1"></i>En retard
                    </span>
                `;
            }
        } else {
            paiementBadge = `
                <span class="badge bg-secondary">
                    <i class="bi bi-dash-circle me-1"></i>Aucun paiement
                </span>
            `;
        }
        
        // Dernier paiement
        let dernierPaiementHTML = '';
        if (client.dernierPaiement) {
            const datePaiement = formatDate(client.dernierPaiement.date_paiement);
            const mois = formatMois(client.dernierPaiement.mois);
            dernierPaiementHTML = `
                <div class="alert alert-info py-2 px-2 mb-2 small">
                    <i class="bi bi-cash-coin me-1"></i>
                    <strong>Dernier paiement:</strong> ${mois} (${datePaiement})
                </div>
            `;
        }
        
        // Charger les statistiques de ventes
        let statsHTML = '<div class="text-center"><small class="text-muted">Chargement...</small></div>';
        
        card.innerHTML = `
            <div class="card client-card h-100 shadow-sm" onclick="showClientDetails(${client.id})">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-3">
                        <h5 class="card-title mb-0 fw-bold">${client.prenom} ${client.nom}</h5>
                        <div class="d-flex flex-column gap-1 align-items-end">
                            ${statusBadge}
                            ${paiementBadge}
                        </div>
                    </div>
                    <div class="mb-2">
                        <span class="badge bg-light text-dark border">
                            <i class="bi bi-credit-card"></i> ${client.abonne_id}
                        </span>
                    </div>
                    ${dernierPaiementHTML}
                    <hr>
                    
                    <!-- Statistiques de ventes -->
                    <div id="stats-${client.id}" class="mb-3">
                        ${statsHTML}
                    </div>
                    
                    <p class="card-text mb-2">
                        <i class="bi bi-telephone-fill text-primary me-2"></i>
                        <strong>${client.telephone}</strong>
                    </p>
                    <p class="card-text mb-2">
                        <i class="bi bi-shop text-success me-2"></i>
                        ${client.point_vente_defaut}
                    </p>
                    ${client.adresse ? `
                        <p class="card-text text-muted small mb-0">
                            <i class="bi bi-geo-alt me-2"></i>${client.adresse}
                        </p>
                    ` : ''}
                </div>
                <div class="card-footer bg-transparent">
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-muted">
                            <i class="bi bi-calendar3"></i> Inscrit le ${formatDate(client.date_inscription)}
                        </small>
                        <button class="btn btn-sm btn-primary" onclick="showCommandesModal(${client.id}); event.stopPropagation();">
                            <i class="bi bi-list-ul"></i> Commandes
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(card);
        
        // Charger les statistiques en arrière-plan
        loadClientStats(client.id);
    }
}

// Charger les statistiques de ventes d'un client
async function loadClientStats(clientId) {
    try {
        const response = await fetch(`/api/abonnements/clients/${clientId}/ventes/stats`, {
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            const stats = result.data;
            const statsContainer = document.getElementById(`stats-${clientId}`);
            
            if (statsContainer) {
                let derniereCommandeHTML = '';
                if (stats.derniereCommande) {
                    derniereCommandeHTML = `
                        <div class="small text-muted mb-1">
                            <i class="bi bi-calendar-check"></i> Dernière: ${formatDate(stats.derniereCommande.date)}
                        </div>
                    `;
                }
                
                statsContainer.innerHTML = `
                    <div class="alert alert-success py-2 px-2 mb-0">
                        <div class="fw-bold text-center mb-2">
                            <i class="bi bi-cart-check"></i> Commandes
                        </div>
                        <div class="d-flex justify-content-between small mb-1">
                            <span>Ce mois:</span>
                            <strong>${formatMontant(stats.totalMois)}</strong>
                        </div>
                        <div class="d-flex justify-content-between small mb-1">
                            <span>Total:</span>
                            <strong>${formatMontant(stats.totalGlobal)}</strong>
                        </div>
                        <div class="d-flex justify-content-between small mb-1">
                            <span>Économisé:</span>
                            <strong class="text-danger">${formatMontant(stats.totalRabaisEconomise)}</strong>
                        </div>
                        ${derniereCommandeHTML}
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error(`Erreur lors du chargement des stats du client ${clientId}:`, error);
        const statsContainer = document.getElementById(`stats-${clientId}`);
        if (statsContainer) {
            statsContainer.innerHTML = '<small class="text-muted">Stats non disponibles</small>';
        }
    }
}

// Filtrer les clients
function filterClients() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const filterStatut = document.getElementById('filter-statut').value;
    const filterPointVente = document.getElementById('filter-point-vente').value;
    
    let filtered = clients;
    
    // Recherche par texte
    if (searchTerm) {
        filtered = filtered.filter(client => 
            client.prenom.toLowerCase().includes(searchTerm) ||
            client.nom.toLowerCase().includes(searchTerm) ||
            client.telephone.includes(searchTerm) ||
            client.abonne_id.toLowerCase().includes(searchTerm)
        );
    }
    
    // Filtre par statut
    if (filterStatut) {
        filtered = filtered.filter(client => client.statut === filterStatut);
    }
    
    // Filtre par point de vente
    if (filterPointVente) {
        filtered = filtered.filter(client => client.point_vente_defaut === filterPointVente);
    }
    
    displayClients(filtered);
}

// Afficher le modal nouveau client
function showNewClientModal() {
    document.getElementById('modalTitle').textContent = 'Nouveau Client Abonné';
    document.getElementById('clientForm').reset();
    document.getElementById('client-id').value = '';
    document.getElementById('statut-group').style.display = 'none';
    document.getElementById('abonne-id-display').style.display = 'none';
    clientModal.show();
}

// Afficher les détails d'un client
async function showClientDetails(clientId) {
    try {
        const response = await fetch(`/api/abonnements/clients/${clientId}`, {
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            selectedClientId = clientId;
            const client = data.data.client;
            const paiements = data.data.paiements;
            
            // Remplir les informations
            document.getElementById('detail-abonne-id').textContent = client.abonne_id;
            document.getElementById('detail-nom').textContent = `${client.prenom} ${client.nom}`;
            document.getElementById('detail-telephone').textContent = client.telephone;
            document.getElementById('detail-point-vente').textContent = client.point_vente_defaut;
            document.getElementById('detail-adresse').textContent = client.adresse || 'Non renseignée';
            
            const statusBadge = client.statut === 'actif' 
                ? '<span class="badge badge-actif">Actif</span>'
                : '<span class="badge badge-inactif">Inactif</span>';
            document.getElementById('detail-statut').innerHTML = statusBadge;
            
            // Afficher les paiements
            const tbody = document.getElementById('paiements-table-body');
            tbody.innerHTML = '';
            
            if (paiements.length === 0) {
                document.getElementById('no-paiements').style.display = 'block';
                tbody.closest('.table-responsive').style.display = 'none';
            } else {
                document.getElementById('no-paiements').style.display = 'none';
                tbody.closest('.table-responsive').style.display = 'block';
                
                paiements.forEach(p => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${p.mois}</td>
                        <td>${formatMontant(p.montant)}</td>
                        <td>${formatDate(p.date_paiement)}</td>
                        <td>${p.mode_paiement || '-'}</td>
                        <td>${p.reference || '-'}</td>
                    `;
                    tbody.appendChild(row);
                });
            }
            
            detailsModal.show();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des détails:', error);
        showNotification('Erreur serveur', 'error');
    }
}

// Modifier un client depuis les détails
function editClientFromDetails() {
    const client = clients.find(c => c.id === selectedClientId);
    
    if (client) {
        detailsModal.hide();
        
        document.getElementById('modalTitle').textContent = 'Modifier Client';
        document.getElementById('client-id').value = client.id;
        document.getElementById('client-prenom').value = client.prenom;
        document.getElementById('client-nom').value = client.nom;
        document.getElementById('client-telephone').value = client.telephone;
        document.getElementById('client-point-vente').value = client.point_vente_defaut;
        document.getElementById('client-adresse').value = client.adresse || '';
        document.getElementById('client-gps').value = client.position_gps || '';
        document.getElementById('client-maps').value = client.lien_google_maps || '';
        document.getElementById('client-statut').value = client.statut;
        document.getElementById('statut-group').style.display = 'block';
        document.getElementById('abonne-id-display').style.display = 'block';
        document.getElementById('display-abonne-id').textContent = client.abonne_id;
        
        clientModal.show();
    }
}

// Sauvegarder un client (création ou modification)
async function saveClient() {
    const clientId = document.getElementById('client-id').value;
    const isUpdate = !!clientId;
    
    const clientData = {
        prenom: document.getElementById('client-prenom').value,
        nom: document.getElementById('client-nom').value,
        telephone: document.getElementById('client-telephone').value,
        point_vente_defaut: document.getElementById('client-point-vente').value,
        adresse: document.getElementById('client-adresse').value,
        position_gps: document.getElementById('client-gps').value,
        lien_google_maps: document.getElementById('client-maps').value
    };
    
    if (isUpdate) {
        clientData.statut = document.getElementById('client-statut').value;
    }
    
    // Validation
    if (!clientData.prenom || !clientData.nom || !clientData.telephone || !clientData.point_vente_defaut) {
        showNotification('Veuillez remplir tous les champs obligatoires', 'error');
        return;
    }
    
    try {
        const url = isUpdate 
            ? `/api/abonnements/clients/${clientId}`
            : '/api/abonnements/clients';
        
        const method = isUpdate ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(clientData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message, 'success');
            clientModal.hide();
            await loadClients();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        showNotification('Erreur serveur', 'error');
    }
}

// Afficher le modal d'ajout de paiement
function showAddPaymentModal() {
    document.getElementById('paiement-client-id').value = selectedClientId;
    document.getElementById('paiementForm').reset();
    
    // Définir le mois actuel et la date du jour
    const now = new Date();
    const moisActuel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('paiement-mois').value = moisActuel;
    document.getElementById('paiement-date').valueAsDate = now;
    document.getElementById('paiement-montant').value = 5000;
    
    detailsModal.hide();
    paiementModal.show();
}

// Sauvegarder un paiement
async function savePaiement() {
    const paiementData = {
        client_id: parseInt(document.getElementById('paiement-client-id').value),
        mois: document.getElementById('paiement-mois').value,
        montant: parseFloat(document.getElementById('paiement-montant').value),
        date_paiement: document.getElementById('paiement-date').value,
        mode_paiement: document.getElementById('paiement-mode').value,
        notes: document.getElementById('paiement-notes').value
    };
    
    // Validation
    if (!paiementData.mois || !paiementData.montant || !paiementData.date_paiement) {
        showNotification('Veuillez remplir tous les champs obligatoires', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/abonnements/paiements', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(paiementData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(data.message, 'success');
            paiementModal.hide();
            // Recharger les détails du client
            await showClientDetails(selectedClientId);
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde du paiement:', error);
        showNotification('Erreur serveur', 'error');
    }
}

// Générer un lien de paiement Bictorys pour l'abonnement
async function generatePaymentLink() {
    const client = clients.find(c => c.id === selectedClientId);
    
    if (!client) {
        showNotification('Client non trouvé', 'error');
        return;
    }
    
    try {
        // Récupérer la référence pour ce point de vente
        const refResponse = await fetch(`/api/abonnements/reference/${client.point_vente_defaut}`, {
            credentials: 'include'
        });
        
        const refData = await refResponse.json();
        
        if (!refData.success) {
            showNotification('Point de vente non reconnu', 'error');
            return;
        }
        
        const reference = refData.data.reference; // Ex: A_MBA
        
        // Créer le lien de paiement (utiliser l'API existante payment-links)
        const paymentData = {
            pointVente: client.point_vente_defaut,
            clientName: `${client.prenom} ${client.nom}`,
            phoneNumber: client.telephone,
            address: client.adresse,
            amount: 5000, // Montant de l'abonnement
            // On pourrait ajouter une référence personnalisée ici si nécessaire
        };
        
        const response = await fetch('/api/payment-links/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(paymentData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            const paymentUrl = data.data.paymentUrl;
            
            // Afficher le lien et le copier dans le presse-papiers
            navigator.clipboard.writeText(paymentUrl).then(() => {
                showNotification(`Lien copié ! Référence: ${reference}`, 'success');
                alert(`Lien de paiement généré et copié !\n\nRéférence: ${reference}\n\nLien: ${paymentUrl}`);
            });
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la génération du lien:', error);
        showNotification('Erreur serveur', 'error');
    }
}

// Déconnexion
function logout() {
    fetch('/api/logout', {
        method: 'POST',
        credentials: 'include'
    }).then(() => {
        window.location.href = '/login.html';
    });
}

// Fonction utilitaires
function formatMontant(montant) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'XOF',
        minimumFractionDigits: 0
    }).format(montant);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function formatMois(moisString) {
    // Format: "2024-10" -> "Octobre 2024"
    const [year, month] = moisString.split('-');
    const date = new Date(year, parseInt(month) - 1);
    return date.toLocaleDateString('fr-FR', {
        month: 'long',
        year: 'numeric'
    });
}

// Afficher la modal des commandes
async function showCommandesModal(clientId) {
    try {
        // Trouver le client dans la liste
        const client = clients.find(c => c.id === clientId);
        
        if (!client) {
            showNotification('Client non trouvé', 'error');
            return;
        }
        
        // Afficher le nom du client
        document.getElementById('commandes-client-nom').textContent = `${client.prenom} ${client.nom}`;
        
        // Afficher la modal
        commandesModal.show();
        
        // Initialiser les statistiques à zéro
        document.getElementById('commandes-total-global').textContent = formatMontant(0);
        document.getElementById('commandes-total-mois').textContent = formatMontant(0);
        document.getElementById('commandes-total-rabais').textContent = formatMontant(0);
        document.getElementById('commandes-nombre-total').textContent = '0';
        
        // Afficher un message de chargement
        const tbody = document.getElementById('commandes-table-body');
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chargement...</td></tr>';
        document.getElementById('no-commandes').style.display = 'none';
        
        // Charger les statistiques
        try {
            const statsResponse = await fetch(`/api/abonnements/clients/${clientId}/ventes/stats`, {
                credentials: 'include'
            });
            
            if (statsResponse.ok) {
                const statsResult = await statsResponse.json();
                
                if (statsResult.success && statsResult.data) {
                    const stats = statsResult.data;
                    document.getElementById('commandes-total-global').textContent = formatMontant(stats.totalGlobal);
                    document.getElementById('commandes-total-mois').textContent = formatMontant(stats.totalMois);
                    document.getElementById('commandes-total-rabais').textContent = formatMontant(stats.totalRabaisEconomise);
                    document.getElementById('commandes-nombre-total').textContent = stats.nombreCommandesTotal;
                }
            } else {
                console.warn('Erreur lors du chargement des statistiques:', statsResponse.status);
            }
        } catch (statsError) {
            console.warn('Erreur lors du chargement des statistiques:', statsError);
            // Ne pas bloquer, continuer avec les ventes
        }
        
        // Charger l'historique des commandes
        try {
            const ventesResponse = await fetch(`/api/abonnements/clients/${clientId}/ventes`, {
                credentials: 'include'
            });
            
            let ventes = [];
            
            if (ventesResponse.ok) {
                const ventesResult = await ventesResponse.json();
                
                if (ventesResult.success && ventesResult.data && ventesResult.data.ventes) {
                    ventes = ventesResult.data.ventes;
                } else {
                    console.warn('Structure de réponse inattendue:', ventesResult);
                }
            } else {
                console.warn('Erreur lors du chargement des ventes:', ventesResponse.status);
            }
            
            // Afficher les ventes ou le message "aucune commande"
            tbody.innerHTML = '';
            
            if (!ventes || ventes.length === 0) {
                document.getElementById('no-commandes').style.display = 'block';
                tbody.closest('.table-responsive').style.display = 'none';
            } else {
                document.getElementById('no-commandes').style.display = 'none';
                tbody.closest('.table-responsive').style.display = 'block';
                
                ventes.forEach((vente) => {
                    const row = document.createElement('tr');
                    
                    // Formater le rabais
                    let rabaisHTML = '-';
                    if (vente.rabaisApplique && vente.rabaisApplique > 0) {
                        rabaisHTML = `<span class="text-danger fw-bold">${formatMontant(vente.rabaisApplique)}</span>`;
                    }
                    
                    // Gérer les valeurs potentiellement nulles
                    const dateFormatted = vente.date ? formatDate(vente.date) : 'N/A';
                    const pointVente = vente.pointVente || 'N/A';
                    const produit = vente.produit || 'N/A';
                    const categorie = vente.categorie || 'N/A';
                    const nombre = vente.nombre !== null && vente.nombre !== undefined ? vente.nombre : 0;
                    const prixUnit = vente.prixUnit !== null && vente.prixUnit !== undefined ? formatMontant(vente.prixUnit) : '0 F CFA';
                    const montant = vente.montant !== null && vente.montant !== undefined ? formatMontant(vente.montant) : '0 F CFA';
                    
                    row.innerHTML = `
                        <td>${dateFormatted}</td>
                        <td>${pointVente}</td>
                        <td>
                            <div><strong>${produit}</strong></div>
                            <small class="text-muted">${categorie}</small>
                        </td>
                        <td>${nombre}</td>
                        <td class="text-end">${prixUnit}</td>
                        <td class="text-end">${rabaisHTML}</td>
                        <td class="text-end"><strong>${montant}</strong></td>
                    `;
                    tbody.appendChild(row);
                });
            }
        } catch (ventesError) {
            console.error('Erreur lors du chargement des ventes:', ventesError);
            tbody.innerHTML = '';
            document.getElementById('no-commandes').style.display = 'block';
            tbody.closest('.table-responsive').style.display = 'none';
        }
    } catch (error) {
        console.error('Erreur lors de l\'affichage des commandes:', error);
        showNotification('Erreur lors du chargement des commandes', 'error');
        
        // Afficher quand même un message approprié dans la modal
        const tbody = document.getElementById('commandes-table-body');
        tbody.innerHTML = '';
        document.getElementById('no-commandes').style.display = 'block';
        tbody.closest('.table-responsive').style.display = 'none';
    }
}

function showNotification(message, type = 'info') {
    const alertClass = type === 'error' ? 'alert-danger' : 
                       type === 'success' ? 'alert-success' : 
                       'alert-info';
    
    const alert = document.createElement('div');
    alert.className = `alert ${alertClass} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3`;
    alert.style.zIndex = '9999';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alert);
    
    setTimeout(() => {
        alert.remove();
    }, 5000);
}

