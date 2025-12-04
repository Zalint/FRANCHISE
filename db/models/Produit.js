const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const Produit = sequelize.define('Produit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  nom: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  categorie_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // NULL pour les produits inventaire sans catégorie
    references: {
      model: 'categories',
      key: 'id'
    },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  },
  type_catalogue: {
    type: DataTypes.ENUM('vente', 'abonnement', 'inventaire'),
    allowNull: false,
    comment: 'Type de catalogue: vente (normal), abonnement (prix réduit), inventaire'
  },
  prix_defaut: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'prix_defaut'
  },
  prix_alternatifs: {
    type: DataTypes.ARRAY(DataTypes.DECIMAL(10, 2)),
    allowNull: true,
    defaultValue: [],
    field: 'prix_alternatifs',
    comment: 'Liste des prix alternatifs possibles'
  }
}, {
  tableName: 'produits',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['nom', 'type_catalogue'],
      name: 'produits_nom_type_unique'
    },
    {
      fields: ['categorie_id']
    },
    {
      fields: ['type_catalogue']
    }
  ]
});

module.exports = Produit;

