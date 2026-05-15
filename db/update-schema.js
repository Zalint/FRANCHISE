const { sequelize } = require('./index');
const Reconciliation = require('./models/Reconciliation');
const CashPayment = require('./models/CashPayment');
const FournisseurPaiement = require('./models/FournisseurPaiement');
const FournisseurPrix = require('./models/FournisseurPrix');
const ProduitAlias = require('./models/ProduitAlias');
const PrixVenteHistory = require('./models/PrixVenteHistory');
const PrixAchatHistory = require('./models/PrixAchatHistory');
const FinanceConfig = require('./models/FinanceConfig');

/**
 * Met à jour le schéma de la base de données sans perdre les données existantes
 */
async function updateSchema() {
    try {
        console.log('Début de la mise à jour du schéma de la base de données...');
        
        // Vérifier l'existence de la table reconciliations
        const tableExists = await checkTableExists('reconciliations');
        
        if (tableExists) {
            console.log('La table reconciliations existe déjà');
            
            // Vérifier si les nouvelles colonnes existent déjà
            const hasNewColumns = await checkColumnsExist('reconciliations', [
                'cashPaymentData', 'comments', 'calculated', 'version'
            ]);
            
            if (!hasNewColumns) {
                console.log('Ajout des nouvelles colonnes à la table reconciliations...');
                
                // Ajouter les nouvelles colonnes
                await sequelize.query(`
                    ALTER TABLE reconciliations
                    ADD COLUMN IF NOT EXISTS "cashPaymentData" TEXT,
                    ADD COLUMN IF NOT EXISTS "comments" TEXT,
                    ADD COLUMN IF NOT EXISTS "calculated" BOOLEAN DEFAULT TRUE,
                    ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1
                `);
                
                console.log('Colonnes ajoutées avec succès');
                
                // Migrer les données existantes vers le nouveau format
                await migrateExistingData();
            } else {
                console.log('Les nouvelles colonnes existent déjà');
            }
        } else {
            console.log('La table reconciliations n\'existe pas, création...');
            await Reconciliation.sync();
            console.log('Table reconciliations créée avec succès');
        }
        
        // Vérifier/créer la table des paiements en espèces
        const cashPaymentTableExists = await checkTableExists('cash_payments');
        if (!cashPaymentTableExists) {
            console.log('La table cash_payments n\'existe pas, création...');
            await CashPayment.sync();
            console.log('Table cash_payments créée avec succès');
        } else {
            console.log('La table cash_payments existe déjà');
        }
        
        // Ajouter la colonne default_screen à la table users si elle n'existe pas
        await sequelize.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS default_screen VARCHAR(100) DEFAULT NULL
        `);
        console.log('Colonne default_screen vérifiée/ajoutée dans la table users');

        // Finance: table fournisseur_paiements (CRUD onglet Creances Fournisseur).
        const fournisseurPaiementsExists = await checkTableExists('fournisseur_paiements');
        if (!fournisseurPaiementsExists) {
            console.log('Table fournisseur_paiements manquante, creation...');
            await FournisseurPaiement.sync();
            console.log('Table fournisseur_paiements creee');
        } else {
            // Defense en profondeur: si la table existe mais sans la colonne
            // point_vente (ancienne version), on l'ajoute.
            await sequelize.query(`
                ALTER TABLE fournisseur_paiements
                ADD COLUMN IF NOT EXISTS point_vente VARCHAR(100) DEFAULT NULL
            `);
        }

        // Finance: catalogue prix fournisseur (base du resolver + commission 3%).
        const fournisseurPrixExists = await checkTableExists('fournisseur_prix');
        if (!fournisseurPrixExists) {
            console.log('Table fournisseur_prix manquante, creation...');
            await FournisseurPrix.sync();
            console.log('Table fournisseur_prix creee');
        }
        // Seed des prix par defaut (port Maas: 5 produits boucherie).
        // ON CONFLICT DO NOTHING => idempotent, ne touche pas aux prix
        // deja saisis cote prod.
        await sequelize.query(`
            INSERT INTO fournisseur_prix (produit, prix_vente, prix_achat, updated_at) VALUES
              ('Boeuf',  4350, 3835, NOW()),
              ('Veau',   4600, 4035, NOW()),
              ('Agneau', 5300, 4500, NOW()),
              ('Poulet', 3500, 2600, NOW()),
              ('Laxass',  300,  200, NOW())
            ON CONFLICT (produit) DO NOTHING
        `);
        // Backfill Poulet.prix_achat si NULL (ex: deploiement anterieur qui
        // avait seede Poulet avec NULL). N'ecrase pas une valeur deja saisie.
        await sequelize.query(`
            UPDATE fournisseur_prix
            SET prix_achat = 2600, updated_at = NOW()
            WHERE produit = 'Poulet' AND prix_achat IS NULL
        `);
        console.log('Table fournisseur_prix: seed 5 produits applique (idempotent)');

        // Finance: aliases produits (libelle vente -> entree catalogue).
        const produitAliasExists = await checkTableExists('produit_alias');
        if (!produitAliasExists) {
            console.log('Table produit_alias manquante, creation...');
            await ProduitAlias.sync();
            console.log('Table produit_alias creee');
        }
        // Seed des aliases reels FRANCHISE (libelles observes en BDD).
        // ON CONFLICT DO NOTHING => idempotent, ne touche pas aux mappings
        // deja saisis manuellement cote prod.
        // Couvre les variantes "en gros / en detail / encodage casse '??'".
        await sequelize.query(`
            INSERT INTO produit_alias (alias_produit, produit_catalog, updated_at) VALUES
              -- Bovin: morceaux Boeuf et toutes les variantes
              ('Boeuf en gros',     'Boeuf',  NOW()),
              ('Boeuf En Gros',     'Boeuf',  NOW()),
              ('Boeuf en détail',   'Boeuf',  NOW()),
              ('Boeuf en detail',   'Boeuf',  NOW()),
              ('Boeuf En Détail',   'Boeuf',  NOW()),
              ('Boeuf en d??tail',  'Boeuf',  NOW()),
              ('Boeuf sur pied',    'Boeuf',  NOW()),
              ('Foie',              'Boeuf',  NOW()),
              ('Yell',              'Boeuf',  NOW()),
              ('Abats',             'Boeuf',  NOW()),
              ('Dechet',            'Boeuf',  NOW()),
              ('Jarret',            'Boeuf',  NOW()),
              ('Sans Os',           'Boeuf',  NOW()),
              ('Filet',             'Boeuf',  NOW()),
              ('Faux Filet',        'Boeuf',  NOW()),
              ('Merguez',           'Boeuf',  NOW()),
              ('Peaux',             'Boeuf',  NOW()),
              ('Viande hachée',     'Boeuf',  NOW()),
              ('Viande Hach??e',    'Boeuf',  NOW()),
              ('Viande hach??e',    'Boeuf',  NOW()),
              -- Veau
              ('Veau en gros',      'Veau',   NOW()),
              ('Veau En Gros',      'Veau',   NOW()),
              ('Veau en détail',    'Veau',   NOW()),
              ('Veau en detail',    'Veau',   NOW()),
              ('Veau En Détail',    'Veau',   NOW()),
              ('Veau en d??tail',   'Veau',   NOW()),
              ('Veau sur pied',     'Veau',   NOW()),
              -- Ovin (mouton/agneau)
              ('Mouton',            'Agneau', NOW()),
              ('Mouton en gros',    'Agneau', NOW()),
              ('Mouton en détail',  'Agneau', NOW()),
              ('Mouton en detail',  'Agneau', NOW()),
              ('Tete Agneau',       'Agneau', NOW()),
              ('Tête Agneau',       'Agneau', NOW()),
              ('Agneau en gros',    'Agneau', NOW()),
              ('Agneau en détail',  'Agneau', NOW()),
              ('Agneau en detail',  'Agneau', NOW()),
              -- Caprin
              ('Chevre sur pied',   'Agneau', NOW()),
              ('Chèvre sur pied',   'Agneau', NOW()),
              -- Volaille
              ('Poulet en gros',    'Poulet', NOW()),
              ('Poulet en détail',  'Poulet', NOW()),
              ('Poulet en detail',  'Poulet', NOW()),
              ('Poulet en d??tail', 'Poulet', NOW()),
              ('Pilon',             'Poulet', NOW()),
              ('Merguez poulet',    'Poulet', NOW()),
              ('Oeuf',              'Poulet', NOW()),
              ('Pack Pigeon',       'Poulet', NOW())
            ON CONFLICT (alias_produit) DO NOTHING
        `);
        console.log('Table produit_alias: seed aliases FRANCHISE applique (idempotent)');

        // Finance: table cle/valeur des parametres (commission_pct, categories_eligibles, ...).
        const financeConfigExists = await checkTableExists('finance_config');
        if (!financeConfigExists) {
            console.log('Table finance_config manquante, creation...');
            await FinanceConfig.sync();
            console.log('Table finance_config creee');
        }
        // Seed des cles par defaut. ON CONFLICT DO NOTHING => idempotent.
        await sequelize.query(`
            INSERT INTO finance_config (key, value, updated_at) VALUES
              ('commission_pct',       '3.0',                                   NOW()),
              ('categories_eligibles', 'Bovin,Ovin,Caprin,Volaille,Poisson',    NOW())
            ON CONFLICT (key) DO NOTHING
        `);
        console.log('Table finance_config: seed commission_pct=3.0 + categories_eligibles applique (idempotent)');

        // Finance: historique point-in-time du prix_vente catalogue (commission 3%).
        const prixVenteHistoryExists = await checkTableExists('prix_vente_history');
        if (!prixVenteHistoryExists) {
            console.log('Table prix_vente_history manquante, creation...');
            await PrixVenteHistory.sync();
            console.log('Table prix_vente_history creee');
        }
        // Genesis seed: 1 ligne created_at = epoch 1970 par produit catalogue.
        // Garantit que toute vente, meme anterieure, resoud un prix_vente
        // point-in-time non nul. Idempotent (skip si une entree existe deja).
        await sequelize.query(`
            INSERT INTO prix_vente_history (produit, prix_vente, changed_by, created_at)
            SELECT fp.produit, fp.prix_vente, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
            FROM fournisseur_prix fp
            WHERE NOT EXISTS (
                SELECT 1 FROM prix_vente_history h WHERE h.produit = fp.produit
            )
        `);
        console.log('prix_vente_history: genesis seedee (1970-01-01)');

        // Finance: historique point-in-time du prix_achat catalogue.
        const prixAchatHistoryExists = await checkTableExists('prix_achat_history');
        if (!prixAchatHistoryExists) {
            console.log('Table prix_achat_history manquante, creation...');
            await PrixAchatHistory.sync();
            console.log('Table prix_achat_history creee');
        }
        // Genesis seed (skip si prix_achat IS NULL, ex: Poulet).
        await sequelize.query(`
            INSERT INTO prix_achat_history (produit, prix_achat, changed_by, created_at)
            SELECT fp.produit, fp.prix_achat, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
            FROM fournisseur_prix fp
            WHERE fp.prix_achat IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM prix_achat_history h WHERE h.produit = fp.produit
              )
        `);
        console.log('prix_achat_history: genesis seedee (1970-01-01)');

        console.log('Mise à jour du schéma terminée avec succès');
        return true;
    } catch (error) {
        console.error('Erreur lors de la mise à jour du schéma:', error);
        throw error;
    }
}

/**
 * Vérifie si une table existe dans la base de données
 */
async function checkTableExists(tableName) {
    try {
        const query = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public'
                AND table_name = :tableName
            )
        `;
        
        const result = await sequelize.query(query, {
            replacements: { tableName },
            type: sequelize.QueryTypes.SELECT,
            plain: true
        });
        
        return result.exists;
    } catch (error) {
        console.error(`Erreur lors de la vérification de l'existence de la table ${tableName}:`, error);
        throw error;
    }
}

/**
 * Vérifie si les colonnes spécifiées existent dans la table
 */
async function checkColumnsExist(tableName, columnNames) {
    try {
        // Construction d'une requête qui compte les colonnes existantes
        const placeholders = columnNames.map((col, idx) => `:col${idx}`).join(', ');
        const replacements = {};
        columnNames.forEach((col, idx) => {
            replacements[`col${idx}`] = col;
        });
        replacements.tableName = tableName;
        
        const query = `
            SELECT COUNT(*) as count
            FROM information_schema.columns
            WHERE table_name = :tableName
            AND column_name IN (${placeholders})
        `;
        
        const result = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT,
            plain: true
        });
        
        // Si le nombre de colonnes trouvées correspond au nombre de colonnes recherchées
        return result.count == columnNames.length;
    } catch (error) {
        console.error(`Erreur lors de la vérification des colonnes dans la table ${tableName}:`, error);
        throw error;
    }
}

/**
 * Migre les données existantes vers le nouveau format
 */
async function migrateExistingData() {
    try {
        console.log('Début de la migration des données existantes...');
        
        // Récupérer toutes les réconciliations
        const reconciliations = await sequelize.query(
            'SELECT id, data FROM reconciliations',
            { type: sequelize.QueryTypes.SELECT }
        );
        
        console.log(`${reconciliations.length} réconciliations trouvées à migrer`);
        
        // Pour chaque réconciliation, extraire les commentaires et les stocker dans la nouvelle colonne
        for (const rec of reconciliations) {
            try {
                let data;
                let comments = {};
                
                // Parser les données
                try {
                    data = typeof rec.data === 'string' ? JSON.parse(rec.data) : rec.data;
                } catch (e) {
                    console.error(`Erreur lors du parsing des données pour l'ID ${rec.id}:`, e);
                    continue; // Passer à la suivante
                }
                
                // Extraire les données de réconciliation selon la structure
                let reconciliationData;
                if (data.reconciliation) {
                    reconciliationData = data.reconciliation;
                } else if (data.data && data.data.reconciliation) {
                    reconciliationData = data.data.reconciliation;
                } else {
                    reconciliationData = data;
                }
                
                // Extraire les commentaires
                if (reconciliationData && typeof reconciliationData === 'object') {
                    Object.entries(reconciliationData).forEach(([pointVente, pointData]) => {
                        if (pointData && pointData.commentaire) {
                            comments[pointVente] = pointData.commentaire;
                        }
                    });
                }
                
                // Mettre à jour l'enregistrement avec les nouvelles données structurées
                await sequelize.query(
                    `UPDATE reconciliations 
                     SET "comments" = :comments,
                         "calculated" = TRUE,
                         "version" = 1
                     WHERE id = :id`,
                    {
                        replacements: {
                            id: rec.id,
                            comments: JSON.stringify(comments)
                        }
                    }
                );
                
                console.log(`Réconciliation ID ${rec.id} migrée avec succès`);
                
            } catch (error) {
                console.error(`Erreur lors de la migration de la réconciliation ID ${rec.id}:`, error);
                // Continuer malgré l'erreur
            }
        }
        
        console.log('Migration des données terminée');
        
    } catch (error) {
        console.error('Erreur lors de la migration des données:', error);
        throw error;
    }
}

// Exécuter la mise à jour si le script est appelé directement
if (require.main === module) {
    updateSchema()
        .then(() => {
            console.log('Mise à jour du schéma terminée avec succès');
            process.exit(0);
        })
        .catch(error => {
            console.error('Erreur lors de la mise à jour du schéma:', error);
            process.exit(1);
        });
}

module.exports = { updateSchema }; 