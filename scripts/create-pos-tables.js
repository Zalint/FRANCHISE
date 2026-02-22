/**
 * Script de création des tables POS manquantes
 * Tables: web_orders, commande_infos, clotures_caisse
 */
require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
});

const { sequelize } = require('../db/index');
const CommandeInfo = require('../db/models/CommandeInfo');
const ClotureCaisse = require('../db/models/ClotureCaisse');

async function createPosTables() {
    try {
        console.log('🔌 Connexion à la base de données...');
        await sequelize.authenticate();
        console.log('✅ Connexion OK');

        console.log('\n📋 Création des tables POS (si elles n\'existent pas)...');

        await CommandeInfo.sync({ alter: false, force: false });
        console.log('✅ Table commande_infos OK');

        await ClotureCaisse.sync({ alter: false, force: false });
        console.log('✅ Table clotures_caisse OK');

        console.log('\n🎉 Tables POS prêtes (web_orders ignorée).');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Erreur lors de la création des tables:', error.message);
        console.error(error);
        process.exit(1);
    }
}

createPosTables();
