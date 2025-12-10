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

// Vérification de l'authentification et des droits
async function checkAuth() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (!data.success) {
            window.location.href = 'login.html';
            return false;
        }
        
        if (!data.user.isAdmin) {
            window.location.href = 'index.html';
            return false;
        }
        
        // Afficher les informations de l'utilisateur
        const roleDisplayName = getUserRoleDisplayName(data.user);
        document.getElementById('user-info').textContent = `Connecté en tant que ${data.user.username} (${roleDisplayName})`;
        
        // Afficher l'onglet de gestion des utilisateurs seulement pour l'utilisateur ADMIN
        if (data.user.username === 'ADMIN') {
            const userManagementNav = document.getElementById('user-management-nav');
            if (userManagementNav) {
                userManagementNav.style.display = 'block';
            }
        }
        
        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification de la session:', error);
        window.location.href = 'login.html';
        return false;
    }
}

// Gestion de la déconnexion
function initLogoutButton() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            try {
                const response = await fetch('/api/logout', {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await response.json();
                if (data.success) {
                    localStorage.removeItem('user');
                    window.location.href = 'login.html';
                }
            } catch (error) {
                console.error('Erreur lors de la déconnexion:', error);
            }
        });
    }
}

// Configuration des dates
function initDatePickers() {
    const dateCorrectionInput = document.getElementById('date-correction');
    if (dateCorrectionInput) {
        flatpickr(dateCorrectionInput, {
            locale: "fr",
            dateFormat: "d/m/Y",
            defaultDate: "today"
        });
    }
}

// Gestion des onglets
function initNavigation() {
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.dataset.section;
            
            // Mettre à jour les classes actives
            document.querySelectorAll('.nav-link[data-section]').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            
            // Afficher la section correspondante
            document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
            const targetSection = document.getElementById(`${section}-section`);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });
}

// Charger les points de vente
async function chargerPointsVente() {
    try {
        console.log('Chargement des points de vente...');
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Données reçues:', data);
        
        if (!data.success || !data.pointsVente) {
            throw new Error('Format de réponse invalide');
        }
        
        const pointsVente = data.pointsVente;
        console.log('Points de vente:', pointsVente);
        
        // Trouver le select pour les points de vente
        const selectPointVente = document.getElementById('point-vente-filter');
        if (!selectPointVente) {
            console.error('Select point de vente non trouvé');
            return;
        }
        
        // Vider le select
        selectPointVente.innerHTML = '<option value="">Tous</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom);
        
        console.log('Points de vente actifs:', pointsVenteActifs);
        
        // Ajouter les options pour les points de vente actifs
        pointsVenteActifs.forEach(pointVente => {
            const option = document.createElement('option');
            option.value = pointVente;
            option.textContent = pointVente;
            selectPointVente.appendChild(option);
        });
        
        console.log('Points de vente chargés avec succès');
        
        // Afficher la liste complète des points de vente dans le tableau
        afficherListePointsVente(pointsVente);
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

// Afficher la liste des points de vente dans le tableau
function afficherListePointsVente(pointsVente) {
    const tbody = document.querySelector('#points-vente-table tbody');
    if (!tbody) {
        console.error('Tableau des points de vente non trouvé');
        return;
    }
    
    // Vider le tableau
    tbody.innerHTML = '';
    
    // Trier les points de vente par nom
    const pointsVenteTries = Object.entries(pointsVente).sort(([a], [b]) => a.localeCompare(b));
    
    pointsVenteTries.forEach(([nom, config]) => {
        const row = document.createElement('tr');
        const pvId = config.id;
        console.log(`Point de vente: ${nom}, ID: ${pvId}, config:`, config);
        
        // Colonne Nom
        const tdNom = document.createElement('td');
        tdNom.textContent = nom;
        row.appendChild(tdNom);
        
        // Colonne Référence de paiement avec bouton
        const tdPaymentRef = document.createElement('td');
        const inputGroup = document.createElement('div');
        inputGroup.className = 'd-flex align-items-center gap-2';
        
        const paymentRefInput = document.createElement('input');
        paymentRefInput.type = 'text';
        paymentRefInput.className = 'form-control form-control-sm';
        paymentRefInput.value = config.payment_ref || '';
        paymentRefInput.placeholder = 'Ex: V_KB';
        paymentRefInput.style.width = '100px';
        paymentRefInput.id = `payment-ref-${pvId}`;
        
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary btn-sm';
        saveBtn.innerHTML = '<i class="fas fa-save"></i>';
        saveBtn.title = 'Sauvegarder';
        saveBtn.onclick = () => updatePaymentRef(pvId, nom, paymentRefInput.value);
        
        inputGroup.appendChild(paymentRefInput);
        inputGroup.appendChild(saveBtn);
        tdPaymentRef.appendChild(inputGroup);
        row.appendChild(tdPaymentRef);
        
        // Colonne Statut
        const tdStatut = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.className = config.active ? 'badge bg-success' : 'badge bg-danger';
        statusBadge.textContent = config.active ? 'Actif' : 'Inactif';
        tdStatut.appendChild(statusBadge);
        row.appendChild(tdStatut);
        
        // Colonne Actions
        const tdActions = document.createElement('td');
        const toggleBtn = document.createElement('button');
        toggleBtn.className = config.active ? 'btn btn-warning btn-sm' : 'btn btn-success btn-sm';
        toggleBtn.textContent = config.active ? 'Désactiver' : 'Activer';
        toggleBtn.onclick = () => togglePointVente(nom);
        tdActions.appendChild(toggleBtn);
        row.appendChild(tdActions);
        
        tbody.appendChild(row);
    });
}

// Mettre à jour la référence de paiement d'un point de vente
async function updatePaymentRef(id, nom, paymentRef) {
    if (!id) {
        alert('ID du point de vente non trouvé');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/points-vente/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nom, payment_ref: paymentRef })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`Référence "${paymentRef}" sauvegardée pour ${nom}`);
            console.log(`Référence de paiement mise à jour pour ${nom}: ${paymentRef}`);
        } else {
            alert(data.error || 'Erreur lors de la mise à jour');
            chargerPointsVente();
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur lors de la mise à jour de la référence');
        chargerPointsVente();
    }
}

// Ajouter un nouveau point de vente
async function ajouterPointVente() {
    const nomInput = document.getElementById('newPointVente');
    const nom = nomInput.value.trim();
    
    if (!nom) {
        alert('Veuillez saisir un nom pour le point de vente');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                nom,
                action: 'add'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            nomInput.value = '';
            chargerPointsVente();
            alert('Point de vente ajouté avec succès');
        } else {
            alert(data.message || 'Erreur lors de l\'ajout du point de vente');
        }
    } catch (error) {
        console.error('Erreur lors de l\'ajout du point de vente:', error);
        alert('Erreur lors de l\'ajout du point de vente');
    }
}

// Activer/désactiver un point de vente
async function togglePointVente(nom) {
    try {
        const response = await fetch('/api/admin/points-vente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                nom,
                action: 'toggle'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            chargerPointsVente();
        } else {
            alert(data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la modification du point de vente:', error);
        alert('Erreur lors de la modification du point de vente');
    }
}

// Charger les produits
async function chargerProduits() {
    try {
        const response = await fetch('/api/admin/produits', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            // Remplir les menus de catégories
            const categorieSelect = document.getElementById('categorie-select');
            const categoriePrix = document.getElementById('categoriePrix');
            const categorieCorrection = document.getElementById('categorie-correction');
            
            if (categorieSelect) {
                categorieSelect.innerHTML = '<option value="">Sélectionner une catégorie</option>';
                Object.keys(data.produits).forEach(categorie => {
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    categorieSelect.appendChild(option);
                });
            }
            
            if (categoriePrix) {
                categoriePrix.innerHTML = '<option value="">Sélectionner une catégorie</option>';
                Object.keys(data.produits).forEach(categorie => {
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    categoriePrix.appendChild(option);
                });
            }
            
            if (categorieCorrection) {
                categorieCorrection.innerHTML = '<option value="">Sélectionner une catégorie</option>';
                Object.keys(data.produits).forEach(categorie => {
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    categorieCorrection.appendChild(option);
                });
            }
            
            // Remplir le menu des produits pour la section stocks
            const produitFilter = document.getElementById('produit-filter');
            if (produitFilter) {
                produitFilter.innerHTML = '<option value="">Tous</option>';
                
                // Liste limitée des produits pour le filtre
                const produitsLimites = ['Boeuf', 'Veau', 'Poulet', 'Volaille'];
                
                // Ajouter seulement les produits de la liste limitée
                produitsLimites.forEach(produit => {
                    const option = document.createElement('option');
                    option.value = produit;
                    option.textContent = produit;
                    produitFilter.appendChild(option);
                });
            }
            
            // Stocker les produits globalement pour les utiliser dans les event listeners
            window.produits = data.produits;
        } else {
            console.error('Erreur lors du chargement des produits:', data.message);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des produits:', error);
    }
}

// Initialiser les event listeners pour les prix
function initPrixEventListeners() {
    // Gestion des changements de catégorie pour les prix
    const categoriePrixSelect = document.getElementById('categoriePrix');
    if (categoriePrixSelect) {
        categoriePrixSelect.addEventListener('change', function() {
            const categorie = this.value;
            const produitSelect = document.getElementById('produitPrix');
            
            if (produitSelect) {
                // Vider le menu des produits
                produitSelect.innerHTML = '<option value="">Sélectionner un produit</option>';
                
                if (categorie && window.produits && window.produits[categorie]) {
                    // Remplir le menu des produits de la catégorie sélectionnée
                    Object.keys(window.produits[categorie]).forEach(produit => {
                        const option = document.createElement('option');
                        option.value = produit;
                        option.textContent = produit;
                        produitSelect.appendChild(option);
                    });
                }
            }
        });
    }

    // Gestion de la modification des prix
    const modifierPrixBtn = document.getElementById('modifier-prix');
    if (modifierPrixBtn) {
        modifierPrixBtn.addEventListener('click', async function() {
            const categorie = document.getElementById('categoriePrix')?.value;
            const produit = document.getElementById('produitPrix')?.value;
            const nouveauPrix = document.getElementById('nouveau-prix')?.value;
            
            if (!categorie || !produit || !nouveauPrix) {
                alert('Veuillez remplir tous les champs');
                return;
            }
            
            try {
                const response = await fetch('/api/admin/prix', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        categorie,
                        produit,
                        nouveauPrix: parseFloat(nouveauPrix)
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('nouveau-prix').value = '';
                    alert('Prix modifié avec succès');
                    chargerProduits(); // Recharger les produits pour mettre à jour les menus
                } else {
                    alert(data.message);
                }
            } catch (error) {
                console.error('Erreur lors de la modification du prix:', error);
                alert('Erreur lors de la modification du prix');
            }
        });
    }
}

// Initialiser les event listeners pour les corrections
function initCorrectionsEventListeners() {
    // Gestion des changements de catégorie pour les corrections
    const categorieCorrectionSelect = document.getElementById('categorie-correction');
    if (categorieCorrectionSelect) {
        categorieCorrectionSelect.addEventListener('change', function() {
            const categorie = this.value;
            const produitSelect = document.getElementById('produit-correction');
            
            if (produitSelect) {
                // Vider le menu des produits
                produitSelect.innerHTML = '<option value="">Sélectionner un produit</option>';
                
                if (categorie && window.produits && window.produits[categorie]) {
                    // Remplir le menu des produits de la catégorie sélectionnée
                    Object.keys(window.produits[categorie]).forEach(produit => {
                        const option = document.createElement('option');
                        option.value = produit;
                        option.textContent = produit;
                        produitSelect.appendChild(option);
                    });
                }
            }
        });
    }

    // Gestion de la correction des totaux
    const corrigerTotalBtn = document.getElementById('corriger-total');
    if (corrigerTotalBtn) {
        corrigerTotalBtn.addEventListener('click', async function() {
            const date = document.getElementById('date-correction')?.value;
            const pointVente = document.getElementById('point-vente-correction')?.value;
            const categorie = document.getElementById('categorie-correction')?.value;
            const produit = document.getElementById('produit-correction')?.value;
            const nouveauTotal = document.getElementById('nouveau-total')?.value;
            
            if (!date || !pointVente || !categorie || !produit || !nouveauTotal) {
                alert('Veuillez remplir tous les champs');
                return;
            }
            
            try {
                const response = await fetch('/api/admin/corriger-total', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        date,
                        pointVente,
                        categorie,
                        produit,
                        nouveauTotal: parseFloat(nouveauTotal)
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('nouveau-total').value = '';
                    alert('Total corrigé avec succès');
                } else {
                    alert(data.message);
                }
            } catch (error) {
                console.error('Erreur lors de la correction du total:', error);
                alert('Erreur lors de la correction du total');
            }
        });
    }
}

// Initialiser les event listeners pour les points de vente
function initPointsVenteEventListeners() {
    const addPointVenteForm = document.getElementById('addPointVenteForm');
    if (addPointVenteForm) {
        addPointVenteForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const nom = document.getElementById('newPointVente')?.value;
            
            if (!nom) {
                alert('Veuillez saisir un nom de point de vente');
                return;
            }
            
            try {
                const response = await fetch('/api/admin/points-vente', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        nom,
                        action: 'add'
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('newPointVente').value = '';
                    chargerPointsVente();
                    alert('Point de vente ajouté avec succès');
                } else {
                    alert(data.message);
                }
            } catch (error) {
                console.error('Erreur lors de l\'ajout du point de vente:', error);
                alert('Erreur lors de l\'ajout du point de vente');
            }
        });
    }
}

// Variables globales pour les données de stock
let stockMatinData = [];
let stockSoirData = [];
let transfertsData = [];
let consolidatedData = [];

// Initialisation de la section stocks
function initStocksSection() {
    console.log('Initialisation de la section stocks...');
    
    // Initialiser les datepickers
    const dateDebutInput = document.getElementById('date-debut');
    const dateFinInput = document.getElementById('date-fin');
    
    if (dateDebutInput && dateFinInput) {
        flatpickr(dateDebutInput, {
            dateFormat: "d/m/Y",
            locale: "fr",
            allowInput: true
        });
        
        flatpickr(dateFinInput, {
            dateFormat: "d/m/Y",
            locale: "fr",
            allowInput: true
        });
    }
    
    // Charger les listes des points de vente et produits
    loadFilterOptions();
    
    // Ajouter les event listeners
    const rechercherBtn = document.getElementById('rechercher-stocks');
    if (rechercherBtn) {
        rechercherBtn.addEventListener('click', rechercherStocks);
    }
    
    const exportBtn = document.getElementById('export-excel');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToExcel);
    }
    
    // Charger les données par défaut (derniers 7 jours)
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    if (dateDebutInput && dateFinInput) {
        dateDebutInput.value = sevenDaysAgo.toLocaleDateString('fr-FR');
        dateFinInput.value = today.toLocaleDateString('fr-FR');
        
        // Rechercher automatiquement
        rechercherStocks();
    }
}

// Charger les options des filtres
async function loadFilterOptions() {
    try {
        // Charger les points de vente depuis l'API (base de données)
        const response = await fetch('/api/points-vente');
        const pointsVente = response.ok ? await response.json() : [];
        
        const pointVenteSelect = document.getElementById('point-vente-filter');
        if (pointVenteSelect) {
            pointsVente.forEach(pv => {
                const option = document.createElement('option');
                option.value = pv;
                option.textContent = pv;
                pointVenteSelect.appendChild(option);
            });
        }
        
        // Charger les produits
        const produits = ['Boeuf', 'Veau', 'Poulet', 'Volaille'];
        const produitSelect = document.getElementById('produit-filter');
        if (produitSelect) {
            produits.forEach(prod => {
                const option = document.createElement('option');
                option.value = prod;
                option.textContent = prod;
                produitSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement des options:', error);
    }
}

// Test direct des APIs pour déboguer
async function testAPIs() {
    console.log('=== TEST DES APIs ===');
    
    try {
        // Test stock matin
        console.log('Test API stock matin...');
        const matinResponse = await fetch('/api/stock/matin?date=2025-07-17', {
            credentials: 'include'
        });
        console.log('Status stock matin:', matinResponse.status);
        if (matinResponse.ok) {
            const matinData = await matinResponse.json();
            console.log('Données stock matin:', matinData);
        } else {
            console.log('Erreur stock matin:', matinResponse.statusText);
        }
        
        // Test stock soir
        console.log('Test API stock soir...');
        const soirResponse = await fetch('/api/stock/soir?date=2025-07-17', {
            credentials: 'include'
        });
        console.log('Status stock soir:', soirResponse.status);
        if (soirResponse.ok) {
            const soirData = await soirResponse.json();
            console.log('Données stock soir:', soirData);
        } else {
            console.log('Erreur stock soir:', soirResponse.statusText);
        }
        
        // Test transferts
        console.log('Test API transferts...');
        const transfertsResponse = await fetch('/api/transferts?date=2025-07-17', {
            credentials: 'include'
        });
        console.log('Status transferts:', transfertsResponse.status);
        if (transfertsResponse.ok) {
            const transfertsData = await transfertsResponse.json();
            console.log('Données transferts:', transfertsData);
        } else {
            console.log('Erreur transferts:', transfertsResponse.statusText);
        }
        
    } catch (error) {
        console.error('Erreur lors du test des APIs:', error);
    }
}

// Rechercher les données de stock
async function rechercherStocks() {
    console.log('Recherche des données de stock...');
    
    const dateDebut = document.getElementById('date-debut')?.value;
    const dateFin = document.getElementById('date-fin')?.value;
    const pointVente = document.getElementById('point-vente-filter')?.value;
    const produit = document.getElementById('produit-filter')?.value;
    
    if (!dateDebut || !dateFin) {
        alert('Veuillez sélectionner une période de dates');
        return;
    }
    
    console.log('Paramètres de recherche:', { dateDebut, dateFin, pointVente, produit });
    
    // Afficher le loading
    showLoading();
    
    try {
        // Test des APIs d'abord
        await testAPIs();
        
        // Convertir les dates au format YYYY-MM-DD
        const dateDebutFormatted = convertDateToISO(dateDebut);
        const dateFinFormatted = convertDateToISO(dateFin);
        
        console.log('Dates formatées:', { dateDebutFormatted, dateFinFormatted });
        
        // Récupérer toutes les données pour la période
        const allData = await fetchStockDataForPeriod(dateDebutFormatted, dateFinFormatted);
        
        // Filtrer les données selon les critères
        stockMatinData = filterData(allData.stockMatin, pointVente, produit);
        stockSoirData = filterData(allData.stockSoir, pointVente, produit);
        transfertsData = filterTransfertsData(allData.transferts, pointVente, produit);
        
        // Créer les données consolidées
        consolidatedData = createConsolidatedData();
        
        // Afficher les données consolidées
        displayConsolidatedData();
        
        console.log('Données récupérées:', {
            stockMatin: stockMatinData.length,
            stockSoir: stockSoirData.length,
            transferts: transfertsData.length,
            consolidated: consolidatedData.length
        });
        
    } catch (error) {
        console.error('Erreur lors de la recherche:', error);
        alert('Erreur lors de la récupération des données');
    } finally {
        hideLoading();
    }
}

// Récupérer les données de stock pour une période
async function fetchStockDataForPeriod(dateDebut, dateFin) {
    const stockMatin = [];
    const stockSoir = [];
    const transferts = [];
    
    // Générer la liste des dates entre dateDebut et dateFin
    const dates = generateDateRange(dateDebut, dateFin);
    
    console.log('Dates à traiter:', dates);
    
    // Récupérer les données pour chaque date
    for (const date of dates) {
        try {
            console.log(`Traitement de la date: ${date}`);
            
            // Stock matin
            const matinResponse = await fetch(`/api/stock/matin?date=${date}`, {
                credentials: 'include'
            });
            console.log(`Réponse stock matin pour ${date}:`, matinResponse.status);
            
            if (matinResponse.ok) {
                const matinData = await matinResponse.json();
                console.log(`Données stock matin pour ${date}:`, matinData);
                
                if (matinData && Object.keys(matinData).length > 0) {
                    Object.values(matinData).forEach(item => {
                        stockMatin.push({
                            date: item.date,
                            pointVente: item['Point de Vente'],
                            produit: item.Produit,
                            quantite: parseFloat(item.Nombre) || 0,
                            prixUnitaire: parseFloat(item.PU) || 0,
                            montant: parseFloat(item.Montant) || 0,
                            commentaire: item.Commentaire || ''
                        });
                    });
                }
            }
            
            // Stock soir
            const soirResponse = await fetch(`/api/stock/soir?date=${date}`, {
                credentials: 'include'
            });
            console.log(`Réponse stock soir pour ${date}:`, soirResponse.status);
            
            if (soirResponse.ok) {
                const soirData = await soirResponse.json();
                console.log(`Données stock soir pour ${date}:`, soirData);
                
                if (soirData && Object.keys(soirData).length > 0) {
                    Object.values(soirData).forEach(item => {
                        stockSoir.push({
                            date: item.date,
                            pointVente: item['Point de Vente'],
                            produit: item.Produit,
                            quantite: parseFloat(item.Nombre) || 0,
                            prixUnitaire: parseFloat(item.PU) || 0,
                            montant: parseFloat(item.Montant) || 0,
                            commentaire: item.Commentaire || ''
                        });
                    });
                }
            }
            
            // Transferts
            const transfertsResponse = await fetch(`/api/transferts?date=${date}`, {
                credentials: 'include'
            });
            console.log(`Réponse transferts pour ${date}:`, transfertsResponse.status);
            
            if (transfertsResponse.ok) {
                const transfertsData = await transfertsResponse.json();
                console.log(`Données transferts pour ${date}:`, transfertsData);
                
                if (transfertsData && transfertsData.success && transfertsData.transferts) {
                    transfertsData.transferts.forEach(item => {
                        transferts.push({
                            date: item.date,
                            pointVente: item.pointVente,
                            produit: item.produit,
                            impact: item.impact,
                            quantite: parseFloat(item.quantite) || 0,
                            prixUnitaire: parseFloat(item.prixUnitaire) || 0,
                            total: parseFloat(item.total) || 0,
                            commentaire: item.commentaire || ''
                        });
                    });
                }
            }
            
        } catch (error) {
            console.error(`Erreur pour la date ${date}:`, error);
        }
    }
    
    console.log('Résultats finaux:', {
        stockMatin: stockMatin.length,
        stockSoir: stockSoir.length,
        transferts: transferts.length
    });
    
    return { stockMatin, stockSoir, transferts };
}

// Créer les données consolidées avec ventes théoriques
function createConsolidatedData() {
    const consolidated = [];
    
    // Créer un map pour faciliter la recherche
    const stockMatinMap = new Map();
    const stockSoirMap = new Map();
    const transfertsMap = new Map();
    
    // Indexer les données par clé unique (date + pointVente + produit)
    stockMatinData.forEach(item => {
        const key = `${item.date}-${item.pointVente}-${item.produit}`;
        stockMatinMap.set(key, item);
    });
    
    stockSoirData.forEach(item => {
        const key = `${item.date}-${item.pointVente}-${item.produit}`;
        stockSoirMap.set(key, item);
    });
    
    transfertsData.forEach(item => {
        const key = `${item.date}-${item.pointVente}-${item.produit}`;
        if (transfertsMap.has(key)) {
            // Si plusieurs transferts pour la même clé, additionner les quantités
            const existing = transfertsMap.get(key);
            existing.quantite += item.quantite;
        } else {
            transfertsMap.set(key, { ...item });
        }
    });
    
    // Créer un set de toutes les clés uniques
    const allKeys = new Set([
        ...stockMatinMap.keys(),
        ...stockSoirMap.keys(),
        ...transfertsMap.keys()
    ]);
    
    // Créer les données consolidées
    allKeys.forEach(key => {
        const [date, pointVente, produit] = key.split('-');
        
        const stockMatin = stockMatinMap.get(key);
        const stockSoir = stockSoirMap.get(key);
        const transfert = transfertsMap.get(key);
        
        const stockMatinQuantite = stockMatin ? stockMatin.quantite : 0;
        const stockSoirQuantite = stockSoir ? stockSoir.quantite : 0;
        const transfertQuantite = transfert ? transfert.quantite : 0;
        
        // Calculer les ventes théoriques : Stock Soir - (Stock Matin + Transferts)
        const ventesTheoriques = stockSoirQuantite - (stockMatinQuantite + transfertQuantite);
        
        consolidated.push({
            date: date,
            pointVente: pointVente,
            produit: produit,
            stockMatin: stockMatinQuantite,
            stockSoir: stockSoirQuantite,
            transferts: transfertQuantite,
            ventesTheoriques: ventesTheoriques
        });
    });
    
    // Trier par date, puis par point de vente, puis par produit
    consolidated.sort((a, b) => {
        if (a.date !== b.date) return new Date(a.date.split('/').reverse().join('-')) - new Date(b.date.split('/').reverse().join('-'));
        if (a.pointVente !== b.pointVente) return a.pointVente.localeCompare(b.pointVente);
        return a.produit.localeCompare(b.produit);
    });
    
    return consolidated;
}

// Afficher les données consolidées
function displayConsolidatedData() {
    const tbody = document.getElementById('consolidated-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (consolidatedData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Aucune donnée disponible</td></tr>';
        return;
    }
    
    consolidatedData.forEach(item => {
        const row = document.createElement('tr');
        const ventesClass = item.ventesTheoriques >= 0 ? 'text-success' : 'text-danger';
        
        row.innerHTML = `
            <td>${item.date}</td>
            <td>${item.pointVente}</td>
            <td>${item.produit}</td>
            <td class="text-end">${item.stockMatin.toLocaleString('fr-FR')}</td>
            <td class="text-end">${item.stockSoir.toLocaleString('fr-FR')}</td>
            <td class="text-end">${item.transferts.toLocaleString('fr-FR')}</td>
            <td class="text-end ${ventesClass}">${item.ventesTheoriques.toLocaleString('fr-FR')}</td>
        `;
        tbody.appendChild(row);
    });
}

// Filtrer les données selon les critères
function filterData(data, pointVente, produit) {
    return data.filter(item => {
        const matchPointVente = !pointVente || item.pointVente === pointVente;
        const matchProduit = !produit || item.produit === produit;
        return matchPointVente && matchProduit;
    });
}

// Filtrer les données de transferts
function filterTransfertsData(data, pointVente, produit) {
    return data.filter(item => {
        const matchPointVente = !pointVente || item.pointVente === pointVente;
        const matchProduit = !produit || item.produit === produit;
        return matchPointVente && matchProduit;
    });
}

// Exporter les données en Excel
function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        alert('Bibliothèque Excel non disponible');
        return;
    }
    
    const dateDebut = document.getElementById('date-debut')?.value;
    const dateFin = document.getElementById('date-fin')?.value;
    const pointVente = document.getElementById('point-vente-filter')?.value;
    const produit = document.getElementById('produit-filter')?.value;
    
    if (consolidatedData.length === 0) {
        alert('Aucune donnée à exporter');
        return;
    }
    
    // Créer un nouveau classeur
    const workbook = XLSX.utils.book_new();
    
    // Préparer les données pour Excel
    const excelData = consolidatedData.map(item => ({
        'Date': item.date,
        'Point de Vente': item.pointVente,
        'Produit': item.produit,
        'Stock Matin': item.stockMatin,
        'Stock Soir': item.stockSoir,
        'Transferts': item.transferts,
        'Ventes Théoriques': item.ventesTheoriques
    }));
    
    // Créer la feuille Excel
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Ajouter la feuille au classeur
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stocks et Ventes');
    
    // Générer le nom du fichier
    let filename = 'stocks_et_ventes_theoriques';
    if (dateDebut && dateFin) {
        filename += `_${dateDebut.replace(/\//g, '-')}_${dateFin.replace(/\//g, '-')}`;
    }
    if (pointVente) {
        filename += `_${pointVente.replace(/\s+/g, '_')}`;
    }
    if (produit) {
        filename += `_${produit}`;
    }
    filename += '.xlsx';
    
    // Télécharger le fichier
    XLSX.writeFile(workbook, filename);
    
    alert(`Export Excel réussi : ${filename}`);
}

// Utilitaires
function convertDateToISO(dateStr) {
    if (!dateStr) return '';
    
    // Si la date est déjà au format YYYY-MM-DD, la retourner telle quelle
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    
    // Convertir depuis le format DD/MM/YYYY
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
            return `${year}-${month}-${day}`;
        }
    }
    
    // Convertir depuis le format DD-MM-YYYY
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            // Si le premier élément a 4 chiffres, c'est déjà YYYY-MM-DD
            if (parts[0].length === 4) {
                return dateStr;
            }
            // Sinon c'est DD-MM-YYYY
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
            return `${year}-${month}-${day}`;
        }
    }
    
    console.error('Format de date non reconnu:', dateStr);
    return dateStr;
}

function generateDateRange(startDate, endDate) {
    const dates = [];
    const currentDate = new Date(startDate);
    const end = new Date(endDate);
    
    while (currentDate <= end) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
}

function showLoading() {
    const tbody = document.getElementById('consolidated-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center loading"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr>';
    }
}

function hideLoading() {
    // Le loading est remplacé par les données ou le message "Aucune donnée"
}

// ==== GESTION DE LA CONFIGURATION DES PRODUITS ====

// Variables globales pour la configuration des produits
let currentProduitsConfig = {};
let currentInventaireConfig = {};
let currentAbonnementConfig = {};

// Charger la configuration des produits généraux
async function chargerConfigProduits() {
    try {
        const response = await fetch('/api/admin/config/produits', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success && data.produits) {
            currentProduitsConfig = data.produits;
            console.log('✅ Produits chargés:', Object.keys(currentProduitsConfig));
            afficherProduitsConfig();
        } else {
            console.error('Erreur lors du chargement de la configuration des produits:', data.message || 'Données vides');
            currentProduitsConfig = {};
        }
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration des produits:', error);
        currentProduitsConfig = {};
    }
}

// Charger la configuration des produits d'inventaire
async function chargerConfigInventaire() {
    try {
        const response = await fetch('/api/admin/config/produits-inventaire', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            currentInventaireConfig = data.produitsInventaire;
            
            // Mettre à jour les catégories personnalisées depuis le serveur
            if (data.categoriesPersonnalisees && data.categoriesPersonnalisees.length > 0) {
                localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(data.categoriesPersonnalisees));
                console.log('📁 Catégories personnalisées chargées:', data.categoriesPersonnalisees);
            }
            
            afficherInventaireConfig();
        } else {
            console.error('Erreur lors du chargement de la configuration d\'inventaire:', data.message);
            alert('Erreur lors du chargement de la configuration d\'inventaire');
        }
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration d\'inventaire:', error);
        alert('Erreur lors du chargement de la configuration d\'inventaire');
    }
}

// Charger la configuration des produits d'abonnement
async function chargerConfigAbonnement() {
    try {
        const response = await fetch('/api/admin/config/produits-abonnement', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            currentAbonnementConfig = data.produitsAbonnement;
            afficherAbonnementConfig();
        } else {
            console.error('Erreur lors du chargement de la configuration d\'abonnement:', data.message);
            alert('Erreur lors du chargement de la configuration d\'abonnement');
        }
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration d\'abonnement:', error);
        alert('Erreur lors du chargement de la configuration d\'abonnement');
    }
}

// Afficher la configuration des produits généraux
// Fonction pour générer le bouton de suppression conditionnel
function getCategorieDeleteButton(categorie) {
    const categoriesPrincipales = ['Bovin', 'Ovin', 'Volaille', 'Pack', 'Caprin', 'Autres'];
    
    if (categoriesPrincipales.includes(categorie)) {
        return `<button class="btn btn-sm btn-secondary" disabled title="Catégorie principale - ne peut pas être supprimée">
                    <i class="fas fa-lock"></i>
                </button>`;
    } else {
        return `<button class="btn btn-sm btn-danger" onclick="supprimerCategorie('${categorie}')">
                    <i class="fas fa-trash"></i>
                </button>`;
    }
}

function afficherProduitsConfig() {
    const container = document.getElementById('produits-categories');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Protection contre les données undefined ou null
    if (!currentProduitsConfig || typeof currentProduitsConfig !== 'object') {
        container.innerHTML = '<div class="alert alert-warning">Aucune configuration de produits disponible</div>';
        return;
    }
    
    const categories = Object.keys(currentProduitsConfig);
    if (categories.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Aucun produit configuré. Utilisez l\'interface d\'administration pour ajouter des produits.</div>';
        return;
    }
    
    categories.forEach((categorie, index) => {
        if (typeof currentProduitsConfig[categorie] === 'object' && currentProduitsConfig[categorie] !== null) {
            const categorieHtml = `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="heading-${index}">
                        <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="collapse-${index}">
                            <i class="fas fa-folder-open me-2"></i>
                            ${categorie} (${Object.keys(currentProduitsConfig[categorie]).length} produits)
                            <div class="ms-auto me-3">
                                                            <button class="btn btn-sm btn-success" onclick="ajouterProduitCategorie('${categorie}')" data-bs-toggle="modal" data-bs-target="#addProductModal">
                                <i class="fas fa-plus"></i>
                            </button>
                            ${getCategorieDeleteButton(categorie)}
                            </div>
                        </button>
                    </h2>
                    <div id="collapse-${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" aria-labelledby="heading-${index}" data-bs-parent="#produits-categories">
                        <div class="accordion-body">
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Produit</th>
                                            <th>Prix Défaut</th>
                                            <th>Alternatives</th>
                                            <th>Prix Spéciaux</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${genererLignesProduits(categorie)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', categorieHtml);
        }
    });
}

// Générer les lignes de produits pour une catégorie
function genererLignesProduits(categorie) {
    let html = '';
    const produits = currentProduitsConfig[categorie];
    
    Object.keys(produits).forEach(produit => {
        const config = produits[produit];
        if (typeof config === 'object' && config.default !== undefined) {
            const alternatives = config.alternatives ? config.alternatives.join(', ') : '';
            const prixSpeciaux = Object.keys(config)
                .filter(key => !['default', 'alternatives'].includes(key))
                .map(key => `${key}: ${config[key]}`)
                .join(', ');
            
            html += `
                <tr>
                    <td>
                        <input type="text" class="form-control form-control-sm" value="${produit}" 
                               onchange="modifierNomProduit('${categorie}', '${produit}', this.value)">
                    </td>
                    <td>
                        <input type="number" class="form-control form-control-sm" value="${config.default}" 
                               onchange="modifierPrixDefaut('${categorie}', '${produit}', this.value)">
                    </td>
                    <td>
                        <input type="text" class="form-control form-control-sm" value="${alternatives}" 
                               placeholder="Ex: 3500,3600,3700"
                               onchange="modifierAlternatives('${categorie}', '${produit}', this.value)">
                    </td>
                    <td>
                        <small class="text-muted">${prixSpeciaux}</small>
                        <button class="btn btn-sm btn-outline-primary ms-1" onclick="modifierPrixSpeciaux('${categorie}', '${produit}')">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-danger" onclick="supprimerProduit('${categorie}', '${produit}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }
    });
    
    return html;
}

// Reorganiser les produits d'inventaire par catégories logiques + personnalisées
function reorganiserInventaireParCategories() {
    const inventaireParCategories = {
        "Viandes": {},
        "Œufs et Produits Laitiers": {},
        "Abats et Sous-produits": {},
        "Produits sur Pieds": {},
        "Déchets": {},
        "Autres": {}
    };
    
    // Liste des catégories personnalisées (stockées dans localStorage ou ajoutées manuellement)
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    
    // Ajouter les catégories personnalisées
    categoriesPersonnalisees.forEach(cat => {
        if (!inventaireParCategories[cat]) {
            inventaireParCategories[cat] = {};
        }
    });
    
    Object.keys(currentInventaireConfig).forEach(produit => {
        const config = currentInventaireConfig[produit];
        
        // Si c'est une catégorie personnalisée (objet sans prixDefault contenant des produits)
        if (typeof config === 'object' && config.prixDefault === undefined) {
            // Vérifier si c'est une catégorie avec des produits dedans
            const hasProducts = Object.keys(config).some(key => {
                const subConfig = config[key];
                return typeof subConfig === 'object' && subConfig.prixDefault !== undefined;
            });
            
            if (hasProducts || Object.keys(config).length === 0) {
                // C'est une catégorie personnalisée
                if (!inventaireParCategories[produit]) {
                    inventaireParCategories[produit] = {};
                }
                // Ajouter les produits de cette catégorie
                Object.keys(config).forEach(subProduit => {
                    if (typeof config[subProduit] === 'object' && config[subProduit].prixDefault !== undefined) {
                        inventaireParCategories[produit][subProduit] = config[subProduit];
                    }
                });
                
                // Sauvegarder cette catégorie comme personnalisée
                if (!categoriesPersonnalisees.includes(produit)) {
                    categoriesPersonnalisees.push(produit);
                    localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(categoriesPersonnalisees));
                }
                return;
            }
        }
        
        if (typeof config === 'object' && config.prixDefault !== undefined) {
            // Catégoriser les produits selon leur nom
            if (produit.includes('Boeuf') || produit.includes('Veau') || produit.includes('Poulet') || produit.includes('Agneau')) {
                inventaireParCategories["Viandes"][produit] = config;
            } else if (produit.includes('Tablette') || produit.includes('Oeuf')) {
                inventaireParCategories["Œufs et Produits Laitiers"][produit] = config;
            } else if (produit.includes('Foie') || produit.includes('Yell') || produit.includes('Abats') || produit.includes('Tete')) {
                inventaireParCategories["Abats et Sous-produits"][produit] = config;
            } else if (produit.includes('sur pieds') || produit.includes('sur pied')) {
                inventaireParCategories["Produits sur Pieds"][produit] = config;
            } else if (produit.includes('Déchet') || produit.includes('Dechet')) {
                inventaireParCategories["Déchets"][produit] = config;
            } else {
                inventaireParCategories["Autres"][produit] = config;
            }
        }
    });
    
    // Supprimer les catégories LOGIQUES vides (mais garder les personnalisées)
    const categoriesLogiques = ["Viandes", "Œufs et Produits Laitiers", "Abats et Sous-produits", "Produits sur Pieds", "Déchets", "Autres"];
    
    Object.keys(inventaireParCategories).forEach(categorie => {
        // Ne supprimer que les catégories logiques vides, garder les personnalisées
        if (Object.keys(inventaireParCategories[categorie]).length === 0 && categoriesLogiques.includes(categorie)) {
            delete inventaireParCategories[categorie];
        }
    });
    
    return inventaireParCategories;
}

// Fonction pour générer le bouton de suppression conditionnel pour l'inventaire
function getCategorieInventaireDeleteButton(categorie) {
    const categoriesInventairePrincipales = ['Viandes', 'Œufs et Produits Laitiers', 'Abats et Sous-produits', 'Produits sur Pieds', 'Déchets', 'Autres'];
    
    if (categoriesInventairePrincipales.includes(categorie)) {
        return `<button class="btn btn-sm btn-secondary" disabled title="Catégorie logique - ne peut pas être supprimée">
                    <i class="fas fa-lock"></i>
                </button>`;
    } else {
        return `<button class="btn btn-sm btn-danger" onclick="supprimerCategorieInventaire('${categorie}')">
                    <i class="fas fa-trash"></i>
                </button>`;
    }
}

// Afficher la configuration des produits d'inventaire avec accordéon
function afficherInventaireConfig() {
    const container = document.getElementById('inventaire-categories');
    if (!container) return;
    
    container.innerHTML = '';
    
    const inventaireParCategories = reorganiserInventaireParCategories();
    
    Object.keys(inventaireParCategories).forEach((categorie, index) => {
        const produits = inventaireParCategories[categorie];
        const nombreProduits = Object.keys(produits).length;
        
        const categorieHtml = `
            <div class="accordion-item">
                <h2 class="accordion-header" id="inventaire-heading-${index}">
                    <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#inventaire-collapse-${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="inventaire-collapse-${index}">
                        <i class="fas fa-warehouse me-2"></i>
                        ${categorie} (${nombreProduits} produits)
                        <div class="ms-auto me-3">
                            <button class="btn btn-sm btn-success" onclick="ajouterProduitInventaireCategorie('${categorie}')" data-bs-toggle="modal" data-bs-target="#addInventaireProductModal">
                                <i class="fas fa-plus"></i>
                            </button>
                            ${getCategorieInventaireDeleteButton(categorie)}
                        </div>
                    </button>
                </h2>
                <div id="inventaire-collapse-${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" aria-labelledby="inventaire-heading-${index}" data-bs-parent="#inventaire-categories">
                    <div class="accordion-body">
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Produit</th>
                                        <th>Prix Défaut</th>
                                        <th>Alternatives</th>
                                        <th>Mode Stock</th>
                                        <th>Prix Spéciaux</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${genererLignesProduitsInventaire(produits, categorie)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', categorieHtml);
    });
}

// Générer les lignes de produits pour une catégorie d'inventaire
function genererLignesProduitsInventaire(produits, categorie) {
    let html = '';
    
    // Vérifier si c'est une catégorie personnalisée
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    const isCustomCategory = categoriesPersonnalisees.includes(categorie);
    const catParam = isCustomCategory ? `'${categorie}'` : 'null';
    
    Object.keys(produits).forEach(produit => {
        const config = produits[produit];
        const alternatives = config.alternatives ? config.alternatives.join(', ') : '';
        const prixSpeciaux = Object.keys(config)
            .filter(key => !['prixDefault', 'alternatives', 'mode_stock', 'unite_stock'].includes(key))
            .map(key => `${key}: ${config[key]}`)
            .join(', ');
        
        const modeStock = config.mode_stock || 'manuel';
        const uniteStock = config.unite_stock || 'unite';
        
        html += `
            <tr>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${produit}" 
                           onchange="modifierNomProduitInventaire('${produit}', this.value, ${catParam})">
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm" value="${config.prixDefault}" 
                           onchange="modifierPrixInventaire('${produit}', 'prixDefault', this.value, ${catParam})">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${alternatives}" 
                           placeholder="Ex: 3500,3600"
                           onchange="modifierAlternativesInventaire('${produit}', this.value, ${catParam})">
                </td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <select class="form-select form-select-sm" style="width: 100px;" 
                                onchange="modifierModeStockInventaire('${produit}', this.value, ${catParam})">
                            <option value="manuel" ${modeStock === 'manuel' ? 'selected' : ''}>Manuel</option>
                            <option value="automatique" ${modeStock === 'automatique' ? 'selected' : ''}>Auto</option>
                        </select>
                        <select class="form-select form-select-sm" style="width: 80px;" 
                                onchange="modifierUniteStockInventaire('${produit}', this.value, ${catParam})">
                            <option value="unite" ${uniteStock === 'unite' ? 'selected' : ''}>Unité</option>
                            <option value="kilo" ${uniteStock === 'kilo' ? 'selected' : ''}>Kilo</option>
                        </select>
                    </div>
                </td>
                <td>
                    <small class="text-muted">${prixSpeciaux}</small>
                    <button class="btn btn-sm btn-outline-primary ms-1" onclick="modifierPrixSpeciauxInventaire('${produit}', ${catParam})">
                        <i class="fas fa-edit"></i>
                    </button>
                </td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="supprimerProduitInventaire('${produit}', ${catParam})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    return html;
}

// Afficher la configuration des produits d'abonnement
function afficherAbonnementConfig() {
    const container = document.getElementById('abonnement-categories');
    if (!container) return;
    
    container.innerHTML = '';
    
    Object.keys(currentAbonnementConfig).forEach((categorie, index) => {
        if (typeof currentAbonnementConfig[categorie] === 'object' && currentAbonnementConfig[categorie] !== null) {
            const nombreProduits = Object.keys(currentAbonnementConfig[categorie]).length;
            
            const categorieHtml = `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="abonnement-heading-${index}">
                        <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#abonnement-collapse-${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="abonnement-collapse-${index}">
                            <i class="fas fa-star me-2"></i>
                            ${categorie} (${nombreProduits} produits)
                            <div class="ms-auto me-3">
                                <button class="btn btn-sm btn-success" onclick="ajouterProduitAbonnementCategorie('${categorie}')" data-bs-toggle="modal" data-bs-target="#addAbonnementProductModal">
                                    <i class="fas fa-plus"></i>
                                </button>
                                ${getCategorieDeleteButton(categorie)}
                            </div>
                        </button>
                    </h2>
                    <div id="abonnement-collapse-${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" aria-labelledby="abonnement-heading-${index}" data-bs-parent="#abonnement-categories">
                        <div class="accordion-body">
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Produit</th>
                                            <th>Prix Défaut</th>
                                            <th>Alternatives</th>
                                            <th>Prix Spéciaux</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${genererLignesProduitsAbonnement(categorie)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', categorieHtml);
        }
    });
}

// Générer les lignes de produits pour une catégorie d'abonnement
function genererLignesProduitsAbonnement(categorie) {
    let html = '';
    const produits = currentAbonnementConfig[categorie];
    
    Object.keys(produits).forEach(produit => {
        const config = produits[produit];
        const alternatives = config.alternatives ? config.alternatives.join(', ') : '';
        const prixSpeciaux = Object.keys(config)
            .filter(key => !['default', 'alternatives'].includes(key))
            .map(key => `${key}: ${config[key]}`)
            .join(', ');
        
        html += `
            <tr>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${produit}" 
                           onchange="modifierNomProduitAbonnement('${categorie}', '${produit}', this.value)">
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm" value="${config.default}" 
                           onchange="modifierPrixAbonnement('${categorie}', '${produit}', 'default', this.value)">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${alternatives}" 
                           placeholder="Ex: 3500,3600"
                           onchange="modifierAlternativesAbonnement('${categorie}', '${produit}', this.value)">
                </td>
                <td>
                    <small class="text-muted">${prixSpeciaux}</small>
                    <button class="btn btn-sm btn-outline-primary ms-1" onclick="modifierPrixSpeciauxAbonnement('${categorie}', '${produit}')">
                        <i class="fas fa-edit"></i>
                    </button>
                </td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="supprimerProduitAbonnement('${categorie}', '${produit}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    return html;
}

// Fonctions de modification pour les produits généraux
function modifierNomProduit(categorie, ancienNom, nouveauNom) {
    if (nouveauNom && nouveauNom !== ancienNom) {
        const config = currentProduitsConfig[categorie][ancienNom];
        delete currentProduitsConfig[categorie][ancienNom];
        currentProduitsConfig[categorie][nouveauNom] = config;
        afficherProduitsConfig();
    }
}

function modifierPrixDefaut(categorie, produit, nouveauPrix) {
    currentProduitsConfig[categorie][produit].default = parseFloat(nouveauPrix) || 0;
}

function modifierAlternatives(categorie, produit, alternativesStr) {
    if (alternativesStr.trim()) {
        const alternatives = alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
        currentProduitsConfig[categorie][produit].alternatives = alternatives;
    } else {
        currentProduitsConfig[categorie][produit].alternatives = [];
    }
}

function modifierPrixSpeciaux(categorie, produit) {
    // Fermer tous les modals existants pour éviter les conflits
    const existingModals = document.querySelectorAll('.modal.show');
    existingModals.forEach(modal => {
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) {
            bsModal.hide();
        }
    });
    
    // Supprimer les modals de prix spéciaux existants
    const existingPrixModal = document.getElementById('prixSpeciauxModal');
    if (existingPrixModal) {
        existingPrixModal.remove();
    }
    
    // Récupérer la configuration actuelle du produit
    const config = currentProduitsConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives'].includes(key));
    
    // Créer le modal dynamiquement
    let modalHtml = `
        <div class="modal fade" id="prixSpeciauxModal" tabindex="-1" aria-labelledby="prixSpeciauxModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="prixSpeciauxModalLabel">Prix spéciaux pour "${produit}" (${categorie})</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label">Point de vente</label>
                                <select class="form-select" id="nouveauPointVente">
                                    <option value="">Sélectionner un point de vente</option>
                                    <!-- Les options seront chargées dynamiquement depuis points-vente.js -->
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label">Prix</label>
                                <input type="number" class="form-control" id="nouveauPrixSpecial" placeholder="0" min="0" step="0.01">
                            </div>
                            <div class="col-md-2">
                                <label class="form-label">&nbsp;</label>
                                <button type="button" class="btn btn-success w-100" onclick="ajouterPrixSpecial('${categorie}', '${produit}')">
                                    <i class="fas fa-plus"></i> Ajouter
                                </button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Point de Vente</th>
                                        <th>Prix</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="prixSpeciauxTableBody">
                                    <!-- Le contenu sera généré par refreshPrixSpeciauxTable -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>`;
    
    // Ajouter le nouveau modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('prixSpeciauxModal'));
    modal.show();
    
    // Remplir le tableau avec les données actuelles
    refreshPrixSpeciauxTable(categorie, produit);
    
    // Charger les points de vente dans le dropdown initial
    updatePointsVenteDropdown([]);
    
    // Nettoyer le modal quand il se ferme
    document.getElementById('prixSpeciauxModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

function ajouterPrixSpecial(categorie, produit) {
    const pointVente = document.getElementById('nouveauPointVente').value;
    const prix = parseFloat(document.getElementById('nouveauPrixSpecial').value);
    
    if (!pointVente) {
        alert('Veuillez sélectionner un point de vente');
        return;
    }
    
    if (!prix || prix <= 0) {
        alert('Veuillez saisir un prix valide');
        return;
    }
    
    // Vérifier si le prix spécial existe déjà
    if (currentProduitsConfig[categorie][produit][pointVente]) {
        alert(`Un prix spécial pour "${pointVente}" existe déjà. Utilisez l'édition pour le modifier.`);
        return;
    }
    
    // Ajouter le prix spécial
    currentProduitsConfig[categorie][produit][pointVente] = prix;
    
    // Recharger seulement le tableau dans le modal
    refreshPrixSpeciauxTable(categorie, produit);
    
    // Vider les champs
    document.getElementById('nouveauPointVente').value = '';
    document.getElementById('nouveauPrixSpecial').value = '';
    
    // Recharger l'affichage principal
    afficherProduitsConfig();
}

function modifierPrixSpecialExistant(categorie, produit, pointVente, nouveauPrix) {
    const prix = parseFloat(nouveauPrix);
    if (prix && prix > 0) {
        currentProduitsConfig[categorie][produit][pointVente] = prix;
        afficherProduitsConfig();
    }
}

function refreshPrixSpeciauxTable(categorie, produit) {
    const config = currentProduitsConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives'].includes(key));
    
    const tbody = document.getElementById('prixSpeciauxTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    prixSpeciaux.forEach(pointVente => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${pointVente}</td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${config[pointVente]}" 
                       onchange="modifierPrixSpecialExistant('${categorie}', '${produit}', '${pointVente}', this.value)">
            </td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="supprimerPrixSpecial('${categorie}', '${produit}', '${pointVente}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Mettre à jour les options du dropdown pour exclure les points de vente déjà utilisés
    updatePointsVenteDropdown(prixSpeciaux);
}

// Fonction pour mettre à jour le dropdown des points de vente
async function updatePointsVenteDropdown(prixSpeciauxExistants = []) {
    const dropdown = document.getElementById('nouveauPointVente');
    if (!dropdown) return;
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Erreur lors du chargement des points de vente');
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.pointsVente) {
            console.error('Format de réponse invalide pour les points de vente');
            return;
        }
        
        // Vider le dropdown
        dropdown.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(data.pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom)
            .sort(); // Trier alphabétiquement
        
        // Ajouter les options pour les points de vente actifs non encore utilisés
        pointsVenteActifs.forEach(pointVente => {
            if (!prixSpeciauxExistants.includes(pointVente)) {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente === 'Sacre Coeur' ? 'Sacré Coeur' : pointVente;
                dropdown.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

function supprimerPrixSpecial(categorie, produit, pointVente) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le prix spécial pour "${pointVente}" ?`)) {
        if (confirm(`Cette suppression est définitive. Confirmer la suppression du prix spécial pour "${pointVente}" ?`)) {
            delete currentProduitsConfig[categorie][produit][pointVente];
            // Recharger seulement le tableau dans le modal
            refreshPrixSpeciauxTable(categorie, produit);
            // Recharger l'affichage principal
            afficherProduitsConfig();
        }
    }
}

async function supprimerProduit(categorie, produit) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le produit "${produit}" ?`)) {
        try {
            const response = await fetch('/api/admin/config/produits/by-name', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ nom: produit, type_catalogue: 'vente' })
            });
            
            const data = await response.json();
            
            if (data.success) {
                delete currentProduitsConfig[categorie][produit];
                afficherProduitsConfig();
                alert(`Produit "${produit}" supprimé avec succès`);
            } else {
                alert(`Erreur: ${data.error}`);
            }
        } catch (error) {
            console.error('Erreur suppression produit:', error);
            alert('Erreur lors de la suppression du produit');
        }
    }
}

function supprimerCategorie(categorie) {
    // Protection pour les catégories principales - ne pas permettre leur suppression
    const categoriesPrincipales = ['Bovin', 'Ovin', 'Volaille', 'Pack', 'Caprin', 'Autres'];
    
    if (categoriesPrincipales.includes(categorie)) {
        alert(`La catégorie "${categorie}" est une catégorie principale du système et ne peut pas être supprimée. Vous pouvez seulement supprimer des produits individuels.`);
        return;
    }
    
    const nombreProduits = Object.keys(currentProduitsConfig[categorie]).length;
    if (confirm(`Êtes-vous sûr de vouloir supprimer la catégorie "${categorie}" et ses ${nombreProduits} produits ?`)) {
        if (confirm(`Cette suppression est définitive et supprimera TOUS les produits de la catégorie "${categorie}". Confirmer la suppression définitive ?`)) {
            delete currentProduitsConfig[categorie];
            afficherProduitsConfig();
        }
    }
}

function ajouterProduitCategorie(categorie) {
    document.getElementById('productModalCategory').value = categorie;
    document.getElementById('addProductModalLabel').textContent = `Ajouter un produit à ${categorie}`;
}

// Fonctions pour l'inventaire
function ajouterProduitInventaireCategorie(categorie) {
    document.getElementById('inventaireProductModalCategory').value = categorie;
    document.getElementById('addInventaireProductModalLabel').textContent = `Ajouter un produit à ${categorie}`;
}

function supprimerCategorieInventaire(categorie) {
    // Protection pour les catégories d'inventaire logiques - ne pas permettre leur suppression
    const categoriesInventairePrincipales = ['Viandes', 'Œufs et Produits Laitiers', 'Abats et Sous-produits', 'Produits sur Pieds', 'Déchets', 'Autres'];
    
    if (categoriesInventairePrincipales.includes(categorie)) {
        alert(`La catégorie "${categorie}" est une catégorie logique du système d'inventaire et ne peut pas être supprimée. Vous pouvez seulement supprimer des produits individuels.`);
        return;
    }
    
    // Vérifier si c'est une catégorie personnalisée
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    
    if (categoriesPersonnalisees.includes(categorie)) {
        if (confirm(`Êtes-vous sûr de vouloir supprimer la catégorie personnalisée "${categorie}" et tous ses produits ?`)) {
            // Supprimer la catégorie de la config
            delete currentInventaireConfig[categorie];
            
            // Supprimer de la liste des catégories personnalisées
            const index = categoriesPersonnalisees.indexOf(categorie);
            if (index > -1) {
                categoriesPersonnalisees.splice(index, 1);
                localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(categoriesPersonnalisees));
            }
            
            afficherInventaireConfig();
            alert(`Catégorie "${categorie}" supprimée avec succès!`);
        }
        return;
    }
    
    // Pour l'inventaire, on ne peut pas vraiment supprimer les catégories car elles sont logiques
    // mais on peut supprimer tous les produits de la catégorie
    const inventaireParCategories = reorganiserInventaireParCategories();
    const produits = inventaireParCategories[categorie];
    const nombreProduits = Object.keys(produits).length;
    
    if (confirm(`Êtes-vous sûr de vouloir supprimer tous les ${nombreProduits} produits de la catégorie "${categorie}" ?`)) {
        if (confirm(`Cette suppression est définitive et supprimera TOUS les produits de la catégorie "${categorie}". Confirmer la suppression définitive ?`)) {
            Object.keys(produits).forEach(produit => {
                delete currentInventaireConfig[produit];
            });
            afficherInventaireConfig();
        }
    }
}

function modifierPrixSpeciauxInventaire(produit) {
    // Fermer tous les modals existants pour éviter les conflits
    const existingModals = document.querySelectorAll('.modal.show');
    existingModals.forEach(modal => {
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) {
            bsModal.hide();
        }
    });
    
    // Supprimer les modals de prix spéciaux existants
    const existingPrixModal = document.getElementById('prixSpeciauxInventaireModal');
    if (existingPrixModal) {
        existingPrixModal.remove();
    }
    
    // Récupérer la configuration actuelle du produit
    const config = currentInventaireConfig[produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['prixDefault', 'alternatives', 'mode_stock', 'unite_stock'].includes(key));
    
    // Créer le modal dynamiquement
    let modalHtml = `
        <div class="modal fade" id="prixSpeciauxInventaireModal" tabindex="-1" aria-labelledby="prixSpeciauxInventaireModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="prixSpeciauxInventaireModalLabel">Prix spéciaux pour "${produit}" (Inventaire)</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label">Point de vente</label>
                                <select class="form-select" id="nouveauPointVenteInventaire">
                                    <option value="">Sélectionner un point de vente</option>
                                    <!-- Les options seront chargées dynamiquement depuis points-vente.js -->
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label">Prix</label>
                                <input type="number" class="form-control" id="nouveauPrixSpecialInventaire" placeholder="0" min="0" step="0.01">
                            </div>
                            <div class="col-md-2">
                                <label class="form-label">&nbsp;</label>
                                <button type="button" class="btn btn-success w-100" onclick="ajouterPrixSpecialInventaire('${produit}')">
                                    <i class="fas fa-plus"></i> Ajouter
                                </button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Point de Vente</th>
                                        <th>Prix</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="prixSpeciauxInventaireTableBody">
                                    <!-- Le contenu sera généré par refreshPrixSpeciauxInventaireTable -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>`;
    
    // Ajouter le nouveau modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('prixSpeciauxInventaireModal'));
    modal.show();
    
    // Remplir le tableau avec les données actuelles
    refreshPrixSpeciauxInventaireTable(produit);
    
    // Charger les points de vente dans le dropdown initial
    updatePointsVenteDropdownInventaire([]);
    
    // Nettoyer le modal quand il se ferme
    document.getElementById('prixSpeciauxInventaireModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

function refreshPrixSpeciauxInventaireTable(produit) {
    const config = currentInventaireConfig[produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['prixDefault', 'alternatives', 'mode_stock', 'unite_stock'].includes(key));
    
    const tbody = document.getElementById('prixSpeciauxInventaireTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    prixSpeciaux.forEach(pointVente => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${pointVente}</td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${config[pointVente]}" 
                       onchange="modifierPrixSpecialExistantInventaire('${produit}', '${pointVente}', this.value)">
            </td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="supprimerPrixSpecialInventaire('${produit}', '${pointVente}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Mettre à jour les options du dropdown pour exclure les points de vente déjà utilisés
    updatePointsVenteDropdownInventaire(prixSpeciaux);
}

async function updatePointsVenteDropdownInventaire(prixSpeciauxExistants = []) {
    const dropdown = document.getElementById('nouveauPointVenteInventaire');
    if (!dropdown) return;
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Erreur lors du chargement des points de vente');
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.pointsVente) {
            console.error('Format de réponse invalide pour les points de vente');
            return;
        }
        
        // Vider le dropdown
        dropdown.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(data.pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom)
            .sort(); // Trier alphabétiquement
        
        // Ajouter les options pour les points de vente actifs non encore utilisés
        pointsVenteActifs.forEach(pointVente => {
            if (!prixSpeciauxExistants.includes(pointVente)) {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente === 'Sacre Coeur' ? 'Sacré Coeur' : pointVente;
                dropdown.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

function ajouterPrixSpecialInventaire(produit) {
    const pointVente = document.getElementById('nouveauPointVenteInventaire').value;
    const prix = parseFloat(document.getElementById('nouveauPrixSpecialInventaire').value);
    
    if (!pointVente) {
        alert('Veuillez sélectionner un point de vente');
        return;
    }
    
    if (!prix || prix <= 0) {
        alert('Veuillez saisir un prix valide');
        return;
    }
    
    // Vérifier si le prix spécial existe déjà
    if (currentInventaireConfig[produit][pointVente]) {
        alert(`Un prix spécial pour "${pointVente}" existe déjà. Utilisez l'édition pour le modifier.`);
        return;
    }
    
    // Ajouter le prix spécial
    currentInventaireConfig[produit][pointVente] = prix;
    
    // Recharger seulement le tableau dans le modal
    refreshPrixSpeciauxInventaireTable(produit);
    
    // Vider les champs
    document.getElementById('nouveauPointVenteInventaire').value = '';
    document.getElementById('nouveauPrixSpecialInventaire').value = '';
    
    // Recharger l'affichage principal
    afficherInventaireConfig();
}

function modifierPrixSpecialExistantInventaire(produit, pointVente, nouveauPrix) {
    const prix = parseFloat(nouveauPrix);
    if (prix && prix > 0) {
        currentInventaireConfig[produit][pointVente] = prix;
        afficherInventaireConfig();
    }
}

function supprimerPrixSpecialInventaire(produit, pointVente) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le prix spécial pour "${pointVente}" ?`)) {
        if (confirm(`Cette suppression est définitive. Confirmer la suppression du prix spécial pour "${pointVente}" ?`)) {
            delete currentInventaireConfig[produit][pointVente];
            // Recharger seulement le tableau dans le modal
            refreshPrixSpeciauxInventaireTable(produit);
            // Recharger l'affichage principal
            afficherInventaireConfig();
        }
    }
}

// Fonctions de modification pour les produits d'inventaire
function modifierNomProduitInventaire(ancienNom, nouveauNom, categorie = null) {
    if (nouveauNom && nouveauNom !== ancienNom) {
        if (categorie && currentInventaireConfig[categorie]) {
            // Produit dans une catégorie personnalisée
            const config = currentInventaireConfig[categorie][ancienNom];
            delete currentInventaireConfig[categorie][ancienNom];
            currentInventaireConfig[categorie][nouveauNom] = config;
        } else {
            // Produit au niveau racine
            const config = currentInventaireConfig[ancienNom];
            delete currentInventaireConfig[ancienNom];
            currentInventaireConfig[nouveauNom] = config;
        }
        afficherInventaireConfig();
    }
}

function modifierPrixInventaire(produit, champ, nouveauPrix, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        if (nouveauPrix) {
            config[champ] = parseFloat(nouveauPrix);
        } else {
            delete config[champ];
        }
    }
}

function modifierAlternativesInventaire(produit, alternativesStr, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        if (alternativesStr.trim()) {
            const alternatives = alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
            config.alternatives = alternatives;
        } else {
            config.alternatives = [];
        }
    }
}

function modifierModeStockInventaire(produit, modeStock, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        config.mode_stock = modeStock;
        // Si on passe en mode manuel, désactiver le sélecteur d'unité
        afficherInventaireConfig();
    }
}

function modifierUniteStockInventaire(produit, uniteStock, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        config.unite_stock = uniteStock;
    }
}

// Fonction helper pour trouver la config d'un produit (dans catégorie perso ou racine)
function trouverConfigProduitInventaire(produit, categorie = null) {
    // Si une catégorie est spécifiée
    if (categorie && currentInventaireConfig[categorie] && currentInventaireConfig[categorie][produit]) {
        return currentInventaireConfig[categorie][produit];
    }
    
    // Chercher au niveau racine
    if (currentInventaireConfig[produit] && currentInventaireConfig[produit].prixDefault !== undefined) {
        return currentInventaireConfig[produit];
    }
    
    // Chercher dans les catégories personnalisées
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    for (const cat of categoriesPersonnalisees) {
        if (currentInventaireConfig[cat] && currentInventaireConfig[cat][produit]) {
            return currentInventaireConfig[cat][produit];
        }
    }
    
    return null;
}

async function supprimerProduitInventaire(produit, categorie = null) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le produit d'inventaire "${produit}" ?`)) {
        try {
            const response = await fetch('/api/admin/config/produits/by-name', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ nom: produit, type_catalogue: 'inventaire' })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (categorie && currentInventaireConfig[categorie]) {
                    delete currentInventaireConfig[categorie][produit];
                } else {
                    delete currentInventaireConfig[produit];
                }
                afficherInventaireConfig();
                alert(`Produit d'inventaire "${produit}" supprimé avec succès`);
            } else {
                alert(`Erreur: ${data.error}`);
            }
        } catch (error) {
            console.error('Erreur suppression produit inventaire:', error);
            alert('Erreur lors de la suppression du produit');
        }
    }
}

// Fonctions de modification pour les produits d'abonnement
function modifierNomProduitAbonnement(categorie, ancienNom, nouveauNom) {
    if (nouveauNom && nouveauNom !== ancienNom) {
        const config = currentAbonnementConfig[categorie][ancienNom];
        delete currentAbonnementConfig[categorie][ancienNom];
        currentAbonnementConfig[categorie][nouveauNom] = config;
        afficherAbonnementConfig();
    }
}

function modifierPrixAbonnement(categorie, produit, champ, nouveauPrix) {
    currentAbonnementConfig[categorie][produit][champ] = parseFloat(nouveauPrix) || 0;
}

function modifierAlternativesAbonnement(categorie, produit, alternativesStr) {
    if (alternativesStr.trim()) {
        const alternatives = alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
        currentAbonnementConfig[categorie][produit].alternatives = alternatives;
    } else {
        currentAbonnementConfig[categorie][produit].alternatives = [];
    }
}

function modifierPrixSpeciauxAbonnement(categorie, produit) {
    // Fermer tous les modals existants pour éviter les conflits
    const existingModals = document.querySelectorAll('.modal.show');
    existingModals.forEach(modal => {
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) {
            bsModal.hide();
        }
    });
    
    // Supprimer les modals de prix spéciaux existants
    const existingPrixModal = document.getElementById('prixSpeciauxAbonnementModal');
    if (existingPrixModal) {
        existingPrixModal.remove();
    }
    
    // Récupérer la configuration actuelle du produit
    const config = currentAbonnementConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives'].includes(key));
    
    // Créer le modal dynamiquement
    let modalHtml = `
        <div class="modal fade" id="prixSpeciauxAbonnementModal" tabindex="-1" aria-labelledby="prixSpeciauxAbonnementModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="prixSpeciauxAbonnementModalLabel">Prix spéciaux pour "${produit}" (${categorie})</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label">Point de vente</label>
                                <select class="form-select" id="nouveauPointVenteAbonnement">
                                    <option value="">Sélectionner un point de vente</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label">Prix</label>
                                <input type="number" class="form-control" id="nouveauPrixSpecialAbonnement" placeholder="0" min="0" step="0.01">
                            </div>
                            <div class="col-md-2">
                                <label class="form-label">&nbsp;</label>
                                <button type="button" class="btn btn-success w-100" onclick="ajouterPrixSpecialAbonnement('${categorie}', '${produit}')">
                                    <i class="fas fa-plus"></i> Ajouter
                                </button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Point de Vente</th>
                                        <th>Prix</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="prixSpeciauxAbonnementTableBody">
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>`;
    
    // Ajouter le nouveau modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('prixSpeciauxAbonnementModal'));
    modal.show();
    
    // Rafraîchir le tableau
    refreshPrixSpeciauxAbonnementTable(categorie, produit);
}

function refreshPrixSpeciauxAbonnementTable(categorie, produit) {
    const tbody = document.getElementById('prixSpeciauxAbonnementTableBody');
    if (!tbody) return;
    
    // Vider le tableau
    tbody.innerHTML = '';
    
    // Récupérer la configuration actuelle
    const config = currentAbonnementConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives'].includes(key));
    
    // Si aucun prix spécial, afficher un message
    if (prixSpeciaux.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Aucun prix spécial défini</td></tr>';
        updatePointsVenteDropdownAbonnement([]);
        return;
    }
    
    // Ajouter chaque prix spécial au tableau
    prixSpeciaux.forEach(pointVente => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${pointVente}</td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${config[pointVente]}" 
                       onchange="modifierPrixSpecialExistantAbonnement('${categorie}', '${produit}', '${pointVente}', this.value)">
            </td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="supprimerPrixSpecialAbonnement('${categorie}', '${produit}', '${pointVente}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Mettre à jour les options du dropdown pour exclure les points de vente déjà utilisés
    updatePointsVenteDropdownAbonnement(prixSpeciaux);
}

async function updatePointsVenteDropdownAbonnement(prixSpeciauxExistants = []) {
    const dropdown = document.getElementById('nouveauPointVenteAbonnement');
    if (!dropdown) return;
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Erreur lors du chargement des points de vente');
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.pointsVente) {
            console.error('Format de réponse invalide pour les points de vente');
            return;
        }
        
        // Vider le dropdown
        dropdown.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(data.pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom)
            .sort(); // Trier alphabétiquement
        
        // Ajouter les options pour les points de vente actifs non encore utilisés
        pointsVenteActifs.forEach(pointVente => {
            if (!prixSpeciauxExistants.includes(pointVente)) {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente === 'Sacre Coeur' ? 'Sacré Coeur' : pointVente;
                dropdown.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

function ajouterPrixSpecialAbonnement(categorie, produit) {
    const pointVente = document.getElementById('nouveauPointVenteAbonnement').value;
    const prix = parseFloat(document.getElementById('nouveauPrixSpecialAbonnement').value);
    
    if (!pointVente) {
        alert('Veuillez sélectionner un point de vente');
        return;
    }
    
    if (!prix || prix <= 0) {
        alert('Veuillez saisir un prix valide');
        return;
    }
    
    // Vérifier si le prix spécial existe déjà
    if (currentAbonnementConfig[categorie][produit][pointVente]) {
        alert(`Un prix spécial pour "${pointVente}" existe déjà. Utilisez l'édition pour le modifier.`);
        return;
    }
    
    // Ajouter le prix spécial
    currentAbonnementConfig[categorie][produit][pointVente] = prix;
    
    // Recharger seulement le tableau dans le modal
    refreshPrixSpeciauxAbonnementTable(categorie, produit);
    
    // Vider les champs
    document.getElementById('nouveauPointVenteAbonnement').value = '';
    document.getElementById('nouveauPrixSpecialAbonnement').value = '';
    
    // Recharger l'affichage principal
    afficherAbonnementConfig();
}

function modifierPrixSpecialExistantAbonnement(categorie, produit, pointVente, nouveauPrix) {
    const prix = parseFloat(nouveauPrix);
    if (prix && prix > 0) {
        currentAbonnementConfig[categorie][produit][pointVente] = prix;
        afficherAbonnementConfig();
    }
}

function supprimerPrixSpecialAbonnement(categorie, produit, pointVente) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le prix spécial pour "${pointVente}" ?`)) {
        if (confirm(`Cette suppression est définitive. Confirmer la suppression du prix spécial pour "${pointVente}" ?`)) {
            delete currentAbonnementConfig[categorie][produit][pointVente];
            // Recharger seulement le tableau dans le modal
            refreshPrixSpeciauxAbonnementTable(categorie, produit);
            // Recharger l'affichage principal
            afficherAbonnementConfig();
        }
    }
}

async function supprimerProduitAbonnement(categorie, produit) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le produit d'abonnement "${produit}" ?`)) {
        try {
            const response = await fetch('/api/admin/config/produits/by-name', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ nom: produit, type_catalogue: 'abonnement' })
            });
            
            const data = await response.json();
            
            if (data.success) {
                delete currentAbonnementConfig[categorie][produit];
                afficherAbonnementConfig();
                alert(`Produit d'abonnement "${produit}" supprimé avec succès`);
            } else {
                alert(`Erreur: ${data.error}`);
            }
        } catch (error) {
            console.error('Erreur suppression produit abonnement:', error);
            alert('Erreur lors de la suppression du produit');
        }
    }
}

function ajouterProduitAbonnementCategorie(categorie) {
    // À implémenter si besoin d'ajouter de nouveaux produits via un modal
    alert('Fonctionnalité à implémenter: ajouter un produit à ' + categorie);
}

// Sauvegarder la configuration des produits
async function sauvegarderConfigProduits() {
    try {
        const response = await fetch('/api/admin/config/produits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ produits: currentProduitsConfig })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Configuration des produits sauvegardée avec succès !');
            
            // Recharger automatiquement la configuration serveur
            try {
                const reloadResponse = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const reloadData = await reloadResponse.json();
                if (reloadData.success) {
                    console.log('Configuration serveur rechargée automatiquement');
                } else {
                    console.warn('Erreur lors du rechargement automatique:', reloadData.message);
                }
            } catch (reloadError) {
                console.warn('Erreur lors du rechargement automatique:', reloadError);
            }
        } else {
            alert(`Erreur lors de la sauvegarde: ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        alert('Erreur lors de la sauvegarde de la configuration des produits');
    }
}

// Sauvegarder la configuration de l'inventaire
async function sauvegarderConfigInventaire() {
    try {
        const response = await fetch('/api/admin/config/produits-inventaire', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ produitsInventaire: currentInventaireConfig })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Configuration des produits d\'inventaire sauvegardée avec succès !');
            
            // Recharger automatiquement la configuration serveur
            try {
                const reloadResponse = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const reloadData = await reloadResponse.json();
                if (reloadData.success) {
                    console.log('Configuration serveur rechargée automatiquement');
                } else {
                    console.warn('Erreur lors du rechargement automatique:', reloadData.message);
                }
            } catch (reloadError) {
                console.warn('Erreur lors du rechargement automatique:', reloadError);
            }
        } else {
            alert(`Erreur lors de la sauvegarde: ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        alert('Erreur lors de la sauvegarde de la configuration des produits d\'inventaire');
    }
}

// Sauvegarder la configuration des produits d'abonnement
async function sauvegarderConfigAbonnement() {
    try {
        const response = await fetch('/api/admin/config/produits-abonnement', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ produitsAbonnement: currentAbonnementConfig })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Configuration des produits d\'abonnement sauvegardée avec succès !');
            
            // Recharger automatiquement la configuration serveur
            try {
                const reloadResponse = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const reloadData = await reloadResponse.json();
                if (reloadData.success) {
                    console.log('Configuration serveur rechargée automatiquement');
                } else {
                    console.warn('Erreur lors du rechargement automatique:', reloadData.message);
                }
            } catch (reloadError) {
                console.warn('Erreur lors du rechargement automatique:', reloadError);
            }
        } else {
            alert(`Erreur lors de la sauvegarde: ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        alert('Erreur lors de la sauvegarde de la configuration des produits d\'abonnement');
    }
}

    // Initialiser les event listeners pour les points de vente
    function initPointsVenteEventListeners() {
        // Formulaire d'ajout de point de vente
        const addPointVenteForm = document.getElementById('addPointVenteForm');
        if (addPointVenteForm) {
            addPointVenteForm.addEventListener('submit', function(e) {
                e.preventDefault();
                ajouterPointVente();
            });
        }
    }

    // Initialiser les event listeners pour la configuration des produits
    function initConfigProduitsEventListeners() {
    // Boutons de sauvegarde
    const saveProduits = document.getElementById('save-produits-btn');
    if (saveProduits) {
        saveProduits.addEventListener('click', sauvegarderConfigProduits);
    }
    
    const saveInventaire = document.getElementById('save-inventaire-btn');
    if (saveInventaire) {
        saveInventaire.addEventListener('click', sauvegarderConfigInventaire);
    }
    
    // Boutons de rechargement
    const reloadProduits = document.getElementById('reload-produits-btn');
    if (reloadProduits) {
        reloadProduits.addEventListener('click', chargerConfigProduits);
    }
    
    const reloadInventaire = document.getElementById('reload-inventaire-btn');
    if (reloadInventaire) {
        reloadInventaire.addEventListener('click', chargerConfigInventaire);
    }
    
    const saveAbonnement = document.getElementById('save-abonnement-btn');
    if (saveAbonnement) {
        saveAbonnement.addEventListener('click', sauvegarderConfigAbonnement);
    }
    
    const reloadAbonnement = document.getElementById('reload-abonnement-btn');
    if (reloadAbonnement) {
        reloadAbonnement.addEventListener('click', chargerConfigAbonnement);
    }
    
        // Bouton de rechargement de la configuration serveur
    const reloadServerConfigBtn = document.getElementById('reload-server-config-btn');
    if (reloadServerConfigBtn) {
        reloadServerConfigBtn.addEventListener('click', async function() {
            try {
                const response = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await response.json();
                
                if (data.success) {
                    alert('Configuration serveur rechargée avec succès!');
                    // Recharger aussi l'interface admin
                    chargerConfigProduits();
                    chargerConfigInventaire();
                    chargerConfigAbonnement();
                } else {
                    alert('Erreur lors du rechargement: ' + data.message);
                }
            } catch (error) {
                console.error('Erreur lors du rechargement:', error);
                alert('Erreur lors du rechargement de la configuration serveur');
            }
        });
    }
    
    // Modal pour ajouter une catégorie
    const saveCategoryBtn = document.getElementById('saveCategoryBtn');
    if (saveCategoryBtn) {
        saveCategoryBtn.addEventListener('click', function() {
            const categoryName = document.getElementById('newCategoryName').value.trim();
            if (categoryName) {
                if (!currentProduitsConfig[categoryName]) {
                    currentProduitsConfig[categoryName] = {};
                    afficherProduitsConfig();
                    document.getElementById('newCategoryName').value = '';
                    bootstrap.Modal.getInstance(document.getElementById('addCategoryModal')).hide();
                } else {
                    alert('Cette catégorie existe déjà');
                }
            }
        });
    }
    
    // Modal pour ajouter un produit général
    const saveProductBtn = document.getElementById('saveProductBtn');
    if (saveProductBtn) {
        saveProductBtn.addEventListener('click', function() {
            const category = document.getElementById('productModalCategory').value;
            const productName = document.getElementById('newProductName').value.trim();
            const defaultPrice = parseFloat(document.getElementById('newProductDefault').value) || 0;
            const alternativesStr = document.getElementById('newProductAlternatives').value.trim();
            
            if (productName && category) {
                if (!currentProduitsConfig[category][productName]) {
                    const productConfig = {
                        default: defaultPrice,
                        alternatives: alternativesStr ? 
                            alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p)) : 
                            [defaultPrice]
                    };
                    
                    // Les prix spécifiques par point de vente sont gérés via la BDD
                    
                    currentProduitsConfig[category][productName] = productConfig;
                    afficherProduitsConfig();
                    
                    // Réinitialiser le formulaire
                    document.getElementById('newProductName').value = '';
                    document.getElementById('newProductDefault').value = '';
                    document.getElementById('newProductAlternatives').value = '';
                    
                    bootstrap.Modal.getInstance(document.getElementById('addProductModal')).hide();
                } else {
                    alert('Ce produit existe déjà dans cette catégorie');
                }
            }
        });
    }
    
    // Modal pour ajouter une catégorie d'inventaire
    const saveInventaireCategoryBtn = document.getElementById('saveInventaireCategoryBtn');
    if (saveInventaireCategoryBtn) {
        saveInventaireCategoryBtn.addEventListener('click', function() {
            const categoryName = document.getElementById('newInventaireCategoryName').value.trim();
            if (categoryName) {
                // Vérifier si la catégorie existe déjà (dans les logiques ou personnalisées)
                const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
                const categoriesLogiques = ["Viandes", "Œufs et Produits Laitiers", "Abats et Sous-produits", "Produits sur Pieds", "Déchets", "Autres"];
                
                if (categoriesLogiques.includes(categoryName) || categoriesPersonnalisees.includes(categoryName)) {
                    alert('Cette catégorie existe déjà');
                    return;
                }
                
                // Ajouter la catégorie aux catégories personnalisées
                categoriesPersonnalisees.push(categoryName);
                localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(categoriesPersonnalisees));
                
                // Créer la catégorie dans la config
                currentInventaireConfig[categoryName] = {};
                
                afficherInventaireConfig();
                document.getElementById('newInventaireCategoryName').value = '';
                
                // Fermer le modal
                const modal = document.getElementById('addInventaireCategoryModal');
                if (modal) {
                    const bsModal = bootstrap.Modal.getInstance(modal);
                    if (bsModal) bsModal.hide();
                }
                
                alert('Catégorie "' + categoryName + '" créée avec succès! Vous pouvez maintenant y ajouter des produits.');
            } else {
                alert('Veuillez entrer un nom de catégorie');
            }
        });
    }
    
    // Modal pour ajouter un produit d'inventaire
    const saveInventaireProductBtn = document.getElementById('saveInventaireProductBtn');
    if (saveInventaireProductBtn) {
        saveInventaireProductBtn.addEventListener('click', function() {
            const category = document.getElementById('inventaireProductModalCategory').value;
            const productName = document.getElementById('newInventaireProductName').value.trim();
            const defaultPrice = parseFloat(document.getElementById('newInventairePrixDefault').value) || 0;
            const alternativesStr = document.getElementById('newInventaireAlternatives').value.trim();
            
            if (productName) {
                // Vérifier si c'est une catégorie personnalisée
                const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
                const isCustomCategory = categoriesPersonnalisees.includes(category);
                
                const productConfig = {
                    prixDefault: defaultPrice,
                    alternatives: alternativesStr ? 
                        alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p)) : 
                        [defaultPrice],
                    mode_stock: 'manuel',
                    unite_stock: 'unite'
                };
                
                if (isCustomCategory) {
                    // Pour les catégories personnalisées, stocker dans la sous-structure
                    if (!currentInventaireConfig[category]) {
                        currentInventaireConfig[category] = {};
                    }
                    if (currentInventaireConfig[category][productName]) {
                        alert('Ce produit existe déjà dans cette catégorie');
                        return;
                    }
                    currentInventaireConfig[category][productName] = productConfig;
                } else {
                    // Pour les catégories logiques, stocker au niveau racine
                    if (currentInventaireConfig[productName]) {
                        alert('Ce produit existe déjà');
                        return;
                    }
                    currentInventaireConfig[productName] = productConfig;
                }
                
                afficherInventaireConfig();
                
                // Réinitialiser le formulaire
                document.getElementById('newInventaireProductName').value = '';
                document.getElementById('newInventairePrixDefault').value = '';
                document.getElementById('newInventaireAlternatives').value = '';
                
                bootstrap.Modal.getInstance(document.getElementById('addInventaireProductModal')).hide();
            }
        });
    }
}

// Initialisation
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initialisation de la page...'); // Log de débogage
    
    // Initialiser les composants de base
    initLogoutButton();
    initDatePickers();
    initNavigation();
    
    checkAuth().then(isAuthenticated => {
        if (isAuthenticated) {
            console.log('Authentification vérifiée, chargement des données...'); // Log de débogage
            
            // Charger les données
            chargerPointsVente();
            chargerProduits();
            
            // Initialiser les event listeners
            initPointsVenteEventListeners();
            initPrixEventListeners();
            initCorrectionsEventListeners();
            initConfigProduitsEventListeners();
            
            // Charger la configuration des produits
            chargerConfigProduits();
            chargerConfigInventaire();
            chargerConfigAbonnement();
            
            // Initialiser la section stocks si elle existe
            const stocksSection = document.getElementById('stocks-section');
            if (stocksSection) {
                initStocksSection();
            }
            
            // Initialiser la section modules
            initModulesSection();
        }
    });
});

// =================== GESTION DES MODULES ===================

/**
 * Initialiser la section de gestion des modules
 */
function initModulesSection() {
    console.log('Initialisation de la section modules...');
    
    // Charger les modules
    chargerModules();
    
    // Event listener pour le bouton d'actualisation
    const refreshBtn = document.getElementById('refresh-modules-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', chargerModules);
    }
}

/**
 * Charger la liste des modules depuis l'API
 */
async function chargerModules() {
    const tbody = document.getElementById('modules-table-body');
    if (!tbody) return;
    
    try {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr>';
        
        const response = await fetch('/api/modules', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Erreur lors du chargement');
        }
        
        afficherModules(data.modules);
        
    } catch (error) {
        console.error('Erreur lors du chargement des modules:', error);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">
            <i class="fas fa-exclamation-triangle"></i> Erreur: ${error.message}
        </td></tr>`;
    }
}

/**
 * Afficher les modules dans le tableau
 */
function afficherModules(modules) {
    const tbody = document.getElementById('modules-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    // Trier les modules par nom
    const sortedModules = Object.values(modules).sort((a, b) => a.name.localeCompare(b.name));
    
    for (const module of sortedModules) {
        const row = document.createElement('tr');
        row.setAttribute('data-module-id', module.id);
        
        // Icône de statut
        const statusIcon = module.active 
            ? '<i class="fas fa-check-circle text-success fs-4"></i>'
            : '<i class="fas fa-times-circle text-danger fs-4"></i>';
        
        // Badge pour module essentiel
        const coreBadge = module.isCore 
            ? '<span class="badge bg-secondary ms-2">Essentiel</span>'
            : '';
        
        // Bouton d'action
        const actionBtn = module.isCore
            ? '<button class="btn btn-sm btn-secondary" disabled title="Module essentiel"><i class="fas fa-lock"></i></button>'
            : module.active
                ? `<button class="btn btn-sm btn-warning" onclick="toggleModule('${module.id}')" title="Désactiver"><i class="fas fa-toggle-on"></i> Désactiver</button>`
                : `<button class="btn btn-sm btn-success" onclick="toggleModule('${module.id}')" title="Activer"><i class="fas fa-toggle-off"></i> Activer</button>`;
        
        row.innerHTML = `
            <td class="text-center">${statusIcon}</td>
            <td>
                <strong>${module.name}</strong>${coreBadge}
                <br><small class="text-muted">ID: ${module.id}</small>
            </td>
            <td>${module.description || '-'}</td>
            <td>${actionBtn}</td>
        `;
        
        tbody.appendChild(row);
    }
}

/**
 * Activer/Désactiver un module
 */
async function toggleModule(moduleId) {
    try {
        const response = await fetch(`/api/modules/${moduleId}/toggle`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Afficher une notification
            const message = data.active 
                ? `Module "${data.moduleId}" activé avec succès`
                : `Module "${data.moduleId}" désactivé avec succès`;
            
            afficherNotification(message, data.active ? 'success' : 'warning');
            
            // Recharger la liste des modules
            chargerModules();
        } else {
            throw new Error(data.message || 'Erreur lors de la mise à jour');
        }
        
    } catch (error) {
        console.error('Erreur lors du toggle du module:', error);
        afficherNotification(`Erreur: ${error.message}`, 'danger');
    }
}

/**
 * Afficher une notification temporaire
 */
function afficherNotification(message, type = 'info') {
    // Vérifier si un conteneur de notification existe, sinon le créer
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = 'position: fixed; top: 80px; right: 20px; z-index: 9999; max-width: 350px;';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    container.appendChild(notification);
    
    // Supprimer automatiquement après 5 secondes
    setTimeout(() => {
        notification.remove();
    }, 5000);
} 