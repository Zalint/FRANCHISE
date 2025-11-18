const express = require('express');
const router = express.Router();
const { AuditClientLog } = require('../db/models');
const { Op } = require('sequelize');

// Middleware pour vérifier que l'utilisateur est Superviseur
function checkSupervisorAccess(req, res, next) {
    console.log('🔐 Vérification accès Superviseur');
    console.log('Session user:', req.session.user);
    
    if (!req.session.user) {
        console.log('❌ Pas de session utilisateur');
        return res.status(401).json({ 
            success: false, 
            error: 'Non authentifié' 
        });
    }
    
    const user = req.session.user;
    const userRole = user.role ? user.role.toLowerCase() : '';
    
    console.log('User role:', user.role, '(normalized:', userRole + ')');
    console.log('Is SuperAdmin:', user.isSuperAdmin);
    console.log('Is admin:', user.role === 'admin');
    
    // Accepter: Superviseur, superviseur, admin, ou isSuperAdmin
    if (userRole === 'superviseur' || user.role === 'admin' || user.isSuperAdmin === true) {
        console.log('✅ Accès autorisé');
        next();
    } else {
        console.log('❌ Accès refusé - Role:', user.role);
        return res.status(403).json({ 
            success: false, 
            error: 'Accès refusé - Superviseur uniquement' 
        });
    }
}

// ==================== RÉCUPÉRER LES LOGS ====================
router.get('/', checkSupervisorAccess, async (req, res) => {
    try {
        const {
            start_date,
            end_date,
            username,
            point_vente,
            phone_number,
            page = 1,
            limit = 50
        } = req.query;

        // Construire les conditions de filtrage
        const where = {};

        // Filtre par dates
        if (start_date || end_date) {
            where.search_timestamp = {};
            if (start_date) {
                where.search_timestamp[Op.gte] = new Date(start_date);
            }
            if (end_date) {
                // Fin de journée
                const endDateTime = new Date(end_date);
                endDateTime.setHours(23, 59, 59, 999);
                where.search_timestamp[Op.lte] = endDateTime;
            }
        }

        // Filtre par utilisateur
        if (username && username !== 'Tous') {
            where.username = username;
        }

        // Filtre par point de vente
        if (point_vente && point_vente !== 'Tous') {
            where.point_de_vente = point_vente;
        }

        // Filtre par numéro de téléphone
        if (phone_number) {
            where.phone_number_searched = {
                [Op.like]: `%${phone_number}%`
            };
        }

        // Pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Requête
        const { count, rows } = await AuditClientLog.findAndCountAll({
            where,
            order: [['search_timestamp', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        res.json({
            success: true,
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(count / parseInt(limit)),
            data: rows
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des logs:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des logs'
        });
    }
});

// ==================== STATISTIQUES AGRÉGÉES ====================
router.get('/stats', checkSupervisorAccess, async (req, res) => {
    try {
        const { start_date, end_date, username, point_vente } = req.query;

        // Construire les conditions de filtrage
        const where = {};

        if (start_date || end_date) {
            where.search_timestamp = {};
            if (start_date) {
                where.search_timestamp[Op.gte] = new Date(start_date);
            }
            if (end_date) {
                const endDateTime = new Date(end_date);
                endDateTime.setHours(23, 59, 59, 999);
                where.search_timestamp[Op.lte] = endDateTime;
            }
        }

        if (username && username !== 'Tous') {
            where.username = username;
        }

        if (point_vente && point_vente !== 'Tous') {
            where.point_de_vente = point_vente;
        }

        // Total recherches
        const totalSearches = await AuditClientLog.count({ where });

        // Clients uniques
        const uniqueClients = await AuditClientLog.count({
            where,
            distinct: true,
            col: 'phone_number_searched'
        });

        // Durée moyenne (exclure les null)
        const avgDurationResult = await AuditClientLog.findOne({
            where: {
                ...where,
                consultation_duration_seconds: { [Op.ne]: null }
            },
            attributes: [
                [AuditClientLog.sequelize.fn('AVG', AuditClientLog.sequelize.col('consultation_duration_seconds')), 'avg_duration']
            ],
            raw: true
        });
        const avgDuration = avgDurationResult?.avg_duration ? Math.round(avgDurationResult.avg_duration) : 0;

        // Taux de succès
        const successCount = await AuditClientLog.count({
            where: { ...where, search_success: true }
        });
        const successRate = totalSearches > 0 ? (successCount / totalSearches) : 0;

        // Par utilisateur
        const byUser = await AuditClientLog.findAll({
            where,
            attributes: [
                'username',
                [AuditClientLog.sequelize.fn('COUNT', AuditClientLog.sequelize.col('id')), 'count']
            ],
            group: ['username'],
            order: [[AuditClientLog.sequelize.fn('COUNT', AuditClientLog.sequelize.col('id')), 'DESC']],
            limit: 10,
            raw: true
        });

        // Par point de vente
        const byPointVente = await AuditClientLog.findAll({
            where: {
                ...where,
                point_de_vente: { [Op.ne]: null }
            },
            attributes: [
                'point_de_vente',
                [AuditClientLog.sequelize.fn('COUNT', AuditClientLog.sequelize.col('id')), 'count']
            ],
            group: ['point_de_vente'],
            order: [[AuditClientLog.sequelize.fn('COUNT', AuditClientLog.sequelize.col('id')), 'DESC']],
            raw: true
        });

        // Par jour (derniers 30 jours ou période filtrée)
        const byDay = await AuditClientLog.findAll({
            where,
            attributes: [
                [AuditClientLog.sequelize.fn('DATE', AuditClientLog.sequelize.col('search_timestamp')), 'date'],
                [AuditClientLog.sequelize.fn('COUNT', AuditClientLog.sequelize.col('id')), 'count']
            ],
            group: [AuditClientLog.sequelize.fn('DATE', AuditClientLog.sequelize.col('search_timestamp'))],
            order: [[AuditClientLog.sequelize.fn('DATE', AuditClientLog.sequelize.col('search_timestamp')), 'ASC']],
            raw: true
        });

        res.json({
            success: true,
            stats: {
                total_searches: totalSearches,
                unique_clients: uniqueClients,
                average_duration_seconds: avgDuration,
                success_rate: successRate,
                by_user: byUser,
                by_point_vente: byPointVente,
                by_day: byDay
            }
        });

    } catch (error) {
        console.error('Erreur lors du calcul des statistiques:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du calcul des statistiques'
        });
    }
});

// ==================== LISTE DES UTILISATEURS (pour filtre) ====================
router.get('/users', checkSupervisorAccess, async (req, res) => {
    try {
        const users = await AuditClientLog.findAll({
            attributes: [[AuditClientLog.sequelize.fn('DISTINCT', AuditClientLog.sequelize.col('username')), 'username']],
            order: [['username', 'ASC']],
            raw: true
        });

        res.json({
            success: true,
            users: users.map(u => u.username)
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des utilisateurs:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des utilisateurs'
        });
    }
});

// ==================== LISTE DES POINTS DE VENTE (pour filtre) ====================
router.get('/points-vente', checkSupervisorAccess, async (req, res) => {
    try {
        const pointsVente = await AuditClientLog.findAll({
            where: {
                point_de_vente: { [Op.ne]: null }
            },
            attributes: [[AuditClientLog.sequelize.fn('DISTINCT', AuditClientLog.sequelize.col('point_de_vente')), 'point_de_vente']],
            order: [['point_de_vente', 'ASC']],
            raw: true
        });

        res.json({
            success: true,
            points_vente: pointsVente.map(p => p.point_de_vente).filter(p => p)
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des points de vente:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des points de vente'
        });
    }
});

// ==================== EXPORT EXCEL ====================
router.get('/export', checkSupervisorAccess, async (req, res) => {
    try {
        const { start_date, end_date, username, point_vente, phone_number } = req.query;

        // Construire les conditions de filtrage (même logique que GET /)
        const where = {};

        if (start_date || end_date) {
            where.search_timestamp = {};
            if (start_date) {
                where.search_timestamp[Op.gte] = new Date(start_date);
            }
            if (end_date) {
                const endDateTime = new Date(end_date);
                endDateTime.setHours(23, 59, 59, 999);
                where.search_timestamp[Op.lte] = endDateTime;
            }
        }

        if (username && username !== 'Tous') {
            where.username = username;
        }

        if (point_vente && point_vente !== 'Tous') {
            where.point_de_vente = point_vente;
        }

        if (phone_number) {
            where.phone_number_searched = {
                [Op.like]: `%${phone_number}%`
            };
        }

        // Récupérer toutes les données (pas de pagination pour l'export)
        const logs = await AuditClientLog.findAll({
            where,
            order: [['search_timestamp', 'DESC']],
            raw: true
        });

        // Formater les données pour Excel
        const formattedData = logs.map(log => ({
            'Date/Heure': new Date(log.search_timestamp).toLocaleString('fr-FR'),
            'Utilisateur': log.username,
            'Point de Vente': log.point_de_vente || '-',
            'Téléphone Client': log.phone_number_searched,
            'Nom Client': log.client_name || '-',
            'Durée (secondes)': log.consultation_duration_seconds || 0,
            'Durée (minutes)': log.consultation_duration_seconds ? (log.consultation_duration_seconds / 60).toFixed(2) : 0,
            'Succès': log.search_success ? 'Oui' : 'Non',
            'Commandes trouvées': log.total_orders_found || 0,
            'Erreur': log.error_message || '-'
        }));

        res.json({
            success: true,
            data: formattedData,
            filename: `audit_logs_${new Date().toISOString().split('T')[0]}.xlsx`
        });

    } catch (error) {
        console.error('Erreur lors de l\'export:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'export'
        });
    }
});

module.exports = router;

