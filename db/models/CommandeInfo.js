const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Table pour stocker les informations et métadonnées des commandes
 * Inclut : crédits appliqués, statut de paiement, etc.
 */
const CommandeInfo = sequelize.define('CommandeInfo', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  commande_id: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    field: 'commande_id',
    comment: 'ID unique de la commande (ex: MBA1768986984086)'
  },
  
  // ===== INFORMATIONS DE CRÉDIT =====
  credit_used: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'credit_used',
    comment: 'Montant du crédit utilisé (FCFA)'
  },
  credit_phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'credit_phone',
    comment: 'Numéro de téléphone du client'
  },
  credit_status: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'credit_status',
    comment: 'Statut du crédit: pending, confirmed, failed'
  },
  credit_version: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'credit_version',
    comment: 'Version du crédit pour la gestion de concurrence'
  },
  amount_paid_after_credit: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'amount_paid_after_credit',
    comment: 'Montant payé après déduction du crédit'
  },
  transaction_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'transaction_id',
    comment: 'ID de la transaction dans client_credit_usage'
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'error_message',
    comment: 'Message d\'erreur si le crédit a échoué'
  },
  credit_updated_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'credit_updated_at',
    comment: 'Date de la dernière mise à jour du crédit'
  },
  
  // ===== STATUT DE PAIEMENT =====
  payment_status: {
    type: DataTypes.STRING(10),
    allowNull: true,
    defaultValue: 'A',
    field: 'payment_status',
    comment: 'Statut de paiement: A (Awaiting), P (Paid), M (Manual), PP (Partial), C (Credit)'
  },
  payment_method: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'payment_method',
    comment: 'Méthode de paiement: cash, bictorys, credit, mixed'
  },
  payment_updated_at: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'payment_updated_at',
    comment: 'Date de la dernière mise à jour du statut de paiement'
  },
  
  // ===== MÉTADONNÉES ADDITIONNELLES =====
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'notes',
    comment: 'Notes additionnelles sur la commande'
  }
}, {
  tableName: 'commande_infos',
  timestamps: true,
  indexes: [
    {
      fields: ['commande_id'],
      unique: true
    },
    {
      fields: ['credit_phone']
    },
    {
      fields: ['credit_status']
    },
    {
      fields: ['payment_status']
    },
    {
      fields: ['createdAt']
    }
  ]
});

module.exports = CommandeInfo;

