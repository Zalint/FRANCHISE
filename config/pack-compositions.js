/**
 * Configuration des compositions par défaut pour les packs
 * Chaque pack contient une liste de produits avec leurs quantités
 */

const PACK_COMPOSITIONS = {
  "Pack25000": [
    { produit: "Veau", quantite: 4, unite: "kg" },
    { produit: "Poulet", quantite: 2, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack20000": [
    { produit: "Veau", quantite: 3.5, unite: "kg" },
    { produit: "Poulet", quantite: 1, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack50000": [
    { produit: "Agneau", quantite: 2.5, unite: "kg" },
    { produit: "Veau", quantite: 6, unite: "kg" },
    { produit: "Poulet", quantite: 4, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack35000": [
    { produit: "Veau", quantite: 4, unite: "kg" },
    { produit: "Poulet", quantite: 2, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack30000": [
    { produit: "Veau", quantite: 2, unite: "kg" },
    { produit: "Poulet", quantite: 6, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack75000": [
    { produit: "Veau", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 5, unite: "kg" },
    { produit: "Poulet", quantite: 5, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack100000": [
    { produit: "Veau", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 1, unite: "kg" },
    { produit: "Poulet", quantite: 5, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ]
};

/**
 * Récupère la composition par défaut d'un pack
 * @param {string} packName - Nom du pack (ex: "Pack25000")
 * @returns {Array|null} - Tableau de produits ou null si le pack n'existe pas
 */
function getPackComposition(packName) {
  return PACK_COMPOSITIONS[packName] || null;
}

/**
 * Crée un objet extension pour une vente de pack
 * @param {string} packType - Type de pack
 * @param {Array} composition - Composition du pack (par défaut ou modifiée)
 * @param {boolean} modifie - Indique si la composition a été modifiée
 * @returns {Object} - Objet extension à stocker dans la base de données
 */
function createPackExtension(packType, composition, modifie = false) {
  return {
    pack_type: packType,
    composition: composition,
    modifie: modifie,
    date_composition: new Date().toISOString()
  };
}

/**
 * Vérifie si un produit est un pack
 * @param {string} produit - Nom du produit
 * @returns {boolean} - true si c'est un pack
 */
function isPack(produit) {
  return PACK_COMPOSITIONS.hasOwnProperty(produit);
}

/**
 * Liste tous les packs disponibles
 * @returns {Array} - Liste des noms de packs
 */
function getAllPacks() {
  return Object.keys(PACK_COMPOSITIONS);
}

module.exports = {
  PACK_COMPOSITIONS,
  getPackComposition,
  createPackExtension,
  isPack,
  getAllPacks
};
