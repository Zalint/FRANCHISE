const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * OcrImport - Historique des imports depuis images OCR
 */
const OcrImport = sequelize.define('OcrImport', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    date_import: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    date_ventes: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    point_vente: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    categorie: {
        type: DataTypes.STRING(100),
        defaultValue: 'Import OCR'
    },
    nombre_lignes: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    total_montant: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0
    },
    statut: {
        type: DataTypes.STRING(20),
        defaultValue: 'completed'
    },
    utilisateur: {
        type: DataTypes.STRING(100)
    },
    image_thumbnail: {
        type: DataTypes.TEXT, // Base64 miniature
        field: 'image_source' // Maps to the actual DB column name
    },
    donnees_json: {
        type: DataTypes.JSONB // Données complètes de l'import
    }
}, {
    tableName: 'ocr_imports',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['date_import'] },
        { fields: ['point_vente'] },
        { fields: ['date_ventes'] }
    ]
});

module.exports = OcrImport;
