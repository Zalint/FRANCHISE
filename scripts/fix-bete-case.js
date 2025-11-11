/**
 * Script pour normaliser la casse du champ "bete"
 * Convertit "Boeuf" en "boeuf" et "Veau" en "veau"
 */

const { PerformanceAchat, sequelize } = require('../db/models');

async function fixBeteCase() {
    console.log('🔧 Normalisation de la casse du champ "bete"...\n');
    
    try {
        // Mettre à jour Boeuf -> boeuf
        const boeufUpdated = await PerformanceAchat.update(
            { bete: 'boeuf' },
            { where: { bete: 'Boeuf' } }
        );
        
        // Mettre à jour Veau -> veau
        const veauUpdated = await PerformanceAchat.update(
            { bete: 'veau' },
            { where: { bete: 'Veau' } }
        );
        
        console.log(`✅ Boeuf -> boeuf: ${boeufUpdated[0]} entrées mises à jour`);
        console.log(`✅ Veau -> veau: ${veauUpdated[0]} entrées mises à jour`);
        
        // Vérification
        const counts = await sequelize.query(`
            SELECT bete, COUNT(*) as count
            FROM performance_achat
            GROUP BY bete
            ORDER BY bete
        `, { type: sequelize.QueryTypes.SELECT });
        
        console.log('\n📊 Répartition finale:');
        console.table(counts);
        
    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        await sequelize.close();
    }
}

fixBeteCase();

