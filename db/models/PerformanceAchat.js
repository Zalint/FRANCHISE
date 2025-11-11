const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const PerformanceAchat = sequelize.define('performance_achat', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Date de l\'achat/estimation au format YYYY-MM-DD'
  },
  id_acheteur: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Référence à acheteur.json (identifiant unique)'
  },
  bete: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'Type: boeuf ou veau'
  },
  
  // === ESTIMATION ===
  poids_estime: {
    type: DataTypes.FLOAT,
    allowNull: true,
    comment: 'Poids estimé en kg par l\'acheteur'
  },
  poids_estime_timestamp: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Date et heure de dernière modification du poids estimé'
  },
  poids_estime_updated_by: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Utilisateur ayant modifié le poids estimé'
  },
  
  // === RÉALITÉ ===
  poids_reel: {
    type: DataTypes.FLOAT,
    allowNull: true,
    comment: 'Poids réel en kg après abattage'
  },
  poids_reel_timestamp: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Date et heure de dernière modification du poids réel'
  },
  poids_reel_updated_by: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Utilisateur ayant modifié le poids réel'
  },
  
  // === MÉTADONNÉES ===
  locked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Verrouillé pour empêcher modifications (nécessite déverrouillage Admin)'
  },
  commentaire: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Commentaires ou notes sur cette entrée'
  },
  created_by: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Utilisateur ayant créé l\'entrée'
  }
}, {
  timestamps: true,
  tableName: 'performance_achat',
  indexes: [
    {
      fields: ['date', 'bete']
    },
    {
      fields: ['id_acheteur']
    },
    {
      fields: ['date']
    }
  ]
});

module.exports = PerformanceAchat;

