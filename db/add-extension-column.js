const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function addExtensionColumn() {
  const client = await pool.connect();
  
  try {
    console.log('Ajout de la colonne extension à la table ventes...');
    
    // Vérifier si la colonne existe déjà
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'ventes' 
      AND column_name = 'extension';
    `;
    
    const result = await client.query(checkColumnQuery);
    
    if (result.rows.length > 0) {
      console.log('La colonne extension existe déjà.');
      return;
    }
    
    // Ajouter la colonne extension
    const addColumnQuery = `
      ALTER TABLE ventes 
      ADD COLUMN extension JSONB NULL;
    `;
    
    await client.query(addColumnQuery);
    
    console.log('Colonne extension ajoutée avec succès!');
    
    // Créer un index pour les requêtes JSON
    const createIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_ventes_extension 
      ON ventes USING GIN (extension);
    `;
    
    await client.query(createIndexQuery);
    
    console.log('Index GIN créé pour la colonne extension.');
    
  } catch (error) {
    console.error('Erreur lors de l\'ajout de la colonne extension:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Exécuter la migration si appelé directement
if (require.main === module) {
  addExtensionColumn()
    .then(() => {
      console.log('Migration terminée avec succès.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Échec de la migration:', error);
      process.exit(1);
    });
}

module.exports = addExtensionColumn;
