/**
 * Script de vérification de l'import des données legacy
 */

const { PerformanceAchat, sequelize } = require('../db/models');

async function verifyImport() {
    console.log('🔍 Vérification des données importées...\n');
    
    try {
        // Compter les entrées legacy
        const legacyCount = await PerformanceAchat.count({
            where: { created_by: 'import-legacy' }
        });
        
        console.log(`✅ Entrées legacy trouvées: ${legacyCount}`);
        
        // Récupérer quelques exemples
        const samples = await PerformanceAchat.findAll({
            where: { created_by: 'import-legacy' },
            order: [['date', 'DESC']],
            limit: 10,
            raw: true
        });
        
        console.log('\n📊 Exemples de données importées (10 plus récentes):');
        console.log('─'.repeat(100));
        console.table(samples.map(s => ({
            Date: s.date,
            Bête: s.bete,
            'P. Estimé': s.poids_estime + ' kg',
            'P. Réel': s.poids_reel ? s.poids_reel + ' kg' : 'N/A',
            'Acheteur': s.id_acheteur,
            'Commentaire': s.commentaire?.substring(0, 30) + '...'
        })));
        
        // Statistiques par mois
        const statsByMonth = await sequelize.query(`
            SELECT 
                TO_CHAR(date, 'YYYY-MM') as mois,
                COUNT(*) as nombre,
                ROUND(AVG(poids_estime)::numeric, 2) as poids_moyen_estime,
                ROUND(AVG(poids_reel)::numeric, 2) as poids_moyen_reel
            FROM performance_achat
            WHERE created_by = 'import-legacy'
            GROUP BY TO_CHAR(date, 'YYYY-MM')
            ORDER BY mois DESC
        `, { type: sequelize.QueryTypes.SELECT });
        
        console.log('\n📅 Répartition par mois:');
        console.log('─'.repeat(80));
        console.table(statsByMonth);
        
        console.log('\n✅ Vérification terminée !');
        console.log(`\n💡 Pour voir les données dans l'interface web: http://localhost:3000/performanceAchat.html`);
        
    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        await sequelize.close();
    }
}

verifyImport();

