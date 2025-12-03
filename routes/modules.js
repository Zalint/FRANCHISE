/**
 * Routes de gestion des modules
 * Permet d'activer/désactiver les modules de l'application
 */

const express = require('express');
const router = express.Router();
const { 
    getAllModules, 
    getModule, 
    isModuleActive,
    activateModule, 
    deactivateModule, 
    toggleModule,
    getActiveModules,
    getInactiveModules
} = require('../config/modules-config');

/**
 * GET /api/modules
 * Obtenir la liste de tous les modules avec leur état
 */
router.get('/', (req, res) => {
    try {
        const modules = getAllModules();
        res.json({
            success: true,
            modules: modules
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des modules:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des modules'
        });
    }
});

/**
 * GET /api/modules/active
 * Obtenir uniquement les modules actifs (pour le frontend)
 */
router.get('/active', (req, res) => {
    try {
        const activeModules = getActiveModules();
        
        // Format simplifié pour le frontend
        const modulesForFrontend = activeModules.map(m => ({
            id: m.id,
            name: m.name,
            tabs: m.tabs,
            sections: m.sections,
            menuItems: m.menuItems,
            isCore: m.isCore
        }));
        
        res.json({
            success: true,
            modules: modulesForFrontend
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des modules actifs:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des modules actifs'
        });
    }
});

/**
 * GET /api/modules/status
 * Obtenir l'état de tous les modules (pour le frontend)
 * Format simplifié: { moduleId: boolean }
 */
router.get('/status', (req, res) => {
    try {
        const modules = getAllModules();
        const status = {};
        
        for (const moduleId in modules) {
            status[moduleId] = modules[moduleId].active;
        }
        
        res.json({
            success: true,
            status: status
        });
    } catch (error) {
        console.error('Erreur lors de la récupération du statut des modules:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération du statut des modules'
        });
    }
});

/**
 * GET /api/modules/:moduleId
 * Obtenir les détails d'un module spécifique
 */
router.get('/:moduleId', (req, res) => {
    try {
        const { moduleId } = req.params;
        const module = getModule(moduleId);
        
        if (!module) {
            return res.status(404).json({
                success: false,
                message: `Module "${moduleId}" non trouvé`
            });
        }
        
        res.json({
            success: true,
            module: module
        });
    } catch (error) {
        console.error('Erreur lors de la récupération du module:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération du module'
        });
    }
});

/**
 * POST /api/modules/:moduleId/activate
 * Activer un module (admin seulement)
 */
router.post('/:moduleId/activate', (req, res) => {
    try {
        const { moduleId } = req.params;
        const module = getModule(moduleId);
        
        if (!module) {
            return res.status(404).json({
                success: false,
                message: `Module "${moduleId}" non trouvé`
            });
        }
        
        const result = activateModule(moduleId);
        
        if (result) {
            res.json({
                success: true,
                message: `Module "${module.name}" activé`,
                moduleId: moduleId,
                active: true
            });
        } else {
            res.status(400).json({
                success: false,
                message: `Impossible d'activer le module "${module.name}"`
            });
        }
    } catch (error) {
        console.error('Erreur lors de l\'activation du module:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'activation du module'
        });
    }
});

/**
 * POST /api/modules/:moduleId/deactivate
 * Désactiver un module (admin seulement)
 */
router.post('/:moduleId/deactivate', (req, res) => {
    try {
        const { moduleId } = req.params;
        const module = getModule(moduleId);
        
        if (!module) {
            return res.status(404).json({
                success: false,
                message: `Module "${moduleId}" non trouvé`
            });
        }
        
        if (module.isCore) {
            return res.status(400).json({
                success: false,
                message: `Le module "${module.name}" est essentiel et ne peut pas être désactivé`
            });
        }
        
        const result = deactivateModule(moduleId);
        
        if (result) {
            res.json({
                success: true,
                message: `Module "${module.name}" désactivé`,
                moduleId: moduleId,
                active: false
            });
        } else {
            res.status(400).json({
                success: false,
                message: `Impossible de désactiver le module "${module.name}"`
            });
        }
    } catch (error) {
        console.error('Erreur lors de la désactivation du module:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la désactivation du module'
        });
    }
});

/**
 * POST /api/modules/:moduleId/toggle
 * Basculer l'état d'un module (admin seulement)
 */
router.post('/:moduleId/toggle', (req, res) => {
    try {
        const { moduleId } = req.params;
        const module = getModule(moduleId);
        
        if (!module) {
            return res.status(404).json({
                success: false,
                message: `Module "${moduleId}" non trouvé`
            });
        }
        
        if (module.isCore && module.active) {
            return res.status(400).json({
                success: false,
                message: `Le module "${module.name}" est essentiel et ne peut pas être désactivé`
            });
        }
        
        const newState = toggleModule(moduleId);
        
        res.json({
            success: true,
            message: `Module "${module.name}" ${newState ? 'activé' : 'désactivé'}`,
            moduleId: moduleId,
            active: newState
        });
    } catch (error) {
        console.error('Erreur lors du basculement du module:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du basculement du module'
        });
    }
});

/**
 * POST /api/modules/bulk-update
 * Mettre à jour plusieurs modules en une fois (admin seulement)
 */
router.post('/bulk-update', (req, res) => {
    try {
        const { updates } = req.body; // { moduleId: boolean, ... }
        
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Format de données invalide'
            });
        }
        
        const results = {};
        const errors = [];
        
        for (const moduleId in updates) {
            const shouldBeActive = updates[moduleId];
            const module = getModule(moduleId);
            
            if (!module) {
                errors.push(`Module "${moduleId}" non trouvé`);
                continue;
            }
            
            if (module.isCore && !shouldBeActive) {
                errors.push(`Le module "${module.name}" est essentiel et ne peut pas être désactivé`);
                continue;
            }
            
            if (shouldBeActive) {
                activateModule(moduleId);
            } else {
                deactivateModule(moduleId);
            }
            
            results[moduleId] = shouldBeActive;
        }
        
        res.json({
            success: errors.length === 0,
            message: errors.length === 0 
                ? 'Tous les modules ont été mis à jour' 
                : 'Certains modules n\'ont pas pu être mis à jour',
            results: results,
            errors: errors
        });
    } catch (error) {
        console.error('Erreur lors de la mise à jour des modules:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la mise à jour des modules'
        });
    }
});

module.exports = router;

