/**
 * Gestionnaire de la configuration client côté frontend
 * Charge et affiche les informations du client (nom, logo, etc.)
 */

// Cache pour la configuration client
let clientConfig = null;

/**
 * Charger la configuration du client depuis l'API
 * @returns {Promise<Object>} Configuration du client
 */
async function loadClientConfig() {
    try {
        const response = await fetch('/api/client-config');
        const data = await response.json();
        
        if (data.success) {
            clientConfig = data.config;
            console.log('✅ Configuration client chargée:', clientConfig.clientName);
            return clientConfig;
        }
        
        console.error('Erreur lors du chargement de la configuration client:', data.message);
        return null;
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration client:', error);
        return null;
    }
}

/**
 * Obtenir la configuration client
 * @returns {Object|null} Configuration client
 */
function getClientConfig() {
    return clientConfig;
}

/**
 * Obtenir le nom du client
 * @returns {string} Nom du client
 */
function getClientName() {
    return clientConfig ? clientConfig.clientName : '';
}

/**
 * Appliquer la configuration client à l'interface
 */
function applyClientConfig() {
    if (!clientConfig) {
        console.warn('Configuration client non chargée');
        return;
    }
    
    // Afficher le nom du client
    const clientNameDisplay = document.getElementById('client-name-display');
    if (clientNameDisplay && clientConfig.clientName) {
        clientNameDisplay.textContent = clientConfig.clientName;
    }
    
    // Appliquer la couleur personnalisée si définie
    if (clientConfig.clientColor) {
        document.documentElement.style.setProperty('--client-primary-color', clientConfig.clientColor);
    }
    
    // Mettre à jour le titre de la page
    if (clientConfig.clientName) {
        const currentTitle = document.title;
        if (!currentTitle.includes(clientConfig.clientName)) {
            document.title = `${clientConfig.clientName} - ${currentTitle}`;
        }
    }
    
    console.log('✅ Configuration client appliquée');
}

/**
 * Initialiser le gestionnaire de configuration client
 */
async function initClientConfig() {
    console.log('🚀 Initialisation de la configuration client...');
    
    await loadClientConfig();
    applyClientConfig();
    
    console.log('✅ Configuration client initialisée');
}

// Exporter pour utilisation globale
window.ClientConfig = {
    init: initClientConfig,
    load: loadClientConfig,
    get: getClientConfig,
    getName: getClientName,
    apply: applyClientConfig
};

// Auto-initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', async function() {
    await initClientConfig();
});

