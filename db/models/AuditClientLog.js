const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const AuditClientLog = sequelize.define('AuditClientLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    username: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    point_de_vente: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    phone_number_searched: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    client_name: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    search_timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    consultation_start: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    consultation_end: {
        type: DataTypes.DATE,
        allowNull: true
    },
    consultation_duration_seconds: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    search_success: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    total_orders_found: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0
    },
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'audit_client_logs',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

module.exports = AuditClientLog;

