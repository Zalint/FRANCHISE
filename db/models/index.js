const Vente = require('./Vente');
const Stock = require('./Stock');
const Transfert = require('./Transfert');
const Reconciliation = require('./Reconciliation');
const CashPayment = require('./CashPayment');
const AchatBoeuf = require('./AchatBoeuf');
const WeightParams = require('./WeightParams');
const Precommande = require('./Precommande');
const ClientAbonne = require('./ClientAbonne');
const PaiementAbonnement = require('./PaiementAbonnement');
const PerformanceAchat = require('./PerformanceAchat');
const AuditClientLog = require('./AuditClientLog');
const { sequelize } = require('../index');

// Définir les relations entre les modèles si nécessaire

// Relations pour les abonnements
ClientAbonne.hasMany(PaiementAbonnement, {
  foreignKey: 'client_id',
  as: 'paiements'
});

PaiementAbonnement.belongsTo(ClientAbonne, {
  foreignKey: 'client_id',
  as: 'client'
});

// Fonction pour synchroniser les modèles avec la base de données
async function syncDatabase(force = false) {
  try {
    await sequelize.sync({ force });
    console.log('Base de données synchronisée avec succès');
    return true;
  } catch (error) {
    console.error('Erreur lors de la synchronisation de la base de données:', error);
    return false;
  }
}

module.exports = {
  Vente,
  Stock,
  Transfert,
  Reconciliation,
  CashPayment,
  AchatBoeuf,
  WeightParams,
  Precommande,
  ClientAbonne,
  PaiementAbonnement,
  PerformanceAchat,
  AuditClientLog,
  syncDatabase,
  sequelize
}; 