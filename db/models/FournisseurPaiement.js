const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * FournisseurPaiement — chaque versement effectue AU fournisseur viande.
 * Permet de calculer "ce que je dois encore" = creances - sum(paiements)
 * sur la periode.
 *
 * Adaptation FRANCHISE: ajout du champ `point_vente` pour permettre le
 * filtrage / cumul par PV (Keur Bali, Almadie 2). Nullable pour ne pas
 * casser les paiements anciens / non rattaches.
 */
const FournisseurPaiement = sequelize.define('FournisseurPaiement', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    montant: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    mode: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    reference: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    commentaire: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    point_vente: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'point_vente'
    },
    created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'created_by'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    }
}, {
    tableName: 'fournisseur_paiements',
    timestamps: false
});

module.exports = FournisseurPaiement;
