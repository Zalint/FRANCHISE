// Load environment variables
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
});

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const path = require('path');
const session = require('express-session');
const axios = require('axios');
const users = require('./users');
const PaymentLink = require('./db/models/PaymentLink');

// =====================================================
// CONFIGURATION DEPUIS LA BASE DE DONNÉES
// =====================================================
const configService = require('./db/config-service');

// Variables globales pour la configuration (chargées depuis la BDD)
let pointsVente = {};
let produits = {};
let produitsInventaire = {};
let produitsAbonnement = {};

// Fonction pour charger la configuration depuis la BDD
async function loadConfigFromDB() {
    try {
        console.log('📦 Chargement de la configuration depuis la base de données...');
        
        // Charger les points de vente
        pointsVente = await configService.getPointsVenteAsLegacy();
        console.log(`  ✅ Points de vente: ${Object.keys(pointsVente).length} chargés`);
        
        // Charger les produits vente
        produits = await configService.getProduitsAsLegacy('vente');
        const nbProduitsVente = Object.values(produits).filter(v => typeof v === 'object' && !Array.isArray(v)).reduce((acc, cat) => acc + Object.keys(cat).length, 0);
        console.log(`  ✅ Produits vente: ${nbProduitsVente} chargés`);
        
        // Charger les produits inventaire
        produitsInventaire = await configService.getProduitsAsLegacy('inventaire');
        const nbProduitsInv = Object.keys(produitsInventaire).filter(k => typeof produitsInventaire[k] === 'object' && produitsInventaire[k].prixDefault !== undefined).length;
        console.log(`  ✅ Produits inventaire: ${nbProduitsInv} chargés`);
        
        // Charger les produits abonnement
        produitsAbonnement = await configService.getProduitsAsLegacy('abonnement');
        const nbProduitsAbo = Object.values(produitsAbonnement).filter(v => typeof v === 'object' && !Array.isArray(v)).reduce((acc, cat) => acc + Object.keys(cat).length, 0);
        console.log(`  ✅ Produits abonnement: ${nbProduitsAbo} chargés`);
        
        // Mettre à jour les variables globales
        global.produits = produits;
        global.produitsInventaire = produitsInventaire;
        global.produitsAbonnement = produitsAbonnement;
        global.pointsVente = pointsVente;
        
        console.log('✅ Configuration chargée depuis la base de données');
        return true;
    } catch (error) {
        console.error('❌ Erreur lors du chargement de la configuration:', error.message);
        // Configuration par défaut en cas d'erreur
        pointsVente = {
            "Keur Bali": { active: true },
            "Abattage": { active: true }
        };
        produits = {};
        produitsInventaire = {};
        produitsAbonnement = {};
        return false;
    }
}

// Fonction pour recharger la configuration (remplace reloadProduitsConfig)
async function reloadProduitsConfig() {
    try {
        // Invalider le cache du service
        configService.invalidateCache();
        
        // Recharger depuis la BDD
        await loadConfigFromDB();
        
        console.log('Configuration rechargée avec succès depuis la BDD');
        return { success: true, message: 'Configuration rechargée avec succès' };
    } catch (error) {
        console.error('Error reloading configuration:', error);
        return { success: false, message: 'Erreur lors du rechargement de la configuration' };
    }
}
const bcrypt = require('bcrypt');
const fsPromises = require('fs').promises;
const { Vente, Stock, Transfert, Reconciliation, CashPayment, AchatBoeuf, Depense, WeightParams, Precommande, ClientAbonne, PaiementAbonnement, PerformanceAchat, User } = require('./db/models');
const { testConnection, sequelize } = require('./db');
const { Op, fn, col, literal } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const Estimation = require('./db/models/Estimation');
const { spawn } = require('child_process');

// Import the schema update scripts
const { updateSchema } = require('./db/update-schema');
const { updateVenteSchema } = require('./db/update-vente-schema');

const app = express();
const PORT = process.env.PORT || 3000;

// Make sure Estimation is properly initialized
console.log('Initializing models...');
console.log('Estimation model:', !!Estimation);
console.log('Estimation.create:', typeof Estimation.create === 'function' ? 'function available' : 'NOT AVAILABLE');

// Run the schema update scripts when the server starts
(async function() {
  try {
    console.log('Running database schema updates...');
    await updateSchema();
    await updateVenteSchema();
    // Note: Abonnement schema updates are now handled by SQL queries in the startup sequence above
    // await updateVenteSchemaAbonnement(); // Ajouter les colonnes pour les abonnements
        
    // Add commentaire column if it doesn't exist
    try {
        console.log('Checking and adding commentaire column...');
        await sequelize.query(`
            ALTER TABLE estimations 
            ADD COLUMN IF NOT EXISTS commentaire TEXT DEFAULT NULL;
        `);
        console.log('Commentaire column ensured');
    } catch (error) {
        console.log('Note: commentaire column may already exist:', error.message);
    }
    
    // Ajouter les colonnes abonnement à payment_links si elles n'existent pas
    try {
        console.log('🔧 Ajout des colonnes abonnement à payment_links...');
        await sequelize.query(`
            ALTER TABLE payment_links 
            ADD COLUMN IF NOT EXISTS is_abonnement BOOLEAN DEFAULT FALSE;
        `);
        await sequelize.query(`
            ALTER TABLE payment_links 
            ADD COLUMN IF NOT EXISTS client_abonne_id INTEGER;
        `);
        console.log('✅ Colonnes abonnement ajoutées à payment_links');
    } catch (error) {
        console.log('Note: Colonnes abonnement déjà présentes:', error.message);
    }
    
    // Create abonnements tables if they don't exist
    try {
        console.log('🔧 Checking abonnements tables...');
        
        // Create clients_abonnes table
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS clients_abonnes (
                id SERIAL PRIMARY KEY,
                abonne_id VARCHAR(20) UNIQUE NOT NULL,
                prenom VARCHAR(100) NOT NULL,
                nom VARCHAR(100) NOT NULL,
                telephone VARCHAR(20) UNIQUE NOT NULL,
                adresse TEXT,
                position_gps VARCHAR(255),
                lien_google_maps TEXT,
                point_vente_defaut VARCHAR(50) NOT NULL,
                statut VARCHAR(20) DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
                date_inscription DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Table clients_abonnes OK');
        
        // Create paiements_abonnement table
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS paiements_abonnement (
                id SERIAL PRIMARY KEY,
                client_id INTEGER NOT NULL REFERENCES clients_abonnes(id) ON DELETE CASCADE,
                mois VARCHAR(7) NOT NULL,
                montant DECIMAL(10, 2) NOT NULL DEFAULT 5000,
                date_paiement DATE NOT NULL,
                mode_paiement VARCHAR(50),
                payment_link_id VARCHAR(255),
                reference VARCHAR(255),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(client_id, mois)
            );
        `);
        console.log('✅ Table paiements_abonnement OK');
        
        // Create indexes
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_clients_abonnes_abonne_id ON clients_abonnes(abonne_id);
            CREATE INDEX IF NOT EXISTS idx_clients_abonnes_telephone ON clients_abonnes(telephone);
            CREATE INDEX IF NOT EXISTS idx_clients_abonnes_statut ON clients_abonnes(statut);
            CREATE INDEX IF NOT EXISTS idx_paiements_client_id ON paiements_abonnement(client_id);
            CREATE INDEX IF NOT EXISTS idx_paiements_mois ON paiements_abonnement(mois);
        `);
        console.log('✅ Abonnements indexes created');
        
    } catch (error) {
        console.log('Note: Abonnements tables may already exist:', error.message);
    }
    
    console.log('Database schema updates completed successfully');
  } catch (error) {
    console.error('Error during schema updates:', error);
  }
})();

// Middleware
// Allow all origins in production for Render
app.use(cors({
    origin: true, // Allow any origin
    credentials: true
}));
app.use(express.json({ limit: '50mb' })); // Increase JSON payload limit
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Increase URL-encoded payload limit
app.use(express.static(path.join(__dirname))); // Servir les fichiers statiques (HTML, CSS, JS)

// Trust the first proxy (needed for secure cookies in environments like Render)
app.set('trust proxy', 1);

// Configuration des sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'votre_secret_key_par_defaut', // Use environment variable for secret
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
}));


// Route dynamique pour la config inventaire - fusionne les catégories de base avec les produits OCR/superette en BDD
app.get('/inventaire-config.json', async (req, res) => {
    try {
        // Catégories de base (produits viande connus)
        const baseCategories = {
            BOVIN: {
                label: "Bovin", icon: "🐮", color: "#8B4513", ordre: 1,
                sousCategories: {
                    BOEUF:        { label: "Boeuf",          icon: "🥩", ordre: 1, unite: "kg",  produits: ["Boeuf en gros","Boeuf en détail","Boeuf en morceaux","Bœuf","Boeuf"] },
                    VEAU:         { label: "Veau",           icon: "🥩", ordre: 2, unite: "kg",  produits: ["Veau en gros","Veau en détail","Veau en morceaux","Veau"] },
                    FOIE:         { label: "Foie",           icon: "🥩", ordre: 3, unite: "kg",  produits: ["Foie","foie"] },
                    YELL:         { label: "Yell",           icon: "🥩", ordre: 4, unite: "kg",  produits: ["Yell","yell"] },
                    FILET:        { label: "Filet",          icon: "🥩", ordre: 5, unite: "kg",  produits: ["Filet","filet"] },
                    FAUX_FILET:   { label: "Faux filet",     icon: "🥩", ordre: 6, unite: "kg",  produits: ["Faux filet","faux filet","Sans Os","sans os"] },
                    VIANDE_HACHEE:{ label: "Viande hachée",  icon: "🍖", ordre: 7, unite: "kg",  produits: ["Viande hachée","Viande hachee","Hachée","Hachee"] },
                    MERGEZ:       { label: "Merguez",        icon: "🌭", ordre: 8, unite: "kg",  produits: ["Mergez","Merguez","Merguez poulet"] }
                }
            },
            OVIN: {
                label: "Ovin", icon: "🐑", color: "#D2691E", ordre: 2,
                sousCategories: {
                    AGNEAU:       { label: "Agneau",          icon: "🥩", ordre: 1, unite: "kg", produits: ["Agneau en gros","Agneau en détail","Agneau en morceaux","Agneau","Mouton en gros","Mouton en détail","Mouton"] },
                    PATTE_MOUTON: { label: "Patte de mouton", icon: "🥩", ordre: 2, unite: "kg", produits: ["Patte de mouton","patte de mouton"] },
                    LAXASS:       { label: "Laxass",          icon: "🥩", ordre: 3, unite: "kg", produits: ["Laxass","laxass"] }
                }
            },
            VOLAILLE: {
                label: "Volaille", icon: "🐔", color: "#FFD700", ordre: 3,
                sousCategories: {
                    POULET:           { label: "Poulet",            icon: "🐔", ordre: 1, unite: "pcs", produits: ["Poulet en gros","Poulet en détail","Poulet"] },
                    POULETS_DECOUPES: { label: "Poulets découpés",  icon: "🐔", ordre: 2, unite: "kg",  produits: ["Poulets découpés","Poulet découpé"] },
                    CUISSE_POULET:    { label: "Cuisse de poulet",  icon: "🍗", ordre: 3, unite: "kg",  produits: ["Cuisse de poulet","Cuisses de poulet"] },
                    AILES_POULET:     { label: "Ailes de poulet",   icon: "🍗", ordre: 4, unite: "kg",  produits: ["Ailes de poulet","Aile de poulet"] },
                    BLANC_POULET:     { label: "Blanc de poulet",   icon: "🍗", ordre: 5, unite: "kg",  produits: ["Blanc de poulet","Blancs de poulet"] },
                    HAUT_POULET:      { label: "Haut de poulet",    icon: "🍗", ordre: 6, unite: "kg",  produits: ["Haut de poulet","Hauts de poulet"] }
                }
            },
            POISSON: {
                label: "Poisson", icon: "🐟", color: "#4682B4", ordre: 4,
                sousCategories: {
                    DORADE:    { label: "Dorade",    icon: "🐟", ordre: 1, unite: "kg", produits: ["Dorade"] },
                    SEUD:      { label: "Seud",      icon: "🐟", ordre: 2, unite: "kg", produits: ["Seud (barracuda)","Seud"] },
                    CREVETTES: { label: "Crevettes", icon: "🐟", ordre: 3, unite: "kg", produits: ["Crevettes"] },
                    BEURRE:    { label: "Beurre",    icon: "🐟", ordre: 4, unite: "kg", produits: ["Beurre"] }
                }
            }
        };

        // Construire l'ensemble des produits déjà couverts (normalisés)
        const normalize = s => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const knownProducts = new Set();
        for (const superCat of Object.values(baseCategories)) {
            for (const sousCat of Object.values(superCat.sousCategories)) {
                for (const p of sousCat.produits) {
                    if (p !== '*') knownProducts.add(normalize(p));
                }
            }
        }

        // Charger les produits dynamiques depuis la BDD (type inventaire = produits OCR/superette)
        const { Produit } = require('./db/models');
        let dynamicOrderBase = 10;
        const dynamicCategories = {};

        try {
            const dbProduits = await Produit.findAll({
                where: { type_catalogue: 'inventaire' },
                order: [['nom', 'ASC']]
            });

            for (const produit of dbProduits) {
                if (knownProducts.has(normalize(produit.nom))) continue; // déjà couvert

                const rawCatName = produit.categorie_affichage || 'Superette';
                const catName = rawCatName === 'Import OCR' ? 'Superette' : rawCatName;
                const catKey = 'DYN_' + catName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
                const unite = produit.unite_stock === 'kilo' ? 'kg' : 'pcs';

                if (!dynamicCategories[catKey]) {
                    dynamicCategories[catKey] = {
                        label: catName,
                        icon: "🛒",
                        color: "#5C6BC0",
                        ordre: dynamicOrderBase++,
                        sousCategories: {}
                    };
                }

                // Regrouper par unite dans la même super-catégorie
                const sousCatKey = catKey + (unite === 'kg' ? '_KG' : '_PCS');
                if (!dynamicCategories[catKey].sousCategories[sousCatKey]) {
                    dynamicCategories[catKey].sousCategories[sousCatKey] = {
                        label: catName,
                        icon: "📦",
                        ordre: 1,
                        unite: unite,
                        produits: []
                    };
                }
                dynamicCategories[catKey].sousCategories[sousCatKey].produits.push(produit.nom);
                knownProducts.add(normalize(produit.nom));
            }
        } catch (dbErr) {
            console.warn('⚠️ Impossible de charger les produits dynamiques depuis la BDD:', dbErr.message);
        }

        const config = {
            version: "1.1",
            lastUpdate: new Date().toISOString().split('T')[0],
            description: "Configuration inventaire - catégories fixes + produits OCR/superette BDD",
            categories: {
                ...baseCategories,
                ...dynamicCategories,
                AUTRE: {
                    label: "Autres Produits", icon: "📦", color: "#808080", ordre: 99,
                    sousCategories: {
                        DIVERS: {
                            label: "Divers", icon: "📦", ordre: 1, unite: "divers",
                            produits: ["*"],
                            note: "Attrape tous les produits non mappés - unité à vérifier manuellement"
                        }
                    }
                }
            },
            unites: {
                kg:     { label: "Kilogrammes", symbole: "kg" },
                pcs:    { label: "Unités",      symbole: "pcs" },
                divers: { label: "Divers",      symbole: "divers" }
            },
            seuils: {
                stock_faible: 0.2,
                stock_moyen:  0.5,
                stock_bon:    1.0,
                description:  "Seuils en pourcentage du stock initial pour les alertes"
            }
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.json(config);
    } catch (error) {
        console.error('❌ Erreur génération inventaire-config.json:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/points-vente', async (req, res) => {
    try {
        const pointsVenteData = await configService.getPointsVenteAsLegacy();
        // ?format=full retourne l'objet complet { nom: { active, payment_ref } } (utilisé par pos.js)
        // Sans paramètre : retourne le tableau des noms actifs (utilisé par script.js / redirect)
        if (req.query.format === 'full') {
            return res.json(pointsVenteData);
        }
        const activePointsVente = Object.entries(pointsVenteData)
            .filter(([_, properties]) => properties.active)
            .map(([name, _]) => name);
        res.json(activePointsVente);
    } catch (error) {
        console.error("Erreur lors de la lecture des points de vente :", error);
        res.status(500).json({ success: false, message: "Erreur serveur" });
    }
});





// Route pour obtenir les produits depuis la base de données
app.get('/api/produits', async (req, res) => {
    try {
        const { type } = req.query; // 'vente', 'abonnement', ou 'inventaire'
        const typeCatalogue = type || 'vente';
        const produitsData = await configService.getProduitsAsLegacy(typeCatalogue);
        res.json(produitsData);
    } catch (error) {
        console.error("Erreur lors de la lecture des produits :", error);
        res.status(500).json({ success: false, message: "Erreur serveur" });
    }
});

// Route pour obtenir les produits inventaire
app.get('/api/produits-inventaire', async (req, res) => {
    try {
        const produitsData = await configService.getProduitsAsLegacy('inventaire');
        res.json(produitsData);
    } catch (error) {
        console.error("Erreur lors de la lecture des produits inventaire :", error);
        res.status(500).json({ success: false, message: "Erreur serveur" });
    }
});

// Route pour obtenir les produits abonnement
app.get('/api/produits-abonnement', async (req, res) => {
    try {
        const produitsData = await configService.getProduitsAsLegacy('abonnement');
        res.json(produitsData);
    } catch (error) {
        console.error("Erreur lors de la lecture des produits abonnement :", error);
        res.status(500).json({ success: false, message: "Erreur serveur" });
    }
});

// Route pour obtenir tous les points de vente (physiques + virtuels) pour les transferts
app.get('/api/points-vente/transferts', async (req, res) => {
    try {
        // Récupérer les points de vente depuis la base de données
        const pointsVenteData = await configService.getPointsVenteAsLegacy();
        const activePointsVente = Object.entries(pointsVenteData)
            .filter(([_, properties]) => properties.active)
            .map(([name, _]) => name);
        
        // Retourner seulement les points de vente définis dans la BDD
        res.json(activePointsVente);
    } catch (error) {
        console.error("Erreur lors de la lecture des points de vente pour transferts :", error);
        res.status(500).json({ success: false, message: "Erreur serveur" });
    }
});

// Importer les middlewares d'authentification
const { 
    checkAuth, 
    checkAdmin, 
    checkSuperAdmin, 
    checkReadAccess, 
    checkWriteAccess,
    checkSupervisorAccess,
    checkAdvancedAccess,
    checkCopyStockAccess,
    checkEstimationAccess,
    checkReconciliationAccess,
    checkStatutLivraisonAccess
} = require('./middlewares/auth');

// Importer les middlewares de modules
const {
    checkModuleActive,
    requireModule,
    checkStockModule,
    checkReconciliationModule,
    checkAuditModule,
    checkCashPaiementModule,
    checkSuiviAchatBoeufModule,
    checkEstimationModule,
    checkPrecommandeModule,
    checkPaymentLinksModule,
    checkAbonnementsModule
} = require('./middlewares/modules');

// Importer la configuration des modules
const modulesConfig = require('./config/modules-config');

// Importer la configuration du client
const clientConfig = require('./config/client-config');

// Importer les routes
const paymentsGeneratedRouter = require('./routes/payments-generated');
const modulesRouter = require('./routes/modules');
const configAdminRouter = require('./routes/config-admin');
// SUPPRIMÉ - Stock unifié dans les fichiers JSON
// const stockAutoRouter = require('./routes/stock-auto');

// Routes des paiements générés
app.use('/api/payments/generated', paymentsGeneratedRouter);

// Routes d'administration de la configuration (produits, catégories, prix)
app.use('/api/admin/config', configAdminRouter);

// Routes pour la gestion du stock automatique
// SUPPRIMÉ - Stock unifié dans les fichiers JSON
// app.use('/api/stock-auto', stockAutoRouter);

// Route pour obtenir la liste des points de vente avec ID (admin seulement) - depuis BDD
app.get('/api/admin/points-vente', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { PointVente } = require('./db/models');
        const pointsVenteList = await PointVente.findAll({ order: [['nom', 'ASC']] });
        
        // Formater pour le frontend
        const result = {};
        for (const pv of pointsVenteList) {
            result[pv.nom] = { 
                id: pv.id,
                active: pv.active, 
                payment_ref: pv.payment_ref 
            };
        }
        
        res.json({ success: true, pointsVente: result });
    } catch (error) {
        console.error('Erreur lors de la récupération des points de vente:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Route pour mettre à jour un point de vente (admin seulement)
app.put('/api/admin/points-vente/:id', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nom, active, payment_ref } = req.body;
        
        const { PointVente } = require('./db/models');
        const pointVente = await PointVente.findByPk(id);
        
        if (!pointVente) {
            return res.status(404).json({ success: false, error: 'Point de vente non trouvé' });
        }
        
        await pointVente.update({ 
            nom, 
            active,
            payment_ref: payment_ref ? payment_ref.trim().toUpperCase() : null
        });
        
        // Invalider le cache
        const configService = require('./db/config-service');
        configService.invalidateCache();
        
        res.json({ success: true, data: pointVente });
    } catch (error) {
        console.error('Erreur mise à jour point de vente:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =================== ROUTES CONFIGURATION CLIENT ===================
// GET /api/client-config - Obtenir la configuration du client (public)
app.get('/api/client-config', (req, res) => {
    try {
        const config = clientConfig.getClientConfig();
        res.json({ success: true, config });
    } catch (error) {
        console.error('Erreur lors de la récupération de la configuration client:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// PUT /api/client-config - Mettre à jour la configuration du client (admin seulement)
app.put('/api/client-config', checkAuth, checkAdmin, (req, res) => {
    try {
        const updates = req.body;
        const newConfig = clientConfig.updateClientConfig(updates);
        res.json({ success: true, config: newConfig, message: 'Configuration mise à jour' });
    } catch (error) {
        console.error('Erreur lors de la mise à jour de la configuration client:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

console.log('✅ Routes de configuration client chargées');

// Routes de gestion des modules
// GET /api/modules - Liste tous les modules (public, pour le frontend)
// GET /api/modules/status - État simplifié des modules
// GET /api/modules/active - Modules actifs uniquement
// POST /api/modules/:moduleId/activate - Activer un module (admin)
// POST /api/modules/:moduleId/deactivate - Désactiver un module (admin)
// POST /api/modules/:moduleId/toggle - Basculer l'état d'un module (admin)
app.use('/api/modules', (req, res, next) => {
    // Les routes GET sont publiques (nécessaires pour le frontend)
    if (req.method === 'GET') {
        return next();
    }
    // Les routes POST/PUT/DELETE nécessitent d'être admin
    checkAuth(req, res, () => {
        checkAdmin(req, res, next);
    });
}, modulesRouter);

console.log('✅ Routes de gestion des modules chargées');

// Route pour gérer les points de vente (admin seulement)
app.post('/api/admin/points-vente', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { nom, action } = req.body;
        const { PointVente } = require('./db/models');
        
        if (action === 'add') {
            // Ajouter un nouveau point de vente dans la BDD
            if (!nom || nom.trim() === '') {
                return res.status(400).json({ success: false, message: 'Le nom du point de vente est requis' });
            }
            
            const existing = await PointVente.findOne({ where: { nom: nom.trim() } });
            if (existing) {
                return res.status(400).json({ success: false, message: 'Ce point de vente existe déjà' });
            }
            
            await PointVente.create({ nom: nom.trim(), active: true });
            
        } else if (action === 'toggle') {
            // Activer/désactiver un point de vente
            const pv = await PointVente.findOne({ where: { nom } });
            if (!pv) {
                return res.status(400).json({ success: false, message: 'Point de vente non trouvé' });
            }
            
            await pv.update({ active: !pv.active });
            
        } else if (action === 'delete') {
            // Supprimer un point de vente
            const pv = await PointVente.findOne({ where: { nom } });
            if (!pv) {
                return res.status(400).json({ success: false, message: 'Point de vente non trouvé' });
            }
            
            await pv.destroy();
        }
        
        // Invalider le cache et mettre à jour les variables globales
        configService.invalidateCache();
        pointsVente = await configService.getPointsVenteAsLegacy();
        global.pointsVente = pointsVente;
        
        res.json({ success: true, message: 'Point de vente mis à jour avec succès' });
        
    } catch (error) {
        console.error('Erreur lors de la gestion des points de vente:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Route pour recharger la configuration des produits (admin seulement)
app.post('/api/admin/reload-products', checkAuth, checkAdmin, (req, res) => {
    try {
        const result = reloadProduitsConfig();
        if (result.success) {
            // Update the local variables as well
            produits = global.produits;
            produitsInventaire = global.produitsInventaire;
            pointsVente = global.pointsVente;
        }
        res.json(result);
    } catch (error) {
        console.error('Error in reload products endpoint:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur lors du rechargement' });
    }
});

// Middleware pour vérifier les permissions admin strictes (effacement des données)
const checkStrictAdminOnly = (req, res, next) => {
    const userRole = req.session.user.role;
    
    if (userRole === 'admin') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Accès refusé. Permissions administrateur strictes requises.'
        });
    }
};

// Fonction utilitaire pour charger le mapping des références de paiement depuis la BDD
const getPaymentRefMapping = async () => {
    const { PointVente } = require('./db/models');
    const { Op } = require('sequelize');
    const pvList = await PointVente.findAll({ 
        where: { active: true, payment_ref: { [Op.ne]: null } } 
    });
    const mapping = {};
    for (const pv of pvList) {
        if (pv.payment_ref) {
            mapping[pv.payment_ref] = pv.nom;
        }
    }
    return mapping;
};

// Middleware d'authentification par API key pour services externes comme Relevance AI
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.EXTERNAL_API_KEY || 'your-secure-api-key-for-relevance';
    
    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ 
            success: false, 
            message: 'API key invalide ou manquante' 
        });
    }
    
    req.user = {
        username: 'api-client',
        role: 'api',
        pointVente: 'tous'
    };
    
    next();
};

// Accepte soit une session active (POS interne), soit une API key valide (clients externes)
const validateApiKeyOrSession = (req, res, next) => {
    // Session active → autorisé directement
    if (req.session && req.session.user) {
        req.user = req.session.user;
        return next();
    }
    // Sinon, vérifier l'API key
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.EXTERNAL_API_KEY || 'your-secure-api-key-for-relevance';
    if (apiKey && apiKey === validApiKey) {
        req.user = { username: 'api-client', role: 'api', pointVente: 'tous' };
        return next();
    }
    return res.status(401).json({ success: false, message: 'Authentification requise' });
};



// Chemin du fichier CSV
const csvFilePath = path.join(__dirname, 'ventes.csv');

// Créer le fichier CSV avec les en-têtes seulement s'il n'existe pas
if (!fs.existsSync(csvFilePath)) {
    const headers = 'ID;Mois;Date;Semaine;Point de Vente;Preparation;Catégorie;Produit;PU;Nombre;Montant;Nom Client;Numéro Client;Tél. Client;Adresse Client;Créance\n'; // Updated headers
    fs.writeFileSync(csvFilePath, headers);
}

// Chemin du fichier CSV pour le stock
const stockCsvPath = path.join(__dirname, 'stock.csv');

// Créer le fichier CSV de stock s'il n'existe pas
if (!fs.existsSync(stockCsvPath)) {
    const headers = 'Date;Type Stock;Point de Vente;Produit;Quantité;Prix Unitaire;Total;Commentaire\n';
    fs.writeFileSync(stockCsvPath, headers);
}

// Chemins des fichiers JSON pour le stock
const STOCK_MATIN_PATH = path.join(__dirname, 'data', 'stock-matin.json');
const STOCK_SOIR_PATH = path.join(__dirname, 'data', 'stock-soir.json');
const TRANSFERTS_PATH = path.join(__dirname, 'data', 'transferts.json');

// Fonction pour récupérer le mappage des références de paiement depuis la BDD
const getPaymentRefToPdv = async () => {
    const { PointVente } = require('./db/models');
    const { Op } = require('sequelize');
    const pvList = await PointVente.findAll({ 
        where: { payment_ref: { [Op.ne]: null } } 
    });
    const mapping = {};
    for (const pv of pvList) {
        if (pv.payment_ref) {
            mapping[pv.payment_ref] = pv.nom;
        }
    }
    return mapping;
};

// Fonction pour obtenir le chemin du fichier en fonction de la date
function getPathByDate(baseFile, date) {
    // Vérifier si une date est fournie
    if (!date) {
        return baseFile; // Retourne le chemin par défaut si pas de date
    }
    
    // Convertir la date au format YYYY-MM-DD pour le système de fichiers
    let formattedDate;
    if (date.includes('/')) {
        // Format DD/MM/YYYY
        const [day, month, year] = date.split('/');
        formattedDate = `${year}-${month}-${day}`;
    } else if (date.includes('-')) {
        const parts = date.split('-');
        if (parts[0].length === 4) {
            // Format YYYY-MM-DD (déjà correct)
            formattedDate = date;
        } else {
            // Format DD-MM-YY ou DD-MM-YYYY
            const [day, month, year] = parts;
            // Convertir l'année à 2 chiffres en 4 chiffres
            const fullYear = year.length === 2 ? `20${year}` : year;
            formattedDate = `${fullYear}-${month}-${day}`;
        }
    } else {
        // Format non reconnu, utiliser la date telle quelle
        formattedDate = date;
    }
    
    console.log(`getPathByDate: date=${date}, formattedDate=${formattedDate}`);
    
    // Extraire le répertoire et le nom de fichier de base
    const dir = path.dirname(baseFile);
    const fileName = path.basename(baseFile);
    
    // Créer le chemin pour la date spécifique
    const dateDir = path.join(dir, 'by-date', formattedDate);
    
    console.log(`getPathByDate: dateDir=${dateDir}, exists=${fs.existsSync(dateDir)}`);
    
    // S'assurer que le répertoire existe
    if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
    }
    
    const finalPath = path.join(dateDir, fileName);
    console.log(`getPathByDate: finalPath=${finalPath}, exists=${fs.existsSync(finalPath)}`);
    
    return finalPath;
}

// Fonction pour standardiser une date au format ISO (YYYY-MM-DD)
function standardiserDateFormat(dateStr) {
    if (!dateStr) return '';
    
    let jour, mois, annee;
    
    // Essayer de parser différents formats
    if (dateStr.includes('/')) {
        // Format DD/MM/YYYY ou DD/MM/YY
        [jour, mois, annee] = dateStr.split('/');
    } else if (dateStr.includes('-')) {
        // Format DD-MM-YYYY, YYYY-MM-DD, ou DD-MM-YY
        const parts = dateStr.split('-');
        if (parts[0].length === 4) {
            // Format YYYY-MM-DD (déjà au bon format)
            return dateStr;
        } else {
            // Format DD-MM-YYYY ou DD-MM-YY
            [jour, mois, annee] = parts;
        }
    } else {
        console.warn('Format de date non reconnu:', dateStr);
        return dateStr; // Format non reconnu, retourner tel quel
    }
    
    // S'assurer que jour et mois sont bien définis et ont 2 chiffres
    jour = jour ? jour.padStart(2, '0') : '01';
    mois = mois ? mois.padStart(2, '0') : '01';
    
    // Convertir l'année à 4 chiffres si elle est à 2 chiffres
    if (annee && annee.length === 2) {
        annee = '20' + annee;
    } else if (!annee) {
        annee = new Date().getFullYear().toString(); // Année actuelle par défaut
    }
    
    // Vérifier la validité des composants
    if (isNaN(parseInt(jour)) || isNaN(parseInt(mois)) || isNaN(parseInt(annee))) {
        console.error('Composants de date invalides après parsing:', {jour, mois, annee});
        return dateStr; // Retourner l'original si invalide
    }

    // Validation supplémentaire des valeurs
    const jourNum = parseInt(jour);
    const moisNum = parseInt(mois);
    const anneeNum = parseInt(annee);
    
    if (jourNum < 1 || jourNum > 31 || moisNum < 1 || moisNum > 12 || anneeNum < 1900 || anneeNum > 2100) {
        console.error('Date invalide:', {jour, mois, annee});
        return dateStr; // Retourner l'original si invalide
    }

    // Retourner la date au format ISO (YYYY-MM-DD) - universellement accepté par PostgreSQL
    return `${annee}-${mois}-${jour}`;
}

// Route pour la connexion
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Tentative de connexion reçue:', { username, password: '***' });
    
    try {
        const user = await users.verifyCredentials(username, password);
        if (!user) {
            console.log('Échec de l\'authentification pour:', username);
            return res.status(401).json({ success: false, message: 'Identifiants invalides' });
        }

        console.log('Authentification réussie pour:', username);
        
        // Créer l'objet utilisateur formaté avec les permissions
        // Rôles existants: lecteur, user, superutilisateur, superviseur, admin
        const formattedUser = {
            username: user.username,
            role: user.role,
            pointVente: user.pointVente,
            isAdmin: user.role === 'admin',
            isLecteur: user.role === 'lecteur',
            isSupervisor: ['superutilisateur', 'superviseur'].includes(user.role),
            canRead: ['lecteur', 'user', 'admin', 'superutilisateur', 'superviseur'].includes(user.role),
            canWrite: ['user', 'admin', 'superutilisateur', 'superviseur'].includes(user.role),
            canManageReconciliation: ['admin', 'superutilisateur', 'superviseur'].includes(user.role),
            canAccessAllPointsVente: ['admin', 'superutilisateur', 'superviseur'].includes(user.role),
            canCopyStock: ['admin', 'superutilisateur', 'superviseur'].includes(user.role),
            canManageAdvanced: ['admin', 'superutilisateur', 'superviseur'].includes(user.role),
            canManageEstimation: ['admin', 'superutilisateur', 'superviseur'].includes(user.role)
        };
        
        // Stocker l'utilisateur formaté dans la session
        req.session.user = formattedUser;
        
        res.json({ 
            success: true, 
            user: formattedUser
        });
    } catch (error) {
        console.error('Erreur de connexion:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la connexion' });
    }
});

// Route pour la déconnexion
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Erreur lors de la déconnexion:', err);
            return res.status(500).json({ success: false, message: 'Erreur lors de la déconnexion' });
        }
        res.json({ success: true });
    });
});

// Route pour vérifier la session
app.get('/api/check-session', (req, res) => {
    console.log('Vérification de la session');
    console.log('Session actuelle:', req.session);
    
    if (req.session.user) {
        const user = req.session.user;
        
        // S'assurer que les permissions sont définies (compatibilité avec anciennes sessions)
        // Rôles existants: lecteur, user, superutilisateur, superviseur, admin
        if (user.canRead === undefined || user.canAccessAllPointsVente === undefined) {
            user.canRead = ['lecteur', 'user', 'admin', 'superutilisateur', 'superviseur'].includes(user.role);
            user.canWrite = ['user', 'admin', 'superutilisateur', 'superviseur'].includes(user.role);
            user.isAdmin = user.role === 'admin';
            user.isSupervisor = ['superutilisateur', 'superviseur'].includes(user.role);
            user.canManageReconciliation = ['admin', 'superutilisateur', 'superviseur'].includes(user.role);
            user.canAccessAllPointsVente = ['admin', 'superutilisateur', 'superviseur'].includes(user.role);
            user.canCopyStock = ['admin', 'superutilisateur', 'superviseur'].includes(user.role);
            user.canManageAdvanced = ['admin', 'superutilisateur', 'superviseur'].includes(user.role);
            user.canManageEstimation = ['admin', 'superutilisateur', 'superviseur'].includes(user.role);
            req.session.user = user; // Mettre à jour la session
        }
        
        res.json({
            success: true,
            user: user
        });
    } else {
        res.json({ success: false });
    }
});

// Route pour vérifier la connexion à la base de données
app.get('/api/check-db-connection', async (req, res) => {
    try {
        console.log('Vérification de la connexion à la base de données...');
        const connected = await testConnection();
        if (connected) {
            res.json({ 
                success: true, 
                message: 'Connexion à la base de données PostgreSQL établie avec succès' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Échec de la connexion à la base de données PostgreSQL' 
            });
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de la connexion:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la vérification de la connexion à la base de données',
            error: error.message
        });
    }
});

// Route pour vérifier la santé de l'application
app.get('/api/check-health', (req, res) => {
    res.json({ success: true, message: 'Application en cours d\'exécution' });
});

// Routes pour l'administration (Note: /api/admin/points-vente est défini plus haut)

app.post('/api/admin/prix', checkAuth, checkSuperAdmin, (req, res) => {
    const { categorie, produit, nouveauPrix } = req.body;
    
    if (!produits[categorie] || !produits[categorie][produit]) {
        return res.status(400).json({ success: false, message: 'Produit non trouvé' });
    }
    
    produits[categorie][produit] = nouveauPrix;
    res.json({ success: true, produits });
});

app.post('/api/admin/corriger-total', checkAuth, checkSuperAdmin, (req, res) => {
    const { date, pointVente, categorie, produit, nouveauTotal } = req.body;
    
    // Lire le fichier CSV
    const ventes = fs.readFileSync(csvFilePath, 'utf-8').split('\n');
    
    // Trouver et modifier la ligne correspondante
    const ligneIndex = ventes.findIndex(ligne => {
        const [ligneDate, lignePointVente, ligneCategorie, ligneProduit] = ligne.split(',');
        return ligneDate === date && 
               lignePointVente === pointVente && 
               ligneCategorie === categorie && 
               ligneProduit === produit;
    });
    
    if (ligneIndex === -1) {
        return res.status(400).json({ success: false, message: 'Vente non trouvée' });
    }
    
    const colonnes = ventes[ligneIndex].split(',');
    colonnes[4] = nouveauTotal; // Le total est dans la 5ème colonne
    ventes[ligneIndex] = colonnes.join(',');
    
    // Écrire le fichier CSV mis à jour
    fs.writeFileSync(csvFilePath, ventes.join('\n'));
    
    res.json({ success: true });
});

// ==== ROUTES DE CONFIGURATION DES PRODUITS (ADMIN UNIQUEMENT) - via BDD ====
// Note: Les routes /api/admin/points-vente et /api/admin/produits sont gérées par configAdminRouter

// Fonction utilitaire pour filtrer les fonctions d'un objet (pour JSON)
function filterFunctions(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = {};
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] !== 'function') {
            if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                result[key] = filterFunctions(obj[key]);
            } else {
                result[key] = obj[key];
            }
        }
    }
    return result;
}

// Route pour lire la configuration des produits (depuis la BDD)
app.get('/api/admin/config/produits', checkAuth, checkAdmin, async (req, res) => {
    try {
        console.log('📋 GET /api/admin/config/produits - Chargement depuis BDD...');
        
        // Charger depuis la BDD
        const { Produit, Category, PrixPointVente, PointVente } = require('./db/models');
        
        const dbProduits = await Produit.findAll({
            where: { type_catalogue: 'vente' },
            include: [
                { model: Category, as: 'categorie' },
                { 
                    model: PrixPointVente, 
                    as: 'prixParPointVente',
                    include: [{ model: PointVente, as: 'pointVente' }]
                }
            ]
        });
        
        console.log('📋 Produits trouvés dans BDD:', dbProduits.length);
        
        // Construire l'objet de réponse
        const produitsResult = {};
        
        for (const produit of dbProduits) {
            const categorieName = produit.categorie ? produit.categorie.nom : 'Autres';
            
            if (!produitsResult[categorieName]) {
                produitsResult[categorieName] = {};
            }
            
            const config = {
                default: parseFloat(produit.prix_defaut) || 0,
                alternatives: produit.prix_alternatifs ? produit.prix_alternatifs.map(p => parseFloat(p)) : []
            };
            
            // Ajouter les prix par point de vente
            if (produit.prixParPointVente) {
                for (const prix of produit.prixParPointVente) {
                    if (prix.pointVente) {
                        config[prix.pointVente.nom] = parseFloat(prix.prix);
                    }
                }
            }
            
            produitsResult[categorieName][produit.nom] = config;
        }
        
        console.log('📋 Catégories:', Object.keys(produitsResult));
        res.json({ success: true, produits: produitsResult });
    } catch (error) {
        console.error('❌ Erreur lors de la lecture des produits:', error);
        res.status(500).json({ success: false, message: error.message, produits: {} });
    }
});

// NOTE: Les routes /api/admin/config/produits-inventaire et /api/admin/config/produits-abonnement
// sont définies dans routes/config-admin.js avec gestion complète (mode_stock, unite_stock, categorie_affichage)

// Routes pour la gestion des utilisateurs
// Obtenir tous les utilisateurs
app.get('/api/admin/users', checkAuth, checkAdmin, async (req, res) => {
    try {
        const usersList = await users.getAllUsers();
        res.json({ success: true, users: usersList });
    } catch (error) {
        console.error('Erreur lors de la récupération des utilisateurs:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la récupération des utilisateurs' });
    }
});

// Créer un nouvel utilisateur
app.post('/api/admin/users', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { username, password, role, pointVente, active } = req.body;
        
        if (!username || !password || !role || !pointVente || (Array.isArray(pointVente) && pointVente.length === 0)) {
            return res.status(400).json({ success: false, message: 'Tous les champs sont obligatoires' });
        }
        
        // Vérifier que le nom d'utilisateur n'existe pas déjà
        const existingUsers = await users.getAllUsers();
        if (existingUsers.some(u => u.username === username)) {
            return res.status(400).json({ success: false, message: 'Ce nom d\'utilisateur existe déjà' });
        }
        
        const newUser = await users.createUser(username, password, role, pointVente, active);
        res.json({ success: true, user: { username: newUser.username, role: newUser.role, pointVente: newUser.pointVente, active: newUser.active } });
    } catch (error) {
        console.error('Erreur lors de la création de l\'utilisateur:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Activer/désactiver un utilisateur
app.post('/api/admin/users/:username/toggle-status', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        
        // Empêcher la désactivation de l'utilisateur ADMIN
        if (username === 'ADMIN') {
            return res.status(400).json({ success: false, message: 'Impossible de modifier le statut de l\'administrateur principal' });
        }
        
        const updatedUser = await users.toggleUserStatus(username);
        res.json({ success: true, user: { username: updatedUser.username, role: updatedUser.role, pointVente: updatedUser.pointVente, active: updatedUser.active } });
    } catch (error) {
        console.error('Erreur lors de la modification du statut:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Supprimer un utilisateur
app.delete('/api/admin/users/:username', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        
        // Empêcher la suppression de l'utilisateur ADMIN
        if (username === 'ADMIN') {
            return res.status(400).json({ success: false, message: 'Impossible de supprimer l\'administrateur principal' });
        }
        
        await users.deleteUser(username);
        res.json({ success: true, message: 'Utilisateur supprimé avec succès' });
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Modifier un utilisateur
app.put('/api/admin/users/:username', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const { username: newUsername, password, role, pointVente, active } = req.body;
        
        // Empêcher la modification de l'utilisateur ADMIN
        if (username === 'ADMIN') {
            return res.status(400).json({ success: false, message: 'Impossible de modifier l\'administrateur principal' });
        }
        
        if (!newUsername || !role || !pointVente) {
            return res.status(400).json({ success: false, message: 'Tous les champs sont obligatoires' });
        }
        
        // Vérifier que le nouveau nom d'utilisateur n'existe pas déjà (sauf pour l'utilisateur actuel)
        const existingUsers = await users.getAllUsers();
        if (newUsername !== username && existingUsers.some(u => u.username === newUsername)) {
            return res.status(400).json({ success: false, message: 'Ce nom d\'utilisateur existe déjà' });
        }
        
        const updates = {
            username: newUsername,
            role,
            pointVente,
            active
        };
        
        // Ajouter le mot de passe seulement s'il est fourni
        if (password && password.trim() !== '') {
            updates.password = password;
        }
        
        await users.updateUser(username, updates);
        res.json({ success: true, message: 'Utilisateur modifié avec succès' });
    } catch (error) {
        console.error('Erreur lors de la modification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Route pour ajouter des ventes
app.post('/api/ventes', checkAuth, checkWriteAccess, async (req, res) => {

    // Gérer les deux cas: objet unique ou tableau
    let entries = req.body;
    if (!Array.isArray(entries)) {
        entries = [entries];
    }
    
    console.log('Tentative d\'ajout de ventes:', JSON.stringify(entries));
    
    // Fonction pour normaliser le nom du produit (première lettre majuscule)
    function normalizeProductName(name) {
        if (!name) return name;
        return name.trim()
            .toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
    
    // Vérifier les restrictions temporelles pour chaque vente
    for (const entry of entries) {
        const restriction = checkSaleTimeRestrictions(entry.date, req.session.user.username, req.session.user.role);
        if (!restriction.allowed) {
            return res.status(403).json({
                success: false,
                message: restriction.message,
                timeRestriction: true
            });
        }
    }
    
    // Vérifier si le point de vente est actif
    for (const entry of entries) {
        if (!pointsVente[entry.pointVente]?.active) {
            return res.status(400).json({ 
                success: false, 
                message: `Le point de vente ${entry.pointVente} est désactivé` 
            });
        }
    }
    
    try {
        const { Produit, Category } = require('./db/models');
        
        // Créer automatiquement les produits qui n'existent pas
        for (const entry of entries) {
            // Normaliser le nom du produit
            entry.produit = normalizeProductName(entry.produit);
            
            // Vérifier si le produit existe dans la BDD
            const produitNom = entry.produit;
            const categorieNom = entry.categorie || 'Import OCR';
            
            // Chercher ou créer la catégorie
            let category = await Category.findOne({ where: { nom: categorieNom } });
            if (!category) {
                category = await Category.create({ nom: categorieNom });
                console.log(`📁 Catégorie créée: ${categorieNom}`);
            }
            
            // Chercher le produit (type vente)
            let produitVente = await Produit.findOne({ 
                where: { nom: produitNom, type_catalogue: 'vente' } 
            });
            
            // Créer le produit de vente s'il n'existe pas
            if (!produitVente) {
                produitVente = await Produit.create({
                    nom: produitNom,
                    type_catalogue: 'vente',
                    prix_defaut: entry.prixUnit || 0,
                    prix_alternatifs: [],
                    categorie_id: category.id
                });
                console.log(`✅ Produit vente créé: ${produitNom} (catégorie: ${categorieNom})`);
                
                // Mettre à jour le cache des produits
                if (!produits[categorieNom]) {
                    produits[categorieNom] = {};
                }
                produits[categorieNom][produitNom] = {
                    default: entry.prixUnit || 0,
                    alternatives: []
                };
            }
            
            // Chercher le produit (type inventaire)
            let produitInventaire = await Produit.findOne({ 
                where: { nom: produitNom, type_catalogue: 'inventaire' } 
            });
            
            // Créer le produit d'inventaire s'il n'existe pas (mode automatique par défaut pour OCR)
            if (!produitInventaire) {
                // Déterminer l'unité selon les infos d'import
                let uniteStock = 'unite';
                if (entry.unite_import === 'kilo' || 
                    entry.preparation === 'Frais' || 
                    (entry.article_original && entry.article_original.toUpperCase().startsWith('KG'))) {
                    uniteStock = 'kilo';
                }
                
                // Déterminer le mode de stock (automatique par défaut, ou selon l'import)
                const modeStock = entry.mode_stock_import || 'automatique';
                
                produitInventaire = await Produit.create({
                    nom: produitNom,
                    type_catalogue: 'inventaire',
                    prix_defaut: entry.prixUnit || 0,
                    prix_alternatifs: [],
                    mode_stock: modeStock,  // Utiliser le mode spécifié ou automatique par défaut
                    unite_stock: uniteStock,
                    categorie_affichage: 'Import OCR'
                });
                console.log(`✅ Produit inventaire créé: ${produitNom} (mode: ${modeStock}, unité: ${uniteStock})`);
            }
            
            // Mettre à jour l'entrée avec la catégorie correcte
            entry.categorie = categorieNom;
        }
    
        // Préparer les données pour l'insertion
        const ventesToInsert = entries.map(entry => {
            // Standardiser la date au format dd-mm-yyyy
            const dateStandardisee = standardiserDateFormat(entry.date);
            
            // Convertir les valeurs numériques en nombre avec une précision fixe
            // Gérer les deux noms de champs (quantite/nombre, total/montant)
            const nombre = parseFloat(parseFloat(entry.nombre || entry.quantite || 0).toFixed(2)) || 0;
            const prixUnit = parseFloat(parseFloat(entry.prixUnit || 0).toFixed(2)) || 0;
            const montant = parseFloat(parseFloat(entry.montant || entry.total || 0).toFixed(2)) || 0;
            
            // DEBUG: Log creance value
            console.log(`[VENTE DEBUG] entry.creance = "${entry.creance}" (type: ${typeof entry.creance})`);
            
            // Convertir explicitement en boolean (gérer les strings "true"/"false")
            let creanceValue = false;
            if (typeof entry.creance === 'boolean') {
                creanceValue = entry.creance;
            } else if (typeof entry.creance === 'string') {
                creanceValue = entry.creance.toLowerCase() === 'true';
            }
            
            console.log(`[VENTE DEBUG] creanceValue final = ${creanceValue}`);
            
            const venteData = {
                mois: entry.mois,
                date: dateStandardisee,
                semaine: entry.semaine,
                pointVente: entry.pointVente,
                preparation: entry.preparation || entry.pointVente,
                categorie: entry.categorie,
                produit: entry.produit,
                prixUnit: prixUnit,
                nombre: nombre,
                montant: montant,
                nomClient: entry.nomClient || null,
                numeroClient: entry.numeroClient || null,
                adresseClient: entry.adresseClient || null,
                creance: creanceValue
            };
            
            // Ajouter les données d'abonnement si présentes
            if (entry.client_abonne_id) {
                venteData.client_abonne_id = entry.client_abonne_id;
                
                // Ajouter le prix normal et le rabais si fournis
                if (entry.prix_normal !== undefined) {
                    venteData.prix_normal = parseFloat(parseFloat(entry.prix_normal).toFixed(2));
                }
                if (entry.rabais_applique !== undefined) {
                    venteData.rabais_applique = parseFloat(parseFloat(entry.rabais_applique).toFixed(2));
                }
                
                console.log(`✅ Vente avec client abonné détectée: client_abonne_id=${entry.client_abonne_id}, rabais=${entry.rabais_applique}`);
            }
            
            // Ajouter l'extension (composition des packs) si présente
            if (entry.extension) {
                venteData.extension = entry.extension;
                console.log(`📦 Composition du pack enregistrée pour ${entry.produit}:`, entry.extension);
            }

            // Ajouter commande_id (regroupe les articles d'une même commande)
            if (entry.commandeId || entry.commande_id) {
                venteData.commandeId = entry.commandeId || entry.commande_id;
            }

            // Ajouter les infos client supplémentaires
            if (entry.instructionsClient) {
                venteData.instructionsClient = entry.instructionsClient;
            }
            if (entry.statutPreparation || entry.statut_preparation) {
                venteData.statutPreparation = entry.statutPreparation || entry.statut_preparation;
            }
            if (entry.livreurAssigne || entry.livreur_assigne) {
                venteData.livreurAssigne = entry.livreurAssigne || entry.livreur_assigne;
            }
            if (entry.montantRestantDu !== undefined || entry.montant_restant_du !== undefined) {
                venteData.montantRestantDu = parseFloat(entry.montantRestantDu ?? entry.montant_restant_du ?? 0);
            }
            
            return venteData;
        });
        
        console.log('Données préparées pour insertion:', JSON.stringify(ventesToInsert));
        
        // Insérer les ventes dans la base de données
        await Vente.bulkCreate(ventesToInsert);
        
        // =====================================================
        // MISE À JOUR STOCK SOIR POUR PRODUITS AUTO
        // Stock Soir = Stock Matin - Ventes
        // =====================================================
        try {
            const { Produit } = require('./db/models');
            
            for (const vente of ventesToInsert) {
                // Chercher si le produit existe et est en mode automatique
                const produit = await Produit.findOne({
                    where: { 
                        nom: vente.produit,
                        mode_stock: 'automatique'
                    }
                });
                
                if (produit) {
                    const dateVente = vente.date;
                    const dateFormatted = standardiserDateFormat(dateVente);
                    const pointVente = vente.pointVente;
                    const produitNom = vente.produit;
                    const quantiteVendue = parseFloat(vente.nombre) || 0;
                    
                    // Format PLAT: { "PointVente-Produit": { Nombre, PU, ... } }
                    const stockKey = `${pointVente}-${produitNom}`;
                    
                    // Charger Stock Matin
                    const stockMatinPath = getPathByDate(STOCK_MATIN_PATH, dateFormatted);
                    let stockMatin = {};
                    if (fs.existsSync(stockMatinPath)) {
                        stockMatin = JSON.parse(fs.readFileSync(stockMatinPath, 'utf8'));
                    }
                    
                    // Initialiser Stock Matin si le produit n'existe pas (avec 0)
                    if (!stockMatin[stockKey]) {
                        stockMatin[stockKey] = {
                            Nombre: 0,
                            PU: produit.prix_defaut || vente.prixUnit || 0,
                            Montant: 0,
                            Produit: produitNom,
                            "Point de Vente": pointVente,
                            mode: 'automatique'
                        };
                        // Sauvegarder Stock Matin
                        const dirPath = path.dirname(stockMatinPath);
                        if (!fs.existsSync(dirPath)) {
                            fs.mkdirSync(dirPath, { recursive: true });
                        }
                        fs.writeFileSync(stockMatinPath, JSON.stringify(stockMatin, null, 2));
                        console.log(`📦 Stock Matin initialisé: ${stockKey}: 0`);
                    }
                    
                    // Calculer Stock Soir = Stock Matin - Ventes totales du jour
                    const stockMatinData = stockMatin[stockKey] || {};
                    const stockMatinQte = parseFloat(stockMatinData.Nombre || stockMatinData.quantite || 0);
                    
                    // Calculer total des ventes du jour pour ce produit
                    const ventesJour = await Vente.findAll({
                        where: {
                            date: vente.date,
                            pointVente: pointVente,
                            produit: produitNom
                        }
                    });
                    
                    const totalVentes = ventesJour.reduce((sum, v) => sum + parseFloat(v.nombre || 0), 0);
                    const stockSoirQte = stockMatinQte - totalVentes;
                    const prixUnit = parseFloat(produit.prix_defaut || vente.prixUnit || 0);
                    
                    // Mettre à jour Stock Soir (format PLAT)
                    const stockSoirPath = getPathByDate(STOCK_SOIR_PATH, dateFormatted);
                    let stockSoir = {};
                    if (fs.existsSync(stockSoirPath)) {
                        stockSoir = JSON.parse(fs.readFileSync(stockSoirPath, 'utf8'));
                    }
                    
                    stockSoir[stockKey] = {
                        Nombre: stockSoirQte,
                        PU: prixUnit,
                        Montant: stockSoirQte * prixUnit,
                        Produit: produitNom,
                        "Point de Vente": pointVente,
                        mode: 'automatique'
                    };
                    
                    // Sauvegarder Stock Soir
                    const dirPath = path.dirname(stockSoirPath);
                    if (!fs.existsSync(dirPath)) {
                        fs.mkdirSync(dirPath, { recursive: true });
                    }
                    fs.writeFileSync(stockSoirPath, JSON.stringify(stockSoir, null, 2));
                    
                    console.log(`📦 Stock Soir mis à jour: ${stockKey}: ${stockMatinQte} - ${totalVentes} = ${stockSoirQte}`);
                }
            }
        } catch (stockError) {
            // Log l'erreur mais ne pas bloquer la vente
            console.error('⚠️ Erreur mise à jour stock (non bloquant):', stockError.message);
        }
        // =====================================================
        
        // Récupérer les 10 dernières ventes pour l'affichage
        const dernieresVentes = await Vente.findAll({
            order: [['createdAt', 'DESC']],
            limit: 10
        });
        
        // Formater les données pour la réponse
        const formattedVentes = dernieresVentes.map(vente => ({
            id: vente.id,
            Mois: vente.mois,
            Date: vente.date,
            Semaine: vente.semaine,
            'Point de Vente': vente.pointVente,
            Preparation: vente.preparation,
            Catégorie: vente.categorie,
            Produit: vente.produit,
            PU: vente.prixUnit,
            Nombre: vente.nombre,
            Montant: vente.montant,
            nomClient: vente.nomClient,
            numeroClient: vente.numeroClient,
            adresseClient: vente.adresseClient,
            creance: vente.creance
        }));
        
        res.json({ success: true, dernieresVentes: formattedVentes });
    } catch (error) {
        console.error('Erreur lors de l\'ajout des ventes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'ajout des ventes',
            error: error.message
        });
    }
});

// Route pour mettre à jour une vente
app.put('/api/ventes/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const venteId = req.params.id;
        const updatedVente = req.body;
        
        // Vérifier les restrictions temporelles pour la mise à jour
        const restriction = checkSaleTimeRestrictions(updatedVente.date, req.session.user.username, req.session.user.role);
        if (!restriction.allowed) {
            return res.status(403).json({
                success: false,
                message: restriction.message,
                timeRestriction: true
            });
        }
        
        // Vérifier si le point de vente est actif
        if (!pointsVente[updatedVente.pointVente]?.active) {
            return res.status(400).json({ 
                success: false, 
                message: `Le point de vente ${updatedVente.pointVente} est désactivé` 
            });
        }

        // Standardiser la date au format dd-mm-yyyy
        const dateStandardisee = standardiserDateFormat(updatedVente.date);
        
        // Rechercher la vente à mettre à jour
        const vente = await Vente.findByPk(venteId);
        
        if (!vente) {
            return res.status(404).json({ 
                success: false, 
                message: 'Vente non trouvée' 
            });
        }
        
        // Préparer les données de mise à jour
        const updateData = {
            mois: updatedVente.mois,
            date: dateStandardisee,
            semaine: updatedVente.semaine,
            pointVente: updatedVente.pointVente,
            preparation: updatedVente.preparation || updatedVente.pointVente,
            categorie: updatedVente.categorie,
            produit: updatedVente.produit,
            prixUnit: updatedVente.prixUnit,
            nombre: updatedVente.quantite,
            montant: updatedVente.total,
            nomClient: updatedVente.nomClient || null,
            numeroClient: updatedVente.numeroClient || null,
            adresseClient: updatedVente.adresseClient || null,
            creance: updatedVente.creance || false
        };
        
        // Ajouter l'extension si présente
        if (updatedVente.extension) {
            updateData.extension = updatedVente.extension;
            console.log(`📦 Mise à jour de la composition du pack pour ${updatedVente.produit}:`, updatedVente.extension);
        }
        
        // Mettre à jour la vente
        await vente.update(updateData);
        
        // Récupérer les 10 dernières ventes pour mise à jour de l'affichage
        const dernieresVentes = await Vente.findAll({
            order: [['createdAt', 'DESC']],
            limit: 10
        });
        
        // Formater les données pour la réponse
        const formattedVentes = dernieresVentes.map(v => ({
            id: v.id,
            Mois: v.mois,
            Date: v.date,
            Semaine: v.semaine,
            'Point de Vente': v.pointVente,
            Preparation: v.preparation,
            Catégorie: v.categorie,
            Produit: v.produit,
            PU: v.prixUnit,
            Nombre: v.nombre,
            Montant: v.montant,
            nomClient: v.nomClient,
            numeroClient: v.numeroClient,
            adresseClient: v.adresseClient,
            creance: v.creance
        }));

        res.json({ 
            success: true, 
            message: 'Vente mise à jour avec succès',
            dernieresVentes: formattedVentes
        });
    } catch (error) {
        console.error('Erreur lors de la mise à jour de la vente:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la mise à jour de la vente',
            error: error.message
        });
    }
});

// Route pour obtenir les ventes avec filtres
app.get('/api/ventes', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { dateDebut, dateFin, pointVente } = req.query;
        
        console.log('Paramètres reçus:', { dateDebut, dateFin, pointVente });
        
        // Préparer les conditions de filtrage
        const whereConditions = {};
        
        if (dateDebut || dateFin) {
            // Fonction pour convertir une date ISO (YYYY-MM-DD) en format DD-MM-YYYY
            const convertISOToAppFormat = (isoDate) => {
                const date = new Date(isoDate);
                const jour = date.getDate().toString().padStart(2, '0');
                const mois = (date.getMonth() + 1).toString().padStart(2, '0');
                const annee = date.getFullYear();
                return `${jour}-${mois}-${annee}`;
            };
            
            // Fonction pour comparer des dates (gère les formats DD-MM-YYYY et YYYY-MM-DD)
            const isDateInRange = (dateToCheck, startDate, endDate) => {
                // Convertir les dates au format comparable (YYYY-MM-DD)
                const convertToComparable = (dateStr) => {
                    if (!dateStr) return '';
                    
                    // Si la date est déjà au format YYYY-MM-DD, la retourner telle quelle
                    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        return dateStr;
                    }
                    
                    // Sinon, supposer le format DD-MM-YYYY
                    const [day, month, year] = dateStr.split('-');
                    return `${year}-${month}-${day}`;
                };
                
                const comparableDate = convertToComparable(dateToCheck);
                const comparableStart = startDate ? convertToComparable(startDate) : '';
                const comparableEnd = endDate ? convertToComparable(endDate) : '';
                
                let isInRange = true;
                
                if (comparableStart && comparableDate) {
                    isInRange = isInRange && (comparableDate >= comparableStart);
                }
                
                if (comparableEnd && comparableDate) {
                    isInRange = isInRange && (comparableDate <= comparableEnd);
                }
                
                return isInRange;
            };
            
            // Convertir les dates d'entrée au format de l'application (DD-MM-YYYY)
            const debutFormatted = dateDebut ? convertISOToAppFormat(dateDebut) : null;
            const finFormatted = dateFin ? convertISOToAppFormat(dateFin) : null;
            
            console.log('Dates converties:', { debutFormatted, finFormatted });
            
            // Récupérer toutes les ventes et filtrer manuellement pour les dates
            const whereConditionsDate = {};
            
            // Appliquer les restrictions d'accès utilisateur
            const userPointVente = req.session.user.pointVente;
            if (userPointVente !== "tous") {
                if (Array.isArray(userPointVente)) {
                    // Si le tableau contient "tous", pas de restriction
                    if (!userPointVente.includes("tous")) {
                        whereConditionsDate.pointVente = {
                            [Op.in]: userPointVente
                        };
                    }
                } else {
                    whereConditionsDate.pointVente = userPointVente;
                }
            }
            
            // Appliquer le filtre supplémentaire par point de vente si spécifié
            if (pointVente && pointVente !== 'tous') {
                // Si l'utilisateur a déjà des restrictions et demande un point spécifique
                if (whereConditionsDate.pointVente) {
                    // Vérifier que le point demandé est dans ses permissions
                    if (Array.isArray(userPointVente)) {
                        if (userPointVente.includes("tous") || userPointVente.includes(pointVente)) {
                            whereConditionsDate.pointVente = pointVente;
                        }
                        // Sinon, garder ses restrictions (il n'aura pas accès au point demandé)
                    } else if (userPointVente === pointVente) {
                        whereConditionsDate.pointVente = pointVente;
                    }
                    // Sinon, garder ses restrictions
                } else {
                    whereConditionsDate.pointVente = pointVente;
                }
            }
            
            const allVentes = await Vente.findAll({
                where: whereConditionsDate,
                order: [['date', 'DESC']]
            });
            
            // Filtrer les ventes selon la date
            const filteredVentes = allVentes.filter(vente => 
                isDateInRange(vente.date, debutFormatted, finFormatted)
            );
            
            console.log(`Nombre total de ventes récupérées: ${allVentes.length}`);
            console.log(`Nombre de ventes après filtrage par date: ${filteredVentes.length}`);
            
            // Log pour debug - afficher quelques exemples de dates trouvées
            if (filteredVentes.length > 0) {
                console.log('Exemples de ventes filtrées:');
                filteredVentes.slice(0, 5).forEach((vente, index) => {
                    console.log(`  ${index + 1}. Date: ${vente.date}, Point: ${vente.pointVente}, Montant: ${vente.montant}`);
                });
            }
            
            // Formater les données pour la réponse
            const formattedVentes = filteredVentes.map(vente => ({
                Mois: vente.mois,
                Date: vente.date,
                Semaine: vente.semaine,
                'Point de Vente': vente.pointVente,
                Preparation: vente.preparation,
                Catégorie: vente.categorie,
                Produit: vente.produit,
                PU: vente.prixUnit,
                Nombre: vente.nombre,
                Montant: vente.montant,
                nomClient: vente.nomClient,
                numeroClient: vente.numeroClient,
                adresseClient: vente.adresseClient,
                creance: vente.creance
            }));
            
            console.log('Nombre de ventes filtrées:', formattedVentes.length);
            
            return res.json({ success: true, ventes: formattedVentes });
        }
        
        // Si pas de filtrage par date, utiliser la méthode standard avec les conditions Sequelize
        
        // Gérer les restrictions selon le point de vente de l'utilisateur
        const userPointVente = req.session.user.pointVente;
        
        if (userPointVente !== "tous") {
            if (Array.isArray(userPointVente)) {
                // Utilisateur avec accès à plusieurs points de vente spécifiques
                whereConditions.pointVente = {
                    [Op.in]: userPointVente
                };
            } else {
                // Utilisateur avec accès à un seul point de vente
                whereConditions.pointVente = userPointVente;
            }
        } else if (pointVente && pointVente !== 'tous') {
            // Filtre spécifique demandé par l'utilisateur
            whereConditions.pointVente = pointVente;
        }
        
        // Récupérer les ventes depuis la base de données
        const ventes = await Vente.findAll({
            where: whereConditions,
            order: [['date', 'DESC']]
        });
        
        // Formater les données pour la réponse
        const formattedVentes = ventes.map(vente => ({
            Mois: vente.mois,
            Date: vente.date,
            Semaine: vente.semaine,
            'Point de Vente': vente.pointVente,
            Preparation: vente.preparation,
            Catégorie: vente.categorie,
            Produit: vente.produit,
            PU: vente.prixUnit,
            Nombre: vente.nombre,
            Montant: vente.montant,
            nomClient: vente.nomClient,
            numeroClient: vente.numeroClient,
            adresseClient: vente.adresseClient,
            creance: vente.creance
        }));
        
        console.log('Nombre de ventes filtrées:', formattedVentes.length);
        
        res.json({ success: true, ventes: formattedVentes });
    } catch (error) {
        console.error('Erreur lors de la récupération des ventes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des ventes',
            error: error.message
        });
    }
});

// Route pour récupérer les dernières ventes
app.get('/api/dernieres-ventes', checkAuth, checkReadAccess, async (req, res) => {
    try {
        // Récupérer toutes les ventes depuis la base de données
        const ventes = await Vente.findAll({
            order: [['createdAt', 'DESC']]
        });
        
        // Formater les données pour la réponse
        const formattedVentes = ventes.map(vente => ({
            id: vente.id,
            Mois: vente.mois,
            Date: vente.date,
            Semaine: vente.semaine,
            'Point de Vente': vente.pointVente,
            Preparation: vente.preparation,
            Catégorie: vente.categorie,
            Produit: vente.produit,
            PU: vente.prixUnit,
            Nombre: vente.nombre,
            Montant: vente.montant,
            nomClient: vente.nomClient,
            numeroClient: vente.numeroClient,
            adresseClient: vente.adresseClient,
            creance: vente.creance,
            extension: vente.extension
        }));
        
        res.json({ success: true, dernieresVentes: formattedVentes });
    } catch (error) {
        console.error('Erreur lors de la récupération des dernières ventes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des ventes',
            error: error.message
        });
    }
});

// Route pour la redirection après connexion
app.get('/redirect', async (req, res) => {
    console.log('Redirection demandée, session:', req.session);
    if (req.session.user) {
        if (req.session.user.username === 'ADMIN') {
            return res.sendFile(path.join(__dirname, 'user-management.html'));
        }
        if (req.session.user.isSuperAdmin) {
            return res.sendFile(path.join(__dirname, 'admin.html'));
        }

        // Lire default_screen depuis la BDD (pas la session, qui peut être ancienne)
        try {
            const allowedScreens = ['index.html', 'pos.html', 'Realtime.html', 'auditClient.html'];
            const dbUser = await User.findOne({ where: { username: req.session.user.username }, attributes: ['default_screen'] });
            const screen = dbUser && dbUser.default_screen;
            if (screen && allowedScreens.includes(screen)) {
                // Mettre à jour la session pour les prochains accès
                req.session.user.default_screen = screen;
                return res.sendFile(path.join(__dirname, screen));
            }
        } catch (e) {
            console.error('Erreur lecture default_screen:', e.message);
        }

        return res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        console.log('Pas de session utilisateur, redirection vers login');
        res.redirect('/login.html');
    }
});

// Mettre à jour l'écran par défaut d'un utilisateur
app.patch('/api/admin/users/:username/default-screen', checkAuth, checkAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const { default_screen } = req.body;

        if (username === 'ADMIN') {
            return res.status(400).json({ success: false, message: 'Impossible de modifier l\'administrateur principal' });
        }

        const allowedScreens = ['', 'index.html', 'pos.html', 'Realtime.html', 'auditClient.html'];
        if (!allowedScreens.includes(default_screen)) {
            return res.status(400).json({ success: false, message: 'Écran non autorisé' });
        }

        await users.updateUser(username, { default_screen: default_screen || null });
        res.json({ success: true, message: 'Écran par défaut mis à jour' });
    } catch (error) {
        console.error('Erreur lors de la mise à jour de l\'écran par défaut:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Route pour la page de connexion
app.get('/login.html', (req, res) => {
    console.log('Accès à login.html, session:', req.session);
    if (req.session.user) {
        res.redirect('/redirect');
    } else {
        res.sendFile(path.join(__dirname, 'login.html'));
    }
});

// Route pour l'importation des ventes
app.post('/api/import-ventes', checkAuth, checkWriteAccess, (req, res) => {
    // Vérifier les droits d'accès
    if (req.user.username !== 'SALIOU' && !req.user.isSuperAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Accès non autorisé à l\'importation'
        });
    }

    const entries = req.body;
    
    // Vérifier que les données sont valides
    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides'
        });
    }

    try {
        // Lire le contenu actuel du fichier
        let existingContent = '';
        if (fs.existsSync(csvFilePath)) {
            existingContent = fs.readFileSync(csvFilePath, 'utf-8');
            
            // Si le fichier existe mais est vide ou n'a pas d'en-têtes
            if (!existingContent.trim()) {
                existingContent = 'Mois;Date;Semaine;Point de Vente;Preparation;Catégorie;Produit;PU;Nombre;Montant\n';
            }
            // Si l'ancien format est utilisé (9 colonnes), migrer vers le nouveau format
            else if (!existingContent.includes('Preparation')) {
                const lines = existingContent.split('\n');
                const newLines = lines.map((line, index) => {
                    if (index === 0) {
                        // Remplacer l'en-tête
                        return 'Mois;Date;Semaine;Point de Vente;Preparation;Catégorie;Produit;PU;Nombre;Montant';
                    }
                    if (line.trim()) {
                        // Pour les lignes de données, insérer la colonne Preparation
                        const cols = line.split(';');
                        cols.splice(4, 0, cols[3]); // Copier Point de Vente comme valeur de Preparation
                        return cols.join(';');
                    }
                    return line;
                });
                existingContent = newLines.join('\n') + '\n';
                fs.writeFileSync(csvFilePath, existingContent);
            }
        } else {
            existingContent = 'Mois;Date;Semaine;Point de Vente;Preparation;Catégorie;Produit;PU;Nombre;Montant\n';
            fs.writeFileSync(csvFilePath, existingContent);
        }

        // Créer le contenu CSV pour les nouvelles entrées
        let csvContent = '';
        entries.forEach(entry => {
            // Vérifier que toutes les propriétés requises sont présentes
            if (!entry.mois || !entry.date || !entry.pointVente || !entry.categorie || !entry.produit) {
                throw new Error('Données manquantes dans une ou plusieurs lignes');
            }

            // Vérifier que le point de vente existe
            if (!pointsVente[entry.pointVente]) {
                throw new Error(`Le point de vente "${entry.pointVente}" n'existe pas`);
            }

            // S'assurer que toutes les valeurs sont définies, même si vides
            const ligne = [
                entry.mois || '',
                entry.date || '',
                entry.semaine || '',
                entry.pointVente || '',
                entry.preparation || entry.pointVente || '', // Utiliser le point de vente si preparation n'est pas défini
                entry.categorie || '',
                entry.produit || '',
                entry.prixUnit || '0',
                entry.quantite || '0',
                entry.total || '0'
            ];

            csvContent += ligne.join(';') + '\n';
        });

        // Ajouter les nouvelles entrées au fichier CSV
        fs.appendFileSync(csvFilePath, csvContent);

        // Retourner les dernières ventes pour mise à jour de l'affichage
        const results = [];
        fs.createReadStream(csvFilePath)
            .pipe(parse({ 
                delimiter: ';', 
                columns: true, 
                skip_empty_lines: true,
                relaxColumnCount: true
            }))
            .on('data', (row) => {
                results.push(row);
            })
            .on('end', () => {
                // Retourner les 10 dernières entrées
                const dernieresVentes = results.slice(-10);
                res.json({ 
                    success: true, 
                    message: 'Données importées avec succès',
                    dernieresVentes
                });
            })
            .on('error', (error) => {
                console.error('Erreur lors de la lecture du CSV:', error);
                throw error;
            });
    } catch (error) {
        console.error('Erreur lors de l\'importation:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Erreur lors de l\'importation des données'
        });
    }
});

// Route pour vider la base de données des ventes
app.post('/api/vider-base', async (req, res) => {
    try {
        // Vérifier si l'utilisateur est SALIOU
        if (!req.session.user || req.session.user.username !== 'SALIOU') {
            return res.status(403).json({ success: false, message: 'Accès non autorisé' });
        }

        // Vider la table des ventes
        await Vente.destroy({ where: {}, truncate: true });
        
        res.json({ success: true, message: 'Base de données vidée avec succès' });
    } catch (error) {
        console.error('Erreur lors du vidage de la base:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du vidage de la base de données',
            error: error.message
        });
    }
});

// Route pour charger les données de stock
app.get('/api/stock/:type', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const type = req.params.type;
        const date = req.query.date;
        const baseFilePath = type === 'matin' ? STOCK_MATIN_PATH : STOCK_SOIR_PATH;
        
        // Obtenir le chemin du fichier spécifique à la date
        const filePath = getPathByDate(baseFilePath, date);
        
        // Vérifier si le fichier existe
        if (!fs.existsSync(filePath)) {
            // Si le fichier n'existe pas, retourner un objet vide
            console.log(`Fichier de stock ${type} pour la date ${date} non trouvé, retour d'un objet vide`);
            return res.json({});
        }
        
        const data = await fsPromises.readFile(filePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        res.status(500).json({ error: 'Erreur lors du chargement des données' });
    }
});

// Fonction pour vérifier les restrictions temporelles pour le stock
function checkStockTimeRestrictions(dateStr, username) {
    if (!username || !dateStr) return { allowed: false, message: 'Données manquantes' };
    
    // Vérifier les permissions basées sur le rôle via la session utilisateur
    // Note: Cette fonction devrait idéalement recevoir l'objet user complet
    // Pour l'instant, on accepte les superviseurs et administrateurs
    const userRole = username.toUpperCase();
    const privilegedUsers = ['SALIOU', 'OUSMANE']; // Gardés pour rétrocompatibilité
    const supervisorUsers = ['NADOU']; // Ajout des superviseurs
    
    // Les utilisateurs privilégiés et superviseurs peuvent modifier le stock pour n'importe quelle date
    if (privilegedUsers.includes(userRole) || supervisorUsers.includes(userRole)) {
        return { allowed: true };
    }
    
    // Tous les autres utilisateurs sont soumis aux restrictions temporelles
    try {
        // Parser la date (formats supportés : DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD)
        const ddmmyyyyRegex = /^(\d{2})[-\/](\d{2})[-\/](\d{4})$/; // DD-MM-YYYY ou DD/MM/YYYY
        const yyyymmddRegex = /^(\d{4})[-\/](\d{2})[-\/](\d{2})$/; // YYYY-MM-DD ou YYYY/MM/DD
        
        let match = dateStr.match(ddmmyyyyRegex);
        let day, month, year;
        
        if (match) {
            // Format DD-MM-YYYY ou DD/MM/YYYY
            day = parseInt(match[1]);
            month = parseInt(match[2]) - 1; // Mois commence à 0 en JavaScript
            year = parseInt(match[3]);
        } else {
            match = dateStr.match(yyyymmddRegex);
            if (match) {
                // Format YYYY-MM-DD ou YYYY/MM/DD
                year = parseInt(match[1]);
                month = parseInt(match[2]) - 1; // Mois commence à 0 en JavaScript
                day = parseInt(match[3]);
            } else {
                return { allowed: false, message: 'Format de date invalide' };
            }
        }
        
        const targetDate = new Date(year, month, day);
        
        const now = new Date();
        
        // Calculer la date limite : targetDate + 1 jour + 4h
        const deadlineDate = new Date(targetDate);
        deadlineDate.setDate(deadlineDate.getDate() + 1);
        deadlineDate.setHours(4, 0, 0, 0); // 4h00 du matin
        
        // L'action est autorisée si nous sommes avant la date limite
        if (now <= deadlineDate) {
            return { allowed: true };
        } else {
            return { 
                allowed: false, 
                message: `Vous ne pouvez pas modifier le stock pour cette date (${dateStr}). Seuls administrateurs peuvent modifier le stock à tout moment. Les autres utilisateurs peuvent modifier le stock seulement le jour J et jusqu'au lendemain avant 4h00 du matin.` 
            };
        }
    } catch (error) {
        return { allowed: false, message: 'Erreur lors de la validation de la date' };
    }
}

// Middleware pour vérifier les restrictions temporelles pour le stock
function checkStockTimeRestrictionsMiddleware(req, res, next) {
    const user = req.session.user;
    if (!user) {
        return res.status(401).json({ success: false, error: 'Non authentifié' });
    }
    
    // Extraire la date des données du stock
    let stockDate = null;
    
    // Pour les stocks (structure objet avec clé contenant la date)
    if (req.body && Object.values(req.body)[0] && Object.values(req.body)[0].date) {
        stockDate = Object.values(req.body)[0].date;
    }
    
    if (!stockDate) {
        return res.status(400).json({ 
            success: false, 
            error: 'Date manquante dans les données du stock',
            timeRestriction: true 
        });
    }
    
    // Vérifier les restrictions temporelles
    const restriction = checkStockTimeRestrictions(stockDate, user.username);
    if (!restriction.allowed) {
        return res.status(403).json({
            success: false,
            error: restriction.message,
            timeRestriction: true
        });
    }
    
    next();
}

// Fonction pour vérifier les restrictions temporelles pour les ventes
function checkSaleTimeRestrictions(dateStr, username, userRole = null) {
    if (!username || !dateStr) return { allowed: false, message: 'Données manquantes' };
    
    const userUppercase = username.toUpperCase();
    const privilegedUsers = ['SALIOU', 'OUSMANE']; // Superviseurs privilégiés
    const superUtilisateurs = ['NADOU', 'PAPI']; // SuperUtilisateurs
    const limitedAccessUsers = ['MBA', 'OSF', 'KMS', 'LNG', 'DHR', 'TBM'];
    
    // Les utilisateurs privilégiés (SALIOU, OUSMANE) peuvent modifier n'importe quelle date
    if (privilegedUsers.includes(userUppercase)) {
        return { allowed: true };
    }
    
    // SuperUtilisateurs : peuvent modifier/supprimer UNIQUEMENT le jour J
    if (superUtilisateurs.includes(userUppercase) || userRole === 'superutilisateur') {
        try {
            // Parser la date (formats supportés : DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD)
            const ddmmyyyyRegex = /^(\d{2})[-\/](\d{2})[-\/](\d{4})$/;
            const yyyymmddRegex = /^(\d{4})[-\/](\d{2})[-\/](\d{2})$/;
            
            let match = dateStr.match(ddmmyyyyRegex);
            let day, month, year;
            
            if (match) {
                day = parseInt(match[1]);
                month = parseInt(match[2]) - 1;
                year = parseInt(match[3]);
            } else {
                match = dateStr.match(yyyymmddRegex);
                if (match) {
                    year = parseInt(match[1]);
                    month = parseInt(match[2]) - 1;
                    day = parseInt(match[3]);
                } else {
                    return { allowed: false, message: 'Format de date invalide' };
                }
            }
            
            const targetDate = new Date(year, month, day);
            const now = new Date();
            
            // Normaliser les dates pour comparer uniquement le jour (ignorer l'heure)
            targetDate.setHours(0, 0, 0, 0);
            const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            // SuperUtilisateurs peuvent modifier UNIQUEMENT le jour J
            if (targetDate.getTime() === todayDate.getTime()) {
                return { allowed: true };
            } else {
                return {
                    allowed: false,
                    message: `Les SuperUtilisateurs ne peuvent modifier/supprimer que les ventes du jour même. Date demandée : ${dateStr}.`
                };
            }
        } catch (error) {
            return { allowed: false, message: 'Erreur lors de la validation de la date' };
        }
    }
    
    // Tous les utilisateurs non privilégiés ont des restrictions temporelles
    try {
        // Parser la date (formats supportés : DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD)
        const ddmmyyyyRegex = /^(\d{2})[-\/](\d{2})[-\/](\d{4})$/;
        const yyyymmddRegex = /^(\d{4})[-\/](\d{2})[-\/](\d{2})$/;
        
        let match = dateStr.match(ddmmyyyyRegex);
        let day, month, year;
        
        if (match) {
            day = parseInt(match[1]);
            month = parseInt(match[2]) - 1;
            year = parseInt(match[3]);
        } else {
            match = dateStr.match(yyyymmddRegex);
            if (match) {
                year = parseInt(match[1]);
                month = parseInt(match[2]) - 1;
                day = parseInt(match[3]);
            } else {
                return { allowed: false, message: 'Format de date invalide' };
            }
        }
        
        const targetDate = new Date(year, month, day);
        const now = new Date();

        // Utilisateurs simples (role 'user') : uniquement le jour J, pas après minuit
        if (userRole === 'user') {
            const deadlineDate = new Date(targetDate);
            deadlineDate.setDate(deadlineDate.getDate() + 1);
            deadlineDate.setHours(0, 0, 0, 0); // minuit = début du jour suivant
            if (now < deadlineDate) {
                return { allowed: true };
            } else {
                return {
                    allowed: false,
                    message: `Vous ne pouvez pas modifier/supprimer des ventes pour cette date (${dateStr}). Les utilisateurs simples ne peuvent agir que le jour J avant minuit.`
                };
            }
        }

        // Autres utilisateurs non privilégiés : jusqu'à 4h du matin le lendemain
        const deadlineDate = new Date(targetDate);
        deadlineDate.setDate(deadlineDate.getDate() + 1);
        deadlineDate.setHours(4, 0, 0, 0); // 4h00 du matin
        
        if (now <= deadlineDate) {
            return { allowed: true };
        } else {
            return { 
                allowed: false, 
                message: `Vous ne pouvez pas ajouter/supprimer de ventes pour cette date (${dateStr}). Les utilisateurs ne peuvent ajouter/supprimer des ventes que le jour J et jusqu'au lendemain avant 4h00 du matin. Seuls SALIOU et OUSMANE sont exemptés de cette restriction.` 
            };
        }
    } catch (error) {
        return { allowed: false, message: 'Erreur lors de la validation de la date' };
    }
}

// Middleware pour vérifier les restrictions temporelles pour NADOU et PAPI
function checkTimeRestrictions(req, res, next) {
    const user = req.session.user;
    if (!user) {
        return res.status(401).json({ success: false, error: 'Non authentifié' });
    }
    
    // Appliquer les restrictions uniquement pour NADOU et PAPI
    if (user.username === 'NADOU' || user.username === 'PAPI') {
        let stockDate = null;
        
        // Pour les stocks (structure objet avec clé contenant la date)
        if (req.body && Object.values(req.body)[0] && Object.values(req.body)[0].date) {
            stockDate = Object.values(req.body)[0].date;
        }
        // Pour les transferts (structure tableau avec date dans chaque élément)
        else if (Array.isArray(req.body) && req.body.length > 0 && req.body[0].date) {
            stockDate = req.body[0].date;
        }
        
        if (stockDate) {
            const [day, month, year] = stockDate.split('/');
            const dateStock = new Date(year, month - 1, day); // Convertir en objet Date
            const maintenant = new Date();
            
            // Calculer la date limite : date du stock + 1 jour + 3 heures
            const dateLimite = new Date(dateStock);
            dateLimite.setDate(dateLimite.getDate() + 1); // Jour suivant
            dateLimite.setHours(3, 0, 0, 0); // 3h00 du matin
            
            if (maintenant > dateLimite) {
                const typeOperation = Array.isArray(req.body) ? 'transferts' : 'stock';
                return res.status(403).json({
                    success: false,
                    error: `Modification interdite. Les ${typeOperation} du ${stockDate} ne peuvent plus être modifiés après le ${dateLimite.toLocaleDateString('fr-FR')} à 3h00.`,
                    timeRestriction: true
                });
            }
        }
    }
    
    next();
}

// Route pour réinitialiser TOUTES les quantités de stock à 0 (admin uniquement)
// TODO: SECURITY - Implement two-step confirmation with operation ID and audit logging
// Current implementation is functional but could be improved with:
// 1. Generate UUID operationId + confirmation token, store in pending-operations table
// 2. Separate POST /api/admin/stock-reset/confirm/:operationId endpoint
// 3. Require re-authentication or password confirmation
// 4. Implement structured audit logging (winston/pino) with append-only storage
// 5. Add rate limiting on create-request endpoint
app.post('/api/admin/stock-reset/:type', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const type = req.params.type; // 'matin' ou 'soir'
        const { date } = req.body;
        const userRole = req.session.user.role;
        
        // Vérifier que l'utilisateur est admin
        if (userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Seuls les administrateurs peuvent réinitialiser le stock"
            });
        }
        
        // Valider le type
        if (type !== 'matin' && type !== 'soir') {
            return res.status(400).json({
                success: false,
                message: "Type de stock invalide. Utilisez 'matin' ou 'soir'"
            });
        }
        
        // Valider la date
        if (!date) {
            return res.status(400).json({
                success: false,
                message: "La date est requise"
            });
        }
        
        console.log(`🔄 RESET STOCK ${type.toUpperCase()} - Admin ${req.session.user.username} réinitialise le stock du ${date}`);
        
        let countModified = 0;
        
        // Déterminer le chemin du fichier
        const baseFilePath = type === 'matin' ? STOCK_MATIN_PATH : STOCK_SOIR_PATH;
        const filePath = getPathByDate(baseFilePath, date);
        
        // Réinitialiser TOUS les produits (manuels et automatiques) dans le fichier JSON
        if (fs.existsSync(filePath)) {
            const existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            // Mettre toutes les quantités à 0 (manuels ET automatiques)
            for (const pointVente in existingData) {
                for (const produit in existingData[pointVente]) {
                    const currentQuantite = parseFloat(existingData[pointVente][produit].quantite || 0);
                    if (currentQuantite !== 0) {
                        existingData[pointVente][produit].quantite = 0;
                        countModified++;
                    }
                }
            }
            
            // Sauvegarder les données modifiées
            fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
            console.log(`✅ Stock ${type} du ${date} réinitialisé: ${countModified} entrées mises à 0`);
        } else {
            console.log(`ℹ️ Pas de fichier de stock ${type} pour le ${date}`);
        }
        
        res.json({
            success: true,
            message: `Stock ${type} du ${date} réinitialisé avec succès`,
            count: countModified
        });
        
    } catch (error) {
        console.error('Erreur lors de la réinitialisation du stock:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la réinitialisation: " + error.message
        });
    }
});

// Route pour sauvegarder les données de stock
app.post('/api/stock/:type', checkAuth, checkWriteAccess, checkStockTimeRestrictionsMiddleware, async (req, res) => {
    try {
        const type = req.params.type;
        const date = req.body && Object.values(req.body)[0] ? Object.values(req.body)[0].date : null;
        
        if (!date) {
            return res.status(400).json({ 
                success: false,
                error: 'La date est requise pour sauvegarder les données de stock' 
            });
        }
        
        // Validation spéciale pour les SuperUtilisateurs : ils ne peuvent sauvegarder que vers Stock Soir
        if (req.user.isSuperUtilisateur && type === 'matin') {
            return res.status(403).json({
                success: false,
                error: 'Les SuperUtilisateurs ne peuvent copier que vers le Stock Soir'
            });
        }
        
        const baseFilePath = type === 'matin' ? STOCK_MATIN_PATH : STOCK_SOIR_PATH;
        
        // Obtenir le chemin du fichier spécifique à la date
        const filePath = getPathByDate(baseFilePath, date);
        
        // Sauvegarder les données dans le fichier spécifique à la date
        await fsPromises.writeFile(filePath, JSON.stringify(req.body, null, 2));
        
        // Note: Le fichier principal n'est pas mis à jour en production pour éviter les erreurs de permissions
        // Les données de stock sont sauvegardées uniquement dans les fichiers par date
        console.log(`Données de stock ${type} sauvegardées dans le fichier par date: ${filePath}`);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des données:', error);
        res.status(500).json({ error: 'Erreur lors de la sauvegarde des données' });
    }
});

// Route pour sauvegarder les transferts
app.post('/api/transferts', checkAuth, checkWriteAccess, checkTimeRestrictions, async (req, res) => {
    try {
        const transferts = req.body;
        
        // Vérifier si des transferts sont fournis
        if (!Array.isArray(transferts) || transferts.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Aucun transfert à sauvegarder' 
            });
        }
        
        // Grouper les transferts par date
        const transfertsByDate = {};
        
        transferts.forEach(transfert => {
            if (!transfert.date) {
                throw new Error('Date manquante pour un transfert');
            }
            
            if (!transfertsByDate[transfert.date]) {
                transfertsByDate[transfert.date] = [];
            }
            
            transfertsByDate[transfert.date].push(transfert);
        });
        
        // Sauvegarder chaque groupe de transferts dans un fichier spécifique à sa date
        for (const [date, dateTransferts] of Object.entries(transfertsByDate)) {
            const filePath = getPathByDate(TRANSFERTS_PATH, date);
            
            // Remplacer complètement les transferts existants pour cette date
            await fs.promises.writeFile(filePath, JSON.stringify(dateTransferts, null, 2));
            console.log(`Transferts sauvegardés pour la date ${date}: ${dateTransferts.length} transferts`);
        }
        
        // Mettre à jour le fichier principal avec tous les transferts
        // Lire tous les transferts de toutes les dates
        let allTransferts = [];
        
        // Parcourir tous les fichiers de transferts spécifiques à une date
        const dateDirs = await fsPromises.readdir(path.join(__dirname, 'data', 'by-date'), { withFileTypes: true });
        for (const dateDir of dateDirs) {
            if (dateDir.isDirectory()) {
                const datePath = path.join(__dirname, 'data', 'by-date', dateDir.name, 'transferts.json');
                if (fs.existsSync(datePath)) {
                    const content = await fsPromises.readFile(datePath, 'utf8');
                    const dateTransferts = JSON.parse(content || '[]');
                    allTransferts = [...allTransferts, ...dateTransferts];
                }
            }
        }
        
        // Note: Le fichier principal n'est pas mis à jour en production pour éviter les erreurs de permissions
        // Les transferts sont sauvegardés uniquement dans les fichiers par date
        console.log(`Transferts sauvegardés dans les fichiers par date: ${allTransferts.length} transferts au total`);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des transferts:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde des transferts' });
    }
});

// Route pour récupérer les transferts
app.get('/api/transferts', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { date } = req.query;
        
        if (date) {
            // Obtenir le chemin du fichier spécifique à la date
            const filePath = getPathByDate(TRANSFERTS_PATH, date);
            
            // Vérifier si le fichier spécifique existe
            if (fs.existsSync(filePath)) {
                const content = await fsPromises.readFile(filePath, 'utf8');
                const transferts = JSON.parse(content || '[]');
                return res.json({ success: true, transferts });
            }
            
            // Si le fichier spécifique n'existe pas, chercher dans le fichier principal
            if (fs.existsSync(TRANSFERTS_PATH)) {
                const content = await fsPromises.readFile(TRANSFERTS_PATH, 'utf8');
                const allTransferts = JSON.parse(content || '[]');
                // Filtrer les transferts par date
                const transferts = allTransferts.filter(t => t.date === date);
                return res.json({ success: true, transferts });
            }
            
            // Si aucun fichier n'existe, retourner un tableau vide
            return res.json({ success: true, transferts: [] });
        } else {
            // Retourner tous les transferts depuis le fichier principal
            if (fs.existsSync(TRANSFERTS_PATH)) {
                const content = await fsPromises.readFile(TRANSFERTS_PATH, 'utf8');
                const transferts = JSON.parse(content || '[]');
                return res.json({ success: true, transferts });
            }
            
            // Si le fichier n'existe pas, retourner un tableau vide
            return res.json({ success: true, transferts: [] });
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des transferts:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des transferts',
            error: error.message 
        });
    }
});

// Route pour supprimer un transfert
app.delete('/api/transferts', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const transfertData = req.body;
        console.log('Données de suppression du transfert reçues:', transfertData);
        
        // Vérifier que toutes les données nécessaires sont présentes
        if (!transfertData.date || !transfertData.pointVente || !transfertData.produit) {
            return res.status(400).json({
                success: false,
                message: 'Données insuffisantes pour identifier le transfert à supprimer'
            });
        }

        // Obtenir le chemin du fichier spécifique à la date
        const dateFilePath = getPathByDate(TRANSFERTS_PATH, transfertData.date);
        
        // Tableau pour stocker les transferts mis à jour
        let dateTransferts = [];
        let indexToRemove = -1;
        
        // Mise à jour du fichier spécifique à la date s'il existe
        if (fs.existsSync(dateFilePath)) {
            const content = await fsPromises.readFile(dateFilePath, 'utf8');
            dateTransferts = JSON.parse(content || '[]');
            
            // Rechercher l'index du transfert à supprimer
            indexToRemove = dateTransferts.findIndex(t => 
                t.pointVente === transfertData.pointVente && 
                t.produit === transfertData.produit &&
                t.impact === transfertData.impact &&
                parseFloat(t.quantite) === parseFloat(transfertData.quantite) &&
                parseFloat(t.prixUnitaire) === parseFloat(transfertData.prixUnitaire)
            );
            
            if (indexToRemove !== -1) {
                // Supprimer le transfert
                dateTransferts.splice(indexToRemove, 1);
                
                // Sauvegarder les transferts mis à jour
                await fsPromises.writeFile(dateFilePath, JSON.stringify(dateTransferts, null, 2));
            }
        }
        
        // Mettre également à jour le fichier principal
        let allTransferts = [];
        if (fs.existsSync(TRANSFERTS_PATH)) {
            const content = await fsPromises.readFile(TRANSFERTS_PATH, 'utf8');
            allTransferts = JSON.parse(content || '[]');
            
            // Rechercher l'index du transfert à supprimer
            indexToRemove = allTransferts.findIndex(t => 
                t.date === transfertData.date &&
                t.pointVente === transfertData.pointVente && 
                t.produit === transfertData.produit &&
                t.impact === transfertData.impact &&
                parseFloat(t.quantite) === parseFloat(transfertData.quantite) &&
                parseFloat(t.prixUnitaire) === parseFloat(transfertData.prixUnitaire)
            );
            
            if (indexToRemove !== -1) {
                // Supprimer le transfert
                allTransferts.splice(indexToRemove, 1);
                
                // Note: Le fichier principal n'est pas mis à jour en production pour éviter les erreurs de permissions
                // La suppression est effectuée uniquement dans le fichier par date
                console.log(`Transfert supprimé du fichier par date, fichier principal non mis à jour (production)`);
            } else {
                return res.status(404).json({
                    success: false,
                    message: 'Transfert non trouvé'
                });
            }
        } else {
            return res.status(404).json({
                success: false,
                message: 'Aucun transfert trouvé'
            });
        }

        res.json({
            success: true,
            message: 'Transfert supprimé avec succès'
        });
    } catch (error) {
        console.error('Erreur lors de la suppression du transfert:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la suppression du transfert',
            error: error.message
        });
    }
});

// Route pour exécuter la copie automatique du stock
app.post('/api/stock/copy', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { date, dryRun = false } = req.body;
        
        // Validation des paramètres
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                success: false,
                error: 'Format de date invalide. Utilisez YYYY-MM-DD'
            });
        }

        console.log(`Exécution de la copie du stock via API. Date: ${date || 'auto'}, Dry-run: ${dryRun}`);

        // Construire les arguments pour le script
        const args = ['scripts/copy-stock-cron.js'];
        if (dryRun) {
            args.push('--dry-run');
        }
        if (date) {
            args.push(`--date=${date}`);
        }

        // Exécuter le script
        const childProcess = spawn('node', args, {
            cwd: __dirname,
            stdio: ['inherit', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        childProcess.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    message: dryRun ? 'Simulation terminée avec succès' : 'Copie terminée avec succès',
                    output: stdout,
                    dryRun: dryRun
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Erreur lors de l\'exécution du script',
                    output: stdout,
                    errorOutput: stderr,
                    exitCode: code
                });
            }
        });

        childProcess.on('error', (error) => {
            console.error('Erreur lors du lancement du script:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur lors du lancement du script',
                details: error.message
            });
        });

    } catch (error) {
        console.error('Erreur dans l\'API de copie du stock:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur',
            details: error.message
        });
    }
});

// External API endpoint to trigger stock copy automation
app.post('/api/external/stock/copy', validateApiKey, async (req, res) => {
    try {

        const { date, dryRun = false, override = true } = req.body;
        
        console.log('🚀 API Stock Copy Request:', { date, dryRun, override });

        // Validate date format if provided
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format. Use YYYY-MM-DD format.'
            });
        }

        // Prepare command arguments
        const args = ['scripts/copy-stock-cron.js'];
        
        if (dryRun) {
            args.push('--dry-run');
        }
        
        if (date) {
            args.push(`--date=${date}`);
        }

        console.log('📋 Executing command: node', args.join(' '));

        // Execute the stock copy script
        const child = spawn('node', args, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV || 'production',
                LOG_LEVEL: process.env.LOG_LEVEL || 'info',
                DATA_PATH: process.env.DATA_PATH || './data/by-date'
            }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log('📤 Script output:', data.toString().trim());
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error('❌ Script error:', data.toString().trim());
        });

        child.on('close', (code) => {
            console.log(`✅ Script execution completed with exit code: ${code}`);
            
            if (code === 0) {
                res.json({
                    success: true,
                    message: 'Stock copy executed successfully',
                    exitCode: code,
                    output: stdout,
                    dryRun,
                    date: date || 'auto-detected',
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Stock copy script failed',
                    exitCode: code,
                    output: stdout,
                    errorOutput: stderr,
                    timestamp: new Date().toISOString()
                });
            }
        });

        child.on('error', (error) => {
            console.error('💥 Failed to start script:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to execute stock copy script',
                details: error.message,
                timestamp: new Date().toISOString()
            });
        });

    } catch (error) {
        console.error('🚨 API Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// External API health check endpoint
app.get('/api/external/health', validateApiKey, (req, res) => {
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        apiKeyConfigured: !!process.env.EXTERNAL_API_KEY,
        version: '1.0.0'
    });
});

// Route pour supprimer une vente
app.delete('/api/ventes/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const venteId = req.params.id;
        const pointVente = req.query.pointVente;

        console.log(`Tentative de suppression de la vente ID: ${venteId}, Point de vente: ${pointVente}`);

        // Trouver la vente à supprimer
        const vente = await Vente.findByPk(venteId);
        
        if (!vente) {
            return res.status(404).json({ 
                success: false, 
                message: "Vente non trouvée" 
            });
        }
        
        // Vérifier si l'utilisateur a accès au point de vente
        const userPointVente = req.session.user.pointVente;
        let hasAccess = false;
        
        if (userPointVente === "tous") {
            hasAccess = true;
        } else if (Array.isArray(userPointVente)) {
            // Vérifier si le tableau contient "tous" OU le point de vente spécifique
            hasAccess = userPointVente.includes("tous") || userPointVente.includes(vente.pointVente);
        } else {
            hasAccess = userPointVente === vente.pointVente;
        }
        
        if (!hasAccess) {
            return res.status(403).json({ 
                success: false, 
                message: "Accès non autorisé à ce point de vente" 
            });
        }

        // Vérifier les restrictions temporelles pour la suppression
        const restriction = checkSaleTimeRestrictions(vente.date, req.session.user.username, req.session.user.role);
        if (!restriction.allowed) {
            return res.status(403).json({
                success: false,
                message: restriction.message,
                timeRestriction: true
            });
        }

        // =====================================================
        // RECALCUL STOCK SOIR APRÈS SUPPRESSION
        // Stock Soir = Stock Matin - Ventes restantes
        // =====================================================
        try {
            const { Produit } = require('./db/models');
            
            // Chercher si le produit est en mode automatique
            const produit = await Produit.findOne({
                where: { 
                    nom: vente.produit,
                    mode_stock: 'automatique'
                }
            });
            
            if (produit) {
                const dateVente = vente.date;
                const dateFormatted = standardiserDateFormat(dateVente);
                const pointVente = vente.pointVente;
                const produitNom = vente.produit;
                const stockKey = `${pointVente}-${produitNom}`;
                
                // Charger Stock Matin (format PLAT)
                const stockMatinPath = getPathByDate(STOCK_MATIN_PATH, dateFormatted);
                let stockMatin = {};
                if (fs.existsSync(stockMatinPath)) {
                    stockMatin = JSON.parse(fs.readFileSync(stockMatinPath, 'utf8'));
                }
                
                const stockMatinData = stockMatin[stockKey] || {};
                const stockMatinQte = parseFloat(stockMatinData.Nombre || stockMatinData.quantite || 0);
                
                // Recalculer total des ventes après suppression
                const ventesRestantes = await Vente.findAll({
                    where: {
                        date: vente.date,
                        pointVente: pointVente,
                        produit: produitNom,
                        id: { [Op.ne]: venteId } // Exclure la vente en cours de suppression
                    }
                });
                
                const totalVentesRestantes = ventesRestantes.reduce((sum, v) => sum + parseFloat(v.nombre || 0), 0);
                const stockSoirQte = stockMatinQte - totalVentesRestantes;
                const prixUnit = parseFloat(produit.prix_defaut || vente.prixUnit || 0);
                
                // Mettre à jour Stock Soir (format PLAT)
                const stockSoirPath = getPathByDate(STOCK_SOIR_PATH, dateFormatted);
                let stockSoir = {};
                if (fs.existsSync(stockSoirPath)) {
                    stockSoir = JSON.parse(fs.readFileSync(stockSoirPath, 'utf8'));
                }
                
                if (totalVentesRestantes === 0 && stockMatinQte === 0) {
                    // Si plus de ventes et stock matin à 0, supprimer l'entrée
                    delete stockSoir[stockKey];
                } else {
                    stockSoir[stockKey] = {
                        Nombre: stockSoirQte,
                        PU: prixUnit,
                        Montant: stockSoirQte * prixUnit,
                        Produit: produitNom,
                        "Point de Vente": pointVente,
                        mode: 'automatique'
                    };
                }
                
                fs.writeFileSync(stockSoirPath, JSON.stringify(stockSoir, null, 2));
                console.log(`📦 Stock Soir recalculé: ${stockKey}: ${stockMatinQte} - ${totalVentesRestantes} = ${stockSoirQte}`);
            }
        } catch (stockError) {
            console.error('⚠️ Erreur recalcul stock (non bloquant):', stockError.message);
        }
        // =====================================================

        // Supprimer la vente
        await vente.destroy();

        console.log(`Vente ID: ${venteId} supprimée avec succès`);
        
        res.json({ 
            success: true, 
            message: "Vente supprimée avec succès" 
        });
    } catch (error) {
        console.error('Erreur lors de la suppression de la vente:', error);
        res.status(500).json({ 
            success: false, 
            message: "Erreur lors de la suppression de la vente: " + error.message 
        });
    }
});

// Route pour supprimer TOUTES les ventes d'une date (admin uniquement)
app.delete('/api/ventes/jour/:date', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const dateParam = req.params.date;
        const userRole = req.session.user.role;
        
        // Vérifier que l'utilisateur est admin
        if (userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Seuls les administrateurs peuvent supprimer toutes les ventes d'un jour"
            });
        }
        
        console.log(`🗑️ SUPPRESSION EN MASSE - Admin ${req.session.user.username} supprime les ventes du ${dateParam}`);
        
        // Standardiser le format de date
        const dateStandardisee = standardiserDateFormat(dateParam);
        
        // Préparer les conditions pour les deux formats de date possibles
        let dateDDMMYYYY = dateParam;
        if (dateParam.includes('/')) {
            dateDDMMYYYY = dateParam.replace(/\//g, '-');
        }
        
        const whereConditions = {
            [Op.or]: [
                { date: dateStandardisee },
                { date: dateDDMMYYYY }
            ]
        };
        
        // Compter les ventes à supprimer
        const countVentes = await Vente.count({ where: whereConditions });
        
        if (countVentes === 0) {
            return res.status(404).json({
                success: false,
                message: `Aucune vente trouvée pour la date ${dateParam}`
            });
        }
        
        // Récupérer les ventes pour recalculer les stocks soir
        const ventes = await Vente.findAll({ where: whereConditions });
        
        // Grouper les ventes par produit auto pour recalcul
        const { Produit } = require('./db/models');
        const produitsARecalculer = new Map(); // key = date-pointVente-produit
        
        for (const vente of ventes) {
            const produit = await Produit.findOne({
                where: { 
                    nom: vente.produit,
                    mode_stock: 'automatique'
                }
            });
            
            if (produit) {
                const key = `${vente.date}-${vente.pointVente}-${vente.produit}`;
                produitsARecalculer.set(key, {
                    date: vente.date,
                    pointVente: vente.pointVente,
                    produit: vente.produit,
                    produitObj: produit
                });
            }
        }
        
        // Supprimer toutes les ventes
        const deletedCount = await Vente.destroy({ where: whereConditions });
        
        // Recalculer Stock Soir pour chaque produit affecté (format PLAT)
        for (const [key, info] of produitsARecalculer) {
            try {
                const dateFormatted = standardiserDateFormat(info.date);
                const stockKey = `${info.pointVente}-${info.produit}`;
                
                // Charger Stock Matin (format PLAT)
                const stockMatinPath = getPathByDate(STOCK_MATIN_PATH, dateFormatted);
                let stockMatin = {};
                if (fs.existsSync(stockMatinPath)) {
                    stockMatin = JSON.parse(fs.readFileSync(stockMatinPath, 'utf8'));
                }
                
                const stockMatinData = stockMatin[stockKey] || {};
                const stockMatinQte = parseFloat(stockMatinData.Nombre || stockMatinData.quantite || 0);
                
                // Calculer ventes restantes (après suppression)
                const ventesRestantes = await Vente.findAll({
                    where: {
                        date: info.date,
                        pointVente: info.pointVente,
                        produit: info.produit
                    }
                });
                
                const totalVentesRestantes = ventesRestantes.reduce((sum, v) => sum + parseFloat(v.nombre || 0), 0);
                const stockSoirQte = stockMatinQte - totalVentesRestantes;
                const prixUnit = parseFloat(info.produitObj.prix_defaut || 0);
                
                // Mettre à jour Stock Soir (format PLAT)
                const stockSoirPath = getPathByDate(STOCK_SOIR_PATH, dateFormatted);
                let stockSoir = {};
                if (fs.existsSync(stockSoirPath)) {
                    stockSoir = JSON.parse(fs.readFileSync(stockSoirPath, 'utf8'));
                }
                
                if (totalVentesRestantes === 0 && stockMatinQte === 0) {
                    // Si plus de ventes et stock matin à 0, supprimer l'entrée
                    delete stockSoir[stockKey];
                } else {
                    stockSoir[stockKey] = {
                        Nombre: stockSoirQte,
                        PU: prixUnit,
                        Montant: stockSoirQte * prixUnit,
                        Produit: info.produit,
                        "Point de Vente": info.pointVente,
                        mode: 'automatique'
                    };
                }
                
                fs.writeFileSync(stockSoirPath, JSON.stringify(stockSoir, null, 2));
                console.log(`📦 Stock Soir recalculé: ${stockKey}: ${stockSoirQte}`);
            } catch (err) {
                console.error(`Erreur recalcul stock pour ${info.produit}:`, err);
            }
        }
        
        console.log(`✅ ${deletedCount} ventes supprimées pour le ${dateParam}`);
        
        res.json({
            success: true,
            message: `${deletedCount} ventes supprimées pour le ${dateParam}`,
            count: deletedCount
        });
        
    } catch (error) {
        console.error('Erreur lors de la suppression en masse:', error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la suppression: " + error.message
        });
    }
});

// Route pour récupérer les ventes d'une date spécifique pour un point de vente
app.get('/api/ventes-date', checkAuth, async (req, res) => {
    try {
        const { date, pointVente } = req.query;
        
        if (!date) {
            return res.status(400).json({ 
                success: false, 
                message: 'La date est requise' 
            });
        }
        
        console.log('==== DEBUG VENTES-DATE ====');
        console.log('Recherche des ventes pour date:', date, 'et point de vente:', pointVente);
        
        const dateStandardisee = standardiserDateFormat(date);
        console.log('Date standardisée:', dateStandardisee);
        
        // Utiliser la même logique que l'API externe pour gérer les formats de date multiples
        // Convertir la date d'entrée en format DD-MM-YYYY si elle n'y est pas déjà
        let dateDDMMYYYY = date;
        if (date.includes('/')) {
            dateDDMMYYYY = date.replace(/\//g, '-');
        }
        
        // Préparer les conditions de filtrage avec OR pour gérer les deux formats
        const whereConditions = {
            [Op.or]: [
                { date: dateStandardisee },  // Format YYYY-MM-DD
                { date: dateDDMMYYYY }       // Format DD-MM-YYYY
            ]
        };
        
        if (pointVente) {
            whereConditions.pointVente = pointVente;
        }
        
        console.log('Conditions de recherche (avec OR):', whereConditions);
        
        // Récupérer les ventes depuis la base de données
        const ventes = await Vente.findAll({
            where: whereConditions
        });
        
        console.log(`Nombre de ventes trouvées: ${ventes.length}`);
        if (ventes.length > 0) {
            console.log('Premier échantillon de vente:', {
                id: ventes[0].id,
                date: ventes[0].date,
                pointVente: ventes[0].pointVente,
                produit: ventes[0].produit,
                nombre: ventes[0].nombre,
                prixUnit: ventes[0].prixUnit,
                montant: ventes[0].montant,
                montantType: typeof ventes[0].montant
            });
        }
        
        // Formater les données pour la réponse
        const formattedVentes = ventes.map(vente => {
            // Conversion explicite en nombres
            const prixUnit = parseFloat(vente.prixUnit) || 0;
            const nombre = parseFloat(vente.nombre) || 0;
            const montant = parseFloat(vente.montant) || 0;
            
            return {
                id: vente.id,
                Date: vente.date,
                'Point de Vente': vente.pointVente,
                Catégorie: vente.categorie,
                Produit: vente.produit,
                PU: prixUnit,
                Nombre: nombre,
                Montant: montant,
                nomClient: vente.nomClient,
                numeroClient: vente.numeroClient,
                adresseClient: vente.adresseClient,
                instructionsClient: vente.instructionsClient || null,
                creance: vente.creance,
                montantRestantDu: parseFloat(vente.montantRestantDu) || 0,
                commande_id: vente.commandeId || null,
                statut_preparation: vente.statutPreparation || 'en_preparation',
                livreur_assigne: vente.livreurAssigne || null
            };
        });
        
        // Calculer le total par point de vente
        const totauxParPointVente = {};
        
        formattedVentes.forEach(vente => {
            const pv = vente['Point de Vente'];
            if (!totauxParPointVente[pv]) {
                totauxParPointVente[pv] = 0;
            }
            // S'assurer que le montant est un nombre
            const montant = parseFloat(vente.Montant) || 0;
            totauxParPointVente[pv] += montant;
        });
        
        console.log('Totaux des ventes par point de vente:', totauxParPointVente);
        
        // Vérification supplémentaire pour s'assurer que les totaux sont bien des nombres
        Object.keys(totauxParPointVente).forEach(pv => {
            console.log(`Total pour ${pv}: ${totauxParPointVente[pv]} (type: ${typeof totauxParPointVente[pv]})`);
        });
        
        console.log('==== FIN DEBUG VENTES-DATE ====');
        
        res.json({ 
            success: true, 
            ventes: formattedVentes,
            totaux: totauxParPointVente
        });
    } catch (error) {
        console.error('Erreur lors de la recherche des ventes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la recherche des ventes',
            error: error.message
        });
    }
});

// Endpoint pour utiliser DeepSeek (local)
app.post('/api/analyse-deepseek', (req, res) => {
    try {
        // Vérifier que les données nécessaires sont présentes
        const { donnees } = req.body;
        if (!donnees) {
            return res.status(400).json({ success: false, message: 'Données manquantes pour l\'analyse' });
        }

        // Dans une version réelle, ici nous appellerions le modèle DeepSeek
        // pour analyser les données. Pour l'instant, nous simulons cela
        // en renvoyant la même réponse que le code frontend.
        
        // Structurer notre prompt pour DeepSeek
        console.log("Préparation de l'analyse DeepSeek pour", donnees.pointVente);
        
        // Simuler une réponse après un délai
        setTimeout(() => {
            const ecart = donnees.ecart;
            const isEcartPositif = ecart > 0;
            const isEcartNegatif = ecart < 0;
            const isEcartZero = ecart === 0;
            
            // Créer une réponse similaire à celle du frontend
            let analysis = `**Analyse DeepSeek des résultats de réconciliation**\n\n`;
            
            analysis += `**Point de vente:** ${donnees.pointVente}\n`;
            analysis += `**Date:** ${donnees.date}\n\n`;
            
            analysis += `**Résumé des données financières:**\n`;
            analysis += `- Stock Matin: ${donnees.stockMatin} FCFA\n`;
            analysis += `- Stock Soir: ${donnees.stockSoir} FCFA\n`;
            analysis += `- Transferts: ${donnees.transferts} FCFA\n`;
            analysis += `- Ventes Théoriques: ${donnees.ventesTheoriques} FCFA\n`;
            analysis += `- Ventes Saisies: ${donnees.ventesSaisies} FCFA\n`;
            analysis += `- Écart: ${donnees.ecart} FCFA\n\n`;
            
            // Envoyer la réponse
            res.json({ 
                success: true, 
                analysis: analysis,
                model: "DeepSeek-Lite (Local)"
            });
        }, 1000);
        
    } catch (error) {
        console.error('Erreur lors de l\'analyse DeepSeek:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse avec DeepSeek: ' + error.message 
        });
    }
});

// Fonction d'aide pour traiter les lignes CSV et attribuer des IDs uniques aux ventes
async function loadVentesWithIds() {
  try {
    const fileContent = await fsPromises.readFile(csvFilePath, 'utf-8');
    const lines = fileContent.split('\n');
    
    // Ignorer l'en-tête et les lignes vides
    const dataLines = lines.slice(1).filter(line => line.trim());
    
    // Convertir chaque ligne en objet avec un ID correspondant à sa position
    const ventes = dataLines.map((line, index) => {
      const columns = line.split(';');
      
      // S'assurer que toutes les colonnes existent
      while (columns.length < 10) {
        columns.push('');
      }
      
      return {
        id: index + 1, // L'ID correspond à la position (ligne 1 = ID 1)
        Mois: columns[0],
        Date: columns[1],
        Semaine: columns[2],
        'Point de Vente': columns[3],
        Preparation: columns[4],
        Catégorie: columns[5],
        Produit: columns[6],
        PU: columns[7],
        Nombre: columns[8] || '0',
        Montant: columns[9] || '0'
      };
    });
    
    return ventes;
  } catch (error) {
    console.error('Erreur lors du chargement des ventes:', error);
    throw error;
  }
}

// ================================
// ROUTES POUR LES PRÉ-COMMANDES
// ================================

// Route pour ajouter des pré-commandes
app.post('/api/precommandes', checkAuth, checkWriteAccess, async (req, res) => {
    console.log('=== AJOUT PRÉ-COMMANDES ===');
    console.log('Utilisateur:', req.session.user?.username);
    console.log('Nombre d\'entrées:', Array.isArray(req.body) ? req.body.length : 'Non array');
    
    const entries = req.body;
    
    // Vérifier si le point de vente est actif pour chaque pré-commande
    for (const entry of entries) {
        if (!pointsVente[entry.pointVente]?.active) {
            return res.status(400).json({ 
                success: false, 
                message: `Le point de vente ${entry.pointVente} est désactivé` 
            });
        }
        
        // Vérifier si le produit existe dans la catégorie
        if (entry.categorie && entry.produit) {
            const categorieExists = produits[entry.categorie];
            if (!categorieExists) {
                return res.status(400).json({
                    success: false,
                    message: `La catégorie "${entry.categorie}" n'existe pas`
                });
            }
            
            const produitExists = produits[entry.categorie][entry.produit] !== undefined;
            if (!produitExists) {
                return res.status(400).json({
                    success: false,
                    message: `Le produit "${entry.produit}" n'existe pas dans la catégorie "${entry.categorie}"`
                });
            }
        }
    }
    
    try {
        // Préparer les données pour l'insertion
        const precommandesToInsert = entries.map(entry => {
            // Standardiser les dates au format dd-mm-yyyy
            const dateEnregistrementStandardisee = standardiserDateFormat(entry.dateEnregistrement);
            const dateReceptionStandardisee = standardiserDateFormat(entry.dateReception);
            
            // Convertir les valeurs numériques en nombre avec une précision fixe
            const nombre = parseFloat(parseFloat(entry.quantite).toFixed(2)) || 0;
            const prixUnit = parseFloat(parseFloat(entry.prixUnit).toFixed(2)) || 0;
            const montant = parseFloat(parseFloat(entry.total).toFixed(2)) || 0;
            
            return {
                mois: entry.mois,
                dateEnregistrement: dateEnregistrementStandardisee,
                dateReception: dateReceptionStandardisee,
                semaine: entry.semaine,
                pointVente: entry.pointVente,
                preparation: entry.preparation || entry.pointVente,
                categorie: entry.categorie,
                produit: entry.produit,
                prixUnit: prixUnit,
                nombre: nombre,
                montant: montant,
                nomClient: entry.nomClient || null,
                numeroClient: entry.numeroClient || null,
                adresseClient: entry.adresseClient || null,
                commentaire: entry.commentaire || null,
                label: entry.label || null
            };
        });
        
        // Insérer les pré-commandes dans la base de données
        await Precommande.bulkCreate(precommandesToInsert);
        console.log('✅ Pré-commandes ajoutées avec succès');
        
        // Récupérer les 10 dernières pré-commandes pour l'affichage
        const dernieresPrecommandes = await Precommande.findAll({
            order: [['createdAt', 'DESC']],
            limit: 10
        });
        
        // Formater les données pour la réponse
        const formattedPrecommandes = dernieresPrecommandes.map(precommande => ({
            id: precommande.id,
            Mois: precommande.mois,
            'Date Enregistrement': precommande.dateEnregistrement,
            'Date Réception': precommande.dateReception,
            Semaine: precommande.semaine,
            'Point de Vente': precommande.pointVente,
            Preparation: precommande.preparation,
            Catégorie: precommande.categorie,
            Produit: precommande.produit,
            PU: precommande.prixUnit,
            Nombre: precommande.nombre,
            Montant: precommande.montant,
            nomClient: precommande.nomClient,
            numeroClient: precommande.numeroClient,
            adresseClient: precommande.adresseClient,
            commentaire: precommande.commentaire,
            label: precommande.label
        }));
        
        res.json({ success: true, dernieresPrecommandes: formattedPrecommandes });
    } catch (error) {
        console.error('Erreur lors de l\'ajout des pré-commandes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'ajout des pré-commandes',
            error: error.message
        });
    }
});

// Route pour obtenir les pré-commandes avec filtres
app.get('/api/precommandes', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { dateDebut, dateFin, pointVente, label, statut, limit, sort, order } = req.query;
        
        console.log('Paramètres reçus:', { dateDebut, dateFin, pointVente, label, statut, limit, sort, order });
        
        // Préparer les conditions de filtrage
        const whereConditions = {};
        
        if (dateDebut || dateFin) {
            // Utiliser la même logique que pour les ventes pour filtrer par date
            const convertISOToAppFormat = (isoDate) => {
                const date = new Date(isoDate);
                const jour = date.getDate().toString().padStart(2, '0');
                const mois = (date.getMonth() + 1).toString().padStart(2, '0');
                const annee = date.getFullYear();
                return `${jour}-${mois}-${annee}`;
            };
            
            const debutFormatted = dateDebut ? convertISOToAppFormat(dateDebut) : null;
            const finFormatted = dateFin ? convertISOToAppFormat(dateFin) : null;
            
            // Récupérer toutes les pré-commandes et filtrer en JavaScript (comme pour les ventes)
            const toutesPrecommandes = await Precommande.findAll({
                order: [['dateEnregistrement', 'DESC'], ['id', 'DESC']]
            });
            
            const isDateInRange = (dateToCheck, startDate, endDate) => {
                const convertToComparable = (dateStr) => {
                    if (!dateStr) return '';
                    const [day, month, year] = dateStr.split('-');
                    return `${year}-${month}-${day}`;
                };
                
                const comparableDate = convertToComparable(dateToCheck);
                const comparableStart = startDate ? convertToComparable(startDate) : '';
                const comparableEnd = endDate ? convertToComparable(endDate) : '';
                
                let isInRange = true;
                
                if (comparableStart && comparableDate) {
                    isInRange = isInRange && (comparableDate >= comparableStart);
                }
                
                if (comparableEnd && comparableDate) {
                    isInRange = isInRange && (comparableDate <= comparableEnd);
                }
                
                return isInRange;
            };
            
            let precommandesFiltrees = toutesPrecommandes.filter(precommande => {
                return isDateInRange(precommande.dateEnregistrement, debutFormatted, finFormatted);
            });
            
            // Filtrer par point de vente si spécifié
            if (pointVente && pointVente !== 'tous') {
                precommandesFiltrees = precommandesFiltrees.filter(precommande => 
                    precommande.pointVente === pointVente
                );
            }
            
            // Filtrer par label si spécifié
            if (label) {
                precommandesFiltrees = precommandesFiltrees.filter(precommande => 
                    precommande.label && precommande.label.toLowerCase().includes(label.toLowerCase())
                );
            }
        
        // Formater les données pour la réponse
            const formattedPrecommandes = precommandesFiltrees.map(precommande => ({
            id: precommande.id,
                Mois: precommande.mois,
                'Date Enregistrement': precommande.dateEnregistrement,
                'Date Réception': precommande.dateReception,
                Semaine: precommande.semaine,
                'Point de Vente': precommande.pointVente,
                Preparation: precommande.preparation,
                Catégorie: precommande.categorie,
                Produit: precommande.produit,
                PU: precommande.prixUnit,
                Nombre: precommande.nombre,
                Montant: precommande.montant,
            nomClient: precommande.nomClient,
            numeroClient: precommande.numeroClient,
            adresseClient: precommande.adresseClient,
            commentaire: precommande.commentaire,
            label: precommande.label,
                statut: precommande.statut || 'ouvert',
                commentaireStatut: precommande.commentaireStatut
            }));
            
            res.json({ success: true, precommandes: formattedPrecommandes });
        } else {
            // Si pas de filtre de date, récupérer toutes les pré-commandes
            const toutesPrecommandes = await Precommande.findAll({
                order: [['dateEnregistrement', 'DESC'], ['id', 'DESC']]
            });
            
            let precommandesFiltrees = toutesPrecommandes;
            
            // Filtrer par point de vente si spécifié
            if (pointVente && pointVente !== 'tous') {
                precommandesFiltrees = precommandesFiltrees.filter(precommande => 
                    precommande.pointVente === pointVente
                );
            }
            
            // Filtrer par label si spécifié
            if (label) {
                precommandesFiltrees = precommandesFiltrees.filter(precommande => 
                    precommande.label && precommande.label.toLowerCase().includes(label.toLowerCase())
                );
            }
            
            // Filtrer par statut si spécifié
            if (statut) {
                precommandesFiltrees = precommandesFiltrees.filter(precommande => 
                    precommande.statut === statut
                );
            }
            
            // Appliquer le tri
            if (sort && order) {
                precommandesFiltrees.sort((a, b) => {
                    const aValue = a[sort];
                    const bValue = b[sort];
                    if (order.toUpperCase() === 'DESC') {
                        return bValue > aValue ? 1 : -1;
        } else {
                        return aValue > bValue ? 1 : -1;
                    }
                });
            }
            
            // Appliquer la limite
            if (limit) {
                precommandesFiltrees = precommandesFiltrees.slice(0, parseInt(limit));
            }
            
            const formattedPrecommandes = precommandesFiltrees.map(precommande => ({
                id: precommande.id,
                Mois: precommande.mois,
                'Date Enregistrement': precommande.dateEnregistrement,
                'Date Réception': precommande.dateReception,
                Semaine: precommande.semaine,
                'Point de Vente': precommande.pointVente,
                Preparation: precommande.preparation,
                Catégorie: precommande.categorie,
                Produit: precommande.produit,
                PU: precommande.prixUnit,
                Nombre: precommande.nombre,
                Montant: precommande.montant,
                nomClient: precommande.nomClient,
                numeroClient: precommande.numeroClient,
                adresseClient: precommande.adresseClient,
                commentaire: precommande.commentaire,
                label: precommande.label,
                statut: precommande.statut || 'ouvert',
                commentaireStatut: precommande.commentaireStatut
            }));
            
            res.json({ success: true, precommandes: formattedPrecommandes });
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des pré-commandes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des pré-commandes',
            error: error.message
        });
    }
});

// Route pour convertir une pré-commande en vente réelle
app.post('/api/precommandes/:id/convert', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const precommandeId = req.params.id;
        const { dateVente, pointVenteDestination } = req.body;
        
        if (!dateVente || !pointVenteDestination) {
            return res.status(400).json({
                success: false,
                message: 'Date de vente et point de vente de destination sont requis'
            });
        }
        
        // Vérifier que la pré-commande existe
        const precommande = await Precommande.findByPk(precommandeId);
        if (!precommande) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pré-commande non trouvée'
            });
        }
        
        // Vérifier que la pré-commande est ouverte
        if (precommande.statut !== 'ouvert') {
            return res.status(400).json({
                success: false, 
                message: 'Seules les pré-commandes ouvertes peuvent être converties'
            });
        }
        
        // Vérifier que le point de vente de destination est actif
        if (!pointsVente[pointVenteDestination]?.active) {
            return res.status(400).json({
                success: false, 
                message: `Le point de vente ${pointVenteDestination} est désactivé`
            });
        }
        
        // Créer la vente réelle basée sur la pré-commande
        const dateVenteStandardisee = standardiserDateFormat(dateVente);
        
        const nouvelleVente = {
            mois: precommande.mois,
            date: dateVenteStandardisee,
            semaine: precommande.semaine,
            pointVente: pointVenteDestination,
            preparation: precommande.preparation,
            categorie: precommande.categorie,
            produit: precommande.produit,
            prixUnit: precommande.prixUnit,
            nombre: precommande.nombre,
            montant: precommande.montant,
            nomClient: precommande.nomClient,
            numeroClient: precommande.numeroClient,
            adresseClient: precommande.adresseClient ? 
                `${precommande.adresseClient} [Provenant de pré-commande]` : 
                '[Provenant de pré-commande]', // Marqueur pour identification
            creance: false
        };
        
        // Créer la vente dans la base de données
        const venteCreee = await Vente.create(nouvelleVente);
        
        // Marquer la pré-commande comme convertie au lieu de la supprimer
        await precommande.update({
            statut: 'convertie',
            commentaireStatut: `Convertie en vente le ${new Date().toLocaleDateString('fr-FR')}`
        });
        
        console.log(`Pré-commande ${precommandeId} convertie en vente ${venteCreee.id}`);
        
        res.json({ 
            success: true, 
            message: 'Pré-commande convertie en vente avec succès',
            venteCreee: {
                id: venteCreee.id,
                Mois: venteCreee.mois,
                Date: venteCreee.date,
                Semaine: venteCreee.semaine,
                'Point de Vente': venteCreee.pointVente,
                Preparation: venteCreee.preparation,
                Catégorie: venteCreee.categorie,
                Produit: venteCreee.produit,
                PU: venteCreee.prixUnit,
                Nombre: venteCreee.nombre,
                Montant: venteCreee.montant,
                nomClient: venteCreee.nomClient,
                numeroClient: venteCreee.numeroClient,
                adresseClient: venteCreee.adresseClient,
                creance: venteCreee.creance
            }
        });
    } catch (error) {
        console.error('Erreur lors de la conversion de la pré-commande:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la conversion de la pré-commande',
            error: error.message
        });
    }
});

// Endpoint pour modifier une pré-commande (seulement si statut = 'ouvert')
app.put('/api/precommandes/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const precommande = await Precommande.findByPk(id);
        
        if (!precommande) {
            return res.status(404).json({ success: false, message: 'Pré-commande non trouvée' });
        }
        
        // Vérifier que la pré-commande est ouverte
        if (precommande.statut !== 'ouvert') {
            return res.status(400).json({ 
                success: false, 
                message: 'Seules les pré-commandes ouvertes peuvent être modifiées' 
            });
        }
        
        // Mettre à jour la pré-commande
        await precommande.update(req.body);
        
        res.json({ success: true, message: 'Pré-commande modifiée avec succès', precommande });
    } catch (error) {
        console.error('Erreur lors de la modification:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la modification' });
    }
});

// Endpoint pour annuler une pré-commande
app.post('/api/precommandes/:id/cancel', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const { commentaire } = req.body;
        
        if (!commentaire || commentaire.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Un commentaire est requis pour annuler une pré-commande' 
            });
        }
        
        const precommande = await Precommande.findByPk(id);
        
        if (!precommande) {
            return res.status(404).json({ success: false, message: 'Pré-commande non trouvée' });
        }
        
        // Vérifier que la pré-commande est ouverte
        if (precommande.statut !== 'ouvert') {
            return res.status(400).json({ 
                success: false, 
                message: 'Seules les pré-commandes ouvertes peuvent être annulées' 
            });
        }
        
        // Marquer comme annulée
        await precommande.update({
            statut: 'annulee',
            commentaireStatut: commentaire
        });
        
        res.json({ success: true, message: 'Pré-commande annulée avec succès' });
    } catch (error) {
        console.error('Erreur lors de l\'annulation:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'annulation' });
    }
});

// Endpoint pour archiver une pré-commande
app.post('/api/precommandes/:id/archive', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const { commentaire } = req.body;
        
        if (!commentaire || commentaire.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Un commentaire est requis pour archiver une pré-commande' 
            });
        }
        
        const precommande = await Precommande.findByPk(id);
        
        if (!precommande) {
            return res.status(404).json({ success: false, message: 'Pré-commande non trouvée' });
        }
        
        // Vérifier que la pré-commande est ouverte
        if (precommande.statut !== 'ouvert') {
            return res.status(400).json({ 
                success: false, 
                message: 'Seules les pré-commandes ouvertes peuvent être archivées' 
            });
        }
        
        // Marquer comme archivée
        await precommande.update({
            statut: 'archivee',
            commentaireStatut: commentaire
        });
        
        res.json({ success: true, message: 'Pré-commande archivée avec succès' });
    } catch (error) {
        console.error('Erreur lors de l\'archivage:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'archivage' });
    }
});

// Route pour supprimer une pré-commande
app.delete('/api/precommandes/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const precommandeId = req.params.id;
        const user = req.session.user;
        
        // Trouver la pré-commande à supprimer
        const precommande = await Precommande.findByPk(precommandeId);
        
        if (!precommande) {
            return res.status(404).json({
                success: false, 
                message: 'Pré-commande non trouvée'
            });
        }
        
        // Vérifier l'accès par point de vente si nécessaire
        const userPointVente = user.pointVente;
        if (userPointVente !== 'tous' && precommande.pointVente !== userPointVente) {
            return res.status(403).json({
                success: false, 
                message: 'Accès non autorisé pour ce point de vente'
            });
        }
        
        // Vérifier les permissions de suppression selon le statut
        const isSuperviseur = user.role === 'superviseur' || user.role === 'admin';
        
        if (precommande.statut === 'ouvert') {
            // Tous les utilisateurs avec droits d'écriture peuvent supprimer les pré-commandes ouvertes
            // Pas de restriction supplémentaire
        } else if (precommande.statut === 'annulee' || precommande.statut === 'archivee' || precommande.statut === 'convertie') {
            // Seuls les superviseurs peuvent supprimer les pré-commandes annulées, archivées ou converties
            if (!isSuperviseur) {
                return res.status(403).json({
                    success: false,
                    message: 'Seuls les superviseurs peuvent supprimer les pré-commandes annulées, archivées ou converties'
                });
            }
        } else {
            // Statut non reconnu ou autre
            return res.status(400).json({
                success: false,
                message: 'Statut de pré-commande non autorisé pour la suppression'
            });
        }
        
        // Supprimer la pré-commande
        await precommande.destroy();
        
        console.log(`Pré-commande ${precommandeId} (statut: ${precommande.statut}) supprimée avec succès par ${user.username} (${user.role})`);
        
        res.json({ 
            success: true, 
            message: 'Pré-commande supprimée avec succès'
        });
    } catch (error) {
        console.error('Erreur lors de la suppression de la pré-commande:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la suppression de la pré-commande',
            error: error.message
        });
    }
});

// Route pour mettre à jour une pré-commande
app.put('/api/precommandes/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const precommandeId = req.params.id;
        const updatedPrecommande = req.body;
        
        // Trouver la pré-commande à mettre à jour
        const precommande = await Precommande.findByPk(precommandeId);
        
        if (!precommande) {
            return res.status(404).json({
                success: false,
                message: 'Pré-commande non trouvée'
            });
        }
        
        // Vérifier l'accès par point de vente si nécessaire
        const userPointVente = req.session.user.pointVente;
        if (userPointVente !== 'tous' && precommande.pointVente !== userPointVente) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé pour ce point de vente'
            });
        }
        
        // Préparer les données mises à jour
        const dataToUpdate = {
            mois: updatedPrecommande.mois || precommande.mois,
            dateEnregistrement: updatedPrecommande.dateEnregistrement ? 
                standardiserDateFormat(updatedPrecommande.dateEnregistrement) : precommande.dateEnregistrement,
            dateReception: updatedPrecommande.dateReception ? 
                standardiserDateFormat(updatedPrecommande.dateReception) : precommande.dateReception,
            semaine: updatedPrecommande.semaine || precommande.semaine,
            pointVente: updatedPrecommande.pointVente || precommande.pointVente,
            preparation: updatedPrecommande.preparation || precommande.preparation,
            categorie: updatedPrecommande.categorie || precommande.categorie,
            produit: updatedPrecommande.produit || precommande.produit,
            prixUnit: updatedPrecommande.prixUnit !== undefined ? 
                parseFloat(updatedPrecommande.prixUnit) : precommande.prixUnit,
            nombre: updatedPrecommande.nombre !== undefined ? 
                parseFloat(updatedPrecommande.nombre) : precommande.nombre,
            montant: updatedPrecommande.montant !== undefined ? 
                parseFloat(updatedPrecommande.montant) : precommande.montant,
            nomClient: updatedPrecommande.nomClient !== undefined ? 
                updatedPrecommande.nomClient : precommande.nomClient,
            numeroClient: updatedPrecommande.numeroClient !== undefined ? 
                updatedPrecommande.numeroClient : precommande.numeroClient,
            adresseClient: updatedPrecommande.adresseClient !== undefined ? 
                updatedPrecommande.adresseClient : precommande.adresseClient,
            commentaire: updatedPrecommande.commentaire !== undefined ? 
                updatedPrecommande.commentaire : precommande.commentaire,
            label: updatedPrecommande.label !== undefined ? 
                updatedPrecommande.label : precommande.label
        };
        
        // Mettre à jour la pré-commande
        await precommande.update(dataToUpdate);
        
        console.log(`Pré-commande ${precommandeId} mise à jour avec succès`);
        
            res.json({ 
                success: true, 
            message: 'Pré-commande mise à jour avec succès',
            precommande: {
                id: precommande.id,
                Mois: precommande.mois,
                'Date Enregistrement': precommande.dateEnregistrement,
                'Date Réception': precommande.dateReception,
                Semaine: precommande.semaine,
                'Point de Vente': precommande.pointVente,
                Preparation: precommande.preparation,
                Catégorie: precommande.categorie,
                Produit: precommande.produit,
                PU: precommande.prixUnit,
                Nombre: precommande.nombre,
                Montant: precommande.montant,
                nomClient: precommande.nomClient,
                numeroClient: precommande.numeroClient,
                adresseClient: precommande.adresseClient,
                commentaire: precommande.commentaire,
                label: precommande.label
            }
        });
    } catch (error) {
        console.error('Erreur lors de la mise à jour de la pré-commande:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la mise à jour de la pré-commande',
            error: error.message
        });
    }
});

// Routes pour la réconciliation
app.post('/api/reconciliation/save', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { date, reconciliation, cashPaymentData, comments } = req.body;
        
        if (!date || !reconciliation) {
            return res.status(400).json({ success: false, message: 'Date et données de réconciliation requises' });
        }
        
        // Vérifier si une réconciliation existe déjà pour cette date
        let existingReconciliation = await Reconciliation.findOne({ where: { date } });
        
        // Préparer les données à sauvegarder
        const dataToSave = {
            date,
            data: JSON.stringify(reconciliation),
            cashPaymentData: cashPaymentData ? JSON.stringify(cashPaymentData) : null,
            comments: comments ? JSON.stringify(comments) : null,
            version: 1
        };
        
        // Mettre à jour ou créer l'enregistrement
        if (existingReconciliation) {
            await existingReconciliation.update(dataToSave);
            console.log(`Réconciliation mise à jour pour la date ${date}`);
        } else {
            await Reconciliation.create(dataToSave);
            console.log(`Nouvelle réconciliation créée pour la date ${date}`);
        }
        
        res.json({ success: true, message: 'Réconciliation sauvegardée avec succès' });
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la réconciliation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la sauvegarde de la réconciliation',
            error: error.message
        });
    }
});

app.get('/api/reconciliation/load', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { date } = req.query;
        
        if (!date) {
            return res.status(400).json({ success: false, message: 'Date requise' });
        }
        
        const reconciliation = await Reconciliation.findOne({ where: { date } });
        
        if (!reconciliation) {
            return res.json({ 
                success: true, 
                message: 'Aucune réconciliation trouvée pour cette date',
                data: null
            });
        }
        
        // Préparer la réponse avec toutes les données
        const response = {
            id: reconciliation.id,
            date: reconciliation.date,
            createdAt: reconciliation.createdAt,
            updatedAt: reconciliation.updatedAt
        };
        
        // Données de réconciliation principales
        try {
            response.data = JSON.parse(reconciliation.data);
        } catch (e) {
            console.error('Erreur lors du parsing des données de réconciliation:', e);
            response.data = reconciliation.data;
        }
        
        // Format de compatibilité avec l'ancien système
        response.reconciliation = response.data;
        
        // Données de paiement en espèces
        if (reconciliation.cashPaymentData) {
            try {
                response.cashPaymentData = JSON.parse(reconciliation.cashPaymentData);
            } catch (e) {
                console.error('Erreur lors du parsing des données de paiement:', e);
                response.cashPaymentData = null;
            }
        }
        
        // Commentaires
        if (reconciliation.comments) {
            try {
                response.comments = JSON.parse(reconciliation.comments);
            } catch (e) {
                console.error('Erreur lors du parsing des commentaires:', e);
                response.comments = null;
            }
        }
        
        // Métadonnées
        response.version = reconciliation.version || 1;
        response.calculated = reconciliation.calculated !== false;
        
        res.json({ success: true, data: response });
    } catch (error) {
        console.error('Erreur lors du chargement de la réconciliation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du chargement de la réconciliation',
            error: error.message
        });
    }
});

// Route pour importer des données de paiement en espèces
app.post('/api/cash-payments/import', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { data } = req.body;
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ success: false, message: 'Données invalides' });
        }
        
        // Charger le mapping des références de paiement via la fonction utilitaire
        const paymentRefToPointDeVente = getPaymentRefMapping();
        
        // Convertir les dates du format "1 avr. 2025, 16:18" en format standard
        const processedData = data.map(item => {
            // Conversion de la date française en format ISO
            let createdAt = item.created_at;
            if (createdAt) {
                // Extraire juste la partie date (avant la virgule)
                const dateParts = createdAt.split(',');
                if (dateParts.length > 0) {
                    const dateStr = dateParts[0].trim();
                    const timePart = dateParts.length > 1 ? dateParts[1].trim() : '';
                    
                    // Remplacer les noms de mois français par leurs numéros
                    const monthMap = {
                        'janv.': '01', 'févr.': '02', 'mars': '03', 'avr.': '04',
                        'mai': '05', 'juin': '06', 'juil.': '07', 'août': '08',
                        'sept.': '09', 'oct.': '10', 'nov.': '11', 'déc.': '12'
                    };
                    
                    let day, month, year;
                    
                    // Format: "1 avr. 2025"
                    const dateMatch = dateStr.match(/(\d+)\s+([a-zéû.]+)\s+(\d{4})/i);
                    if (dateMatch) {
                        day = dateMatch[1].padStart(2, '0');
                        const monthName = dateMatch[2].toLowerCase();
                        month = monthMap[monthName] || '01'; // default to January if not found
                        year = dateMatch[3];
                        
                        // Créer la date ISO
                        createdAt = `${year}-${month}-${day}`;
                        
                        // Ajouter l'heure si disponible
                        if (timePart) {
                            createdAt += `T${timePart}:00`;
                        }
                    }
                }
            }
            
            // Mapper le payment_reference au point de vente
            // Normaliser la référence AVANT la recherche
            const rawRef = item.payment_reference;
            const normalizedRef = rawRef ? rawRef.toUpperCase().replace(/^G_/, 'V_') : null;
            const pointDeVente = normalizedRef ? (paymentRefToPointDeVente[normalizedRef] || 'Non spécifié') : 'Non spécifié';
            
            // Extraire juste la date (sans l'heure) pour le champ date
            const dateOnly = createdAt ? createdAt.split('T')[0] : null;
            
            return {
                ...item,
                created_at: createdAt,
                point_de_vente: pointDeVente,
                date: dateOnly
            };
        });
        
        // S'assurer que la table existe
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS cash_payments (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                created_at TIMESTAMP NOT NULL,
                amount FLOAT NOT NULL,
                merchant_fee FLOAT,
                customer_fee FLOAT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                entete_trans_type VARCHAR(255),
                psp_name VARCHAR(255),
                payment_category VARCHAR(255),
                payment_means VARCHAR(255),
                payment_reference VARCHAR(255),
                merchant_reference VARCHAR(255),
                trn_status VARCHAR(255),
                tr_id VARCHAR(255),
                cust_country VARCHAR(255),
                aggregation_mt VARCHAR(255),
                total_nom_marchand VARCHAR(255),
                total_marchand VARCHAR(255),
                merchant_id VARCHAR(255),
                name_first VARCHAR(255),
                point_de_vente VARCHAR(255),
                date DATE,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Insérer les données dans la base de données
        const insertedRecords = await CashPayment.bulkCreate(processedData);
        
        res.json({ 
            success: true, 
            message: `${insertedRecords.length} paiements importés avec succès` 
        });
    } catch (error) {
        console.error('Erreur lors de l\'importation des paiements en espèces:', error);
        res.status(500).json({ 
            success: false, 
            message: `Erreur lors de l'importation des paiements en espèces: ${error.message}` 
        });
    }
});

app.get('/api/cash-payments/aggregated', checkAuth, checkReadAccess, async (req, res) => {
    try {
        // S'assurer que la table existe
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS cash_payments (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                created_at TIMESTAMP NOT NULL,
                amount FLOAT NOT NULL,
                merchant_fee FLOAT,
                customer_fee FLOAT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                entete_trans_type VARCHAR(255),
                psp_name VARCHAR(255),
                payment_category VARCHAR(255),
                payment_means VARCHAR(255),
                payment_reference VARCHAR(255),
                merchant_reference VARCHAR(255),
                trn_status VARCHAR(255),
                tr_id VARCHAR(255),
                cust_country VARCHAR(255),
                aggregation_mt VARCHAR(255),
                total_nom_marchand VARCHAR(255),
                total_marchand VARCHAR(255),
                merchant_id VARCHAR(255),
                name_first VARCHAR(255),
                point_de_vente VARCHAR(255),
                date DATE,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Obtenir les données agrégées par date et point de vente
        const result = await sequelize.query(`
            SELECT date, point_de_vente, SUM(amount) as total
            FROM cash_payments
            GROUP BY date, point_de_vente
            ORDER BY date DESC, point_de_vente
        `, { type: sequelize.QueryTypes.SELECT });
        
        // Restructurer les données pour le format attendu par le frontend
        const aggregatedData = [];
        const dateMap = new Map();
        
        result.forEach(row => {
            // Normaliser la date au format YYYY-MM-DD (chaîne)
            let dateStr = row.date;
            if (row.date instanceof Date) {
                // Si c'est un objet Date, le convertir en chaîne YYYY-MM-DD
                dateStr = row.date.toISOString().split('T')[0];
            } else if (typeof row.date === 'string' && row.date.includes('T')) {
                // Si c'est une chaîne ISO avec l'heure, garder seulement la date
                dateStr = row.date.split('T')[0];
            }
            
            if (!dateMap.has(dateStr)) {
                dateMap.set(dateStr, {
                    date: dateStr,
                    points: []
                });
                aggregatedData.push(dateMap.get(dateStr));
            }
            
            dateMap.get(dateStr).points.push({
                point: row.point_de_vente,
                total: row.total
            });
        });
        
        res.json({
            success: true,
            data: aggregatedData
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des données de paiement agrégées:', error);
        res.status(500).json({ 
            success: false, 
            message: `Erreur lors de la récupération des données: ${error.message}` 
        });
    }
});

app.delete('/api/cash-payments/clear', checkAuth, checkStrictAdminOnly, async (req, res) => {
    try {
        // S'assurer que la table existe
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS cash_payments (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                created_at TIMESTAMP NOT NULL,
                amount FLOAT NOT NULL,
                merchant_fee FLOAT,
                customer_fee FLOAT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                entete_trans_type VARCHAR(255),
                psp_name VARCHAR(255),
                payment_category VARCHAR(255),
                payment_means VARCHAR(255),
                payment_reference VARCHAR(255),
                merchant_reference VARCHAR(255),
                trn_status VARCHAR(255),
                tr_id VARCHAR(255),
                cust_country VARCHAR(255),
                aggregation_mt VARCHAR(255),
                total_nom_marchand VARCHAR(255),
                total_marchand VARCHAR(255),
                merchant_id VARCHAR(255),
                name_first VARCHAR(255),
                point_de_vente VARCHAR(255),
                date DATE,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Supprimer toutes les données de la table
        await CashPayment.destroy({ where: {} });
        
        res.json({
            success: true,
            message: 'Toutes les données de paiement ont été supprimées'
        });
    } catch (error) {
        console.error('Erreur lors de la suppression des données de paiement:', error);
        res.status(500).json({ 
            success: false, 
            message: `Erreur lors de la suppression des données: ${error.message}` 
        });
    }
});

// Route pour mettre à jour le total agrégé d'un paiement cash
app.put('/api/cash-payments/update-aggregated', checkAuth, checkWriteAccess, async (req, res) => {
    const { date, point_de_vente, newTotal } = req.body;
    
    console.log(`Requête reçue pour mettre à jour le total agrégé:`, { date, point_de_vente, newTotal });

    if (date === undefined || point_de_vente === undefined || newTotal === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: 'Les champs date, point_de_vente et newTotal sont requis.' 
        });
    }
    
    // Convertir newTotal en nombre
    const totalAmount = parseFloat(newTotal);
    if (isNaN(totalAmount)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Le champ newTotal doit être un nombre valide.' 
        });
    }

    // Convertir la date reçue (format DD/MM/YYYY) au format SQL (YYYY-MM-DD)
    let sqlDate;
    try {
        const parts = date.split('/');
        if (parts.length !== 3) throw new Error('Format de date invalide.');
        sqlDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        // Valider la date convertie
        if (isNaN(new Date(sqlDate).getTime())) {
            throw new Error('Date invalide après conversion.');
        }
    } catch (e) {
        console.error("Erreur de format de date:", e);
        return res.status(400).json({ 
            success: false, 
            message: `Format de date invalide: ${date}. Utilisez DD/MM/YYYY.` 
        });
    }

    const transaction = await sequelize.transaction();
    try {
        // Trouver tous les paiements existants pour cette date et ce point de vente
        const existingPayments = await CashPayment.findAll({
            where: {
                date: sqlDate,
                point_de_vente: point_de_vente
            },
            order: [['created_at', 'ASC']], // Important pour identifier le "premier"
            transaction
        });

        if (existingPayments.length === 0) {
            await transaction.rollback();
            console.warn(`Aucun paiement trouvé pour date=${sqlDate}, pdv=${point_de_vente}. Impossible de mettre à jour.`);
            return res.status(404).json({ 
                success: false, 
                message: 'Aucun paiement existant trouvé pour cette date et ce point de vente.' 
            });
        }

        // Mettre à jour le premier enregistrement avec le nouveau total
        // et les autres à 0
        for (let i = 0; i < existingPayments.length; i++) {
            const payment = existingPayments[i];
            const updateAmount = (i === 0) ? totalAmount : 0;
            
            await payment.update({ amount: updateAmount }, { transaction });
            console.log(`Mise à jour du paiement ID ${payment.id} à ${updateAmount}`);
        }

        await transaction.commit();
        console.log(`Total agrégé mis à jour avec succès pour date=${sqlDate}, pdv=${point_de_vente}`);
        res.json({ 
            success: true, 
            message: 'Total agrégé mis à jour avec succès.' 
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Erreur lors de la mise à jour du total agrégé:', error);
        res.status(500).json({ 
            success: false, 
            message: `Erreur lors de la mise à jour du total: ${error.message}` 
        });
    }
});

// Route pour mettre à jour le point de vente d'un paiement cash
app.put('/api/cash-payments/update-point-vente', checkAuth, checkWriteAccess, async (req, res) => {
    const { date, old_point_de_vente, new_point_de_vente } = req.body;
    
    console.log(`Requête reçue pour mettre à jour le point de vente:`, { date, old_point_de_vente, new_point_de_vente });

    if (date === undefined || old_point_de_vente === undefined || new_point_de_vente === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: 'Les champs date, old_point_de_vente et new_point_de_vente sont requis.' 
        });
    }

    // Convertir la date reçue (format DD/MM/YYYY) au format SQL (YYYY-MM-DD)
    let sqlDate;
    try {
        const parts = date.split('/');
        if (parts.length !== 3) throw new Error('Format de date invalide.');
        sqlDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        // Valider la date convertie
        if (isNaN(new Date(sqlDate).getTime())) {
            throw new Error('Date invalide après conversion.');
        }
    } catch (e) {
        console.error("Erreur de format de date:", e);
        return res.status(400).json({ 
            success: false, 
            message: `Format de date invalide: ${date}. Utilisez DD/MM/YYYY.` 
        });
    }

    const transaction = await sequelize.transaction();
    try {
        // Trouver tous les paiements existants pour cette date et cet ancien point de vente
        const existingPayments = await CashPayment.findAll({
            where: {
                date: sqlDate,
                point_de_vente: old_point_de_vente
            },
            transaction
        });

        if (existingPayments.length === 0) {
            await transaction.rollback();
            console.warn(`Aucun paiement trouvé pour date=${sqlDate}, pdv=${old_point_de_vente}. Impossible de mettre à jour.`);
            return res.status(404).json({ 
                success: false, 
                message: 'Aucun paiement existant trouvé pour cette date et ce point de vente.' 
            });
        }

        // Mettre à jour tous les paiements avec le nouveau point de vente
        for (const payment of existingPayments) {
            await payment.update({ point_de_vente: new_point_de_vente }, { transaction });
            console.log(`Point de vente mis à jour pour le paiement ID ${payment.id}: ${old_point_de_vente} -> ${new_point_de_vente}`);
        }

        await transaction.commit();
        console.log(`Point de vente mis à jour avec succès pour date=${sqlDate}, pdv=${old_point_de_vente} -> ${new_point_de_vente}`);
        res.json({ 
            success: true, 
            message: 'Point de vente mis à jour avec succès.' 
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Erreur lors de la mise à jour du point de vente:', error);
        res.status(500).json({ 
            success: false, 
            message: `Erreur lors de la mise à jour du point de vente: ${error.message}` 
        });
    }
});

// Middleware pour vérifier les permissions admin uniquement pour les paiements manuels
const checkAdminOnly = (req, res, next) => {
    const userRole = req.session.user.role;
    const allowedRoles = ['admin', 'superviseur']; // Admin et Superviseur peuvent ajouter des paiements manuels
    
    if (allowedRoles.includes(userRole)) {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Accès refusé. Permissions administrateur ou superviseur requises.'
        });
    }
};

// Route pour ajouter manuellement un paiement en espèces
app.post('/api/cash-payments/manual', checkAuth, checkAdminOnly, async (req, res) => {
    try {
        const { date, pointVente, amount, reference, comment } = req.body;
        const username = req.session.user.username;
        
        // Validation des données
        if (!date || !pointVente || amount === undefined || amount === null) {
            return res.status(400).json({
                success: false,
                message: 'Date, point de vente et montant sont requis'
            });
        }
        
        // Vérifier que le point de vente existe et est actif
        const pointsVenteData = await configService.getPointsVenteAsLegacy();
        if (!pointsVenteData[pointVente] || !pointsVenteData[pointVente].active) {
            return res.status(400).json({
                success: false,
                message: `Le point de vente "${pointVente}" n'existe pas ou n'est pas actif`
            });
        }
        
        // Convertir la date au format ISO YYYY-MM-DD pour PostgreSQL
        // La date peut arriver en format "2025-12-04", "04-Dec-2025", "04/12/2025", etc.
        let dateObj;
        if (date.includes('-') && date.length === 10 && date.indexOf('-') === 4) {
            // Format ISO: 2025-12-04
            dateObj = new Date(date);
        } else if (date.includes('/')) {
            // Format DD/MM/YYYY - convertir correctement
            const parts = date.split('/');
            dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
        } else if (date.includes('-')) {
            // Format DD-Mon-YYYY (ex: 04-Dec-2025)
            dateObj = new Date(date);
        } else {
            dateObj = new Date(date);
        }
        
        // Vérifier que la date est valide
        if (isNaN(dateObj.getTime())) {
            return res.status(400).json({
                success: false,
                message: `Format de date invalide: ${date}. Utilisez YYYY-MM-DD ou DD/MM/YYYY`
            });
        }
        
        // Format ISO pour PostgreSQL (YYYY-MM-DD) - IMPORTANT: ne pas utiliser DD/MM/YYYY car PostgreSQL l'interprète mal
        const formattedDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        // Format d'affichage pour les messages (DD/MM/YYYY)
        const displayDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
        
        // DEBUG: Log pour vérifier les dates
        console.log(`[CASH PAYMENT DEBUG] Date reçue: "${date}", DateObj: ${dateObj.toISOString()}, formattedDate: "${formattedDate}", displayDate: "${displayDate}"`);
        
        // Vérifier s'il existe déjà un paiement pour cette date et ce point de vente
        const existingPayment = await CashPayment.findOne({
            where: {
                date: formattedDate,
                point_de_vente: pointVente
            }
        });
        
        if (existingPayment) {
            // Mettre à jour le total existant
            const currentAmount = existingPayment.amount || 0;
            const newAmount = currentAmount + parseFloat(amount);
            
            // Construire le nouveau commentaire
            const newComment = comment || `Ajout manuel: ${amount} FCFA par ${username}`;
            const updatedComment = existingPayment.comment ? 
                `${existingPayment.comment}; ${newComment}` : 
                newComment;
            
            await existingPayment.update({
                amount: newAmount,
                comment: updatedComment,
                is_manual: true,
                created_by: username
            });
            
            console.log(`Paiement manuel ajouté - Mise à jour: ${pointVente} ${displayDate} - Nouveau total: ${newAmount} FCFA (ajout de ${amount} FCFA)`);
        } else {
            // Créer un nouveau paiement
            await CashPayment.create({
                created_at: new Date(), // Requis par le modèle
                date: formattedDate, // Format ISO YYYY-MM-DD pour PostgreSQL
                point_de_vente: pointVente,
                amount: parseFloat(amount),
                reference: reference || '',
                comment: comment || `Paiement manuel ajouté par ${username}`,
                is_manual: true,
                created_by: username
            });
            
            console.log(`Nouveau paiement manuel créé: ${pointVente} ${displayDate} - ${amount} FCFA`);
        }
        
        res.json({
            success: true,
            message: `Paiement de ${amount} FCFA ajouté avec succès pour ${pointVente} le ${displayDate}`
        });
        
    } catch (error) {
        console.error('Erreur lors de l\'ajout du paiement manuel:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de l\'ajout du paiement'
        });
    }
});

// Route pour récupérer le mapping des références de paiement
app.get('/api/payment-ref-mapping', checkAuth, (req, res) => {
    try {
        const paymentRefMapping = getPaymentRefMapping();
        res.json({
            success: true,
            data: paymentRefMapping
        });
    } catch (error) {
        console.error('Erreur lors de la lecture du mapping des références:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la lecture du mapping des références'
        });
    }
});

// Middleware pour vérifier les permissions admin ou superutilisateur pour la configuration
const checkAdminOrSuperUser = (req, res, next) => {
    const userRole = req.session.user.username.toUpperCase();
    const adminUsers = ['SALIOU', 'OUSMANE'];
    const superUsers = ['NADOU', 'PAPI'];
    
    if (adminUsers.includes(userRole) || superUsers.includes(userRole)) {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Accès refusé. Permissions administrateur ou superutilisateur requises.'
        });
    }
};

// Route pour mettre à jour le mapping des références de paiement
app.post('/api/payment-ref-mapping', checkAuth, checkAdminOrSuperUser, async (req, res) => {
    try {
        const { mapping } = req.body;
        const username = req.session.user.username;
        
        if (!mapping || typeof mapping !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Données de mapping invalides'
            });
        }
        
        const filePath = path.join(__dirname, 'data', 'by-date', 'paymentRefMapping.js');
        
        // Créer une sauvegarde avant modification
        const backupPath = path.join(__dirname, 'data', 'by-date', `paymentRefMapping.backup.${Date.now()}.js`);
        try {
            const fs = require('fs');
            fs.copyFileSync(filePath, backupPath);
            console.log(`Sauvegarde créée: ${backupPath}`);
        } catch (backupError) {
            console.warn('Impossible de créer une sauvegarde:', backupError);
        }
        
        // Formater le contenu du fichier JavaScript
        const fileContent = `const paymentRefMapping = ${JSON.stringify(mapping, null, 4)};

module.exports = paymentRefMapping;`;
        
        // Écrire le nouveau fichier
        const fs = require('fs');
        fs.writeFileSync(filePath, fileContent, 'utf8');
        
        // Invalider le cache de require pour recharger le module
        delete require.cache[require.resolve('./data/by-date/paymentRefMapping')];
        
        console.log(`Mapping des références de paiement mis à jour par ${username}`);
        
        res.json({
            success: true,
            message: 'Mapping des références mis à jour avec succès'
        });
        
    } catch (error) {
        console.error('Erreur lors de la mise à jour du mapping:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la mise à jour du mapping'
        });
    }
});

// Route pour importer des données de paiement en espèces depuis une source externe
app.post('/api/external/cash-payment/import', validateApiKey, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const data = req.body;
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'Données invalides - un tableau de paiements est requis' });
        }
        
        // Charger le mapping des références de paiement via la fonction utilitaire
        const paymentRefToPointDeVente = getPaymentRefMapping();
        
        // Vérifier les doublons par tr_id (ID externe)
        const externalIds = data.map(item => item.id).filter(Boolean);
        const existingPayments = await CashPayment.findAll({
            where: {
                tr_id: {
                    [Op.in]: externalIds
                }
            },
            attributes: ['tr_id'],
            transaction
        });
        
        const existingIds = new Set(existingPayments.map(p => p.tr_id));
        const newData = data.filter(item => !existingIds.has(item.id));
        
        if (newData.length === 0) {
            await transaction.rollback();
            return res.json({ 
                success: true, 
                message: `Aucun nouveau paiement à importer (${existingIds.size} doublons détectés)`,
                importedCount: 0,
                duplicatesCount: existingIds.size
            });
        }
        
        // Traitement des données pour mapper le format externe vers le format interne
        const processedData = newData.map(item => {
            // Conversion du timestamp vers created_at
            let createdAt = item.timestamp;
            let dateOnly = null;
            
            if (createdAt) {
                try {
                    // Le timestamp est au format "2025-05-28 22:11:18.98574"
                    const dateObj = new Date(createdAt);
                    createdAt = dateObj.toISOString();
                    dateOnly = dateObj.toISOString().split('T')[0]; // Format YYYY-MM-DD
                } catch (error) {
                    console.warn('Erreur de conversion de date pour:', createdAt);
                    createdAt = new Date().toISOString();
                    dateOnly = new Date().toISOString().split('T')[0];
                }
            } else {
                createdAt = new Date().toISOString();
                dateOnly = new Date().toISOString().split('T')[0];
            }
            
            // Mapper le paymentReference au point de vente (cohérent avec l'endpoint existant)
            // Normaliser la référence en majuscules ET gérer la conversion G_ -> V_
            const paymentRef = item.paymentReference;
            const normalizedRef = paymentRef ? paymentRef.toUpperCase().replace(/^G_/, 'V_') : null;
            const pointDeVente = normalizedRef ? (paymentRefToPointDeVente[normalizedRef] || 'Non spécifié') : 'Non spécifié';
            
            return {
                // Champs mappés du format externe vers le format interne
                name: item.customerObject?.name || null,
                created_at: createdAt,
                amount: parseFloat(item.amount) || 0,
                merchant_fee: parseFloat(item.merchantFees) || 0,
                customer_fee: parseFloat(item.customerFees) || 0,
                customer_name: item.customerObject?.name || null,
                customer_phone: item.customerObject?.phone || item.paymentMeans || null,
                entete_trans_type: item.type || null,
                psp_name: item.pspName || null,
                payment_category: item.orderType || null,
                payment_means: item.paymentMeans || null,
                payment_reference: item.paymentReference || null,
                merchant_reference: item.merchantReference || null,
                trn_status: item.status || null,
                tr_id: item.id || null, // Utilisé pour détecter les doublons
                cust_country: item.customerObject?.country || null,
                aggregation_mt: null,
                total_nom_marchand: null,
                total_marchand: null,
                merchant_id: item.merchantId || null,
                name_first: item.customerObject?.name ? item.customerObject.name.split(' ')[0] : null,
                point_de_vente: pointDeVente,
                date: dateOnly
            };
        });
        
        // S'assurer que la table existe
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS cash_payments (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                created_at TIMESTAMP NOT NULL,
                amount FLOAT NOT NULL,
                merchant_fee FLOAT,
                customer_fee FLOAT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                entete_trans_type VARCHAR(255),
                psp_name VARCHAR(255),
                payment_category VARCHAR(255),
                payment_means VARCHAR(255),
                payment_reference VARCHAR(255),
                merchant_reference VARCHAR(255),
                trn_status VARCHAR(255),
                tr_id VARCHAR(255),
                cust_country VARCHAR(255),
                aggregation_mt VARCHAR(255),
                total_nom_marchand VARCHAR(255),
                total_marchand VARCHAR(255),
                merchant_id VARCHAR(255),
                name_first VARCHAR(255),
                point_de_vente VARCHAR(255),
                date DATE,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `, { transaction });
        
        // Insérer les données dans la base de données
        const insertedRecords = await CashPayment.bulkCreate(processedData, { transaction });
        
        await transaction.commit();
        
        res.json({ 
            success: true, 
            message: `${insertedRecords.length} paiements importés avec succès depuis la source externe (${existingIds.size} doublons ignorés)`,
            importedCount: insertedRecords.length,
            duplicatesCount: existingIds.size
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Erreur lors de l\'importation des paiements externes:', error);
        res.status(500).json({ 
            success: false, 
            message: `Erreur lors de l'importation des paiements externes: ${error.message}` 
        });
    }
});

// ===========================================================================
// SUIVI ACHAT BOEUF - PostgreSQL Implementation
// ===========================================================================

// GET endpoint to retrieve beef purchase data
app.get('/api/achats-boeuf', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const achats = await AchatBoeuf.findAll({
            order: [['date', 'DESC']],
        });
        res.json(achats);
    } catch (err) {
        console.error('Error fetching beef purchases:', err);
        res.status(500).json({ error: 'Failed to fetch beef purchases' });
    }
});

// POST endpoint to save purchase data
app.post('/api/achats-boeuf', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        // Use original field names matching the updated model
        const { mois, date, bete, prix, abats, frais_abattage, nbr_kg, prix_achat_kg, prix_achat_kg_sans_abats, commentaire } = req.body;
        
        // Basic validation
        if (!date || !bete) { // Adjust validation as needed
            return res.status(400).json({ error: 'Champs requis manquants (date, bete)' });
        }

        // Format date (keep YYYY-MM-DD)
        let formattedDate;
        let yearInt;
        try {
            const dateObj = new Date(date);
            formattedDate = dateObj.toISOString().split('T')[0]; 
            yearInt = dateObj.getFullYear(); // Still useful to store year separately
        } catch (dateError) {
            console.error("Invalid date format received:", date);
            return res.status(400).json({ error: 'Format de date invalide' });
        }
        
        // Create using the updated model structure
        const newAchat = await AchatBoeuf.create({
            mois: mois || null,              // Keep mois as provided (string)
            annee: yearInt,                 // Store extracted year
            date: formattedDate,            
            bete: bete,                    // Use bete directly
            prix: prix || 0,                // Use prix directly
            abats: abats || 0,            
            frais_abattage: frais_abattage || 0, // Use frais_abattage
            nbr_kg: nbr_kg || 0,           // Use nbr_kg directly
            prix_achat_kg: prix_achat_kg || 0, // Use prix_achat_kg directly
            prix_achat_kg_sans_abats: prix_achat_kg_sans_abats || 0, // Use prix_achat_kg_sans_abats directly
            commentaire: commentaire || null 
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Données d\'achat de bétail enregistrées avec succès',
            id: newAchat.id
        });
    } catch (err) {
        console.error('Error saving beef purchase data:', err);
        if (err.name === 'SequelizeValidationError') {
            return res.status(400).json({ error: err.errors.map(e => e.message).join(', ') });
        }
        res.status(500).json({ error: 'Échec de l\'enregistrement des données d\'achat de bétail' });
    }
});

// DELETE endpoint to remove purchase data
app.delete('/api/achats-boeuf/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const id = req.params.id;
        const numDeleted = await AchatBoeuf.destroy({
            where: { id: id }
        });

        if (numDeleted === 1) {
            res.json({ success: true, message: 'Entry deleted successfully' });
        } else {
            res.status(404).json({ error: 'Entry not found' });
        }
    } catch (err) {
        console.error('Error deleting beef purchase data:', err);
        res.status(500).json({ error: 'Failed to delete beef purchase data' });
    }
});

// GET endpoint for monthly statistics
app.get('/api/achats-boeuf/stats/monthly', checkAuth, async (req, res) => {
    try {
        const stats = await AchatBoeuf.findAll({
            attributes: [
                [fn('EXTRACT', literal('YEAR FROM date')), 'year'],
                [fn('EXTRACT', literal('MONTH FROM date')), 'month'],
                [fn('TO_CHAR', col('date'), 'Mon YYYY'), 'month_name'],
                [fn('SUM', col('prix')), 'total_prix'],
                [fn('SUM', col('abats')), 'total_abats'],
                [fn('SUM', col('frais_abattage')), 'total_frais_abattage'],
                [fn('SUM', col('nbr_kg')), 'total_kg'],
                [literal(`CASE WHEN SUM(nbr_kg) > 0 THEN SUM(prix) / SUM(nbr_kg) ELSE 0 END`), 'avg_prix_kg']
            ],
            group: ['year', 'month', 'month_name'],
            order: [
                [literal('year'), 'DESC'],
                [literal('month'), 'DESC']
            ],
            raw: true // Get plain objects instead of Sequelize instances
        });
        
        res.json(stats);
    } catch (err) {
        console.error('Error fetching monthly stats:', err);
        res.status(500).json({ error: 'Failed to fetch monthly statistics' });
    }
});

// ===========================================================================
// PERFORMANCE ACHAT - PostgreSQL Implementation
// ===========================================================================

// GET endpoint to retrieve all acheteurs from acheteur.json
app.get('/api/acheteurs', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const acheteursPath = path.join(__dirname, 'acheteur.json');
        const acheteursData = await fsPromises.readFile(acheteursPath, 'utf8');
        const acheteurs = JSON.parse(acheteursData);
        
        // Filter only active buyers
        const activeAcheteurs = acheteurs.filter(a => a.actif !== false);
        
        res.json({ success: true, acheteurs: activeAcheteurs });
    } catch (err) {
        console.error('Error loading acheteurs:', err);
        res.status(500).json({ success: false, error: 'Failed to load acheteurs' });
    }
});

// GET endpoint to retrieve performance achat data with filters
app.get('/api/performance-achat', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { startDate, endDate, idAcheteur, bete } = req.query;
        
        let whereConditions = {};
        
        // Filter by date range
        if (startDate && endDate) {
            whereConditions.date = {
                [Op.between]: [startDate, endDate]
            };
        } else if (startDate) {
            whereConditions.date = {
                [Op.gte]: startDate
            };
        } else if (endDate) {
            whereConditions.date = {
                [Op.lte]: endDate
            };
        }
        
        // Filter by acheteur
        if (idAcheteur) {
            whereConditions.id_acheteur = idAcheteur;
        }
        
        // Filter by bete type
        if (bete) {
            whereConditions.bete = bete;
        }
        
        const performances = await PerformanceAchat.findAll({
            where: whereConditions,
            order: [['date', 'DESC'], ['id', 'DESC']]
        });
        
        // Load acheteurs for reference
        const acheteursPath = path.join(__dirname, 'acheteur.json');
        const acheteursData = await fsPromises.readFile(acheteursPath, 'utf8');
        const acheteurs = JSON.parse(acheteursData);
        
        // First, calculate coherence by date+bete (global check per date)
        const coherenceByDate = new Map();
        
        // Group performances by date+bete to calculate total poids_reel
        const dateGroups = {};
        performances.forEach(perf => {
            const perfData = perf.toJSON();
            const key = `${perfData.date}_${perfData.bete}`;
            if (!dateGroups[key]) {
                dateGroups[key] = {
                    date: perfData.date,
                    bete: perfData.bete,
                    totalPoidsReel: 0
                };
            }
            if (perfData.poids_reel) {
                dateGroups[key].totalPoidsReel += perfData.poids_reel;
            }
        });
        
        // Calculate coherence for each date+bete group
        for (const [key, group] of Object.entries(dateGroups)) {
            const sommeAchats = await AchatBoeuf.sum('nbr_kg', {
                where: {
                    date: group.date,
                    bete: group.bete
                }
            });
            
            const sommeAchatsKg = sommeAchats || 0;
            const difference = Math.abs(group.totalPoidsReel - sommeAchatsKg);
            const isCoherent = difference <= 0.5;
            
            coherenceByDate.set(key, {
                coherence: isCoherent ? 'COHÉRENT' : 'INCOHÉRENT',
                somme_achats_kg: sommeAchatsKg,
                somme_poids_reel: group.totalPoidsReel,
                coherence_difference: group.totalPoidsReel - sommeAchatsKg
            });
        }
        
        // Enrich performance data with calculations
        const enrichedPerformances = performances.map((perf) => {
            const perfData = perf.toJSON();
            
            // Find acheteur info
            const acheteur = acheteurs.find(a => a.id === perfData.id_acheteur);
            perfData.acheteur_nom = acheteur ? `${acheteur.prenom} ${acheteur.nom}` : 'Inconnu';
            
            // Calculate performance metrics
            if (perfData.poids_estime && perfData.poids_reel && perfData.poids_reel !== 0) {
                perfData.ecart = perfData.poids_estime - perfData.poids_reel;
                perfData.erreur = ((perfData.poids_estime - perfData.poids_reel) / perfData.poids_reel) * 100;
                perfData.precision = 100 - Math.abs(perfData.erreur);
                
                // Determine estimation type
                if (perfData.erreur > 0) {
                    perfData.type_estimation = 'Surestimation';
                } else if (perfData.erreur < 0) {
                    perfData.type_estimation = 'Sous-estimation';
                } else {
                    perfData.type_estimation = 'Parfait';
                }
                
                // Calculate penalized score (surestimation x2)
                perfData.score_penalite = perfData.erreur > 0 
                    ? Math.abs(perfData.erreur) * 2 
                    : Math.abs(perfData.erreur);
            } else {
                perfData.ecart = null;
                perfData.erreur = null;
                perfData.precision = null;
                perfData.type_estimation = null;
                perfData.score_penalite = null;
            }
            
            // Apply coherence from global calculation by date
            if (perfData.date && perfData.bete) {
                const key = `${perfData.date}_${perfData.bete}`;
                const coherenceData = coherenceByDate.get(key);
                
                if (coherenceData) {
                    perfData.coherence = coherenceData.coherence;
                    perfData.somme_achats_kg = coherenceData.somme_achats_kg;
                    perfData.somme_poids_reel = coherenceData.somme_poids_reel;
                    perfData.coherence_difference = coherenceData.coherence_difference;
                } else {
                    perfData.coherence = null;
                    perfData.somme_achats_kg = null;
                    perfData.somme_poids_reel = null;
                    perfData.coherence_difference = null;
                }
            } else {
                perfData.coherence = null;
                perfData.somme_achats_kg = null;
                perfData.somme_poids_reel = null;
                perfData.coherence_difference = null;
            }
            
            return perfData;
        });
        
        res.json({ success: true, performances: enrichedPerformances });
    } catch (err) {
        console.error('Error fetching performance achat:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch performance data' });
    }
});

// POST endpoint to create new performance achat entry
app.post('/api/performance-achat', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const {
            date,
            id_acheteur,
            bete,
            prix,
            poids_estime,
            poids_reel,
            commentaire
        } = req.body;
        
        // Validation
        if (!date || !id_acheteur || !bete) {
            return res.status(400).json({ 
                success: false, 
                error: 'Champs requis manquants (date, id_acheteur, bete)' 
            });
        }
        
        // Verify acheteur exists
        const acheteursPath = path.join(__dirname, 'acheteur.json');
        const acheteursData = await fsPromises.readFile(acheteursPath, 'utf8');
        const acheteurs = JSON.parse(acheteursData);
        const acheteurExists = acheteurs.find(a => a.id === id_acheteur);
        
        if (!acheteurExists) {
            return res.status(400).json({ 
                success: false, 
                error: 'Acheteur non trouvé' 
            });
        }
        
        // Get user info from session
        const username = req.session?.user?.username || 'Unknown';
        
        const newPerformance = await PerformanceAchat.create({
            date,
            id_acheteur,
            bete: bete.toLowerCase(),
            prix: prix || null,
            poids_estime: poids_estime || null,
            poids_estime_timestamp: poids_estime ? new Date() : null,
            poids_estime_updated_by: poids_estime ? username : null,
            poids_reel: poids_reel || null,
            poids_reel_timestamp: poids_reel ? new Date() : null,
            poids_reel_updated_by: poids_reel ? username : null,
            commentaire: commentaire || null,
            locked: false,
            created_by: username
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Performance créée avec succès',
            performance: newPerformance 
        });
    } catch (err) {
        console.error('Error creating performance achat:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create performance entry' 
        });
    }
});

// PUT endpoint to update performance achat entry
app.put('/api/performance-achat/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            date,
            id_acheteur,
            bete,
            prix,
            poids_estime,
            poids_reel,
            commentaire
        } = req.body;
        
        const performance = await PerformanceAchat.findByPk(id);
        
        if (!performance) {
            return res.status(404).json({ 
                success: false, 
                error: 'Performance entry not found' 
            });
        }
        
        // Check if locked
        if (performance.locked) {
            // Only admins can modify locked entries
            if (req.session?.user?.role !== 'administrateur') {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Entrée verrouillée. Seul un administrateur peut la modifier.' 
                });
            }
        }
        
        // Check 24h rule for poids_estime modification
        if (poids_estime !== undefined && performance.poids_estime_timestamp) {
            const now = new Date();
            const timestampDate = new Date(performance.poids_estime_timestamp);
            const hoursDifference = (now - timestampDate) / (1000 * 60 * 60);
            
            // If more than 24h, only admin can modify
            if (hoursDifference > 24 && req.session?.user?.role !== 'administrateur') {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Impossible de modifier le poids estimé après 24h. Contactez un administrateur.' 
                });
            }
        }
        
        // Get user info
        const username = req.session?.user?.username || 'Unknown';
        
        // Update fields
        const updateData = {};
        
        if (date !== undefined) updateData.date = date;
        if (id_acheteur !== undefined) updateData.id_acheteur = id_acheteur;
        if (bete !== undefined) updateData.bete = bete.toLowerCase();
        if (prix !== undefined) updateData.prix = prix;
        if (commentaire !== undefined) updateData.commentaire = commentaire;
        
        if (poids_estime !== undefined) {
            updateData.poids_estime = poids_estime;
            updateData.poids_estime_timestamp = new Date();
            updateData.poids_estime_updated_by = username;
        }
        
        if (poids_reel !== undefined) {
            updateData.poids_reel = poids_reel;
            updateData.poids_reel_timestamp = new Date();
            updateData.poids_reel_updated_by = username;
        }
        
        await performance.update(updateData);
        
        res.json({ 
            success: true, 
            message: 'Performance mise à jour avec succès',
            performance 
        });
    } catch (err) {
        console.error('Error updating performance achat:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update performance entry' 
        });
    }
});

// DELETE endpoint to delete performance achat entry
app.delete('/api/performance-achat/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { id } = req.params;
        
        const performance = await PerformanceAchat.findByPk(id);
        
        if (!performance) {
            return res.status(404).json({ 
                success: false, 
                error: 'Performance entry not found' 
            });
        }
        
        // Check if locked - only admin can delete locked entries
        if (performance.locked && req.session?.user?.role !== 'administrateur') {
            return res.status(403).json({ 
                success: false, 
                error: 'Entrée verrouillée. Seul un administrateur peut la supprimer.' 
            });
        }
        
        await performance.destroy();
        
        res.json({ 
            success: true, 
            message: 'Performance supprimée avec succès' 
        });
    } catch (err) {
        console.error('Error deleting performance achat:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete performance entry' 
        });
    }
});

// GET endpoint for statistics and rankings
app.get('/api/performance-achat/stats', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let whereConditions = {};
        
        if (startDate && endDate) {
            whereConditions.date = {
                [Op.between]: [startDate, endDate]
            };
        }
        
        // Get all performances with both poids_estime and poids_reel
        const performances = await PerformanceAchat.findAll({
            where: {
                ...whereConditions,
                poids_estime: { [Op.ne]: null },
                poids_reel: { [Op.ne]: null }
            }
        });
        
        // Load acheteurs
        const acheteursPath = path.join(__dirname, 'acheteur.json');
        const acheteursData = await fsPromises.readFile(acheteursPath, 'utf8');
        const acheteurs = JSON.parse(acheteursData);
        
        // Calculate stats by acheteur
        const statsMap = {};
        
        performances.forEach(perf => {
            if (perf.poids_reel === 0) return; // Skip division by zero
            
            const erreur = ((perf.poids_estime - perf.poids_reel) / perf.poids_reel) * 100;
            const precision = 100 - Math.abs(erreur);
            const scorePenalite = erreur > 0 
                ? Math.abs(erreur) * 2  // Surestimation pénalisée x2
                : Math.abs(erreur);     // Sous-estimation normale
            
            // Convert to score out of 20 (20 = perfect, 0 = worst)
            // Score = max(0, 20 - scorePenalite)
            const scoreSur20 = Math.max(0, Math.min(20, 20 - scorePenalite));
            
            if (!statsMap[perf.id_acheteur]) {
                const acheteur = acheteurs.find(a => a.id === perf.id_acheteur);
                statsMap[perf.id_acheteur] = {
                    id_acheteur: perf.id_acheteur,
                    nom: acheteur ? `${acheteur.prenom} ${acheteur.nom}` : 'Inconnu',
                    total_estimations: 0,
                    total_surestimations: 0,
                    total_sous_estimations: 0,
                    total_parfait: 0,
                    score_moyen: 0,
                    precision_moyenne: 0,
                    scores: [],
                    precisions: []
                };
            }
            
            statsMap[perf.id_acheteur].total_estimations++;
            statsMap[perf.id_acheteur].scores.push(scoreSur20);
            statsMap[perf.id_acheteur].precisions.push(precision);
            
            if (erreur > 0) {
                statsMap[perf.id_acheteur].total_surestimations++;
            } else if (erreur < 0) {
                statsMap[perf.id_acheteur].total_sous_estimations++;
            } else {
                statsMap[perf.id_acheteur].total_parfait++;
            }
        });
        
        // Calculate average scores and precision
        const rankings = Object.values(statsMap).map(stat => {
            stat.score_moyen = stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length;
            stat.precision_moyenne = stat.precisions.reduce((a, b) => a + b, 0) / stat.precisions.length;
            delete stat.scores; // Remove raw scores from response
            delete stat.precisions; // Remove raw precisions from response
            return stat;
        });
        
        // Sort by score (higher is better)
        rankings.sort((a, b) => b.score_moyen - a.score_moyen);
        
        res.json({ 
            success: true, 
            rankings,
            total_performances: performances.length
        });
    } catch (err) {
        console.error('Error fetching performance stats:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch performance statistics' 
        });
    }
});

// ============================================================================
// OCR IMPORT - Extraction de données depuis images de tickets de caisse
// ============================================================================

/**
 * POST /api/ocr-extract
 * Extrait les données de vente depuis une image de ticket de caisse
 * Utilise GPT-4o Vision pour l'OCR et l'extraction structurée
 */
app.post('/api/ocr-extract', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { image, mimeType } = req.body;
        
        if (!image) {
            return res.status(400).json({
                success: false,
                error: 'Image requise (format base64)'
            });
        }

        // Vérifier que OpenAI est configuré
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'OpenAI API key non configurée'
            });
        }

        console.log('🔍 OCR Extract: Processing image...');

        const OpenAI = require('openai');
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Helper function pour appeler l'API OCR
        const callOCRAPI = async (imageData, mimeType, temperature, attemptNumber) => {
            console.log(`🔍 OCR Attempt ${attemptNumber} (temp: ${temperature})...`);
            
            const response = await openai.chat.completions.create({
                model: process.env.OPENAI_MODEL || 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Analyse ce ticket "X de caisse" Sage 100cloud. Extrait TOUTES les lignes de produits avec leur montant (Chiffre d\'affaires TTC), quantité (Qtés) et prix unitaire (Prix de vente moyen). Retourne le JSON complet.'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType || 'image/jpeg'};base64,${imageData}`,
                                    detail: 'high'
                                }
                            }
                        ]
                    }
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'OCRData',
                        strict: true,
                        schema: ocrSchema
                    }
                },
                max_tokens: 4096,
                temperature: temperature
            });
            
            return response;
        };

        // Helper function pour valider la qualité de l'extraction
        const validateExtraction = (data) => {
            const issues = [];
            
            if (!data.items || data.items.length === 0) {
                issues.push('Aucun item extrait');
            }
            
            if (!data.total_general || data.total_general === 0) {
                issues.push('Total général manquant');
            }
            
            const itemsWithMissingData = data.items.filter(item => 
                !item.quantite || !item.prix_unitaire || !item.montant
            ).length;
            
            if (itemsWithMissingData > 0) {
                issues.push(`${itemsWithMissingData} items avec données manquantes`);
            }
            
            const completeness = data.items.length > 0 ? 
                ((data.items.length - itemsWithMissingData) / data.items.length) * 100 : 0;
            
            return {
                isComplete: issues.length === 0 && completeness >= 80,
                completeness: completeness,
                issues: issues,
                itemCount: data.items.length
            };
        };

        // Helper function pour merger deux extractions
        const mergeExtractions = (data1, data2) => {
            console.log('🔄 Merging two extractions...');
            
            // Prendre les items les plus complets
            const items1 = data1.items || [];
            const items2 = data2.items || [];
            
            // Utiliser le résultat avec le plus d'items
            let bestItems = items1.length >= items2.length ? items1 : items2;
            
            // Merger les items: compléter les données manquantes
            const mergedItems = bestItems.map((item, idx) => {
                const otherItem = items2[idx] || items1[idx];
                
                return {
                    article_original: item.article_original || otherItem?.article_original || '',
                    produit: item.produit || otherItem?.produit || '',
                    quantite: item.quantite || otherItem?.quantite || 0,
                    unite: item.unite || otherItem?.unite || 'unite',
                    prix_unitaire: item.prix_unitaire || otherItem?.prix_unitaire || 0,
                    montant: item.montant || otherItem?.montant || 0
                };
            });
            
            return {
                items: mergedItems,
                total_general: data1.total_general || data2.total_general || 0,
                date_ticket: data1.date_ticket || data2.date_ticket || null,
                source: data1.source || data2.source || 'Inconnu'
            };
        };

        // Prompt pour l'extraction structurée - optimisé pour Sage 100cloud
        const systemPrompt = `Tu es un expert en extraction de données de tickets de caisse Sage 100cloud "X de caisse".

COLONNES DU TICKET (dans l'ordre):
- Article (colonne 1): Code + Nom du produit (ex: "AIL01 KG AIL", "AUBERGIN01 KG AUBERGINE")
- Chiffre d'affaires TTC (colonne 2): MONTANT TOTAL de la ligne - C'EST LE MONTANT À EXTRAIRE
- % CA (colonne 3): Pourcentage - IGNORER
- Marge (colonne 4): Peut être négatif - IGNORER  
- % mar. (colonne 5): Pourcentage - IGNORER
- Qtés (colonne 6): QUANTITÉ VENDUE - nombre décimal possible
- Prix de vente moyen (colonne 7): PRIX UNITAIRE

RÈGLES D'EXTRACTION:
1. Pour chaque ligne de produit, extraire:
   - article_original: Le nom complet du produit (partie après le code, ex: "KG AIL" pas "AIL01")
   - montant: La valeur de "Chiffre d'affaires TTC" (colonne 2) - C'EST UN NOMBRE ENTIER OU DÉCIMAL
   - quantite: La valeur de "Qtés" (colonne 6)
   - prix_unitaire: La valeur de "Prix de vente moyen" (colonne 7)
2. Si l'article contient "KG" au début, l'unité est "kilo", sinon "unite"
3. IGNORER les lignes: Total, Caisse, Nombre de passages, Panier moyen, Total général
4. Les nombres peuvent avoir des espaces comme séparateurs de milliers (ex: "2 900" = 2900)
5. Le total_general est sur la ligne "Total général" tout en bas

EXEMPLE D'UNE LIGNE:
"AIL01    KG AIL    2 900    0,37    -4 975    -171,    5,25    552,2"
Doit donner: article_original="KG AIL", montant=2900, quantite=5.25, prix_unitaire=552.2

STRUCTURE JSON:
{
  "items": [
    {
      "article_original": "KG AIL",
      "produit": "Ail",
      "quantite": 5.25,
      "unite": "kilo",
      "prix_unitaire": 552.2,
      "montant": 2900
    }
  ],
  "total_general": 775139,
  "date_ticket": "05/12/25",
  "source": "Sage 100cloud"
}

IMPORTANT: Retourne UNIQUEMENT le JSON valide, sans markdown, sans backticks, sans texte.`;

        // Define JSON Schema for structured outputs
        const ocrSchema = {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            article_original: { type: 'string' },
                            produit: { type: 'string' },
                            quantite: { type: 'number' },
                            unite: { type: 'string', enum: ['unite', 'kilo'] },
                            prix_unitaire: { type: 'number' },
                            montant: { type: 'number' }
                        },
                        required: ['article_original', 'produit', 'quantite', 'unite', 'prix_unitaire', 'montant'],
                        additionalProperties: false
                    }
                },
                total_general: { type: 'number' },
                date_ticket: { type: 'string' },
                source: { type: 'string' }
            },
            required: ['items', 'total_general', 'date_ticket', 'source'],
            additionalProperties: false
        };

        // STRATÉGIE: Smart Retry avec Merge
        // 1. Premier appel avec température basse (précision)
        // 2. Validation de la qualité
        // 3. Si incomplet: deuxième appel et merge des résultats
        
        let response1 = await callOCRAPI(image, mimeType, 0.1, 1);
        
        // Check finish_reason
        if (response1.choices[0].finish_reason === 'length') {
            console.error('⚠️ OCR response truncated due to length');
            return res.status(500).json({
                success: false,
                error: 'Réponse tronquée - image trop complexe. Essayez avec une image plus simple.',
                finish_reason: response1.choices[0].finish_reason
            });
        }

        const content1 = response1.choices[0].message.content;
        console.log('🔍 OCR Response 1:', content1.substring(0, 150) + '...');

        // Parser première réponse
        let extractedData1;
        try {
            extractedData1 = JSON.parse(content1);
        } catch (parseError) {
            console.error('❌ OCR JSON parse error (attempt 1):', parseError);
            return res.status(500).json({
                success: false,
                error: 'Erreur lors du parsing des données extraites',
                raw_response_preview: content1.substring(0, 200)
            });
        }

        // Valider la qualité de l'extraction
        const validation1 = validateExtraction(extractedData1);
        console.log(`📊 Extraction 1 quality: ${validation1.completeness.toFixed(1)}% complete, ${validation1.itemCount} items`);
        
        if (validation1.issues.length > 0) {
            console.log(`⚠️  Issues: ${validation1.issues.join(', ')}`);
        }

        let extractedData = extractedData1;
        
        // Si l'extraction n'est pas complète, faire un deuxième appel
        if (!validation1.isComplete && validation1.itemCount > 0) {
            console.log('🔄 Quality not optimal, making second extraction attempt...');
            
            try {
                const response2 = await callOCRAPI(image, mimeType, 0.2, 2);
                const content2 = response2.choices[0].message.content;
                console.log('🔍 OCR Response 2:', content2.substring(0, 150) + '...');
                
                const extractedData2 = JSON.parse(content2);
                const validation2 = validateExtraction(extractedData2);
                console.log(`📊 Extraction 2 quality: ${validation2.completeness.toFixed(1)}% complete, ${validation2.itemCount} items`);
                
                // Merger les deux extractions
                extractedData = mergeExtractions(extractedData1, extractedData2);
                
                const validationMerged = validateExtraction(extractedData);
                console.log(`✨ Merged quality: ${validationMerged.completeness.toFixed(1)}% complete, ${validationMerged.itemCount} items`);
                
            } catch (retryError) {
                console.error('⚠️  Second extraction failed, using first result:', retryError.message);
                // Continue avec la première extraction
            }
        } else {
            console.log('✅ First extraction quality is good, no retry needed');
        }

        // Valider et normaliser les données finales
        if (!extractedData.items || !Array.isArray(extractedData.items)) {
            return res.status(500).json({
                success: false,
                error: 'Format de données invalide - items manquants',
                extracted: extractedData
            });
        }

        // Normaliser les items
        const normalizedItems = extractedData.items.map((item, index) => {
            // Derive values robustly
            const rawArticle = item.article_original || item.article || '';
            const produit = item.produit || rawArticle.replace(/^KG\s+/i, '').trim();
            const unite = item.unite || (rawArticle.toUpperCase().startsWith('KG') ? 'kilo' : 'unite');
            
            return {
                id: index + 1,
                article_original: rawArticle,
                produit: produit,
                quantite: parseFloat(item.quantite) || 0,
                unite: unite,
                prix_unitaire: parseFloat(item.prix_unitaire) || 0,
                montant: parseFloat(item.montant) || 0,
                selected: true
            };
        });

        console.log(`✅ OCR Extract: ${normalizedItems.length} items extraits`);

        res.json({
            success: true,
            data: {
                items: normalizedItems,
                total_general: extractedData.total_general || normalizedItems.reduce((sum, item) => sum + item.montant, 0),
                date_ticket: extractedData.date_ticket || null,
                source: extractedData.source || 'Inconnu',
                count: normalizedItems.length
            }
        });

    } catch (error) {
        console.error('❌ OCR Extract error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erreur lors de l\'extraction OCR'
        });
    }
});

/**
 * POST /api/ocr-imports
 * Enregistre un import OCR dans l'historique
 */
app.post('/api/ocr-imports', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { OcrImport } = require('./db/models');
        const { date_ventes, point_vente, categorie, nombre_lignes, total_montant, donnees_json, image_source } = req.body;
        
        const ocrImport = await OcrImport.create({
            date_ventes,
            point_vente,
            categorie: categorie || 'Import OCR',
            nombre_lignes: nombre_lignes || 0,
            total_montant: total_montant || 0,
            statut: 'completed',
            utilisateur: req.session.user?.username || 'inconnu',
            image_source,
            donnees_json
        });
        
        console.log(`📋 Import OCR enregistré: ${ocrImport.id} - ${nombre_lignes} lignes`);
        
        res.json({
            success: true,
            import_id: ocrImport.id,
            message: 'Import enregistré dans l\'historique'
        });
    } catch (error) {
        console.error('❌ Erreur enregistrement import OCR:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/ocr-imports
 * Récupère l'historique des imports OCR
 */
app.get('/api/ocr-imports', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { OcrImport } = require('./db/models');
        const { limit = 50, offset = 0, point_vente, date_from, date_to } = req.query;
        
        const where = {};
        if (point_vente) where.point_vente = point_vente;
        if (date_from) where.date_ventes = { ...where.date_ventes, [require('sequelize').Op.gte]: date_from };
        if (date_to) where.date_ventes = { ...where.date_ventes, [require('sequelize').Op.lte]: date_to };
        
        const imports = await OcrImport.findAndCountAll({
            where,
            order: [['date_import', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        
        res.json({
            success: true,
            data: imports.rows,
            total: imports.count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('❌ Erreur récupération imports OCR:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/ocr-imports/:id
 * Récupère les détails d'un import OCR
 */
app.get('/api/ocr-imports/:id', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { OcrImport } = require('./db/models');
        const ocrImport = await OcrImport.findByPk(req.params.id);
        
        if (!ocrImport) {
            return res.status(404).json({
                success: false,
                error: 'Import non trouvé'
            });
        }
        
        res.json({
            success: true,
            data: ocrImport
        });
    } catch (error) {
        console.error('❌ Erreur récupération import OCR:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/ocr-imports/:id
 * Supprime un import OCR de l'historique (et optionnellement les ventes associées)
 */
app.delete('/api/ocr-imports/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { OcrImport, Vente } = require('./db/models');
        const { delete_ventes } = req.query;
        
        const ocrImport = await OcrImport.findByPk(req.params.id);
        
        if (!ocrImport) {
            return res.status(404).json({
                success: false,
                error: 'Import non trouvé'
            });
        }
        
        let ventesDeleted = 0;
        
        // Supprimer les ventes associées si demandé
        if (delete_ventes === 'true' && ocrImport.donnees_json) {
            const donnees = ocrImport.donnees_json;
            if (donnees.vente_ids && Array.isArray(donnees.vente_ids)) {
                ventesDeleted = await Vente.destroy({
                    where: { id: donnees.vente_ids }
                });
            }
        }
        
        await ocrImport.destroy();
        
        console.log(`🗑️ Import OCR supprimé: ${req.params.id} (${ventesDeleted} ventes supprimées)`);
        
        res.json({
            success: true,
            message: 'Import supprimé',
            ventes_deleted: ventesDeleted
        });
    } catch (error) {
        console.error('❌ Erreur suppression import OCR:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// VEILLE ACTUALITÉS BÉTAIL - Monitoring Mali/Mauritanie
// ============================================================================

// Cache pour éviter les appels répétés à l'API OpenAI
let veilleCache = {
    data: null,
    timestamp: null,
    cacheDuration: 2 * 60 * 60 * 1000 // 2 heures en millisecondes (réduit de 12h)
};

// GET endpoint pour la veille actualités bétail
app.get('/api/veille-betail', checkAuth, checkReadAccess, async (req, res) => {
    try {
        // Vérifier si on a des données en cache valides
        const now = Date.now();
        if (veilleCache.data && veilleCache.timestamp && 
            (now - veilleCache.timestamp < veilleCache.cacheDuration)) {
            console.log('Returning cached veille data');
            return res.json({
                success: true,
                ...veilleCache.data,
                cached: true,
                cache_expires_in: Math.round((veilleCache.cacheDuration - (now - veilleCache.timestamp)) / 60000) + ' minutes'
            });
        }

        // Vérifier que les variables d'environnement OpenAI sont configurées
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'OpenAI API key not configured'
            });
        }

        console.log('Fetching fresh veille data from news sources...');

        // Importer OpenAI et RSSParser
        const OpenAI = require('openai');
        const Parser = require('rss-parser');
        const parser = new Parser();
        
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Sources RSS Google News pour Mali, Mauritanie (90% du bétail), Sénégal et International
        const searchQueries = [
            // Mali & Mauritanie (PRIORITAIRES - 90% de l'approvisionnement)
            { query: 'Mali bétail', category: 'regional', priority: 'high' },
            { query: 'Mali boeuf élevage', category: 'regional', priority: 'high' },
            { query: 'Mauritanie bétail', category: 'regional', priority: 'high' },
            { query: 'Mauritanie boeuf élevage', category: 'regional', priority: 'high' },
            { query: 'Mali Mauritanie export bétail Sénégal', category: 'regional', priority: 'high' },
            // Sénégal (marché local & réglementations)
            { query: 'Sénégal bétail prix', category: 'regional', priority: 'medium' },
            { query: 'Sénégal élevage bovin', category: 'regional', priority: 'medium' },
            { query: 'Sénégal import bétail', category: 'regional', priority: 'medium' },
            // INTERNATIONAL (prix mondiaux, épidémies, restrictions commerciales)
            { query: 'beef cattle international prices', category: 'international', priority: 'medium' },
            { query: 'livestock disease outbreak Africa', category: 'international', priority: 'high' },
            { query: 'cattle trade restrictions Africa', category: 'international', priority: 'high' },
            { query: 'boeuf prix mondial marché', category: 'international', priority: 'medium' },
            { query: 'FAO livestock market bulletin', category: 'international', priority: 'medium' }
        ];

        // Collecter les actualités
        const newsArticles = [];
        const maxArticleAgeDays = 21; // Ignorer les articles de plus de 21 jours (3 semaines) - augmenté de 7j
        // 'now' is already declared at the top of the function
        
        for (const queryObj of searchQueries) {
            try {
                const query = queryObj.query;
                const category = queryObj.category;
                const priority = queryObj.priority;
                
                // Adapter la langue selon la catégorie
                const lang = category === 'international' ? 'en' : 'fr';
                const region = category === 'international' ? 'US' : 'SN';
                
                const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${region}&ceid=${region}:${lang}`;
                const feed = await parser.parseURL(url);
                
                // Prendre les 5 articles les plus récents par requête, filtrer par date
                const recentArticles = feed.items
                    .slice(0, 8) // Prendre plus d'articles pour compenser le filtrage
                    .map(item => {
                        const pubDate = new Date(item.pubDate);
                        const ageInDays = Math.floor((now - pubDate.getTime()) / (1000 * 60 * 60 * 24));
                        return {
                            title: item.title,
                            link: item.link,
                            pubDate: item.pubDate,
                            pubDateISO: pubDate.toISOString(),
                            ageInDays: ageInDays,
                            source: item.source?.title || 'Source inconnue',
                            contentSnippet: item.contentSnippet || item.content || '',
                            category: category, // regional ou international
                            priority: priority // high, medium, low
                        };
                    })
                    .filter(item => item.ageInDays <= maxArticleAgeDays) // Filtrer les articles trop anciens
                    .slice(0, 5); // Garder les 5 plus récents après filtrage
                
                newsArticles.push(...recentArticles);
            } catch (error) {
                console.error(`Error fetching RSS for query "${queryObj.query}":`, error.message);
            }
        }

        if (newsArticles.length === 0) {
            return res.json({
                success: true,
                data: {
                    alertes: [],
                    tendances: [],
                    contexte: 'Aucune actualité récente disponible.',
                    articles_count: 0
                },
                timestamp: new Date().toISOString()
            });
        }

        // Trier les articles par date (plus récents d'abord)
        newsArticles.sort((a, b) => a.ageInDays - b.ageInDays);
        
        // Séparer les articles régionaux et internationaux
        const regionalArticles = newsArticles.filter(a => a.category === 'regional');
        const internationalArticles = newsArticles.filter(a => a.category === 'international');
        
        // Préparer le contenu pour l'analyse GPT avec date et catégorie
        const articlesText = newsArticles.map((article, index) => 
            `${index + 1}. [${article.category.toUpperCase()}] [${article.pubDate}] ⏰ Il y a ${article.ageInDays} jour${article.ageInDays > 1 ? 's' : ''}\n   📰 ${article.title}\n   🔗 Source: ${article.source}\n   🔗 Lien: ${article.link}\n   ${article.contentSnippet}\n`
        ).join('\n');
        
        // Calculer la moyenne d'âge des articles
        const avgAge = Math.round(newsArticles.reduce((sum, a) => sum + a.ageInDays, 0) / newsArticles.length);
        const oldestArticle = Math.max(...newsArticles.map(a => a.ageInDays));
        const newestArticle = Math.min(...newsArticles.map(a => a.ageInDays));

        // Appel à OpenAI pour analyser les actualités
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `Tu es un expert en analyse de marché du bétail en Afrique de l'Ouest avec une vision internationale. 
                    Tu dois analyser les actualités RÉGIONALES (Mali, Mauritanie, Sénégal) et INTERNATIONALES pour identifier les facteurs pouvant affecter l'approvisionnement en bovins.
                    
                    CONTEXTE CRITIQUE : 
                    - 90% du bétail provient du Mali et de la Mauritanie. PRIORISE l'analyse de ces deux pays.
                    - Le Sénégal est surveillé pour les réglementations locales, prix de marché et conditions de transport.
                    - NOUVEAU : Analyse INTERNATIONALE pour détecter les impacts indirects (prix mondiaux, épidémies, restrictions commerciales).
                    - ATTENTION À LA DATE : Les articles ont maximum 21 jours. Priorise les événements les plus récents (0-3 jours) dans tes alertes.
                    
                    Focus RÉGIONAL :
                    - Prix du bétail sur pied (Mali/Mauritanie = PRIORITÉ ABSOLUE)
                    - Restrictions d'export/import (frontières Mali-Sénégal, Mauritanie-Sénégal)
                    - Maladies animales régionales (fièvre aphteuse, peste bovine, etc.)
                    - Sécheresse et conditions climatiques (impact sur disponibilité du cheptel)
                    - Tensions frontalières ou politiques (fermetures de frontières)
                    - Nouvelles réglementations (douanes, quarantaine, taxes)
                    
                    Focus INTERNATIONAL :
                    - Prix mondiaux de la viande bovine (impact sur la demande locale)
                    - Épidémies internationales de maladies animales (risques de propagation)
                    - Restrictions commerciales internationales (embargo, quotas)
                    - Tendances du marché mondial (demande, offre)
                    - Innovations ou réglementations internationales (traçabilité, normes sanitaires)
                    
                    IMPORTANT : 
                    - Dans tes alertes et tendances, MENTIONNE l'âge de l'information (ex: "Il y a 2 jours", "Hier")
                    - INCLUS les liens des articles sources dans les alertes pertinentes
                    - Sépare clairement les impacts RÉGIONAUX et INTERNATIONAUX
                    
                    Réponds UNIQUEMENT en JSON avec cette structure exacte :
                    {
                      "alertes": [
                        {
                          "niveau": "critique|warning|info", 
                          "titre": "...", 
                          "description": "...", 
                          "impact": "...", 
                          "date_relative": "Il y a X jour(s)",
                          "categorie": "regional|international",
                          "source_link": "URL de l'article source si disponible"
                        }
                      ],
                      "tendances": [
                        {
                          "type": "prix|climat|reglementation|marche_international|epidemie|autre", 
                          "description": "...", 
                          "impact_previsionnel": "...",
                          "categorie": "regional|international"
                        }
                      ],
                      "international": {
                        "resume": "Résumé des impacts internationaux en 2-3 phrases",
                        "articles_pertinents": [
                          {"titre": "...", "lien": "...", "impact": "..."}
                        ]
                      },
                      "contexte": "Résumé général de la situation régionale + internationale en 2-3 phrases",
                      "recommandations": ["...", "..."]
                    }`
                },
                {
                    role: 'user',
                    content: `Analyse ces actualités récentes sur le bétail (Mali, Mauritanie, Sénégal) :
                    
PÉRIODE COUVERTE : Articles publiés dans les 21 derniers jours
- Article le plus récent : Il y a ${newestArticle} jour(s)
- Article le plus ancien : Il y a ${oldestArticle} jour(s)  
- Âge moyen des articles : ${avgAge} jour(s)

ARTICLES (${newsArticles.length} au total, triés du plus récent au plus ancien) :

${articlesText}

Retourne uniquement le JSON structuré avec une attention particulière aux dates et à la pertinence temporelle des informations.`
                }
            ],
            temperature: 0.3,
            max_tokens: 1500
        });

        // Parser la réponse JSON de GPT
        let analysisData;
        try {
            const responseContent = completion.choices[0].message.content.trim();
            // Extraire le JSON si il est entouré de ```json ... ```
            const jsonMatch = responseContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                             responseContent.match(/```\s*([\s\S]*?)\s*```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : responseContent;
            analysisData = JSON.parse(jsonStr);
        } catch (parseError) {
            console.error('Error parsing GPT response:', parseError);
            analysisData = {
                alertes: [],
                tendances: [],
                contexte: 'Erreur lors de l\'analyse des données.',
                recommandations: []
            };
        }

        // Préparer la réponse finale
        const responseData = {
            ...analysisData,
            articles_count: newsArticles.length,
            articles_sources: Array.from(new Set(newsArticles.map(a => a.source))),
            date_stats: {
                newest_article_age_days: newestArticle,
                oldest_article_age_days: oldestArticle,
                average_article_age_days: avgAge,
                max_age_filter_days: maxArticleAgeDays,
                coverage_period: `Articles publiés dans les ${maxArticleAgeDays} derniers jours (3 semaines)`
            },
            timestamp: new Date().toISOString()
        };

        // Mettre en cache
        veilleCache = {
            data: responseData,
            timestamp: now
        };

        console.log(`Veille data fetched: ${newsArticles.length} articles analyzed`);

        res.json({
            success: true,
            ...responseData,
            cached: false
        });

    } catch (error) {
        console.error('Error in veille-betail endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch livestock news',
            message: error.message
        });
    }
});

// Route pour récupérer les catégories
app.get('/api/categories', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const categories = await Vente.findAll({
            attributes: [[fn('DISTINCT', fn('col', 'categorie')), 'categorie']],
            raw: true
        });
        
        const categoriesList = categories.map(c => c.categorie).filter(Boolean);
        res.json({ success: true, categories: categoriesList });
    } catch (error) {
        console.error('Erreur lors de la récupération des catégories:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des catégories' 
        });
    }
});

// Route pour calculer le stock du soir
app.get('/api/stock-soir', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { date, pointVente, categorie } = req.query;
        
        if (!date || !pointVente || !categorie) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date, point de vente et catégorie sont requis' 
            });
        }

        const dateStandardisee = standardiserDateFormat(date);
        
        // Calculer le stock du soir pour la date et le point de vente donnés
        const stock = await Stock.findAll({
            where: {
                date: dateStandardisee,
                pointVente,
                typeStock: 'soir'
            }
        });

        // Calculer la somme du stock pour la catégorie donnée
        let stockSoir = 0;
        stock.forEach(s => {
            if (s.categorie === categorie) {
                stockSoir += parseFloat(s.quantite) || 0;
            }
        });

        res.json({ success: true, stockSoir });
    } catch (error) {
        console.error('Erreur lors du calcul du stock du soir:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du calcul du stock du soir' 
        });
    }
});

// Route pour calculer les ventes effectuées
app.get('/api/ventes-effectuees', checkAuth, async (req, res) => {
    try {
        const { date, pointVente, categorie } = req.query;
        
        if (!date || !pointVente || !categorie) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date, point de vente et catégorie sont requis' 
            });
        }

        const dateStandardisee = standardiserDateFormat(date);
        
        // Calculer les ventes effectuées pour la date et le point de vente donnés
        const ventes = await Vente.findAll({
            where: {
                date: dateStandardisee,
                pointVente,
                categorie
            }
        });

        // Calculer la somme des ventes
        let ventesEffectuees = 0;
        ventes.forEach(v => {
            ventesEffectuees += parseFloat(v.nombre) || 0;
        });

        res.json({ success: true, ventesEffectuees });
    } catch (error) {
        console.error('Erreur lors du calcul des ventes effectuées:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du calcul des ventes effectuées' 
        });
    }
});

// Route pour créer une estimation
app.post('/api/estimations', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const estimation = req.body;
        
        // Standardiser la date
        estimation.date = standardiserDateFormat(estimation.date);
        
        // Créer l'estimation
        await Estimation.create(estimation);
        
        // Récupérer toutes les estimations pour mise à jour de l'affichage
        const estimations = await Estimation.findAll();
        
        // Trier les estimations par timestamp de création décroissant (derniers ajouts en premier)
        estimations.sort((a, b) => {
            // Tri principal par timestamp de création (plus récent en premier)
            const timestampA = new Date(a.createdAt).getTime();
            const timestampB = new Date(b.createdAt).getTime();
            
            if (timestampB !== timestampA) {
                return timestampB - timestampA; // Tri par timestamp décroissant
            }
            
            // Tri secondaire par date si même timestamp (peu probable mais sûr)
            const convertDate = (dateStr) => {
                if (!dateStr) return '';
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                    if (parts[0].length === 4) {
                        // Already YYYY-MM-DD format
                        return dateStr;
                    } else {
                        // DD-MM-YYYY format, convert to YYYY-MM-DD
                        return `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                }
                return dateStr;
            };
            
            const dateA = convertDate(a.date);
            const dateB = convertDate(b.date);
            
            return dateB.localeCompare(dateA); // Tri décroissant
        });
        
        res.json({ 
            success: true, 
            message: 'Estimation créée avec succès',
            estimations 
        });
    } catch (error) {
        console.error('Erreur lors de la création de l\'estimation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la création de l\'estimation' 
        });
    }
});

// Route pour récupérer les estimations
// Helper function to parse estimation date (handles both DD-MM-YYYY and YYYY-MM-DD)
function parseEstimationDate(dateStr) {
    try {
        if (!dateStr) return null;
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                // YYYY-MM-DD format
                const year = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1; // Mois de 0 à 11
                const day = parseInt(parts[2]);
                return new Date(year, month, day);
            } else {
                // DD-MM-YYYY format
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1; // Mois de 0 à 11
                const year = parseInt(parts[2]);
                return new Date(year, month, day);
            }
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Helper function to fetch theoretical sales from external API
async function fetchVentesTheoriquesFromAPI(estimation) {
    try {
        const externalApiKey = process.env.EXTERNAL_API_KEY || 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4';
        // Use the correct base URL for the environment
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
            : 'http://localhost:3000';
        const externalResponse = await fetch(`${baseUrl}/api/external/reconciliation?date=${encodeURIComponent(estimation.date)}`, {
            method: 'GET',
            headers: {
                'X-API-Key': externalApiKey
            }
        });
        
        if (externalResponse.ok) {
            const externalData = await externalResponse.json();
            // Chercher dans data.details[pointVente][categorie].ventesTheoriquesNombre
            if (externalData.data && externalData.data.details && 
                externalData.data.details[estimation.pointVente] && 
                externalData.data.details[estimation.pointVente][estimation.categorie || estimation.produit] &&
                externalData.data.details[estimation.pointVente][estimation.categorie || estimation.produit].ventesTheoriquesNombre !== undefined) {
                
                const ventesTheo = parseFloat(externalData.data.details[estimation.pointVente][estimation.categorie || estimation.produit].ventesTheoriquesNombre);
                return ventesTheo;
            }
        }
    } catch (error) {
        console.log(`Impossible de récupérer les ventes théoriques pour ${estimation.pointVente}/${estimation.categorie || estimation.produit}:`, error.message);
    }
    return null;
}

app.get('/api/estimations', checkAuth, checkEstimationAccess, async (req, res) => {
    try {
        const estimations = await Estimation.findAll();
        
        // Trier les estimations par timestamp de création décroissant (derniers ajouts en premier)
        estimations.sort((a, b) => {
            // Tri principal par timestamp de création (plus récent en premier)
            const timestampA = new Date(a.createdAt).getTime();
            const timestampB = new Date(b.createdAt).getTime();
            
            if (timestampB !== timestampA) {
                return timestampB - timestampA; // Tri par timestamp décroissant
            }
            
            // Tri secondaire par date si même timestamp (peu probable mais sûr)
            const convertDate = (dateStr) => {
                if (!dateStr) return '';
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                    if (parts[0].length === 4) {
                        // Already YYYY-MM-DD format
                        return dateStr;
                    } else {
                        // DD-MM-YYYY format, convert to YYYY-MM-DD
                        return `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                }
                return dateStr;
            };
            
            const dateA = convertDate(a.date);
            const dateB = convertDate(b.date);
            
            return dateB.localeCompare(dateA); // Tri décroissant
        });
        
        res.json({ success: true, estimations });
    } catch (error) {
        console.error('Erreur lors de la récupération des estimations:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des estimations' 
        });
    }
});

// Route pour supprimer une estimation
app.delete('/api/estimations/:id', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const id = req.params.id;
        
        await Estimation.destroy({
            where: { id }
        });
        
        res.json({ success: true, message: 'Estimation supprimée avec succès' });
    } catch (error) {
        console.error('Erreur lors de la suppression de l\'estimation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la suppression de l\'estimation' 
        });
    }
});

// Route pour sauvegarder plusieurs estimations (bulk save)
app.post('/api/estimations/bulk', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { date, pointVente, produits } = req.body;
        
        if (!date || !pointVente || !produits || !Array.isArray(produits)) {
            return res.status(400).json({
                success: false,
                message: 'Date, point de vente et liste de produits requis'
            });
        }
        
        // Standardiser la date
        const standardizedDate = standardiserDateFormat(date);
        
        // Supprimer les estimations existantes pour cette date et ce point de vente
        await Estimation.destroy({
            where: {
                date: standardizedDate,
                pointVente: pointVente
            }
        });
        
        // Créer les nouvelles estimations
        console.log('🔍 DEBUG - Produits reçus:', JSON.stringify(produits, null, 2));
        
        const estimationsToCreate = produits.map((produit, index) => {
            console.log(`🔍 DEBUG - Produit ${index + 1}:`, {
                produit: produit.produit,
                precommande: produit.precommande,
                prevision: produit.prevision,
                commentaire: produit.commentaire,
                commentaireType: typeof produit.commentaire,
                hasCommentaire: !!produit.commentaire
            });
            
            return {
                date: standardizedDate,
                pointVente: pointVente,
                categorie: produit.produit, // Utiliser le nom du produit comme catégorie
                produit: produit.produit,
                preCommandeDemain: produit.precommande,
                previsionVentes: produit.prevision,
                commentaire: produit.commentaire || null,
                stockMatin: 0,
                transfert: 0,
                stockSoir: 0,
                difference: 0 - produit.precommande - produit.prevision,
                stockModified: false
            };
        });
        
        const createdEstimations = await Estimation.bulkCreate(estimationsToCreate);
        
        // Ne pas essayer de récupérer les ventes théoriques lors de la création
        // (elles ne seront disponibles que le jour suivant)
        const updatedEstimations = await Promise.all(createdEstimations.map(async (estimation) => {
            // Mettre 0 par défaut lors de la création (les vraies valeurs viendront plus tard)
            await estimation.update({ 
                ventesTheoriques: 0,
                difference: 0 - (estimation.previsionVentes || 0) // Différence avec 0 ventes théo
            });
            console.log(`Estimation créée pour ${estimation.pointVente}/${estimation.categorie} - Ventes théoriques: 0 kg (à récupérer ultérieurement)`);
            return estimation;
        }));
        
        res.json({
            success: true,
            message: 'Estimations créées avec succès',
            savedCount: createdEstimations.length
        });
    } catch (error) {
        console.error('Erreur lors de la création des estimations en bulk:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la création des estimations'
        });
    }
});

// Route pour mettre à jour manuellement les ventes théoriques
app.put('/api/estimations/:id/ventes-theoriques', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const estimationId = req.params.id;
        const { ventesTheoriques } = req.body;
        
        console.log(`🔍 DEBUG - Update ventes théoriques pour estimation ${estimationId}:`, ventesTheoriques);
        
        if (typeof ventesTheoriques !== 'number' || ventesTheoriques < 0) {
            return res.status(400).json({
                success: false,
                message: 'Valeur des ventes théoriques invalide'
            });
        }
        
        // Trouver l'estimation
        const estimation = await Estimation.findByPk(estimationId);
        if (!estimation) {
            return res.status(404).json({
                success: false,
                message: 'Estimation non trouvée'
            });
        }
        
        // Calculer la nouvelle différence
        const nouvelleDifference = ventesTheoriques - (estimation.previsionVentes || 0);
        
        // Mettre à jour l'estimation
        await estimation.update({
            ventesTheoriques: ventesTheoriques,
            difference: nouvelleDifference
        });
        
        console.log(`✅ Ventes théoriques mises à jour: ${ventesTheoriques}, nouvelle différence: ${nouvelleDifference}`);
        
        res.json({
            success: true,
            message: 'Ventes théoriques mises à jour avec succès',
            ventesTheoriques: ventesTheoriques,
            difference: nouvelleDifference
        });
        
    } catch (error) {
        console.error('Erreur lors de la mise à jour des ventes théoriques:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la mise à jour'
        });
    }
});

// Route pour recalculer les ventes théoriques d'une estimation
app.post('/api/estimations/:id/recalculate', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const id = req.params.id;
        
        // Récupérer l'estimation
        const estimation = await Estimation.findByPk(id);
        if (!estimation) {
            return res.status(404).json({
                success: false,
                message: 'Estimation non trouvée'
            });
        }
        
        // Récupérer les ventes théoriques depuis l'API externe, sinon 0
        const ventesTheoFromAPI = await fetchVentesTheoriquesFromAPI(estimation);
        const ventesTheo = ventesTheoFromAPI !== null ? ventesTheoFromAPI : 0;
        
        console.log(`Recalcul des ventes théoriques pour ${estimation.pointVente}/${estimation.categorie || estimation.produit}: ${ventesTheo} kg ${ventesTheoFromAPI === null ? '(API indisponible, valeur par défaut)' : '(récupéré de l\'API)'}`);
        
        // Recalculer la différence avec la nouvelle formule (sans pré-commande)
        const nouvelleDifference = ventesTheo - (estimation.previsionVentes || 0);
        
        await estimation.update({
            difference: nouvelleDifference,
            ventesTheoriques: ventesTheo
        });
        
        res.json({
            success: true,
            message: 'Ventes théoriques recalculées avec succès',
            ventesTheo: ventesTheo,
            difference: nouvelleDifference
        });
    } catch (error) {
        console.error('Erreur lors du recalcul des ventes théoriques:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du recalcul des ventes théoriques'
        });
    }
});

// Routes pour les paramètres de poids
app.get('/api/weight-params/:date', checkAuth, checkEstimationAccess, async (req, res) => {
    try {
        const { date } = req.params;
        
        // Standardiser la date
        const standardizedDate = standardiserDateFormat(date);
        
        // Chercher les paramètres pour cette date
        const weightParams = await WeightParams.findOne({
            where: { date: standardizedDate }
        });
        
        if (weightParams) {
            // Convertir en format attendu par le frontend
            const params = {
                'Boeuf': weightParams.boeuf,
                'Veau': weightParams.veau,
                'Agneau': weightParams.agneau,
                'Poulet': weightParams.poulet,
                'default': weightParams.defaultWeight
            };
            
            res.json({
                success: true,
                params: params,
                date: standardizedDate
            });
        } else {
            // Retourner les paramètres par défaut
            res.json({
                success: true,
                params: {
                    'Boeuf': 150,
                    'Veau': 110,
                    'Agneau': 10,
                    'Poulet': 1,
                    'default': 1
                },
                date: standardizedDate,
                isDefault: true
            });
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des paramètres de poids:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des paramètres de poids'
        });
    }
});

app.post('/api/weight-params', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const { date, params } = req.body;
        
        if (!date || !params) {
            return res.status(400).json({
                success: false,
                message: 'Date et paramètres requis'
            });
        }
        
        // Standardiser la date
        const standardizedDate = standardiserDateFormat(date);
        
        // Créer ou mettre à jour les paramètres
        const [weightParams, created] = await WeightParams.upsert({
            date: standardizedDate,
            boeuf: params['Boeuf'] || 150,
            veau: params['Veau'] || 110,
            agneau: params['Agneau'] || 10,
            poulet: params['Poulet'] || 1.5,
            defaultWeight: params['default'] || 1
        });
        
        res.json({
            success: true,
            message: created ? 'Paramètres créés avec succès' : 'Paramètres mis à jour avec succès',
            params: {
                'Boeuf': weightParams.boeuf,
                'Veau': weightParams.veau,
                'Agneau': weightParams.agneau,
                'Poulet': weightParams.poulet,
                'default': weightParams.defaultWeight
            },
            date: standardizedDate
        });
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des paramètres de poids:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la sauvegarde des paramètres de poids'
        });
    }
});

// Routes pour les estimations
app.get('/api/stock/:date/:type/:pointVente/:categorie', async (req, res) => {
    console.log('=== ESTIMATION STOCK API REQUEST START ===');
    console.log('Request params:', req.params);
    
    try {
        const { date, type, pointVente, categorie } = req.params;
        
        if (!date || !type || !pointVente || !categorie) {
            console.warn('Missing required parameters:', { date, type, pointVente, categorie });
            return res.status(400).json({ 
                success: false,
                stock: 0,
                error: 'Missing required parameters'
            });
        }

        // Convertir la date du format DD-MM-YYYY vers YYYY-MM-DD pour le chemin
        let formattedDate = date;
        if (date.includes('-') && date.split('-')[0].length === 2) {
            // Format DD-MM-YYYY vers YYYY-MM-DD
            const parts = date.split('-');
            formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        
        if (type === 'transfert') {
            // Logique spéciale pour les transferts
            const filePath = path.join(__dirname, 'data', 'by-date', formattedDate, 'transferts.json');
            console.log('Looking for transfert file:', filePath);

            if (!fs.existsSync(filePath)) {
                console.log(`Transfert file not found: ${filePath}`);
                return res.json({ 
                    success: true,
                    transfert: 0,
                    message: 'No transfert data found for this date'
                });
            }

            const fileContent = await fsPromises.readFile(filePath, 'utf8');
            const transferts = JSON.parse(fileContent);
            
            // Calculer la somme des transferts pour ce produit et ce point de vente
            let totalTransfert = 0;
            transferts.forEach(transfert => {
                if (transfert.pointVente === pointVente && transfert.produit === categorie) {
                    const impact = parseInt(transfert.impact) || 1;
                    const quantite = parseFloat(transfert.quantite || 0);
                    totalTransfert += quantite * impact;
                }
            });

            console.log(`Total transfert for ${pointVente}-${categorie}:`, totalTransfert);
            res.json({ 
                success: true,
                transfert: totalTransfert
            });
        } else {
            // Logique pour stock matin et soir
            const filePath = path.join(__dirname, 'data', 'by-date', formattedDate, `stock-${type}.json`);
        console.log('Looking for stock file:', filePath);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.log(`Stock file not found: ${filePath}`);
            return res.json({ 
                success: true,
                stock: 0,
                message: 'No stock data found for this date'
            });
        }

        // Read and parse the JSON file
        const fileContent = await fsPromises.readFile(filePath, 'utf8');
        const data = JSON.parse(fileContent);
        
        // Look for the entry with the matching key format: pointVente-categorie
        const key = `${pointVente}-${categorie}`;
        console.log('Looking for stock entry with key:', key);
        
        const entry = data[key];
        console.log('Found stock entry:', entry);

        if (entry && entry.Nombre !== undefined) {
            const stockValue = parseFloat(entry.Nombre) || 0;
            console.log(`Stock value found for ${key}:`, stockValue);
            res.json({ 
                success: true,
                stock: stockValue
            });
        } else {
            console.log(`No stock value found for ${key}`);
            res.json({ 
                success: true,
                stock: 0,
                message: 'No stock value found'
            });
            }
        }
    } catch (error) {
        console.error('Error reading stock data:', error);
        res.status(500).json({ 
            success: false,
            stock: 0,
            error: error.message
        });
    }
    console.log('=== ESTIMATION STOCK API REQUEST END ===');
});

// Route pour calculer le stock du matin par produit
app.get('/api/stock/:date/matin/:pointVente/:produit', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { date, pointVente, produit } = req.params;
        
        if (!date || !pointVente || !produit) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date, point de vente et produit sont requis' 
            });
        }

        // Convertir la date du format DD-MM-YYYY vers YYYY-MM-DD pour le chemin
        let formattedDate = date;
        if (date.includes('-') && date.split('-')[0].length === 2) {
            // Format DD-MM-YYYY vers YYYY-MM-DD
            const parts = date.split('-');
            formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        
        console.log(`[API Stock Matin] Date reçue: ${date}, Date formatée: ${formattedDate}`);
        
        // Lire les données depuis le fichier JSON
        const datePath = path.join(__dirname, 'data', 'by-date', formattedDate, 'stock-matin.json');
        console.log(`[API Stock Matin] Chemin du fichier: ${datePath}`);
        
        if (!fs.existsSync(datePath)) {
            console.log(`[API Stock Matin] Fichier non trouvé: ${datePath}`);
            return res.json({ 
                success: true, 
                stock: 0,
                message: 'No stock data found for this date'
            });
        }
        
        console.log(`[API Stock Matin] Fichier trouvé, lecture en cours...`);

        const fileContent = await fsPromises.readFile(datePath, 'utf8');
        const stockData = JSON.parse(fileContent);
        
        // Chercher directement la clé produit
        const key = `${pointVente}-${produit}`;
        let stockMatin = 0;
        
        if (stockData[key]) {
            stockMatin = parseFloat(stockData[key].Nombre || stockData[key].quantite || 0);
            }

        res.json({ success: true, stock: stockMatin });
    } catch (error) {
        console.error('Erreur lors du calcul du stock du matin:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du calcul du stock du matin' 
        });
    }
});

// Route pour calculer le stock du soir par produit
app.get('/api/stock/:date/soir/:pointVente/:produit', checkAuth, checkReadAccess, async (req, res) => {
    try {
        const { date, pointVente, produit } = req.params;
        
        if (!date || !pointVente || !produit) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date, point de vente et produit sont requis' 
            });
        }

        // Convertir la date du format DD-MM-YYYY vers YYYY-MM-DD pour le chemin
        let formattedDate = date;
        if (date.includes('-') && date.split('-')[0].length === 2) {
            // Format DD-MM-YYYY vers YYYY-MM-DD
            const parts = date.split('-');
            formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }

        // Lire les données depuis le fichier JSON
        const datePath = path.join(__dirname, 'data', 'by-date', formattedDate, 'stock-soir.json');
        
        if (!fs.existsSync(datePath)) {
            return res.json({ 
                success: true, 
                stock: 0,
                message: 'Aucune donnée de stock soir trouvée pour cette date'
            });
        }

        const fileContent = await fsPromises.readFile(datePath, 'utf8');
        const stockData = JSON.parse(fileContent);
        
        // Chercher directement la clé produit
        const key = `${pointVente}-${produit}`;
        let stockSoir = 0;
        
        if (stockData[key]) {
            stockSoir = parseFloat(stockData[key].Nombre || stockData[key].quantite || 0);
        }

        res.json({ 
            success: true, 
            stock: stockSoir
        });
    } catch (error) {
        console.error('Erreur lors du calcul du stock soir:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du calcul du stock soir' 
        });
    }
});
        
// Route pour calculer les transferts par produit
app.get('/api/stock/:date/transfert/:pointVente/:produit', async (req, res) => {
    try {
        const { date, pointVente, produit } = req.params;
        
        if (!date || !pointVente || !produit) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date, point de vente et produit sont requis pour les transferts' 
            });
        }

        // Convertir la date du format DD-MM-YYYY vers YYYY-MM-DD pour le chemin
        let formattedDate = date;
        if (date.includes('-') && date.split('-')[0].length === 2) {
            // Format DD-MM-YYYY vers YYYY-MM-DD
            const parts = date.split('-');
            formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        
        // Lire les données depuis le fichier JSON
        const datePath = path.join(__dirname, 'data', 'by-date', formattedDate, 'transferts.json');
        
        if (!fs.existsSync(datePath)) {
            return res.json({ 
                success: true, 
                transfert: 0,
                message: 'Aucune donnée de transfert trouvée pour cette date'
            });
        }

        const fileContent = await fsPromises.readFile(datePath, 'utf8');
        const transfertsData = JSON.parse(fileContent);

        // Calculer la somme des transferts pour ce produit spécifique et ce point de vente
        let totalTransfert = 0;
        transfertsData.forEach(transfert => {
            if (transfert.pointVente === pointVente && transfert.produit === produit) {
                const impact = parseInt(transfert.impact) || 1;
                const quantite = parseFloat(transfert.quantite || 0);
                totalTransfert += quantite * impact;
            }
        });

        res.json({ 
            success: true, 
            transfert: totalTransfert,
            message: transfertsData.length === 0 ? "Aucune donnée de transfert trouvée pour cette date" : ""
        });
    } catch (error) {
        console.error('Erreur lors du calcul des transferts:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du calcul des transferts' 
        });
    }
});

// =================== PAYMENT LINKS ROUTES ===================
// Configuration de l'API Bictorys
const BICTORYS_API_KEY = process.env.BICTORYS_API_KEY;
const BICTORYS_BASE_URL = process.env.BICTORYS_BASE_URL || 'https://api.bictorys.com';

if (!BICTORYS_API_KEY) {
  throw new Error('Missing BICTORYS_API_KEY. Set it in your environment.');
}

const bictorys = axios.create({
  baseURL: BICTORYS_BASE_URL,
  timeout: 10000,
  headers: {
    'X-API-Key': BICTORYS_API_KEY,
    'Content-Type': 'application/json'
  }
});

// =================== PAYMENT LINKS DATABASE FUNCTIONS ===================

        // Fonction pour sauvegarder un lien de paiement en base
        async function savePaymentLinkToDatabase(paymentData, user) {
            try {
                const paymentLink = await PaymentLink.create({
                    payment_link_id: paymentData.paymentLinkId,
                    point_vente: paymentData.pointVente,
                    client_name: paymentData.clientName,
                    phone_number: paymentData.phoneNumber,
                    address: paymentData.address,
                    amount: paymentData.amount,
                    currency: paymentData.currency,
                    reference: paymentData.reference,
                    description: paymentData.description,
                    payment_url: paymentData.paymentUrl,
                    status: paymentData.status,
                    created_by: user.username,
                    due_date: paymentData.dueDate || null,
                    archived: 0,
                    is_abonnement: paymentData.isAbonnement || false,
                    client_abonne_id: paymentData.clientAbonneId || null
                });

                console.log('Lien de paiement sauvegardé avec ID:', paymentLink.id);
                return paymentLink.id;
            } catch (error) {
                console.error('Erreur lors de la sauvegarde en base:', error);
                throw error;
            }
        }

        // Fonction pour mettre à jour le statut d'un lien de paiement
        async function updatePaymentLinkStatus(paymentLinkId, status) {
            try {
                const [updatedRowsCount] = await PaymentLink.update(
                    { status: status },
                    { where: { payment_link_id: paymentLinkId } }
                );

                console.log('Statut mis à jour pour le lien:', paymentLinkId, '->', status);
                return updatedRowsCount;
            } catch (error) {
                console.error('Erreur lors de la mise à jour du statut:', error);
                throw error;
            }
        }

        // Fonction pour enregistrer automatiquement un paiement d'abonnement
        async function recordAbonnementPayment(paymentLink) {
            try {
                // Vérifier si c'est bien un abonnement
                if (!paymentLink.is_abonnement || !paymentLink.client_abonne_id) {
                    console.log('❌ Pas un paiement d\'abonnement, ignoré');
                    return;
                }

                // Déterminer le mois du paiement (mois actuel au format YYYY-MM)
                const now = new Date();
                const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                console.log('🔔 Enregistrement du paiement d\'abonnement pour le client:', paymentLink.client_abonne_id, 'Mois:', mois);

                // Vérifier si un paiement existe déjà pour ce mois
                const [existingPayment] = await sequelize.query(`
                    SELECT id FROM paiements_abonnement 
                    WHERE client_id = :clientId AND mois = :mois
                `, {
                    replacements: { clientId: paymentLink.client_abonne_id, mois: mois },
                    type: sequelize.QueryTypes.SELECT
                });

                if (existingPayment) {
                    console.log('✅ Paiement déjà enregistré pour ce mois');
                    return;
                }

                // Enregistrer le paiement dans la table paiements_abonnement
                await sequelize.query(`
                    INSERT INTO paiements_abonnement 
                    (client_id, mois, montant, date_paiement, mode_paiement, payment_link_id, reference, notes, created_at, updated_at)
                    VALUES (:clientId, :mois, :montant, :datePaiement, :modePaiement, :paymentLinkId, :reference, :notes, NOW(), NOW())
                `, {
                    replacements: {
                        clientId: paymentLink.client_abonne_id,
                        mois: mois,
                        montant: paymentLink.amount,
                        datePaiement: new Date(),
                        modePaiement: 'Bictorys',
                        paymentLinkId: paymentLink.payment_link_id,
                        reference: paymentLink.reference,
                        notes: `Paiement automatique via ${paymentLink.reference}`
                    }
                });

                console.log('✅ Paiement d\'abonnement enregistré avec succès');

                // Réactiver le client si inactif
                await sequelize.query(`
                    UPDATE clients_abonnes 
                    SET statut = 'actif', updated_at = NOW()
                    WHERE id = :clientId AND statut = 'inactif'
                `, {
                    replacements: { clientId: paymentLink.client_abonne_id }
                });

                console.log('✅ Statut du client vérifié/réactivé');

            } catch (error) {
                console.error('❌ Erreur lors de l\'enregistrement du paiement d\'abonnement:', error);
                // Ne pas bloquer le processus si l'enregistrement échoue
            }
        }

// Fonction pour obtenir le mapping inverse (point de vente -> référence) depuis la BDD
const getPointVenteToRef = async () => {
    const { PointVente } = require('./db/models');
    const { Op } = require('sequelize');
    const pvList = await PointVente.findAll({ 
        where: { payment_ref: { [Op.ne]: null } } 
    });
    const mapping = {};
    for (const pv of pvList) {
        if (pv.payment_ref) {
            mapping[pv.nom] = pv.payment_ref;
        }
    }
    return mapping;
};

// Route pour obtenir les points de vente accessibles par l'utilisateur
app.get('/api/payment-links/points-vente', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        let accessiblePointsVente = [];
        
        // Obtenir les points de vente actifs depuis la base de données
        const pointsVenteData = await configService.getPointsVenteAsLegacy();
        const activePointsVente = Object.entries(pointsVenteData)
            .filter(([_, properties]) => properties.active)
            .map(([name, _]) => name);
        
        if (user.canAccessAllPointsVente) {
            // L'utilisateur a accès à tous les points de vente actifs
            accessiblePointsVente = activePointsVente;
        } else {
            // L'utilisateur a accès seulement à ses points de vente assignés
            if (Array.isArray(user.pointVente)) {
                accessiblePointsVente = user.pointVente.filter(pv => pv !== 'tous' && activePointsVente.includes(pv));
            } else if (user.pointVente !== 'tous') {
                accessiblePointsVente = activePointsVente.includes(user.pointVente) ? [user.pointVente] : [];
            }
        }
        
        res.json({
            success: true,
            data: accessiblePointsVente
        });
        
    } catch (error) {
        console.error('Erreur lors de la récupération des points de vente:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour créer un lien de paiement
app.post('/api/payment-links/create', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        
        // Validation des données - seulement Point de Vente et Montant sont obligatoires
        const { pointVente, clientName, phoneNumber, amount, address, dueDate, isAbonnement, clientAbonneId } = req.body;
        
        if (!pointVente || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Point de vente et montant sont requis'
            });
        }
        
        // Validation du montant (doit être positif)
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Le montant doit être un nombre positif'
            });
        }
        
        // Log pour les abonnements
        if (isAbonnement) {
            console.log('🔔 Paiement d\'abonnement détecté pour le client:', clientAbonneId);
        }
        
        // Traitement de la date d'expiration
        let processedDueDate = null;
        if (dueDate) {
            // Convertir la date locale en format ISO pour Bictorys
            const date = new Date(dueDate);
            processedDueDate = date.toISOString();
            console.log('📅 Date d\'expiration traitée:', processedDueDate);
        } else {
            // Date par défaut : 24h après maintenant
            const now = new Date();
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            processedDueDate = tomorrow.toISOString();
            console.log('📅 Date d\'expiration par défaut définie:', processedDueDate);
        }
        
        // Vérifier si l'utilisateur a accès à ce point de vente
        let hasAccess = false;
        if (user.canAccessAllPointsVente) {
            hasAccess = true;
        } else {
            if (Array.isArray(user.pointVente)) {
                hasAccess = user.pointVente.includes('tous') || user.pointVente.includes(pointVente);
            } else {
                hasAccess = user.pointVente === 'tous' || user.pointVente === pointVente;
            }
        }
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à ce point de vente'
            });
        }
        
        // Obtenir la référence du point de vente depuis la BDD
        const pointVenteToRef = await getPointVenteToRef();
        let paymentRef = pointVenteToRef[pointVente];
        if (!paymentRef) {
            // Essayer de récupérer directement depuis le point de vente
            const { PointVente } = require('./db/models');
            const pvRecord = await PointVente.findOne({ where: { nom: pointVente } });
            if (pvRecord && pvRecord.payment_ref) {
                paymentRef = pvRecord.payment_ref;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Point de vente non reconnu ou sans référence de paiement configurée'
                });
            }
        }
        
        // Si c'est un abonnement, remplacer V_ par A_ dans la référence
        if (isAbonnement) {
            paymentRef = paymentRef.replace('V_', 'A_');
            console.log('🔔 Référence modifiée pour abonnement:', paymentRef);
        }
        
        // Préparer les données pour l'API Bictorys
        const paymentData = {
            amount: numericAmount,
            currency: 'XOF',
            reference: paymentRef,
            description: `Paiement pour ${pointVente}${clientName ? ` - ${clientName}` : ''}`
        };
        
        // Ajouter la date d'expiration si fournie
        if (processedDueDate) {
            paymentData.dueDate = processedDueDate;
        }
        
        // Ajouter les informations client directement dans l'objet principal
        if (clientName) {
            paymentData.customerName = clientName;
        }
        if (phoneNumber) {
            paymentData.customerPhone = phoneNumber;
        }
        if (address) {
            paymentData.customerAddress = address;
        }
        
        console.log('Création du lien de paiement:', paymentData);
        console.log('URL de l\'API Bictorys:', `${BICTORYS_BASE_URL}/paymentlink-management/v1/paymentlinks`);
        console.log('Headers envoyés:', {
            'X-API-Key': BICTORYS_API_KEY.substring(0, 20) + '...',
            'Content-Type': 'application/json'
        });
        
        // Appel à l'API Bictorys
        const response = await axios.post(
            `${BICTORYS_BASE_URL}/paymentlink-management/v1/paymentlinks`,
            paymentData,
            {
                headers: {
                    'X-API-Key': BICTORYS_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('📊 Réponse complète de l\'API Bictorys pour la création:');
        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
        console.log('Data:', JSON.stringify(response.data, null, 2));
        
        // La réponse Bictorys contient directement les données (pas de wrapper success)
        if (response.data && response.data.id) {
            // Préparer les données pour la sauvegarde en base
            const paymentDataForDB = {
                paymentLinkId: response.data.id,
                paymentUrl: response.data.paymentUrl,
                amount: response.data.amount,
                currency: response.data.currency,
                reference: response.data.reference,
                pointVente: pointVente,
                clientName: clientName || null,
                phoneNumber: phoneNumber || null,
                address: address || null,
                status: response.data.status,
                description: `Paiement ${isAbonnement ? 'abonnement' : ''} pour ${pointVente}${clientName ? ` - ${clientName}` : ''}`,
                dueDate: processedDueDate,
                isAbonnement: isAbonnement || false,
                clientAbonneId: clientAbonneId || null
            };
            
            // Sauvegarder en base de données
            try {
                console.log('Tentative de sauvegarde en base de données...');
                console.log('Données à sauvegarder:', paymentDataForDB);
                console.log('Utilisateur:', user.username);
                
                await savePaymentLinkToDatabase(paymentDataForDB, user);
                console.log('✅ Lien de paiement sauvegardé en base de données avec succès');
            } catch (dbError) {
                console.error('❌ Erreur lors de la sauvegarde en base:', dbError);
                console.error('Détails de l\'erreur:', dbError.message);
                console.error('Stack trace:', dbError.stack);
                // On continue même si la sauvegarde en base échoue
            }
            
            res.json({
                success: true,
                data: {
                    paymentLinkId: response.data.id,
                    paymentUrl: response.data.paymentUrl,
                    amount: response.data.amount,
                    currency: response.data.currency,
                    reference: response.data.reference,
                    pointVente: pointVente,
                    clientName: clientName || null,
                    phoneNumber: phoneNumber || null,
                    address: address || null,
                    status: response.data.status,
                    dueDate: processedDueDate || response.data.dueDate,
                    createdAt: response.data.createdAt
                }
            });
        } else {
            console.log('Réponse Bictorys ne contient pas d\'ID de paiement');
            console.log('Structure de la réponse:', Object.keys(response.data || {}));
            throw new Error('Réponse invalide de l\'API Bictorys - ID de paiement manquant');
        }
        
    } catch (error) {
        console.error('Erreur lors de la création du lien de paiement:', error);
        
        if (error.response) {
            // Erreur de l'API Bictorys
            console.log('Erreur HTTP de Bictorys - Status:', error.response.status);
            console.log('Erreur HTTP de Bictorys - Headers:', error.response.headers);
            console.log('Erreur HTTP de Bictorys - Data:', JSON.stringify(error.response.data, null, 2));
            
            res.status(error.response.status).json({
                success: false,
                message: 'Erreur lors de la création du lien de paiement',
                details: error.response.data
            });
        } else {
            // Erreur interne
            console.log('Erreur interne (pas de response):', error.message);
            res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }
    }
});

// Route pour obtenir le statut d'un lien de paiement
app.get('/api/payment-links/status/:paymentLinkId', checkAuth, async (req, res) => {
    try {
        const { paymentLinkId } = req.params;
        
        if (!paymentLinkId) {
            return res.status(400).json({
                success: false,
                message: 'ID du lien de paiement requis'
            });
        }
        
        console.log('Vérification du statut du lien de paiement:', paymentLinkId);
        
        // Appel à l'API Bictorys pour obtenir les détails
        const response = await axios.get(
            `${BICTORYS_BASE_URL}/paymentlink-management/v1/paymentlinks/${paymentLinkId}`,
            {
                headers: {
                    'X-API-Key': BICTORYS_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('📊 Réponse complète de l\'API Bictorys pour le statut:');
        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
        console.log('Data:', JSON.stringify(response.data, null, 2));
        
        if (response.data && response.data.id) {
            const paymentData = response.data;
            
            // Mettre à jour le statut en base de données
            try {
                // Récupérer l'ancien statut avant mise à jour
                const existingLink = await PaymentLink.findOne({
                    where: { payment_link_id: paymentLinkId }
                });
                
                const oldStatus = existingLink ? existingLink.status : null;
                
                await updatePaymentLinkStatus(paymentLinkId, paymentData.status);
                console.log('Statut mis à jour en base de données');
                
                // Si le statut passe à "paid" et que c'est un abonnement, enregistrer le paiement
                if (paymentData.status === 'paid' && oldStatus !== 'paid' && existingLink) {
                    console.log('🔔 Nouveau paiement détecté, vérification si abonnement...');
                    await recordAbonnementPayment(existingLink);
                }
            } catch (dbError) {
                console.error('Erreur lors de la mise à jour du statut en base:', dbError);
                // On continue même si la mise à jour en base échoue
            }
            
            res.json({
                success: true,
                data: {
                    paymentLinkId: paymentData.id,
                    status: paymentData.status,
                    amount: paymentData.amount,
                    currency: paymentData.currency,
                    reference: paymentData.reference,
                    customer: {
                        name: paymentData.customerName,
                        phone: paymentData.customerPhone,
                        email: paymentData.customerEmail
                    },
                    createdAt: paymentData.createdAt,
                    updatedAt: paymentData.updatedAt,
                    paymentUrl: paymentData.paymentUrl
                }
            });
        } else {
            throw new Error('Réponse invalide de l\'API Bictorys');
        }
        
    } catch (error) {
        console.error('Erreur lors de la vérification du statut:', error);
        
        if (error.response) {
            // Erreur de l'API Bictorys
            res.status(error.response.status).json({
                success: false,
                message: 'Erreur lors de la vérification du statut',
                details: error.response.data
            });
        } else {
            // Erreur interne
            res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }
    }
});

        // Route pour supprimer un lien de paiement
        app.delete('/api/payment-links/:paymentLinkId', checkAuth, async (req, res) => {
            try {
                const { paymentLinkId } = req.params;
                const user = req.user;
                
                console.log('🗑️ Suppression du lien de paiement:', paymentLinkId);
                
                // Vérifier que le lien existe et que l'utilisateur a le droit de le supprimer
                const existingLink = await PaymentLink.findOne({
                    where: { payment_link_id: paymentLinkId }
                });

                if (!existingLink) {
                    return res.status(404).json({
                        success: false,
                        message: 'Lien de paiement non trouvé'
                    });
                }

                // Vérifier les permissions (seul le créateur ou un admin peut supprimer)
                if (existingLink.created_by !== user.username && !user.canAccessAllPointsVente) {
                    return res.status(403).json({
                        success: false,
                        message: 'Vous n\'avez pas le droit de supprimer ce lien'
                    });
                }

                // Vérifier que le statut permet la suppression
                if (!['opened', 'expired'].includes(existingLink.status)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Seuls les liens avec le statut "Ouvert" ou "Expiré" peuvent être supprimés'
                    });
                }
                    
                // Supprimer le lien côté Bictorys d'abord
                try {
                    const bictorysResponse = await axios.delete(`${BICTORYS_BASE_URL}/paymentlink-management/v1/paymentlinks/${paymentLinkId}`, {
                        headers: {
                            'X-API-Key': BICTORYS_API_KEY,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    console.log('✅ Lien supprimé côté Bictorys:', bictorysResponse.status);
                    
                    // Supprimer le lien de la base de données PostgreSQL
                    await PaymentLink.destroy({
                        where: { payment_link_id: paymentLinkId }
                    });
                    
                    console.log('✅ Lien de paiement supprimé avec succès (Bictorys + PostgreSQL)');
                    res.json({
                        success: true,
                        message: 'Lien de paiement supprimé avec succès'
                    });
                    
                } catch (bictorysError) {
                    console.error('❌ Erreur lors de la suppression côté Bictorys:', bictorysError.response?.data || bictorysError.message);
                    
                    // Si Bictorys échoue, on ne supprime pas localement pour éviter la désynchronisation
                    res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la suppression côté Bictorys. Le lien n\'a pas été supprimé pour éviter la désynchronisation.'
                    });
                }
                
            } catch (error) {
                console.error('Erreur lors de la suppression du lien:', error);
                res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }
        });

        // Route pour charger les liens de paiement existants
        app.get('/api/payment-links/list', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        
        // Construire les conditions de requête selon les permissions de l'utilisateur
        let whereConditions = {
            archived: 0
        };
        
        // Si l'utilisateur n'a pas accès à tous les points de vente, filtrer par ses points de vente
        if (!user.canAccessAllPointsVente) {
            if (Array.isArray(user.pointVente)) {
                const userPointsVente = user.pointVente.filter(pv => pv !== 'tous');
                if (userPointsVente.length > 0) {
                    whereConditions.point_vente = {
                        [Op.in]: userPointsVente
                    };
                }
            } else if (user.pointVente !== 'tous') {
                whereConditions.point_vente = user.pointVente;
            }
        }
        
        const paymentLinks = await PaymentLink.findAll({
            where: whereConditions,
            order: [['created_at', 'DESC']]
        });

        const formattedLinks = paymentLinks.map(link => ({
            paymentLinkId: link.payment_link_id,
            pointVente: link.point_vente,
            clientName: link.client_name,
            phoneNumber: link.phone_number,
            address: link.address,
            amount: link.amount,
            currency: link.currency,
            reference: link.reference,
            description: link.description,
            paymentUrl: link.payment_url,
            status: link.status,
            createdAt: link.created_at,
            updatedAt: link.updated_at,
            createdBy: link.created_by,
            dueDate: link.due_date
        }));

        res.json({
            success: true,
            data: formattedLinks
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des liens de paiement:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour lister les paiements par date et point de vente
app.get('/api/payment-links/list-by-date', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        const { date, pointVente } = req.query;
        
        // Validation des paramètres requis
        if (!date || !pointVente) {
            return res.status(400).json({
                success: false,
                message: 'Les paramètres "date" (dd-mm-yyyy) et "pointVente" sont requis'
            });
        }
        
        // Validation du format de date
        const dateRegex = /^(\d{2})-(\d{2})-(\d{4})$/;
        const dateMatch = date.match(dateRegex);
        if (!dateMatch) {
            return res.status(400).json({
                success: false,
                message: 'Format de date invalide. Utilisez dd-mm-yyyy (ex: 06-10-2025)'
            });
        }
        
        // Conversion de la date dd-mm-yyyy vers yyyy-mm-dd pour la base de données
        const [, day, month, year] = dateMatch;
        const dbDate = `${year}-${month}-${day}`;
        
        // Vérifier si l'utilisateur a accès à ce point de vente
        let hasAccess = false;
        if (user.canAccessAllPointsVente) {
            hasAccess = true;
        } else if (Array.isArray(user.pointVente)) {
            hasAccess = user.pointVente.includes(pointVente) || user.pointVente.includes('tous');
        } else {
            hasAccess = user.pointVente === pointVente || user.pointVente === 'tous';
        }
        
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Vous n\'avez pas accès à ce point de vente'
            });
        }
        
        console.log(`🔍 Recherche des paiements pour ${pointVente} le ${date} (${dbDate})`);
        
        // Construire les conditions de requête
        const whereConditions = {
            point_vente: pointVente,
            archived: 0,
            [Op.and]: [
                sequelize.where(sequelize.fn('DATE', sequelize.col('created_at')), dbDate)
            ]
        };
        
        // Récupérer tous les paiements pour cette date et ce point de vente
        const paymentLinks = await PaymentLink.findAll({
            where: whereConditions,
            order: [['created_at', 'DESC']]
        });
        
        console.log(`📊 ${paymentLinks.length} paiement(s) trouvé(s) pour ${pointVente} le ${date}`);
        
        // Classer les paiements en payés et non payés
        const paidPayments = [];
        const unpaidPayments = [];
        
        let totalAmount = 0;
        let paidAmount = 0;
        let unpaidAmount = 0;
        
        paymentLinks.forEach(link => {
            const paymentData = {
                id: link.id,
                paymentLinkId: link.payment_link_id,
                clientName: link.client_name,
                phoneNumber: link.phone_number,
                address: link.address,
                amount: parseFloat(link.amount),
                currency: link.currency,
                status: link.status,
                createdAt: link.created_at,
                createdBy: link.created_by,
                reference: link.reference,
                isAbonnement: link.is_abonnement || false,
                dueDate: link.due_date
            };
            
            totalAmount += paymentData.amount;
            
            // Classer selon le statut
            if (link.status === 'paid') {
                paidPayments.push(paymentData);
                paidAmount += paymentData.amount;
            } else {
                // Tous les autres statuts sont considérés comme non payés
                unpaidPayments.push(paymentData);
                unpaidAmount += paymentData.amount;
            }
        });
        
        // Préparer le résumé
        const summary = {
            totalPayments: paymentLinks.length,
            totalAmount: totalAmount,
            paidCount: paidPayments.length,
            unpaidCount: unpaidPayments.length,
            paidAmount: paidAmount,
            unpaidAmount: unpaidAmount
        };
        
        // Réponse structurée
        const response = {
            success: true,
            data: {
                date: date,
                pointVente: pointVente,
                summary: summary,
                payments: {
                    paid: paidPayments,
                    unpaid: unpaidPayments
                }
            }
        };
        
        console.log(`✅ Résumé: ${summary.paidCount} payés (${paidAmount} FCFA), ${summary.unpaidCount} non payés (${unpaidAmount} FCFA)`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération des paiements par date:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour archiver les anciens liens de paiement
app.post('/api/payment-links/archive-old', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        const { forceArchive, testMode } = req.body;
        
        console.log('🗄️ Archivage des anciens liens demandé par:', user.username);
        if (forceArchive) {
            console.log('🧪 Mode test activé - archivage forcé');
        }

        // Calculer la date limite
        let dateLimit;
        if (forceArchive && testMode) {
            // Pour le test, utiliser une date dans le futur pour forcer l'archivage
            dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() + 1); // Demain
            console.log('📅 Date limite de test (demain):', dateLimit.toISOString());
        } else {
            // Date normale (il y a une semaine)
            dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - 7);
            console.log('📅 Date limite d\'archivage:', dateLimit.toISOString());
        }

        const dateLimitISO = dateLimit.toISOString();

        // Marquer comme archivés les liens avec statut "paid" et date de création > date limite
        // Utiliser une requête SQL brute avec paramètres nommés
        const [results] = await sequelize.query(`
            UPDATE payment_links 
            SET archived = 1, updated_at = CURRENT_TIMESTAMP
            WHERE status = 'paid' 
            AND created_at < :dateLimit
            AND archived = 0
        `, {
            replacements: { dateLimit: dateLimitISO },
            type: sequelize.QueryTypes.UPDATE
        });
        
        console.log('🔍 Résultats de la requête:', results);
        console.log('🔍 Type de results:', typeof results);
        console.log('🔍 Array.isArray(results):', Array.isArray(results));
        
        const archivedCount = Array.isArray(results) ? results[0] : results;

        console.log('✅ Archivage terminé:', archivedCount, 'liens archivés');
        res.json({
            success: true,
            archivedCount: archivedCount,
            message: `${archivedCount} liens archivés avec succès`,
            testMode: forceArchive && testMode
        });

    } catch (error) {
        console.error('❌ Erreur lors de l\'archivage:', error);
        console.error('❌ Détails de l\'erreur:', error.message);
        console.error('❌ Stack trace:', error.stack);
        if (error.parent) {
            console.error('❌ Erreur parent:', error.parent.message);
            console.error('❌ Code d\'erreur:', error.parent.code);
        }
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message,
            details: error.parent ? error.parent.message : null
        });
    }
});

// Route pour archiver un lien de paiement individuel (superviseurs seulement)
app.post('/api/payment-links/archive-individual', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        const { paymentLinkId } = req.body;
        
        console.log('🗄️ Archivage individuel demandé par:', user.username, 'pour le lien:', paymentLinkId);

        // Vérifier que l'utilisateur est superviseur
        if (user.role !== 'superviseur') {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé. Seuls les superviseurs peuvent archiver des liens individuellement.'
            });
        }

        if (!paymentLinkId) {
            return res.status(400).json({
                success: false,
                message: 'ID du lien de paiement requis'
            });
        }

        // Vérifier que le lien existe
        const existingLink = await PaymentLink.findOne({
            where: { payment_link_id: paymentLinkId }
        });

        if (!existingLink) {
            return res.status(404).json({
                success: false,
                message: 'Lien de paiement non trouvé'
            });
        }

        // Vérifier que le lien a le statut "paid"
        if (existingLink.status !== 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Seuls les liens avec le statut "Payé" peuvent être archivés'
            });
        }

        // Vérifier que le lien n'est pas déjà archivé
        if (existingLink.archived === 1) {
            return res.status(400).json({
                success: false,
                message: 'Ce lien est déjà archivé'
            });
        }

        // Archiver le lien
        await PaymentLink.update(
            { 
                archived: 1, 
                updated_at: new Date() 
            },
            { 
                where: { payment_link_id: paymentLinkId } 
            }
        );

        console.log('✅ Lien de paiement archivé avec succès:', paymentLinkId);

        res.json({
            success: true,
            message: 'Lien de paiement archivé avec succès'
        });

    } catch (error) {
        console.error('Erreur lors de l\'archivage individuel:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour voir les archives (superviseurs seulement)
app.get('/api/payment-links/archives', checkAuth, async (req, res) => {
    try {
        const user = req.user;

        // Vérifier que l'utilisateur est superviseur ou admin
        if (!user.canAccessAllPointsVente) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé. Seuls les superviseurs peuvent voir les archives.'
            });
        }

        console.log('📚 Consultation des archives par:', user.username);

        // Récupérer les archives groupées par semaine (liens archivés)
        // Utiliser une requête SQL brute avec Sequelize pour PostgreSQL
        const results = await sequelize.query(`
            SELECT 
                DATE_TRUNC('week', due_date) as week_start,
                COUNT(*) as count,
                MIN(due_date) as first_date,
                MAX(due_date) as last_date
            FROM payment_links 
            WHERE status = 'paid' 
            AND due_date IS NOT NULL
            AND archived = 1
            GROUP BY DATE_TRUNC('week', due_date)
            ORDER BY week_start DESC
        `, {
            type: sequelize.QueryTypes.SELECT
        });

        const archives = results.map(row => {
            const weekStart = new Date(row.week_start);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);

            return {
                weekStart: row.week_start,
                weekLabel: `Semaine du ${weekStart.toLocaleDateString('fr-FR')} au ${weekEnd.toLocaleDateString('fr-FR')}`,
                count: parseInt(row.count),
                firstDate: row.first_date,
                lastDate: row.last_date
            };
        });

        console.log('✅ Archives récupérées:', archives.length, 'semaines');
        res.json({
            success: true,
            data: archives
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des archives:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour voir les archives d'une semaine spécifique
app.get('/api/payment-links/archives/:weekStart', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        const { weekStart } = req.params;

        // Vérifier que l'utilisateur est superviseur ou admin
        if (!user.canAccessAllPointsVente) {
            return res.status(403).json({
                success: false,
                message: 'Accès refusé. Seuls les superviseurs peuvent voir les archives.'
            });
        }

        console.log('📅 Consultation des archives de la semaine:', weekStart, 'par:', user.username);

        // Calculer la fin de semaine
        const weekStartDate = new Date(weekStart);
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setDate(weekEndDate.getDate() + 6);
        const weekEndISO = weekEndDate.toISOString();

        // Récupérer les liens archivés de la semaine avec Sequelize
        const results = await sequelize.query(`
            SELECT 
                payment_link_id, point_vente, client_name, phone_number, address,
                amount, currency, reference, description, payment_url, status,
                created_at, updated_at, created_by, due_date, archived
            FROM payment_links 
            WHERE status = 'paid' 
            AND due_date IS NOT NULL
            AND due_date >= :weekStart 
            AND due_date <= :weekEnd
            AND archived = 1
            ORDER BY due_date DESC
        `, {
            replacements: { 
                weekStart: weekStart, 
                weekEnd: weekEndISO 
            },
            type: sequelize.QueryTypes.SELECT
        });

        const links = results.map(row => ({
            paymentLinkId: row.payment_link_id,
            pointVente: row.point_vente,
            clientName: row.client_name,
            phoneNumber: row.phone_number,
            address: row.address,
            amount: row.amount,
            currency: row.currency,
            reference: row.reference,
            description: row.description,
            paymentUrl: row.payment_url,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            createdBy: row.created_by,
            dueDate: row.due_date
        }));

        console.log('✅ Liens de la semaine récupérés:', links.length);
        res.json({
            success: true,
            data: links
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des liens de la semaine:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour actualiser tous les paiements ouverts des 2 derniers jours
app.post('/api/payment-links/update-open-payments', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        
        console.log('🔄 Actualisation des paiements ouverts demandée par:', user.username);
        
        // Calculer la date d'il y a 2 jours
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        twoDaysAgo.setHours(0, 0, 0, 0); // Début de la journée
        
        console.log('📅 Récupération des paiements créés depuis:', twoDaysAgo.toISOString());
        
        // Récupérer tous les paiements avec statut "opened" des 2 derniers jours
        const openPayments = await PaymentLink.findAll({
            where: {
                status: 'opened',
                created_at: {
                    [Op.gte]: twoDaysAgo
                },
                archived: 0
            }
        });
        
        console.log(`📊 ${openPayments.length} paiement(s) ouverts trouvés à vérifier`);
        
        let totalChecked = 0;
        let updated = 0;
        
        // Vérifier chaque paiement individuellement
        for (const payment of openPayments) {
            try {
                console.log(`🔍 Vérification du paiement: ${payment.payment_link_id}`);
                
                // Appel à l'API Bictorys pour obtenir le statut actuel
                const response = await axios.get(
                    `${BICTORYS_BASE_URL}/paymentlink-management/v1/paymentlinks/${payment.payment_link_id}`,
                    {
                        headers: {
                            'X-API-Key': BICTORYS_API_KEY,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000 // 10 secondes de timeout
                    }
                );
                
                totalChecked++;
                
                if (response.data && response.data.id) {
                    const currentStatus = response.data.status;
                    
                    // Vérifier si le statut a changé
                    if (currentStatus !== payment.status) {
                        console.log(`📝 Mise à jour du statut: ${payment.payment_link_id} ${payment.status} -> ${currentStatus}`);
                        
                        const oldStatus = payment.status;
                        
                        // Mettre à jour le statut en base
                        await PaymentLink.update(
                            { 
                                status: currentStatus,
                                updated_at: new Date()
                            },
                            { 
                                where: { payment_link_id: payment.payment_link_id } 
                            }
                        );
                        
                        updated++;
                        
                        // Si le statut passe à "paid" et que c'est un abonnement, enregistrer le paiement
                        if (currentStatus === 'paid' && oldStatus !== 'paid') {
                            console.log('🔔 Nouveau paiement détecté, vérification si abonnement...');
                            await recordAbonnementPayment(payment);
                        }
                    } else {
                        console.log(`✅ Statut inchangé pour: ${payment.payment_link_id} (${currentStatus})`);
                    }
                } else {
                    console.log(`⚠️ Réponse invalide de l'API pour: ${payment.payment_link_id}`);
                }
                
                // Petite pause entre les requêtes pour éviter la surcharge de l'API
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`❌ Erreur lors de la vérification de ${payment.payment_link_id}:`, error.message);
                totalChecked++; // Compter même en cas d'erreur
            }
        }
        
        console.log(`✅ Actualisation terminée. ${totalChecked} paiements vérifiés, ${updated} mis à jour`);
        
        res.json({
            success: true,
            data: {
                totalChecked,
                updated,
                message: `${totalChecked} paiement(s) vérifiés, ${updated} mis à jour`
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'actualisation des paiements ouverts:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur lors de l\'actualisation'
        });
    }
});

// =================== ROUTES ABONNEMENTS ===================
// Importer et utiliser les routes d'abonnement
const abonnementsRoutes = require('./routes/abonnements');
app.use('/api/abonnements', checkAuth, abonnementsRoutes);

console.log('✅ Routes d\'abonnement chargées');

// =================== ROUTES AUDIT CLIENT ===================
// Routes pour l'Audit Client et ses logs
const auditLogsRoutes = require('./routes/auditLogs');
app.use('/api/audit-logs', checkAuth, auditLogsRoutes);

console.log('✅ Routes d\'audit logs chargées');

// Route proxy pour éviter les problèmes CORS avec l'API externe
// + Logging automatique des recherches
app.get('/api/audit-client', checkAuth, async (req, res) => {
    const { AuditClientLog } = require('./db/models');
    const startTime = new Date();
    
    try {
        const { phone_number } = req.query;
        
        if (!phone_number) {
            return res.status(400).json({
                success: false,
                error: 'Le numéro de téléphone est requis'
            });
        }
        
        console.log(`📞 Requête audit client pour: ${phone_number} par ${req.session.user.username}`);
        
        // Appel à l'API externe
        const externalApiUrl = `https://matix-livreur-backend.onrender.com/api/external/mata/audit/client?phone_number=${encodeURIComponent(phone_number)}`;
        const apiKey = process.env.EXTERNAL_API_KEY || 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4';
        
        const response = await axios.get(externalApiUrl, {
            headers: {
                'x-api-key': apiKey
            }
        });
        
        console.log(`✅ Données récupérées pour ${phone_number}`);
        
        // Logger la recherche dans la base de données
        try {
            // Convertir pointVente array en string
            let pointVente = null;
            if (req.session.user.pointVente) {
                pointVente = Array.isArray(req.session.user.pointVente) 
                    ? req.session.user.pointVente.join(', ') 
                    : req.session.user.pointVente;
            }
            
            await AuditClientLog.create({
                user_id: req.session.user.id,
                username: req.session.user.username,
                point_de_vente: pointVente,
                phone_number_searched: phone_number,
                client_name: response.data.client_info?.name || null,
                search_timestamp: startTime,
                consultation_start: startTime,
                search_success: true,
                total_orders_found: response.data.client_info?.total_orders || 0,
                ip_address: req.ip || req.connection.remoteAddress,
                user_agent: req.get('user-agent')
            });
            console.log(`📝 Log enregistré pour ${phone_number}`);
        } catch (logError) {
            console.error('⚠️ Erreur lors de l\'enregistrement du log:', logError.message);
            console.error('Stack:', logError.stack);
            console.error('Code erreur:', logError.code);
            // Ne pas bloquer la réponse si le logging échoue
        }
        
        // Retourner les données au client
        res.json(response.data);
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'appel API audit client:', error.message);
        
        // Logger l'échec
        try {
            // Convertir pointVente array en string
            let pointVente = null;
            if (req.session.user.pointVente) {
                pointVente = Array.isArray(req.session.user.pointVente) 
                    ? req.session.user.pointVente.join(', ') 
                    : req.session.user.pointVente;
            }
            
            await AuditClientLog.create({
                user_id: req.session.user.id,
                username: req.session.user.username,
                point_de_vente: pointVente,
                phone_number_searched: req.query.phone_number,
                search_timestamp: startTime,
                consultation_start: startTime,
                search_success: false,
                error_message: error.message,
                ip_address: req.ip || req.connection.remoteAddress,
                user_agent: req.get('user-agent')
            });
        } catch (logError) {
            console.error('⚠️ Erreur lors de l\'enregistrement du log d\'échec:', logError.message);
        }
        
        if (error.response) {
            // L'API a répondu avec un code d'erreur
            res.status(error.response.status).json({
                success: false,
                error: error.response.data?.error || 'Erreur lors de la récupération des données'
            });
        } else if (error.request) {
            // La requête a été envoyée mais pas de réponse
            res.status(503).json({
                success: false,
                error: 'Le service d\'audit client est temporairement indisponible'
            });
        } else {
            // Erreur lors de la configuration de la requête
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
});

console.log('✅ Route proxy audit client chargée');

// Démarrage du serveur
app.listen(PORT, async () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
    
    // Charger la configuration depuis la base de données
    await loadConfigFromDB();
    console.log('Routes de paiement disponibles:');
    console.log('- GET /api/payment-links/points-vente');
    console.log('- POST /api/payment-links/create');
    console.log('- GET /api/payment-links/status/:paymentLinkId');
    console.log('- GET /api/payment-links/list');
    console.log('- DELETE /api/payment-links/:paymentLinkId');
    console.log('- POST /api/payment-links/archive-old');
    console.log('- POST /api/payment-links/archive-individual');
    console.log('- GET /api/payment-links/archives');
    console.log('- GET /api/payment-links/archives/:weekStart');
    console.log('- POST /api/payment-links/update-open-payments');
});

// API endpoint for showing estimation section
app.get('/api/show-estimation', checkAuth, checkReadAccess, async (req, res) => {
  console.log('Request to show estimation section received');
  res.json({ success: true, message: 'Estimation section should be shown' });
});

// =================== EXTERNAL API ENDPOINTS FOR RELEVANCE AI ===================

// External API version for ventes saisie by date
app.get('/api/external/ventes-date', validateApiKeyOrSession, async (req, res) => {
    try {
        const { date, pointVente } = req.query;
        
        if (!date) {
            return res.status(400).json({ 
                success: false, 
                message: 'La date est requise' 
            });
        }
        
        console.log('==== EXTERNAL API - VENTES DATE ====');
        console.log('Recherche des ventes pour date:', date, 'et point de vente:', pointVente);
        
        const dateStandardisee = standardiserDateFormat(date);
        
        // Utiliser la même logique que /api/ventes pour gérer les formats de date multiples
        // Rechercher dans les deux formats possibles (YYYY-MM-DD et DD-MM-YYYY)
        
        // Convertir la date d'entrée en format DD-MM-YYYY si elle n'y est pas déjà
        let dateDDMMYYYY = date;
        if (date.includes('/')) {
            dateDDMMYYYY = date.replace(/\//g, '-');
        }
        
        const whereConditions = {
            [Op.or]: [
                { date: dateStandardisee },  // Format YYYY-MM-DD
                { date: dateDDMMYYYY }       // Format DD-MM-YYYY
            ]
        };
        
        if (pointVente) {
            whereConditions.pointVente = pointVente;
        }
        
        console.log('Conditions de recherche (avec OR):', whereConditions);
        
        // Récupérer les ventes depuis la base de données
        const ventes = await Vente.findAll({
            where: whereConditions,
            order: [['createdAt', 'DESC']]
        });
        
        console.log(`Nombre de ventes trouvées: ${ventes.length}`);
        
        // Log pour debug - afficher quelques exemples de dates trouvées
        if (ventes.length > 0) {
            console.log('Exemples de ventes trouvées:');
            ventes.slice(0, 5).forEach((vente, index) => {
                console.log(`  ${index + 1}. Date: ${vente.date}, Point: ${vente.pointVente}, Montant: ${vente.montant}`);
            });
        }
        
        // Formater les données pour la réponse
        const formattedVentes = ventes.map(vente => {
            // Conversion explicite en nombres
            const prixUnit = parseFloat(vente.prixUnit) || 0;
            const nombre = parseFloat(vente.nombre) || 0;
            const montant = parseFloat(vente.montant) || 0;
            
            return {
                id: vente.id,
                date: vente.date,
                pointVente: vente.pointVente,
                categorie: vente.categorie,
                produit: vente.produit,
                prixUnit: prixUnit,
                nombre: nombre,
                montant: montant
            };
        });
        
        // Calculer le total par point de vente
        const totauxParPointVente = {};
        
        formattedVentes.forEach(vente => {
            const pv = vente.pointVente;
            if (!totauxParPointVente[pv]) {
                totauxParPointVente[pv] = 0;
            }
            // S'assurer que le montant est un nombre
            const montant = parseFloat(vente.montant) || 0;
            totauxParPointVente[pv] += montant;
        });
        
        console.log('==== FIN EXTERNAL API - VENTES DATE ====');
        
        res.json({ 
            success: true, 
            ventes: formattedVentes,
            totaux: totauxParPointVente
        });
    } catch (error) {
        console.error('Erreur lors de la recherche des ventes (API externe):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la recherche des ventes',
            error: error.message
        });
    }
});

// External API version for aggregated ventes by date range and category
app.get('/api/external/ventes-date/aggregated', validateApiKeyOrSession, async (req, res) => {
    try {
        const { start_date, end_date, pointVente } = req.query;
        
        // Validate input - both dates are required
        if (!start_date || !end_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Les paramètres start_date et end_date sont requis (format: dd-mm-yyyy ou dd/mm/yyyy)' 
            });
        }
        
        console.log('==== EXTERNAL API - VENTES DATE AGGREGATED ====');
        console.log('Paramètres reçus:', { start_date, end_date, pointVente });
        
        // Convert dates to DD-MM-YYYY format if needed
        const formatDateInput = (dateStr) => {
            if (!dateStr) return null;
            // Accept DD-MM-YYYY, DD/MM/YYYY
            return dateStr.replace(/\//g, '-');
        };
        
        const startFormatted = formatDateInput(start_date);
        const endFormatted = formatDateInput(end_date);
        
        console.log('Dates formatées:', { start: startFormatted, end: endFormatted });
        
        // Helper function to compare dates (handles DD-MM-YYYY and YYYY-MM-DD formats)
        const isDateInRange = (dateToCheck, startDate, endDate) => {
            const convertToComparable = (dateStr) => {
                if (!dateStr) return '';
                
                // If date is in YYYY-MM-DD format, return as is
                if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    return dateStr;
                }
                
                // Otherwise, assume DD-MM-YYYY format
                const [day, month, year] = dateStr.split('-');
                return `${year}-${month}-${day}`;
            };
            
            const comparableDate = convertToComparable(dateToCheck);
            const comparableStart = convertToComparable(startDate);
            const comparableEnd = convertToComparable(endDate);
            
            return comparableDate >= comparableStart && comparableDate <= comparableEnd;
        };
        
        // Category normalization function
        function mapToCanonicalCategory(rawCategory) {
            if (!rawCategory || typeof rawCategory !== 'string') {
                return 'Non spécifié';
            }
            const normalized = rawCategory.trim().toLowerCase();

            if (normalized.includes('boeuf')) return 'Boeuf';
            if (normalized.includes('veau')) return 'Veau';
            if (normalized.includes('poulet')) return 'Poulet';
            if (normalized.includes('volaille')) return 'Volaille';
            if (normalized.includes('bovin')) return 'Bovin';

            // Default behavior: clean the string (capitalize first letter)
            return rawCategory.trim().charAt(0).toUpperCase() + rawCategory.trim().slice(1).toLowerCase();
        }
        
        // Prepare Sequelize conditions
        const whereConditions = {};
        
        if (pointVente && pointVente !== 'tous') {
            whereConditions.pointVente = pointVente;
        }
        
        // Retrieve all sales matching the criteria
        const allVentes = await Vente.findAll({
            where: whereConditions,
            order: [['createdAt', 'DESC']]
        });
        
        // Filter sales by date range
        const filteredVentes = allVentes.filter(vente => 
            isDateInRange(vente.date, startFormatted, endFormatted)
        );
        
        console.log(`Nombre total de ventes récupérées: ${allVentes.length}`);
        console.log(`Nombre de ventes après filtrage par date: ${filteredVentes.length}`);
        
        // Aggregate data by point de vente, category, and product
        const aggregationsByPDV = {};
        
        filteredVentes.forEach(vente => {
            const pdv = vente.pointVente;
            const category = mapToCanonicalCategory(vente.categorie);
            const produit = vente.produit || 'Non spécifié';
            const montant = parseFloat(vente.montant) || 0;
            const nombre = parseFloat(vente.nombre) || 0;
            
            // Initialize point de vente if not exists
            if (!aggregationsByPDV[pdv]) {
                aggregationsByPDV[pdv] = {
                    pointVente: pdv,
                    categories: {},
                    totalPointVente: 0
                };
            }
            
            // Initialize category if not exists
            if (!aggregationsByPDV[pdv].categories[category]) {
                aggregationsByPDV[pdv].categories[category] = {
                    categorie: category,
                    totalMontant: 0,
                    totalNombre: 0,
                    nombreVentes: 0,
                    produits: {}
                };
            }
            
            // Initialize product if not exists
            if (!aggregationsByPDV[pdv].categories[category].produits[produit]) {
                aggregationsByPDV[pdv].categories[category].produits[produit] = {
                    produit: produit,
                    totalMontant: 0,
                    totalNombre: 0,
                    nombreVentes: 0
                };
            }
            
            // Add to product aggregations
            aggregationsByPDV[pdv].categories[category].produits[produit].totalMontant += montant;
            aggregationsByPDV[pdv].categories[category].produits[produit].totalNombre += nombre;
            aggregationsByPDV[pdv].categories[category].produits[produit].nombreVentes += 1;
            
            // Add to category aggregations
            aggregationsByPDV[pdv].categories[category].totalMontant += montant;
            aggregationsByPDV[pdv].categories[category].totalNombre += nombre;
            aggregationsByPDV[pdv].categories[category].nombreVentes += 1;
            aggregationsByPDV[pdv].totalPointVente += montant;
        });
        
        // Convert aggregations to array format
        const aggregations = Object.values(aggregationsByPDV).map(pdvData => ({
            pointVente: pdvData.pointVente,
            categories: Object.values(pdvData.categories).map(catData => ({
                categorie: catData.categorie,
                totalMontant: Math.round(catData.totalMontant * 100) / 100,
                totalNombre: Math.round(catData.totalNombre * 100) / 100,
                nombreVentes: catData.nombreVentes,
                produits: Object.values(catData.produits).map(prodData => ({
                    produit: prodData.produit,
                    totalMontant: Math.round(prodData.totalMontant * 100) / 100,
                    totalNombre: Math.round(prodData.totalNombre * 100) / 100,
                    nombreVentes: prodData.nombreVentes
                }))
            })),
            totalPointVente: Math.round(pdvData.totalPointVente * 100) / 100
        }));
        
        // Calculate global total
        const totalGeneral = aggregations.reduce((sum, pdv) => sum + pdv.totalPointVente, 0);
        
        console.log(`Nombre de points de vente avec des ventes: ${aggregations.length}`);
        console.log('==== END EXTERNAL API - VENTES DATE AGGREGATED ====');
        
        res.json({
            success: true,
            periode: {
                debut: start_date,
                fin: end_date
            },
            aggregations: aggregations,
            totalGeneral: Math.round(totalGeneral * 100) / 100,
            metadata: {
                nombreVentesTotales: filteredVentes.length,
                nombrePointsVente: aggregations.length,
                pointVenteFiltre: pointVente || 'tous'
            }
        });
        
    } catch (error) {
        console.error('Erreur lors de l\'agrégation des ventes (API externe):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'agrégation des ventes',
            error: error.message
        });
    }
});

// External API for pack sales aggregation with composition breakdown
app.get('/api/external/ventes-date/pack/aggregated', validateApiKeyOrSession, async (req, res) => {
    try {
        const { 
            start_date, 
            end_date, 
            pointVente,
            boeufPackAchat,
            veauPackAchat,
            agneauPackAchat,
            pouletPackAchat,
            oeufPackAchat
        } = req.query;
        
        // Parse purchase prices with defaults
        const prixAchatBoeuf = parseFloat(boeufPackAchat) || 3500;
        const prixAchatVeau = parseFloat(veauPackAchat) || 3600;
        const prixAchatAgneau = parseFloat(agneauPackAchat) || 3800;
        const prixAchatPoulet = parseFloat(pouletPackAchat) || 2800;
        const prixAchatOeuf = parseFloat(oeufPackAchat) || 2500;
        
        console.log('==== EXTERNAL API - PACK AGGREGATION ====');
        console.log('Paramètres reçus:', { start_date, end_date, pointVente });
        console.log('Prix d\'achat packs:', {
            boeuf: prixAchatBoeuf,
            veau: prixAchatVeau,
            agneau: prixAchatAgneau,
            poulet: prixAchatPoulet,
            oeuf: prixAchatOeuf
        });
        
        // Validate input
        if (!start_date || !end_date) {
            return res.status(400).json({ 
                success: false, 
                message: 'start_date et end_date sont requis (format: YYYY-MM-DD)' 
            });
        }
        
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Format de date invalide. Utilisez YYYY-MM-DD' 
            });
        }
        
        // Check date range validity
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        
        if (startDate > endDate) {
            return res.status(400).json({ 
                success: false, 
                message: 'start_date doit être antérieure ou égale à end_date' 
            });
        }
        
        // Limit to 365 days
        const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        if (daysDiff > 365) {
            return res.status(400).json({ 
                success: false, 
                message: 'La période ne peut pas dépasser 365 jours' 
            });
        }
        
        // Load pack compositions and products
        const { getPackComposition } = require('./config/pack-compositions');
        
        // ALWAYS use API parameters for prices (ignore produits.js and produitsInventaire.js)
        const PRIX_PACK_PARAMS = {
            "Veau": prixAchatVeau,
            "Veau en détail": prixAchatVeau,
            "Veau en gros": prixAchatVeau,
            "Boeuf": prixAchatBoeuf,
            "Boeuf en détail": prixAchatBoeuf,
            "Boeuf en gros": prixAchatBoeuf,
            "Poulet": prixAchatPoulet,
            "Poulet en détail": prixAchatPoulet,
            "Poulet en gros": prixAchatPoulet,
            "Agneau": prixAchatAgneau,
            "Oeuf": prixAchatOeuf,
            "Merguez": prixAchatAgneau // Use agneau price for merguez
        };
        
        console.log('📦 Prix d\'achat packs (utilisés pour calcul):', PRIX_PACK_PARAMS);
        
        // Function to get unit price from parameters only
        const getPrixUnitaireAvecFallback = (nomProduit, pointVente) => {
            // ALWAYS use parameters, never read produits.js
            if (PRIX_PACK_PARAMS[nomProduit]) {
                return { 
                    prix: PRIX_PACK_PARAMS[nomProduit], 
                    fallback: false 
                };
            }
            
            // No price found
            console.warn(`⚠️ Prix non trouvé pour le produit: ${nomProduit}`);
            return { 
                prix: 0, 
                fallback: true 
            };
        };
        
        // Helper to convert date to DD-MM-YYYY for comparison
        const convertToComparableDate = (dateStr) => {
            if (!dateStr) return null;
            
            // Handle YYYY-MM-DD format
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return dateStr;
            }
            
            // Handle DD-MM-YYYY format
            if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
                const [day, month, year] = dateStr.split('-');
                return `${year}-${month}-${day}`;
            }
            
            return null;
        };
        
        const isDateInRange = (venteDate, start, end) => {
            const comparable = convertToComparableDate(venteDate);
            if (!comparable) return false;
            return comparable >= start && comparable <= end;
        };
        
        // Build query conditions
        const whereConditions = {
            categorie: 'Pack'
        };
        
        if (pointVente && pointVente !== 'tous') {
            whereConditions.pointVente = pointVente;
        }
        
        // Retrieve pack sales
        const allPackVentes = await Vente.findAll({
            where: whereConditions,
            order: [['date', 'ASC']]
        });
        
        // Filter by date range
        const filteredPackVentes = allPackVentes.filter(vente => 
            isDateInRange(vente.date, start_date, end_date)
        );
        
        console.log(`Nombre de ventes de packs récupérées: ${allPackVentes.length}`);
        console.log(`Nombre de ventes de packs après filtrage: ${filteredPackVentes.length}`);
        
        // Aggregation data structures
        const agregationParPV = {};
        const statsModifications = {
            modifiees: 0,
            defaut: 0
        };
        
        // Process each pack sale
        filteredPackVentes.forEach(vente => {
            const pv = vente.pointVente;
            const packType = vente.produit;
            const quantitePacks = parseFloat(vente.nombre) || 1;
            const montant = parseFloat(vente.montant) || 0;
            let composition;
            let utiliseMappingDefaut;
            
            // Determine composition
            if (vente.extension && vente.extension.composition) {
                composition = vente.extension.composition;
                utiliseMappingDefaut = false;
                statsModifications.modifiees++;
            } else {
                composition = getPackComposition(packType);
                utiliseMappingDefaut = true;
                statsModifications.defaut++;
            }
            
            if (!composition) {
                console.warn(`Composition non trouvée pour ${packType}`);
                return;
            }
            
            // Initialize point de vente
            if (!agregationParPV[pv]) {
                agregationParPV[pv] = {
                    totalPacks: 0,
                    montantTotal: 0,
                    packsVendus: {},
                    compositionAgregee: {},
                    statsModifications: {
                        totalCompositionsModifiees: 0,
                        totalCompositionsDefaut: 0
                    }
                };
            }
            
            // Update pack stats
            agregationParPV[pv].totalPacks += quantitePacks;
            agregationParPV[pv].montantTotal += montant;
            
            if (utiliseMappingDefaut) {
                agregationParPV[pv].statsModifications.totalCompositionsDefaut += quantitePacks;
            } else {
                agregationParPV[pv].statsModifications.totalCompositionsModifiees += quantitePacks;
            }
            
            // Initialize pack type
            if (!agregationParPV[pv].packsVendus[packType]) {
                agregationParPV[pv].packsVendus[packType] = {
                    quantite: 0,
                    montantTotal: 0,
                    detailsParJour: []
                };
            }
            
            agregationParPV[pv].packsVendus[packType].quantite += quantitePacks;
            agregationParPV[pv].packsVendus[packType].montantTotal += montant;
            agregationParPV[pv].packsVendus[packType].detailsParJour.push({
                date: vente.date,
                quantite: quantitePacks,
                utiliseMappingDefaut
            });
            
            // Aggregate composition components
            composition.forEach(item => {
                const produit = item.produit;
                const quantiteTotale = item.quantite * quantitePacks;
                
                if (!agregationParPV[pv].compositionAgregee[produit]) {
                    agregationParPV[pv].compositionAgregee[produit] = {
                        quantite: 0,
                        unite: item.unite
                    };
                    
                    if (item.poids_unitaire) {
                        agregationParPV[pv].compositionAgregee[produit].poids_unitaire = item.poids_unitaire;
                        agregationParPV[pv].compositionAgregee[produit].poidsTotal = 0;
                    }
                }
                
                agregationParPV[pv].compositionAgregee[produit].quantite += quantiteTotale;
                
                if (item.poids_unitaire) {
                    agregationParPV[pv].compositionAgregee[produit].poidsTotal += 
                        quantiteTotale * item.poids_unitaire;
                }
            });
        });
        
        // Calculate prices, informative amounts and contributions for each point de vente
        const avertissementsProduits = new Set();
        
        Object.keys(agregationParPV).forEach(pv => {
            let montantInformatifPV = 0;
            
            // Calculate price and informative amount for each product
            Object.keys(agregationParPV[pv].compositionAgregee).forEach(produit => {
                const item = agregationParPV[pv].compositionAgregee[produit];
                const { prix, fallback } = getPrixUnitaireAvecFallback(produit, pv);
                
                item.prixUnitaire = prix;
                item.fallbackPrix = fallback;
                item.montantInformatif = Math.round(item.quantite * prix);
                
                montantInformatifPV += item.montantInformatif;
                
                if (fallback && prix === 0) {
                    avertissementsProduits.add(produit);
                }
            });
            
            // Add montantInformatif to point de vente
            agregationParPV[pv].montantInformatif = montantInformatifPV;
            
            // Calculate margin
            const montantTotal = agregationParPV[pv].montantTotal;
            agregationParPV[pv].margeAbsolue = montantTotal - montantInformatifPV;
            agregationParPV[pv].margePourcentage = montantInformatifPV > 0
                ? Math.round((agregationParPV[pv].margeAbsolue / montantInformatifPV) * 100 * 10) / 10
                : 0;
            
            // Calculate contribution percentage for each product
            Object.keys(agregationParPV[pv].compositionAgregee).forEach(produit => {
                const item = agregationParPV[pv].compositionAgregee[produit];
                item.contributionPourcentage = montantInformatifPV > 0
                    ? Math.round((item.montantInformatif / montantInformatifPV) * 100 * 10) / 10
                    : 0;
            });
            
            // Calculate stats percentages
            const stats = agregationParPV[pv].statsModifications;
            const total = stats.totalCompositionsModifiees + stats.totalCompositionsDefaut;
            stats.pourcentageModifications = total > 0 
                ? Math.round((stats.totalCompositionsModifiees / total) * 100 * 10) / 10 
                : 0;
        });
        
        // Calculate global aggregation
        const globalAgregation = {
            totalPacksVendus: 0,
            montantTotalPacks: 0,
            repartitionParType: {},
            compositionTotale: {},
            statsModifications: {
                totalCompositionsModifiees: statsModifications.modifiees,
                totalCompositionsDefaut: statsModifications.defaut,
                pourcentageModifications: 0
            }
        };
        
        Object.values(agregationParPV).forEach(pvData => {
            globalAgregation.totalPacksVendus += pvData.totalPacks;
            globalAgregation.montantTotalPacks += pvData.montantTotal;
            
            // Aggregate by pack type
            Object.entries(pvData.packsVendus).forEach(([packType, data]) => {
                if (!globalAgregation.repartitionParType[packType]) {
                    globalAgregation.repartitionParType[packType] = 0;
                }
                globalAgregation.repartitionParType[packType] += data.quantite;
            });
            
            // Aggregate composition
            Object.entries(pvData.compositionAgregee).forEach(([produit, data]) => {
                if (!globalAgregation.compositionTotale[produit]) {
                    globalAgregation.compositionTotale[produit] = {
                        quantite: 0,
                        unite: data.unite,
                        prixUnitaire: data.prixUnitaire,
                        fallbackPrix: data.fallbackPrix,
                        montantInformatif: 0
                    };
                    
                    if (data.poidsTotal !== undefined) {
                        globalAgregation.compositionTotale[produit].poids_unitaire = data.poids_unitaire;
                        globalAgregation.compositionTotale[produit].poidsTotal = 0;
                    }
                }
                
                globalAgregation.compositionTotale[produit].quantite += data.quantite;
                globalAgregation.compositionTotale[produit].montantInformatif += data.montantInformatif;
                
                if (data.poidsTotal !== undefined) {
                    globalAgregation.compositionTotale[produit].poidsTotal += data.poidsTotal;
                }
            });
        });
        
        // Calculate global montantInformatif
        let globalMontantInformatif = 0;
        Object.values(globalAgregation.compositionTotale).forEach(data => {
            globalMontantInformatif += data.montantInformatif;
        });
        
        globalAgregation.montantInformatif = globalMontantInformatif;
        globalAgregation.margeAbsolue = globalAgregation.montantTotalPacks - globalMontantInformatif;
        globalAgregation.margePourcentage = globalMontantInformatif > 0
            ? Math.round((globalAgregation.margeAbsolue / globalMontantInformatif) * 100 * 10) / 10
            : 0;
        
        // Calculate global contribution percentages
        Object.keys(globalAgregation.compositionTotale).forEach(produit => {
            const item = globalAgregation.compositionTotale[produit];
            item.contributionPourcentage = globalMontantInformatif > 0
                ? Math.round((item.montantInformatif / globalMontantInformatif) * 100 * 10) / 10
                : 0;
        });
        
        // Add warnings if there are products with fallback prices
        if (avertissementsProduits.size > 0) {
            globalAgregation.avertissements = [
                {
                    type: 'fallback_prix',
                    message: `${avertissementsProduits.size} produit(s) utilisent des prix par défaut (fallback)`,
                    produitsConcernes: Array.from(avertissementsProduits),
                    impact: 'Les montants informatifs peuvent être imprécis pour ces produits'
                }
            ];
        }
        
        // Calculate global percentage
        const totalGlobal = statsModifications.modifiees + statsModifications.defaut;
        globalAgregation.statsModifications.pourcentageModifications = totalGlobal > 0
            ? Math.round((statsModifications.modifiees / totalGlobal) * 100 * 10) / 10
            : 0;
        
        // Round numbers for cleaner output
        Object.keys(agregationParPV).forEach(pv => {
            agregationParPV[pv].montantTotal = Math.round(agregationParPV[pv].montantTotal);
            Object.keys(agregationParPV[pv].compositionAgregee).forEach(produit => {
                const item = agregationParPV[pv].compositionAgregee[produit];
                item.quantite = Math.round(item.quantite * 100) / 100;
                if (item.poidsTotal !== undefined) {
                    item.poidsTotal = Math.round(item.poidsTotal * 100) / 100;
                }
            });
        });
        
        globalAgregation.montantTotalPacks = Math.round(globalAgregation.montantTotalPacks);
        Object.keys(globalAgregation.compositionTotale).forEach(produit => {
            const item = globalAgregation.compositionTotale[produit];
            item.quantite = Math.round(item.quantite * 100) / 100;
            if (item.poidsTotal !== undefined) {
                item.poidsTotal = Math.round(item.poidsTotal * 100) / 100;
            }
        });
        
        console.log(`Nombre de points de vente avec des ventes de packs: ${Object.keys(agregationParPV).length}`);
        console.log(`Total packs vendus: ${globalAgregation.totalPacksVendus}`);
        console.log('==== END EXTERNAL API - PACK AGGREGATION ====');
        
        res.json({
            success: true,
            periode: {
                start: start_date,
                end: end_date,
                nbJours: daysDiff + 1
            },
            pointsVente: agregationParPV,
            globalAgregation: globalAgregation
        });
        
    } catch (error) {
        console.error('Erreur lors de l\'agrégation des packs (API externe):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'agrégation des packs',
            error: error.message
        });
    }
});

// External API version for ventes with date range support (OPTIMIZED)
app.get('/api/external/ventes', validateApiKey, async (req, res) => {
    try {
        const { dateDebut, dateFin, pointVente } = req.query;
        
        // Validate input - at least one date parameter is required
        if (!dateDebut && !dateFin) {
            return res.status(400).json({ 
                success: false, 
                message: 'Au moins un paramètre de date (dateDebut ou dateFin) est requis (format: yyyy-mm-dd)' 
            });
        }
        
        console.log('==== EXTERNAL API - VENTES WITH DATE RANGE ====');
        console.log('Paramètres reçus:', { dateDebut, dateFin, pointVente });
        
        // Fonction pour convertir une date ISO (YYYY-MM-DD) en format DD-MM-YYYY
        const convertISOToAppFormat = (isoDate) => {
            const date = new Date(isoDate);
            const jour = date.getDate().toString().padStart(2, '0');
            const mois = (date.getMonth() + 1).toString().padStart(2, '0');
            const annee = date.getFullYear();
            return `${jour}-${mois}-${annee}`;
        };
        
        // Fonction pour comparer des dates (gère les formats DD-MM-YYYY et YYYY-MM-DD)
        const isDateInRange = (dateToCheck, startDate, endDate) => {
            // Convertir les dates au format comparable (YYYY-MM-DD)
            const convertToComparable = (dateStr) => {
                if (!dateStr) return '';
                
                // Si la date est déjà au format YYYY-MM-DD, la retourner telle quelle
                if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    return dateStr;
                }
                
                // Sinon, supposer le format DD-MM-YYYY
                const [day, month, year] = dateStr.split('-');
                return `${year}-${month}-${day}`;
            };
            
            const comparableDate = convertToComparable(dateToCheck);
            const comparableStart = startDate ? convertToComparable(startDate) : '';
            const comparableEnd = endDate ? convertToComparable(endDate) : '';
            
            let isInRange = true;
            
            if (comparableStart && comparableDate) {
                isInRange = isInRange && (comparableDate >= comparableStart);
            }
            
            if (comparableEnd && comparableDate) {
                isInRange = isInRange && (comparableDate <= comparableEnd);
            }
            
            return isInRange;
        };
        
        // Préparer les conditions de filtrage pour Sequelize
        const whereConditions = {};
        
        if (pointVente && pointVente !== 'tous') {
            whereConditions.pointVente = pointVente;
        }
        
        console.log('Conditions Sequelize:', whereConditions);
        
        // Si on a des critères de date, on fait une recherche complète et on filtre après
        let debutFormatted = null;
        let finFormatted = null;
        
        if (dateDebut) {
            debutFormatted = convertISOToAppFormat(dateDebut);
            console.log(`Date début convertie: ${dateDebut} → ${debutFormatted}`);
        }
        
        if (dateFin) {
            finFormatted = convertISOToAppFormat(dateFin);
            console.log(`Date fin convertie: ${dateFin} → ${finFormatted}`);
        }
        
        // Récupérer toutes les ventes qui correspondent aux autres critères
        const allVentes = await Vente.findAll({
            where: whereConditions,
            order: [['createdAt', 'DESC']]
        });
        
        // Filtrer les ventes selon la date
        const filteredVentes = allVentes.filter(vente => 
            isDateInRange(vente.date, debutFormatted, finFormatted)
        );
        
        console.log(`Nombre total de ventes récupérées: ${allVentes.length}`);
        console.log(`Nombre de ventes après filtrage par date: ${filteredVentes.length}`);
        
        // Log pour debug - afficher quelques exemples de dates trouvées
        if (filteredVentes.length > 0) {
            console.log('Exemples de ventes filtrées:');
            filteredVentes.slice(0, 3).forEach((vente, index) => {
                console.log(`  ${index + 1}. Date: ${vente.date}, Point: ${vente.pointVente}, Produit: ${vente.produit}, Montant: ${vente.montant}`);
            });
        }
        
        // Formater les données pour la réponse (même format que l'API interne)
        const formattedVentes = filteredVentes.map(vente => ({
            Mois: vente.mois,
            Date: vente.date,
            Semaine: vente.semaine,
            'Point de Vente': vente.pointVente,
            Preparation: vente.preparation,
            Catégorie: vente.categorie,
            Produit: vente.produit,
            PU: vente.prixUnit,
            Nombre: vente.nombre,
            Montant: vente.montant,
            nomClient: vente.nomClient,
            numeroClient: vente.numeroClient,
            adresseClient: vente.adresseClient,
            creance: vente.creance
        }));
        
        // Calculer les totaux par point de vente (pour compatibilité avec l'API interne)
        const totauxParPointVente = {};
        filteredVentes.forEach(vente => {
            const point = vente.pointVente;
            const produit = vente.produit;
            
            if (!totauxParPointVente[point]) {
                totauxParPointVente[point] = {};
            }
            
            if (!totauxParPointVente[point][produit]) {
                totauxParPointVente[point][produit] = {
                    quantite: 0,
                    montant: 0
                };
            }
            
            totauxParPointVente[point][produit].quantite += parseFloat(vente.nombre || 0);
            totauxParPointVente[point][produit].montant += parseFloat(vente.montant || 0);
        });
        
        console.log('Nombre de ventes external API:', formattedVentes.length);
        console.log('==== END EXTERNAL API - VENTES WITH DATE RANGE ====');
        
        res.json({ 
            success: true, 
            ventes: formattedVentes,
            totaux: totauxParPointVente,
            metadata: {
                totalVentes: formattedVentes.length,
                dateDebut: dateDebut,
                dateFin: dateFin,
                pointVente: pointVente || 'tous',
                optimized: true // Indique que c'est la version optimisée
            }
        });
        
    } catch (error) {
        console.error('Erreur lors de la recherche des ventes avec intervalle (API externe):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la recherche des ventes avec intervalle',
            error: error.message
        });
    }
});

// External API version for stock information
app.get('/api/external/stock/:type', validateApiKey, async (req, res) => {
    try {
        const type = req.params.type;
        const date = req.query.date;
        const baseFilePath = type === 'matin' ? STOCK_MATIN_PATH : STOCK_SOIR_PATH;
        
        // Obtenir le chemin du fichier spécifique à la date
        const filePath = getPathByDate(baseFilePath, date);
        
        // Vérifier si le fichier existe
        if (!fs.existsSync(filePath)) {
            // Si le fichier n'existe pas, retourner un objet vide
            console.log(`Fichier de stock ${type} pour la date ${date} non trouvé, retour d'un objet vide`);
            return res.json({});
        }
        
        const data = await fsPromises.readFile(filePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        res.status(500).json({ error: 'Erreur lors du chargement des données' });
    }
});

// External API version for detailed stock information
app.get('/api/external/stock/:date/:type/:pointVente/:categorie', validateApiKey, async (req, res) => {
    try {
        const { date, type, pointVente, categorie } = req.params;
        
        if (!date || !type || !pointVente || !categorie) {
            console.warn('Missing required parameters:', { date, type, pointVente, categorie });
            return res.status(400).json({ 
                success: false,
                stock: 0,
                error: 'Paramètres requis manquants'
            });
        }

        // Obtenir le chemin du fichier en utilisant getPathByDate pour gérer les formats de date
        const baseFilePath = type === 'matin' ? STOCK_MATIN_PATH : STOCK_SOIR_PATH;
        const filePath = getPathByDate(baseFilePath, date);

        // Vérifier si le fichier existe
        if (!fs.existsSync(filePath)) {
            console.log(`Fichier stock non trouvé: ${filePath}`);
            return res.json({ 
                success: true,
                stock: 0,
                message: 'Aucune donnée de stock trouvée pour cette date'
            });
        }

        // Lire et parser le fichier JSON
        const fileContent = await fsPromises.readFile(filePath, 'utf8');
        const data = JSON.parse(fileContent);
        
        // Chercher l'entrée avec la clé correspondante: pointVente-categorie
        const key = `${pointVente}-${categorie}`;
        const entry = data[key];

        if (entry && entry.Nombre !== undefined) {
            const stockValue = parseFloat(entry.Nombre) || 0;
            res.json({ 
                success: true,
                stock: stockValue
            });
        } else {
            res.json({ 
                success: true,
                stock: 0,
                message: 'Aucune valeur de stock trouvée'
            });
        }
    } catch (error) {
        console.error('Erreur lors de la lecture des données de stock:', error);
        res.status(500).json({ 
            success: false,
            stock: 0,
            error: error.message
        });
    }
});

// External API version for transfer information
app.get('/api/external/transferts', validateApiKey, async (req, res) => {
    try {
        const { date } = req.query;
        
        if (date) {
            // Obtenir le chemin du fichier spécifique à la date
            const filePath = getPathByDate(TRANSFERTS_PATH, date);
            
            // Vérifier si le fichier spécifique existe
            if (fs.existsSync(filePath)) {
                const content = await fsPromises.readFile(filePath, 'utf8');
                const transferts = JSON.parse(content || '[]');
                return res.json({ success: true, transferts });
            }
            
            // Si le fichier spécifique n'existe pas, chercher dans le fichier principal
            if (fs.existsSync(TRANSFERTS_PATH)) {
                const content = await fsPromises.readFile(TRANSFERTS_PATH, 'utf8');
                const allTransferts = JSON.parse(content || '[]');
                // Filtrer les transferts par date
                const transferts = allTransferts.filter(t => t.date === date);
                return res.json({ success: true, transferts });
            }
            
            // Si aucun fichier n'existe, retourner un tableau vide
            return res.json({ success: true, transferts: [] });
        } else {
            // Retourner tous les transferts depuis le fichier principal
            if (fs.existsSync(TRANSFERTS_PATH)) {
                const content = await fsPromises.readFile(TRANSFERTS_PATH, 'utf8');
                const transferts = JSON.parse(content || '[]');
                return res.json({ success: true, transferts });
            }
            
            // Si le fichier n'existe pas, retourner un tableau vide
            return res.json({ success: true, transferts: [] });
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des transferts:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des transferts',
            error: error.message 
        });
    }
});

// External API version for specific transfer information
app.get('/api/external/stock/:date/transfert/:pointVente/:categorie', validateApiKey, async (req, res) => {
    try {
        const { date, pointVente, categorie } = req.params;
        
        if (!date || !pointVente || !categorie) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date, point de vente et catégorie sont requis pour les transferts' 
            });
        }

        const dateStandardisee = standardiserDateFormat(date);
        
        // Rechercher dans les deux formats possibles (YYYY-MM-DD et DD-MM-YYYY)
        let dateDDMMYYYY = date;
        if (date.includes('/')) {
            dateDDMMYYYY = date.replace(/\//g, '-');
        }
        
        // Calculer les transferts pour la date et le point de vente donnés
        const transferts = await Transfert.findAll({
            where: {
                [Op.or]: [
                    { date: dateStandardisee },  // Format YYYY-MM-DD
                    { date: dateDDMMYYYY }        // Format DD-MM-YYYY
                ],
                pointVente: pointVente
            }
        });

        // Calculer la somme des transferts pour la catégorie donnée
        let totalTransfert = 0;
        transferts.forEach(t => {
            if (t.categorie === categorie) {
                totalTransfert += parseFloat(t.quantite) || 0;
            }
        });

        res.json({ 
            success: true, 
            transfert: totalTransfert,
            message: transferts.length === 0 ? "Aucune donnée de transfert trouvée pour cette date" : ""
        });
    } catch (error) {
        console.error('Erreur lors du calcul des transferts:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du calcul des transferts' 
        });
    }
});

// External API version for cash payments
app.get('/api/external/cash-payments', validateApiKey, async (req, res) => {
    try {
        const { date } = req.query;
        
        // Validate input
        if (!date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date parameter is required (format: dd-mm-yyyy)' 
            });
        }
        
        console.log('==== EXTERNAL API - CASH PAYMENTS ====');
        console.log('Querying cash payments for date:', date);
        
        // Convert date from dd-mm-yyyy to yyyy-mm-dd for database query
        let sqlDate;
        try {
            const parts = date.split(/[-\/]/); // Handle both dash and slash formats
            if (parts.length !== 3) throw new Error('Invalid date format.');
            sqlDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
            
            // Validate the converted date
            if (isNaN(new Date(sqlDate).getTime())) {
                throw new Error('Invalid date after conversion.');
            }
        } catch (e) {
            console.error("Date format error:", e);
            return res.status(400).json({ 
                success: false, 
                message: `Invalid date format: ${date}. Use DD-MM-YYYY or DD/MM/YYYY.` 
            });
        }
        
        // Ensure the table exists
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS cash_payments (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                created_at TIMESTAMP NOT NULL,
                amount FLOAT NOT NULL,
                merchant_fee FLOAT,
                customer_fee FLOAT,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(255),
                entete_trans_type VARCHAR(255),
                psp_name VARCHAR(255),
                payment_category VARCHAR(255),
                payment_means VARCHAR(255),
                payment_reference VARCHAR(255),
                merchant_reference VARCHAR(255),
                trn_status VARCHAR(255),
                tr_id VARCHAR(255),
                cust_country VARCHAR(255),
                aggregation_mt VARCHAR(255),
                total_nom_marchand VARCHAR(255),
                total_marchand VARCHAR(255),
                merchant_id VARCHAR(255),
                name_first VARCHAR(255),
                point_de_vente VARCHAR(255),
                date DATE,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Query the database for the specified date
        const result = await sequelize.query(`
            SELECT point_de_vente, SUM(amount) as total
            FROM cash_payments
            WHERE date = :date
            GROUP BY point_de_vente
            ORDER BY point_de_vente
        `, {
            replacements: { date: sqlDate },
            type: sequelize.QueryTypes.SELECT
        });
        
        // Format response to match the internal API structure
        const formattedResponse = {
            date: sqlDate,
            points: result.map(item => ({
                point: item.point_de_vente,
                total: parseFloat(item.total) || 0
            }))
        };
        
        console.log(`Found ${formattedResponse.points.length} cash payment entries for date ${sqlDate}`);
        console.log('==== END EXTERNAL API - CASH PAYMENTS ====');
        
        res.json({
            success: true,
            data: formattedResponse
        });
    } catch (error) {
        console.error('Error retrieving cash payment data (External API):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error retrieving cash payment data',
            error: error.message
        });
    }
});

// External API version for reconciliation
app.get('/api/external/reconciliation', validateApiKey, async (req, res) => {
    try {
        const { date } = req.query;
        
        // Validate input
        if (!date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date parameter is required (format: dd-mm-yyyy or dd/mm/yyyy)' 
            });
        }
        
        // Convert date format to DD/MM/YYYY for database queries
        // Accept both DD-MM-YYYY and DD/MM/YYYY formats
        let dbDate = date;
        if (date.includes('-')) {
            dbDate = date.replace(/-/g, '/');
        }
        // If already in DD/MM/YYYY format, keep as is
        
        console.log('==== EXTERNAL API - RECONCILIATION ====');
        console.log('Input date:', date);
        console.log('Database date format:', dbDate);
        
        // Get stock type parameter value for stock endpoints
        const typeParam = { type: 'matin' };
        const typeParamSoir = { type: 'soir' };
        
        // Use a safer approach with proper HTTP requests
        const axiosInstance = require('axios').create({
            baseURL: `http://localhost:${PORT}`,
            headers: {
                'X-API-Key': req.headers['x-api-key']
            }
        });
        
        // Function to safely make HTTP requests to our own API endpoints
        const fetchData = async (endpoint, params = {}) => {
            try {
                console.log(`Fetching data from ${endpoint} with params:`, params);
                const response = await axiosInstance.get(endpoint, { params });
                return response.data;
            } catch (error) {
                console.error(`Error fetching ${endpoint}:`, error.message);
                throw new Error(`Failed to fetch data from ${endpoint}: ${error.message}`);
            }
        };
        
        // Fetch all necessary data in parallel
        const [ventesData, stockMatinData, stockSoirData, cashData, transfertsData] = await Promise.all([
            fetchData('/api/external/ventes-date', { date }),
            fetchData('/api/external/stock/matin', { date }),  
            fetchData('/api/external/stock/soir', { date }),   
            fetchData('/api/external/cash-payments', { date }),
            fetchData('/api/external/transferts', { date })
        ]);
        
        // Fetch reconciliation comments from database
        let reconciliationComments = {};
        try {
            const Reconciliation = require('./db/models/Reconciliation');
            const existingReconciliation = await Reconciliation.findOne({ where: { date: dbDate } });
            if (existingReconciliation) {
                // First try to get comments from the separate comments field
                if (existingReconciliation.comments) {
                reconciliationComments = JSON.parse(existingReconciliation.comments);
                    console.log('Comments loaded from comments field:', reconciliationComments);
                }
                
                // If no comments in separate field, extract from data field
                if (Object.keys(reconciliationComments).length === 0 && existingReconciliation.data) {
                    const reconciliationData = JSON.parse(existingReconciliation.data);
                    Object.keys(reconciliationData).forEach(pointVente => {
                        if (reconciliationData[pointVente].commentaire) {
                            reconciliationComments[pointVente] = reconciliationData[pointVente].commentaire;
                        }
                    });
                    console.log('Comments extracted from data field:', reconciliationComments);
                }
            }
        } catch (error) {
            console.error('Error loading reconciliation comments:', error);
            // Continue without comments if there's an error
        }
        
        // Debug logging
        console.log('Successfully fetched all necessary data');
        console.log('Stock Matin Data Structure:', JSON.stringify(stockMatinData).substring(0, 200) + '...');
        console.log('Stock Soir Data Structure:', JSON.stringify(stockSoirData).substring(0, 200) + '...');
        console.log('Transferts Data Structure:', JSON.stringify(transfertsData).substring(0, 200) + '...');
        
        // Fonction de mapping centralisée pour uniformiser les catégories
        function mapToCanonicalCategory(rawCategory) {
            if (!rawCategory || typeof rawCategory !== 'string') {
                return 'Non spécifié';
            }
            const normalized = rawCategory.trim().toLowerCase();

            if (normalized.includes('boeuf')) return 'Boeuf';
            if (normalized.includes('veau')) return 'Veau';
            if (normalized.includes('poulet')) return 'Poulet';
            if (normalized.includes('volaille')) return 'Volaille';
            if (normalized.includes('bovin')) return 'Bovin';

            // Comportement par défaut : nettoie la chaîne (Majuscule au début)
            return rawCategory.trim().charAt(0).toUpperCase() + rawCategory.trim().slice(1).toLowerCase();
        }
        
        // Prepare structures for aggregation
        const reconciliationByPDV = {};
        const detailsByPDV = {};
        
        // Dynamically get all categories and points of sale
        const allCategories = produitsInventaire.getTousLesProduits();
        const allPDVs = Object.keys(pointsVente).filter(pdv => pointsVente[pdv].active);

        allPDVs.forEach(pdv => {
            detailsByPDV[pdv] = {};
            allCategories.forEach(cat => {
                detailsByPDV[pdv][cat] = {
                    stockMatin: 0,
                    stockSoir: 0,
                    transferts: 0,
                    ventesTheoriques: 0,
                    ventesSaisies: 0,
                    ventesTheoriquesNombre: 0,
                    ventesNombre: 0
                };
            });
        });
        
        // Processing sales data for each point de vente
        if (ventesData.success && ventesData.ventes) {
            // Group sales by point de vente and category
            ventesData.ventes.forEach(vente => {
                const pdv = vente.pointVente;
                const category = mapToCanonicalCategory(vente.categorie);
                const montant = parseFloat(vente.montant) || 0;
                
                // Initialize point de vente if not exists
                if (!reconciliationByPDV[pdv]) {
                    reconciliationByPDV[pdv] = {
                        pointVente: pdv,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0,
                        cashPayments: 0,
                        ecart: 0,
                        ecartPct: 0,
                        ecartCash: 0,
                        ecartCashPct: 0
                    };
                }
                
                // Initialize details if not exists
                if (!detailsByPDV[pdv]) {
                    detailsByPDV[pdv] = {};
                }
                
                // Initialize category if not exists
                if (!detailsByPDV[pdv][category]) {
                    detailsByPDV[pdv][category] = {
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0
                    };
                }
                
                // Add sales amount to resume (keep original logic)
                reconciliationByPDV[pdv].ventesSaisies += montant;
            });
        }
        
        // Process sales data specifically for details with special mapping logic
        if (ventesData.success && ventesData.ventes) {
            ventesData.ventes.forEach(vente => {
                const pdv = vente.pointVente;
                const originalCategory = vente.categorie;
                const produit = vente.produit;
                const montant = parseFloat(vente.montant) || 0;
                
                // Special mapping logic for reconciliation categories in details
                let reconciliationCategory = mapToCanonicalCategory(originalCategory);
                
                // Special case: For Boeuf, Veau, and Poulet, we need to aggregate specific products
                if (produit && produit.toLowerCase().includes('boeuf en gros')) {
                    reconciliationCategory = 'Boeuf';
                }
                else if (produit && produit.toLowerCase().includes('boeuf en detail') || produit && produit.toLowerCase().includes('boeuf en détail')) {
                    reconciliationCategory = 'Boeuf';
                }
                else if (produit && produit.toLowerCase().includes('veau en gros')) {
                    reconciliationCategory = 'Veau';
                }
                else if (produit && produit.toLowerCase().includes('veau en detail') || produit && produit.toLowerCase().includes('veau en détail')) {
                    reconciliationCategory = 'Veau';
                }
                else if (produit && produit.toLowerCase().includes('poulet en gros')) {
                    reconciliationCategory = 'Poulet';
                }
                else if (produit && produit.toLowerCase().includes('poulet en detail') || produit && produit.toLowerCase().includes('poulet en détail')) {
                    reconciliationCategory = 'Poulet';
                }
                else if (produit && produit.toLowerCase().includes('poulet')) {
                    reconciliationCategory = 'Poulet';
                }
                else if (produit && produit.toLowerCase().includes('volaille')) {
                    reconciliationCategory = 'Poulet';
                }
                // Special case: "Tablette" in reconciliation maps to "Oeuf" in ventes
                else if (produit && produit.toLowerCase().includes('oeuf')) {
                    reconciliationCategory = 'Tablette';
                }
                else {
                    // For all other products, use the original product name as-is
                    reconciliationCategory = produit;
                }
                
                console.log(`Mapping: ${produit} (${originalCategory}) -> ${reconciliationCategory} for ${pdv}`);
                
                // Initialize category in details if not exists
                if (!detailsByPDV[pdv]) {
                    detailsByPDV[pdv] = {};
                }
                if (!detailsByPDV[pdv][reconciliationCategory]) {
                    detailsByPDV[pdv][reconciliationCategory] = {
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0,
                        ventesTheoriquesNombre: 0,
                        ventesNombre: 0
                    };
                }
                
                // Add sales amount to details with special mapping
                detailsByPDV[pdv][reconciliationCategory].ventesSaisies += montant;
                
                // Add sales quantity to details
                const nombre = parseFloat(vente.nombre) || 0;
                detailsByPDV[pdv][reconciliationCategory].ventesNombre += nombre;
            });
        }
        
        console.log("After Ventes:", JSON.stringify(detailsByPDV['Sacre Coeur']?.['Boeuf']));
        
        // Processing stock-matin data - handles the format from stock API
        if (stockMatinData && typeof stockMatinData === 'object') {
            // Log a sample of keys to help debug
            const sampleKeys = Object.keys(stockMatinData).slice(0, 3);
            console.log('Sample stock matin keys:', sampleKeys);
            
            Object.entries(stockMatinData).forEach(([key, entry]) => {
                // Try different approaches to identify PDV and category
                let pdv, category;
                
                if (key.includes('-')) {
                    [pdv, category] = key.split('-');
                } else if (entry && entry.pointVente && entry.categorie) {
                    pdv = entry.pointVente;
                    category = entry.categorie;
                } else {
                    console.log('Skipping unknown stock entry format:', key);
                    return; // Skip this entry
                }
                
                // Appliquer le mapping de catégorie
                category = mapToCanonicalCategory(category);
                
                // Try different approaches to get stock value and price
                let stockValue = 0;
                let prixUnit = 0;
                
                if (entry.Nombre !== undefined) {
                    stockValue = parseFloat(entry.Nombre) || 0;
                    prixUnit = parseFloat(entry['Prix unitaire'] || entry.PU) || 0;
                } else if (entry.nombre !== undefined) {
                    stockValue = parseFloat(entry.nombre) || 0;
                    prixUnit = parseFloat(entry.prixUnit || entry.prixUnitaire || entry.prix || entry.PU) || 0;
                } else if (entry.quantite !== undefined) {
                    stockValue = parseFloat(entry.quantite) || 0;
                    prixUnit = parseFloat(entry.prixUnit || entry.prixUnitaire || entry.prix || entry.PU) || 0;
                }
                
                // If we have the Montant directly, that's even better
                let montant = 0;
                if (entry.Montant !== undefined) {
                    montant = parseFloat(entry.Montant) || 0;
                } else if (entry.montant !== undefined) {
                    montant = parseFloat(entry.montant) || 0;
                } else {
                    // Calculate from stock value and price
                    montant = stockValue * prixUnit;
                }
                
                // Log to debug
                if (montant > 0) {
                    console.log(`Adding stock matin for ${pdv}/${category}: ${stockValue} * ${prixUnit} = ${montant}`);
                }
                
                // Initialize point de vente if not exists
                if (!reconciliationByPDV[pdv]) {
                    reconciliationByPDV[pdv] = {
                        pointVente: pdv,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0,
                        cashPayments: 0,
                        ecart: 0,
                        ecartPct: 0,
                        ecartCash: 0,
                        ecartCashPct: 0
                    };
                }
                
                // Initialize details if not exists
                if (!detailsByPDV[pdv]) {
                    detailsByPDV[pdv] = {};
                }
                
                // Initialize category if not exists
                if (!detailsByPDV[pdv][category]) {
                    detailsByPDV[pdv][category] = {
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0
                    };
                }
                
                // Add stock-matin value
                reconciliationByPDV[pdv].stockMatin += montant;
                detailsByPDV[pdv][category].stockMatin += montant;
                
                // Store stock quantity for ventesTheoriquesNombre calculation
                if (!detailsByPDV[pdv][category].stockMatinNombre) {
                    detailsByPDV[pdv][category].stockMatinNombre = 0;
                }
                detailsByPDV[pdv][category].stockMatinNombre += stockValue;
            });
        }
        
        console.log("After Stock Matin:", JSON.stringify(detailsByPDV['Sacre Coeur']?.['Boeuf']));
        
        // Processing stock-soir data - handles the format from stock API
        if (stockSoirData && typeof stockSoirData === 'object') {
            // Log a sample of keys to help debug
            const sampleKeys = Object.keys(stockSoirData).slice(0, 3);
            console.log('Sample stock soir keys:', sampleKeys);
            
            Object.entries(stockSoirData).forEach(([key, entry]) => {
                // Try different approaches to identify PDV and category
                let pdv, category;
                
                if (key.includes('-')) {
                    [pdv, category] = key.split('-');
                } else if (entry && entry.pointVente && entry.categorie) {
                    pdv = entry.pointVente;
                    category = entry.categorie;
                } else {
                    console.log('Skipping unknown stock entry format:', key);
                    return; // Skip this entry
                }
                
                // Appliquer le mapping de catégorie
                category = mapToCanonicalCategory(category);
                
                // Try different approaches to get stock value and price
                let stockValue = 0;
                let prixUnit = 0;
                
                if (entry.Nombre !== undefined) {
                    stockValue = parseFloat(entry.Nombre) || 0;
                    prixUnit = parseFloat(entry['Prix unitaire']) || 0;
                } else if (entry.nombre !== undefined) {
                    stockValue = parseFloat(entry.nombre) || 0;
                    prixUnit = parseFloat(entry.prixUnit || entry.prixUnitaire || entry.prix || entry.PU) || 0;
                } else if (entry.quantite !== undefined) {
                    stockValue = parseFloat(entry.quantite) || 0;
                    prixUnit = parseFloat(entry.prixUnit || entry.prixUnitaire || entry.prix || entry.PU) || 0;
                }
                
                // If we have the Montant directly, that's even better
                let montant = 0;
                if (entry.Montant !== undefined) {
                    montant = parseFloat(entry.Montant) || 0;
                } else if (entry.montant !== undefined) {
                    montant = parseFloat(entry.montant) || 0;
                } else {
                    // Calculate from stock value and price
                    montant = stockValue * prixUnit;
                }
                
                // Log to debug
                if (montant > 0) {
                    console.log(`Adding stock soir for ${pdv}/${category}: ${stockValue} * ${prixUnit} = ${montant}`);
                }
                
                // Initialize point de vente if not exists
                if (!reconciliationByPDV[pdv]) {
                    reconciliationByPDV[pdv] = {
                        pointVente: pdv,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0,
                        cashPayments: 0,
                        ecart: 0,
                        ecartPct: 0,
                        ecartCash: 0,
                        ecartCashPct: 0
                    };
                }
                
                // Initialize details if not exists
                if (!detailsByPDV[pdv]) {
                    detailsByPDV[pdv] = {};
                }
                
                // Initialize category if not exists
                if (!detailsByPDV[pdv][category]) {
                    detailsByPDV[pdv][category] = {
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0
                    };
                }
                
                // Add stock-soir value
                reconciliationByPDV[pdv].stockSoir += montant;
                detailsByPDV[pdv][category].stockSoir += montant;
                
                // Store stock quantity for ventesTheoriquesNombre calculation
                if (!detailsByPDV[pdv][category].stockSoirNombre) {
                    detailsByPDV[pdv][category].stockSoirNombre = 0;
                }
                detailsByPDV[pdv][category].stockSoirNombre += stockValue;
            });
        }
        
        console.log("After Stock Soir:", JSON.stringify(detailsByPDV['Sacre Coeur']?.['Boeuf']));
        
        // Processing transfers data
        // Ajout d'une fonction utilitaire pour mapper les catégories de transferts
        function mapTransfertCategory(rawCategory) {
            if (!rawCategory) return 'Non spécifié';
            const normalized = rawCategory.trim().toLowerCase();
            if (normalized === 'boeuf' || normalized.includes('boeuf')) return 'Boeuf';
            if (normalized === 'poulet' || normalized.includes('poulet')) return 'Poulet';
            if (normalized === 'volaille' || normalized.includes('volaille')) return 'Volaille';
            if (normalized === 'bovin' || normalized.includes('bovin')) return 'Bovin';
            // Par défaut, retourne la première lettre en majuscule, le reste en minuscule
            return rawCategory.charAt(0).toUpperCase() + rawCategory.slice(1).toLowerCase();
        }
        if (transfertsData.success && transfertsData.transferts) {
            console.log('Processing transfers:', transfertsData.transferts.length);
            
            transfertsData.transferts.forEach(transfert => {
                // =============== FINAL DEBUG LOG ===============
                console.log('Inspecting transfert object:', JSON.stringify(transfert));
                // ===============================================

                const pdv = transfert.pointVente;
                const category = mapToCanonicalCategory(transfert.produit);
                
                // Get the total directly from the transfer object
                let montant = 0;
                if (transfert.total !== undefined) {
                    montant = parseFloat(transfert.total) || 0;
                    console.log(`Using total field for ${pdv}: ${montant}`);
                } else if (transfert.montant !== undefined) {
                    montant = parseFloat(transfert.montant) || 0;
                } else if (transfert.quantite !== undefined && transfert.prixUnitaire !== undefined) {
                    const quantite = parseFloat(transfert.quantite) || 0;
                    const prixUnitaire = parseFloat(transfert.prixUnitaire) || 0;
                    montant = quantite * prixUnitaire;
                }
                
                // Skip if we couldn't determine a montant
                if (montant === 0) {
                    console.log('Skipping transfer with zero montant:', transfert);
                    return;
                }
                
                // Log to debug
                console.log(`Processing transfer for ${pdv}/${category}: ${montant} (impact: ${transfert.impact || 'undefined'})`);
                
                // Initialize point de vente if not exists
                if (!reconciliationByPDV[pdv]) {
                    reconciliationByPDV[pdv] = {
                        pointVente: pdv,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0,
                        cashPayments: 0,
                        ecart: 0,
                        ecartPct: 0,
                        ecartCash: 0,
                        ecartCashPct: 0
                    };
                }
                
                // Initialize details if not exists
                if (!detailsByPDV[pdv]) {
                    detailsByPDV[pdv] = {};
                }
                
                // Initialize category if not exists
                if (!detailsByPDV[pdv][category]) {
                    detailsByPDV[pdv][category] = {
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0
                    };
                }
                
                // Add transfer value - uses the impact indicator from the transfer data
                // Impact direction is now managed dynamically based on transfer configuration
                
                reconciliationByPDV[pdv].transferts += montant;
                if(detailsByPDV[pdv] && detailsByPDV[pdv][category]) {
                    detailsByPDV[pdv][category].transferts += montant;
                    
                    // Store transfer quantity for ventesTheoriquesNombre calculation
                    if (!detailsByPDV[pdv][category].transfertsNombre) {
                        detailsByPDV[pdv][category].transfertsNombre = 0;
                    }
                    const quantite = parseFloat(transfert.quantite) || 0;
                    // Apply the same sign logic as montant for transfertsNombre
                    const quantiteAvecSigne = montant >= 0 ? quantite : -quantite;
                    detailsByPDV[pdv][category].transfertsNombre += quantiteAvecSigne;
                }
            });
        }
        
        console.log("After Transferts:", JSON.stringify(detailsByPDV['Sacre Coeur']?.['Boeuf']));
        
        // Processing cash payments data
        if (cashData.success && cashData.data && cashData.data.points) {
            console.log('Processing cash payments:', cashData.data.points.length);
            
            cashData.data.points.forEach(payment => {
                const pdv = payment.point;
                const montant = parseFloat(payment.total) || 0;
                
                // Log to debug
                console.log(`Adding cash payment for ${pdv}: ${montant}`);
                
                // Initialize point de vente if not exists
                if (!reconciliationByPDV[pdv]) {
                    reconciliationByPDV[pdv] = {
                        pointVente: pdv,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        ventesTheoriques: 0,
                        ventesSaisies: 0,
                        cashPayments: 0,
                        ecart: 0,
                        ecartPct: 0,
                        ecartCash: 0,
                        ecartCashPct: 0
                    };
                }
                
                // Add cash payment value
                reconciliationByPDV[pdv].cashPayments += montant;
            });
        }
        
        // Calculate derived values for each point de vente
        Object.values(reconciliationByPDV).forEach(pdvData => {
            // Calculate theoretical sales
            pdvData.ventesTheoriques = pdvData.stockMatin - pdvData.stockSoir + pdvData.transferts;
            
            // Calculate gaps
            pdvData.ecart = pdvData.ventesTheoriques - pdvData.ventesSaisies;
            pdvData.ecartCash = pdvData.cashPayments - pdvData.ventesSaisies;
            
            // Calculate percentages
            if (pdvData.pointVente === 'Abattage') {
                // Pour Abattage : (Ventes Théoriques / Stock Matin) * 100
                const stockMatinAbs = Math.abs(pdvData.stockMatin);
                if (stockMatinAbs > 0) {
                    pdvData.ecartPct = (pdvData.ventesTheoriques / stockMatinAbs * 100).toFixed(2);
                } else {
                    // Cas où le stock matin est nul - pas de calcul possible
                    pdvData.ecartPct = null;
                }
            } else {
                // Pour les autres points de vente : (Écart absolu / Ventes Théoriques absolues) * 100
                const stockVariation = Math.abs(pdvData.ventesTheoriques);
                pdvData.ecartPct = stockVariation > 0 ? (Math.abs(pdvData.ecart) / stockVariation * 100).toFixed(2) : 0;
            }
            
            const cashTotal = Math.abs(pdvData.cashPayments);
            pdvData.ecartCashPct = cashTotal > 0 ? (Math.abs(pdvData.ecartCash) / cashTotal * 100).toFixed(2) : 0;
            
            // Add comment for this point de vente
            pdvData.commentaire = reconciliationComments[pdvData.pointVente] || '';
            
            // Log summary for this PDV
            console.log(`Summary for ${pdvData.pointVente}: Stock Matin=${pdvData.stockMatin}, Stock Soir=${pdvData.stockSoir}, Transferts=${pdvData.transferts}, VentesTheoriques=${pdvData.ventesTheoriques}, VentesSaisies=${pdvData.ventesSaisies}, Cash=${pdvData.cashPayments}, Commentaire=${pdvData.commentaire}`);
        });
        
        // Calculate derived values for detail categories
        Object.entries(detailsByPDV).forEach(([pdv, categories]) => {
            Object.entries(categories).forEach(([category, data]) => {
                // Calculate theoretical sales for each category
                data.ventesTheoriques = data.stockMatin - data.stockSoir + data.transferts;
                
                // Calculate ventesTheoriquesNombre (stock matin nombre + transferts nombre - stock soir nombre)
                const stockMatinNombre = data.stockMatinNombre || 0;
                const stockSoirNombre = data.stockSoirNombre || 0;
                const transfertsNombre = data.transfertsNombre || 0;
                data.ventesTheoriquesNombre = stockMatinNombre + transfertsNombre - stockSoirNombre;
                
                // Calculate missing values for aggregated API
                data.ventesValeur = data.ventesSaisies || 0;  // Actual sales value
                data.ventesTheoriquesValeur = data.ventesTheoriques || 0;  // Theoretical sales value
                data.ecartNombre = data.ventesTheoriquesNombre - (data.ventesNombre || 0);  // Quantity gap
                data.ecartValeur = data.ventesTheoriquesValeur - data.ventesValeur;  // Value gap
                data.stockInitial = data.stockMatin || 0;  // Initial stock (will be used for period aggregation)
                data.stockFinal = data.stockSoir || 0;  // Final stock (will be used for period aggregation)
                
                // Store quantity and price information for tooltips
                data.stockMatinNombre = stockMatinNombre;
                data.stockSoirNombre = stockSoirNombre;
                data.transfertsNombre = transfertsNombre;
                
                // Calculate average prices for tooltips
                if (stockMatinNombre > 0) {
                    data.stockMatinPrixUnitaire = data.stockMatin / stockMatinNombre;
                }
                if (stockSoirNombre > 0) {
                    data.stockSoirPrixUnitaire = data.stockSoir / stockSoirNombre;
                }
                if (transfertsNombre > 0) {
                    data.transfertsPrixUnitaire = data.transferts / transfertsNombre;
                }
                
                // Calculate prixMoyenPondere (weighted average price)
                if (data.ventesNombre > 0) {
                    data.prixMoyenPondere = parseFloat((data.ventesValeur / data.ventesNombre).toFixed(2));
                } else {
                    data.prixMoyenPondere = 0;
                }
                
                // Calculate perration based on point de vente
                if (pdv === 'Chambre froide') {
                    // Special formula for Chambre froide: |transfertsNombre| / |stockMatinNombre - stockSoirNombre| - 1
                    const stockDiff = Math.abs(stockMatinNombre - stockSoirNombre);
                    if (stockDiff > 0) {
                        data.perration = parseFloat((Math.abs(transfertsNombre) / stockDiff - 1).toFixed(4));
                    } else {
                        data.perration = 0;
                    }
                } else {
                    // Standard formula for other points de vente: (ventesNombre / ventesTheoriquesNombre) - 1
                    if (data.ventesTheoriquesNombre > 0) {
                        data.perration = parseFloat((data.ventesNombre / data.ventesTheoriquesNombre - 1).toFixed(4));
                    } else {
                        data.perration = 0;
                    }
                }
                
                // Initialize ventesNombreAjustePack (will be calculated after fetching pack data)
                data.ventesNombreAjustePack = data.ventesNombre;
                data.perrationAjustePack = data.perration;
            });
        });
        
        // Fetch pack sales data for the same date to calculate ventesNombreAjustePack
        let packDataByPointVente = {};
        try {
            const packDate = dbDate.split('/').reverse().join('-'); // Convert DD/MM/YYYY to YYYY-MM-DD
            
            console.log(`Fetching pack data for date: ${packDate}`);
            
            const packResponse = await axiosInstance.get('/api/external/ventes-date/pack/aggregated', {
                params: { 
                    start_date: packDate, 
                    end_date: packDate 
                }
            });
            
            if (packResponse.data && packResponse.data.success && packResponse.data.pointsVente) {
                // Extract composition data per point de vente
                Object.entries(packResponse.data.pointsVente).forEach(([pointVente, pvData]) => {
                    if (pvData.compositionAgregee) {
                        packDataByPointVente[pointVente] = pvData.compositionAgregee;
                    }
                });
                console.log(`Pack data retrieved successfully for ${Object.keys(packDataByPointVente).length} points de vente`);
            }
        } catch (error) {
            console.warn('Failed to fetch pack data:', error.message);
        }
        
        // Calculate ventesNombreAjustePack and perrationAjustePack for each product
        Object.entries(detailsByPDV).forEach(([pointVente, pointData]) => {
            Object.entries(pointData).forEach(([productName, productData]) => {
                // Map reconciliation product names to possible pack composition variants
                const productsToAdjust = ['Boeuf', 'Veau', 'Agneau', 'Poulet', 'Oeuf'];
                if (productsToAdjust.includes(productName) && packDataByPointVente[pointVente]) {
                    // Define possible pack product name variants for each product
                    const packVariants = {
                        'Boeuf': ['Boeuf en détail', 'Boeuf en gros', 'Boeuf'],
                        'Veau': ['Veau en détail', 'Veau en gros', 'Veau'],
                        'Agneau': ['Agneau en détail', 'Agneau en gros', 'Agneau'],
                        'Poulet': ['Poulet en détail', 'Poulet en gros', 'Poulet'],
                        'Oeuf': ['Oeuf']
                    };
                    
                    // Sum quantities from all variants for this product
                    let totalPackQuantity = 0;
                    const foundVariants = [];
                    
                    if (packVariants[productName]) {
                        packVariants[productName].forEach(variant => {
                            if (packDataByPointVente[pointVente][variant]) {
                                const qty = parseFloat(packDataByPointVente[pointVente][variant].quantite) || 0;
                                totalPackQuantity += qty;
                                if (qty > 0) {
                                    foundVariants.push(`${variant}:${qty}`);
                                }
                            }
                        });
                    }
                    
                    productData.ventesNombreAjustePack = parseFloat((productData.ventesNombre + totalPackQuantity).toFixed(2));
                    
                    if (foundVariants.length > 0) {
                        console.log(`Adjusted ${productName} at ${pointVente}: ${productData.ventesNombre} + ${totalPackQuantity} (from ${foundVariants.join(', ')}) = ${productData.ventesNombreAjustePack}`);
                    }
                } else {
                    productData.ventesNombreAjustePack = productData.ventesNombre;
                }
                
                // Calculate perrationAjustePack using ventesNombreAjustePack instead of ventesNombre
                if (pointVente === 'Chambre froide') {
                    // For Chambre froide, perrationAjustePack is same as perration (doesn't use ventesNombre)
                    productData.perrationAjustePack = productData.perration;
                } else {
                    // Standard formula: (ventesNombreAjustePack / ventesTheoriquesNombre) - 1
                    if (productData.ventesTheoriquesNombre > 0) {
                        productData.perrationAjustePack = parseFloat((productData.ventesNombreAjustePack / productData.ventesTheoriquesNombre - 1).toFixed(4));
                    } else {
                        productData.perrationAjustePack = 0;
                    }
                }
            });
        });
        
        // Calculate volumeAbattoirBoeuf and volumeAbattoirVeau for Abattage point de vente
        let volumeAbattoirBoeuf = 0;
        let volumeAbattoirVeau = 0;
        
        // Calculate volumes from positive transfers (impact = +) for Abattage
        // Use the transfertsData that's already loaded in the reconciliation API
        if (detailsByPDV['Abattage']) {
            if (detailsByPDV['Abattage']['Boeuf']) {
                // Filter positive transfers for Abattage/Boeuf
                const positiveTransfers = transfertsData.transferts.filter(t => 
                    t.pointVente === 'Abattage' && 
                    t.produit === 'Boeuf' && 
                    t.impact === 1
                );
                
                if (positiveTransfers.length > 0) {
                    volumeAbattoirBoeuf = positiveTransfers.reduce((sum, transfer) => sum + transfer.quantite, 0);
                }
            }
            if (detailsByPDV['Abattage']['Veau']) {
                // Filter positive transfers for Abattage/Veau
                const positiveTransfersVeau = transfertsData.transferts.filter(t => 
                    t.pointVente === 'Abattage' && 
                    t.produit === 'Veau' && 
                    t.impact === 1
                );
                
                if (positiveTransfersVeau.length > 0) {
                    volumeAbattoirVeau = positiveTransfersVeau.reduce((sum, transfer) => sum + transfer.quantite, 0);
                }
            }
        }
        
        // Format the response
        const formattedResponse = {
            date: date,
            resume: Object.values(reconciliationByPDV),
            details: detailsByPDV,
            volumeAbattoirBoeuf: volumeAbattoirBoeuf,
            volumeAbattoirVeau: volumeAbattoirVeau,
            comments: reconciliationComments
        };
        
        console.log(`Completed reconciliation for ${date} with ${formattedResponse.resume.length} points de vente`);
        console.log('==== END EXTERNAL API - RECONCILIATION ====');
        
        res.json({
            success: true,
            data: formattedResponse
        });
    } catch (error) {
        console.error('Error computing reconciliation (External API):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error computing reconciliation data',
            error: error.message
        });
    }
});

// External API for aggregated reconciliation data over a date range
app.get('/api/external/reconciliation/aggregated', validateApiKey, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Validate input
        if (!startDate || !endDate) {
            return res.status(400).json({ 
                success: false, 
                message: 'Both startDate and endDate parameters are required (format: dd-mm-yyyy or dd/mm/yyyy)' 
            });
        }
        
        console.log('==== EXTERNAL API - AGGREGATED RECONCILIATION ====');
        console.log('Start date:', startDate);
        console.log('End date:', endDate);
        
        // Convert date formats to DD/MM/YYYY
        const convertDate = (date) => {
            if (date.includes('-')) {
                return date.replace(/-/g, '/');
            }
            return date;
        };
        
        const dbStartDate = convertDate(startDate);
        const dbEndDate = convertDate(endDate);
        
        console.log('Database start date format:', dbStartDate);
        console.log('Database end date format:', dbEndDate);
        
        // Generate array of dates between start and end dates
        const generateDateRange = (start, end) => {
            const dates = [];
            const startParts = start.split('/');
            const endParts = end.split('/');
            
            // 🔧 FIX pour éviter les années 1907-1909 - Assurer que l'année est >= 2000
            let startYear = parseInt(startParts[2]);
            let endYear = parseInt(endParts[2]);
            
            // Si l'année est < 100, ajouter 2000 (ex: 25 -> 2025)
            if (startYear < 100) startYear += 2000;
            if (endYear < 100) endYear += 2000;
            
            // Si l'année est < 1900, probablement une erreur de parsing, utiliser année actuelle
            if (startYear < 1900) startYear = new Date().getFullYear();
            if (endYear < 1900) endYear = new Date().getFullYear();
            
            console.log(`🔍 DEBUG: Années corrigées - Start: ${startParts[2]} -> ${startYear}, End: ${endParts[2]} -> ${endYear}`);
            
            const startDateObj = new Date(startYear, parseInt(startParts[1]) - 1, parseInt(startParts[0]));
            const endDateObj = new Date(endYear, parseInt(endParts[1]) - 1, parseInt(endParts[0]));
            
            let currentDate = new Date(startDateObj);
            
            while (currentDate <= endDateObj) {
                const day = String(currentDate.getDate()).padStart(2, '0');
                const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                const year = currentDate.getFullYear();
                dates.push(`${day}/${month}/${year}`);
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            return dates;
        };
        
        const dateRange = generateDateRange(dbStartDate, dbEndDate);
        console.log(`Generated ${dateRange.length} dates for period`);
        
        // Use axios instance for making requests
        const axiosInstance = require('axios').create({
            baseURL: `http://localhost:${PORT}`,
            headers: {
                'X-API-Key': req.headers['x-api-key']
            }
        });
        
        // Function to fetch reconciliation data for a specific date
        const fetchReconciliationForDate = async (date) => {
            try {
                const formattedDate = date.replace(/\//g, '-');
                const response = await axiosInstance.get('/api/external/reconciliation', {
                    params: { date: formattedDate }
                });
                return response.data;
            } catch (error) {
                console.warn(`Failed to fetch reconciliation for date ${date}:`, error.message);
                return null;
            }
        };
        
        // Fetch reconciliation data for all dates in parallel (limited batches to avoid overwhelming)
        const batchSize = 10;
        const allReconciliationData = [];
        
        for (let i = 0; i < dateRange.length; i += batchSize) {
            const batch = dateRange.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(dateRange.length/batchSize)} (${batch.length} dates)`);
            
            const batchPromises = batch.map(date => fetchReconciliationForDate(date));
            const batchResults = await Promise.all(batchPromises);
            
            // Filter out null results and extract successful data
            const validResults = batchResults.filter(result => result && result.success && result.data);
            allReconciliationData.push(...validResults.map(result => result.data));
        }
        
        console.log(`Successfully fetched ${allReconciliationData.length} reconciliation records`);
        
        // Aggregate the data by point de vente and product
        const aggregatedData = {};
        
        // Sort reconciliation data by date to ensure proper first/last day logic
        allReconciliationData.sort((a, b) => {
            const dateA = new Date(a.date.split('/').reverse().join('-'));
            const dateB = new Date(b.date.split('/').reverse().join('-'));
            return dateA - dateB;
        });
        
        allReconciliationData.forEach((dayData, dayIndex) => {
            const isFirstDay = dayIndex === 0;
            const isLastDay = dayIndex === allReconciliationData.length - 1;
            
            if (dayData.details) {
                Object.entries(dayData.details).forEach(([pointVente, pointData]) => {
                    if (!aggregatedData[pointVente]) {
                        aggregatedData[pointVente] = {};
                    }
                    
                    Object.entries(pointData).forEach(([product, productData]) => {
                        if (!aggregatedData[pointVente][product]) {
                            aggregatedData[pointVente][product] = {
                                ventesNombre: 0,
                                ventesTheoriquesNombre: 0,
                                ventesValeur: 0,
                                ventesTheoriquesValeur: 0,
                                ecartNombre: 0,
                                ecartValeur: 0,
                                stockInitial: 0,
                                stockFinal: 0,
                                stockMatinNombre: 0,
                                stockSoirNombre: 0,
                                transfertsNombre: 0,
                                prixMoyenPondere: 0,
                                perration: 0,
                                ventesNombreAjustePack: 0,
                                perrationAjustePack: 0
                            };
                        }
                        
                        // Aggregate numerical values
                        const currentProduct = aggregatedData[pointVente][product];
                        currentProduct.ventesNombre += parseFloat(productData.ventesNombre || 0);
                        currentProduct.ventesTheoriquesNombre += parseFloat(productData.ventesTheoriquesNombre || 0);
                        currentProduct.ventesValeur += parseFloat(productData.ventesValeur || 0);
                        currentProduct.ventesTheoriquesValeur += parseFloat(productData.ventesTheoriquesValeur || 0);
                        currentProduct.ecartNombre += parseFloat(productData.ecartNombre || 0);
                        currentProduct.ecartValeur += parseFloat(productData.ecartValeur || 0);
                        
                        // For stockInitial, use the first day's stock matin
                        if (isFirstDay) {
                            currentProduct.stockInitial = parseFloat(productData.stockInitial || 0);
                        }
                        
                        // For stockFinal, use the last day's stock soir
                        if (isLastDay) {
                            currentProduct.stockFinal = parseFloat(productData.stockFinal || 0);
                        }
                        
                        currentProduct.stockMatinNombre += parseFloat(productData.stockMatinNombre || 0);
                        currentProduct.stockSoirNombre += parseFloat(productData.stockSoirNombre || 0);
                        currentProduct.transfertsNombre += parseFloat(productData.transfertsNombre || 0);
                    });
                });
            }
        });
        
        // Fetch pack sales data for the same period to calculate ventesNombreAjustePack
        let packDataByPointVente = {};
        try {
            const packStartDate = dbStartDate.split('/').reverse().join('-'); // Convert DD/MM/YYYY to YYYY-MM-DD
            const packEndDate = dbEndDate.split('/').reverse().join('-');
            
            console.log(`Fetching pack data for period: ${packStartDate} to ${packEndDate}`);
            
            const packResponse = await axiosInstance.get('/api/external/ventes-date/pack/aggregated', {
                params: { 
                    start_date: packStartDate, 
                    end_date: packEndDate 
                }
            });
            
            if (packResponse.data && packResponse.data.success && packResponse.data.pointsVente) {
                // Extract composition data per point de vente
                Object.entries(packResponse.data.pointsVente).forEach(([pointVente, pvData]) => {
                    if (pvData.compositionAgregee) {
                        packDataByPointVente[pointVente] = pvData.compositionAgregee;
                    }
                });
                console.log(`Pack data retrieved successfully for ${Object.keys(packDataByPointVente).length} points de vente`);
            }
        } catch (error) {
            console.warn('Failed to fetch pack data:', error.message);
        }
        
        // Calculate weighted average prices and perration for each product
        Object.entries(aggregatedData).forEach(([pointVente, pointData]) => {
            Object.entries(pointData).forEach(([productName, productData]) => {
                // Calculate weighted average price
                if (productData.ventesNombre > 0) {
                    productData.prixMoyenPondere = parseFloat((productData.ventesValeur / productData.ventesNombre).toFixed(2));
                } else {
                    productData.prixMoyenPondere = 0;
                }
                
                // Calculate perration based on point de vente
                if (pointVente === 'Chambre froide') {
                    // Special formula for Chambre froide: |transfertsNombre| / |stockMatinNombre - stockSoirNombre| - 1
                    const stockDiff = Math.abs(productData.stockMatinNombre - productData.stockSoirNombre);
                    if (stockDiff > 0) {
                        productData.perration = parseFloat((Math.abs(productData.transfertsNombre) / stockDiff - 1).toFixed(4));
                    } else {
                        productData.perration = 0;
                    }
                } else {
                    // Standard formula for other points de vente: (ventesNombre / ventesTheoriquesNombre) - 1
                    if (productData.ventesTheoriquesNombre > 0) {
                        productData.perration = parseFloat((productData.ventesNombre / productData.ventesTheoriquesNombre - 1).toFixed(4));
                    } else {
                        productData.perration = 0;
                    }
                }
                
                // Calculate ventesNombreAjustePack for applicable products using point de vente specific pack data
                // Map reconciliation product names to possible pack composition variants
                const productsToAdjust = ['Boeuf', 'Veau', 'Agneau', 'Poulet', 'Oeuf'];
                if (productsToAdjust.includes(productName) && packDataByPointVente[pointVente]) {
                    // Define possible pack product name variants for each product
                    const packVariants = {
                        'Boeuf': ['Boeuf en détail', 'Boeuf en gros', 'Boeuf'],
                        'Veau': ['Veau en détail', 'Veau en gros', 'Veau'],
                        'Agneau': ['Agneau en détail', 'Agneau en gros', 'Agneau'],
                        'Poulet': ['Poulet en détail', 'Poulet en gros', 'Poulet'],
                        'Oeuf': ['Oeuf']
                    };
                    
                    // Sum quantities from all variants for this product
                    let totalPackQuantity = 0;
                    const foundVariants = [];
                    
                    if (packVariants[productName]) {
                        packVariants[productName].forEach(variant => {
                            if (packDataByPointVente[pointVente][variant]) {
                                const qty = parseFloat(packDataByPointVente[pointVente][variant].quantite) || 0;
                                totalPackQuantity += qty;
                                if (qty > 0) {
                                    foundVariants.push(`${variant}:${qty}`);
                                }
                            }
                        });
                    }
                    
                    productData.ventesNombreAjustePack = parseFloat((productData.ventesNombre + totalPackQuantity).toFixed(2));
                    
                    if (foundVariants.length > 0) {
                        console.log(`Adjusted ${productName} at ${pointVente}: ${productData.ventesNombre} + ${totalPackQuantity} (from ${foundVariants.join(', ')}) = ${productData.ventesNombreAjustePack}`);
                    }
                } else {
                    productData.ventesNombreAjustePack = productData.ventesNombre;
                }
                
                // Calculate perrationAjustePack using ventesNombreAjustePack instead of ventesNombre
                if (pointVente === 'Chambre froide') {
                    // For Chambre froide, perrationAjustePack is same as perration (doesn't use ventesNombre)
                    productData.perrationAjustePack = productData.perration;
                } else {
                    // Standard formula: (ventesNombreAjustePack / ventesTheoriquesNombre) - 1
                    if (productData.ventesTheoriquesNombre > 0) {
                        productData.perrationAjustePack = parseFloat((productData.ventesNombreAjustePack / productData.ventesTheoriquesNombre - 1).toFixed(4));
                    } else {
                        productData.perrationAjustePack = 0;
                    }
                }
            });
        });
        
        // Generate resume section (summary by point de vente)
        const resumeData = [];
        Object.entries(aggregatedData).forEach(([pointVente, pointData]) => {
            let totalVentesValeur = 0;
            let totalVentesTheoriquesValeur = 0;
            let totalEcartValeur = 0;
            
            Object.values(pointData).forEach(productData => {
                totalVentesValeur += productData.ventesValeur;
                totalVentesTheoriquesValeur += productData.ventesTheoriquesValeur;
                totalEcartValeur += productData.ecartValeur;
            });
            
            resumeData.push({
                pointVente,
                totalVentesValeur: totalVentesValeur.toFixed(2),
                totalVentesTheoriquesValeur: totalVentesTheoriquesValeur.toFixed(2),
                totalEcartValeur: totalEcartValeur.toFixed(2),
                pourcentageEcart: totalVentesTheoriquesValeur > 0 ? 
                    ((totalEcartValeur / totalVentesTheoriquesValeur) * 100).toFixed(2) : '0.00'
            });
        });
        
        const response = {
            success: true,
            data: {
                period: {
                    startDate: dbStartDate,
                    endDate: dbEndDate,
                    totalDays: dateRange.length
                },
                details: aggregatedData,
                resume: resumeData,
                metadata: {
                    recordsProcessed: allReconciliationData.length,
                    pointsDeVente: Object.keys(aggregatedData).length
                }
            }
        };
        
        console.log(`Completed aggregated reconciliation for period ${dbStartDate} to ${dbEndDate}`);
        console.log(`Processed ${allReconciliationData.length} records across ${Object.keys(aggregatedData).length} points de vente`);
        console.log('==== END EXTERNAL API - AGGREGATED RECONCILIATION ====');
        
        res.json(response);
        
    } catch (error) {
        console.error('Error computing aggregated reconciliation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error computing aggregated reconciliation data',
            error: error.message
        });
    }
});

// External API for Performance Achat (Buyer estimation performance tracking)
app.get('/api/external/performance-achat', validateApiKey, async (req, res) => {
    try {
        const { startDate, endDate, bete } = req.query;
        
        // Default dates: first day of current month to today
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        
        const defaultStartDate = `${year}-${month}-01`; // First day of current month
        const defaultEndDate = `${year}-${month}-${day}`; // Today
        
        const dateDebut = startDate || defaultStartDate;
        const dateFin = endDate || defaultEndDate;
        
        console.log('==== EXTERNAL API - PERFORMANCE ACHAT ====');
        console.log('Period:', dateDebut, 'to', dateFin);
        console.log('Bete filter:', bete || 'all');
        
        // Build where clause
        const whereClause = {
            date: {
                [Op.gte]: dateDebut,
                [Op.lte]: dateFin
            },
            poids_estime: { [Op.ne]: null },
            poids_reel: { [Op.ne]: null, [Op.ne]: 0 } // Exclude zero weights
        };
        
        // Filter by bete if provided
        if (bete && ['boeuf', 'veau'].includes(bete.toLowerCase())) {
            whereClause.bete = bete.toLowerCase();
        }
        
        // Fetch all performances
        const performances = await PerformanceAchat.findAll({
            where: whereClause,
            order: [['date', 'DESC'], ['created_at', 'DESC']]
        });
        
        console.log('Total performances found:', performances.length);
        
        // Load acheteurs
        const acheteursData = await fsPromises.readFile(path.join(__dirname, 'acheteur.json'), 'utf-8');
        const acheteurs = JSON.parse(acheteursData);
        
        // ====================
        // 1. RESUME - Agrégat par type de bétail
        // ====================
        const resume = {
            boeuf: {
                total_poids_estime: 0,
                total_poids_reel: 0,
                sous_estimation: {
                    count: 0,
                    total_ecart: 0,
                    moyenne_erreur: 0,
                    moyenne_precision: 0
                },
                surestimation: {
                    count: 0,
                    total_ecart: 0,
                    moyenne_erreur: 0,
                    moyenne_precision: 0
                }
            },
            veau: {
                total_poids_estime: 0,
                total_poids_reel: 0,
                sous_estimation: {
                    count: 0,
                    total_ecart: 0,
                    moyenne_erreur: 0,
                    moyenne_precision: 0
                },
                surestimation: {
                    count: 0,
                    total_ecart: 0,
                    moyenne_erreur: 0,
                    moyenne_precision: 0
                }
            }
        };
        
        // Temporary arrays for calculations
        const tempStats = {
            boeuf: { sous_erreurs: [], sous_precisions: [], sur_erreurs: [], sur_precisions: [] },
            veau: { sous_erreurs: [], sous_precisions: [], sur_erreurs: [], sur_precisions: [] }
        };
        
        // ====================
        // CALCULATE COHERENCE BY DATE (GLOBAL CHECK)
        // ====================
        const coherenceByDate = new Map();
        
        // Group performances by date+bete to calculate total poids_reel
        const dateGroups = {};
        performances.forEach(perf => {
            const perfData = perf.toJSON();
            const key = `${perfData.date}_${perfData.bete}`;
            if (!dateGroups[key]) {
                dateGroups[key] = {
                    date: perfData.date,
                    bete: perfData.bete,
                    totalPoidsReel: 0
                };
            }
            if (perfData.poids_reel) {
                dateGroups[key].totalPoidsReel += perfData.poids_reel;
            }
        });
        
        // Calculate coherence for each date+bete group
        for (const [key, group] of Object.entries(dateGroups)) {
            const sommeAchats = await AchatBoeuf.sum('nbr_kg', {
                where: {
                    date: group.date,
                    bete: group.bete
                }
            });
            
            const sommeAchatsKg = sommeAchats || 0;
            const difference = Math.abs(group.totalPoidsReel - sommeAchatsKg);
            const isCoherent = difference <= 0.5;
            
            coherenceByDate.set(key, {
                coherence: isCoherent ? 'COHÉRENT' : 'INCOHÉRENT',
                somme_achats: sommeAchatsKg,
                somme_poids_reel: group.totalPoidsReel,
                coherence_diff: difference.toFixed(2)
            });
        }
        
        // ====================
        // 3. PERFORMANCES - Enriched list
        // ====================
        const performancesList = [];
        
        for (const perf of performances) {
            const perfData = perf.toJSON();
            
            // Find acheteur info
            const acheteur = acheteurs.find(a => a.id === perfData.id_acheteur);
            perfData.acheteur_nom = acheteur ? `${acheteur.prenom} ${acheteur.nom}` : 'Inconnu';
            
            // Calculate prix/kg sans abats (based on estimation)
            if (perfData.prix && perfData.poids_estime && perfData.poids_estime !== 0) {
                perfData.prix_achat_kg_sans_abats_estime = parseFloat((perfData.prix / perfData.poids_estime).toFixed(2));
                
                // Determine statut_achat based on prix/kg and animal type
                const prixKg = perfData.prix_achat_kg_sans_abats_estime;
                const bete = perfData.bete.toLowerCase();
                
                if (bete === 'boeuf') {
                    if (prixKg <= 3200) {
                        perfData.statut_achat = 'Bon';
                    } else if (prixKg <= 3350) {
                        perfData.statut_achat = 'Acceptable';
                    } else {
                        perfData.statut_achat = 'Mauvais';
                    }
                } else if (bete === 'veau') {
                    if (prixKg <= 3400) {
                        perfData.statut_achat = 'Bon';
                    } else if (prixKg <= 3550) {
                        perfData.statut_achat = 'Acceptable';
                    } else {
                        perfData.statut_achat = 'Mauvais';
                    }
                }
            }
            
            // Calculate metrics
            if (perfData.poids_estime && perfData.poids_reel && perfData.poids_reel !== 0) {
                perfData.ecart = perfData.poids_estime - perfData.poids_reel;
                const erreurRaw = ((perfData.poids_estime - perfData.poids_reel) / perfData.poids_reel) * 100;
                const precisionRaw = 100 - Math.abs(erreurRaw);
                
                // Format with 2 decimals
                perfData.erreur = parseFloat(erreurRaw.toFixed(2));
                perfData.precision = parseFloat(precisionRaw.toFixed(2));
                perfData.type_estimation = perfData.erreur > 0 ? 'Surestimation' : (perfData.erreur < 0 ? 'Sous-estimation' : 'Parfait');
                
                // Apply coherence from global calculation by date
                const key = `${perfData.date}_${perfData.bete}`;
                const coherenceData = coherenceByDate.get(key);
                
                if (coherenceData) {
                    perfData.coherence = coherenceData.coherence;
                    perfData.coherence_diff = coherenceData.coherence_diff;
                    perfData.somme_achats = coherenceData.somme_achats;
                } else {
                    perfData.coherence = null;
                    perfData.coherence_diff = '0.00';
                    perfData.somme_achats = 0;
                }
                
                // Aggregate for resume
                const beteType = perfData.bete.toLowerCase();
                if (resume[beteType]) {
                    resume[beteType].total_poids_estime += perfData.poids_estime;
                    resume[beteType].total_poids_reel += perfData.poids_reel;
                    
                    if (perfData.erreur < 0) {
                        // Sous-estimation
                        resume[beteType].sous_estimation.count++;
                        resume[beteType].sous_estimation.total_ecart += perfData.ecart;
                        tempStats[beteType].sous_erreurs.push(perfData.erreur);
                        tempStats[beteType].sous_precisions.push(perfData.precision);
                    } else if (perfData.erreur > 0) {
                        // Surestimation
                        resume[beteType].surestimation.count++;
                        resume[beteType].surestimation.total_ecart += perfData.ecart;
                        tempStats[beteType].sur_erreurs.push(perfData.erreur);
                        tempStats[beteType].sur_precisions.push(perfData.precision);
                    }
                }
            }
            
            performancesList.push(perfData);
        }
        
        // Calculate averages for resume
        for (const beteType of ['boeuf', 'veau']) {
            const stats = tempStats[beteType];
            
            if (stats.sous_erreurs.length > 0) {
                resume[beteType].sous_estimation.moyenne_erreur = 
                    stats.sous_erreurs.reduce((a, b) => a + b, 0) / stats.sous_erreurs.length;
                resume[beteType].sous_estimation.moyenne_precision = 
                    stats.sous_precisions.reduce((a, b) => a + b, 0) / stats.sous_precisions.length;
            }
            
            if (stats.sur_erreurs.length > 0) {
                resume[beteType].surestimation.moyenne_erreur = 
                    stats.sur_erreurs.reduce((a, b) => a + b, 0) / stats.sur_erreurs.length;
                resume[beteType].surestimation.moyenne_precision = 
                    stats.sur_precisions.reduce((a, b) => a + b, 0) / stats.sur_precisions.length;
            }
        }
        
        // ====================
        // 2. LATEST ESTIMATION - All entries from the most recent date (by animal type)
        // ====================
        const latestEstimation = [];
        
        for (const beteType of ['boeuf', 'veau']) {
            // First, find the most recent date for this animal type
            const mostRecent = await PerformanceAchat.findOne({
                where: {
                    bete: beteType,
                    date: { [Op.lte]: dateFin },
                    poids_estime: { [Op.ne]: null },
                    poids_reel: { [Op.ne]: null, [Op.ne]: 0 } // Exclude zero weights
                },
                order: [['date', 'DESC'], ['created_at', 'DESC']],
                attributes: ['date']
            });
            
            if (mostRecent) {
                // Then, get ALL estimations from that date
                const latestDate = mostRecent.date;
                const allFromLatestDate = await PerformanceAchat.findAll({
                    where: {
                        bete: beteType,
                        date: latestDate,
                        poids_estime: { [Op.ne]: null },
                        poids_reel: { [Op.ne]: null, [Op.ne]: 0 }
                    },
                    order: [['created_at', 'DESC']]
                });
                
                for (const latest of allFromLatestDate) {
                    const latestData = latest.toJSON();
                    const acheteur = acheteurs.find(a => a.id === latestData.id_acheteur);
                    
                latestData.acheteur_nom = acheteur ? `${acheteur.prenom} ${acheteur.nom}` : 'Inconnu';
                
                // Calculate prix/kg sans abats (based on estimation)
                if (latestData.prix && latestData.poids_estime && latestData.poids_estime !== 0) {
                    latestData.prix_achat_kg_sans_abats_estime = parseFloat((latestData.prix / latestData.poids_estime).toFixed(2));
                    
                    // Determine statut_achat
                    const prixKg = latestData.prix_achat_kg_sans_abats_estime;
                    const bete = latestData.bete.toLowerCase();
                    
                    if (bete === 'boeuf') {
                        if (prixKg <= 3200) {
                            latestData.statut_achat = 'Bon';
                        } else if (prixKg <= 3350) {
                            latestData.statut_achat = 'Acceptable';
                        } else {
                            latestData.statut_achat = 'Mauvais';
                        }
                    } else if (bete === 'veau') {
                        if (prixKg <= 3400) {
                            latestData.statut_achat = 'Bon';
                        } else if (prixKg <= 3550) {
                            latestData.statut_achat = 'Acceptable';
                        } else {
                            latestData.statut_achat = 'Mauvais';
                        }
                    }
                }
                
                latestData.ecart = latestData.poids_estime - latestData.poids_reel;
                
                const erreurRaw = ((latestData.poids_estime - latestData.poids_reel) / latestData.poids_reel) * 100;
                const precisionRaw = 100 - Math.abs(erreurRaw);
                
                // Format with 2 decimals
                latestData.erreur = parseFloat(erreurRaw.toFixed(2));
                latestData.precision = parseFloat(precisionRaw.toFixed(2));
                latestData.type_estimation = latestData.erreur > 0 ? 'Surestimation' : (latestData.erreur < 0 ? 'Sous-estimation' : 'Parfait');
                    
                    // Check coherence
                    const sommeAchats = await AchatBoeuf.sum('nbr_kg', {
                        where: {
                            date: latestData.date,
                            bete: latestData.bete
                        }
                    });
                    
                    const diff = Math.abs((sommeAchats || 0) - latestData.poids_reel);
                    latestData.coherence = diff <= 0.5 ? 'COHÉRENT' : 'INCOHÉRENT';
                    latestData.coherence_diff = diff.toFixed(2);
                    latestData.somme_achats = sommeAchats || 0;
                    
                    // Add to array
                    latestEstimation.push(latestData);
                }
            }
        }
        
        // ====================
        // 4. RANKINGS - Buyer performance ranking
        // ====================
        const statsMap = {};
        
        for (const perf of performances) {
            if (perf.poids_reel === 0) continue;
            
            const erreur = ((perf.poids_estime - perf.poids_reel) / perf.poids_reel) * 100;
            const precision = 100 - Math.abs(erreur);
            const scorePenalite = erreur > 0 
                ? Math.abs(erreur) * 2 
                : Math.abs(erreur);
            const scoreSur20 = Math.max(0, Math.min(20, 20 - scorePenalite));
            
            if (!statsMap[perf.id_acheteur]) {
                const acheteur = acheteurs.find(a => a.id === perf.id_acheteur);
                statsMap[perf.id_acheteur] = {
                    id_acheteur: perf.id_acheteur,
                    nom: acheteur ? `${acheteur.prenom} ${acheteur.nom}` : 'Inconnu',
                    total_estimations: 0,
                    total_surestimations: 0,
                    total_sous_estimations: 0,
                    total_parfait: 0,
                    score_moyen: 0,
                    precision_moyenne: 0,
                    scores: [],
                    precisions: []
                };
            }
            
            statsMap[perf.id_acheteur].total_estimations++;
            statsMap[perf.id_acheteur].scores.push(scoreSur20);
            statsMap[perf.id_acheteur].precisions.push(precision);
            
            if (erreur > 0) {
                statsMap[perf.id_acheteur].total_surestimations++;
            } else if (erreur < 0) {
                statsMap[perf.id_acheteur].total_sous_estimations++;
            } else {
                statsMap[perf.id_acheteur].total_parfait++;
            }
        }
        
        const rankings = Object.values(statsMap).map(stat => {
            const scoreMoyen = stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length;
            const precisionMoyenne = stat.precisions.reduce((a, b) => a + b, 0) / stat.precisions.length;
            
            // Format with 2 decimals
            stat.score_moyen = parseFloat(scoreMoyen.toFixed(2));
            stat.precision_moyenne = parseFloat(precisionMoyenne.toFixed(2));
            
            delete stat.scores;
            delete stat.precisions;
            return stat;
        });
        
        rankings.sort((a, b) => b.score_moyen - a.score_moyen);
        
        console.log('Resume computed:', {
            boeuf_total: resume.boeuf.total_poids_reel,
            veau_total: resume.veau.total_poids_reel,
            total_rankings: rankings.length
        });
        
        // ====================
        // 5. ACTUALITE - Résumé de la veille bétail (généré par LLM)
        // ====================
        let actualite = null;
        
        try {
            // Auto-fetch veille data if needed
            const now = Date.now();
            const needsRefresh = !veilleCache.data || !veilleCache.timestamp || 
                                (now - veilleCache.timestamp >= veilleCache.cacheDuration);
            
            if (needsRefresh && process.env.OPENAI_API_KEY) {
                console.log('Auto-fetching veille data for external API...');
                
                // Import required modules
                const OpenAI = require('openai');
                const Parser = require('rss-parser');
                const parser = new Parser();
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                // Collect news
                const searchQueries = [
                    'Mali bétail',
                    'Mali boeuf élevage',
                    'Mauritanie bétail',
                    'Mauritanie boeuf élevage',
                    'Mali Mauritanie export bétail Sénégal'
                ];
                
                const newsArticles = [];
                for (const query of searchQueries) {
                    try {
                        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=SN&ceid=SN:fr`;
                        const feed = await parser.parseURL(url);
                        const recentArticles = feed.items.slice(0, 5).map(item => ({
                            title: item.title,
                            pubDate: item.pubDate,
                            source: item.source?.title || 'Source inconnue',
                            contentSnippet: item.contentSnippet || item.content || ''
                        }));
                        newsArticles.push(...recentArticles);
                    } catch (error) {
                        console.error(`Error fetching RSS for "${query}":`, error.message);
                    }
                }
                
                if (newsArticles.length > 0) {
                    // Analyze with OpenAI
                    const articlesText = newsArticles.map((article, index) => 
                        `${index + 1}. [${article.pubDate}] ${article.title}\n   Source: ${article.source}\n   ${article.contentSnippet}\n`
                    ).join('\n');
                    
                    const completion = await openai.chat.completions.create({
                        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: `Tu es un expert en analyse de marché du bétail en Afrique de l'Ouest. 
                                Tu dois analyser les actualités du Mali et de la Mauritanie pour identifier les facteurs pouvant affecter l'approvisionnement en bovins au Sénégal.
                                
                                Réponds UNIQUEMENT en JSON avec cette structure exacte :
                                {
                                  "alertes": [
                                    {"niveau": "critique|warning|info", "titre": "...", "description": "...", "impact": "..."}
                                  ],
                                  "tendances": [
                                    {"type": "prix|climat|reglementation|autre", "description": "...", "impact_previsionnel": "..."}
                                  ],
                                  "contexte": "Résumé général de la situation en 2-3 phrases",
                                  "recommandations": ["...", "..."]
                                }`
                            },
                            {
                                role: 'user',
                                content: `Analyse ces actualités récentes sur le bétail au Mali et en Mauritanie :\n\n${articlesText}\n\nRetourne uniquement le JSON structuré.`
                            }
                        ],
                        temperature: 0.3,
                        max_tokens: 1500
                    });
                    
                    // Parse response
                    let analysisData;
                    try {
                        const responseContent = completion.choices[0].message.content.trim();
                        const jsonMatch = responseContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                                         responseContent.match(/```\s*([\s\S]*?)\s*```/);
                        const jsonStr = jsonMatch ? jsonMatch[1] : responseContent;
                        analysisData = JSON.parse(jsonStr);
                    } catch (parseError) {
                        analysisData = {
                            alertes: [],
                            tendances: [],
                            contexte: 'Erreur lors de l\'analyse des données.',
                            recommandations: []
                        };
                    }
                    
                    // Update cache
                    veilleCache = {
                        data: {
                            ...analysisData,
                            articles_count: newsArticles.length,
                            timestamp: new Date().toISOString()
                        },
                        timestamp: now
                    };
                    
                    console.log(`Veille auto-fetched: ${newsArticles.length} articles analyzed`);
                }
            }
            
            // Generate 2-sentence summary from veille data
            if (veilleCache.data && veilleCache.data.contexte && process.env.OPENAI_API_KEY) {
                try {
                    const OpenAI = require('openai');
                    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                    
                    const summaryPrompt = `Résume en MAXIMUM 2 phrases courtes cette situation du marché du bétail Mali/Mauritanie pour le Sénégal:

Contexte: ${veilleCache.data.contexte}

Alertes: ${veilleCache.data.alertes?.map(a => a.titre).join(', ') || 'Aucune'}

Réponds UNIQUEMENT avec 2 phrases maximum, concises et informatives.`;
                    
                    const summaryCompletion = await openai.chat.completions.create({
                        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: 'Tu es un assistant qui résume les actualités du bétail de manière très concise.'
                            },
                            {
                                role: 'user',
                                content: summaryPrompt
                            }
                        ],
                        temperature: 0.3,
                        max_tokens: 150
                    });
                    
                    actualite = {
                        resume: summaryCompletion.choices[0].message.content.trim(),
                        timestamp: veilleCache.data.timestamp,
                        source: 'Veille automatique Mali/Mauritanie'
                    };
                } catch (llmError) {
                    console.error('Error generating actualite summary:', llmError.message);
                    // Fallback to contexte if LLM fails
                    actualite = {
                        resume: veilleCache.data.contexte,
                        timestamp: veilleCache.data.timestamp,
                        source: 'Veille automatique Mali/Mauritanie'
                    };
                }
            }
        } catch (actualiteError) {
            console.error('Error fetching actualite:', actualiteError.message);
            // Continue without actualite if there's an error
        }
        
        // ====================
        // RESPONSE
        // ====================
        res.json({
            success: true,
            periode: {
                startDate: dateDebut,
                endDate: dateFin,
                bete: bete || 'all'
            },
            resume,
            latestEstimation,
            performances: performancesList,
            rankings,
            actualite,
            metadata: {
                total_performances: performancesList.length,
                total_acheteurs: rankings.length,
                generated_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error in external performance-achat API:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// External API for estimation analysis
// External API endpoint for estimations (no session auth required)
app.get('/api/external/estimations', validateApiKey, async (req, res) => {
    try {
        const { date } = req.query;
        
        let estimations;
        if (date) {
            // Normalize date format to YYYY-MM-DD for database queries (database stores dates in YYYY-MM-DD ISO format)
            const normalizedDate = standardiserDateFormat(date);
            
            estimations = await Estimation.findAll({
                where: {
                    date: normalizedDate
                }
            });
        } else {
            estimations = await Estimation.findAll();
        }
        
        // Trier les estimations par timestamp de création décroissant (derniers ajouts en premier)
        estimations.sort((a, b) => {
            // Tri principal par timestamp de création (plus récent en premier)
            const timestampA = new Date(a.createdAt).getTime();
            const timestampB = new Date(b.createdAt).getTime();
            
            if (timestampB !== timestampA) {
                return timestampB - timestampA; // Tri par timestamp décroissant
            }
            
            // Tri secondaire par date si même timestamp (peu probable mais sûr)
            const convertDate = (dateStr) => {
                if (!dateStr) return '';
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                    if (parts[0].length === 4) {
                        // Already YYYY-MM-DD format
                        return dateStr;
                    } else {
                        // DD-MM-YYYY format, convert to YYYY-MM-DD
                        return `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                }
                return dateStr;
            };
            
            const dateA = convertDate(a.date);
            const dateB = convertDate(b.date);
            
            return dateB.localeCompare(dateA); // Tri décroissant
        });
        
        res.json({
            success: true,
            estimations: estimations
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des estimations:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des estimations'
        });
    }
});

// External API endpoint for recalculating estimations (no session auth required)
app.post('/api/external/estimations/:id/recalculate', validateApiKey, async (req, res) => {
    try {
        const id = req.params.id;
        
        // Récupérer l'estimation
        const estimation = await Estimation.findByPk(id);
        if (!estimation) {
            return res.status(404).json({
                success: false,
                message: 'Estimation non trouvée'
            });
        }
        
        // Récupérer les ventes théoriques depuis l'API externe, sinon 0
        const ventesTheoFromAPI = await fetchVentesTheoriquesFromAPI(estimation);
        const ventesTheo = ventesTheoFromAPI !== null ? ventesTheoFromAPI : 0;
        
        console.log(`Recalcul des ventes théoriques pour ${estimation.pointVente}/${estimation.categorie || estimation.produit}: ${ventesTheo} kg ${ventesTheoFromAPI === null ? '(API indisponible, valeur par défaut)' : '(récupéré de l\'API)'}`);
        
        // Recalculer la différence avec la nouvelle formule (sans pré-commande)
        const nouvelleDifference = ventesTheo - (estimation.previsionVentes || 0);
        
        await estimation.update({
            difference: nouvelleDifference,
            ventesTheoriques: ventesTheo
        });
        
        res.json({
            success: true,
            message: 'Ventes théoriques recalculées avec succès',
            ventesTheo: ventesTheo,
            ventesTheoriques: ventesTheo, // Alias for compatibility
            difference: nouvelleDifference
        });
    } catch (error) {
        console.error('Erreur lors du recalcul des ventes théoriques:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du recalcul des ventes théoriques'
        });
    }
});

app.get('/api/external/estimation', validateApiKey, async (req, res) => {
    try {
        const { date } = req.query;
        
        // Validate input
        if (!date) {
            return res.status(400).json({ 
                success: false, 
                message: 'Date parameter is required (format: dd-mm-yyyy or yyyy-mm-dd)' 
            });
        }
        
        console.log('==== EXTERNAL API - ESTIMATION ====');
        console.log('Computing estimation analysis for date:', date);
        
        // Normalize date format to YYYY-MM-DD for database queries (database stores dates in YYYY-MM-DD ISO format)
        const normalizedDate = standardiserDateFormat(date);
        
        console.log('Normalized date:', normalizedDate);
        
        // Use axios to make HTTP requests to our own external API endpoints
        const axiosInstance = require('axios').create({
            baseURL: `http://localhost:${PORT}`,
            headers: {
                'X-API-Key': req.headers['x-api-key']
            }
        });
        
        // Function to safely make HTTP requests to our own API endpoints
        const fetchData = async (endpoint, params = {}) => {
            try {
                console.log(`Fetching data from ${endpoint} with params:`, params);
                const response = await axiosInstance.get(endpoint, { params });
                return response.data;
            } catch (error) {
                console.error(`Error fetching ${endpoint}:`, error.message);
                throw new Error(`Failed to fetch data from ${endpoint}: ${error.message}`);
            }
        };
        
        // Function to make POST requests
        const postData = async (endpoint, data = {}) => {
            try {
                console.log(`Posting data to ${endpoint}`);
                const response = await axiosInstance.post(endpoint, data);
                return response.data;
            } catch (error) {
                console.error(`Error posting to ${endpoint}:`, error.message);
                throw new Error(`Failed to post data to ${endpoint}: ${error.message}`);
            }
        };
        
        // Fetch estimations directly from database
        const estimations = await Estimation.findAll({
            where: {
                date: normalizedDate
            }
        });
        
        console.log(`Found ${estimations.length} estimations for date ${normalizedDate}`);
        
        // Debug: Let's also check what dates exist in the database
        const allEstimations = await Estimation.findAll({
            attributes: ['date'],
            group: ['date'],
            order: [['date', 'DESC']]
        });
        console.log('Available dates in database:', allEstimations.map(e => e.date));
        
        // Debug: Let's see what's in the estimation records
        if (estimations.length > 0) {
            console.log('Sample estimation record:', JSON.stringify(estimations[0], null, 2));
            console.log('Estimation fields available:', Object.keys(estimations[0].dataValues || estimations[0]));
        }
        
        // Continue processing even if no estimations found - we still want theoretical sales data
        
        // If no estimations found, we still want to get theoretical sales data from reconciliation
        if (estimations.length === 0) {
            console.log('No estimations found, getting theoretical sales data from reconciliation API');
            
            try {
                const reconciliationData = await fetchData('/api/external/reconciliation', { date: normalizedDate });
                console.log('Reconciliation data for theoretical sales:', reconciliationData);
                
                if (reconciliationData.success && reconciliationData.data) {
                    // Create result structure with theoretical sales data
                    for (const [pointVente, data] of Object.entries(reconciliationData.data)) {
                        if (!result[date][pointVente]) {
                            result[date][pointVente] = {};
                        }
                        
                        // Get theoretical sales for this point de vente
                        const ventesTheoriques = data.ventesTheoriques || 0;
                        
                        // Create entries for each category that has theoretical sales
                        // For now, we'll create a general entry, but you might want to break this down by category
                        if (ventesTheoriques > 0) {
                            result[date][pointVente]['General'] = {
                                estimation: 0,
                                precommande: 0,
                                ventes_theoriques: ventesTheoriques,
                                difference: ventesTheoriques,
                                difference_pct: 0,
                                status: "OK",
                                commentaire: "-"
                            };
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching reconciliation data for theoretical sales:', error.message);
            }
        }
        
        // Fetch precommandes directly from database
        const { Precommande } = require('./db/models');
        const precommandes = await Precommande.findAll();
        
        // Filter precommandes for the specific date
        const precommandesForDate = precommandes.filter(p => {
            const precommandeDate = p['Date Réception'] || p.dateReception;
            if (!precommandeDate) return false;
            
            // Handle different date formats
            let precommandeNormalizedDate;
            if (precommandeDate.includes('-')) {
                const parts = precommandeDate.split('-');
                if (parts[0].length === 4) {
                    precommandeNormalizedDate = precommandeDate;
                } else {
                    precommandeNormalizedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
            } else {
                return false;
            }
            
            return precommandeNormalizedDate === normalizedDate;
        });
        
        console.log(`Found ${precommandesForDate.length} precommandes for date ${normalizedDate}`);
        
        // Structure to hold the results
        const result = {
            [date]: {}
        };
        
        // Process each estimation
        for (const estimation of estimations) {
            const pointVente = estimation.pointVente || estimation.point_vente;
            const categorie = estimation.categorie;
            
            if (!pointVente || !categorie) continue;
            
            // Initialize point de vente if not exists
            if (!result[date][pointVente]) {
                result[date][pointVente] = {};
            }
            
            // Initialize category if not exists
            if (!result[date][pointVente][categorie]) {
                result[date][pointVente][categorie] = {
                    estimation: 0,
                    precommande: 0,
                    ventes_theoriques: 0,
                    difference: 0,
                    difference_pct: 0,
                    status: "OK",
                    commentaire: "-"
                };
            }
            
            // Set estimation value
            result[date][pointVente][categorie].estimation = parseFloat(estimation.previsionVentes) || 0;
            
            // Calculate precommande value for this point de vente and category
            const precommandeForCategory = precommandesForDate
                .filter(p => p['Point de Vente'] === pointVente && p['Catégorie'] === categorie)
                .reduce((sum, p) => sum + (parseFloat(p.Montant) || 0), 0);
            
            result[date][pointVente][categorie].precommande = precommandeForCategory;
            
            // Call external recalculate endpoint to get theoretical sales
            try {
                const recalculateResponse = await postData(`/api/external/estimations/${estimation.id}/recalculate`);
                if (recalculateResponse.success && recalculateResponse.ventesTheoriques) {
                    result[date][pointVente][categorie].ventes_theoriques = parseFloat(recalculateResponse.ventesTheoriques) || 0;
                } else {
                    result[date][pointVente][categorie].ventes_theoriques = 0;
                }
            } catch (error) {
                console.error(`Error recalculating estimation ${estimation.id}:`, error.message);
                result[date][pointVente][categorie].ventes_theoriques = 0;
            }
            
            // Calculate differences
            const estimationValue = result[date][pointVente][categorie].estimation;
            const ventesTheoriques = result[date][pointVente][categorie].ventes_theoriques;
            
            result[date][pointVente][categorie].difference = ventesTheoriques - estimationValue;
            
            if (estimationValue > 0) {
                result[date][pointVente][categorie].difference_pct = ((ventesTheoriques - estimationValue) / estimationValue) * 100;
            } else {
                result[date][pointVente][categorie].difference_pct = 0;
            }
            
            // Determine status based on difference percentage
            const diffPct = Math.abs(result[date][pointVente][categorie].difference_pct);
            if (diffPct > 10) { // More than 10% difference
                result[date][pointVente][categorie].status = "NOK";
                result[date][pointVente][categorie].commentaire = `Écart de ${diffPct.toFixed(1)}%`;
            } else {
                result[date][pointVente][categorie].status = "OK";
                result[date][pointVente][categorie].commentaire = "-";
            }
        }
        
        console.log('Estimation analysis completed successfully');
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('Error computing estimation analysis (External API):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error computing estimation analysis data',
            error: error.message
        });
    }
});

// External API version for gestionStock
app.get('/api/external/gestionStock', validateApiKey, async (req, res) => {
    try {
        const { date, startDate, endDate, produit } = req.query;
        
        if (!date && !startDate && !endDate) {
            return res.status(400).json({ success: false, message: 'At least one date parameter is required' });
        }
        
        const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (date && !dateFormatRegex.test(date)) {
            return res.status(400).json({ success: false, message: 'Date must be in YYYY-MM-DD format' });
        }
        if (startDate && !dateFormatRegex.test(startDate)) {
            return res.status(400).json({ success: false, message: 'startDate must be in YYYY-MM-DD format' });
        }
        if (endDate && !dateFormatRegex.test(endDate)) {
            return res.status(400).json({ success: false, message: 'endDate must be in YYYY-MM-DD format' });
        }
        
        console.log('==== EXTERNAL API - GESTION STOCK ====');
        
        const convertToInternalFormat = (dateStr) => {
            const [year, month, day] = dateStr.split('-');
            return `${day}-${month}-${year}`;
        };
        
        const getDateRange = (start, end) => {
            const dates = [];
            const currentDate = new Date(start);
            const endDate = new Date(end);
            while (currentDate <= endDate) {
                dates.push(currentDate.toISOString().split('T')[0]);
                currentDate.setDate(currentDate.getDate() + 1);
            }
            return dates;
        };
        
        const allProducts = produitsInventaire.getTousLesProduits();
        
        // Parse multiple products from produit parameter (comma-separated)
        let targetProducts;
        if (produit) {
            const requestedProducts = produit.split(',').map(p => p.trim()).filter(p => p.length > 0);
            targetProducts = requestedProducts;
            
            // Validate all requested products
            const invalidProducts = requestedProducts.filter(p => !allProducts.includes(p));
            if (invalidProducts.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Invalid products: ${invalidProducts.join(', ')}. Available products: ${allProducts.join(', ')}` 
                });
            }
        } else {
            targetProducts = allProducts;
        }
        
        const allPDVs = Object.keys(pointsVente).filter(pdv => pointsVente[pdv].active);
        
        const axiosInstance = require('axios').create({
            baseURL: `http://localhost:${PORT}`,
            headers: { 'X-API-Key': req.headers['x-api-key'] }
        });
        
        const fetchData = async (endpoint, params = {}) => {
            try {
                const response = await axiosInstance.get(endpoint, { params });
                return response.data;
            } catch (error) {
                console.error(`Error fetching ${endpoint}:`, error.message);
                return null;
            }
        };
        
        const processDateData = async (dateStr) => {
            const internalDate = convertToInternalFormat(dateStr);
            
            const [stockMatinData, stockSoirData, transfertsData] = await Promise.all([
                fetchData('/api/external/stock/matin', { date: internalDate }),
                fetchData('/api/external/stock/soir', { date: internalDate }),
                fetchData('/api/external/transferts', { date: internalDate })
            ]);
            
            const pointsDeVente = [];
            
            allPDVs.forEach(pdv => {
                const details = [];
                
                targetProducts.forEach(product => {
                    const stockMatinKey = `${pdv}-${product}`;
                    const stockSoirKey = `${pdv}-${product}`;
                    
                    const stockMatin = stockMatinData && stockMatinData[stockMatinKey] ? 
                        parseFloat(stockMatinData[stockMatinKey].Nombre || stockMatinData[stockMatinKey].quantite || 0) : 0;
                    const stockSoir = stockSoirData && stockSoirData[stockSoirKey] ? 
                        parseFloat(stockSoirData[stockSoirKey].Nombre || stockSoirData[stockSoirKey].quantite || 0) : 0;
                    
                    let transferts = 0;
                    if (transfertsData && transfertsData.transferts) {
                        transferts = transfertsData.transferts
                            .filter(t => t.pointVente === pdv && t.categorie === product)
                            .reduce((sum, t) => sum + parseFloat(t.quantite || 0), 0);
                    }
                    
                    const ventesTheoriques = Math.abs(stockSoir - (stockMatin + transferts));
                    
                    details.push({
                        StockMatin: stockMatin,
                        StockSoir: stockSoir,
                        Transferts: transferts,
                        VentesTheoriques: ventesTheoriques,
                        Produit: product
                    });
                });
                
                if (details.some(d => d.StockMatin > 0 || d.StockSoir > 0 || d.Transferts > 0)) {
                    pointsDeVente.push({
                        PointDeVente: pdv,
                        details: details
                    });
                }
            });
            
            return {
                date: dateStr,
                pointsDeVente: pointsDeVente
            };
        };
        
        const processPeriodData = async (startDateStr, endDateStr) => {
            const dates = getDateRange(startDateStr, endDateStr);
            const aggregatedData = {};
            
            for (const dateStr of dates) {
                const dateData = await processDateData(dateStr);
                
                dateData.pointsDeVente.forEach(pdvData => {
                    if (!aggregatedData[pdvData.PointDeVente]) {
                        aggregatedData[pdvData.PointDeVente] = {};
                    }
                    
                    pdvData.details.forEach(detail => {
                        if (!aggregatedData[pdvData.PointDeVente][detail.Produit]) {
                            aggregatedData[pdvData.PointDeVente][detail.Produit] = {
                                StockMatin: 0,
                                StockSoir: 0,
                                Transferts: 0,
                                VentesTheoriques: 0,
                                count: 0
                            };
                        }
                        
                        const agg = aggregatedData[pdvData.PointDeVente][detail.Produit];
                        agg.StockMatin += detail.StockMatin;
                        agg.StockSoir += detail.StockSoir;
                        agg.Transferts += detail.Transferts;
                        agg.VentesTheoriques += detail.VentesTheoriques;
                        agg.count++;
                    });
                });
            }
            
            const pointsDeVente = [];
            Object.keys(aggregatedData).forEach(pdv => {
                const details = [];
                
                Object.keys(aggregatedData[pdv]).forEach(product => {
                    const agg = aggregatedData[pdv][product];
                    const avgVentesTheorique = agg.count > 0 ? Math.round(agg.VentesTheoriques / agg.count) : 0;
                    
                    details.push({
                        StockMatin: agg.StockMatin,
                        StockSoir: agg.StockSoir,
                        Transferts: agg.Transferts,
                        VentesTheoriques: agg.VentesTheoriques,
                        Produit: product,
                        AvgVentesTheorique: avgVentesTheorique,
                        AvgVentesTheoriqueDayCount: agg.count
                    });
                });
                
                pointsDeVente.push({
                    PointDeVente: pdv,
                    details: details
                });
            });
            
            return {
                startDate: startDateStr,
                endDate: endDateStr,
                pointsDeVente: pointsDeVente
            };
        };
        
        const response = {};
        
        if (date) {
            const targetData = await processDateData(date);
            response.target = [targetData];
        }
        
        if (startDate && endDate) {
            const periodData = await processPeriodData(startDate, endDate);
            response.period = [periodData];
        } else if (startDate || endDate) {
            const singleDate = startDate || endDate;
            const periodData = await processPeriodData(singleDate, singleDate);
            response.period = [periodData];
        }
        
        console.log('==== END EXTERNAL API - GESTION STOCK ====');
        
        res.json(response);
    } catch (error) {
        console.error('Error in gestionStock API:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing gestionStock request',
            error: error.message
        });
    }
});

// Helper function to get stock soir data internally
async function getStockSoirData(date) {
    try {
        console.log(`🔍 Fetching stock soir data for date: ${date}`);
        
        // Use the existing stock API logic
        const type = 'soir';
        const baseFilePath = STOCK_SOIR_PATH;
        const filePath = getPathByDate(baseFilePath, date);
        
        if (!fs.existsSync(filePath)) {
            return {
                success: false,
                message: `Fichier stock non trouvé pour la date ${date}`,
                data: {}
            };
        }
        
        const content = await fsPromises.readFile(filePath, 'utf8');
        const stockData = JSON.parse(content);
        
        return {
            success: true,
            data: stockData,
            message: `Stock soir récupéré pour ${date}`
        };
    } catch (error) {
        console.error(`Erreur lors de la récupération du stock soir pour ${date}:`, error);
        return {
            success: false,
            message: error.message,
            data: {}
        };
    }
}

// Helper function to fetch proxy margin prices using SQL queries (like frontend)
async function fetchProxyMarginPrices(startDate, endDate, pointVente) {
    try {
        console.log(`🔍 Fetching proxy margin prices from ${startDate} to ${endDate} for ${pointVente}`);
        
        // Convert dates from DD/MM/YYYY to DD-MM-YYYY format for database
        const convertDateFormat = (dateStr) => {
            return dateStr.replace(/\//g, '-');
        };
        
        const startDateFormatted = convertDateFormat(startDate);
        const endDateFormatted = convertDateFormat(endDate);
        
        // Build point of sale filter - if "Sélectionner un point de vente", don't filter
        const pointVenteFilter = pointVente === 'Sélectionner un point de vente' ? '' : 
            `AND (point_vente = '${pointVente}')`;
        
        console.log(`🔍 Date range: ${startDateFormatted} to ${endDateFormatted}`);
        console.log(`🔍 Point vente filter: ${pointVenteFilter || 'All points'}`);
        
        // Use DD-MM-YYYY format directly for database comparison (as stored in database)
        const startYMD = startDateFormatted; // '01-08-2025' -> '01-08-2025'
        const endYMD = endDateFormatted;     // '31-08-2025' -> '31-08-2025'
        
        // SQL query for Boeuf (simple VARCHAR date comparison)
        const boeufQuery = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_boeuf,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                date >= '${startYMD}' AND date <= '${endYMD}'
                AND point_vente != 'Abattage'
                ${pointVenteFilter}
                AND (
                    LOWER(produit) LIKE '%boeuf en gros%' 
                    OR LOWER(produit) LIKE '%boeuf en détail%'
                )
        `;
        
        // SQL query for Veau
        const veauQuery = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_veau,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                date >= '${startYMD}' AND date <= '${endYMD}'
                AND point_vente != 'Abattage'
                ${pointVenteFilter}
                AND (LOWER(produit) LIKE '%veau en gros%' 
                    OR LOWER(produit) LIKE '%veau en détail%')
        `;
        
        // SQL query for Poulet
        const pouletQuery = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_poulet,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                date >= '${startYMD}' AND date <= '${endYMD}'
                AND point_vente != 'Abattage'
                ${pointVenteFilter}
                AND LOWER(produit) LIKE '%poulet%'
        `;
        
        // SQL query for Agneau
        const agneauQuery = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_agneau,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                date >= '${startYMD}' AND date <= '${endYMD}'
                AND point_vente != 'Abattage'
                ${pointVenteFilter}
                AND LOWER(produit) LIKE '%agneau%'
        `;
        
        // SQL query for Oeuf/Tablette
        const oeufQuery = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_oeuf,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                date >= '${startYMD}' AND date <= '${endYMD}'
                AND point_vente != 'Abattage'
                ${pointVenteFilter}
                AND (LOWER(produit) = 'oeuf' OR LOWER(produit) = 'tablette')
        `;
        
        // Execute all queries in parallel
        console.log('🔍 Executing SQL queries...');
        console.log('Sample Boeuf query:', boeufQuery.substring(0, 200) + '...');
        console.log('🔍 FULL VEAU QUERY:');
        console.log(veauQuery);
        
        const [boeufResult, veauResult, pouletResult, agneauResult, oeufResult] = await Promise.all([
            sequelize.query(boeufQuery, { type: sequelize.QueryTypes.SELECT }),
            sequelize.query(veauQuery, { type: sequelize.QueryTypes.SELECT }),
            sequelize.query(pouletQuery, { type: sequelize.QueryTypes.SELECT }),
            sequelize.query(agneauQuery, { type: sequelize.QueryTypes.SELECT }),
            sequelize.query(oeufQuery, { type: sequelize.QueryTypes.SELECT })
        ]);
        
        console.log('🔍 Query results received:', {
            boeuf: boeufResult.length,
            veau: veauResult.length,
            poulet: pouletResult.length,
            agneau: agneauResult.length,
            oeuf: oeufResult.length
        });
        
        // Extract results
        const prixMoyenBoeuf = boeufResult[0]?.prix_moyen_boeuf || null;
        const prixMoyenVeau = veauResult[0]?.prix_moyen_veau || null;
        const prixMoyenPoulet = pouletResult[0]?.prix_moyen_poulet || null;
        const prixMoyenAgneau = agneauResult[0]?.prix_moyen_agneau || null;
        const prixMoyenOeuf = oeufResult[0]?.prix_moyen_oeuf || null;
        
        console.log(`🐄 Boeuf: ${prixMoyenBoeuf} FCFA/kg (${boeufResult[0]?.nombre_ventes || 0} ventes)`);
        console.log(`🐂 Veau: ${prixMoyenVeau} FCFA/kg (${veauResult[0]?.nombre_ventes || 0} ventes)`);
        console.log(`🐔 Poulet: ${prixMoyenPoulet} FCFA/unité (${pouletResult[0]?.nombre_ventes || 0} ventes)`);
        console.log(`🐑 Agneau: ${prixMoyenAgneau} FCFA/kg (${agneauResult[0]?.nombre_ventes || 0} ventes)`);
        console.log(`🥚 Oeuf/Tablette: ${prixMoyenOeuf} FCFA/unité (${oeufResult[0]?.nombre_ventes || 0} ventes)`);
        
        return {
            prixMoyenBoeuf,
            prixMoyenVeau,
            prixMoyenPoulet,
            prixMoyenAgneau,
            prixMoyenOeuf
        };
        
    } catch (error) {
        console.error('❌ Error fetching proxy margin prices:', error);
        console.error('❌ Stack trace:', error.stack);
        return {
            prixMoyenBoeuf: null,
            prixMoyenVeau: null,
            prixMoyenPoulet: null,
            prixMoyenAgneau: null,
            prixMoyenOeuf: null,
            error: error.message // Add error info to returned object
        };
    }
}

// Helper function to calculate proxy margins average prices (server-side version)
async function calculerPrixMoyensProxyMarges(dateDebut, dateFin) {
    try {
        console.log(`🔍 Calculating proxy margins prices for ${dateDebut} to ${dateFin}`);
        
        // Convert dates to the format expected by database (standardize format)
        const convertDateFormat = (dateStr) => {
            // Input: DD/MM/YYYY, convert to DD-MM-YYYY for database
            if (dateStr.includes('/')) {
                return dateStr.replace(/\//g, '-');
            }
            return dateStr;
        };
        
        const startDate = convertDateFormat(dateDebut);
        const endDate = convertDateFormat(dateFin);
        
        // Get weighted average prices using proper SQL queries
        console.log(`🔍 Fetching weighted averages for period: ${startDate} to ${endDate}`);
        const weightedAverages = await getSalesDataForPeriod(startDate, endDate);
        
        if (!weightedAverages) {
            console.log('⚠️ No weighted averages data found');
            return {};
        }
        
        // Build prix moyens from weighted averages
        const prixMoyens = {};
        
        if (weightedAverages.boeuf && weightedAverages.boeuf.prix_moyen_boeuf > 0) {
            prixMoyens.prixMoyenBoeuf = weightedAverages.boeuf.prix_moyen_boeuf;
        }
        if (weightedAverages.veau && weightedAverages.veau.prix_moyen_veau > 0) {
            prixMoyens.prixMoyenVeau = weightedAverages.veau.prix_moyen_veau;
        }
        if (weightedAverages.poulet && weightedAverages.poulet.prix_moyen_poulet > 0) {
            prixMoyens.prixMoyenPoulet = weightedAverages.poulet.prix_moyen_poulet;
        }
        if (weightedAverages.agneau && weightedAverages.agneau.prix_moyen_agneau > 0) {
            prixMoyens.prixMoyenAgneau = weightedAverages.agneau.prix_moyen_agneau;
        }
        if (weightedAverages.oeuf && weightedAverages.oeuf.prix_moyen_oeuf > 0) {
            prixMoyens.prixMoyenOeuf = weightedAverages.oeuf.prix_moyen_oeuf;
        }
        
        console.log(`✅ Prix moyens calculés (weighted average):`, prixMoyens);
        console.log(`📊 Raw weighted averages:`, weightedAverages);
        return prixMoyens;
        
    } catch (error) {
        console.error('Error calculating proxy margins prices:', error);
        return {};
    }
}

// Helper function to get sales data for a period (using same logic as frontend APIs)
async function getSalesDataForPeriod(startDate, endDate) {
    try {
        console.log(`🔍 getSalesDataForPeriod called with: ${startDate} to ${endDate}`);
        
        // Use the same database connection as other endpoints
        const { sequelize } = require('./db');
        const { QueryTypes } = require('sequelize');
        
        // Use weighted average SQL query for proxy margins calculation
        const queryBoeuf = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_boeuf,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                TO_DATE(date, 'DD-MM-YYYY') >= TO_DATE(:startDate, 'DD-MM-YYYY')
                AND TO_DATE(date, 'DD-MM-YYYY') <= TO_DATE(:endDate, 'DD-MM-YYYY')
                AND point_vente != 'Abattage'
                AND (
                   LOWER(produit) LIKE '%boeuf en gros%' 
                    OR LOWER(produit) LIKE '%boeuf en détail%'
                )
        `;
        
        const queryVeau = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_veau,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                TO_DATE(date, 'DD-MM-YYYY') >= TO_DATE(:startDate, 'DD-MM-YYYY')
                AND TO_DATE(date, 'DD-MM-YYYY') <= TO_DATE(:endDate, 'DD-MM-YYYY')
                AND point_vente != 'Abattage'
                AND LOWER(produit) LIKE '%veau%'
        `;
        
        const queryPoulet = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_poulet,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                TO_DATE(date, 'DD-MM-YYYY') >= TO_DATE(:startDate, 'DD-MM-YYYY')
                AND TO_DATE(date, 'DD-MM-YYYY') <= TO_DATE(:endDate, 'DD-MM-YYYY')
                AND point_vente != 'Abattage'
                AND LOWER(produit) LIKE '%poulet%'
        `;
        
        const queryAgneau = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_agneau,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                TO_DATE(date, 'DD-MM-YYYY') >= TO_DATE(:startDate, 'DD-MM-YYYY')
                AND TO_DATE(date, 'DD-MM-YYYY') <= TO_DATE(:endDate, 'DD-MM-YYYY')
                AND point_vente != 'Abattage'
                AND LOWER(produit) LIKE '%agneau%'
                AND LOWER(produit) NOT LIKE '%tete agneau%'
                AND LOWER(produit) NOT LIKE '%tête agneau%'
        `;
        
        const queryOeuf = `
            SELECT 
                ROUND(
                    COALESCE(
                        SUM(prix_unit * nombre) / NULLIF(SUM(nombre), 0),
                        0
                    )
                ) as prix_moyen_oeuf,
                SUM(nombre) as quantite_totale,
                COUNT(*) as nombre_ventes
            FROM ventes 
            WHERE 
                TO_DATE(date, 'DD-MM-YYYY') >= TO_DATE(:startDate, 'DD-MM-YYYY')
                AND TO_DATE(date, 'DD-MM-YYYY') <= TO_DATE(:endDate, 'DD-MM-YYYY')
                AND point_vente != 'Abattage'
                AND (LOWER(produit) = 'oeuf' OR LOWER(produit) LIKE '%tablette%')
        `;
        
        // Execute all weighted average queries in parallel
        const [boeufResult, veauResult, pouletResult, agneauResult, oeufResult] = await Promise.all([
            sequelize.query(queryBoeuf, { replacements: { startDate, endDate }, type: QueryTypes.SELECT }),
            sequelize.query(queryVeau, { replacements: { startDate, endDate }, type: QueryTypes.SELECT }),
            sequelize.query(queryPoulet, { replacements: { startDate, endDate }, type: QueryTypes.SELECT }),
            sequelize.query(queryAgneau, { replacements: { startDate, endDate }, type: QueryTypes.SELECT }),
            sequelize.query(queryOeuf, { replacements: { startDate, endDate }, type: QueryTypes.SELECT })
        ]);
        
        console.log(`📊 Weighted average queries executed`);
        console.log(`📊 Boeuf result:`, boeufResult[0]);
        console.log(`📊 Veau result:`, veauResult[0]);
        console.log(`📊 Poulet result:`, pouletResult[0]);
        console.log(`📊 Agneau result:`, agneauResult[0]);
        console.log(`📊 Oeuf result:`, oeufResult[0]);
        
        // Return weighted averages as price data
        return {
            boeuf: boeufResult[0] || { prix_moyen_boeuf: 0 },
            veau: veauResult[0] || { prix_moyen_veau: 0 },
            poulet: pouletResult[0] || { prix_moyen_poulet: 0 },
            agneau: agneauResult[0] || { prix_moyen_agneau: 0 },
            oeuf: oeufResult[0] || { prix_moyen_oeuf: 0 }
        };
        
    } catch (error) {
        console.error('Error fetching sales data:', error);
        console.error('Error details:', error.message);
        return [];
    }
}

// Helper function to calculate Stock Soir margin (server-side version of genererCalculsMargeStockSoir)
async function calculateStockSoirMarge(stockDebut, stockFin, dateDebut, dateFin, pointVente, dynamicPrices, ratiosConfig = {}) {
    try {
        console.log(`🔍 Calculating Stock Soir margin for ${pointVente} from ${dateDebut} to ${dateFin}`);
        console.log(`🎯 Dynamic prices received:`, dynamicPrices);
        
        // Calculate variation for each product (SAME logic as frontend)
        const variationsParProduit = {};
        const allProduits = new Set([...Object.keys(stockDebut || {}), ...Object.keys(stockFin || {})]);
        
        allProduits.forEach(key => {
            const [pointVenteKey, produit] = key.split('-');
            if (pointVente === 'Sélectionner un point de vente' || pointVenteKey === pointVente || !pointVente) {
                const debut = stockDebut[key] || { Montant: 0, Nombre: 0, PU: 0 };
                const fin = stockFin[key] || { Montant: 0, Nombre: 0, PU: 0 };
                
                const montantVariation = (parseFloat(fin.Montant) || 0) - (parseFloat(debut.Montant) || 0);
                const quantiteVariation = (parseFloat(fin.Nombre) || 0) - (parseFloat(debut.Nombre) || 0);
                
                if (Math.abs(montantVariation) > 0.01 || Math.abs(quantiteVariation) > 0.01) {
                    variationsParProduit[produit] = {
                        Montant: montantVariation,
                        Quantite: quantiteVariation,
                        PU: parseFloat(fin.PU) || parseFloat(debut.PU) || 0,
                        PointVente: pointVenteKey
                    };
                }
            }
        });

        // Use the dynamicPrices already fetched by fetchProxyMarginPrices (no need to recalculate)
        const prixMoyensProxyMarges = dynamicPrices;
        
        console.log(`🎯 Using fetched dynamic prices:`, prixMoyensProxyMarges);
        
        // Get price configuration (ENHANCED - use weighted purchase prices from achats-boeuf API)
        const priceConfig = {
            // Purchase prices (use weighted purchase prices from achats-boeuf API)
            prixAchatBoeuf: parseFloat(dynamicPrices.prixAchatBoeufPondere) || 3500, // From weighted purchase prices
            prixAchatVeau: parseFloat(dynamicPrices.prixAchatVeauPondere) || 3400,   // From weighted purchase prices
            prixAchatPoulet: 2600, // Fixed purchase price (no weighted data yet)
            prixAchatAgneau: 4000, // Fixed purchase price (no weighted data yet)
            prixAchatOeuf: 2200,   // Fixed purchase price (no weighted data yet)
            // Ratios (calculate from actual data - Boeuf: -5%, Veau: -9.87%)
            ratioBoeuf: -0.05, // -5% as per capture d'écran
            ratioVeau: -0.0987  // -9.87% as per capture d'écran
        };
        
        // Log the price source for transparency
        console.log(`🎯 Prix d'achat utilisés:`);
        console.log(`  Boeuf: ${priceConfig.prixAchatBoeuf} FCFA/kg ${dynamicPrices.prixAchatBoeufPondere ? '(weighted purchase prices)' : '(prix fixe)'}`);
        console.log(`  Veau: ${priceConfig.prixAchatVeau} FCFA/kg ${dynamicPrices.prixAchatVeauPondere ? '(weighted purchase prices)' : '(prix fixe)'}`);
        console.log(`  Poulet: ${priceConfig.prixAchatPoulet} FCFA/unité (prix fixe)`);
        console.log(`  Agneau: ${priceConfig.prixAchatAgneau} FCFA/kg (prix fixe)`);
        console.log(`  Oeuf: ${priceConfig.prixAchatOeuf} FCFA/unité (prix fixe)`);
        
        console.log(`🎯 Ratios utilisés:`);
        console.log(`  Boeuf: ${(priceConfig.ratioBoeuf * 100).toFixed(2)}% (éditable - mis à jour par Proxy Marges)`);
        console.log(`  Veau: ${(priceConfig.ratioVeau * 100).toFixed(2)}% (éditable - mis à jour par Proxy Marges)`);
        console.log(`  Source: Interface éditables (auto-remplies par calcul Proxy Marges)`);
        
        // Selling prices (PRIORITY: dynamic prices first, then proxy margins) - with explicit debugging
        console.log(`🔍 DEBUG - Dynamic prices received:`, dynamicPrices);
        
        const prixVenteConfig = {
            prixVenteBoeuf: dynamicPrices.prixMoyenBoeuf !== undefined ? parseFloat(dynamicPrices.prixMoyenBoeuf) : (prixMoyensProxyMarges.prixMoyenBoeuf || null),
            prixVenteVeau: dynamicPrices.prixMoyenVeau !== undefined ? parseFloat(dynamicPrices.prixMoyenVeau) : (prixMoyensProxyMarges.prixMoyenVeau || null),
            prixVentePoulet: dynamicPrices.prixMoyenPoulet !== undefined ? parseFloat(dynamicPrices.prixMoyenPoulet) : (prixMoyensProxyMarges.prixMoyenPoulet || null),
            prixVenteAgneau: dynamicPrices.prixMoyenAgneau !== undefined ? parseFloat(dynamicPrices.prixMoyenAgneau) : (prixMoyensProxyMarges.prixMoyenAgneau || null),
            prixVenteOeuf: dynamicPrices.prixMoyenOeuf !== undefined ? parseFloat(dynamicPrices.prixMoyenOeuf) : (prixMoyensProxyMarges.prixMoyenOeuf || null)
        };
        
        console.log(`🔍 DEBUG - Prix vente Boeuf: ${dynamicPrices.prixMoyenBoeuf} -> ${prixVenteConfig.prixVenteBoeuf}`);
        console.log(`🔍 DEBUG - Prix vente Poulet: ${dynamicPrices.prixMoyenPoulet} -> ${prixVenteConfig.prixVentePoulet}`);
        
        console.log(`🎯 Prix de configuration finaux:`, priceConfig);
        console.log(`🎯 Prix de vente configurés:`, prixVenteConfig);

        // Calculate margins for each product
        let totalCA = 0;
        let totalCout = 0;
        let calculsByProduit = [];

        Object.entries(variationsParProduit).forEach(([produit, data]) => {
            const quantiteVendue = parseFloat(data.Quantite) || 0;
            
            // Same filtering logic as frontend
            if (Math.abs(quantiteVendue) < 0.01) {
                console.log(`⚠️ Product ${produit} ignored (quantity too small: ${quantiteVendue})`);
                return;
            }

            let prixAchatProduit, prixVenteProduit, quantiteAbattue;

            // EXACT same logic as frontend with proper price calculation
            // Calculate selling price from stock variation data (like frontend does)
            const prixVenteCalcule = parseFloat(data.Montant) / quantiteVendue;
            if (!isFinite(prixVenteCalcule) || prixVenteCalcule <= 0) {
                console.log(`⚠️ IGNORED: ${produit} - invalid selling price (${prixVenteCalcule})`);
                return;
            }

            // Same product logic as frontend (with CORRECTED proxy margins usage)
            if (produit.toLowerCase() === 'boeuf') {
                prixAchatProduit = priceConfig.prixAchatBoeuf;
                // Use selling price from prixVenteConfig if available, otherwise use calculated price
                console.log(`🔍 DEBUG BOEUF - prixVenteConfig.prixVenteBoeuf:`, prixVenteConfig.prixVenteBoeuf, typeof prixVenteConfig.prixVenteBoeuf);
                console.log(`🔍 DEBUG BOEUF - prixVenteCalcule:`, prixVenteCalcule);
                prixVenteProduit = prixVenteConfig.prixVenteBoeuf || prixVenteCalcule;
                console.log(`🔍 DEBUG BOEUF - final prixVenteProduit:`, prixVenteProduit);
                quantiteAbattue = quantiteVendue / (1 + priceConfig.ratioBoeuf);
                console.log(`🎯 Boeuf - Prix vente: ${prixVenteConfig.prixVenteBoeuf ? 'Proxy Marges' : 'Calculé'} = ${parseFloat(prixVenteProduit).toFixed(0)} FCFA/kg`);
            } else if (produit.toLowerCase() === 'veau') {
                prixAchatProduit = priceConfig.prixAchatVeau;
                prixVenteProduit = prixVenteConfig.prixVenteVeau || prixVenteCalcule;
                quantiteAbattue = quantiteVendue / (1 + priceConfig.ratioVeau);
                console.log(`🎯 Veau - Prix vente: ${prixVenteConfig.prixVenteVeau ? 'Proxy Marges' : 'Calculé'} = ${parseFloat(prixVenteProduit).toFixed(0)} FCFA/kg`);
            } else if (produit.toLowerCase() === 'poulet') {
                prixAchatProduit = priceConfig.prixAchatPoulet;
                prixVenteProduit = prixVenteConfig.prixVentePoulet || prixVenteCalcule;
                quantiteAbattue = quantiteVendue;
                console.log(`🎯 Poulet - Prix vente: ${prixVenteConfig.prixVentePoulet ? 'Proxy Marges' : 'Calculé'} = ${parseFloat(prixVenteProduit).toFixed(0)} FCFA/unité`);
            } else if (produit.toLowerCase() === 'agneau') {
                prixAchatProduit = priceConfig.prixAchatAgneau;
                prixVenteProduit = prixVenteConfig.prixVenteAgneau || prixVenteCalcule;
                quantiteAbattue = quantiteVendue;
                console.log(`🎯 Agneau - Prix vente: ${prixVenteConfig.prixVenteAgneau ? 'Proxy Marges' : 'Calculé'} = ${parseFloat(prixVenteProduit).toFixed(0)} FCFA/kg`);
            } else if (produit.toLowerCase() === 'oeuf' || produit.toLowerCase() === 'tablette') {
                prixAchatProduit = priceConfig.prixAchatOeuf;
                prixVenteProduit = prixVenteConfig.prixVenteOeuf || prixVenteCalcule;
                quantiteAbattue = quantiteVendue;
                console.log(`🎯 ${produit} - Prix vente: ${prixVenteConfig.prixVenteOeuf ? 'Proxy Marges' : 'Calculé'} = ${parseFloat(prixVenteProduit).toFixed(0)} FCFA/unité`);
            } else {
                // Derived products (exact same logic as frontend)
                if (produit.toLowerCase().includes('viande hach')) {
                    prixAchatProduit = priceConfig.prixAchatBoeuf;
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue)) || 5000; // Same fallback as frontend
                    console.log(`🎯 Viande hachée - Prix achat: Boeuf = ${parseFloat(prixAchatProduit).toFixed(0)} FCFA/kg`);
                } else {
                    // Other by-products - no purchase cost
                    prixAchatProduit = 0;
                    prixVenteProduit = parseFloat(data.PU) || (Math.abs(data.Montant) / Math.abs(quantiteVendue)) || 0;
                }
                quantiteAbattue = quantiteVendue;
            }

            // Verify values are valid (not NaN) - same as frontend
            if (isNaN(prixVenteProduit) || isNaN(quantiteVendue) || isNaN(prixAchatProduit) || isNaN(quantiteAbattue)) {
                console.warn(`⚠️ Invalid values for ${produit}:`, {
                    prixVenteProduit, quantiteVendue, prixAchatProduit, quantiteAbattue, data
                });
                return; // Skip this product
            }

            // Calculate margin (can be negative if stock decrease)
            const caProduit = quantiteVendue * prixVenteProduit;
            const coutProduit = quantiteAbattue * prixAchatProduit;
            const margeProduit = caProduit - coutProduit;

            console.log(`📊 ${produit}: qté=${quantiteVendue}, prixVente=${prixVenteProduit}, CA=${caProduit}, coût=${coutProduit}, marge=${margeProduit}`);

            totalCA += caProduit;
            totalCout += coutProduit;

            calculsByProduit.push({
                produit,
                quantiteVendue,
                quantiteAbattue,
                prixVenteProduit,
                prixAchatProduit,
                caProduit,
                coutProduit,
                margeProduit,
                pointVente: data.PointVente
            });
        });

        const margeTotal = totalCA - totalCout;

        console.log(`✅ Stock Soir margin calculated: CA=${totalCA.toFixed(0)} FCFA, Cost=${totalCout.toFixed(0)} FCFA, Margin=${margeTotal.toFixed(0)} FCFA`);

        return {
            totalCA: Math.round(totalCA),
            totalCout: Math.round(totalCout),
            marge: Math.round(margeTotal),
            detailParProduit: calculsByProduit,
            nombreProduits: calculsByProduit.length
        };

    } catch (error) {
        console.error('Error calculating Stock Soir margin:', error);
        throw error;
    }
}

// Function to fetch weighted average purchase prices from achats-boeuf API
async function fetchWeightedPurchasePrices(startDate, endDate) {
    try {
        console.log(`🔍 Fetching weighted purchase prices from achats-boeuf API: ${startDate} to ${endDate}`);
        
        // Convert dates from DD/MM/YYYY to DD-MM-YYYY format for API
        const convertDateFormat = (dateStr) => {
            return dateStr.replace(/\//g, '-');
        };
        
        const formattedStartDate = convertDateFormat(startDate);
        const formattedEndDate = convertDateFormat(endDate);
        
        // Call achats-boeuf API
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
            : 'http://localhost:3000';
        const achatsUrl = `${baseUrl}/api/external/achats-boeuf?startDate=${formattedStartDate}&endDate=${formattedEndDate}`;
        console.log(`🔍 Calling achats-boeuf API: ${achatsUrl}`);
        
        const achatsResponse = await fetch(achatsUrl, {
            method: 'GET',
            headers: {
                'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4',
                'Content-Type': 'application/json'
            }
        });
        
        if (achatsResponse.ok) {
            const achatsResult = await achatsResponse.json();
            if (achatsResult.success && achatsResult.data && achatsResult.data.totals) {
                // Use default prices if API returns 0 or null/undefined
                const boeufPrice = achatsResult.data.totals.avgWeightedPrixKgBoeuf;
                const veauPrice = achatsResult.data.totals.avgWeightedPrixKgVeau;
                
                const weightedPrices = {
                    prixAchatBoeufPondere: (boeufPrice && boeufPrice > 0) ? boeufPrice : 3400,
                    prixAchatVeauPondere: (veauPrice && veauPrice > 0) ? veauPrice : 3500
                };
                
                console.log(`✅ Weighted prices from achats-boeuf API:`, weightedPrices);
                console.log(`🔍 Raw API values - Boeuf: ${boeufPrice}, Veau: ${veauPrice}`);
                return weightedPrices;
            }
        }
        
        console.log(`⚠️ No achats data found from API, using fixed prices`);
        return {
            prixAchatBoeufPondere: 3400,
            prixAchatVeauPondere: 3500
        };
    } catch (error) {
        console.error(`❌ Error fetching weighted prices from API:`, error.message);
        return {
            prixAchatBoeufPondere: 3400,
            prixAchatVeauPondere: 3500
        };
    }
}

// Helper function to calculate totals for achats data
function calculateAchatTotals(achatsArray) {
    // Séparer les achats par type d'animal
    const boeufAchats = achatsArray.filter(achat => achat.bete && achat.bete.toLowerCase() === 'boeuf');
    const veauAchats = achatsArray.filter(achat => achat.bete && achat.bete.toLowerCase() === 'veau');
    
    const totals = {
        // Nombres d'animaux
        nbrBoeuf: boeufAchats.length,
        nbrVeau: veauAchats.length,
        
        // Totaux Bœuf
        totalPrixBoeuf: boeufAchats.reduce((sum, achat) => sum + (achat.prix_achat_kg * achat.nbr_kg), 0),
        totalAbatsBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.abats, 0),
        totalFraisAbattageBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.frais_abattage, 0),
        totalKgBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.nbr_kg, 0),
        
        // Totaux Veau
        totalPrixVeau: veauAchats.reduce((sum, achat) => sum + (achat.prix_achat_kg * achat.nbr_kg), 0),
        totalAbatsVeau: veauAchats.reduce((sum, achat) => sum + achat.abats, 0),
        totalFraisAbattageVeau: veauAchats.reduce((sum, achat) => sum + achat.frais_abattage, 0),
        totalKgVeau: veauAchats.reduce((sum, achat) => sum + achat.nbr_kg, 0),
        
        // Totaux généraux (pour compatibilité)
        totalPrix: achatsArray.reduce((sum, achat) => sum + achat.prix, 0),
        totalAbats: achatsArray.reduce((sum, achat) => sum + achat.abats, 0),
        totalFraisAbattage: achatsArray.reduce((sum, achat) => sum + achat.frais_abattage, 0),
        totalKg: achatsArray.reduce((sum, achat) => sum + achat.nbr_kg, 0),
    };
    
    // Calculs moyennes Bœuf
    if (boeufAchats.length > 0) {
        totals.avgPrixKgBoeuf = boeufAchats.reduce((sum, achat) => sum + achat.prix_achat_kg, 0) / boeufAchats.length;
        totals.avgPrixKgSansAbatsBoeuf = totals.avgPrixKgBoeuf;
    } else {
        totals.avgPrixKgBoeuf = 0;
        totals.avgPrixKgSansAbatsBoeuf = 0;
    }
    
    // Calculs moyennes Veau
    if (veauAchats.length > 0) {
        totals.avgPrixKgVeau = veauAchats.reduce((sum, achat) => sum + achat.prix_achat_kg, 0) / veauAchats.length;
        totals.avgPrixKgSansAbatsVeau = totals.avgPrixKgVeau;
    } else {
        totals.avgPrixKgVeau = 0;
        totals.avgPrixKgSansAbatsVeau = 0;
    }
    
    // 🚀 NOUVEAU: Calculs moyennes pondérées (plus cohérentes)
    // avgWeightedPrixKgBoeuf = Σ(prix_achat_kg × nbr_kg) / Σ(nbr_kg)
    if (totals.totalKgBoeuf > 0) {
        // Utiliser le totalPrixBoeuf déjà calculé (qui est la somme des prix_achat_kg * nbr_kg)
        totals.avgWeightedPrixKgBoeuf = totals.totalPrixBoeuf / totals.totalKgBoeuf;
        console.log(`🥩 Boeuf - Moyenne pondérée: ${totals.avgWeightedPrixKgBoeuf.toFixed(2)} FCFA/kg (vs simple: ${totals.avgPrixKgBoeuf.toFixed(2)})`);
    } else {
        totals.avgWeightedPrixKgBoeuf = 0;
    }
    
    if (totals.totalKgVeau > 0) {
        // Utiliser le totalPrixVeau déjà calculé (qui est la somme des prix_achat_kg * nbr_kg)
        totals.avgWeightedPrixKgVeau = totals.totalPrixVeau / totals.totalKgVeau;
        console.log(`🐄 Veau - Moyenne pondérée: ${totals.avgWeightedPrixKgVeau.toFixed(2)} FCFA/kg (vs simple: ${totals.avgPrixKgVeau.toFixed(2)})`);
    } else {
        totals.avgWeightedPrixKgVeau = 0;
    }
    
    // Calculs moyennes générales (pour compatibilité)
    if (totals.totalKg > 0) {
        totals.avgPrixKg = totals.totalPrix / totals.totalKg;
        totals.avgPrixKgSansAbats = totals.totalPrix / totals.totalKg;
    } else {
        totals.avgPrixKg = 0;
        totals.avgPrixKgSansAbats = 0;
    }
    
    return totals;
}

// Helper function to get previous date (for stock debut calculation)
function getPreviousDate(dateStr) {
    try {
        let day, month, year;
        
        // Handle both DD/MM/YYYY and DD-MM-YYYY formats
        if (dateStr.includes('/')) {
            [day, month, year] = dateStr.split('/');
        } else if (dateStr.includes('-')) {
            [day, month, year] = dateStr.split('-');
        } else {
            console.error('Unsupported date format:', dateStr);
            return dateStr;
        }
        
        // Convert to Date object
        const date = new Date(year, month - 1, day); // month is 0-indexed
        
        // Subtract 1 day
        date.setDate(date.getDate() - 1);
        
        // Convert back to the same format as input
        const prevDay = date.getDate().toString().padStart(2, '0');
        const prevMonth = (date.getMonth() + 1).toString().padStart(2, '0');
        const prevYear = date.getFullYear();
        
        // Return in the same format as input
        if (dateStr.includes('/')) {
            return `${prevDay}/${prevMonth}/${prevYear}`;
        } else {
            return `${prevDay}-${prevMonth}-${prevYear}`;
        }
    } catch (error) {
        console.error('Error calculating previous date:', error);
        return dateStr; // Return original if error
    }
}

// Helper function to fetch selling prices using the same logic as calculerAnalyticsVentes()
async function fetchSellingPricesFromVentes(startDate, endDate, pointVente) {
    try {
        console.log(`🔍 Fetching selling prices using calculerAnalyticsVentes logic: ${startDate} to ${endDate} for ${pointVente}`);
        
        // Convert dates from DD/MM/YYYY to YYYY-MM-DD format for the API
        const formatDateForApi = (dateStr) => {
            const parts = dateStr.split('/');
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };
        
        const dateDebutAPI = formatDateForApi(startDate);
        const dateFinAPI = formatDateForApi(endDate);
        const pointVenteAPI = pointVente === 'Sélectionner un point de vente' ? 'tous' : pointVente;
        
        console.log(`🔍 API call: /api/external/ventes?dateDebut=${dateDebutAPI}&dateFin=${dateFinAPI}&pointVente=${pointVenteAPI}`);
        
        // Call the existing ventes API (same as analytics container)
        const fetch = require('node-fetch');
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
            : 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/external/ventes?dateDebut=${dateDebutAPI}&dateFin=${dateFinAPI}&pointVente=${encodeURIComponent(pointVenteAPI)}`, {
            method: 'GET',
            headers: {
                'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API call failed: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.success || !data.ventes) {
            throw new Error('Invalid API response');
        }
        
        console.log(`🔍 Retrieved ${data.ventes.length} ventes from API`);
        
        // Use the EXACT same logic as calculerAnalyticsVentes()
        const categoriesRegroupees = {
            'Boeuf': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
            'Veau': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
            'Poulet': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
            'Agneau': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 },
            'Oeuf': { prixTotal: 0, quantiteTotal: 0, nombreVentes: 0 }
        };
        
        // Process each vente exactly like calculerAnalyticsVentes()
        data.ventes.forEach(vente => {
            // Exclude "Abattage" point de vente (same as calculerAnalyticsVentes)
            if (vente['Point de Vente'] && vente['Point de Vente'].toLowerCase() === 'abattage') {
                return; // Skip this vente
            }
            
            const produit = vente.Produit || '';
            const prixUnitaire = parseFloat(vente.PU) || 0;
            const quantite = parseFloat(vente.Nombre) || 0;
            
            let categorieRegroupee = null;
            
            // EXACT same logic as calculerAnalyticsVentes()
            if (produit.toLowerCase().includes('boeuf en gros')) {
                categorieRegroupee = 'Boeuf';
            } else if (produit.toLowerCase().includes('boeuf en détail') || produit.toLowerCase().includes('boeuf en detail')) {
                categorieRegroupee = 'Boeuf';
            } else if (produit.toLowerCase().includes('veau en gros')) {
                categorieRegroupee = 'Veau';
            } else if (produit.toLowerCase().includes('veau en détail') || produit.toLowerCase().includes('veau en detail')) {
                categorieRegroupee = 'Veau';
            } else if (produit.toLowerCase().includes('poulet')) {
                categorieRegroupee = 'Poulet';
            } else if (produit.toLowerCase().includes('agneau') &&
                       !produit.toLowerCase().includes('tete agneau') &&
                       !produit.toLowerCase().includes('tête agneau')) {
                // Exclude 'Tete Agneau' from Agneau; it is handled as Divers elsewhere
                categorieRegroupee = 'Agneau';
            } else if (produit.toLowerCase() === 'oeuf' || produit.toLowerCase() === 'tablette') {
                categorieRegroupee = 'Oeuf';
            }
            
            // Add to category if found
            if (categorieRegroupee && categoriesRegroupees[categorieRegroupee]) {
                categoriesRegroupees[categorieRegroupee].prixTotal += prixUnitaire * quantite;
                categoriesRegroupees[categorieRegroupee].quantiteTotal += quantite;
                categoriesRegroupees[categorieRegroupee].nombreVentes += 1;
            }
        });
        
        // Calculate weighted averages (same as calculerAnalyticsVentes)
        const calculatePrixMoyen = (category) => {
            if (category.quantiteTotal > 0) {
                return Math.round(category.prixTotal / category.quantiteTotal);
            }
            return 0;
        };
        
        const results = {
            prixMoyenBoeuf: calculatePrixMoyen(categoriesRegroupees.Boeuf),
            prixMoyenVeau: calculatePrixMoyen(categoriesRegroupees.Veau),
            prixMoyenPoulet: calculatePrixMoyen(categoriesRegroupees.Poulet),
            prixMoyenAgneau: calculatePrixMoyen(categoriesRegroupees.Agneau),
            prixMoyenOeuf: calculatePrixMoyen(categoriesRegroupees.Oeuf)
        };
        
        console.log('🔍 Analytics-style calculation results:', {
            boeuf: {
                prix_moyen_boeuf: results.prixMoyenBoeuf,
                quantite_totale: categoriesRegroupees.Boeuf.quantiteTotal.toFixed(3),
                nombre_ventes: categoriesRegroupees.Boeuf.nombreVentes
            },
            veau: {
                prix_moyen_veau: results.prixMoyenVeau,
                quantite_totale: categoriesRegroupees.Veau.quantiteTotal.toFixed(3),
                nombre_ventes: categoriesRegroupees.Veau.nombreVentes
            },
            poulet: {
                prix_moyen_poulet: results.prixMoyenPoulet,
                quantite_totale: categoriesRegroupees.Poulet.quantiteTotal.toFixed(3),
                nombre_ventes: categoriesRegroupees.Poulet.nombreVentes
            },
            agneau: {
                prix_moyen_agneau: results.prixMoyenAgneau,
                quantite_totale: categoriesRegroupees.Agneau.quantiteTotal.toFixed(3),
                nombre_ventes: categoriesRegroupees.Agneau.nombreVentes
            },
            oeuf: {
                prix_moyen_oeuf: results.prixMoyenOeuf,
                quantite_totale: categoriesRegroupees.Oeuf.quantiteTotal.toFixed(3),
                nombre_ventes: categoriesRegroupees.Oeuf.nombreVentes
            }
        });
        
        return results;
        
    } catch (error) {
        console.error('❌ Error fetching selling prices using analytics logic:', error);
        return {
            prixMoyenBoeuf: 0,
            prixMoyenVeau: 0,
            prixMoyenPoulet: 0,
            prixMoyenAgneau: 0,
            prixMoyenOeuf: 0
        };
    }
}

// External API version for beef purchases
// API endpoint for Stock Soir margin calculation
app.get('/api/external/stock-soir-marge', validateApiKey, async (req, res) => {
    try {
        const { startDate, endDate, pointVente, prixMoyenBoeuf, prixMoyenVeau, prixMoyenPoulet, prixMoyenAgneau, prixMoyenOeuf, ratioPerteBoeuf, ratioPerteVeau, calculAutoActif } = req.query;
        
        console.log('==== EXTERNAL API - STOCK SOIR MARGE ====');
        console.log('Request params:', { startDate, endDate, pointVente, prixMoyenBoeuf, prixMoyenVeau, prixMoyenPoulet, prixMoyenAgneau, prixMoyenOeuf, ratioPerteBoeuf, ratioPerteVeau, calculAutoActif });
        console.log('🔍 PRIX DEBUG - Boeuf reçu:', prixMoyenBoeuf, typeof prixMoyenBoeuf);
        console.log('🔍 PRIX DEBUG - Poulet reçu:', prixMoyenPoulet, typeof prixMoyenPoulet);
        
        // Validate required parameters
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'startDate et endDate sont requis (format: DD/MM/YYYY ou DD-MM-YYYY)'
            });
        }
        
        // Default point de vente if not specified
        const pointVenteFilter = pointVente || 'Sélectionner un point de vente';
        
        // Convert dates to the format expected by stock API (DD/MM/YYYY)
        const formatDate = (dateStr) => {
            if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts[0].length === 4) {
                    // YYYY-MM-DD to DD/MM/YYYY
                    return `${parts[2]}/${parts[1]}/${parts[0]}`;
                } else {
                    // DD-MM-YYYY to DD/MM/YYYY
                    return dateStr.replace(/-/g, '/');
                }
            }
            return dateStr; // Already in DD/MM/YYYY format
        };
        
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);
        
        // Calculate previous date for stock debut (startDate - 1)
        const previousStartDate = getPreviousDate(startDate);
        const formattedPreviousStartDate = formatDate(previousStartDate);
        
        console.log('Formatted dates:', { formattedStartDate, formattedEndDate, formattedPreviousStartDate });
        console.log(`📅 Stock Début: ${previousStartDate} (${formattedPreviousStartDate}) - startDate-1 pour variation correcte`);
        console.log(`📅 Stock Fin: ${endDate} (${formattedEndDate})`);
        console.log(`🔍 PREVIOUS START DATE: ${previousStartDate} (calculé automatiquement depuis startDate: ${startDate})`);
        
        // Fetch selling prices from ventes table (weighted averages)
        console.log('🔍 Fetching selling prices from ventes table...');
        let fetchedPrices = {
            prixMoyenBoeuf: 0,
            prixMoyenVeau: 0,
            prixMoyenPoulet: 0,
            prixMoyenAgneau: 0,
            prixMoyenOeuf: 0
        };
        
        try {
            // Use a new function to get weighted averages from ventes table with proper date handling
            const sellingPrices = await fetchSellingPricesFromVentes(startDate, endDate, pointVenteFilter);
            
            if (sellingPrices) {
                fetchedPrices.prixMoyenBoeuf = Math.round(sellingPrices.prixMoyenBoeuf || 0);
                fetchedPrices.prixMoyenVeau = Math.round(sellingPrices.prixMoyenVeau || 0);
                fetchedPrices.prixMoyenPoulet = Math.round(sellingPrices.prixMoyenPoulet || 0);
                fetchedPrices.prixMoyenAgneau = Math.round(sellingPrices.prixMoyenAgneau || 0);
                fetchedPrices.prixMoyenOeuf = Math.round(sellingPrices.prixMoyenOeuf || 0);
                console.log(`✅ Selling prices from ventes table: Boeuf=${fetchedPrices.prixMoyenBoeuf}, Veau=${fetchedPrices.prixMoyenVeau}, Poulet=${fetchedPrices.prixMoyenPoulet}, Agneau=${fetchedPrices.prixMoyenAgneau}, Oeuf=${fetchedPrices.prixMoyenOeuf}`);
            }
        } catch (error) {
            console.log(`⚠️ Could not fetch selling prices from ventes table:`, error.message);
        }

        // Fetch stock data: use previous date for debut (startDate-1) and endDate for fin
        const stockDebut = await getStockSoirData(formattedPreviousStartDate);
        const stockFin = await getStockSoirData(formattedEndDate);
        
        // Only require stockDebut to be successful - stockFin can be missing (future dates)
        if (!stockDebut.success) {
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des données de stock de début',
                details: {
                    stockDebut: stockDebut.success,
                    stockFin: stockFin.success,
                    stockDebutMessage: stockDebut.message,
                    stockFinMessage: stockFin.message
                }
            });
        }
        
        // Log status for debugging
        console.log(`📊 Stock data status: Début=${stockDebut.success ? 'OK' : 'FAIL'} (${formattedPreviousStartDate}), Fin=${stockFin.success ? 'OK' : 'MISSING'} (${formattedEndDate})`);
        if (!stockDebut.success) {
            console.log(`⚠️ Stock début data missing for ${formattedPreviousStartDate} (startDate-1)`);
        }
        if (!stockFin.success) {
            console.log(`⚠️ Stock fin data missing for ${formattedEndDate}, using empty data`);
        }
        
        // Use fetched prices from achats-boeuf API instead of database queries
        console.log('🔍 Using fetched prices from achats-boeuf API...');
        let dynamicPrices = {
            prixMoyenBoeuf: fetchedPrices.prixMoyenBoeuf,
            prixMoyenVeau: fetchedPrices.prixMoyenVeau,
            prixMoyenPoulet: fetchedPrices.prixMoyenPoulet, // Use calculated price from ventes table
            prixMoyenAgneau: fetchedPrices.prixMoyenAgneau, // Use calculated price from ventes table
            prixMoyenOeuf: fetchedPrices.prixMoyenOeuf      // Use calculated price from ventes table
        };
        console.log('🔍 USING FETCHED PRICES FROM ACHATS-BOEUF:', dynamicPrices);
        
        if (!dynamicPrices) {
            console.error('❌ fetchProxyMarginPrices returned null/undefined!');
            dynamicPrices = { error: 'Function returned null/undefined' };
        }
        
        // Fetch weighted purchase prices for more accurate cost calculations
        console.log('🔍 About to fetch weighted purchase prices...');
        const weightedPrices = await fetchWeightedPurchasePrices(formattedStartDate, formattedEndDate);
        
        // Merge dynamic prices with weighted purchase prices
        const enhancedDynamicPrices = {
            ...dynamicPrices,
            ...weightedPrices
        };
        
        console.log('🔍 Enhanced dynamic prices (with weighted purchase prices):', enhancedDynamicPrices);
        
        // Calculate margin using the same logic as genererCalculsMargeStockSoir
        // Use stockFin.data if available, otherwise use empty object for missing data
        const margeResult = await calculateStockSoirMarge(
            stockDebut.data,
            stockFin.success ? stockFin.data : {},
            formattedStartDate,
            formattedEndDate,
            pointVenteFilter,
            enhancedDynamicPrices,
            {
                ratioPerteBoeuf: parseFloat(ratioPerteBoeuf) || 8.0,
                ratioPerteVeau: parseFloat(ratioPerteVeau) || 8.0,
                calculAutoActif: calculAutoActif === 'true'
            }
        );
        
        res.json({
            success: true,
            stockSoirMarge: {
                ...margeResult,
                metadata: {
                    startDate: formattedStartDate,
                    endDate: formattedEndDate,
                    pointVente: pointVenteFilter,
                    timestamp: new Date().toISOString(),
                    fetchedPrices: dynamicPrices, // Add this to see what was fetched
                    weightedPrices: weightedPrices, // Add weighted prices to metadata
                    stockDataAvailable: {
                        stockDebut: stockDebut.success,
                        stockFin: stockFin.success
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Erreur API Stock Soir Marge:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message
        });
    }
});

app.get('/api/external/achats-boeuf', validateApiKey, async (req, res) => {
    try {
        const { startDate, endDate, date } = req.query;
        
        console.log('==== EXTERNAL API - ACHATS BOEUF ====');
        
        let whereConditions = {};
        
        // If a specific date is provided, use it
        if (date) {
            const formattedDate = standardiserDateFormat(date);
            console.log('Querying beef purchases for date:', formattedDate);
            whereConditions.date = formattedDate;
        } 
        // If date range is provided
        else if (startDate && endDate) {
            const formattedStartDate = standardiserDateFormat(startDate);
            const formattedEndDate = standardiserDateFormat(endDate);
            console.log('Querying beef purchases for date range:', formattedStartDate, 'to', formattedEndDate);
            whereConditions.date = {
                [Op.between]: [formattedStartDate, formattedEndDate]
            };
        }
        
        // Get all beef purchases matching the conditions
        const achats = await AchatBoeuf.findAll({
            where: whereConditions,
            order: [['date', 'DESC']],
        });
        
        // Format the data for response
        const formattedAchats = achats.map(achat => {
            const prix = parseFloat(achat.prix) || 0;
            const nbr_kg = parseFloat(achat.nbr_kg) || 0;
            const prix_achat_kg = parseFloat(achat.prix_achat_kg) || 0;
            
            // Calculate prix_achat_kg_sans_abats
            const prix_achat_kg_sans_abats = nbr_kg > 0 ? prix / nbr_kg : 0;
            
            return {
                id: achat.id,
                date: achat.date,
                mois: achat.mois,
                annee: achat.annee,
                bete: achat.bete,
                prix: prix,
                abats: parseFloat(achat.abats) || 0,
                frais_abattage: parseFloat(achat.frais_abattage) || 0,
                nbr_kg: nbr_kg,
                prix_achat_kg: prix_achat_kg,
                prix_achat_kg_sans_abats: prix_achat_kg_sans_abats,
                commentaire: achat.commentaire,
                nomClient: achat.nomClient,           // Add new field
                numeroClient: achat.numeroClient,        // Add new field
                telephoneClient: achat.telephoneClient,     // Add new field
                adresseClient: achat.adresseClient,       // Add new field
                creance: achat.creance              // Add new field
            };
        });
        
        // Helper function to calculate totals for a given array of achats
        const calculateTotals = (achatsArray) => {
            // Séparer les achats par type d'animal
            const boeufAchats = achatsArray.filter(achat => achat.bete && achat.bete.toLowerCase() === 'boeuf');
            const veauAchats = achatsArray.filter(achat => achat.bete && achat.bete.toLowerCase() === 'veau');
            
            const totals = {
                // Nombres d'animaux
                nbrBoeuf: boeufAchats.length,
                nbrVeau: veauAchats.length,
                
                // Totaux Bœuf
                totalPrixBoeuf: boeufAchats.reduce((sum, achat) => sum + (achat.prix_achat_kg * achat.nbr_kg), 0),
                totalAbatsBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.abats, 0),
                totalFraisAbattageBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.frais_abattage, 0),
                totalKgBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.nbr_kg, 0),
                
                // Totaux Veau
                totalPrixVeau: veauAchats.reduce((sum, achat) => sum + (achat.prix_achat_kg * achat.nbr_kg), 0),
                totalAbatsVeau: veauAchats.reduce((sum, achat) => sum + achat.abats, 0),
                totalFraisAbattageVeau: veauAchats.reduce((sum, achat) => sum + achat.frais_abattage, 0),
                totalKgVeau: veauAchats.reduce((sum, achat) => sum + achat.nbr_kg, 0),
                
                // Totaux généraux (pour compatibilité)
                totalPrix: achatsArray.reduce((sum, achat) => sum + achat.prix, 0),
                totalAbats: achatsArray.reduce((sum, achat) => sum + achat.abats, 0),
                totalFraisAbattage: achatsArray.reduce((sum, achat) => sum + achat.frais_abattage, 0),
                totalKg: achatsArray.reduce((sum, achat) => sum + achat.nbr_kg, 0),
            };
            
            // Calculs moyennes Bœuf
            if (boeufAchats.length > 0) {
                totals.avgPrixKgBoeuf = boeufAchats.reduce((sum, achat) => sum + achat.prix_achat_kg, 0) / boeufAchats.length;
                totals.avgPrixKgSansAbatsBoeuf = totals.avgPrixKgBoeuf;
            } else {
                totals.avgPrixKgBoeuf = 0;
                totals.avgPrixKgSansAbatsBoeuf = 0;
            }
            
            // Calculs moyennes Veau
            if (veauAchats.length > 0) {
                totals.avgPrixKgVeau = veauAchats.reduce((sum, achat) => sum + achat.prix_achat_kg, 0) / veauAchats.length;
                totals.avgPrixKgSansAbatsVeau = totals.avgPrixKgVeau;
            } else {
                totals.avgPrixKgVeau = 0;
                totals.avgPrixKgSansAbatsVeau = 0;
            }
            
            // 🚀 NOUVEAU: Calculs moyennes pondérées (plus cohérentes)
            // avgWeightedPrixKgBoeuf = Σ(prix_achat_kg × nbr_kg) / Σ(nbr_kg)
            if (totals.totalKgBoeuf > 0) {
                // Utiliser le totalPrixBoeuf déjà calculé (qui est la somme des prix_achat_kg * nbr_kg)
                totals.avgWeightedPrixKgBoeuf = totals.totalPrixBoeuf / totals.totalKgBoeuf;
                console.log(`🥩 Boeuf - Moyenne pondérée: ${totals.avgWeightedPrixKgBoeuf.toFixed(2)} FCFA/kg (vs simple: ${totals.avgPrixKgBoeuf.toFixed(2)})`);
            } else {
                totals.avgWeightedPrixKgBoeuf = 0;
            }
            
            if (totals.totalKgVeau > 0) {
                // Utiliser le totalPrixVeau déjà calculé (qui est la somme des prix_achat_kg * nbr_kg)
                totals.avgWeightedPrixKgVeau = totals.totalPrixVeau / totals.totalKgVeau;
                console.log(`🐄 Veau - Moyenne pondérée: ${totals.avgWeightedPrixKgVeau.toFixed(2)} FCFA/kg (vs simple: ${totals.avgPrixKgVeau.toFixed(2)})`);
            } else {
                totals.avgWeightedPrixKgVeau = 0;
            }
            
            // Calculs moyennes générales (pour compatibilité)
            if (totals.totalKg > 0) {
                totals.avgPrixKg = totals.totalPrix / totals.totalKg;
                totals.avgPrixKgSansAbats = totals.totalPrix / totals.totalKg;
            } else {
                totals.avgPrixKg = 0;
                totals.avgPrixKgSansAbats = 0;
            }
            
            return totals;
        };

        // Calculate totals for all data
        const totals = calculateTotals(formattedAchats);
        
        // Calculate week number (ISO week)
        const getWeekNumber = (date) => {
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
            return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
        };
        
        // Get all achats from database for week/month calculations (not filtered by date)
        const allAchats = await AchatBoeuf.findAll({
            order: [['date', 'DESC']],
        });
        
        const allFormattedAchats = allAchats.map(achat => {
            const prix = parseFloat(achat.prix) || 0;
            const nbr_kg = parseFloat(achat.nbr_kg) || 0;
            const prix_achat_kg_sans_abats = nbr_kg > 0 ? prix / nbr_kg : 0;
            
            return {
                id: achat.id,
                date: achat.date,
                mois: achat.mois,
                annee: achat.annee,
                bete: achat.bete,
                prix: prix,
                abats: parseFloat(achat.abats) || 0,
                frais_abattage: parseFloat(achat.frais_abattage) || 0,
                nbr_kg: nbr_kg,
                prix_achat_kg: parseFloat(achat.prix_achat_kg) || 0,
                prix_achat_kg_sans_abats: prix_achat_kg_sans_abats,
                commentaire: achat.commentaire,
                nomClient: achat.nomClient,
                numeroClient: achat.numeroClient,
                telephoneClient: achat.telephoneClient,
                adresseClient: achat.adresseClient,
                creance: achat.creance
            };
        });
        
        // Determine reference date for week/month calculations
        let referenceDate;
        if (date) {
            // Use the provided date
            referenceDate = new Date(standardiserDateFormat(date));
        } else if (startDate) {
            // Use start date if range is provided
            referenceDate = new Date(standardiserDateFormat(startDate));
        } else {
            // Use current date if no specific date is provided
            referenceDate = new Date();
        }
        
        const refYear = referenceDate.getFullYear();
        const refMonth = referenceDate.getMonth() + 1;
        const refWeek = getWeekNumber(referenceDate);
        
        // Filter for week (same year and week number as reference date)
        const weekAchats = allFormattedAchats.filter(achat => {
            const achatDate = new Date(achat.date);
            const achatYear = achatDate.getFullYear();
            const achatWeek = getWeekNumber(achatDate);
            return achatYear === refYear && achatWeek === refWeek;
        });
        
        // Filter for month (same year and month as reference date)
        const monthAchats = allFormattedAchats.filter(achat => {
            const achatDate = new Date(achat.date);
            const achatYear = achatDate.getFullYear();
            const achatMonth = achatDate.getMonth() + 1;
            return achatYear === refYear && achatMonth === refMonth;
        });
        
        // Calculate week and month totals
        const week = calculateTotals(weekAchats);
        const month = calculateTotals(monthAchats);
        
        console.log(`Found ${formattedAchats.length} beef purchase entries`);
        console.log('==== END EXTERNAL API - ACHATS BOEUF ====');
        
        res.json({
            success: true,
            data: {
                achats: formattedAchats,
                totals: totals,
                week: week,
                month: month
            }
        });
    } catch (error) {
        console.error('Error retrieving beef purchase data (External API):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error retrieving beef purchase data',
            error: error.message
        });
    }
});

// Aggregated API endpoint for achats-boeuf (without week/month breakdown)
app.get('/api/external/achats-boeuf/aggregated', validateApiKey, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        console.log('==== EXTERNAL API - ACHATS BOEUF AGGREGATED ====');
        
        // Validate required parameters
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'startDate and endDate are required in YYYY-MM-DD format'
            });
        }
        
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
            return res.status(400).json({
                success: false,
                message: 'Dates must be in YYYY-MM-DD format'
            });
        }
        
        console.log('Querying beef purchases for date range:', startDate, 'to', endDate);
        
        // Query database for date range
        const achats = await AchatBoeuf.findAll({
            where: {
                date: {
                    [Op.between]: [startDate, endDate]
                }
            },
            order: [['date', 'DESC']],
        });
        
        // Format the data for response
        const formattedAchats = achats.map(achat => {
            const prix = parseFloat(achat.prix) || 0;
            const nbr_kg = parseFloat(achat.nbr_kg) || 0;
            const prix_achat_kg = parseFloat(achat.prix_achat_kg) || 0;
            
            // Calculate prix_achat_kg_sans_abats
            const prix_achat_kg_sans_abats = nbr_kg > 0 ? prix / nbr_kg : 0;
            
            return {
                id: achat.id,
                date: achat.date,
                mois: achat.mois,
                annee: achat.annee,
                bete: achat.bete,
                prix: prix,
                abats: parseFloat(achat.abats) || 0,
                frais_abattage: parseFloat(achat.frais_abattage) || 0,
                nbr_kg: nbr_kg,
                prix_achat_kg: prix_achat_kg,
                prix_achat_kg_sans_abats: prix_achat_kg_sans_abats,
                commentaire: achat.commentaire,
                nomClient: achat.nomClient,
                numeroClient: achat.numeroClient,
                telephoneClient: achat.telephoneClient,
                adresseClient: achat.adresseClient,
                creance: achat.creance
            };
        });
        
        // Calculate aggregated totals
        const boeufAchats = formattedAchats.filter(achat => achat.bete && achat.bete.toLowerCase() === 'boeuf');
        const veauAchats = formattedAchats.filter(achat => achat.bete && achat.bete.toLowerCase() === 'veau');
        
        const totals = {
            // Nombres d'animaux
            nbrBoeuf: boeufAchats.length,
            nbrVeau: veauAchats.length,
            
            // Totaux Bœuf
            totalPrixBoeuf: boeufAchats.reduce((sum, achat) => sum + (achat.prix_achat_kg * achat.nbr_kg), 0),
            totalAbatsBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.abats, 0),
            totalFraisAbattageBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.frais_abattage, 0),
            totalKgBoeuf: boeufAchats.reduce((sum, achat) => sum + achat.nbr_kg, 0),
            
            // Totaux Veau
            totalPrixVeau: veauAchats.reduce((sum, achat) => sum + (achat.prix_achat_kg * achat.nbr_kg), 0),
            totalAbatsVeau: veauAchats.reduce((sum, achat) => sum + achat.abats, 0),
            totalFraisAbattageVeau: veauAchats.reduce((sum, achat) => sum + achat.frais_abattage, 0),
            totalKgVeau: veauAchats.reduce((sum, achat) => sum + achat.nbr_kg, 0),
            
            // Totaux généraux
            totalPrix: formattedAchats.reduce((sum, achat) => sum + achat.prix, 0),
            totalAbats: formattedAchats.reduce((sum, achat) => sum + achat.abats, 0),
            totalFraisAbattage: formattedAchats.reduce((sum, achat) => sum + achat.frais_abattage, 0),
            totalKg: formattedAchats.reduce((sum, achat) => sum + achat.nbr_kg, 0),
        };
        
        // Calculs moyennes Bœuf
        if (boeufAchats.length > 0) {
            totals.avgPrixKgBoeuf = boeufAchats.reduce((sum, achat) => sum + achat.prix_achat_kg, 0) / boeufAchats.length;
            totals.avgPrixKgSansAbatsBoeuf = totals.avgPrixKgBoeuf;
        } else {
            totals.avgPrixKgBoeuf = 0;
            totals.avgPrixKgSansAbatsBoeuf = 0;
        }
        
        // Calculs moyennes Veau
        if (veauAchats.length > 0) {
            totals.avgPrixKgVeau = veauAchats.reduce((sum, achat) => sum + achat.prix_achat_kg, 0) / veauAchats.length;
            totals.avgPrixKgSansAbatsVeau = totals.avgPrixKgVeau;
        } else {
            totals.avgPrixKgVeau = 0;
            totals.avgPrixKgSansAbatsVeau = 0;
        }
        
        // Calculs moyennes pondérées
        if (totals.totalKgBoeuf > 0) {
            totals.avgWeightedPrixKgBoeuf = totals.totalPrixBoeuf / totals.totalKgBoeuf;
            console.log(`🥩 Boeuf - Moyenne pondérée: ${totals.avgWeightedPrixKgBoeuf.toFixed(2)} FCFA/kg`);
        } else {
            totals.avgWeightedPrixKgBoeuf = 0;
        }
        
        if (totals.totalKgVeau > 0) {
            totals.avgWeightedPrixKgVeau = totals.totalPrixVeau / totals.totalKgVeau;
            console.log(`🐄 Veau - Moyenne pondérée: ${totals.avgWeightedPrixKgVeau.toFixed(2)} FCFA/kg`);
        } else {
            totals.avgWeightedPrixKgVeau = 0;
        }
        
        // Calculs moyennes générales
        if (totals.totalKg > 0) {
            totals.avgPrixKg = totals.totalPrix / totals.totalKg;
            totals.avgPrixKgSansAbats = totals.totalPrix / totals.totalKg;
        } else {
            totals.avgPrixKg = 0;
            totals.avgPrixKgSansAbats = 0;
        }
        
        console.log(`Found ${formattedAchats.length} beef purchase entries`);
        console.log('==== END EXTERNAL API - ACHATS BOEUF AGGREGATED ====');
        
        res.json({
            success: true,
            data: {
                achats: formattedAchats,
                totals: totals
            }
        });
    } catch (error) {
        console.error('Error retrieving aggregated beef purchase data:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error retrieving aggregated beef purchase data',
            error: error.message
        });
    }
});

// External API version for reconciliation
// ... existing code ...

// Route pour obtenir le prix moyen pondéré des ventes
app.get('/api/prix-moyen', async (req, res) => {
    try {
        const { type, date, pointVente } = req.query;

        // Validation des paramètres obligatoires
        if (!type || !date) {
            return res.status(400).json({
                success: false,
                message: 'Le type (boeuf/veau) et la date sont obligatoires'
            });
        }

        // Standardiser la date au format utilisé dans la base de données
        const dateStandardisee = standardiserDateFormat(date);

        // Définir les produits à rechercher selon le type
        const produits = type.toLowerCase() === 'boeuf' 
            ? ['Boeuf en détail', 'Boeuf en gros']
            : ['Veau en détail', 'Veau en gros'];

        // Construire la requête de base
        let query = {
            attributes: [
                'date',
                [sequelize.literal(`
                    ROUND(
                        COALESCE(
                            (SUM("nombre" * "prix_unit") / NULLIF(SUM("nombre"), 0))::numeric,
                            0
                        ),
                    2)
                `), 'prix_moyen_pondere']
            ],
            where: {
                produit: {
                    [Op.in]: produits
                },
                date: dateStandardisee
            },
            group: ['date'],
            order: [['date', 'ASC']]
        };

        // Ajouter le filtre par point de vente si spécifié
        if (pointVente) {
            query.where.point_vente = pointVente;
            query.attributes.push('point_vente');
            query.group.push('point_vente');
            query.order.push(['point_vente', 'ASC']);
        }

        const result = await Vente.findAll(query);

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Erreur lors du calcul du prix moyen:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du calcul du prix moyen',
            error: error.message
        });
    }
});

// ... existing code ...

// Test endpoint for price calculation
app.get('/api/test-prix-moyen', checkAuth, async (req, res) => {
    try {
        // Get active points of sale from DB for examples
        const { PointVente } = require('./db/models');
        const pvList = await PointVente.findAll({ where: { active: true }, limit: 2 });
        const pvNames = pvList.map(pv => pv.nom);
        
        // Sample data for testing
        const sampleData = {
            success: true,
            data: pvNames.map((pv, i) => ({
                date: new Date().toISOString().split('T')[0],
                prix_moyen_pondere: 1250.75 + (i * 50),
                point_vente: pv
            })),
            test_info: {
                endpoint: "/api/prix-moyen",
                parameters: {
                    type: "boeuf ou veau",
                    date: "YYYY-MM-DD",
                    pointVente: "optionnel"
                },
                example_requests: [
                    "/api/prix-moyen?type=boeuf&date=2025-03-27",
                    pvNames[0] ? `/api/prix-moyen?type=veau&date=2025-03-27&pointVente=${pvNames[0]}` : null
                ].filter(Boolean)
            }
        };

        res.json(sampleData);
    } catch (error) {
        console.error('Erreur lors du test du prix moyen:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du test du prix moyen',
            error: error.message
        });
    }
});

// External API for Analytics (Proxy Marges)
app.get('/api/external/analytics', validateApiKey, async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            pointVente, 
            prixAchatAgneau, 
            prixAchatPoulet, 
            prixAchatOeuf,
            ratioPerteAgneau,
            boeufPackAchat,
            veauPackAchat,
            agneauPackAchat,
            pouletPackAchat,
            oeufPackAchat
        } = req.query;
        
        // Parse ratio agneau (défaut : 0 = pas de perte)
        // Si fourni en pourcentage, convertir en décimal (ex: -5 → -0.05)
        const ratioAgneau = ratioPerteAgneau ? parseFloat(ratioPerteAgneau) / 100 : 0;
        
        console.log('==== EXTERNAL API - ANALYTICS ====');
        console.log('Request params:', { 
            startDate, 
            endDate, 
            pointVente, 
            prixAchatAgneau, 
            prixAchatPoulet, 
            prixAchatOeuf,
            ratioPerteAgneau,
            ratioAgneau,
            boeufPackAchat,
            veauPackAchat,
            agneauPackAchat,
            pouletPackAchat,
            oeufPackAchat
        });
        
        // Helper function to normalize date formats
        const normalizeDate = (dateStr) => {
            if (!dateStr) return null;
            
            // Handle different date formats
            if (dateStr.includes('/')) {
                // DD/MM/YYYY format
                return dateStr;
            } else if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts[0].length === 4) {
                    // YYYY-MM-DD to DD/MM/YYYY
                    return `${parts[2]}/${parts[1]}/${parts[0]}`;
                } else {
                    // DD-MM-YYYY to DD/MM/YYYY
                    return dateStr.replace(/-/g, '/');
                }
            }
            return dateStr;
        };
        
        // Helper function to get first day of current month
        const getFirstDayOfMonth = () => {
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const day = firstDay.getDate().toString().padStart(2, '0');
            const month = (firstDay.getMonth() + 1).toString().padStart(2, '0');
            const year = firstDay.getFullYear();
            return `${day}/${month}/${year}`;
        };
        
        // Helper function to get yesterday
        const getYesterday = () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const day = yesterday.getDate().toString().padStart(2, '0');
            const month = (yesterday.getMonth() + 1).toString().padStart(2, '0');
            const year = yesterday.getFullYear();
            return `${day}/${month}/${year}`;
        };
        
        // Helper function to get today
        const getToday = () => {
            const today = new Date();
            const day = today.getDate().toString().padStart(2, '0');
            const month = (today.getMonth() + 1).toString().padStart(2, '0');
            const year = today.getFullYear();
            return `${day}/${month}/${year}`;
        };
        
        // Helper function to check if today is the first day of the month
        const isFirstDayOfMonth = () => {
            const today = new Date();
            return today.getDate() === 1;
        };
        
        // Set default dates if not provided
        // Special case: if no dates provided AND today is the 1st of the month → use only today
        let finalStartDate, finalEndDate;
        
        if (!startDate && !endDate && isFirstDayOfMonth()) {
            // Premier jour du mois sans arguments → utiliser seulement aujourd'hui
            finalStartDate = getToday();
            finalEndDate = getToday();
            console.log(`🗓️  Premier jour du mois détecté - période limitée à aujourd'hui uniquement`);
        } else {
            // Comportement normal
            finalStartDate = startDate ? normalizeDate(startDate) : getFirstDayOfMonth();
            finalEndDate = endDate ? normalizeDate(endDate) : getYesterday();
        }
        
        console.log(`📅 Final dates: ${finalStartDate} to ${finalEndDate}`);
        
        // Get active points of sale (excluding Abattage) from database
        const pointsVenteData = await configService.getPointsVenteAsLegacy();
        const activePointsVente = Object.entries(pointsVenteData)
            .filter(([name, properties]) => properties.active && name !== 'Abattage')
            .map(([name, _]) => name);
        
        console.log(`🏪 Active points of sale (excluding Abattage):`, activePointsVente);
        
        // Determine which points of sale to process
        let pointsToProcess = [];
        if (pointVente && pointVente !== 'Sélectionner un point de vente') {
            // Single point of sale
            if (activePointsVente.includes(pointVente)) {
                pointsToProcess = [pointVente];
            } else {
                return res.status(400).json({
                    success: false,
                    message: `Point de vente '${pointVente}' non trouvé ou inactif`
                });
            }
        } else {
            // All active points of sale
            pointsToProcess = activePointsVente;
        }
        
        console.log(`🎯 Points to process:`, pointsToProcess);
        
        // Initialize result structure
        const result = {
            success: true,
            data: {
                metadata: {
                    startDate: finalStartDate,
                    endDate: finalEndDate,
                    generatedAt: new Date().toISOString()
                },
                analytics: {
                    pointVente: pointVente && pointVente !== 'Sélectionner un point de vente' ? pointVente : 'Tous',
                    proxyMarges: {},
                    totauxGeneraux: {
                        totalChiffreAffaires: 0,
                        totalCout: 0,
                        totalMarge: 0,
                        totalChiffreAffairesSansStockSoir: 0,
                        totalCoutSansStockSoir: 0,
                        totalMargeSansStockSoir: 0
                    }
                }
            }
        };
        
        // Process each point of sale
        for (const pv of pointsToProcess) {
            console.log(`🔄 Processing point of sale: ${pv}`);
            
            try {
                // Call our new function that queries the database directly
                const proxyMargesData = await getProxyMargesViaAPI(
                    finalStartDate, 
                    finalEndDate, 
                    pv, 
                    prixAchatAgneau, 
                    prixAchatPoulet, 
                    prixAchatOeuf,
                    boeufPackAchat,
                    veauPackAchat,
                    agneauPackAchat,
                    pouletPackAchat,
                    oeufPackAchat,
                    ratioAgneau
                );
                
                if (!proxyMargesData) {
                    console.error(`❌ Failed to get proxy marges data for ${pv}`);
                    continue;
                }
                
                result.data.analytics.proxyMarges[pv] = proxyMargesData;
                
                // Add to general totals (with Stock Soir)
                result.data.analytics.totauxGeneraux.totalChiffreAffaires += proxyMargesData.totaux.totalChiffreAffaires;
                result.data.analytics.totauxGeneraux.totalCout += proxyMargesData.totaux.totalCout;
                result.data.analytics.totauxGeneraux.totalMarge += proxyMargesData.totaux.totalMarge;
                
                // Add to general totals (sans Stock Soir)
                result.data.analytics.totauxGeneraux.totalChiffreAffairesSansStockSoir += proxyMargesData.totaux.totalChiffreAffairesSansStockSoir;
                result.data.analytics.totauxGeneraux.totalCoutSansStockSoir += proxyMargesData.totaux.totalCoutSansStockSoir;
                result.data.analytics.totauxGeneraux.totalMargeSansStockSoir += proxyMargesData.totaux.totalMargeSansStockSoir;
                
                console.log(`✅ Successfully processed ${pv}: CA=${proxyMargesData.totaux.totalChiffreAffaires}, CA sans stock=${proxyMargesData.totaux.totalChiffreAffairesSansStockSoir}`);
                
            } catch (error) {
                console.error(`❌ Error processing point of sale ${pv}:`, error);
                // Continue with other points of sale
            }
        }
        
        console.log(`✅ Analytics API completed for ${pointsToProcess.length} point(s) of sale`);
        
        // Add debug info to response for testing
        result.debug = {
            pointsToProcess: pointsToProcess,
            processedCount: Object.keys(result.data.analytics.proxyMarges).length,
            hasData: Object.keys(result.data.analytics.proxyMarges).length > 0,
            proxyMargesKeys: Object.keys(result.data.analytics.proxyMarges)
        };
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Error in analytics API:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du calcul des analytics',
            error: error.message
        });
    }
});

// Helper function to retry achats-boeuf API call with decremented startDate until data is found
async function fetchAchatsBoeufWithRetry(initialStartDate, endDate, maxRetries = 30) {
    const baseUrl = process.env.NODE_ENV === 'production' 
        ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
        : 'http://localhost:3000';
    
    // Helper to decrement date by N days
    const decrementDate = (dateStr, days) => {
        const parts = dateStr.split('-');
        let date;
        
        if (parts[0].length === 4) {
            // YYYY-MM-DD
            date = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
            // DD-MM-YYYY
            date = new Date(parts[2], parts[1] - 1, parts[0]);
        }
        
        date.setDate(date.getDate() - days);
        
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        
        return `${day}-${month}-${year}`;
    };
    
    let currentStartDate = initialStartDate;
    let attempts = 0;
    
    while (attempts < maxRetries) {
        attempts++;
        
        const achatsUrl = `${baseUrl}/api/external/achats-boeuf?startDate=${currentStartDate}&endDate=${endDate}`;
        console.log(`🔄 Attempt ${attempts}: Calling achats-boeuf API with startDate=${currentStartDate}`);
        
        try {
            const achatsResponse = await fetch(achatsUrl, {
                method: 'GET',
                headers: {
                    'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4',
                    'Content-Type': 'application/json'
                }
            });
            
            if (achatsResponse.ok) {
                const achatsResult = await achatsResponse.json();
                
                if (achatsResult.success && achatsResult.data) {
                    const totalsData = achatsResult.data.totals || {};
                    const avgPrixKgBoeuf = totalsData.avgWeightedPrixKgBoeuf;
                    const avgPrixKgVeau = totalsData.avgWeightedPrixKgVeau;
                    
                    // Check if we have at least one valid price
                    if (avgPrixKgBoeuf > 0 || avgPrixKgVeau > 0) {
                        console.log(`✅ Found purchase data on attempt ${attempts} with startDate=${currentStartDate}`);
                        console.log(`   - Prix Boeuf: ${avgPrixKgBoeuf}, Prix Veau: ${avgPrixKgVeau}`);
                        
                        return {
                            success: true,
                            avgPrixKgBoeuf: avgPrixKgBoeuf ? Math.round(avgPrixKgBoeuf) : null,
                            avgPrixKgVeau: avgPrixKgVeau ? Math.round(avgPrixKgVeau) : null,
                            effectiveStartDate: currentStartDate,
                            attempts: attempts
                        };
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Error on attempt ${attempts}:`, error.message);
        }
        
        // No data found, shift startDate -1 day and retry
        currentStartDate = decrementDate(currentStartDate, 1);
        console.log(`   → No data found, retrying with startDate=${currentStartDate}`);
    }
    
    console.warn(`⚠️ No purchase data found after ${maxRetries} attempts`);
    return {
        success: false,
        avgPrixKgBoeuf: null,
        avgPrixKgVeau: null,
        effectiveStartDate: null,
        attempts: maxRetries
    };
}

// NEW: Helper function to get proxy marges by calling the existing stock-soir-marge API
async function getProxyMargesViaAPI(startDate, endDate, pointVente, prixAchatAgneau = 4000, prixAchatPoulet = 2600, prixAchatOeuf = 2200, boeufPackAchat, veauPackAchat, agneauPackAchat, pouletPackAchat, oeufPackAchat, ratioAgneau = 0) {
    try {
        console.log(`🚀 NOUVELLE FONCTION: getProxyMargesViaAPI pour ${pointVente} from ${startDate} to ${endDate}`);
        
            // Convert dates from DD/MM/YYYY to DD-MM-YYYY format for VARCHAR comparison
            const convertToDDMMYYYY = (dateStr) => {
                return dateStr.replace(/\//g, '-');
            };
            
            const startDDMMYYYY = convertToDDMMYYYY(startDate);
            const endDDMMYYYY = convertToDDMMYYYY(endDate);
            
            console.log(`🔍 Date conversion: ${startDate} -> ${startDDMMYYYY}, ${endDate} -> ${endDDMMYYYY}`);
        
        // Query sales data directly from the database instead of using stock-soir-marge API
        const { Pool } = require('pg');
        
        // Use DATABASE_URL in PROD (Render.com) or individual vars in local dev
        const pool = process.env.DATABASE_URL 
            ? new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
              })
            : new Pool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 5432,
                user: process.env.DB_USER || 'postgres', 
                password: process.env.DB_PASSWORD || 'password',
                database: process.env.DB_NAME || 'matix_db'
              });
        
        try {
            // STEP 1: Get reconciliation data to calculate ratios (Mode SPÉCIFIQUE)
            console.log(`🔍 Getting reconciliation data for ratios calculation...`);
            
            const baseUrl = process.env.NODE_ENV === 'production' 
                ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
                : 'http://localhost:3000';
            const reconciliationUrl = `${baseUrl}/api/external/reconciliation/aggregated?startDate=${startDate}&endDate=${endDate}&pointVente=${encodeURIComponent(pointVente)}`;
            console.log(`🔍 Calling reconciliation API: ${reconciliationUrl}`);
            
            const reconciliationResponse = await fetch(reconciliationUrl, {
                method: 'GET',
                headers: {
                    'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4',
                    'Content-Type': 'application/json'
                }
            });
            
            let ratios = {};
            let reconciliationData = null; // Declare outside to make it accessible later
            if (reconciliationResponse.ok) {
                reconciliationData = await reconciliationResponse.json();
                console.log(`🔍 Reconciliation data received:`, reconciliationData.success);
                
                if (reconciliationData.success && reconciliationData.data.details[pointVente]) {
                    const pointData = reconciliationData.data.details[pointVente];
                    
                    // Calculate ratios for Boeuf, Veau and Agneau
                    if (pointData.Boeuf) {
                        const ventesNombre = parseFloat(pointData.Boeuf.ventesNombre) || 0;
                        const ventesTheoriquesNombre = parseFloat(pointData.Boeuf.ventesTheoriquesNombre) || 0;
                        
                        if (ventesTheoriquesNombre !== 0) {
                            ratios.boeuf = (ventesNombre / ventesTheoriquesNombre) - 1;
                            console.log(`🔍 Boeuf ratio calculated: ${ratios.boeuf * 100}%`);
                        }
                    }
                    
                    if (pointData.Veau) {
                        const ventesNombre = parseFloat(pointData.Veau.ventesNombre) || 0;
                        const ventesTheoriquesNombre = parseFloat(pointData.Veau.ventesTheoriquesNombre) || 0;
                        
                        if (ventesTheoriquesNombre !== 0) {
                            ratios.veau = (ventesNombre / ventesTheoriquesNombre) - 1;
                            console.log(`🔍 Veau ratio calculated: ${ratios.veau * 100}%`);
                        }
                    }
                    
                    if (pointData.Agneau) {
                        const ventesNombre = parseFloat(pointData.Agneau.ventesNombre) || 0;
                        const ventesTheoriquesNombre = parseFloat(pointData.Agneau.ventesTheoriquesNombre) || 0;
                        
                        if (ventesTheoriquesNombre !== 0) {
                            ratios.agneau = (ventesNombre / ventesTheoriquesNombre) - 1;
                            console.log(`🔍 Agneau ratio calculated from reconciliation: ${ratios.agneau * 100}%`);
                        } else {
                            // Fallback: use parameter if no reconciliation data
                            ratios.agneau = ratioAgneau;
                            console.log(`🔍 Agneau ratio from parameter (no reconciliation): ${ratios.agneau * 100}%`);
                        }
                    } else {
                        // Fallback: use parameter if Agneau not in reconciliation data
                        ratios.agneau = ratioAgneau;
                        console.log(`🔍 Agneau ratio from parameter (not tracked): ${ratios.agneau * 100}%`);
                    }
                }
            } else {
                console.error(`❌ Reconciliation API call failed: ${reconciliationResponse.status}`);
            }
            
            console.log(`🔍 Final ratios:`, ratios);
            
            // STEP 2: Get stock soir data from existing API
            console.log(`🔍 Getting stock soir data from existing API...`);
            let stockSoirData = {
                montantTotal: 0,
                nombreItems: 0,
                variation: {
                    debut: startDate,
                    fin: endDate,
                    valeurDebut: 0,
                    valeurFin: 0
                },
                chiffreAffaires: 0,
                cout: 0,
                marge: 0
            };
            
            try {
                // No need to adjust startDate - stock-soir-marge API handles the shift internally
                const adjustedStartDate = startDate;
                // Get purchase prices from achats-boeuf API to pass to stock-soir-marge
                let boeufPrice = 3400; // Default fallback
                let veauPrice = 3500;  // Default fallback
                
                try {
                    const baseUrlAchats = process.env.NODE_ENV === 'production' 
                        ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
                        : 'http://localhost:3000';
                    const achatsUrl = `${baseUrlAchats}/api/external/achats-boeuf?startDate=${startDate}&endDate=${endDate}`;
                    const achatsResponse = await fetch(achatsUrl, {
                        method: 'GET',
                        headers: {
                            'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4',
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (achatsResponse.ok) {
                        const achatsResult = await achatsResponse.json();
                        if (achatsResult.success && achatsResult.data && achatsResult.data.totals) {
                            boeufPrice = Math.round(achatsResult.data.totals.avgPrixKgBoeuf || 3400);
                            veauPrice = Math.round(achatsResult.data.totals.avgPrixKgVeau || 3500);
                            console.log(`✅ Purchase prices from achats-boeuf: Boeuf=${boeufPrice}, Veau=${veauPrice}`);
                        }
                    }
                } catch (error) {
                    console.log(`⚠️ Could not fetch prices from achats-boeuf, using defaults: Boeuf=${boeufPrice}, Veau=${veauPrice}`);
                }
                
                const baseUrlStock = process.env.NODE_ENV === 'production' 
                    ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
                    : 'http://localhost:3000';
                const stockSoirUrl = `${baseUrlStock}/api/external/stock-soir-marge?startDate=${adjustedStartDate}&endDate=${endDate}&pointVente=${encodeURIComponent(pointVente)}&prixMoyenBoeuf=${boeufPrice}&prixMoyenVeau=${veauPrice}`;
                console.log(`🔍 Calling stock-soir-marge API with adjusted start date and correct prices: ${stockSoirUrl}`);
                console.log(`🔍 Original startDate: ${startDate}, Adjusted startDate: ${adjustedStartDate}`);
                
                const stockSoirResponse = await fetch(stockSoirUrl, {
                    method: 'GET',
                    headers: {
                        'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4',
                        'Content-Type': 'application/json'
                    }
                });
                
                if (stockSoirResponse.ok) {
                    const stockSoirResult = await stockSoirResponse.json();
                    console.log(`🔍 Stock soir API response received:`, stockSoirResult.success);
                    
                    if (stockSoirResult.success && stockSoirResult.stockSoirMarge) {
                        const data = stockSoirResult.stockSoirMarge;
                        
                        // Extract stock soir data from the response
                        // The stock-soir-marge API returns data in stockSoirMarge object
                        stockSoirData = {
                            montantTotal: data.totalCA || 0,
                            nombreItems: data.nombreProduits || 0,
                            variation: {
                                debut: startDate,
                                fin: endDate,
                                valeurDebut: 0, // We don't have start stock value from this API
                                valeurFin: 0    // We don't have end stock value from this API
                            },
                            chiffreAffaires: data.totalCA || 0,
                            cout: data.totalCout || 0,
                            marge: data.marge || 0
                        };
                        
                        console.log(`✅ Stock soir data extracted from API:`, {
                            totalCA: data.totalCA,
                            totalCout: data.totalCout,
                            marge: data.marge,
                            nombreProduits: data.nombreProduits
                        });
                        
                        console.log(`✅ Stock soir data extracted:`, stockSoirData);
                    }
                } else {
                    console.error(`❌ Stock soir API call failed: ${stockSoirResponse.status}`);
                }
            } catch (error) {
                console.error(`❌ Error calling stock soir API:`, error);
            }
            
            // STEP 3: Get purchase prices from achats-boeuf API with retry logic
            console.log(`🔍 Getting purchase prices from achats-boeuf API with retry logic...`);
            let purchasePrices = {
                avgPrixKgBoeuf: null, // Will be set from achats-boeuf API
                avgPrixKgVeau: null,  // Will be set from achats-boeuf API
                prixAchatAgneau: prixAchatAgneau, // From API parameters
                prixAchatPoulet: prixAchatPoulet, // From API parameters
                prixAchatOeuf: prixAchatOeuf      // From API parameters
            };
            
            let achatsBoeufDebugInfo = {
                requestedStartDate: startDate,
                effectiveStartDate: null,
                attemptsRequired: 0,
                prixBoeufUtilise: null,
                prixVeauUtilise: null,
                comment: null
            };
            
            try {
                // Use the retry function to get purchase prices
                const achatsResult = await fetchAchatsBoeufWithRetry(startDate, endDate, 30);
                
                if (achatsResult.success) {
                    purchasePrices.avgPrixKgBoeuf = achatsResult.avgPrixKgBoeuf;
                    // Si le prix du veau est null, utiliser le prix du bœuf
                    purchasePrices.avgPrixKgVeau = achatsResult.avgPrixKgVeau || achatsResult.avgPrixKgBoeuf;
                    
                    achatsBoeufDebugInfo.effectiveStartDate = achatsResult.effectiveStartDate;
                    achatsBoeufDebugInfo.attemptsRequired = achatsResult.attempts;
                    achatsBoeufDebugInfo.prixBoeufUtilise = achatsResult.avgPrixKgBoeuf;
                    // Indiquer si on a utilisé le prix bœuf comme fallback pour le veau
                    achatsBoeufDebugInfo.prixVeauUtilise = achatsResult.avgPrixKgVeau || achatsResult.avgPrixKgBoeuf;
                    
                    // Construire le commentaire avec les informations de fallback
                    let commentParts = [];
                    
                    if (achatsResult.effectiveStartDate !== startDate) {
                        commentParts.push(`Aucune donnée trouvée pour la période initiale. Données trouvées à partir du ${achatsResult.effectiveStartDate} après ${achatsResult.attempts} tentative(s).`);
                    } else {
                        commentParts.push(`Données trouvées pour la période demandée.`);
                    }
                    
                    // Ajouter une note si le prix veau utilise le prix bœuf comme fallback
                    if (!achatsResult.avgPrixKgVeau && achatsResult.avgPrixKgBoeuf) {
                        commentParts.push(`Prix veau non disponible, prix bœuf utilisé comme fallback.`);
                    }
                    
                    achatsBoeufDebugInfo.comment = commentParts.join(' ');
                    
                    console.log(`✅ Purchase prices obtained:`, purchasePrices);
                    console.log(`📅 Effective start date: ${achatsResult.effectiveStartDate} (${achatsResult.attempts} attempt(s))`);
                } else {
                    achatsBoeufDebugInfo.comment = `Aucune donnée d'achat trouvée après ${achatsResult.attempts} tentatives. Prix par défaut utilisés.`;
                    console.warn(`⚠️ No purchase prices found after retry. Using defaults if available.`);
                }
            } catch (error) {
                console.error(`❌ Error calling achats API with retry:`, error);
                achatsBoeufDebugInfo.comment = `Erreur lors de la récupération des prix d'achat: ${error.message}`;
            }
            
            // STEP 4: Get pack composition data for accurate margin calculation
            console.log(`🔍 Getting pack composition data from API for accurate margin calculation...`);
            let packCostData = {
                montantInformatif: 0,
                montantTotal: 0,
                margeAbsolue: 0,
                margePourcentage: 0
            };
            
            try {
                const baseUrlPack = process.env.NODE_ENV === 'production' 
                    ? (process.env.BASE_URL || 'https://keur-bali.onrender.com')
                    : 'http://localhost:3000';
                
                // Convert dates from DD/MM/YYYY to YYYY-MM-DD for pack API
                const convertToYYYYMMDD = (dateStr) => {
                    const [day, month, year] = dateStr.split('/');
                    return `${year}-${month}-${day}`;
                };
                
                const packStartDate = convertToYYYYMMDD(startDate);
                const packEndDate = convertToYYYYMMDD(endDate);
                
                // Build pack API URL with optional purchase price parameters
                let packApiUrl = `${baseUrlPack}/api/external/ventes-date/pack/aggregated?start_date=${packStartDate}&end_date=${packEndDate}&pointVente=${encodeURIComponent(pointVente)}`;
                
                // Add optional pack purchase prices if provided
                if (boeufPackAchat) packApiUrl += `&boeufPackAchat=${boeufPackAchat}`;
                if (veauPackAchat) packApiUrl += `&veauPackAchat=${veauPackAchat}`;
                if (agneauPackAchat) packApiUrl += `&agneauPackAchat=${agneauPackAchat}`;
                if (pouletPackAchat) packApiUrl += `&pouletPackAchat=${pouletPackAchat}`;
                if (oeufPackAchat) packApiUrl += `&oeufPackAchat=${oeufPackAchat}`;
                
                console.log(`🔍 Calling pack API: ${packApiUrl}`);
                
                const packResponse = await fetch(packApiUrl, {
                    method: 'GET',
                    headers: {
                        'X-API-Key': 'b9463219d81f727b8c1c9dc52f622cf054eb155e49b37aad98da68ee09677be4',
                        'Content-Type': 'application/json'
                    }
                });
                
                if (packResponse.ok) {
                    const packResult = await packResponse.json();
                    console.log(`🔍 Pack API response received:`, packResult.success);
                    
                    if (packResult.success && packResult.pointsVente && packResult.pointsVente[pointVente]) {
                        const pvPackData = packResult.pointsVente[pointVente];
                        packCostData = {
                            montantInformatif: pvPackData.montantInformatif || 0,
                            montantTotal: pvPackData.montantTotal || 0,
                            margeAbsolue: pvPackData.margeAbsolue || 0,
                            margePourcentage: pvPackData.margePourcentage || 0
                        };
                        
                        console.log(`✅ Pack cost data extracted:`, {
                            montantInformatif: packCostData.montantInformatif,
                            montantTotal: packCostData.montantTotal,
                            margeAbsolue: packCostData.margeAbsolue,
                            margePourcentage: packCostData.margePourcentage
                        });
                    } else {
                        console.log(`⚠️ No pack data found for ${pointVente}, using default (marge = 0)`);
                    }
                } else {
                    console.error(`❌ Pack API call failed: ${packResponse.status}`);
                }
            } catch (error) {
                console.error(`❌ Error calling pack API:`, error.message);
            }
            
            // STEP 5: Get sales data for prices and quantities (filtered by exact dates using TO_DATE)
            console.log(`🔍 Getting sales data for ${pointVente} from ${startDDMMYYYY} to ${endDDMMYYYY} using TO_DATE`);
            
            const salesQuery = `
                SELECT 
                    produit,
                    SUM(nombre) as quantite_totale,
                    ROUND(SUM(prix_unit * nombre)) as chiffre_affaires,
                    ROUND(AVG(prix_unit)) as prix_moyen
                FROM ventes 
                WHERE point_vente = '${pointVente}'
                AND (
                    -- Format DD-MM-YYYY (ancien format)
                    (date ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$' 
                     AND TO_DATE(date, 'DD-MM-YYYY') >= TO_DATE('${startDDMMYYYY}', 'DD-MM-YYYY')
                     AND TO_DATE(date, 'DD-MM-YYYY') <= TO_DATE('${endDDMMYYYY}', 'DD-MM-YYYY'))
                    OR
                    -- Format YYYY-MM-DD (nouveau format)
                    (date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
                     AND TO_DATE(date, 'YYYY-MM-DD') >= TO_DATE('${startDDMMYYYY.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1')}', 'YYYY-MM-DD')
                     AND TO_DATE(date, 'YYYY-MM-DD') <= TO_DATE('${endDDMMYYYY.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1')}', 'YYYY-MM-DD'))
                )
                GROUP BY produit
                ORDER BY chiffre_affaires DESC
            `;
            
            const salesResult = await pool.query(salesQuery);
            console.log(`🔍 Found ${salesResult.rows.length} products for ${pointVente} using TO_DATE filtering`);
            
            // Debug: Log all products found
            console.log(`🔍 Products found:`, salesResult.rows.map(row => `${row.produit}: ${row.quantite_totale} units, ${row.chiffre_affaires} FCFA`));
            
            // Debug: Log divers products specifically
            const diversProductsDebug = salesResult.rows.filter(row => 
                row.produit.toLowerCase().includes('sans os') ||
                row.produit.toLowerCase().includes('foie') ||
                row.produit.toLowerCase().includes('peaux') ||
                row.produit.toLowerCase().includes('jarret') ||
                row.produit.toLowerCase().includes('yell') ||
                row.produit.toLowerCase().includes('dechet') ||
                row.produit.toLowerCase().includes('déchet') ||
                row.produit.toLowerCase().includes('viande hachée') ||
                row.produit.toLowerCase().includes('viande hachee') ||
                row.produit.toLowerCase().includes('tete agneau') ||
                row.produit.toLowerCase().includes('tête agneau')
            );
            console.log(`🔍 DIVERS PRODUCTS DEBUG:`, diversProductsDebug.map(p => `${p.produit}: ${p.quantite_totale} units, ${p.chiffre_affaires} FCFA`));
            
            // Calculate totals for the exact date range using TO_DATE
            const totalQuery = `
                SELECT 
                    SUM(nombre) as quantite_totale,
                    ROUND(SUM(prix_unit * nombre)) as chiffre_affaires_total
                FROM ventes 
                WHERE point_vente = '${pointVente}'
                AND (
                    -- Format DD-MM-YYYY (ancien format)
                    (date ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$' 
                     AND TO_DATE(date, 'DD-MM-YYYY') >= TO_DATE('${startDDMMYYYY}', 'DD-MM-YYYY')
                     AND TO_DATE(date, 'DD-MM-YYYY') <= TO_DATE('${endDDMMYYYY}', 'DD-MM-YYYY'))
                    OR
                    -- Format YYYY-MM-DD (nouveau format)
                    (date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
                     AND TO_DATE(date, 'YYYY-MM-DD') >= TO_DATE('${startDDMMYYYY.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1')}', 'YYYY-MM-DD')
                     AND TO_DATE(date, 'YYYY-MM-DD') <= TO_DATE('${endDDMMYYYY.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1')}', 'YYYY-MM-DD'))
                )
            `;
            
            const totalResult = await pool.query(totalQuery);
            const totalCA = totalResult.rows[0].chiffre_affaires_total || 0;
            const totalQuantite = totalResult.rows[0].quantite_totale || 0;
            
                // Format the result according to the exact logic from the screenshot (Mode SPÉCIFIQUE)
                // Using ratios to calculate quantities abattues and prices
                const agneauData = formatProductFromSalesWithRatios(salesResult.rows, 'agneau', ratios.agneau || 0, null, purchasePrices);
                const boeufData = formatProductFromSalesWithRatios(salesResult.rows, 'boeuf', ratios.boeuf || 0, null, purchasePrices);
                const veauData = formatProductFromSalesWithRatios(salesResult.rows, 'veau', ratios.veau || 0, null, purchasePrices);
                const pouletData = formatProductFromSalesWithRatios(salesResult.rows, 'poulet', 0, null, purchasePrices); // No ratio for poulet
                const oeufData = formatProductFromSalesWithRatios(salesResult.rows, 'oeuf', 0, null, purchasePrices);     // No ratio for oeuf
                const packsData = formatProductFromSalesWithRatios(salesResult.rows, 'pack', 0, 'packs', purchasePrices, packCostData);
                const surPiedsData = formatProductFromSalesWithRatios(salesResult.rows, 'sur pieds', 0, 'sur pieds', purchasePrices);
                const diversData = formatProductFromSalesWithRatios(salesResult.rows, 'divers', 0, 'divers', purchasePrices);
                const autreData = formatProductFromSalesWithRatios(salesResult.rows, 'autre', 0, 'autre', purchasePrices);
                
                // ========== AJUSTEMENT RECLASSIFICATION BOEUF → VEAU ==========
                // Gérer le cas où du bœuf est vendu comme veau
                // Détection : veau vendu > veau théorique (écart négatif)
                if (veauData.quantiteVendue > 0 && reconciliationData.success && reconciliationData.data.details[pointVente]) {
                    const pointData = reconciliationData.data.details[pointVente];
                    
                    if (pointData.Veau) {
                        const ventesReellesVeau = parseFloat(pointData.Veau.ventesNombre) || 0;
                        const ventesTheoriquesVeau = parseFloat(pointData.Veau.ventesTheoriquesNombre) || 0;
                        const ecartVeau = parseFloat(pointData.Veau.ecartNombre) || 0;
                        
                        // Si écart négatif = ventes > théorique = veau venu du bœuf
                        const veauDepuisBoeuf = ecartVeau < 0 ? Math.abs(ecartVeau) : 0;
                        
                        if (veauDepuisBoeuf > 0) {
                            console.log(`🔄 ${pointVente}: Reclassification Bœuf → Veau détectée: ${veauDepuisBoeuf} kg`);
                            console.log(`   📊 Ventes veau: ${ventesReellesVeau} kg, Théorique veau: ${ventesTheoriquesVeau} kg, Écart: ${ecartVeau} kg`);
                            
                            // ========== AJUSTEMENT BOEUF ==========
                            if (boeufData.quantiteAbattue > 0) {
                                const ancienneQteAbattueBoeuf = boeufData.quantiteAbattue;
                                const ancienRatioBoeuf = boeufData.ratioPerte;
                                
                                // Réduire la quantité abattue bœuf
                                boeufData.quantiteAbattue -= veauDepuisBoeuf;
                                
                                // Recalculer ratio bœuf
                                if (boeufData.quantiteAbattue > 0) {
                                    boeufData.ratioPerte = ((boeufData.quantiteVendue / boeufData.quantiteAbattue) - 1) * 100;
                                }
                                
                                // Recalculer coût bœuf
                                boeufData.cout = Math.round(boeufData.quantiteAbattue * purchasePrices.avgPrixKgBoeuf);
                                boeufData.marge = boeufData.chiffreAffaires - boeufData.cout;
                                
                                console.log(`   📉 Bœuf ajusté: ${ancienneQteAbattueBoeuf.toFixed(2)} kg → ${boeufData.quantiteAbattue.toFixed(2)} kg`);
                                console.log(`   📉 Ratio bœuf: ${ancienRatioBoeuf.toFixed(2)}% → ${boeufData.ratioPerte.toFixed(2)}%`);
                                console.log(`   📉 Coût bœuf: ${Math.round(ancienneQteAbattueBoeuf * purchasePrices.avgPrixKgBoeuf)} → ${boeufData.cout} FCFA`);
                            }
                            
                            // ========== AJUSTEMENT VEAU (CAS MIXTE) ==========
                            const veauPur = ventesTheoriquesVeau; // Veau provenant du stock/transfert veau
                            const ratioVeauPur = ratios.veau || 0;
                            
                            // Quantité abattue veau pur (avec son propre ratio)
                            const qteAbattueVeauPur = veauPur > 0 && (1 + ratioVeauPur) !== 0
                                ? veauPur / (1 + ratioVeauPur)
                                : veauPur;
                            
                            // Quantité totale abattue = veau pur + veau du bœuf
                            veauData.quantiteAbattue = qteAbattueVeauPur + veauDepuisBoeuf;
                            
                            // Coût mixte = (coût veau pur) + (coût veau du bœuf)
                            const prixVeauUtilise = purchasePrices.avgPrixKgVeau || purchasePrices.avgPrixKgBoeuf;
                            const coutVeauPur = Math.round(qteAbattueVeauPur * prixVeauUtilise);
                            const coutVeauDepuisBoeuf = Math.round(veauDepuisBoeuf * purchasePrices.avgPrixKgBoeuf);
                            veauData.cout = coutVeauPur + coutVeauDepuisBoeuf;
                            
                            // Marge
                            veauData.marge = veauData.chiffreAffaires - veauData.cout;
                            
                            // Ratio veau global (recalculé sur le total)
                            if (veauData.quantiteAbattue > 0) {
                                veauData.ratioPerte = ((ventesReellesVeau / veauData.quantiteAbattue) - 1) * 100;
                            }
                            
                            console.log(`   📈 Veau pur: ${veauPur.toFixed(2)} kg (ratio: ${(ratioVeauPur * 100).toFixed(2)}%)`);
                            console.log(`   📈 Veau du bœuf: ${veauDepuisBoeuf.toFixed(2)} kg`);
                            console.log(`   📈 Veau total abattu: ${veauData.quantiteAbattue.toFixed(2)} kg`);
                            console.log(`   📈 Coût veau pur: ${coutVeauPur} FCFA, Coût veau du bœuf: ${coutVeauDepuisBoeuf} FCFA`);
                            console.log(`   📈 Coût total veau: ${veauData.cout} FCFA, Marge: ${veauData.marge} FCFA`);
                            console.log(`   📈 Ratio veau global: ${veauData.ratioPerte.toFixed(2)}%`);
                        }
                    }
                }
                // ========== FIN AJUSTEMENT RECLASSIFICATION ==========
                
                // Calculate totals INCLUDING stockSoir (original behavior)
                const totalChiffreAffaires = agneauData.chiffreAffaires + boeufData.chiffreAffaires + veauData.chiffreAffaires + 
                                          pouletData.chiffreAffaires + oeufData.chiffreAffaires + packsData.chiffreAffaires + 
                                          surPiedsData.chiffreAffaires + diversData.chiffreAffaires + autreData.chiffreAffaires + stockSoirData.chiffreAffaires;
                
                const totalCout = agneauData.cout + boeufData.cout + veauData.cout + 
                                pouletData.cout + oeufData.cout + packsData.cout + 
                                surPiedsData.cout + diversData.cout + autreData.cout + stockSoirData.cout;
                
                const totalMarge = agneauData.marge + boeufData.marge + veauData.marge + 
                                 pouletData.marge + oeufData.marge + packsData.marge + surPiedsData.marge + 
                                 diversData.marge + autreData.marge + stockSoirData.marge;
                
                // Calculate totals EXCLUDING stockSoir (for sales-only analysis)
                const totalChiffreAffairesSansStockSoir = agneauData.chiffreAffaires + boeufData.chiffreAffaires + veauData.chiffreAffaires + 
                                          pouletData.chiffreAffaires + oeufData.chiffreAffaires + packsData.chiffreAffaires + 
                                          surPiedsData.chiffreAffaires + diversData.chiffreAffaires + autreData.chiffreAffaires;
                
                const totalCoutSansStockSoir = agneauData.cout + boeufData.cout + veauData.cout + 
                                pouletData.cout + oeufData.cout + packsData.cout + 
                                surPiedsData.cout + diversData.cout + autreData.cout;
                
                const totalMargeSansStockSoir = agneauData.marge + boeufData.marge + veauData.marge + 
                                 pouletData.marge + oeufData.marge + packsData.marge + surPiedsData.marge + 
                                 diversData.marge + autreData.marge;
                
                console.log(`🔍 TOTALS CALCULATION for ${pointVente}:`);
                console.log(`   - Total CA (avec Stock Soir): ${totalChiffreAffaires}`);
                console.log(`   - Total CA (sans Stock Soir): ${totalChiffreAffairesSansStockSoir}`);
                console.log(`   - Total Coût (avec Stock Soir): ${totalCout}`);
                console.log(`   - Total Coût (sans Stock Soir): ${totalCoutSansStockSoir}`);
                console.log(`   - Total Marge (avec Stock Soir): ${totalMarge}`);
                console.log(`   - Total Marge (sans Stock Soir): ${totalMargeSansStockSoir}`);
                
                const formattedResult = {
                    agneau: agneauData,
                    boeuf: boeufData,
                    veau: veauData,
                    poulet: pouletData,
                    oeuf: oeufData,
                    packs: packsData,
                    surPieds: surPiedsData,
                    divers: diversData,
                    autre: autreData,
                    stockSoir: stockSoirData,
                    totaux: {
                        totalChiffreAffaires: totalChiffreAffaires,
                        totalCout: totalCout,
                        totalMarge: totalMarge,
                        totalChiffreAffairesSansStockSoir: totalChiffreAffairesSansStockSoir,
                        totalCoutSansStockSoir: totalCoutSansStockSoir,
                        totalMargeSansStockSoir: totalMargeSansStockSoir
                    },
                    debug: {
                        achatsBoeuf: achatsBoeufDebugInfo
                    }
                };
            
            console.log(`✅ Successfully formatted result for ${pointVente}: CA=${totalCA}`);
            return formattedResult;
            
        } finally {
            await pool.end();
        }
        
    } catch (error) {
        console.error(`❌ Error in getProxyMargesViaAPI for ${pointVente}:`, error);
        return null;
    }
}

// Helper function to format product data using Mode SPÉCIFIQUE logic (ratios from reconciliation)
function formatProductFromSalesWithRatios(salesRows, productType, ratio, specialType = null, purchasePrices = null, packCostData = null) {
    // Find products matching the type
    let matchingProducts = [];
    
    switch (productType) {
        case 'agneau':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('agneau') &&
                !row.produit.toLowerCase().includes('tete agneau') &&
                !row.produit.toLowerCase().includes('tête agneau')
            );
            break;
        case 'boeuf':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower === 'boeuf en détail' || 
                       produitLower === 'boeuf en detail' ||
                       produitLower === 'boeuf en gros';
            });
            break;
        case 'veau':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower === 'veau en détail' || 
                       produitLower === 'veau en detail' ||
                       produitLower === 'veau en gros';
            });
            break;
        case 'poulet':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('poulet')
            );
            break;
        case 'oeuf':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase() === 'oeuf'
            );
            break;
        case 'pack':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('pack')
            );
            break;
        case 'divers':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('sans os') ||
                row.produit.toLowerCase().includes('foie') ||
                row.produit.toLowerCase().includes('peaux') ||
                row.produit.toLowerCase().includes('jarret') ||
                row.produit.toLowerCase().includes('yell') ||
                row.produit.toLowerCase().includes('dechet') ||
                row.produit.toLowerCase().includes('déchet') ||
                row.produit.toLowerCase().includes('viande hachée') ||
                row.produit.toLowerCase().includes('viande hachee') ||
                row.produit.toLowerCase().includes('tete agneau') ||
                row.produit.toLowerCase().includes('tête agneau')
            );
            console.log(`🔍 DIVERS FILTER: Found ${matchingProducts.length} matching products:`, matchingProducts.map(p => `${p.produit}: ${p.quantite_totale} units, ${p.chiffre_affaires} FCFA`));
            
            // Debug détaillé pour chaque produit divers
            let totalDiversQuantite = 0;
            let totalDiversCA = 0;
            matchingProducts.forEach((product, index) => {
                console.log(`🔍 DIVERS PRODUCT ${index + 1}: ${product.produit}`);
                console.log(`   - Quantité: ${product.quantite_totale} units`);
                console.log(`   - Prix moyen: ${product.prix_moyen} FCFA/unité`);
                console.log(`   - Chiffre d'affaires: ${product.chiffre_affaires} FCFA`);
                totalDiversQuantite += parseFloat(product.quantite_totale);
                totalDiversCA += parseFloat(product.chiffre_affaires);
            });
            console.log(`🔍 DIVERS TOTAL CALCULATED: ${totalDiversQuantite} units, ${totalDiversCA} FCFA`);
            break;
        case 'sur pieds':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower.includes('sur pied');
            });
            break;
        case 'autre':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower.includes('autre');
            });
            break;
    }
    
    if (matchingProducts.length === 0) {
        return {
            prixVente: 0,
            prixAchat: 0,
            quantiteVendue: 0,
            quantiteAbattue: 0,
            ratioPerte: 0,
            chiffreAffaires: 0,
            cout: 0,
            marge: 0,
            unite: productType === 'poulet' || productType === 'oeuf' || productType === 'sur pieds' ? 'unité' : 'kg'
        };
    }
    
    // Aggregate data from matching products
    const totalQuantiteVendue = matchingProducts.reduce((sum, row) => sum + parseFloat(row.quantite_totale || 0), 0);
    const totalCA = matchingProducts.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires || 0), 0);
    const prixVenteMoyen = totalQuantiteVendue > 0 ? totalCA / totalQuantiteVendue : 0;
    
    // MODE SPÉCIFIQUE: Calculate quantiteAbattue using ratio
    let quantiteAbattue = totalQuantiteVendue;
    if (ratio !== 0 && (productType === 'boeuf' || productType === 'veau' || productType === 'agneau')) {
        quantiteAbattue = totalQuantiteVendue / (1 + ratio);
    }
    
    // Calculate ratio de perte for display
    const ratioPerte = quantiteAbattue !== 0 ? 
        ((totalQuantiteVendue - quantiteAbattue) / quantiteAbattue * 100) : 0;
    
    // Calculate purchase price from selling price (as per screenshot logic)
    let prixAchat = 0;
    let cout, marge;
    
    if (specialType === 'packs') {
        // For Packs: Use real cost calculation from pack composition API
        if (packCostData && packCostData.montantInformatif > 0) {
            // Use actual pack composition cost
            cout = packCostData.montantInformatif;
            marge = totalCA - cout;
            console.log(`📦 PACKS - VRAIE MARGE CALCULÉE:`);
            console.log(`   - CA: ${totalCA} FCFA`);
            console.log(`   - Coût (composition): ${cout} FCFA`);
            console.log(`   - Marge: ${marge} FCFA (${packCostData.margePourcentage}%)`);
        } else {
            // Fallback to old logic if no pack data available
            cout = totalCA;
            marge = 0;
            console.log(`📦 PACKS - Pas de données de composition, marge = 0`);
        }
    } else if (specialType === 'autre' || specialType === 'sur pieds') {
        // For Autre and Sur Pieds: "Pas de coût d'achat", Coût = CA, Marge = 0
        cout = totalCA;
        marge = 0;
    } else if (specialType === 'divers') {
        // For Divers: "Pas de coût d'achat", Coût = 0, Marge = CA
        cout = 0;
        marge = totalCA;
    } else {
        // For normal products: Use purchase prices from achats-boeuf API
        if (productType === 'boeuf' && purchasePrices && purchasePrices.avgPrixKgBoeuf) {
            prixAchat = purchasePrices.avgPrixKgBoeuf;
        } else if (productType === 'veau' && purchasePrices && purchasePrices.avgPrixKgVeau) {
            prixAchat = purchasePrices.avgPrixKgVeau;
        } else {
            // Use API parameters for fixed prices (no hardcoded values)
            if (productType === 'agneau' && purchasePrices && purchasePrices.prixAchatAgneau) {
                prixAchat = purchasePrices.prixAchatAgneau; // From API parameters
            } else if (productType === 'poulet' && purchasePrices && purchasePrices.prixAchatPoulet) {
                prixAchat = purchasePrices.prixAchatPoulet; // From API parameters
            } else if (productType === 'oeuf' && purchasePrices && purchasePrices.prixAchatOeuf) {
                prixAchat = purchasePrices.prixAchatOeuf; // From API parameters
            } else {
                // If no purchase price available, use sales price (no cost = no margin)
                console.log(`⚠️ No purchase price available for ${productType}, using sales price`);
                prixAchat = prixVenteMoyen;
            }
        }
        
        // Calculate cost and margin
        cout = quantiteAbattue * prixAchat;
        marge = totalCA - cout;
    }
    
    return {
        prixVente: Math.round(prixVenteMoyen),
        prixAchat: Math.round(prixAchat),
        quantiteVendue: totalQuantiteVendue,
        quantiteAbattue: Math.round(quantiteAbattue * 100) / 100, // Round to 2 decimals
        ratioPerte: Math.round(ratioPerte * 10) / 10, // Round to 1 decimal
        chiffreAffaires: totalCA,
        cout: Math.round(cout),
        marge: Math.round(marge),
        unite: productType === 'poulet' || productType === 'oeuf' || productType === 'sur pieds' ? 'unité' : 'kg'
    };
}

// Helper function to format product data from sales database results following exact screenshot logic
function formatProductFromSales(salesRows, productType, prixAchatDefault, specialType = null) {
    // Find products matching the type
    let matchingProducts = [];
    
    switch (productType) {
        case 'agneau':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('agneau') &&
                !row.produit.toLowerCase().includes('tete agneau') &&
                !row.produit.toLowerCase().includes('tête agneau')
            );
            break;
        case 'boeuf':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower === 'boeuf en détail' || 
                       produitLower === 'boeuf en detail' ||
                       produitLower === 'boeuf en gros';
            });
            break;
        case 'veau':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower === 'veau en détail' || 
                       produitLower === 'veau en detail' ||
                       produitLower === 'veau en gros';
            });
            break;
        case 'poulet':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('poulet')
            );
            break;
        case 'oeuf':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase() === 'tablette'
            );
            break;
        case 'pack':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('pack')
            );
            break;
        case 'divers':
            matchingProducts = salesRows.filter(row => 
                row.produit.toLowerCase().includes('sans os') ||
                row.produit.toLowerCase().includes('foie') ||
                row.produit.toLowerCase().includes('peaux') ||
                row.produit.toLowerCase().includes('jarret') ||
                row.produit.toLowerCase().includes('yell') ||
                row.produit.toLowerCase().includes('dechet') ||
                row.produit.toLowerCase().includes('déchet') ||
                row.produit.toLowerCase().includes('viande hachée') ||
                row.produit.toLowerCase().includes('viande hachee') ||
                row.produit.toLowerCase().includes('tete agneau') ||
                row.produit.toLowerCase().includes('tête agneau')
            );
            console.log(`🔍 DIVERS FILTER: Found ${matchingProducts.length} matching products:`, matchingProducts.map(p => `${p.produit}: ${p.quantite_totale} units, ${p.chiffre_affaires} FCFA`));
            
            // Debug détaillé pour chaque produit divers
            let totalDiversQuantite = 0;
            let totalDiversCA = 0;
            matchingProducts.forEach((product, index) => {
                console.log(`🔍 DIVERS PRODUCT ${index + 1}: ${product.produit}`);
                console.log(`   - Quantité: ${product.quantite_totale} units`);
                console.log(`   - Prix moyen: ${product.prix_moyen} FCFA/unité`);
                console.log(`   - Chiffre d'affaires: ${product.chiffre_affaires} FCFA`);
                totalDiversQuantite += parseFloat(product.quantite_totale);
                totalDiversCA += parseFloat(product.chiffre_affaires);
            });
            console.log(`🔍 DIVERS TOTAL CALCULATED: ${totalDiversQuantite} units, ${totalDiversCA} FCFA`);
            break;
        case 'sur pieds':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower.includes('sur pied');
            });
            break;
        case 'autre':
            matchingProducts = salesRows.filter(row => {
                const produitLower = row.produit.toLowerCase().trim();
                return produitLower.includes('autre');
            });
            break;
    }
    
    if (matchingProducts.length === 0) {
        return {
            prixVente: 0,
            prixAchat: 0,
            quantiteVendue: 0,
            quantiteAbattue: 0,
            ratioPerte: 0,
            chiffreAffaires: 0,
            cout: 0,
            marge: 0,
            unite: productType === 'poulet' || productType === 'oeuf' || productType === 'sur pieds' ? 'unité' : 'kg'
        };
    }
    
    // Aggregate data from matching products
    const totalQuantite = matchingProducts.reduce((sum, row) => sum + parseFloat(row.quantite_totale || 0), 0);
    const totalCA = matchingProducts.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires || 0), 0);
    const prixVenteMoyen = totalQuantite > 0 ? totalCA / totalQuantite : 0;
    
    console.log(`🔍 FORMAT PRODUCT CALCULATION for ${productType}:`);
    console.log(`   - Total quantité: ${totalQuantite}`);
    console.log(`   - Total CA: ${totalCA}`);
    console.log(`   - Prix vente moyen: ${prixVenteMoyen}`);
    console.log(`   - Special type: ${specialType}`);
    
    // Apply the exact logic from the screenshot
    let cout, marge;
    
    if (specialType === 'packs' || specialType === 'autre' || specialType === 'sur pieds') {
        // For Packs, Autre and Sur Pieds: "Pas de coût d'achat", Coût = CA, Marge = 0
        cout = totalCA;
        marge = 0;
        console.log(`   - Packs/Autre/Sur Pieds logic: cout=${cout}, marge=${marge}`);
    } else if (specialType === 'divers') {
        // For Divers: "Pas de coût d'achat", Coût = 0, Marge = CA
        cout = 0;
        marge = totalCA;
        console.log(`   - Divers logic: cout=${cout}, marge=${marge}`);
    } else {
        // For normal products with purchase price: Coût = Prix achat * Quantité, Marge = CA - Coût
        cout = totalQuantite * prixAchatDefault;
        marge = totalCA - cout;
        console.log(`   - Normal logic: prixAchatDefault=${prixAchatDefault}, cout=${cout}, marge=${marge}`);
    }
    
    return {
        prixVente: Math.round(prixVenteMoyen),
        prixAchat: specialType ? 0 : prixAchatDefault,
        quantiteVendue: totalQuantite,
        quantiteAbattue: totalQuantite, // Assume same as sold for now
        ratioPerte: 0, // Will be calculated separately if needed
        chiffreAffaires: totalCA,
        cout: Math.round(cout),
        marge: Math.round(marge),
        unite: productType === 'poulet' || productType === 'oeuf' || productType === 'sur pieds' ? 'unité' : 'kg'
    };
}

// Helper function to calculate proxy marges for a specific point of sale (ORIGINAL - NE PAS MODIFIER)
async function calculateProxyMargesForPointVente(startDate, endDate, pointVente) {
    try {
        console.log(`🚀 ENTRÉE calculateProxyMargesForPointVente: ${pointVente} from ${startDate} to ${endDate}`);
        
        // Get proxy margin prices
        const dynamicPrices = await fetchProxyMarginPrices(startDate, endDate, pointVente);
        
        // Get weighted purchase prices
        const weightedPrices = await fetchWeightedPurchasePrices(startDate, endDate);
        
        // Merge prices
        const enhancedPrices = {
            ...dynamicPrices,
            ...weightedPrices
        };
        
        // Get stock data
        const previousStartDate = getPreviousDate(startDate);
        
        // Helper function to format dates (same as in stock-soir-marge API)
        const formatDate = (dateStr) => {
            if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts[0].length === 4) {
                    // YYYY-MM-DD to DD/MM/YYYY
                    return `${parts[2]}/${parts[1]}/${parts[0]}`;
                } else {
                    // DD-MM-YYYY to DD/MM/YYYY
                    return dateStr.replace(/-/g, '/');
                }
            }
            return dateStr; // Already in DD/MM/YYYY format
        };
        
        const formattedPreviousStartDate = formatDate(previousStartDate);
        const formattedEndDate = formatDate(endDate);
        
        const stockDebut = await getStockSoirData(formattedPreviousStartDate);
        const stockFin = await getStockSoirData(formattedEndDate);
        
        // Calculate margin using existing logic
        console.log(`🔍 About to call calculateStockSoirMarge for ${pointVente}`);
        console.log(`🔍 Stock debut success: ${stockDebut.success}, Stock fin success: ${stockFin.success}`);
        console.log(`🔍 Enhanced prices:`, enhancedPrices);
        
        const margeResult = await calculateStockSoirMarge(
            stockDebut.data,
            stockFin.success ? stockFin.data : {},
            startDate,
            endDate,
            pointVente,
            enhancedPrices,
            {
                ratioPerteBoeuf: 8.0,
                ratioPerteVeau: 8.0,
                calculAutoActif: true
            }
        );
        
        console.log(`🔍 MargeResult received:`, margeResult);
        
        // Format the result according to our JSON structure
        // The margeResult comes from calculateStockSoirMarge and has a different structure
        const formattedResult = {
            agneau: formatProductDataFromDetail(margeResult.detailParProduit, 'Agneau'),
            boeuf: formatProductDataFromDetail(margeResult.detailParProduit, 'Boeuf'),
            veau: formatProductDataFromDetail(margeResult.detailParProduit, 'Veau'),
            poulet: formatProductDataFromDetail(margeResult.detailParProduit, 'Poulet'),
            oeuf: formatProductDataFromDetail(margeResult.detailParProduit, 'Tablette'),
            packs: formatProductDataFromDetail(margeResult.detailParProduit, 'Packs'),
            divers: formatProductDataFromDetail(margeResult.detailParProduit, 'Divers'),
            autre: formatProductDataFromDetail(margeResult.detailParProduit, 'Autres'),
            stockSoir: {
                montantTotal: stockSoirData.montantTotal || 0,
                nombreItems: stockSoirData.nombreItems || 0,
                variation: {
                    debut: startDate,
                    fin: endDate,
                    valeurDebut: 0,
                    valeurFin: 0
                },
                chiffreAffaires: stockSoirData.chiffreAffaires || 0,
                cout: stockSoirData.cout || 0,
                marge: stockSoirData.marge || 0
            },
            totaux: {
                totalChiffreAffaires: margeResult.totalCA || 0,
                totalCout: margeResult.totalCout || 0,
                totalMarge: margeResult.marge || 0
            }
        };
        
        return formattedResult;
        
    } catch (error) {
        console.error(`❌ Error calculating proxy marges for ${pointVente}:`, error);
        return null;
    }
}

// Helper function to format product data from stock-soir-marge API
function formatProductFromStockSoir(detailParProduit, productName) {
    if (!detailParProduit || !Array.isArray(detailParProduit)) {
        return {
            prixVente: 0,
            prixAchat: 0,
            quantiteVendue: 0,
            quantiteAbattue: 0,
            ratioPerte: 0.0,
            chiffreAffaires: 0,
            cout: 0,
            marge: 0,
            unite: productName === 'Poulet' || productName === 'Tablette' ? 'unité' : 'kg'
        };
    }
    
    // Find the product in the detailParProduit array
    const product = detailParProduit.find(p => p.produit === productName);
    if (!product) {
        return {
            prixVente: 0,
            prixAchat: 0,
            quantiteVendue: 0,
            quantiteAbattue: 0,
            ratioPerte: 0.0,
            chiffreAffaires: 0,
            cout: 0,
            marge: 0,
            unite: productName === 'Poulet' || productName === 'Tablette' ? 'unité' : 'kg'
        };
    }
    
    // Calculate ratio perte if possible
    const ratioPerte = product.quantiteAbattue !== 0 ? 
        ((product.quantiteVendue - product.quantiteAbattue) / product.quantiteAbattue * 100) : 0.0;
    
    return {
        prixVente: product.prixVenteProduit || 0,
        prixAchat: product.prixAchatProduit || 0,
        quantiteVendue: product.quantiteVendue || 0,
        quantiteAbattue: product.quantiteAbattue || 0,
        ratioPerte: ratioPerte,
        chiffreAffaires: product.caProduit || 0,
        cout: product.coutProduit || 0,
        marge: product.margeProduit || 0,
        unite: productName === 'Poulet' || productName === 'Tablette' ? 'unité' : 'kg'
    };
}

// Helper function to format product data from detailParProduit array (legacy)
function formatProductDataFromDetail(detailParProduit, productName) {
    if (!detailParProduit || !Array.isArray(detailParProduit)) {
        return {
            prixVente: 0,
            prixAchat: 0,
            quantiteVendue: 0,
            quantiteAbattue: 0,
            ratioPerte: 0.0,
            chiffreAffaires: 0,
            cout: 0,
            marge: 0,
            unite: productName === 'Poulet' || productName === 'Tablette' ? 'unité' : 'kg'
        };
    }
    
    // Find the product in the detailParProduit array
    const product = detailParProduit.find(p => p.produit === productName);
    if (!product) {
        return {
            prixVente: 0,
            prixAchat: 0,
            quantiteVendue: 0,
            quantiteAbattue: 0,
            ratioPerte: 0.0,
            chiffreAffaires: 0,
            cout: 0,
            marge: 0,
            unite: productName === 'Poulet' || productName === 'Tablette' ? 'unité' : 'kg'
        };
    }
    
    // Calculate ratio perte if possible
    const ratioPerte = product.quantiteAbattue !== 0 ? 
        ((product.quantiteVendue - product.quantiteAbattue) / product.quantiteAbattue * 100) : 0.0;
    
    return {
        prixVente: product.prixVenteProduit || 0,
        prixAchat: product.prixAchatProduit || 0,
        quantiteVendue: product.quantiteVendue || 0,
        quantiteAbattue: product.quantiteAbattue || 0,
        ratioPerte: ratioPerte,
        chiffreAffaires: product.caProduit || 0,
        cout: product.coutProduit || 0,
        marge: product.margeProduit || 0,
        unite: productName === 'Poulet' || productName === 'Tablette' ? 'unité' : 'kg'
    };
}

// Helper function to format product data (legacy)
function formatProductData(margeResult, productName) {
    const product = margeResult[productName];
    if (!product) {
        return {
            prixVente: 0,
            prixAchat: 0,
            quantiteVendue: 0,
            quantiteAbattue: 0,
            ratioPerte: 0.0,
            chiffreAffaires: 0,
            cout: 0,
            marge: 0,
            unite: productName === 'poulet' || productName === 'oeuf' ? 'unité' : 'kg'
        };
    }
    
    return {
        prixVente: product.prixVente || 0,
        prixAchat: product.prixAchat || 0,
        quantiteVendue: product.quantiteVendue || 0,
        quantiteAbattue: product.quantiteAbattue || 0,
        ratioPerte: product.ratioPerte || 0.0,
        chiffreAffaires: product.chiffreAffaires || 0,
        cout: product.cout || 0,
        marge: product.marge || 0,
        unite: productName === 'poulet' || productName === 'oeuf' ? 'unité' : 'kg'
    };
}

// ============================================================
// MODULE POS - Routes et fonctions auxiliaires
// ============================================================

const ClotureCaisse = require('./db/models/ClotureCaisse');
const { CommandeInfo } = require('./db/models');
const tracabiliteConfig = require('./config/tracabilite-produits.json');

// ===== PANIER (CART) =====
app.post('/api/save-cart', checkAuth, (req, res) => {
    try {
        req.session.savedCart = req.body;
        res.json({ success: true, message: 'Panier sauvegardé' });
    } catch (error) {
        console.error('Erreur sauvegarde panier:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde du panier' });
    }
});

app.get('/api/load-cart', checkAuth, (req, res) => {
    try {
        res.json({ success: true, cart: req.session.savedCart || null });
    } catch (error) {
        console.error('Erreur chargement panier:', error);
        res.status(500).json({ success: false, message: 'Erreur lors du chargement du panier' });
    }
});

app.post('/api/clear-cart', checkAuth, (req, res) => {
    try {
        req.session.savedCart = null;
        res.json({ success: true, message: 'Panier vidé' });
    } catch (error) {
        console.error('Erreur suppression panier:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la suppression du panier' });
    }
});

// ===== STATUT DE LIVRAISON =====
app.put('/api/commandes/statut', checkAuth, checkStatutLivraisonAccess, async (req, res) => {
    try {
        const { commandeId, statut } = req.body;
        if (!commandeId || !statut) {
            return res.status(400).json({ success: false, message: 'commandeId et statut sont requis' });
        }
        const validStatuts = ['en_preparation', 'pret', 'en_livraison', 'sur_place'];
        if (!validStatuts.includes(statut)) {
            return res.status(400).json({ success: false, message: 'Statut invalide' });
        }
        const ventes = await Vente.findAll({ where: { commande_id: commandeId } });
        if (ventes.length === 0) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        }
        const userPointVente = req.session.user.pointVente;
        const userRole = req.session.user.role;
        if (!['superviseur', 'admin', 'chef_livreur'].includes(userRole)) {
            const ventePointVente = ventes[0].pointVente;
            const hasAccess = Array.isArray(userPointVente)
                ? userPointVente.includes(ventePointVente) || userPointVente.includes('tous')
                : userPointVente === ventePointVente || userPointVente === 'tous';
            if (!hasAccess) {
                return res.status(403).json({ success: false, message: "Vous n'avez pas accès à cette commande" });
            }
        }
        const updateData = { statut_preparation: statut };
        if (statut === 'pret') updateData.livreur_assigne = null;
        await Vente.update(updateData, { where: { commande_id: commandeId } });
        res.json({ success: true, message: 'Statut mis à jour', commandeId, statut });
    } catch (error) {
        console.error('Erreur mise à jour statut:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
    }
});

// ===== SUPPRESSION DE COMMANDE =====
app.delete('/api/commandes/:commandeId', checkAuth, checkWriteAccess, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const commandeId = decodeURIComponent(req.params.commandeId);
        const ventes = await Vente.findAll({ where: { commande_id: commandeId }, transaction });
        if (ventes.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        }
        const userPointVente = req.session.user.pointVente;
        for (const vente of ventes) {
            const hasAccess = userPointVente === 'tous' ||
                (Array.isArray(userPointVente) && (userPointVente.includes('tous') || userPointVente.includes(vente.pointVente))) ||
                userPointVente === vente.pointVente;
            if (!hasAccess) {
                await transaction.rollback();
                return res.status(403).json({ success: false, message: 'Accès non autorisé à ce point de vente' });
            }
        }
        // Vérifier les restrictions temporelles (date de la première vente de la commande)
        const venteDate = ventes[0].date;
        const timeRestriction = checkSaleTimeRestrictions(venteDate, req.session.user.username, req.session.user.role);
        if (!timeRestriction.allowed) {
            await transaction.rollback();
            return res.status(403).json({ success: false, message: timeRestriction.message, timeRestriction: true });
        }

        const commandeInfoRow = await CommandeInfo.findOne({ where: { commande_id: commandeId }, transaction });
        if (commandeInfoRow) {
            await CommandeInfo.destroy({ where: { commande_id: commandeId }, transaction });
        }
        await Vente.destroy({ where: { commande_id: commandeId }, transaction });
        await transaction.commit();
        res.json({ success: true, message: `Commande supprimée (${ventes.length} ventes)`, deletedCount: ventes.length });
    } catch (error) {
        await transaction.rollback();
        console.error('Erreur suppression commande:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
    }
});

// ===== CREDITS COMMANDES =====
app.post('/api/commandes/:commandeId/remove-credit', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const commandeId = decodeURIComponent(req.params.commandeId);
        const ventes = await Vente.findAll({ where: { commande_id: commandeId } });
        if (ventes.length === 0) {
            return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        }
        let venteAvecCredit = null;
        for (const vente of ventes) {
            if (vente.extension && vente.extension.credit_used) { venteAvecCredit = vente; break; }
        }
        if (!venteAvecCredit) {
            return res.status(400).json({ success: false, message: 'Aucun crédit trouvé sur cette commande' });
        }
        const updatedExtension = { ...venteAvecCredit.extension };
        delete updatedExtension.credit_used;
        delete updatedExtension.amount_paid_after_credit;
        delete updatedExtension.credit_status;
        delete updatedExtension.credit_phone;
        delete updatedExtension.credit_transaction_id;
        delete updatedExtension.credit_error_message;
        delete updatedExtension.credit_updated_at;
        const hasOtherProps = Object.keys(updatedExtension).length > 0;
        await venteAvecCredit.update({ extension: hasOtherProps ? updatedExtension : null });
        let totalAmount = 0;
        for (const vente of ventes) { totalAmount += parseFloat(vente.total || 0); }
        res.json({ success: true, message: 'Crédit retiré avec succès', new_total: totalAmount });
    } catch (error) {
        console.error('Erreur retrait crédit:', error);
        res.status(500).json({ success: false, message: 'Erreur: ' + error.message });
    }
});

app.get('/api/commandes/:commandeId/credit', checkAuth, async (req, res) => {
    try {
        const commandeId = decodeURIComponent(req.params.commandeId);
        const credit = await CommandeInfo.findOne({ where: { commande_id: commandeId } });
        if (!credit) return res.json({ success: true, hasCredit: false, credit: null });
        res.json({
            success: true, hasCredit: true,
            credit: {
                credit_used: parseFloat(credit.credit_used),
                credit_phone: credit.credit_phone,
                credit_status: credit.credit_status,
                credit_version: credit.credit_version,
                amount_paid_after_credit: credit.amount_paid_after_credit ? parseFloat(credit.amount_paid_after_credit) : null,
                transaction_id: credit.transaction_id,
                error_message: credit.error_message,
                credit_updated_at: credit.credit_updated_at,
                createdAt: credit.createdAt
            }
        });
    } catch (error) {
        console.error('Erreur récupération crédit:', error);
        res.status(500).json({ success: false, message: 'Erreur: ' + error.message });
    }
});

app.post('/api/commandes/:commandeId/credit', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const commandeId = decodeURIComponent(req.params.commandeId);
        const { credit_used, credit_phone, amount_paid_after_credit, credit_version } = req.body;
        if (!credit_used || !credit_phone) {
            return res.status(400).json({ success: false, message: 'credit_used et credit_phone sont requis' });
        }
        const [credit, created] = await CommandeInfo.upsert({
            commande_id: commandeId, credit_used, credit_phone,
            credit_status: 'pending', credit_version: credit_version || null,
            amount_paid_after_credit: amount_paid_after_credit || null,
            credit_updated_at: new Date(), payment_status: 'A',
            payment_method: 'credit', payment_updated_at: new Date()
        });
        res.json({ success: true, message: created ? 'Crédit créé' : 'Crédit mis à jour', credit });
    } catch (error) {
        console.error('Erreur création crédit:', error);
        res.status(500).json({ success: false, message: 'Erreur: ' + error.message });
    }
});

app.post('/api/commandes/:commandeId/update-credit-status', checkAuth, checkWriteAccess, async (req, res) => {
    try {
        const commandeId = decodeURIComponent(req.params.commandeId);
        const { credit_status, transaction_id, error_message } = req.body;
        const validStatuses = ['pending', 'confirmed', 'failed'];
        if (!validStatuses.includes(credit_status)) {
            return res.status(400).json({ success: false, message: `Statut invalide. Valeurs acceptées: ${validStatuses.join(', ')}` });
        }
        const info = await CommandeInfo.findOne({ where: { commande_id: commandeId } });
        if (!info) return res.status(404).json({ success: false, message: 'Aucune info trouvée pour cette commande' });
        const updateData = { credit_status, credit_updated_at: new Date(), payment_updated_at: new Date() };
        if (credit_status === 'confirmed') updateData.payment_status = 'C';
        else if (credit_status === 'failed') updateData.payment_status = 'A';
        if (transaction_id) updateData.transaction_id = transaction_id;
        if (error_message) updateData.error_message = error_message;
        await info.update(updateData);
        res.json({ success: true, message: `Statut crédit mis à jour: ${credit_status}`, credit_status });
    } catch (error) {
        console.error('Erreur mise à jour statut crédit:', error);
        res.status(500).json({ success: false, message: 'Erreur: ' + error.message });
    }
});

// ===== PAYMENT STATUS COMMANDES =====
app.get('/api/orders/:commandeId/payment-status', checkAuth, async (req, res) => {
    try {
        const { commandeId } = req.params;

        // 1. Lire depuis commande_infos (source de vérité pour le statut)
        const commandeInfo = await CommandeInfo.findOne({ where: { commande_id: commandeId } });

        // 2. Lire la créance depuis ventes
        const ventesWithCreance = await sequelize.query(
            `SELECT montant_restant_du, creance FROM ventes WHERE commande_id = :commandeId LIMIT 1`,
            { replacements: { commandeId }, type: sequelize.QueryTypes.SELECT }
        );
        const montantRestantDu = parseFloat(ventesWithCreance[0]?.montant_restant_du || 0);
        const creance = ventesWithCreance[0]?.creance || false;

        // 3. Priorité : créance > statut sauvegardé > défaut A
        let posStatus = 'A';
        if (creance && montantRestantDu > 0) {
            posStatus = 'C';
        } else if (commandeInfo?.payment_status) {
            posStatus = commandeInfo.payment_status;
        }

        res.json({ success: true, data: { commandeId, posStatus, hasPaymentLink: false, montantRestantDu } });
    } catch (error) {
        console.error('Erreur payment-status:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

app.put('/api/orders/:commandeId/payment-status', checkAuth, async (req, res) => {
    try {
        const { commandeId } = req.params;
        const { status } = req.body;
        if (!['A', 'P', 'C'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Statut invalide' });
        }
        await CommandeInfo.upsert({
            commande_id: commandeId,
            payment_status: status,
            payment_updated_at: new Date()
        });
        res.json({ success: true, data: { commandeId, posStatus: status } });
    } catch (error) {
        console.error('Erreur mise à jour payment-status:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

app.post('/api/orders/:commandeId/mark-manual-payment', checkAuth, async (req, res) => {
    res.status(410).json({ success: false, message: 'Fonctionnalité Bictorys désactivée' });
});

app.post('/api/orders/:commandeId/reset-manual-payment', checkAuth, async (req, res) => {
    res.status(410).json({ success: false, message: 'Fonctionnalité Bictorys désactivée' });
});

app.post('/api/orders/:newCommandeId/reassign-bictorys-link', checkAuth, async (req, res) => {
    res.status(410).json({ success: false, message: 'Fonctionnalité Bictorys désactivée' });
});

app.post('/api/orders/:commandeId/bictorys-link', checkAuth, async (req, res) => {
    res.status(410).json({ success: false, message: 'Fonctionnalité Bictorys désactivée' });
});

app.delete('/api/orders/:commandeId/bictorys-link', checkAuth, async (req, res) => {
    res.status(410).json({ success: false, message: 'Fonctionnalité Bictorys désactivée' });
});

// ===== DETAILS COMMANDE =====
app.get('/api/orders/:commandeId/details', checkAuth, async (req, res) => {
    try {
        const { commandeId } = req.params;
        const ventes = await Vente.findAll({
            where: { commande_id: commandeId },
            order: [['id', 'ASC']]
        });
        if (!ventes || ventes.length === 0) return res.status(404).json({ success: false, message: 'Commande non trouvée' });
        const firstVente = ventes[0];
        const totalAmount = ventes.reduce((sum, v) => sum + parseFloat(v.montant || 0), 0);
        res.json({
            success: true,
            data: {
                commandeId,
                clientName: firstVente.nomClient,
                clientPhone: firstVente.numeroClient,
                clientAddress: firstVente.adresseClient,
                specialInstructions: firstVente.instructionsClient,
                totalAmount,
                creance: firstVente.creance,
                montantRestantDu: parseFloat(firstVente.montantRestantDu || 0),
                pointVente: firstVente.pointVente,
                date: firstVente.date,
                statutPreparation: firstVente.statutPreparation,
                livreurAssigne: firstVente.livreurAssigne,
                items: ventes.map(v => ({
                    produit: v.produit,
                    nombre: parseFloat(v.nombre),
                    prixUnit: parseFloat(v.prixUnit),
                    montant: parseFloat(v.montant)
                }))
            }
        });
    } catch (error) {
        console.error('Erreur order details:', error);
        res.status(500).json({ success: false, message: 'Erreur: ' + error.message });
    }
});

// ===== TRAÇABILITÉ VIANDE =====
function formatDateTracabilite(date) {
    return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()}`;
}

async function getTracabiliteViande(commandeProduits) {
    try {
        const produitsEligibles = tracabiliteConfig.produits_tracabilite_viande;
        const produitsEligiblesNormalized = produitsEligibles.filter(p => p && p.displayName).map(p => p.displayName.toLowerCase());
        const contientViande = commandeProduits.some(p => p && p.nom && produitsEligiblesNormalized.includes(p.nom.toLowerCase()));
        if (!contientViande) return null;
        const achatRecent = await AchatBoeuf.findOne({ order: [['date', 'DESC']], limit: 1 });
        if (!achatRecent) return null;
        const [year, month, day] = achatRecent.date.split('-').map(Number);
        const d = new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00`);
        const lettresMois = ['A','B','C','D','E','F','G','H','I','J','K','L'];
        const lot = `${lettresMois[d.getMonth()]}${d.getFullYear().toString().slice(-2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        return { origine: tracabiliteConfig.info_tracabilite.origine, dateAbattage: formatDateTracabilite(d), lot };
    } catch (error) {
        console.error('Erreur tracabilité viande:', error);
        return null;
    }
}

app.get('/api/tracabilite-viande', checkAuth, async (req, res) => {
    try {
        const { commandeId } = req.query;
        if (!commandeId) return res.status(400).json({ success: false, error: 'commandeId is required' });
        const ventes = await Vente.findAll({ where: { commande_id: commandeId } });
        if (ventes.length === 0) return res.status(404).json({ success: false, error: 'Commande non trouvée' });
        const produits = ventes.map(v => ({ nom: v.produit, quantite: parseFloat(v.nombre) || 0, prix: parseFloat(v.prixUnit) || 0 }));
        const tracabilite = await getTracabiliteViande(produits);
        res.json({ success: true, data: tracabilite });
    } catch (error) {
        console.error('Erreur tracabilité:', error);
        res.status(500).json({ success: false, error: 'Erreur interne' });
    }
});

// ===== LIVREURS =====
let livreursConfig = { api_url: null, livreurs_actifs: [] };

function chargerConfigLivreurs() {
    try {
        const configPath = path.join(__dirname, 'livreurs_actifs.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        livreursConfig = JSON.parse(configData);
        if (Array.isArray(livreursConfig.livreurs_actifs)) {
            livreursConfig.livreurs_actifs = livreursConfig.livreurs_actifs.map(n => (n && typeof n === 'string' ? n.trim() : n));
        }
        console.log('✅ Config livreurs chargée:', { api_url: livreursConfig.api_url, nombre_livreurs: livreursConfig.livreurs_actifs.length });
    } catch (error) {
        console.error('⚠️ Erreur chargement config livreurs:', error.message);
    }
}

chargerConfigLivreurs();

app.get('/api/livreur/actifs', checkAuth, (req, res) => {
    try {
        res.json({ success: true, api_url: livreursConfig.api_url, livreurs_actifs: livreursConfig.livreurs_actifs || [], count: (livreursConfig.livreurs_actifs || []).length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erreur récupération livreurs', error: error.message });
    }
});

app.post('/api/livreur/reload-config', checkAuth, checkAdmin, (req, res) => {
    try {
        chargerConfigLivreurs();
        res.json({ success: true, message: 'Configuration livreurs rechargée', config: livreursConfig });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erreur rechargement', error: error.message });
    }
});

app.post('/api/livreur/assigner', checkAuth, async (req, res) => {
    try {
        const { commande_id, livreur_id, livreur_nom, client, articles, total, point_vente, date_commande, statut } = req.body;
        if (!commande_id || !livreur_nom || !client) {
            return res.status(400).json({ success: false, message: 'commande_id, livreur_nom et client sont requis' });
        }
        const payload = { commande_id, livreur_id: livreur_id || livreur_nom, livreur_nom, client, articles: articles || [], total: total || 0, point_vente: point_vente || '', date_commande: date_commande || new Date().toISOString(), statut: statut || 'en_livraison' };
        const apiUrl = `${livreursConfig.api_url}/api/external/commande-en-cours`;
        const response = await axios.post(apiUrl, payload, { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EXTERNAL_API_KEY }, timeout: 120000 });
        try { await Vente.update({ livreur_assigne: livreur_nom }, { where: { commande_id } }); } catch (dbError) {}
        res.json({ success: true, message: `Commande ${commande_id} assignée à ${livreur_nom}`, data: response.data });
    } catch (error) {
        console.error('Erreur assignation livreur:', error.message);
        if (error.response) return res.status(error.response.status).json({ success: false, message: error.response.data.message || 'Erreur API', error: error.response.data });
        if (error.request) return res.status(503).json({ success: false, message: 'API externe ne répond pas' });
        return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
    }
});

app.delete('/api/livreur/annuler', checkAuth, async (req, res) => {
    try {
        const { commande_id } = req.body;
        if (!commande_id) return res.status(400).json({ success: false, message: 'commande_id est requis' });
        const apiUrl = `${livreursConfig.api_url}/api/external/commande-en-cours/annuler`;
        const response = await axios.delete(apiUrl, { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EXTERNAL_API_KEY }, data: { commande_id }, timeout: 10000 });
        res.json({ success: true, message: `Assignation annulée pour ${commande_id}`, data: response.data });
    } catch (error) {
        console.error('Erreur annulation livreur:', error.message);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'annulation', error: error.message });
    }
});

app.get('/api/livreur/check/:commandeId', checkAuth, async (req, res) => {
    try {
        const { commandeId } = req.params;
        const vente = await Vente.findOne({ where: { commande_id: commandeId, livreur_assigne: { [Op.ne]: null } }, attributes: ['livreur_assigne'] });
        if (vente && vente.livreur_assigne) res.json({ success: true, hasLivreur: true, livreur: vente.livreur_assigne });
        else res.json({ success: true, hasLivreur: false, livreur: null });
    } catch (error) {
        console.error('Erreur vérification livreur:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la vérification', error: error.message });
    }
});

// ===== CLOTURES DE CAISSE =====
function generateCashReference(pointVente) {
    const posMapping = { 'Dahra': 'CASH_DHR', 'Linguere': 'CASH_LGR', 'Mbao': 'CASH_MBA', 'Keur Massar': 'CASH_KM', 'O.Foire': 'CASH_OSF', 'Sacre Coeur': 'CASH_SAC', 'Abattage': 'CASH_ABATS', 'Touba': 'CASH_TB' };
    return posMapping[pointVente] || null;
}

app.get('/api/clotures-caisse/estimatif', checkAuth, async (req, res) => {
    try {
        const { date, pointVente } = req.query;
        if (!date || !pointVente) return res.status(400).json({ success: false, message: 'date et pointVente sont requis' });
        let isoDate = date, ddmmyyyy = date;
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) { const p = date.split('-'); ddmmyyyy = `${p[2]}-${p[1]}-${p[0]}`; }
        else if (date.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/)) { const p = date.split(/[\/\-]/); ddmmyyyy = `${p[0]}-${p[1]}-${p[2]}`; isoDate = `${p[2]}-${p[1]}-${p[0]}`; }
        const ventesArr = await Vente.findAll({ where: { [Op.or]: [{ date: isoDate }, { date: ddmmyyyy }], pointVente } });
        const totalVentes = ventesArr.reduce((sum, v) => sum + (parseFloat(v.montant) || 0), 0);
        const commandeIds = ventesArr.map(v => v.commande_id).filter(Boolean);
        let montantBictorys = 0, paidLinks = [];
        if (commandeIds.length > 0) {
            paidLinks = await PaymentLink.findAll({ where: { commande_id: { [Op.in]: commandeIds }, status: 'paid', is_commande_deleted: false } });
            montantBictorys = paidLinks.reduce((sum, pl) => sum + (parseFloat(pl.amount) || 0), 0);
        }
        const estimatif = Math.max(0, totalVentes - montantBictorys);
        res.json({ success: true, data: { totalVentes, montantBictorys, estimatif, date: isoDate, pointVente, nbBictorysLinks: paidLinks.length } });
    } catch (error) {
        console.error('Erreur cloture estimatif:', error.message);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
    }
});

app.get('/api/clotures-caisse', checkAuth, async (req, res) => {
    try {
        const { date, pointVente } = req.query;
        if (!date || !pointVente) return res.status(400).json({ success: false, message: 'date et pointVente sont requis' });
        let isoDate = date;
        if (date.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/)) { const parts = date.split(/[\/\-]/); isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`; }
        const clotures = await ClotureCaisse.findAll({ where: { date: isoDate, point_de_vente: pointVente }, order: [['created_at', 'ASC']] });
        res.json({ success: true, count: clotures.length, data: clotures });
    } catch (error) {
        console.error('Erreur clotures GET:', error.message);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
    }
});

app.post('/api/clotures-caisse', checkAuth, async (req, res) => {
    try {
        const { date, pointVente, montantEspeces, fondDeCaisse, montantEstimatif, commercial, commentaire } = req.body;
        const username = req.session?.user?.username || req.user?.username || 'inconnu';
        if (!date || !pointVente || montantEspeces === undefined || !commercial) {
            return res.status(400).json({ success: false, message: 'date, pointVente, montantEspeces et commercial sont requis' });
        }
        let isoDate = date;
        if (date.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/)) { const parts = date.split(/[\/\-]/); isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`; }
        const transaction = await sequelize.transaction();
        let cloture;
        try {
            await ClotureCaisse.update({ is_latest: false }, { where: { date: isoDate, point_de_vente: pointVente }, transaction });
            cloture = await ClotureCaisse.create({ date: isoDate, point_de_vente: pointVente, montant_especes: parseFloat(montantEspeces), fond_de_caisse: parseFloat(fondDeCaisse) || 0, montant_estimatif: montantEstimatif !== undefined ? parseFloat(montantEstimatif) : null, commercial, commentaire: commentaire || null, created_by: username, is_latest: true }, { transaction });
            const cashRef = generateCashReference(pointVente);
            if (cashRef) {
                const existing = await CashPayment.findOne({ where: { date: isoDate, point_de_vente: pointVente, payment_type: 'CASH', is_manual: true }, transaction });
                const commentCash = `Clôture caisse par ${commercial} (cloture_id:${cloture.id})`;
                if (existing) { await existing.update({ amount: parseFloat(montantEspeces), comment: commentCash, created_by: username, payment_reference: cashRef }, { transaction }); }
                else { await CashPayment.create({ date: isoDate, created_at: new Date(), point_de_vente: pointVente, amount: parseFloat(montantEspeces), payment_reference: cashRef, payment_type: 'CASH', reference: cashRef, comment: commentCash, is_manual: true, created_by: username }, { transaction }); }
            }
            await transaction.commit();
        } catch (txError) { await transaction.rollback(); throw txError; }
        res.status(201).json({ success: true, message: `Clôture enregistrée pour ${pointVente} le ${isoDate}`, data: cloture });
    } catch (error) {
        console.error('Erreur cloture POST:', error.message);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
    }
});

// ===== CREDIT CLIENT (PROXY) =====
app.post('/api/credit/use', checkAuth, async (req, res) => {
    try {
        const { phone_number, amount_used, order_id, version } = req.body;
        if (!phone_number || !amount_used || !order_id) return res.status(400).json({ success: false, error: 'phone_number, amount_used et order_id sont requis' });
        if (version === undefined || version === null) return res.status(400).json({ success: false, error: 'version est requise pour éviter les conflits' });
        const isLocal = process.env.NODE_ENV !== 'production';
        const externalApiUrl = isLocal ? 'http://localhost:4000/api/external/clients/credits/use' : 'https://matix-livreur-backend.onrender.com/api/external/clients/credits/use';
        const apiKey = process.env.EXTERNAL_API_KEY;
        if (!apiKey) throw new Error('EXTERNAL_API_KEY manquant');
        const response = await axios.post(externalApiUrl, { phone_number, amount_used, order_id, version }, { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 10000 });
        res.json(response.data);
    } catch (error) {
        console.error('Erreur credit/use:', error.message);
        res.status(error.response?.status || 500).json({ success: false, error: error.response?.data?.error || 'Erreur utilisation crédit', details: error.message });
    }
});

app.post('/api/credit/refund', checkAuth, async (req, res) => {
    try {
        const { phone_number, amount, order_id, version } = req.body;
        if (!phone_number || !amount || !order_id) return res.status(400).json({ success: false, error: 'phone_number, amount et order_id sont requis' });
        if (version === undefined || version === null) return res.status(400).json({ success: false, error: 'version est requise pour éviter les conflits' });
        const isLocal = process.env.NODE_ENV !== 'production';
        const externalApiUrl = isLocal ? 'http://localhost:4000/api/external/clients/credits/refund' : 'https://matix-livreur-backend.onrender.com/api/external/clients/credits/refund';
        const apiKey = process.env.EXTERNAL_API_KEY;
        if (!apiKey) throw new Error('EXTERNAL_API_KEY manquant');
        const response = await axios.post(externalApiUrl, { phone_number, amount, order_id, version }, { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 10000 });
        res.json(response.data);
    } catch (error) {
        console.error('Erreur credit/refund:', error.message);
        res.status(error.response?.status || 500).json({ success: false, error: error.response?.data?.error || 'Erreur remboursement crédit', details: error.message });
    }
});

console.log('✅ Routes POS intégrées avec succès');

// ===== REALTIME DASHBOARD =====

// Dernières mises à jour des ventes et transferts par PDV
app.get('/api/realtime/last-updates', checkAuth, async (req, res) => {
    console.log('🌐 [LAST-UPDATES] ========== DÉBUT ==========');
    try {
        const user = req.user;
        if (user.role !== 'superviseur' && user.role !== 'SuperUtilisateur' && user.role !== 'superutilisateur') {
            return res.status(403).json({ success: false, message: 'Accès refusé. Réservé aux Superviseurs et SuperUtilisateurs.' });
        }

        let targetDate;
        if (req.query.date) {
            targetDate = req.query.date;
        } else {
            const today = new Date();
            targetDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        }

        const [year, month, day] = targetDate.split('-');
        const targetDateDDMMYYYY = `${day}-${month}-${year}`;

        console.log('🌐 [LAST-UPDATES] Date cible:', targetDate, '/', targetDateDDMMYYYY);

        const lastVentes = await Vente.findAll({
            attributes: ['pointVente', [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastUpdate']],
            where: { [Op.or]: [{ date: targetDate }, { date: targetDateDDMMYYYY }] },
            group: ['pointVente'],
            raw: true
        });

        const lastTransferts = await Transfert.findAll({
            attributes: ['pointVente', [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastUpdate']],
            where: { [Op.or]: [{ date: targetDate }, { date: targetDateDDMMYYYY }, { date: `${day}/${month}/${year}` }] },
            group: ['pointVente'],
            raw: true
        });

        const formattedVentes = {};
        lastVentes.forEach(item => { formattedVentes[item.pointVente] = item.lastUpdate; });

        const formattedTransferts = {};
        lastTransferts.forEach(item => { formattedTransferts[item.pointVente] = item.lastUpdate; });

        console.log('✅ [LAST-UPDATES] Ventes:', lastVentes.length, '/ Transferts:', lastTransferts.length);
        console.log('🌐 [LAST-UPDATES] ========== FIN ==========');

        res.json({ success: true, date: targetDate, data: { ventes: formattedVentes, transferts: formattedTransferts } });

    } catch (error) {
        console.error('❌ [LAST-UPDATES] Erreur:', error.message);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des dernières mises à jour' });
    }
});

// Réconciliation temps réel (proxy vers external API)
app.get('/api/realtime/reconciliation', checkAuth, async (req, res) => {
    try {
        let dateStr;
        if (req.query.date) {
            const [year, month, day] = req.query.date.split('-');
            dateStr = `${day}-${month}-${year}`;
        } else {
            const today = new Date();
            dateStr = `${String(today.getDate()).padStart(2,'0')}-${String(today.getMonth()+1).padStart(2,'0')}-${today.getFullYear()}`;
        }

        const apiKey = process.env.EXTERNAL_API_KEY || 'your-secure-api-key-for-relevance';
        const response = await axios.get(`http://localhost:${PORT}/api/external/reconciliation`, {
            params: { date: dateStr },
            headers: { 'X-API-Key': apiKey }
        });

        res.json(response.data);

    } catch (error) {
        console.error('❌ [REALTIME] Erreur proxy réconciliation:', error.message);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des données' });
    }
});

// Statut paiement commandes par PDV (A=En Attente, P=Payé) depuis CommandeInfo
app.get('/api/realtime/commandes-statut', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== 'superviseur' && user.role !== 'SuperUtilisateur' && user.role !== 'superutilisateur') {
            return res.status(403).json({ success: false, message: 'Accès réservé aux Superviseurs.' });
        }

        let targetDate = req.query.date;
        if (!targetDate) {
            const today = new Date();
            targetDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        }

        const [year, month, day] = targetDate.split('-');
        const targetDateDDMMYYYY = `${day}-${month}-${year}`;

        const { CommandeInfo } = require('./db/models');

        // Récupérer toutes les ventes du jour ayant une commande_id
        const ventes = await Vente.findAll({
            attributes: ['pointVente', 'commandeId', 'montant'],
            where: {
                [Op.or]: [{ date: targetDate }, { date: targetDateDDMMYYYY }],
                commandeId: { [Op.not]: null }
            },
            raw: true
        });

        if (ventes.length === 0) {
            return res.json({ success: true, date: targetDate, data: {} });
        }

        // Récupérer les statuts de paiement pour ces commandes
        const commandeIds = [...new Set(ventes.map(v => v.commandeId).filter(Boolean))];
        const commandeInfos = await CommandeInfo.findAll({
            attributes: ['commande_id', 'payment_status'],
            where: { commande_id: { [Op.in]: commandeIds } },
            raw: true
        });

        // Mapper commande_id → payment_status
        const statusMap = {};
        commandeInfos.forEach(ci => { statusMap[ci.commande_id] = ci.payment_status || 'A'; });

        // Agréger montant par PDV et statut
        const result = {};
        ventes.forEach(v => {
            const pdv = v.pointVente;
            const status = statusMap[v.commandeId] || 'A';
            const montant = parseFloat(v.montant) || 0;

            if (!result[pdv]) result[pdv] = { A: 0, P: 0, M: 0, PP: 0, C: 0 };
            if (result[pdv][status] !== undefined) {
                result[pdv][status] += montant;
            } else {
                result[pdv]['A'] += montant;
            }
        });

        res.json({ success: true, date: targetDate, data: result });

    } catch (error) {
        console.error('❌ [COMMANDES-STATUT] Erreur:', error.message);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// Ventes de packs agrégées (proxy vers external API)
app.get('/api/realtime/packs', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== 'superviseur' && user.role !== 'SuperUtilisateur' && user.role !== 'superutilisateur') {
            return res.status(403).json({ success: false, message: 'Accès réservé aux Superviseurs et SuperUtilisateurs.' });
        }

        let targetDate = req.query.date;
        if (!targetDate) {
            const today = new Date();
            targetDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        }

        const apiKey = process.env.EXTERNAL_API_KEY || 'your-secure-api-key-for-relevance';
        const response = await axios.get(`http://localhost:${PORT}/api/external/ventes-date/pack/aggregated`, {
            params: { start_date: targetDate, end_date: targetDate },
            headers: { 'X-API-Key': apiKey }
        });

        res.json(response.data);

    } catch (error) {
        console.error('❌ [REALTIME] Erreur récupération packs:', error.message);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des ventes de packs' });
    }
});

// ===== WEBORDERS =====
const { WebOrder } = require('./db/models');

app.get('/api/realtime/weborders/recent', checkAuth, async (req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        const orders = await WebOrder.findAll({
            where: { createdAt: { [Op.gte]: sevenDaysAgo, [Op.lte]: now } },
            order: [['createdAt', 'DESC']]
        });
        res.json({ success: true, count: orders.length, orders });
    } catch (error) {
        console.error('Erreur weborders/recent:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
    }
});

app.get('/api/realtime/weborders', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== 'superviseur' && user.role !== 'SuperUtilisateur' && user.role !== 'superutilisateur') {
            return res.status(403).json({ success: false, message: 'Accès réservé aux Superviseurs.' });
        }
        let targetDate = req.query.date;
        if (!targetDate) {
            const today = new Date();
            targetDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        }
        const orders = await WebOrder.findAll({
            where: sequelize.where(sequelize.fn('DATE', sequelize.col('order_date')), targetDate),
            order: [[sequelize.col('order_date'), 'DESC'], [sequelize.col('created_at'), 'DESC']]
        });
        res.json({ success: true, count: orders.length, data: orders });
    } catch (error) {
        console.error('Erreur realtime/weborders:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

app.get('/api/weborders', checkAuth, async (req, res) => {
    try {
        const orders = await WebOrder.findAll({ order: [['createdAt', 'DESC']] });
        res.json({ success: true, count: orders.length, data: orders });
    } catch (error) {
        console.error('Erreur GET weborders:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

app.post('/api/weborders/:id/assign', checkAuth, async (req, res) => {
    let transaction;
    try {
        const user = req.user;
        const orderId = req.params.id;
        const { username } = req.body;
        if (username !== user.username) return res.status(403).json({ success: false, message: 'Vous ne pouvez vous assigner que vous-même' });
        transaction = await sequelize.transaction();
        const order = await WebOrder.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!order) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'Commande non trouvée' }); }
        if (order.assignedTo && order.assignedTo !== user.username) { await transaction.rollback(); return res.status(400).json({ success: false, message: `Commande déjà assignée à ${order.assignedTo}` }); }
        if (order.convertedToPOS) { await transaction.rollback(); return res.status(400).json({ success: false, message: 'Commande déjà convertie' }); }
        order.assignedTo = user.username;
        order.assignedAt = new Date();
        await order.save({ transaction });
        await transaction.commit();
        res.json({ success: true, message: 'Commande assignée', order });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Erreur weborder assign:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'assignation' });
    }
});

app.post('/api/weborders/:id/unassign', checkAuth, async (req, res) => {
    let transaction;
    try {
        const user = req.user;
        const orderId = req.params.id;
        transaction = await sequelize.transaction();
        const order = await WebOrder.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!order) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'Commande non trouvée' }); }
        if (order.assignedTo !== user.username) { await transaction.rollback(); return res.status(403).json({ success: false, message: 'Vous ne pouvez désassigner que vos propres commandes' }); }
        if (order.convertedToPOS) { await transaction.rollback(); return res.status(400).json({ success: false, message: 'Commande déjà convertie' }); }
        order.assignedTo = null;
        order.assignedAt = null;
        await order.save({ transaction });
        await transaction.commit();
        res.json({ success: true, message: 'Désassignation réussie', order });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Erreur weborder unassign:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la désassignation' });
    }
});

app.post('/api/weborders/:id/convert', checkAuth, async (req, res) => {
    let transaction;
    try {
        const user = req.user;
        const orderId = req.params.id;
        const { posVenteId } = req.body;
        transaction = await sequelize.transaction();
        const order = await WebOrder.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!order) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'Commande non trouvée' }); }
        if (order.convertedToPOS) { await transaction.rollback(); return res.status(400).json({ success: false, message: 'Commande déjà convertie' }); }
        if (order.assignedTo && order.assignedTo !== user.username) { await transaction.rollback(); return res.status(403).json({ success: false, message: 'Commande assignée à un autre utilisateur' }); }
        order.convertedToPOS = true;
        order.convertedAt = new Date();
        order.convertedBy = user.username;
        order.posVenteId = posVenteId;
        await order.save({ transaction });
        await transaction.commit();
        res.json({ success: true, message: 'Commande convertie avec succès', order });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Erreur weborder convert:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la conversion' });
    }
});

app.post('/api/weborders/:id/archive', checkAuth, async (req, res) => {
    try {
        const user = req.user;
        const orderId = req.params.id;
        const result = await sequelize.transaction(async (t) => {
            const order = await WebOrder.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!order) throw { statusCode: 404, success: false, message: 'Commande non trouvée' };
            if (order.convertedToPOS) throw { statusCode: 400, success: false, message: 'Commande déjà marquée effectuée' };
            if (order.assignedTo && order.assignedTo !== user.username) throw { statusCode: 403, success: false, message: 'Commande assignée à un autre utilisateur' };
            order.convertedToPOS = true;
            order.convertedAt = new Date();
            order.convertedBy = user.username;
            order.posVenteId = null;
            await order.save({ transaction: t });
            return { success: true, message: 'Commande marquée comme effectuée', order };
        });
        res.json(result);
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ success: error.success, message: error.message });
        console.error('Erreur weborder archive:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'archivage' });
    }
});

// ===== DAY SCREENING =====
const dayScreeningCache = new Map();
const dayScreeningStatus = new Map();

app.post('/api/day-screening/start', checkAuth, async (req, res) => {
    try {
        const { date, pointVente: reqPointVente, forceRefresh } = req.body;
        const pointVente = (reqPointVente === 'tous' || !reqPointVente) ? 'tous' : reqPointVente;
        const cacheKey = `${date}_${pointVente}`;
        if (forceRefresh) { dayScreeningCache.delete(cacheKey); dayScreeningStatus.delete(cacheKey); }
        if (!forceRefresh && dayScreeningCache.has(cacheKey)) {
            const cached = dayScreeningCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 30 * 60 * 1000) {
                return res.json({ success: true, fromCache: true, timestamp: cached.timestamp, results: cached.results });
            }
        }
        dayScreeningStatus.set(cacheKey, { status: 'in_progress', startTime: Date.now() });
        res.json({ success: true, message: 'Analyse lancée en background', cacheKey });
    } catch (error) {
        console.error('Erreur day-screening start:', error);
        res.status(500).json({ success: false, message: 'Erreur lors du lancement', error: error.message });
    }
});

app.get('/api/day-screening/status', checkAuth, async (req, res) => {
    try {
        const today = new Date();
        const defaultDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        const date = req.query.date || defaultDate;
        const reqPointVente = req.query.pointVente || req.session.user.pointVente;
        const pointVente = (reqPointVente === 'tous' || !reqPointVente) ? 'tous' : reqPointVente;
        const cacheKey = `${date}_${pointVente}`;
        const status = dayScreeningStatus.get(cacheKey) || { status: 'not_started' };
        res.json({ success: true, ...status });
    } catch (error) {
        console.error('Erreur day-screening status:', error);
        res.status(500).json({ success: false, message: 'Erreur', error: error.message });
    }
});

console.log('✅ Routes weborders et day-screening POS chargées');