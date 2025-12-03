const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');

// Chemin vers le fichier de sauvegarde des utilisateurs
const USERS_FILE_PATH = path.join(__dirname, 'data', 'by-date', 'users.json');
const USERS_FILE_PATH_FALLBACK = path.join(__dirname, 'users.json');

// Liste des utilisateurs par défaut (utilisée seulement si le fichier n'existe pas)
const defaultUsers = [
    {
        username: 'ADMIN',
        password: '$2b$10$rXRMYSP0MzuiT9T1l1lR5Ou57eqnW.fxkihkgFzp.l8RVpNg0BCmq',
        role: 'admin',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'MBA',
        password: '$2b$10$SGgkVN9qBf.nChuQYfWs5OFfu9yduQ5YAp4YhFPwLySW1naAXywmK',
        role: 'user',
        pointVente: 'Mbao',
        active: true
    },
    {
        username: 'OSF',
        password: '$2b$10$sZr41Lpfz3dFM3UBdl38deaWSWB6lYzZw0uTJEIxtWXD3oEBMLJq6',
        role: 'user',
        pointVente: 'O.Foire',
        active: true
    },
    {
        username: 'KMS',
        password: '$2b$10$fM8r6G5YXoQbMweovFX4dewL4h3YiIKkGAdRgXXthVaKoVzhaf68W',
        role: 'user',
        pointVente: 'Keur Massar',
        active: true
    },
    {
        username: 'LNG',
        password: '$2b$10$5/Ufo00FlSk2vq9.Smuoh.ub4XpiuqiJLya1HrvvuSwl5vcAtYOoK',
        role: 'user',
        pointVente: 'Linguere',
        active: true
    },
    {
        username: 'DHR',
        password: '$2b$10$Pc4VgsIWK7BXyw2mcWa5/OMDydUgBHR3HkCaSWaqNWSCZ1gOp6jgC',
        role: 'user',
        pointVente: 'Dahra',
        active: true
    },
    {
        username: 'TBM',
        password: '$2b$10$3lnpwyz.WNC3Ac3LDIIHfOWnQUuglBDHlk4sHB4nB/VV6ZD9fLLZ.',
        role: 'user',
        pointVente: 'Touba',
        active: true
    },
    {
        username: 'NADOU',
        password: '$2b$10$K7k5RmHjo.z52EWo8UdQBufVmFS65BS1by85QVzNk8x2w8faFoluW',
        role: 'user',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'OUSMANE',
        password: '$2b$10$C7/yS945tfuFFe8VoaL8E.YyzakG5HqmHh9D79spRiVcq8/ASI./6',
        role: 'user',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'PAPI',
        password: '$2b$10$mo1zaS1mo/GAl3jOR3f4ZuxwpVjr28nISR4jviHUpCY2GetfWE2Ve',
        role: 'user',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'SALIOU',
        password: '$2b$10$XM0wQV5kI0lJqld3aMwlmuNSmTivlFAEKXDwZEg0ePIcG6o9/jVmu',
        role: 'user',
        pointVente: 'tous',
        active: true
    },
    {
        username: 'SCR',
        password: '$2b$10$fGNRB1.MSl4JT5EkMwYpT.RKDuCc4RmpXXZvz/OKpn3sm3ozNTLUe',
        role: 'user',
        pointVente: 'Sacre Coeur',
        active: true
    }
];

// Variable globale pour stocker les utilisateurs
let users = [];

// Fonction pour charger les utilisateurs depuis le fichier
async function loadUsers() {
    try {
        // Vérifier si le fichier existe dans data/by-date
        try {
            const data = await fs.readFile(USERS_FILE_PATH, 'utf8');
            users = JSON.parse(data);
            console.log(`Utilisateurs chargés depuis ${USERS_FILE_PATH}: ${users.length} utilisateurs`);
        } catch (error) {
            // Fallback: essayer de charger depuis le fichier racine
            try {
                const data = await fs.readFile(USERS_FILE_PATH_FALLBACK, 'utf8');
                users = JSON.parse(data);
                console.log(`Utilisateurs chargés depuis ${USERS_FILE_PATH_FALLBACK} (fallback): ${users.length} utilisateurs`);
            } catch (fallbackError) {
                // Si aucun fichier n'existe, créer le dossier et sauvegarder les utilisateurs par défaut
                console.log('Fichier utilisateurs non trouvé, création avec les utilisateurs par défaut');
                
                // Créer le dossier data s'il n'existe pas
                const dataDir = path.dirname(USERS_FILE_PATH);
                try {
                    await fs.mkdir(dataDir, { recursive: true });
                } catch (mkdirError) {
                    console.log('Dossier data existe déjà');
                }
                
                users = [...defaultUsers];
                await saveUsers();
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des utilisateurs:', error);
        // En cas d'erreur, utiliser les utilisateurs par défaut
        users = [...defaultUsers];
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