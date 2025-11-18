/**
 * Script pour créer la table audit_client_logs
 * Exécuter avec: node run-audit-logs-migration.js
 */

require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
});

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration de la base de données
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
    try {
        console.log('🚀 Début de la migration: création de la table audit_client_logs...');
        
        // Lire le fichier SQL
        const migrationFile = path.join(__dirname, 'migrations', 'create-audit-client-logs-table.sql');
        const sql = fs.readFileSync(migrationFile, 'utf8');
        
        // Exécuter la migration
        await pool.query(sql);
        
        console.log('✅ Table audit_client_logs créée avec succès !');
        console.log('✅ Index créés');
        console.log('✅ Triggers configurés');
        console.log('');
        console.log('📋 Résumé:');
        console.log('  - Table: audit_client_logs');
        console.log('  - Colonnes: 17');
        console.log('  - Index: 6');
        console.log('  - Triggers: 1 (update timestamp)');
        console.log('');
        console.log('🎉 Migration terminée avec succès !');
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Exécuter la migration
runMigration();

