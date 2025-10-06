/**
 * Script pour gérer les clients abonnés dans la saisie des ventes
 */

let clientsAbonnesActifs = [];
let clientAbonneSelectionne = null;

/**
 * Charger les clients abonnés actifs filtrés par point de vente
 */
async function chargerClientsAbonnes(pointVente) {
    if (!pointVente) {
        // Vider le select si aucun point de vente
        const select = document.getElementById('client-abonne');
        if (select) {
            select.innerHTML = '<option value="">-- Aucun --</option>';
        }
        return;
    }

    try {
        console.log('📋 Chargement des clients abonnés pour:', pointVente);

        const response = await fetch('/api/abonnements/clients', {
            method: 'GET',
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success && result.data) {
            // Filtrer les clients actifs et du point de vente sélectionné
            clientsAbonnesActifs = result.data.filter(client => 
                client.statut === 'actif' && 
                client.point_vente_defaut === pointVente
            );

            console.log(`✅ ${clientsAbonnesActifs.length} client(s) abonné(s) trouvé(s) pour ${pointVente}`);

            // Peupler le select
            peuplerSelectClientsAbonnes();
        }
    } catch (error) {
        console.error('❌ Erreur lors du chargement des clients abonnés:', error);
    }
}

/**
 * Peupler le select des clients abonnés
 */
function peuplerSelectClientsAbonnes() {
    const select = document.getElementById('client-abonne');
    if (!select) return;

    // Vider le select
    select.innerHTML = '<option value="">-- Aucun --</option>';

    // Ajouter les clients abonnés
    clientsAbonnesActifs.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = `${client.prenom} ${client.nom} - ${client.telephone}`;
        option.dataset.client = JSON.stringify(client);
        select.appendChild(option);
    });

    console.log('✅ Select clients abonnés mis à jour');
}

/**
 * Gérer le changement de sélection du client abonné
 */
function gererSelectionClientAbonne() {
    const select = document.getElementById('client-abonne');
    if (!select) return;

    const selectedOption = select.options[select.selectedIndex];

    if (!selectedOption.value) {
        // Aucun client sélectionné
        clientAbonneSelectionne = null;
        viderInformationsClient();
        cacherBannerAbonne();
        
        // Remettre les prix normaux
        console.log('🔄 Remise des prix normaux (client abonné désélectionné)');
        appliquerPrixAbonnesAuxProduits();
        
        return;
    }

    try {
        // Récupérer les données du client
        const clientData = JSON.parse(selectedOption.dataset.client);
        clientAbonneSelectionne = clientData;

        console.log('✅ Client abonné sélectionné:', clientData);

        // Pré-remplir les informations client
        remplirInformationsClient(clientData);

        // Afficher la bannière d'info
        afficherBannerAbonne(clientData);

        // Supprimer les lignes de produits par défaut (créées avant la sélection du client)
        // pour forcer l'utilisateur à utiliser "Ajouter un produit" qui créera des lignes avec les bons listeners
        const produitsEntries = document.querySelectorAll('.produit-entry');
        let lignesSupprimees = 0;
        
        produitsEntries.forEach(entry => {
            const produitSelect = entry.querySelector('.produit-select');
            // Ne supprimer que les lignes vides ou avec des valeurs par défaut
            if (produitSelect && (!produitSelect.value || produitSelect.value === '')) {
                entry.remove();
                lignesSupprimees++;
            }
        });
        
        if (lignesSupprimees > 0) {
            console.log(`🗑️ ${lignesSupprimees} ligne(s) vide(s) supprimée(s). Utilisez "Ajouter un produit" pour bénéficier des prix abonnés.`);
        }

        // Appliquer les prix abonnés aux produits déjà saisis (s'il en reste)
        appliquerPrixAbonnesAuxProduits();

    } catch (error) {
        console.error('❌ Erreur lors de la sélection du client abonné:', error);
    }
}

/**
 * Pré-remplir les informations client
 */
function remplirInformationsClient(client) {
    // Nom du client
    const nomInput = document.getElementById('client-nom');
    if (nomInput) {
        nomInput.value = `${client.prenom} ${client.nom}`;
        nomInput.style.backgroundColor = '#e9ecef';
        nomInput.style.pointerEvents = 'none';
    }

    // Numéro client (téléphone)
    const numeroInput = document.getElementById('client-numero');
    if (numeroInput) {
        numeroInput.value = client.telephone;
        numeroInput.style.backgroundColor = '#e9ecef';
        numeroInput.style.pointerEvents = 'none';
    }

    // Adresse client
    const adresseInput = document.getElementById('client-adresse');
    if (adresseInput) {
        adresseInput.value = client.adresse || '';
        adresseInput.style.backgroundColor = '#e9ecef';
        adresseInput.style.pointerEvents = 'none';
    }
}

/**
 * Vider les informations client
 */
function viderInformationsClient() {
    const nomInput = document.getElementById('client-nom');
    if (nomInput) {
        nomInput.value = '';
        nomInput.style.backgroundColor = '';
        nomInput.style.pointerEvents = '';
    }

    const numeroInput = document.getElementById('client-numero');
    if (numeroInput) {
        numeroInput.value = '';
        numeroInput.style.backgroundColor = '';
        numeroInput.style.pointerEvents = '';
    }

    const adresseInput = document.getElementById('client-adresse');
    if (adresseInput) {
        adresseInput.value = '';
        adresseInput.style.backgroundColor = '';
        adresseInput.style.pointerEvents = '';
    }
    
    // Réinitialiser le style des champs de prix
    const produitsEntries = document.querySelectorAll('.produit-entry');
    produitsEntries.forEach(entry => {
        const prixInput = entry.querySelector('.prix-unit');
        if (prixInput) {
            prixInput.style.backgroundColor = ''; // Retirer le fond vert
        }
    });
}

/**
 * Afficher la bannière d'information abonné
 */
function afficherBannerAbonne(client) {
    const banner = document.getElementById('abonne-info-display');
    const nomSpan = document.getElementById('abonne-nom');

    if (banner && nomSpan) {
        nomSpan.textContent = `${client.prenom} ${client.nom}`;
        banner.style.display = 'block';
    }
}

/**
 * Cacher la bannière d'information abonné
 */
function cacherBannerAbonne() {
    const banner = document.getElementById('abonne-info-display');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Appliquer les prix abonnés aux produits déjà saisis
 */
function appliquerPrixAbonnesAuxProduits() {
    console.log('🔄 Application des prix abonnés aux produits existants...');
    const produitsEntries = document.querySelectorAll('.produit-entry');
    console.log(`   Nombre d'entrées produits trouvées: ${produitsEntries.length}`);

    produitsEntries.forEach((entry, index) => {
        const categorieSelect = entry.querySelector('.categorie-select');
        const produitSelect = entry.querySelector('.produit-select');
        const prixInput = entry.querySelector('.prix-unit');

        console.log(`   Entrée ${index + 1}:`, {
            categorieValue: categorieSelect?.value,
            produitValue: produitSelect?.value,
            prixActuel: prixInput?.value
        });

        // Si un produit est déjà sélectionné, déclencher l'événement 'change' pour recalculer le prix
        if (categorieSelect && produitSelect && produitSelect.value) {
            console.log(`   🔄 Déclenchement du recalcul pour: ${produitSelect.value}`);
            produitSelect.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (categorieSelect && produitSelect && prixInput && produitSelect.value) {
            // Fallback: mise à jour directe si l'événement ne marche pas
            const categorie = categorieSelect.value;
            const produit = produitSelect.value;
            const pointVente = document.getElementById('point-vente')?.value;
            
            // Obtenir le prix abonné
            if (window.produitsAbonnement) {
                const prixAbonne = window.produitsAbonnement.getPrixDefaut(categorie, produit, pointVente);
                console.log(`   Prix abonné pour ${produit}: ${prixAbonne}`);
                
                if (prixAbonne > 0) {
                    prixInput.value = prixAbonne;
                    prixInput.style.backgroundColor = '#d4edda'; // Vert clair
                    console.log(`   ✅ Prix mis à jour: ${prixAbonne}`);
                    
                    // Recalculer le total
                    const quantiteInput = entry.querySelector('.quantite');
                    if (quantiteInput && quantiteInput.value) {
                        const total = prixAbonne * parseFloat(quantiteInput.value);
                        const totalInput = entry.querySelector('.total');
                        if (totalInput) {
                            totalInput.value = total.toFixed(2);
                        }
                    }
                }
            } else {
                console.warn('   ⚠️ produitsAbonnement non disponible');
            }
        }
    });
    
    console.log('✅ Application des prix abonnés terminée');
}

/**
 * Obtenir le prix pour un produit (abonné si client sélectionné, sinon normal)
 * @param {string} categorie - La catégorie du produit (Bovin, Ovin, Volaille, etc.)
 * @param {string} produit - Le nom du produit
 * @param {string} pointVente - Le point de vente (optionnel)
 * @returns {number|null} Le prix du produit
 */
function obtenirPrixProduit(categorie, produit, pointVente = null) {
    console.log('🔍 obtenirPrixProduit appelé:', { 
        categorie, 
        produit, 
        pointVente, 
        clientAbonneSelectionne: clientAbonneSelectionne ? 'OUI' : 'NON',
        produitsAbonnementDisponible: window.produitsAbonnement ? 'OUI' : 'NON'
    });
    
    // Si un client abonné est sélectionné, utiliser produitsAbonnement
    if (clientAbonneSelectionne && window.produitsAbonnement) {
        const prix = window.produitsAbonnement.getPrixDefaut(categorie, produit, pointVente);
        console.log(`✅ Prix abonné récupéré: ${prix}`);
        return prix;
    }

    // Sinon utiliser les prix normaux
    if (window.produits) {
        const prix = window.produits.getPrixDefaut(categorie, produit, pointVente);
        console.log(`📦 Prix normal récupéré: ${prix}`);
        return prix;
    }

    console.warn('❌ Aucun prix trouvé');
    return null;
}

// Exporter pour utilisation dans script.js
if (typeof window !== 'undefined') {
    window.venteAbonnementModule = {
        chargerClientsAbonnes,
        gererSelectionClientAbonne,
        obtenirPrixProduit,
        getClientAbonneSelectionne: () => clientAbonneSelectionne
    };
}
