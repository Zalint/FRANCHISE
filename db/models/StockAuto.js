const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * StockAuto - Gère le stock actuel des produits en mode automatique
 * Le stock est décrémenté automatiquement lors des ventes
 */
const StockAuto = sequelize.define('StockAuto', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  produit_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'produits',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  point_vente_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'points_vente',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  quantite: {
    type: DataTypes.DECIMAL(10, 3),
    allowNull: false,
    defaultValue: 0,
    comment: 'Quantité actuelle en stock (peut être négative si stock à découvert)'
  },
  prix_unitaire: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Prix unitaire actuel pour le calcul de la valeur du stock'
  },
  dernier_ajustement_type: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Type du dernier ajustement: livraison, perte, inventaire, correction, etc.'
  },
  dernier_ajustement_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Date du dernier ajustement manuel'
  }
}, {
  tableName: 'stock_auto',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['produit_id', 'point_vente_id'],
      name: 'stock_auto_produit_point_vente_unique'
    },
    {
      fields: ['point_vente_id']
    }
  ]
});

module.exports = StockAuto;

