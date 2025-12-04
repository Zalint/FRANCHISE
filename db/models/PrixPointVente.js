const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const PrixPointVente = sequelize.define('PrixPointVente', {
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
  prix: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Prix spécifique pour ce point de vente'
  }
}, {
  tableName: 'prix_point_vente',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['produit_id', 'point_vente_id'],
      name: 'prix_produit_point_vente_unique'
    }
  ]
});

module.exports = PrixPointVente;

