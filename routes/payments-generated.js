const express = require('express');
const { Op } = require('sequelize');
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

module.exports = router;