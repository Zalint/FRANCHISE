const produitsInventaire = {
    "Boeuf": {
        "prixDefault": 3700,
        "alternatives": [3700],
        "Sacre Coeur": 3900
    },
    "Veau": {
        "prixDefault": 3900,
        "alternatives": [3900],
        "Sacre Coeur": 4200
    },
    "Poulet": {
        "prixDefault": 3500,
        "alternatives": [3500],
        "Sacre Coeur": 3400
    },
    "Tete De Mouton": {
        "prixDefault": 1000,
        "alternatives": [1000]
    },
    "Tablette": {
        "prixDefault": 2800,
        "alternatives": [2800],
        "Sacre Coeur": 2500
    },
    "Foie": {
        "prixDefault": 3000,
        "alternatives": [3000]
    },
    "Yell": {
        "prixDefault": 2500,
        "alternatives": [2500],
        "Sacre Coeur": 3000,
        "Keur Massar": 2000
    },
    "Agneau": {
        "prixDefault": 4500,
        "alternatives": [4500],
        "Sacre Coeur": 4900
    },
    "Déchet 400": {
        "prixDefault": 400,
        "alternatives": [400]
    },
    "Autres": {
        "prixDefault": 1,
        "alternatives": [1]
    },
    "Mergez": {
        "prixDefault": 5000,
        "alternatives": [5000]
    },
    "Déchet 2000": {
        "prixDefault": 2000,
        "alternatives": [2000]
    },
    "Abats": {
        "prixDefault": 1000,
        "alternatives": [1000]
    },
    // Nouveaux produits « sur pieds »
    "Boeuf sur pieds": {
        "prixDefault": 0,
        "alternatives": [0]
    },
    "Veau sur pieds": {
        "prixDefault": 0,
        "alternatives": [0]
    },
    "Mouton sur pieds": {
        "prixDefault": 0,
        "alternatives": [0]
    },
    "Chevre sur pieds": {
        "prixDefault": 0,
        "alternatives": [0]
    }
};

// Fonctions utilitaires pour manipuler les produits d'inventaire
produitsInventaire.getPrixDefaut = function(produit, pointVente = null) {
    if (this[produit]) {
        const produitConfig = this[produit];
        
        // Si un point de vente est spécifié et qu'il a un prix défini
        if (pointVente && produitConfig[pointVente] !== undefined) {
            return produitConfig[pointVente];
        }
        
        // Sinon, retourner le prix par défaut
        return produitConfig.prixDefault;
    }
    return 0;
};

produitsInventaire.getPrixAlternatifs = function(produit) {
    if (this[produit]) {
        return this[produit].alternatives;
    }
    return [];
};

produitsInventaire.getPrixPreferePour = function(produit) {
    if (this[produit]) {
        // Préfère le prix alternatif le plus récent s'il existe, sinon le prix par défaut
        const alternatives = this[produit].alternatives;
        return alternatives.length > 0 ? alternatives[0] : this[produit].prixDefault;
    }
    return 0;
};

// Fonction pour obtenir tous les noms de produits
produitsInventaire.getTousLesProduits = function() {
    return Object.keys(this).filter(key => typeof this[key] === 'object' && this[key] !== null && this[key].prixDefault !== undefined);
};

// Fonction pour vérifier si un produit existe
produitsInventaire.produitExiste = function(produit) {
    return this[produit] && typeof this[produit] === 'object' && this[produit].prixDefault !== undefined;
};

// Pour la compatibilité avec le code existant
produitsInventaire.getSimpleValue = function(produit, pointVente = null) {
    return this.getPrixDefaut(produit, pointVente);
};

// En environnement navigateur
if (typeof window !== 'undefined') {
    window.produitsInventaire = produitsInventaire;
}
// En environnement Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = produitsInventaire;
} 