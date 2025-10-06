const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const PaiementAbonnement = sequelize.define('PaiementAbonnement', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'clients_abonnes',
            key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    mois: {
        type: DataTypes.STRING(7),
        allowNull: false,
        comment: 'Format: YYYY-MM (ex: 2024-10)'
    },
    montant: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 5000,
        validate: {
            min: 0
        }
    },
    date_paiement: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    mode_paiement: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Espèces, Virement, Mobile Money, etc.'
    },
    payment_link_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'ID du lien de paiement Bictorys si paiement en ligne'
    },
    reference: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Référence du paiement (ex: A_MBA pour abonnement Mbao)'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'paiements_abonnement',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['client_id']
        },
        {
            fields: ['mois']
        },
        {
            fields: ['date_paiement']
        },
        {
            unique: true,
            fields: ['client_id', 'mois'],
            name: 'unique_client_mois'
        }
    ]
});

/**
 * Vérifier si un client a payé pour un mois donné
 */
PaiementAbonnement.hasClientPaidForMonth = async function(clientId, mois = null) {
    if (!mois) {
        // Par défaut, vérifier le mois en cours
        const now = new Date();
        mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    const paiement = await PaiementAbonnement.findOne({
        where: {
            client_id: clientId,
            mois: mois
        }
    });
    
    return !!paiement;
};

/**
 * Obtenir les clients qui n'ont pas payé pour un mois donné
 */
PaiementAbonnement.getUnpaidClients = async function(mois = null) {
    const { Op } = require('sequelize');
    const ClientAbonne = require('./ClientAbonne');
    
    if (!mois) {
        const now = new Date();
        mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    // Récupérer tous les clients actifs
    const activeClients = await ClientAbonne.findAll({
        where: { statut: 'actif' }
    });
    
    // Récupérer les paiements du mois
    const paiements = await PaiementAbonnement.findAll({
        where: { mois: mois }
    });
    
    const paidClientIds = paiements.map(p => p.client_id);
    
    // Filtrer les clients qui n'ont pas payé
    return activeClients.filter(client => !paidClientIds.includes(client.id));
};

module.exports = PaiementAbonnement;

