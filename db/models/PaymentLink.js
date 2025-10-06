const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const PaymentLink = sequelize.define('PaymentLink', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    payment_link_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
    },
    point_vente: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    client_name: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    phone_number: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    address: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        validate: { min: 0.01, isDecimal: true }
    },
    currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'XOF'
    },
    reference: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    payment_url: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'opened'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    created_by: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    due_date: {
        type: DataTypes.DATE,
        allowNull: true
    },
    archived: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    is_abonnement: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    client_abonne_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    tableName: 'payment_links',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['payment_link_id']
        },
        {
            fields: ['archived']
        },
        {
            fields: ['point_vente']
        },
        {
            fields: ['created_at']
        }
    ]
});

module.exports = PaymentLink;
