const produits = {
    "Bovin": {
        "Boeuf en détail": {
            "default": 3700,
            "alternatives": [
                3700,
                3600
            ],
            "Sacre Coeur": 3900
        },
        "Boeuf en gros": {
            "default": 3500,
            "alternatives": [
                3500,
                3400
            ]
        },
        "Dechet": {
            "default": 1000,
            "alternatives": [
                1000
            ]
        },
        "Foie": {
            "default": 3000,
            "alternatives": [
                3000,
                4000
            ]
        },
        "Yell": {
            "default": 2000,
            "alternatives": [
                2000,
                2500
            ],
            "Sacre Coeur": 2500
        },
        "Jarret": {
            "default": 250,
            "alternatives": [
                250
            ]
        },
        "Abats": {
            "default": 1000,
            "alternatives": [
                1000,
                1500
            ]
        },
        "Faux Filet": {
            "default": 3500,
            "alternatives": [
                3500
            ]
        },
        "Filet": {
            "default": 5000,
            "alternatives": [
                5000,
                4000,
                7000
            ]
        },
        "Sans Os": {
            "default": 4500,
            "alternatives": [
                4500,
                4000
            ],
            "Sacre Coeur": 5500
        },
        "Veau en détail": {
            "default": 3900,
            "alternatives": [
                3900,
                3800
            ],
            "Sacre Coeur": 4200
        },
        "Veau en gros": {
            "default": 3700,
            "alternatives": [
                3700,
                3600
            ]
        },
        "Veau sur pied": {
            "default": 0,
            "alternatives": []
        },
        "Merguez": {
            "default": 4500,
            "alternatives": [
                4500
            ]
        },
        "Boeuf sur pied": {
            "default": 0,
            "alternatives": []
        },
        "Tete de Boeuf": {
            "default": 10000,
            "alternatives": [
                10000
            ]
        },
        "Coeur": {
            "default": 2000,
            "alternatives": [
                2000
            ]
        },
        "Viande hachée": {
            "default": 5000,
            "alternatives": [
                5000
            ]
        },
        "Peaux": {
            "default": 6000,
            "alternatives": [
                6000
            ]
        }
    },
    "Ovin": {
        "Agneau": {
            "default": 4500,
            "alternatives": [
                4500
            ],
            "Sacre Coeur": 4900
        },
        "Tete Agneau": {
            "default": 1000,
            "alternatives": [
                1000,
                1500
            ]
        },
        "Mouton sur pied": {
            "default": 0,
            "alternatives": []
        }
    },
    "Volaille": {
        "Poulet en détail": {
            "default": 3500,
            "alternatives": [
                3500,
                3000,
                3700
            ],
            "Sacre Coeur": 3400
        },
        "Poulet en gros": {
            "default": 3000,
            "alternatives": [
                3000,
                3300
            ]
        },
        "Oeuf": {
            "default": 2800,
            "alternatives": [
                2800,
                2800,
                2900
            ],
            "Sacre Coeur": 2500
        },
        "Pack Pigeon": {
            "default": 2500,
            "alternatives": [
                2500,
                2000
            ]
        },
        "Pilon": {
            "default": 3500,
            "alternatives": [
                3500
            ]
        },
        "Merguez poulet": {
            "default": 5500,
            "alternatives": [
                5500
            ]
        }
    },
    "Pack": {
        "Pack25000": {
            "default": 25000,
            "alternatives": [
                25000
            ]
        },
        "Pack30000": {
            "default": 30000,
            "alternatives": [
                30000
            ]
        },
        "Pack35000": {
            "default": 35000,
            "alternatives": [
                35000
            ]
        },
        "Pack50000": {
            "default": 50000,
            "alternatives": [
                50000
            ]
        },
        "Pack75000": {
            "default": 75000,
            "alternatives": [
                75000
            ]
        },
        "Pack100000": {
            "default": 100000,
            "alternatives": [
                100000
            ]
        },
        "Pack20000": {
            "default": 20000,
            "alternatives": [
                20000
            ]
        }
    },
    "Caprin": {
        "Chevre sur pied": {
            "default": 4000,
            "alternatives": [
                4000
            ]
        }
    },
    "Autres": {
        "Produit divers": {
            "default": 0,
            "alternatives": [
                0
            ]
        },
        "Autre viande": {
            "default": 3000,
            "alternatives": [
                3000,
                4000,
                5000
            ]
        },
        "Service": {
            "default": 1000,
            "alternatives": [
                1000,
                2000,
                5000,
                10000
            ]
        }
    }
};

// Fonctions utilitaires pour manipuler les produits
produits.getPrixDefaut = function(categorie, produit, pointVente = null) {
    if (this[categorie] && this[categorie][produit]) {
        const produitConfig = this[categorie][produit];
        
        // Si un point de vente est spécifié et qu'il a un prix défini
        if (pointVente && produitConfig[pointVente] !== undefined) {
            return produitConfig[pointVente];
        }
        
        // Sinon, retourner le prix par défaut
        return produitConfig.default;
    }
    return 0;
};

produits.getPrixAlternatifs = function(categorie, produit) {
    if (this[categorie] && this[categorie][produit]) {
        return this[categorie][produit].alternatives;
    }
    return [];
};

produits.getPrixPreferePour = function(categorie, produit) {
    if (this[categorie] && this[categorie][produit]) {
        // Préfère le prix alternatif le plus récent s'il existe, sinon le prix par défaut
        const alternatives = this[categorie][produit].alternatives;
        return alternatives.length > 0 ? alternatives[0] : this[categorie][produit].default;
    }
    return 0;
};

// Pour la compatibilité avec le code existant
produits.getSimpleValue = function(categorie, produit, pointVente = null) {
    return this.getPrixDefaut(categorie, produit, pointVente);
};

// En environnement navigateur
if (typeof window !== 'undefined') {
    window.produits = produits;
}
// En environnement Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = produits;
} 