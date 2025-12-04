/**
 * Script de migration des fichiers de configuration vers la base de données
 * 
 * Ce script migre les données des fichiers suivants :
 * - users.json → Table users
 * - points-vente.js → Table points_vente
 * - produits.js → Tables categories, produits, prix_point_vente
 * - produitsAbonnement.js → Tables produits (type: abonnement)
 * - produitsInventaire.js → Tables produits (type: inventaire)
 * 
 * Usage: node scripts/migrate-config-to-db.js [--force]
 * --force : Supprime et recrée les tables (ATTENTION: perte de données)
 */

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Charger les modèles
const {
  User,
  PointVente,
  UserPointVente,
  Category,
  Produit,
  PrixPointVente,
  PrixHistorique,
  syncNewModels,
  sequelize
} = require('../db/models');

// Charger les fichiers de configuration existants
const produitsVente = require('../produits');
const produitsAbonnement = require('../produitsAbonnement');
const produitsInventaire = require('../produitsInventaire');
const pointsVenteConfig = require('../points-vente');

// Chemin vers users.json
const usersJsonPath = path.join(__dirname, '..', 'data', 'by-date', 'users.json');

// Catégories dans l'ordre d'affichage
const CATEGORIES_ORDRE = ['Bovin', 'Ovin', 'Volaille', 'Pack', 'Caprin', 'Autres'];

/**
 * Migration des points de vente
 */
async function migratePointsVente() {
  console.log('\n📍 Migration des points de vente...');
  
  const pointsVenteList = Object.keys(pointsVenteConfig);
  let created = 0;
  let updated = 0;
  
  for (const nom of pointsVenteList) {
    const config = pointsVenteConfig[nom];
    const [pointVente, wasCreated] = await PointVente.findOrCreate({
      where: { nom },
      defaults: {
        active: config.active !== false
      }
    });
    
    if (wasCreated) {
      created++;
      console.log(`  ✅ Créé: ${nom}`);
    } else {
      await pointVente.update({ active: config.active !== false });
      updated++;
      console.log(`  🔄 Mis à jour: ${nom}`);
    }
  }
  
  console.log(`  📊 Total: ${created} créés, ${updated} mis à jour`);
  return await PointVente.findAll();
}

/**
 * Migration des utilisateurs
 */
async function migrateUsers(pointsVenteMap) {
  console.log('\n👤 Migration des utilisateurs...');
  
  let usersData = [];
  
  // Lire le fichier users.json s'il existe
  if (fs.existsSync(usersJsonPath)) {
    const content = fs.readFileSync(usersJsonPath, 'utf8');
    usersData = JSON.parse(content);
    console.log(`  📄 Fichier users.json trouvé avec ${usersData.length} utilisateurs`);
  } else {
    console.log('  ⚠️ Fichier users.json non trouvé, création de l\'admin par défaut');
  }
  
  // S'assurer qu'il y a toujours un admin
  const adminExists = usersData.some(u => u.username === 'ADMIN' && u.role === 'admin');
  if (!adminExists) {
    // Créer un mot de passe par défaut pour l'admin
    const defaultPassword = await bcrypt.hash('Mata@2024', 10);
    usersData.unshift({
      username: 'ADMIN',
      password: defaultPassword,
      role: 'admin',
      pointVente: 'tous',
      active: true
    });
    console.log('  🔐 Admin par défaut ajouté (mot de passe: Mata@2024)');
  }
  
  let created = 0;
  let updated = 0;
  
  for (const userData of usersData) {
    // Déterminer si l'utilisateur a accès à tous les points
    const accesTous = userData.pointVente === 'tous' || 
                      (Array.isArray(userData.pointVente) && userData.pointVente.includes('tous'));
    
    // Mapper le rôle
    let role = userData.role;
    if (!['admin', 'superutilisateur', 'superviseur', 'user'].includes(role)) {
      role = 'user';
    }
    
    const [user, wasCreated] = await User.findOrCreate({
      where: { username: userData.username },
      defaults: {
        password: userData.password,
        role: role,
        acces_tous_points: accesTous,
        active: userData.active !== false
      }
    });
    
    if (wasCreated) {
      created++;
      console.log(`  ✅ Créé: ${userData.username} (${role})`);
      
      // Associer les points de vente si pas accès à tous
      if (!accesTous && userData.pointVente) {
        const pointsVenteNoms = Array.isArray(userData.pointVente) 
          ? userData.pointVente 
          : [userData.pointVente];
        
        for (const pvNom of pointsVenteNoms) {
          if (pvNom !== 'tous') {
            const pv = pointsVenteMap.get(pvNom);
            if (pv) {
              await UserPointVente.findOrCreate({
                where: { user_id: user.id, point_vente_id: pv.id }
              });
            }
          }
        }
      }
    } else {
      // Mettre à jour l'utilisateur existant
      await user.update({
        role: role,
        acces_tous_points: accesTous,
        active: userData.active !== false
      });
      updated++;
      console.log(`  🔄 Mis à jour: ${userData.username}`);
    }
  }
  
  console.log(`  📊 Total: ${created} créés, ${updated} mis à jour`);
}

/**
 * Migration des catégories
 */
async function migrateCategories() {
  console.log('\n📦 Migration des catégories...');
  
  const categoriesMap = new Map();
  let created = 0;
  
  for (let i = 0; i < CATEGORIES_ORDRE.length; i++) {
    const nom = CATEGORIES_ORDRE[i];
    const [category, wasCreated] = await Category.findOrCreate({
      where: { nom },
      defaults: { ordre: i + 1 }
    });
    
    categoriesMap.set(nom, category);
    
    if (wasCreated) {
      created++;
      console.log(`  ✅ Créé: ${nom}`);
    }
  }
  
  console.log(`  📊 Total: ${created} créées`);
  return categoriesMap;
}

/**
 * Migration des produits d'un catalogue
 */
async function migrateProduitsCatalogue(catalogue, typeCatalogue, categoriesMap, pointsVenteMap) {
  console.log(`\n🛒 Migration des produits (${typeCatalogue})...`);
  
  let produitsCreated = 0;
  let prixCreated = 0;
  
  // Déterminer la structure du catalogue
  const isInventaire = typeCatalogue === 'inventaire';
  
  if (isInventaire) {
    // Structure plate pour l'inventaire
    const produitNames = Object.keys(catalogue).filter(
      key => typeof catalogue[key] === 'object' && catalogue[key].prixDefault !== undefined
    );
    
    for (const produitNom of produitNames) {
      const config = catalogue[produitNom];
      
      // Créer le produit
      const [produit, wasCreated] = await Produit.findOrCreate({
        where: { nom: produitNom, type_catalogue: typeCatalogue },
        defaults: {
          categorie_id: null, // Pas de catégorie pour l'inventaire
          prix_defaut: config.prixDefault || 0,
          prix_alternatifs: config.alternatives || []
        }
      });
      
      if (wasCreated) {
        produitsCreated++;
        
        // Créer l'entrée historique pour la création
        await PrixHistorique.create({
          produit_id: produit.id,
          point_vente_id: null,
          ancien_prix: null,
          nouveau_prix: config.prixDefault || 0,
          type_modification: 'creation',
          modifie_par: 'MIGRATION',
          commentaire: 'Migration initiale depuis produitsInventaire.js'
        });
      }
      
      // Créer les prix par point de vente
      for (const [pvNom, pv] of pointsVenteMap) {
        if (config[pvNom] !== undefined) {
          await PrixPointVente.findOrCreate({
            where: { produit_id: produit.id, point_vente_id: pv.id },
            defaults: { prix: config[pvNom] }
          });
          prixCreated++;
        }
      }
    }
  } else {
    // Structure avec catégories pour vente/abonnement
    for (const [categorieNom, produits] of Object.entries(catalogue)) {
      // Ignorer les fonctions utilitaires
      if (typeof produits !== 'object' || typeof produits === 'function') continue;
      
      const category = categoriesMap.get(categorieNom);
      if (!category) {
        console.log(`  ⚠️ Catégorie inconnue: ${categorieNom}`);
        continue;
      }
      
      for (const [produitNom, config] of Object.entries(produits)) {
        if (typeof config !== 'object') continue;
        
        // Créer le produit
        const [produit, wasCreated] = await Produit.findOrCreate({
          where: { nom: produitNom, type_catalogue: typeCatalogue },
          defaults: {
            categorie_id: category.id,
            prix_defaut: config.default || 0,
            prix_alternatifs: config.alternatives || []
          }
        });
        
        if (wasCreated) {
          produitsCreated++;
          
          // Créer l'entrée historique pour la création
          await PrixHistorique.create({
            produit_id: produit.id,
            point_vente_id: null,
            ancien_prix: null,
            nouveau_prix: config.default || 0,
            type_modification: 'creation',
            modifie_par: 'MIGRATION',
            commentaire: `Migration initiale depuis produits${typeCatalogue === 'abonnement' ? 'Abonnement' : ''}.js`
          });
        }
        
        // Créer les prix par point de vente
        for (const [pvNom, pv] of pointsVenteMap) {
          if (config[pvNom] !== undefined && pvNom !== 'default' && pvNom !== 'alternatives') {
            const [prixPv, prixCreatedNow] = await PrixPointVente.findOrCreate({
              where: { produit_id: produit.id, point_vente_id: pv.id },
              defaults: { prix: config[pvNom] }
            });
            if (prixCreatedNow) prixCreated++;
          }
        }
      }
    }
  }
  
  console.log(`  📊 Produits: ${produitsCreated} créés, Prix spécifiques: ${prixCreated}`);
}

/**
 * Fonction principale de migration
 */
async function runMigration() {
  const forceMode = process.argv.includes('--force');
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       MIGRATION DES CONFIGURATIONS VERS LA BASE DE DONNÉES  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (forceMode) {
    console.log('\n⚠️  MODE FORCE ACTIVÉ - Les tables seront recréées!\n');
  }
  
  try {
    // Tester la connexion
    await sequelize.authenticate();
    console.log('✅ Connexion à la base de données établie');
    
    // Synchroniser les modèles
    console.log('\n🔄 Synchronisation des tables...');
    if (forceMode) {
      await syncNewModels({ force: true });
    } else {
      await syncNewModels({ alter: true });
    }
    console.log('✅ Tables synchronisées');
    
    // 1. Migrer les points de vente
    const pointsVente = await migratePointsVente();
    const pointsVenteMap = new Map(pointsVente.map(pv => [pv.nom, pv]));
    
    // 2. Migrer les utilisateurs
    await migrateUsers(pointsVenteMap);
    
    // 3. Migrer les catégories
    const categoriesMap = await migrateCategories();
    
    // 4. Migrer les produits de vente
    await migrateProduitsCatalogue(produitsVente, 'vente', categoriesMap, pointsVenteMap);
    
    // 5. Migrer les produits d'abonnement
    await migrateProduitsCatalogue(produitsAbonnement, 'abonnement', categoriesMap, pointsVenteMap);
    
    // 6. Migrer les produits d'inventaire
    await migrateProduitsCatalogue(produitsInventaire, 'inventaire', categoriesMap, pointsVenteMap);
    
    // Résumé final
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    MIGRATION TERMINÉE                        ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    const stats = {
      users: await User.count(),
      pointsVente: await PointVente.count(),
      categories: await Category.count(),
      produits: await Produit.count(),
      prixPointVente: await PrixPointVente.count(),
      historique: await PrixHistorique.count()
    };
    
    console.log('\n📊 Statistiques finales:');
    console.log(`   - Utilisateurs: ${stats.users}`);
    console.log(`   - Points de vente: ${stats.pointsVente}`);
    console.log(`   - Catégories: ${stats.categories}`);
    console.log(`   - Produits: ${stats.produits}`);
    console.log(`   - Prix spécifiques: ${stats.prixPointVente}`);
    console.log(`   - Entrées historique: ${stats.historique}`);
    
    console.log('\n✅ Migration réussie!\n');
    
  } catch (error) {
    console.error('\n❌ Erreur lors de la migration:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Exécuter si lancé directement
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };

