/**
 * Script pour synchroniser stock-soir.json vers stock_auto (table PostgreSQL)
 * À exécuter une fois pour migrer les données existantes
 * 
 * Usage: node scripts/sync-stock-auto.js [date]
 * Exemple: node scripts/sync-stock-auto.js 2025-12-11
 */

const fs = require('fs');
const path = require('path');
const { sequelize, Produit, PointVente, StockAuto } = require('../db/models');

// Date à synchroniser (argument ou date du jour)
const targetDate = process.argv[2] || new Date().toISOString().split('T')[0];

console.log(`🔄 Synchronisation du stock-soir vers stock_auto pour le ${targetDate}`);

async function syncStockAuto() {
    try {
        // Chemin vers stock-soir.json
        const stockSoirPath = path.join(__dirname, '..', 'data', 'by-date', targetDate, 'stock-soir.json');
        
        if (!fs.existsSync(stockSoirPath)) {
            console.log(`❌ Fichier non trouvé: ${stockSoirPath}`);
            console.log(`   Vérifiez que la date est correcte et que le fichier stock-soir.json existe.`);
            process.exit(1);
        }
        
        // Lire le fichier stock-soir.json
        const stockSoir = JSON.parse(fs.readFileSync(stockSoirPath, 'utf8'));
        
        console.log(`📂 Fichier chargé: ${Object.keys(stockSoir).length} points de vente`);
        
        let updated = 0;
        let created = 0;
        let skipped = 0;
        let errors = 0;
        
        // Pour chaque point de vente
        for (const [pointVenteNom, produits] of Object.entries(stockSoir)) {
            // Trouver le point de vente dans la DB
            const pv = await PointVente.findOne({ 
                where: { nom: pointVenteNom, active: true } 
            });
            
            if (!pv) {
                console.log(`⚠️  Point de vente non trouvé: ${pointVenteNom}`);
                skipped++;
                continue;
            }
            
            // Pour chaque produit
            for (const [produitNom, data] of Object.entries(produits)) {
                try {
                    // Trouver le produit dans la DB (uniquement les automatiques)
                    const produit = await Produit.findOne({
                        where: { 
                            nom: produitNom,
                            mode_stock: 'automatique'
                        }
                    });
                    
                    if (!produit) {
                        // Produit non trouvé ou pas en mode automatique - ignorer
                        continue;
                    }
                    
                    const quantite = parseFloat(data.quantite || data.Nombre || 0);
                    const prixUnitaire = parseFloat(data.prixUnitaire || data.PU || produit.prix_defaut || 0);
                    
                    // Créer ou mettre à jour stock_auto
                    const [stockAuto, isCreated] = await StockAuto.findOrCreate({
                        where: { 
                            produit_id: produit.id, 
                            point_vente_id: pv.id 
                        },
                        defaults: {
                            quantite: quantite,
                            prix_unitaire: prixUnitaire,
                            dernier_ajustement_type: 'sync',
                            dernier_ajustement_date: new Date(targetDate)
                        }
                    });
                    
                    if (isCreated) {
                        created++;
                        console.log(`✅ Créé: ${produitNom} @ ${pointVenteNom}: ${quantite}`);
                    } else {
                        // Mettre à jour uniquement
                        await stockAuto.update({
                            quantite: quantite,
                            prix_unitaire: prixUnitaire,
                            dernier_ajustement_type: 'sync',
                            dernier_ajustement_date: new Date(targetDate)
                        });
                        updated++;
                        console.log(`🔄 Mis à jour: ${produitNom} @ ${pointVenteNom}: ${quantite}`);
                    }
                    
                } catch (err) {
                    console.error(`❌ Erreur pour ${produitNom} @ ${pointVenteNom}:`, err.message);
                    errors++;
                }
            }
        }
        
        console.log('\n📊 Résumé:');
        console.log(`   ✅ Créés: ${created}`);
        console.log(`   🔄 Mis à jour: ${updated}`);
        console.log(`   ⚠️  Ignorés: ${skipped}`);
        console.log(`   ❌ Erreurs: ${errors}`);
        console.log(`   ✔️  Total traité: ${created + updated}`);
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Erreur:', error);
        process.exit(1);
    }
}

// Lancer la synchronisation
syncStockAuto();

