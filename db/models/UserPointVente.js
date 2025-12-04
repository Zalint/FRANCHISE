const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const UserPointVente = sequelize.define('UserPointVente', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
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
  }
}, {
  tableName: 'user_points_vente',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'point_vente_id']
    }
  ]
});

module.exports = UserPointVente;

