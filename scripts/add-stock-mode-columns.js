/**
 * Script de migration pour ajouter les colonnes mode_stock et unite_stock
 * ainsi que les tables stock_auto et stock_ajustements
 * 
 * Usage: node scripts/add-stock-mode-columns.js
 */

require('dotenv').config({ path: '.env.local' });

const { sequelize } = require('../db');

async function migrate() {
  console.log('🔄 Début de la migration pour le stock automatique...\n');
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connexion à la base de données établie');
    
    // 1. Créer les types ENUM s'ils n'existent pas
    console.log('\n📦 Création des types ENUM...');
    
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE mode_stock_type AS ENUM ('manuel', 'automatique');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('  ✅ Type mode_stock_type créé');
    
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE unite_stock_type AS ENUM ('unite', 'kilo');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('  ✅ Type unite_stock_type créé');
    
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE type_ajustement_stock AS ENUM ('livraison', 'perte', 'inventaire', 'correction', 'transfert_entree', 'transfert_sortie', 'initialisation');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('  ✅ Type type_ajustement_stock créé');
    
    // 2. Ajouter les colonnes à la table produits
    console.log('\n📊 Ajout des colonnes mode_stock et unite_stock à la table produits...');
    
    // Vérifier si la colonne mode_stock existe déjà
    const [modeStockExists] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'produits' AND column_name = 'mode_stock'
    `);
    
    if (modeStockExists.length === 0) {
      await sequelize.query(`
        ALTER TABLE produits 
        ADD COLUMN mode_stock mode_stock_type NOT NULL DEFAULT 'manuel'
      `);
      console.log('  ✅ Colonne mode_stock ajoutée');
    } else {
      console.log('  ℹ️  Colonne mode_stock existe déjà');
    }
    
    // Vérifier si la colonne unite_stock existe déjà
    const [uniteStockExists] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'produits' AND column_name = 'unite_stock'
    `);
    
    if (uniteStockExists.length === 0) {
      await sequelize.query(`
        ALTER TABLE produits 
        ADD COLUMN unite_stock unite_stock_type NOT NULL DEFAULT 'unite'
      `);
      console.log('  ✅ Colonne unite_stock ajoutée');
    } else {
      console.log('  ℹ️  Colonne unite_stock existe déjà');
    }
    
    // 3. Créer la table stock_auto
    console.log('\n📦 Création de la table stock_auto...');
    
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS stock_auto (
        id SERIAL PRIMARY KEY,
        produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE ON UPDATE CASCADE,
        point_vente_id INTEGER NOT NULL REFERENCES points_vente(id) ON DELETE CASCADE ON UPDATE CASCADE,
        quantite DECIMAL(10, 3) NOT NULL DEFAULT 0,
        prix_unitaire DECIMAL(10, 2) NOT NULL DEFAULT 0,
        dernier_ajustement_type VARCHAR(50),
        dernier_ajustement_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_stock_auto_produit_point_vente UNIQUE (produit_id, point_vente_id)
      )
    `);
    console.log('  ✅ Table stock_auto créée');
    
    // Créer les index
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_auto_produit_id ON stock_auto(produit_id)
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_auto_point_vente_id ON stock_auto(point_vente_id)
    `);
    console.log('  ✅ Index créés pour stock_auto');
    
    // 4. Créer la table stock_ajustements
    console.log('\n📦 Création de la table stock_ajustements...');
    
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS stock_ajustements (
        id SERIAL PRIMARY KEY,
        stock_auto_id INTEGER NOT NULL REFERENCES stock_auto(id) ON DELETE CASCADE ON UPDATE CASCADE,
        type_ajustement type_ajustement_stock NOT NULL,
        quantite_avant DECIMAL(10, 3) NOT NULL,
        quantite_ajustee DECIMAL(10, 3) NOT NULL,
        quantite_apres DECIMAL(10, 3) NOT NULL,
        commentaire TEXT,
        effectue_par VARCHAR(100) NOT NULL,
        date_ajustement DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Table stock_ajustements créée');
    
    // Créer les index
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_ajustements_stock_auto_id ON stock_ajustements(stock_auto_id)
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_ajustements_date ON stock_ajustements(date_ajustement)
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_ajustements_type ON stock_ajustements(type_ajustement)
    `);
    console.log('  ✅ Index créés pour stock_ajustements');
    
    console.log('\n✅ Migration terminée avec succès!');
    console.log('\n📋 Résumé des modifications:');
    console.log('   - Colonne mode_stock ajoutée à produits (manuel | automatique)');
    console.log('   - Colonne unite_stock ajoutée à produits (unite | kilo)');
    console.log('   - Table stock_auto créée pour le stock des produits automatiques');
    console.log('   - Table stock_ajustements créée pour l\'historique des ajustements');
    
  } catch (error) {
    console.error('\n❌ Erreur lors de la migration:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

migrate();

