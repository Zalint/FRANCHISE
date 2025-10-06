// Variables globales
let currentUser = null;
let selectedClientId = null;
let clients = [];
let clientModal, detailsModal, paiementModal;

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', async () => {
    // Vérifier l'authentification
    await checkSession();
    
    // Initialiser les modals Bootstrap
    clientModal = new bootstrap.Modal(document.getElementById('clientModal'));
    detailsModal = new bootstrap.Modal(document.getElementById('detailsModal'));
    paiementModal = new bootstrap.Modal(document.getElementById('paiementModal'));
    
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
function displayClients(clientsToDisplay) {
    const container = document.getElementById('clients-container');
    const noClientsMessage = document.getElementById('no-clients-message');
    
    container.innerHTML = '';
    
    if (clientsToDisplay.length === 0) {
        noClientsMessage.style.display = 'block';
        return;
    }
    
    noClientsMessage.style.display = 'none';
    
    clientsToDisplay.forEach(client => {
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
                <div class="card-footer bg-transparent border-top-0">
                    <small class="text-muted">
                        <i class="bi bi-calendar3"></i> Inscrit le ${formatDate(client.date_inscription)}
                    </small>
                </div>
            </div>
        `;
        
        container.appendChild(card);
    });
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

