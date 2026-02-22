const { sequelize } = require('../db/index');

async function run() {
    await sequelize.query(
        `ALTER TABLE ventes ADD COLUMN IF NOT EXISTS pos_statut_paiement VARCHAR(1) DEFAULT NULL`
    );
    console.log('✅ Colonne pos_statut_paiement ajoutée');
    process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
