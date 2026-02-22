const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Mot de passe hashé avec bcrypt'
  },
  role: {
    type: DataTypes.ENUM('admin', 'superutilisateur', 'superviseur', 'user'),
    allowNull: false,
    defaultValue: 'user'
  },
  acces_tous_points: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'acces_tous_points',
    comment: 'Si true, accès à tous les points de vente'
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  default_screen: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: null,
    comment: 'Fichier HTML de l\'écran par défaut après connexion (ex: index.html, pos.html)'
  }
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['username']
    }
  ]
});

module.exports = User;

