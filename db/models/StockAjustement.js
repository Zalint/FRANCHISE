const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * StockAjustement - Historique des ajustements manuels de stock
 * Enregistre toutes les modifications de stock hors ventes
 */
const StockAjustement = sequelize.define('StockAjustement', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  stock_auto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'stock_auto',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  type_ajustement: {
    type: DataTypes.ENUM('livraison', 'perte', 'inventaire', 'correction', 'transfert_entree', 'transfert_sortie', 'initialisation'),
    allowNull: false,
    comment: 'Type d\'ajustement effectué'
  },
  quantite_avant: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false,
    comment: 'Quantité avant ajustement'
  },
  quantite_ajustee: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false,
    comment: 'Quantité ajoutée (positif) ou retirée (négatif)'
  },
  quantite_apres: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false,
    comment: 'Quantité après ajustement'
  },
  commentaire: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Commentaire obligatoire pour expliquer l\'ajustement'
  },
  effectue_par: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Utilisateur qui a effectué l\'ajustement'
  },
  date_ajustement: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'Date de l\'ajustement'
  }
}, {
  tableName: 'stock_ajustements',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['stock_auto_id']
    },
    {
      fields: ['date_ajustement']
    },
    {
      fields: ['type_ajustement']
    }
  ]
});

module.exports = StockAjustement;

