const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');

// Chemin vers le fichier de sauvegarde des utilisateurs
const USERS_FILE_PATH = path.join(__dirname, 'data', 'by-date', 'users.json');
const USERS_FILE_PATH_FALLBACK = path.join(__dirname, 'users.json');

// Liste des utilisateurs par défaut (doit correspondre à data/by-date/users.json)
const defaultUsers = [
    {
        username: 'ADMIN',
        password: '$2b$10$jPhgA.cIqO.5B6u2/CeV1OqBDSNYGSDVbwTc4d3gks2wBoSEkV2zq',
        role: 'admin',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'KBA',
        password: '$2b$10$AjtmT1ZdD9GikjyPTZjRxOaYoIK3KiZWpSGu4iBy9ojoyuMDh0jbW',
        role: 'user',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'NADOU',
        password: '$2b$10$YHeqE/YTHDW9PCW7F5u7tOgdGQQl6d32KEhxMe92PCzOuWSOh669m',
        role: 'superutilisateur',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'OUSMANE',
        password: '$2b$10$Z7o56oLtPF1hwX1TCryUuuTgbTCBfzpY/58Lb0/ZEAA9Azo5GNr2i',
        role: 'superviseur',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'SALIOU',
        password: '$2b$10$IlcAh43xYqhprICFx2oIv.FLgbsMPso7vHgGsXc9H81VNCTiA/TWq',
        role: 'superviseur',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'SALY',
        password: '$2b$10$WTamvq1T/09402ftX3yuYOGOIXyotCWHuOK08UQKuuBJPJBVYC8Zy',
        role: 'superviseur',
        pointVente: 'tous',
        active: true
    }
];

// Variable globale pour stocker les utilisateurs
let users = [];

// Fonction pour charger les utilisateurs depuis le fichier
async function loadUsers() {
    console.log('=== CHARGEMENT DES UTILISATEURS ===');
    console.log('Chemin principal (racine):', USERS_FILE_PATH_FALLBACK);
    console.log('Chemin secondaire:', USERS_FILE_PATH);
    
    try {
        // PRIORITÉ: Charger depuis le fichier racine (plus à jour avec git)
        try {
            const data = await fs.readFile(USERS_FILE_PATH_FALLBACK, 'utf8');
            users = JSON.parse(data);
            console.log(`✅ Utilisateurs chargés depuis ${USERS_FILE_PATH_FALLBACK}: ${users.length} utilisateurs`);
            console.log('Utilisateurs disponibles:', users.map(u => u.username).join(', '));
        } catch (error) {
            console.log(`❌ Erreur lecture ${USERS_FILE_PATH_FALLBACK}:`, error.message);
            // Fallback: essayer de charger depuis data/by-date
            try {
                const data = await fs.readFile(USERS_FILE_PATH, 'utf8');
                users = JSON.parse(data);
                console.log(`✅ Utilisateurs chargés depuis ${USERS_FILE_PATH} (fallback): ${users.length} utilisateurs`);
                console.log('Utilisateurs disponibles:', users.map(u => u.username).join(', '));
            } catch (fallbackError) {
                console.log(`❌ Erreur lecture ${USERS_FILE_PATH}:`, fallbackError.message);
                // Si aucun fichier n'existe, utiliser les utilisateurs par défaut
                console.log('⚠️ Fichier utilisateurs non trouvé, utilisation des utilisateurs par défaut');
                
                users = [...defaultUsers];
                console.log('Utilisateurs par défaut:', users.map(u => u.username).join(', '));
            }
        }
    } catch (error) {
        console.error('❌ Erreur critique lors du chargement des utilisateurs:', error);
        // En cas d'erreur, utiliser les utilisateurs par défaut
        users = [...defaultUsers];
        console.log('Utilisateurs par défaut (fallback):', users.map(u => u.username).join(', '));
    }
}

// Fonction pour sauvegarder les utilisateurs dans le fichier
async function saveUsers() {
    try {
        await fs.writeFile(USERS_FILE_PATH, JSON.stringify(users, null, 2), 'utf8');
        console.log(`Utilisateurs sauvegardés dans ${USERS_FILE_PATH}`);
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des utilisateurs:', error);
        throw error;
    }
}

// Charger les utilisateurs au démarrage
loadUsers();

// Fonction pour vérifier les identifiants
async function verifyCredentials(username, password) {
    console.log('Tentative de vérification pour:', username);
    
    const user = users.find(u => u.username === username);
    if (!user) {
        console.log('Utilisateur non trouvé:', username);
        return null;
    }
    console.log('Utilisateur trouvé:', user.username);

    // Vérifier si l'utilisateur est actif
    if (!user.active) {
        console.log('Utilisateur inactif:', username);
        return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    console.log('Mot de passe valide:', isValid);
    
    if (!isValid) {
        console.log('Mot de passe invalide pour:', username);
        return null;
    }

    console.log('Authentification réussie pour:', username);
    return {
        username: user.username,
        role: user.role,
        pointVente: user.pointVente,
        active: user.active,
        // Rôles hiérarchiques
        isAdmin: user.role === 'admin',
        isSuperUtilisateur: user.role === 'superutilisateur',
        isSuperviseur: user.role === 'superviseur',
        isUtilisateur: user.role === 'user',
        isLecteur: user.role === 'lecteur',
        // Permissions basées sur les droits actuels
        canRead: ['lecteur', 'user', 'superutilisateur', 'superviseur', 'admin'].includes(user.role),
        canWrite: ['user', 'superutilisateur', 'superviseur', 'admin'].includes(user.role),
        canSupervise: ['superviseur', 'admin'].includes(user.role),
        canManageAdvanced: ['superutilisateur', 'superviseur', 'admin'].includes(user.role),
        canManageUsers: ['admin'].includes(user.role),
        
        // Droits spécifiques selon la hiérarchie actuelle
        canCopyStock: ['superutilisateur', 'superviseur', 'admin'].includes(user.role),
        canManageEstimation: ['superutilisateur', 'superviseur', 'admin'].includes(user.role),
        canAccessAllPointsVente: ['superutilisateur', 'superviseur', 'admin', 'lecteur'].includes(user.role),
        canManageReconciliation: ['superutilisateur', 'superviseur', 'admin'].includes(user.role),
        
        // Droits PRIVILÉGIÉS - Superviseurs (= droits actuels SALIOU/OUSMANE)
        bypassTimeRestrictions: ['superviseur', 'admin'].includes(user.role),
        canModifyStockAnytime: ['superviseur', 'admin'].includes(user.role),
        canAddSalesAnytime: ['superviseur', 'admin'].includes(user.role),
        canImportSales: ['SALIOU', 'OUSMANE'].includes(user.username) || ['admin'].includes(user.role),
        canEmptyDatabase: false, // Désactivé pour tous pour sécurité
        canAccessChat: ['SALIOU', 'OUSMANE'].includes(user.username) || ['superutilisateur', 'superviseur', 'admin'].includes(user.role),
        canAccessSpecialFeatures: ['superviseur', 'admin'].includes(user.role),
        // Fonction utilitaire pour vérifier l'accès à un point de vente
        hasAccessToPointVente: function(pointVente) {
            // Les rôles élevés ont accès à tous les points de vente
            if (this.canAccessAllPointsVente) return true;
            
            if (!this.pointVente) return false;
            if (Array.isArray(this.pointVente)) {
                return this.pointVente.includes('tous') || this.pointVente.includes(pointVente);
            }
            return this.pointVente === 'tous' || this.pointVente === pointVente;
        }
    };
}

// Fonction pour créer un nouvel utilisateur
async function createUser(username, password, role, pointVente, active = true) {
    if (users.some(u => u.username === username)) {
        throw new Error('Username already exists');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = {
        username,
        password: hashedPassword,
        role,
        pointVente,
        active
    };

    users.push(newUser);
    await saveUsers(); // Sauvegarder après chaque création
    return newUser;
}

// Fonction pour mettre à jour un utilisateur
async function updateUser(username, updates) {
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        throw new Error('User not found');
    }

    if (updates.password) {
        const saltRounds = 10;
        updates.password = await bcrypt.hash(updates.password, saltRounds);
    }

    users[userIndex] = { ...users[userIndex], ...updates };
    await saveUsers(); // Sauvegarder après chaque mise à jour
    return users[userIndex];
}

// Fonction pour supprimer un utilisateur
async function deleteUser(username) {
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        throw new Error('User not found');
    }
    users.splice(userIndex, 1);
    await saveUsers(); // Sauvegarder après chaque suppression
}

// Fonction pour activer/désactiver un utilisateur
async function toggleUserStatus(username) {
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        throw new Error('User not found');
    }

    users[userIndex].active = !users[userIndex].active;
    await saveUsers(); // Sauvegarder après chaque changement d'état
    return users[userIndex];
}

// Fonction pour obtenir tous les utilisateurs (sans les mots de passe)
async function getAllUsers() {
    return users.map(user => ({
        username: user.username,
        role: user.role,
        pointVente: user.pointVente,
        active: user.active
    }));
}

// Fonction pour recharger les utilisateurs depuis le fichier
async function reloadUsers() {
    await loadUsers();
}

module.exports = {
    verifyCredentials,
    createUser,
    updateUser,
    deleteUser,
    toggleUserStatus,
    getAllUsers,
    reloadUsers
}; 