const { sequelize } = require('./index');
const ClientAbonne = require('./models/ClientAbonne');
const PaiementAbonnement = require('./models/PaiementAbonnement');

/**
 * Script d'initialisation des tables d'abonnement
 */
async function initAbonnementsDatabase() {
    try {
        console.log('🔧 Initialisation des tables d\'abonnement...');
        
        // Test de connexion
        await sequelize.authenticate();
        console.log('✅ Connexion à la base de données réussie');
        
        // Créer la table clients_abonnes
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
        console.log('✅ Table clients_abonnes créée ou existe déjà');
        
        // Créer la table paiements_abonnement
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
        console.log('✅ Table paiements_abonnement créée ou existe déjà');
        
        // Créer les index
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_clients_abonnes_abonne_id ON clients_abonnes(abonne_id);
            CREATE INDEX IF NOT EXISTS idx_clients_abonnes_telephone ON clients_abonnes(telephone);
            CREATE INDEX IF NOT EXISTS idx_clients_abonnes_point_vente ON clients_abonnes(point_vente_defaut);
            CREATE INDEX IF NOT EXISTS idx_clients_abonnes_statut ON clients_abonnes(statut);
            CREATE INDEX IF NOT EXISTS idx_paiements_client_id ON paiements_abonnement(client_id);
            CREATE INDEX IF NOT EXISTS idx_paiements_mois ON paiements_abonnement(mois);
        `);
        console.log('✅ Index créés');
        
        // Ajouter les colonnes à la table ventes si elles n'existent pas
        try {
            await sequelize.query(`
                ALTER TABLE ventes 
                ADD COLUMN IF NOT EXISTS client_abonne_id INTEGER REFERENCES clients_abonnes(id) ON DELETE SET NULL;
            `);
            console.log('✅ Colonne client_abonne_id ajoutée à ventes');
        } catch (err) {
            console.log('ℹ️  Colonne client_abonne_id existe déjà');
        }
        
        try {
            await sequelize.query(`
                ALTER TABLE ventes 
                ADD COLUMN IF NOT EXISTS prix_normal DECIMAL(10, 2);
            `);
            console.log('✅ Colonne prix_normal ajoutée à ventes');
        } catch (err) {
            console.log('ℹ️  Colonne prix_normal existe déjà');
        }
        
        try {
            await sequelize.query(`
                ALTER TABLE ventes 
                ADD COLUMN IF NOT EXISTS rabais_applique DECIMAL(10, 2);
            `);
            console.log('✅ Colonne rabais_applique ajoutée à ventes');
        } catch (err) {
            console.log('ℹ️  Colonne rabais_applique existe déjà');
        }
        
        console.log('');
        console.log('🎉 Initialisation des tables d\'abonnement terminée avec succès !');
        console.log('');
        console.log('Vous pouvez maintenant:');
        console.log('1. Accéder à abonnements.html');
        console.log('2. Créer des clients abonnés');
        console.log('3. Gérer les paiements mensuels');
        console.log('');
        
        return true;
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
        throw error;
    }
}

// Exécuter si appelé directement
if (require.main === module) {
    initAbonnementsDatabase()
        .then(() => {
            console.log('✅ Script terminé avec succès');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erreur:', error);
            process.exit(1);
        });
}

module.exports = { initAbonnementsDatabase };

