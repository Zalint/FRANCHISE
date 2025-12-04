const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const PointVente = sequelize.define('PointVente', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  nom: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  payment_ref: {
    type: DataTypes.STRING(20),
    allowNull: true,
    unique: true,
    comment: 'Code de référence pour les paiements (ex: V_KB pour Keur Bali)'
  }
}, {
  tableName: 'points_vente',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['nom']
    }
  ]
});

module.exports = PointVente;

