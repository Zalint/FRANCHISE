const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const WebOrder = sequelize.define('WebOrder', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    commandId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'command_id',
        comment: 'Order number from external system (e.g., Mata viande)'
    },
    messageId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'message_id',
        comment: 'Email message ID'
    },
    threadId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'thread_id',
        comment: 'Email thread ID'
    },
    jsonContent: {
        type: DataTypes.JSONB,
        allowNull: false,
        field: 'json_content',
        comment: 'Full order data as JSON'
    },
    orderDate: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'order_date',
        comment: 'Date of the order'
    },
    totalAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        field: 'total_amount',
        validate: { min: 0 },
        comment: 'Total order amount'
    },
    currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'CFA',
        comment: 'Currency (CFA, EUR, etc.)'
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    },
    assignedTo: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'assigned_to',
        comment: 'Username of user who claimed this order'
    },
    assignedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'assigned_at',
        comment: 'When the order was assigned'
    },
    convertedToPOS: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'converted_to_pos',
        comment: 'Whether order was converted to POS sale'
    },
    convertedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'converted_at',
        comment: 'When the order was converted'
    },
    convertedBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'converted_by',
        comment: 'Username who converted the order'
    },
    posVenteId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'pos_vente_id',
        comment: 'ID of the POS sale created from this order'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Free-form long text (notes, comments, etc.)'
    }
}, {
    tableName: 'web_orders',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            fields: ['command_id']
        },
        {
            fields: ['message_id']
        },
        {
            fields: ['order_date']
        },
        {
            fields: ['created_at']
        },
        {
            // Composite unique index to prevent duplicate orders
            unique: true,
            fields: ['command_id', 'message_id'],
            name: 'unique_order_message'
        }
    ]
});

module.exports = WebOrder;


