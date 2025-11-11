/**
 * Script d'import des données legacy d'estimations depuis le fichier CSV Excel
 * 
 * Usage: node scripts/import-legacy-estimations.js
 * 
 * Données sources: SuiviObjectif2025.xlsx - EstimationVivant.csv
 * Acheteur par défaut: Aly KA (ACH002)
 * Prix par défaut: NULL (non renseigné)
 */

const fs = require('fs').promises;
const path = require('path');

// Load environment variables if .env.local exists
const envPath = path.join(__dirname, '..', '.env.local');
if (require('fs').existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

const { PerformanceAchat, sequelize } = require('../db/models');

/**
 * Convertit une date DD/MM/YYYY en YYYY-MM-DD
 */
function convertDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return null;
    
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Parse une ligne CSV en tenant compte des virgules dans les valeurs
 */
function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current.trim());
    
    return values;
}

/**
 * Détermine le type de bête
 * Par défaut: boeuf (minuscule) pour toutes les entrées legacy
 */
function determineBete(poidsEstime) {
    return 'boeuf';
}

/**
 * Importe les données depuis le fichier CSV
 */
async function importLegacyData() {
    console.log('🚀 Début de l\'import des données legacy...\n');
    
    const csvPath = path.join(__dirname, '..', 'SuiviObjectif2025.xlsx - EstimationVivant.csv');
    const acheteurDefaut = 'ACH002'; // Aly KA
    
    try {
        // Lire le fichier CSV
        const csvContent = await fs.readFile(csvPath, 'utf-8');
        const lines = csvContent.split('\n');
        
        console.log(`📄 Fichier CSV chargé: ${lines.length} lignes\n`);
        
        // Ignorer la première ligne (header)
        const dataLines = lines.slice(1);
        
        const entriesToImport = [];
        let skippedCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i].trim();
            if (!line) {
                skippedCount++;
                continue;
            }
            
            const columns = parseCSVLine(line);
            
            // Colonnes: Date, ID Bœuf, Poids estimé, Last Update Poids estimé, 
            //           Poids réel, Last update Poids réel, Écart, Performance, Coherence
            const [date, idBoeuf, poidsEstime, , poidsReel, , , , ] = columns;
            
            // Vérifier que nous avons les données minimales
            if (!date || !poidsEstime) {
                skippedCount++;
                continue;
            }
            
            const dateFormatted = convertDate(date);
            if (!dateFormatted) {
                console.warn(`⚠️  Ligne ${i + 2}: Date invalide "${date}"`);
                errorCount++;
                continue;
            }
            
            const poidsEstimeNum = parseFloat(poidsEstime);
            if (isNaN(poidsEstimeNum) || poidsEstimeNum <= 0) {
                console.warn(`⚠️  Ligne ${i + 2}: Poids estimé invalide "${poidsEstime}"`);
                errorCount++;
                continue;
            }
            
            // Poids réel (peut être NULL)
            let poidsReelNum = null;
            if (poidsReel && poidsReel.trim() !== '') {
                poidsReelNum = parseFloat(poidsReel);
                if (isNaN(poidsReelNum)) {
                    poidsReelNum = null;
                }
            }
            
            // Déterminer le type de bête
            const bete = determineBete(poidsEstime);
            
            // Créer l'entrée à importer
            const entry = {
                date: dateFormatted,
                id_acheteur: acheteurDefaut,
                bete: bete,
                poids_estime: poidsEstimeNum,
                poids_estime_timestamp: new Date(dateFormatted + 'T08:00:00Z'), // 8h du matin
                poids_estime_updated_by: 'import-legacy',
                poids_reel: poidsReelNum,
                poids_reel_timestamp: poidsReelNum ? new Date(dateFormatted + 'T18:00:00Z') : null, // 18h si renseigné
                poids_reel_updated_by: poidsReelNum ? 'import-legacy' : null,
                prix: null, // Prix non renseigné
                locked: false,
                commentaire: `Import legacy - ID Boeuf original: ${idBoeuf || 'N/A'}`,
                created_by: 'import-legacy'
            };
            
            entriesToImport.push(entry);
        }
        
        console.log(`📊 Résumé du parsing:`);
        console.log(`   ✅ Entrées valides: ${entriesToImport.length}`);
        console.log(`   ⏭️  Lignes ignorées: ${skippedCount}`);
        console.log(`   ❌ Erreurs: ${errorCount}\n`);
        
        // Statistiques par type de bête
        console.log(`📈 Type de bête:`);
        console.log(`   🐄 boeuf: ${entriesToImport.length} (par défaut, minuscule normalisé)\n`);
        
        // Demander confirmation
        console.log('⚠️  ATTENTION: Cette opération va insérer des données dans la base de données.');
        console.log(`   ${entriesToImport.length} entrées seront créées.\n`);
        
        // Import dans une transaction unique
        const transaction = await sequelize.transaction();
        let importedCount = 0;
        
        try {
            console.log('🔄 Import en cours dans une transaction unique...\n');
            
            // Import en batch (par groupes de 50 pour éviter les timeouts)
            const batchSize = 50;
            
            for (let i = 0; i < entriesToImport.length; i += batchSize) {
                const batch = entriesToImport.slice(i, i + batchSize);
                
                await PerformanceAchat.bulkCreate(batch, {
                    validate: true,
                    returning: false,
                    transaction
                });
                
                importedCount += batch.length;
                const progress = ((importedCount / entriesToImport.length) * 100).toFixed(1);
                console.log(`   📦 Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} entrées importées (${progress}%)`);
            }
            
            // Commit la transaction
            await transaction.commit();
            console.log(`\n✅ Transaction committée avec succès!`);
            
        } catch (error) {
            // Rollback en cas d'erreur
            await transaction.rollback();
            console.error(`\n❌ Erreur lors de l'import, transaction annulée:`, error.message);
            throw error;
        }
        
        console.log(`\n✅ Import terminé avec succès!`);
        console.log(`   ${importedCount}/${entriesToImport.length} entrées importées dans la base de données.\n`);
        
        // Afficher quelques statistiques finales
        const totalEstimations = await PerformanceAchat.count();
        console.log(`📊 Total d'estimations dans la base: ${totalEstimations}`);
        
        const avgPoidsEstime = await PerformanceAchat.findOne({
            attributes: [
                [PerformanceAchat.sequelize.fn('AVG', PerformanceAchat.sequelize.col('poids_estime')), 'avg']
            ],
            where: {
                created_by: 'import-legacy'
            }
        });
        
        if (avgPoidsEstime) {
            console.log(`📏 Poids estimé moyen (legacy): ${parseFloat(avgPoidsEstime.dataValues.avg).toFixed(2)} kg`);
        }
        
    } catch (error) {
        console.error('\n❌ Erreur lors de l\'import:', error);
        throw error;
    }
}

// Exécution du script
if (require.main === module) {
    importLegacyData()
        .then(async () => {
            console.log('\n👍 Script terminé.');
            await sequelize.close();
            console.log('🔌 Connexion DB fermée.');
            process.exit(0);
        })
        .catch(async (error) => {
            console.error('\n💥 Erreur fatale:', error);
            await sequelize.close();
            process.exit(1);
        });
}

module.exports = { importLegacyData };

