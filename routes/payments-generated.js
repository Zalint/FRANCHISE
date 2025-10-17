const express = require('express');
const { Op } = require('sequelize');
const axios = require('axios');
const PaymentLink = require('../db/models/PaymentLink');
const pointsVente = require('../points-vente');
const { checkAuth, checkReadAccess } = require('../middlewares/auth');

const router = express.Router();

// Middleware pour valider l'API key (pour services externes)
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.EXTERNAL_API_KEY || 'b326e72b67a9b508c88270b9954c5ca1';
    
    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ 
            success: false, 
            message: 'API key invalide ou manquante' 
        });
    }
    
    // Simuler un utilisateur avec des droits complets pour les requêtes API externes
    req.session = req.session || {};
    req.session.user = {
        username: 'api-client',
        role: 'api',
        pointVente: 'tous'
    };
    
    next();
};

// Middleware pour accepter soit l'authentification par session soit par API key
const checkAuthOrApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    // Si un API key est fourni, utiliser l'authentification par API key
    if (apiKey) {
        return validateApiKey(req, res, next);
    }
    
    // Sinon, utiliser l'authentification par session
    return checkAuth(req, res, next);
};

/**
 * GET /api/payments/generated
 * Liste tous les paiements générés depuis l'app avec le menu "Générer paiement"
 * 
 * Paramètres query :
 * - date (obligatoire): Date au format dd-mm-yyyy
 * - pointVente (obligatoire): Nom du point de vente
 * 
 * Authentification :
 * - Session (checkAuth + checkReadAccess) OU
 * - API Key (x-api-key header avec EXTERNAL_API_KEY)
 * 
 * Retourne les paiements classés en "payé" et "non encore payé"
 */
router.get('/', checkAuthOrApiKey, async (req, res) => {
    try {
        const { date, pointVente } = req.query;

        // 1. Validation des paramètres obligatoires
        if (!date) {
            return res.status(400).json({
                success: false,
                message: 'Le paramètre "date" est obligatoire au format dd-mm-yyyy'
            });
        }

        if (!pointVente) {
            return res.status(400).json({
                success: false,
                message: 'Le paramètre "pointVente" est obligatoire'
            });
        }

        // 2. Validation du format de date (dd-mm-yyyy)
        const dateRegex = /^(\d{2})-(\d{2})-(\d{4})$/;
        const dateMatch = date.match(dateRegex);
        
        if (!dateMatch) {
            return res.status(400).json({
                success: false,
                message: 'Format de date invalide. Utilisez le format dd-mm-yyyy (ex: 17-10-2025)'
            });
        }

        const [, day, month, year] = dateMatch;
        
        // Vérifier la validité de la date
        const parsedDate = new Date(year, month - 1, day);
        if (parsedDate.getDate() != day || parsedDate.getMonth() != month - 1 || parsedDate.getFullYear() != year) {
            return res.status(400).json({
                success: false,
                message: 'Date invalide'
            });
        }

        // 3. Validation du point de vente
        if (!pointsVente[pointVente]) {
            return res.status(400).json({
                success: false,
                message: `Point de vente "${pointVente}" non trouvé`
            });
        }

        if (!pointsVente[pointVente].active) {
            return res.status(400).json({
                success: false,
                message: `Point de vente "${pointVente}" n'est pas actif`
            });
        }

        // 4. Convertir la date au format pour la comparaison avec la BDD
        // Dans PaymentLink, created_at est stocké en YYYY-MM-DD HH:MM:SS
        const startDate = new Date(year, month - 1, day, 0, 0, 0);
        const endDate = new Date(year, month - 1, day, 23, 59, 59);

        // 5. Requête pour récupérer les paiements
        const payments = await PaymentLink.findAll({
            where: {
                point_vente: pointVente,
                created_at: {
                    [Op.between]: [startDate, endDate]
                },
                archived: 0 // Exclure les paiements archivés
            },
            order: [['created_at', 'DESC']]
        });

        // 6. Classification des paiements
        const paidStatuses = ['paid', 'paid_in_cash'];
        const unpaidStatuses = ['opened', 'expired'];
        
        const paidPayments = [];
        const unpaidPayments = [];
        
        payments.forEach(payment => {
            const paymentData = {
                id: payment.payment_link_id,
                amount: parseFloat(payment.amount),
                currency: payment.currency,
                created_at: payment.created_at,
                client_name: payment.client_name,
                phone_number: payment.phone_number,
                reference: payment.reference,
                status: payment.status,
                payment_url: payment.payment_url,
                due_date: payment.due_date,
                is_abonnement: payment.is_abonnement || false
            };

            if (paidStatuses.includes(payment.status)) {
                paidPayments.push({
                    ...paymentData,
                    paid_at: payment.updated_at // Approximation - quand le statut a été mis à jour
                });
            } else {
                unpaidPayments.push(paymentData);
            }
        });

        // 7. Calcul des totaux
        const totalAmountPaid = paidPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const totalAmountUnpaid = unpaidPayments.reduce((sum, payment) => sum + payment.amount, 0);

        // 8. Formatage de la réponse
        const response = {
            success: true,
            data: {
                date: date,
                pointVente: pointVente,
                summary: {
                    total_payments: payments.length,
                    paid_count: paidPayments.length,
                    unpaid_count: unpaidPayments.length,
                    total_amount_paid: Math.round(totalAmountPaid * 100) / 100,
                    total_amount_unpaid: Math.round(totalAmountUnpaid * 100) / 100,
                    total_amount: Math.round((totalAmountPaid + totalAmountUnpaid) * 100) / 100
                },
                payments: {
                    paid: paidPayments.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at)),
                    unpaid: unpaidPayments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                }
            }
        };

        res.json(response);

    } catch (error) {
        console.error('Erreur lors de la récupération des paiements générés:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/payments/bictorys/source
 * Récupère les transactions Bictorys avec status succeeded pour une date et un point de vente donnés
 * 
 * Paramètres query :
 * - date (obligatoire): Date au format dd-mm-yyyy
 * - pointVente (obligatoire): Nom du point de vente
 * 
 * Authentification :
 * - Session (checkAuth + checkReadAccess) OU
 * - API Key (x-api-key header avec EXTERNAL_API_KEY)
 * 
 * Retourne les transactions Bictorys avec status succeeded
 */
router.get('/bictorys/source', checkAuthOrApiKey, async (req, res) => {
    try {
        const { date, pointVente } = req.query;

        // 1. Validation des paramètres obligatoires
        if (!date) {
            return res.status(400).json({
                success: false,
                message: 'Le paramètre "date" est obligatoire au format dd-mm-yyyy'
            });
        }

        if (!pointVente) {
            return res.status(400).json({
                success: false,
                message: 'Le paramètre "pointVente" est obligatoire'
            });
        }

        // 2. Validation du format de date (dd-mm-yyyy)
        const dateRegex = /^(\d{2})-(\d{2})-(\d{4})$/;
        const dateMatch = date.match(dateRegex);
        
        if (!dateMatch) {
            return res.status(400).json({
                success: false,
                message: 'Format de date invalide. Utilisez le format dd-mm-yyyy (ex: 17-10-2025)'
            });
        }

        const [, day, month, year] = dateMatch;
        
        // Vérifier la validité de la date
        const parsedDate = new Date(year, month - 1, day);
        if (parsedDate.getDate() != day || parsedDate.getMonth() != month - 1 || parsedDate.getFullYear() != year) {
            return res.status(400).json({
                success: false,
                message: 'Date invalide'
            });
        }

        // 3. Mapping des points de vente vers les références Bictorys
        const POINT_VENTE_TO_REFS = {
            'Touba': ['V_TB', 'G_TB'],
            'Dahra': ['V_DHR', 'G_DHR'],
            'Aliou Sow': ['V_ALS', 'G_ALS'],
            'Linguere': ['V_LGR', 'G_LGR'],
            'Mbao': ['V_MBA', 'G_MBA'],
            'Keur Massar': ['V_KM', 'G_KM'],
            'O.Foire': ['V_OSF', 'G_OSF'],
            'Sacre Coeur': ['V_SAC', 'G_SAC'],
            'Abattage': ['V_ABATS', 'G_ABATS']
        };

        const references = POINT_VENTE_TO_REFS[pointVente];
        
        if (!references) {
            return res.status(400).json({
                success: false,
                message: `Point de vente "${pointVente}" non reconnu. Points de vente valides: ${Object.keys(POINT_VENTE_TO_REFS).join(', ')}`,
                availablePointsVente: Object.keys(POINT_VENTE_TO_REFS)
            });
        }

        // 4. Préparer les dates pour l'API Bictorys (format ISO 8601 avec timezone Dakar UTC+0)
        // Format attendu: 2025-10-17T00:00:00+00:00
        const startDate = `${year}-${month}-${day}T00:00:00+00:00`;
        
        // Calculer end_date = date + 1 jour
        const endDateObj = new Date(year, month - 1, day);
        endDateObj.setDate(endDateObj.getDate() + 1);
        const endDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}T00:00:00+00:00`;

        console.log(`🔍 Recherche des transactions Bictorys pour ${pointVente} du ${startDate} au ${endDate}`);
        console.log(`📌 Références à filtrer: ${references.join(', ')}`);

        // 5. Appeler l'API Bictorys
        const bictorysApiKey = process.env.BICTORYS_TRANSACTIONS_API_KEY || 'secret-65ee2442-d88f-458f-9f1d-af596e7c7de5.OMhl3SfA22eMFVmHrDVoKwQoClT72Asn4E7gxTl1Fm5GiZ97Z62kbq2eNmuEGoKy';
        
        const bictorysResponse = await axios.get('https://api.bictorys.com/pay/v1/transactions', {
            headers: {
                'X-API-Key': bictorysApiKey
            },
            params: {
                start_date: startDate,
                end_date: endDate
            },
            timeout: 30000 // 30 secondes
        });

        console.log(`📊 Réponse Bictorys reçue:`, {
            status: bictorysResponse.status,
            dataType: typeof bictorysResponse.data,
            isArray: Array.isArray(bictorysResponse.data)
        });

        // 6. Filtrer les transactions
        let transactions = [];
        
        // Gérer différents formats de réponse possibles
        if (Array.isArray(bictorysResponse.data)) {
            transactions = bictorysResponse.data;
        } else if (bictorysResponse.data && Array.isArray(bictorysResponse.data.transactions)) {
            transactions = bictorysResponse.data.transactions;
        } else if (bictorysResponse.data && Array.isArray(bictorysResponse.data.data)) {
            transactions = bictorysResponse.data.data;
        }

        console.log(`📋 Nombre total de transactions reçues: ${transactions.length}`);

        // Filtrer: status = succeeded ET reference commence par V_ ou G_ du point de vente
        const filteredTransactions = transactions.filter(transaction => {
            const hasSucceededStatus = transaction.status === 'succeeded';
            const hasValidReference = references.some(ref => 
                transaction.reference && transaction.reference.startsWith(ref)
            );
            
            return hasSucceededStatus && hasValidReference;
        });

        console.log(`✅ Transactions filtrées (succeeded + références valides): ${filteredTransactions.length}`);

        // 7. Calculer les totaux
        const totalAmount = filteredTransactions.reduce((sum, transaction) => {
            return sum + (parseFloat(transaction.amount) || 0);
        }, 0);

        // 8. Formater la réponse
        const response = {
            success: true,
            data: {
                date: date,
                pointVente: pointVente,
                references: references,
                period: {
                    start_date: startDate,
                    end_date: endDate
                },
                summary: {
                    total_transactions: filteredTransactions.length,
                    total_amount: Math.round(totalAmount * 100) / 100,
                    currency: filteredTransactions.length > 0 ? filteredTransactions[0].currency : 'XOF'
                },
                transactions: filteredTransactions.map(transaction => ({
                    id: transaction.id,
                    reference: transaction.reference,
                    amount: parseFloat(transaction.amount),
                    currency: transaction.currency,
                    status: transaction.status,
                    created_at: transaction.created_at || transaction.createdAt,
                    customer: transaction.customer || null,
                    description: transaction.description || null
                }))
            }
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Erreur lors de la récupération des transactions Bictorys:', error.message);
        
        if (error.response) {
            // Erreur de l'API Bictorys
            console.error('Erreur API Bictorys:', {
                status: error.response.status,
                data: error.response.data
            });
            
            res.status(error.response.status).json({
                success: false,
                message: 'Erreur lors de la communication avec l\'API Bictorys',
                details: error.response.data,
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } else {
            // Erreur interne
            res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
});

module.exports = router;
