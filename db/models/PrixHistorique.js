const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const PrixHistorique = sequelize.define('PrixHistorique', {
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
    allowNull: true, // NULL si c'est le prix par défaut
    references: {
      model: 'points_vente',
      key: 'id'
    },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  },
  ancien_prix: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Prix avant modification (NULL si création)'
  },
  nouveau_prix: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: 'Nouveau prix après modification'
  },
  type_modification: {
    type: DataTypes.ENUM('creation', 'modification', 'suppression'),
    allowNull: false,
    defaultValue: 'modification'
  },
  modifie_par: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Username de l\'utilisateur qui a fait la modification'
  },
  commentaire: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'prix_historique',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['produit_id']
    },
    {
      fields: ['point_vente_id']
    },
    {
      fields: ['created_at']
    }
  ]
});

module.exports = PrixHistorique;

