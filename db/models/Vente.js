const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const Vente = sequelize.define('Vente', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  mois: {
    type: DataTypes.STRING,
    allowNull: false
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  semaine: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pointVente: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'point_vente'
  },
  preparation: {
    type: DataTypes.STRING,
    allowNull: true
  },
  categorie: {
    type: DataTypes.STRING,
    allowNull: false
  },
  produit: {
    type: DataTypes.STRING,
    allowNull: false
  },
  prixUnit: {
    type: DataTypes.FLOAT,
    allowNull: false,
    field: 'prix_unit'
  },
  nombre: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  montant: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  nomClient: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'nom_client'
  },
  numeroClient: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'numero_client'
  },
  adresseClient: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'adresse_client'
  },
  creance: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  client_abonne_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'client_abonne_id',
    comment: 'ID du client abonné (FK vers clients_abonnes)'
  },
  prix_normal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'prix_normal',
    comment: 'Prix normal avant rabais abonné'
  },
  rabais_applique: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'rabais_applique',
    comment: 'Montant du rabais appliqué pour client abonné'
  }
}, {
  tableName: 'ventes',
  timestamps: true, // Ajoute automatiquement createdAt et updatedAt
  hooks: {
    beforeBulkCreate: async (instances, options) => {
      // Vérifier si les instances ont déjà un ID
      const hasIds = instances.some(instance => instance.id);
      
      // Si certaines instances ont un ID, nous devons nous assurer que la séquence est correctement mise à jour
      if (hasIds) {
        await sequelize.query('SELECT setval(pg_get_serial_sequence(\'ventes\', \'id\'), COALESCE((SELECT MAX(id) FROM ventes) + 1, 1), false)');
      }
    }
  }
});

module.exports = Vente; 