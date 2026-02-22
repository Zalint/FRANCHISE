/**
 * Migration: Ajout des colonnes manquantes à la table ventes
 * pour supporter les commandes groupées (commande_id)
 */
require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
});

const { sequelize } = require('../db/index');

async function addCommandeColumns() {
    try {
        console.log('🔌 Connexion à la base de données...');
        await sequelize.authenticate();
        console.log('✅ Connexion OK\n');

        console.log('📋 Ajout des colonnes manquantes à la table ventes...');

        await sequelize.query(`
            ALTER TABLE ventes
                ADD COLUMN IF NOT EXISTS commande_id VARCHAR(100),
                ADD COLUMN IF NOT EXISTS instructions_client TEXT,
                ADD COLUMN IF NOT EXISTS statut_preparation VARCHAR(20) DEFAULT 'en_preparation',
                ADD COLUMN IF NOT EXISTS livreur_assigne VARCHAR(100),
                ADD COLUMN IF NOT EXISTS montant_restant_du DECIMAL(10,2) DEFAULT 0
        `);
        console.log('✅ Colonnes ajoutées : commande_id, instructions_client, statut_preparation, livreur_assigne, montant_restant_du');

        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_ventes_commande_id ON ventes(commande_id)
        `);
        console.log('✅ Index sur commande_id créé');

        // Vérification finale
        const [cols] = await sequelize.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'ventes' 
            ORDER BY ordinal_position
        `);
        console.log('\n📊 Colonnes actuelles de la table ventes:');
        cols.forEach(c => console.log(`   - ${c.column_name} (${c.data_type})`));

        console.log('\n🎉 Migration terminée avec succès.');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
        process.exit(1);
    }
}

addCommandeColumns();
