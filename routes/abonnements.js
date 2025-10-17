const express = require('express');
const router = express.Router();
const { ClientAbonne, PaiementAbonnement } = require('../db/models');
const { Op } = require('sequelize');

// Mapping des points de vente vers les références de paiement Bictorys pour abonnements
// Format: A_[CODE] (A pour Abonnement)
const ABONNEMENT_REF_MAPPING = {
    'Mbao': 'A_MBA',
    'O.Foire': 'A_OSF',
    'Keur Massar': 'A_KM',
    'Linguere': 'A_LGR',
    'Sacre Coeur': 'A_SAC',
    'Dahra': 'A_DHR',
    'Abattage': 'A_ABATS'
};

// =================== ROUTES CLIENTS ABONNÉS ===================

/**
 * GET /api/abonnements/clients
 * Récupérer la liste de tous les clients abonnés avec leur dernier paiement
 */
router.get('/clients', async (req, res) => {
    try {
        const { statut, pointVente, search } = req.query;
        
        let whereClause = {};
        
        // Filtrer par statut
        if (statut) {
            whereClause.statut = statut;
        }
        
        // Filtrer par point de vente
        if (pointVente) {
            whereClause.point_vente_defaut = pointVente;
        }
        
        // Recherche par nom, prénom ou téléphone
        if (search) {
            whereClause[Op.or] = [
                { prenom: { [Op.iLike]: `%${search}%` } },
                { nom: { [Op.iLike]: `%${search}%` } },
                { telephone: { [Op.like]: `%${search}%` } }
            ];
        }
        
        const clients = await ClientAbonne.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']]
        });
        
        // Pour chaque client, récupérer le dernier paiement et vérifier le statut
        const moisActuel = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        
        const clientsWithPayments = await Promise.all(clients.map(async (client) => {
            // Récupérer le dernier paiement
            const dernierPaiement = await PaiementAbonnement.findOne({
                where: { client_id: client.id },
                order: [['date_paiement', 'DESC']]
            });
            
            // Vérifier si le paiement du mois actuel est fait
            const paiementMoisActuel = await PaiementAbonnement.findOne({
                where: { 
                    client_id: client.id,
                    mois: moisActuel
                }
            });
            
            return {
                ...client.toJSON(),
                dernierPaiement: dernierPaiement ? {
                    mois: dernierPaiement.mois,
                    montant: dernierPaiement.montant,
                    date_paiement: dernierPaiement.date_paiement
                } : null,
                paiementAJour: !!paiementMoisActuel
            };
        }));
        
        res.json({
            success: true,
            data: clientsWithPayments
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des clients abonnés:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des clients'
        });
    }
});

/**
 * GET /api/abonnements/clients/actifs
 * Récupérer uniquement les clients actifs (pour le dropdown de saisie de vente)
 */
router.get('/clients/actifs', async (req, res) => {
    try {
        const clients = await ClientAbonne.findAll({
            where: { statut: 'actif' },
            attributes: ['id', 'abonne_id', 'prenom', 'nom', 'telephone', 'point_vente_defaut'],
            order: [['nom', 'ASC'], ['prenom', 'ASC']]
        });
        
        res.json({
            success: true,
            data: clients
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des clients actifs:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * GET /api/abonnements/clients/:id
 * Récupérer un client spécifique
 */
router.get('/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const client = await ClientAbonne.findByPk(id);
        
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client non trouvé'
            });
        }
        
        // Récupérer l'historique des paiements
        const paiements = await PaiementAbonnement.findAll({
            where: { client_id: id },
            order: [['mois', 'DESC']]
        });
        
        res.json({
            success: true,
            data: {
                client,
                paiements
            }
        });
    } catch (error) {
        console.error('Erreur lors de la récupération du client:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * POST /api/abonnements/clients
 * Créer un nouveau client abonné
 */
router.post('/clients', async (req, res) => {
    try {
        const {
            prenom,
            nom,
            telephone,
            adresse,
            position_gps,
            lien_google_maps,
            point_vente_defaut,
            date_inscription
        } = req.body;
        
        // Validation
        if (!prenom || !nom || !telephone || !point_vente_defaut) {
            return res.status(400).json({
                success: false,
                message: 'Prénom, nom, téléphone et point de vente sont obligatoires'
            });
        }
        
        // Vérifier si le téléphone existe déjà
        const existingClient = await ClientAbonne.findOne({
            where: { telephone }
        });
        
        if (existingClient) {
            return res.status(400).json({
                success: false,
                message: 'Un client avec ce numéro de téléphone existe déjà'
            });
        }
        
        // Générer l'ID abonné manuellement
        const dateInscription = date_inscription || new Date();
        const abonneId = await ClientAbonne.generateAbonneId(point_vente_defaut, dateInscription);
        
        console.log('✅ ID abonné généré:', abonneId);
        
        // Créer le client avec l'ID généré
        const client = await ClientAbonne.create({
            abonne_id: abonneId,
            prenom,
            nom,
            telephone,
            adresse: adresse || null,
            position_gps: position_gps || null,
            lien_google_maps: lien_google_maps || null,
            point_vente_defaut,
            date_inscription: dateInscription,
            statut: 'actif'
        });
        
        res.status(201).json({
            success: true,
            data: client,
            message: `Client créé avec succès. ID abonné: ${client.abonne_id}`
        });
    } catch (error) {
        console.error('Erreur lors de la création du client:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la création du client'
        });
    }
});

/**
 * PUT /api/abonnements/clients/:id
 * Modifier un client abonné
 */
router.put('/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            prenom,
            nom,
            telephone,
            adresse,
            position_gps,
            lien_google_maps,
            point_vente_defaut,
            statut
        } = req.body;
        
        const client = await ClientAbonne.findByPk(id);
        
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client non trouvé'
            });
        }
        
        // Si le téléphone est modifié, vérifier qu'il n'existe pas déjà
        if (telephone && telephone !== client.telephone) {
            const existingClient = await ClientAbonne.findOne({
                where: {
                    telephone,
                    id: { [Op.ne]: id }
                }
            });
            
            if (existingClient) {
                return res.status(400).json({
                    success: false,
                    message: 'Un autre client avec ce numéro de téléphone existe déjà'
                });
            }
        }
        
        // Mettre à jour
        await client.update({
            prenom: prenom || client.prenom,
            nom: nom || client.nom,
            telephone: telephone || client.telephone,
            adresse: adresse !== undefined ? adresse : client.adresse,
            position_gps: position_gps !== undefined ? position_gps : client.position_gps,
            lien_google_maps: lien_google_maps !== undefined ? lien_google_maps : client.lien_google_maps,
            point_vente_defaut: point_vente_defaut || client.point_vente_defaut,
            statut: statut || client.statut
        });
        
        res.json({
            success: true,
            data: client,
            message: 'Client mis à jour avec succès'
        });
    } catch (error) {
        console.error('Erreur lors de la mise à jour du client:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * DELETE /api/abonnements/clients/:id
 * Supprimer un client abonné
 */
router.delete('/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const client = await ClientAbonne.findByPk(id);
        
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client non trouvé'
            });
        }
        
        await client.destroy();
        
        res.json({
            success: true,
            message: 'Client supprimé avec succès'
        });
    } catch (error) {
        console.error('Erreur lors de la suppression du client:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * GET /api/abonnements/clients/:id/statut
 * Vérifier si un client est actif et à jour de ses paiements
 */
router.get('/clients/:id/statut', async (req, res) => {
    try {
        const { id } = req.params;
        const { mois } = req.query;
        
        const client = await ClientAbonne.findByPk(id);
        
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client non trouvé'
            });
        }
        
        const isActive = client.statut === 'actif';
        const hasPaid = await PaiementAbonnement.hasClientPaidForMonth(id, mois);
        
        res.json({
            success: true,
            data: {
                isActive,
                hasPaid,
                canBenefit: isActive && hasPaid,
                client: {
                    id: client.id,
                    abonne_id: client.abonne_id,
                    nom: `${client.prenom} ${client.nom}`,
                    telephone: client.telephone
                }
            }
        });
    } catch (error) {
        console.error('Erreur lors de la vérification du statut:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

// =================== ROUTES PAIEMENTS ABONNEMENT ===================

/**
 * GET /api/abonnements/paiements
 * Récupérer tous les paiements ou filtrer par mois/client
 */
router.get('/paiements', async (req, res) => {
    try {
        const { mois, clientId } = req.query;
        
        let whereClause = {};
        
        if (mois) {
            whereClause.mois = mois;
        }
        
        if (clientId) {
            whereClause.client_id = clientId;
        }
        
        const paiements = await PaiementAbonnement.findAll({
            where: whereClause,
            order: [['date_paiement', 'DESC']]
        });
        
        res.json({
            success: true,
            data: paiements
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des paiements:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * POST /api/abonnements/paiements
 * Enregistrer un paiement d'abonnement
 */
router.post('/paiements', async (req, res) => {
    try {
        const {
            client_id,
            mois,
            montant,
            date_paiement,
            mode_paiement,
            payment_link_id,
            reference,
            notes
        } = req.body;
        
        // Validation
        if (!client_id || !mois || !montant || !date_paiement) {
            return res.status(400).json({
                success: false,
                message: 'Client, mois, montant et date de paiement sont obligatoires'
            });
        }
        
        // Vérifier si le client existe
        const client = await ClientAbonne.findByPk(client_id);
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client non trouvé'
            });
        }
        
        // Vérifier si un paiement existe déjà pour ce mois
        const existingPaiement = await PaiementAbonnement.findOne({
            where: { client_id, mois }
        });
        
        if (existingPaiement) {
            return res.status(400).json({
                success: false,
                message: 'Un paiement existe déjà pour ce mois'
            });
        }
        
        // Créer le paiement
        const paiement = await PaiementAbonnement.create({
            client_id,
            mois,
            montant,
            date_paiement,
            mode_paiement,
            payment_link_id,
            reference,
            notes
        });
        
        // Vérifier si c'est le paiement du mois en cours
        const moisActuel = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        
        // Si le paiement est pour le mois actuel et le client est inactif, le réactiver automatiquement
        if (mois === moisActuel && client.statut === 'inactif') {
            await client.update({ statut: 'actif' });
            console.log(`✅ Client ${client.abonne_id} réactivé automatiquement suite au paiement du mois ${mois}`);
        }
        
        res.status(201).json({
            success: true,
            data: paiement,
            message: 'Paiement enregistré avec succès'
        });
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement du paiement:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * GET /api/abonnements/paiements/impay\u00e9s
 * Récupérer les clients qui n'ont pas payé pour un mois donné
 */
router.get('/paiements/impayes', async (req, res) => {
    try {
        const { mois } = req.query;
        
        const unpaidClients = await PaiementAbonnement.getUnpaidClients(mois);
        
        res.json({
            success: true,
            data: unpaidClients,
            count: unpaidClients.length
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des impayés:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

// =================== ROUTES STATISTIQUES VENTES ===================

/**
 * GET /api/abonnements/clients/:id/ventes/stats
 * Récupérer les statistiques de ventes d'un client abonné
 * - Total des commandes du mois en cours
 * - Total des commandes depuis le début
 * - Date de la dernière commande
 */
router.get('/clients/:id/ventes/stats', async (req, res) => {
    try {
        const { id } = req.params;
        const { sequelize } = require('../db');
        
        // Vérifier que le client existe
        const client = await ClientAbonne.findByPk(id);
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client non trouvé'
            });
        }
        
        // Obtenir le mois actuel au format YYYY-MM
        const now = new Date();
        const moisActuel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        // Vérifier si la colonne client_abonne_id existe
        try {
            const columnCheck = await sequelize.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'ventes' 
                AND column_name = 'client_abonne_id'
            `, {
                type: sequelize.QueryTypes.SELECT
            });
            
            if (!columnCheck || columnCheck.length === 0) {
                console.log('⚠️ Colonne client_abonne_id non trouvée dans la table ventes');
                // Retourner des statistiques vides
                return res.json({
                    success: true,
                    data: {
                        totalMois: 0,
                        nombreCommandesMois: 0,
                        totalGlobal: 0,
                        nombreCommandesTotal: 0,
                        derniereCommande: null,
                        totalRabaisEconomise: 0,
                        moisActuel
                    },
                    message: 'Colonne client_abonne_id non disponible'
                });
            }
        } catch (checkError) {
            console.error('Erreur lors de la vérification de la colonne:', checkError);
            // Continuer quand même, l'erreur sera capturée plus bas
        }
        
        // Total du mois en cours
        // Utiliser SUBSTRING sur la colonne date qui est au format YYYY-MM-DD
        const [totalMoisResult] = await sequelize.query(`
            SELECT COALESCE(SUM(montant), 0) as total, COUNT(*) as nombre_commandes
            FROM ventes 
            WHERE client_abonne_id = :clientId 
            AND SUBSTRING(date FROM 1 FOR 7) = :mois
        `, {
            replacements: { 
                clientId: id, 
                mois: moisActuel  // 2025-10
            },
            type: sequelize.QueryTypes.SELECT
        });
        
        // Total depuis le début
        const [totalGlobalResult] = await sequelize.query(`
            SELECT COALESCE(SUM(montant), 0) as total, COUNT(*) as nombre_commandes
            FROM ventes 
            WHERE client_abonne_id = :clientId
        `, {
            replacements: { clientId: id },
            type: sequelize.QueryTypes.SELECT
        });
        
        // Dernière commande
        const [derniereCommande] = await sequelize.query(`
            SELECT date, montant 
            FROM ventes 
            WHERE client_abonne_id = :clientId 
            ORDER BY date DESC, id DESC 
            LIMIT 1
        `, {
            replacements: { clientId: id },
            type: sequelize.QueryTypes.SELECT
        });
        
        // Total du rabais économisé depuis le début
        const [totalRabaisResult] = await sequelize.query(`
            SELECT COALESCE(SUM(rabais_applique), 0) as total_rabais
            FROM ventes 
            WHERE client_abonne_id = :clientId 
            AND rabais_applique IS NOT NULL
        `, {
            replacements: { clientId: id },
            type: sequelize.QueryTypes.SELECT
        });
        
        res.json({
            success: true,
            data: {
                totalMois: parseFloat(totalMoisResult.total) || 0,
                nombreCommandesMois: parseInt(totalMoisResult.nombre_commandes) || 0,
                totalGlobal: parseFloat(totalGlobalResult.total) || 0,
                nombreCommandesTotal: parseInt(totalGlobalResult.nombre_commandes) || 0,
                derniereCommande: derniereCommande ? {
                    date: derniereCommande.date,
                    montant: parseFloat(derniereCommande.montant)
                } : null,
                totalRabaisEconomise: parseFloat(totalRabaisResult.total_rabais) || 0,
                moisActuel
            }
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des stats de ventes:', error);
        
        // Retourner des statistiques vides au lieu d'une erreur 500
        const now = new Date();
        const moisActuel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        res.json({
            success: true,
            data: {
                totalMois: 0,
                nombreCommandesMois: 0,
                totalGlobal: 0,
                nombreCommandesTotal: 0,
                derniereCommande: null,
                totalRabaisEconomise: 0,
                moisActuel
            },
            warning: 'Erreur lors de la récupération des statistiques',
            error: error.message
        });
    }
});

/**
 * GET /api/abonnements/clients/:id/ventes
 * Récupérer l'historique complet des commandes d'un client abonné
 */
router.get('/clients/:id/ventes', async (req, res) => {
    try {
        const { id } = req.params;
        const { sequelize } = require('../db');
        
        // Vérifier que le client existe
        const client = await ClientAbonne.findByPk(id);
        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client non trouvé'
            });
        }
        
        // Vérifier si la colonne client_abonne_id existe
        try {
            await sequelize.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'ventes' 
                AND column_name = 'client_abonne_id'
            `, {
                type: sequelize.QueryTypes.SELECT
            });
        } catch (checkError) {
            console.log('⚠️ Colonne client_abonne_id non trouvée dans la table ventes');
            // Retourner une réponse vide plutôt qu'une erreur
            return res.json({
                success: true,
                data: {
                    client: {
                        id: client.id,
                        abonne_id: client.abonne_id,
                        nom: `${client.prenom} ${client.nom}`,
                        telephone: client.telephone
                    },
                    ventes: [],
                    count: 0
                },
                message: 'La colonne client_abonne_id n\'existe pas encore. Aucune vente liée.'
            });
        }
        
        // Récupérer toutes les ventes du client
        const ventes = await sequelize.query(`
            SELECT 
                id,
                date,
                mois,
                point_vente,
                categorie,
                produit,
                prix_unit as "prixUnit",
                nombre,
                montant,
                prix_normal as "prixNormal",
                rabais_applique as "rabaisApplique"
            FROM ventes 
            WHERE client_abonne_id = :clientId 
            ORDER BY date DESC, id DESC
        `, {
            replacements: { clientId: id },
            type: sequelize.QueryTypes.SELECT
        });
        
        res.json({
            success: true,
            data: {
                client: {
                    id: client.id,
                    abonne_id: client.abonne_id,
                    nom: `${client.prenom} ${client.nom}`,
                    telephone: client.telephone
                },
                ventes: ventes && ventes.length > 0 ? ventes.map(v => ({
                    id: v.id,
                    date: v.date,
                    mois: v.mois,
                    pointVente: v.point_vente,
                    categorie: v.categorie,
                    produit: v.produit,
                    prixUnit: parseFloat(v.prixUnit),
                    nombre: parseFloat(v.nombre),
                    montant: parseFloat(v.montant),
                    prixNormal: v.prixNormal ? parseFloat(v.prixNormal) : null,
                    rabaisApplique: v.rabaisApplique ? parseFloat(v.rabaisApplique) : null
                })) : [],
                count: ventes ? ventes.length : 0
            }
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des ventes:', error);
        
        // Retourner une réponse vide plutôt qu'une erreur 500
        res.json({
            success: true,
            data: {
                client: null,
                ventes: [],
                count: 0
            },
            warning: 'Erreur lors de la récupération des ventes',
            error: error.message
        });
    }
});

// =================== ROUTES CONFIGURATION ===================

/**
 * GET /api/abonnements/config
 * Récupérer la configuration des prix abonnement
 */
router.get('/config', (req, res) => {
    try {
        const produitsAbonnement = require('../data/by-date/produitsAbonnement');
        
        res.json({
            success: true,
            data: {
                config: produitsAbonnement.config,
                produits: produitsAbonnement.getTousProduits().map(nom => ({
                    nom,
                    prixAbonne: produitsAbonnement.getPrixAbonne(nom),
                    prixNormal: produitsAbonnement.getPrixNormal(nom),
                    rabais: produitsAbonnement.getRabais(nom),
                    unite: produitsAbonnement.getUnite(nom)
                }))
            }
        });
    } catch (error) {
        console.error('Erreur lors de la récupération de la config:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * GET /api/abonnements/prix/:produit
 * Récupérer le prix abonné pour un produit spécifique
 */
router.get('/prix/:produit', (req, res) => {
    try {
        const { produit } = req.params;
        const produitsAbonnement = require('../data/by-date/produitsAbonnement');
        
        if (!produitsAbonnement.produitEligible(produit)) {
            return res.status(404).json({
                success: false,
                message: 'Produit non éligible à l\'abonnement'
            });
        }
        
        res.json({
            success: true,
            data: {
                produit,
                prixAbonne: produitsAbonnement.getPrixAbonne(produit),
                prixNormal: produitsAbonnement.getPrixNormal(produit),
                rabais: produitsAbonnement.getRabais(produit),
                unite: produitsAbonnement.getUnite(produit)
            }
        });
    } catch (error) {
        console.error('Erreur lors de la récupération du prix:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * GET /api/abonnements/reference/:pointVente
 * Obtenir la référence de paiement Bictorys pour un point de vente
 */
router.get('/reference/:pointVente', (req, res) => {
    try {
        const { pointVente } = req.params;
        
        const reference = ABONNEMENT_REF_MAPPING[pointVente];
        
        if (!reference) {
            return res.status(404).json({
                success: false,
                message: 'Point de vente non reconnu'
            });
        }
        
        res.json({
            success: true,
            data: {
                pointVente,
                reference
            }
        });
    } catch (error) {
        console.error('Erreur lors de la récupération de la référence:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

module.exports = router;
module.exports.ABONNEMENT_REF_MAPPING = ABONNEMENT_REF_MAPPING;

