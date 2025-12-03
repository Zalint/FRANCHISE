const produitsAbonnement = {
    "Bovin": {
        "Boeuf en détail": {
            "default": 3600,
            "alternatives": [
                3600,
                3500
            ],
            "Sacre Coeur": 3800
        },
        "Boeuf en gros": {
            "default": 3400,
            "alternatives": [
                3400,
                3300
            ]
        },
        "Dechet": {
            "default": 1000,
            "alternatives": [
                1000
            ]
        },
        "Foie": {
            "default": 2900,
            "alternatives": [
                2900,
                3900
            ]
        },
        "Yell": {
            "default": 1900,
            "alternatives": [
                1900,
                2400
            ],
            "Sacre Coeur": 2400
        },
        "Jarret": {
            "default": 250,
            "alternatives": [
                250
            ]
        },
        "Abats": {
            "default": 950,
            "alternatives": [
                950,
                1450
            ]
        },
        "Faux Filet": {
            "default": 3400,
            "alternatives": [
                3400
            ]
        },
        "Filet": {
            "default": 4900,
            "alternatives": [
                4900,
                3900,
                6900
            ]
        },
        "Sans Os": {
            "default": 4400,
            "alternatives": [
                4400,
                3900
            ],
            "Sacre Coeur": 5400
        },
        "Veau en détail": {
            "default": 3800,
            "alternatives": [
                3800,
                3700
            ],
            "Sacre Coeur": 4100
        },
        "Veau en gros": {
            "default": 3600,
            "alternatives": [
                3600,
                3500
            ]
        },
        "Veau sur pied": {
            "default": 0,
            "alternatives": []
        },
        "Merguez": {
            "default": 4400,
            "alternatives": [
                4400
            ]
        },
        "Boeuf sur pied": {
            "default": 0,
            "alternatives": []
        },
        "Tete de Boeuf": {
            "default": 9900,
            "alternatives": [
                9900
            ]
        },
        "Coeur": {
            "default": 1950,
            "alternatives": [
                1950
            ]
        },
        "Viande hachée": {
            "default": 4900,
            "alternatives": [
                4900
            ]
        },
        "Peaux": {
            "default": 5900,
            "alternatives": [
                5900
            ]
        }
    },
    "Ovin": {
        "Agneau": {
            "default": 4400,
            "alternatives": [
                4400
            ],
            "Sacre Coeur": 4800
        },
        "Tete Agneau": {
            "default": 950,
            "alternatives": [
                950,
                1450
            ]
        },
        "Mouton sur pied": {
            "default": 0,
            "alternatives": []
        }
    },
    "Volaille": {
        "Poulet en détail": {
            "default": 3300,
            "alternatives": [
                3300,
                2800,
                3500
            ],
            "Sacre Coeur": 3200
        },
        "Poulet en gros": {
            "default": 2800,
            "alternatives": [
                2800,
                3100
            ]
        },
        "Oeuf": {
            "default": 2700,
            "alternatives": [
                2700,
                2700,
                2800
            ],
            "Sacre Coeur": 2400
        },
        "Pack Pigeon": {
            "default": 2400,
            "alternatives": [
                2400,
                1900
            ]
        },
        "Pilon": {
            "default": 3400,
            "alternatives": [
                3400
            ]
        },
        "Merguez poulet": {
            "default": 5400,
            "alternatives": [
                5400
            ]
        }
    },
    "Pack": {
        "Pack25000": {
            "default": 24500,
            "alternatives": [
                24500
            ]
        },
        "Pack30000": {
            "default": 29500,
            "alternatives": [
                29500
            ]
        },
        "Pack35000": {
            "default": 34500,
            "alternatives": [
                34500
            ]
        },
        "Pack50000": {
            "default": 49000,
            "alternatives": [
                49000
            ]
        },
        "Pack75000": {
            "default": 73500,
            "alternatives": [
                73500
            ]
        },
        "Pack100000": {
            "default": 98000,
            "alternatives": [
                98000
            ]
        },
        "Pack20000": {
            "default": 19500,
            "alternatives": [
                19500
            ]
        }
    },
    "Caprin": {
        "Chevre sur pied": {
            "default": 3900,
            "alternatives": [
                3900
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
            "default": 2900,
            "alternatives": [
                2900,
                3900,
                4900
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

// Fonctions utilitaires pour manipuler les produits d'abonnement
produitsAbonnement.getPrixDefaut = function(categorie, produit, pointVente = null) {
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

produitsAbonnement.getPrixAlternatifs = function(categorie, produit) {
    if (this[categorie] && this[categorie][produit]) {
        return this[categorie][produit].alternatives;
    }
    return [];
};

produitsAbonnement.getPrixPreferePour = function(categorie, produit) {
    if (this[categorie] && this[categorie][produit]) {
        // Préfère le prix alternatif le plus récent s'il existe, sinon le prix par défaut
        const alternatives = this[categorie][produit].alternatives;
        return alternatives.length > 0 ? alternatives[0] : this[categorie][produit].default;
    }
    return 0;
};

// Pour la compatibilité avec le code existant
produitsAbonnement.getSimpleValue = function(categorie, produit, pointVente = null) {
    return this.getPrixDefaut(categorie, produit, pointVente);
};

// En environnement navigateur
if (typeof window !== 'undefined') {
    window.produitsAbonnement = produitsAbonnement;
}

// En environnement Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = produitsAbonnement;
}
