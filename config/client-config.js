/**
 * Configuration du client
 * Ce fichier contient les informations spécifiques au client
 */

const fs = require('fs');
const path = require('path');

// Chemin vers le fichier de configuration persistant
const CONFIG_FILE_PATH = path.join(__dirname, 'client-config.json');

// Configuration par défaut
const DEFAULT_CONFIG = {
    clientName: 'KEUR BALI',
    clientLogo: null, // Chemin vers le logo personnalisé (optionnel)
    clientColor: '#0d6efd', // Couleur principale (optionnel)
    contactEmail: null,
    contactPhone: null
};

/**
 * Charger la configuration du client depuis le fichier
 * @returns {Object} Configuration du client
 */
function loadClientConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE_PATH)) {
            const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
            return { ...DEFAULT_CONFIG, ...savedConfig };
        }
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration client:', error);
    }
    
    // Créer le fichier avec la config par défaut s'il n'existe pas
    saveClientConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
}

/**
 * Sauvegarder la configuration du client
 * @param {Object} config - Configuration à sauvegarder
 */
function saveClientConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
        console.log('✅ Configuration client sauvegardée');
        return true;
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la configuration client:', error);
        return false;
    }
}

/**
 * Obtenir la configuration du client (recharge depuis le fichier)
 * @returns {Object} Configuration du client
 */
function getClientConfig() {
    return loadClientConfig();
}

/**
 * Mettre à jour la configuration du client
 * @param {Object} updates - Mises à jour à appliquer
 * @returns {Object} Nouvelle configuration
 */
function updateClientConfig(updates) {
    const currentConfig = loadClientConfig();
    const newConfig = { ...currentConfig, ...updates };
    saveClientConfig(newConfig);
    return newConfig;
}

module.exports = {
    getClientConfig,
    updateClientConfig,
    saveClientConfig,
    DEFAULT_CONFIG
};

