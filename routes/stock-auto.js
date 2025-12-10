/**
 * Routes API pour la gestion du stock automatique
 * Gère le stock des produits en mode automatique (sodas, légumes, etc.)
 */

const express = require('express');
const router = express.Router();
const { StockAuto, StockAjustement, Produit, PointVente, sequelize } = require('../db/models');
const { Op } = require('sequelize');
const moment = require('moment');

// Middleware pour vérifier l'authentification
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Non authentifié' });
  }
  next();
};

// =====================================================
// GET /api/stock-auto - Récupérer tous les stocks automatiques
// =====================================================
router.get('/', requireAuth, async (req, res) => {
  try {
    const { point_vente_id, produit_id } = req.query;
    
    const where = {};
    if (point_vente_id) where.point_vente_id = point_vente_id;
    if (produit_id) where.produit_id = produit_id;
    
    const stocks = await StockAuto.findAll({
      where,
      include: [
        {
          model: Produit,
          as: 'produit',
          attributes: ['id', 'nom', 'mode_stock', 'unite_stock', 'prix_defaut']
        },
        {
          model: PointVente,
          as: 'pointVente',
          attributes: ['id', 'nom']
        }
      ],
      order: [['produit', 'nom', 'ASC']]
    });
    
    res.json({ success: true, data: stocks });
  } catch (error) {
    console.error('Erreur lors de la récupération des stocks auto:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// GET /api/stock-auto/produits-auto - Récupérer les produits en mode automatique
// =====================================================
router.get('/produits-auto', requireAuth, async (req, res) => {
  try {
    const produits = await Produit.findAll({
      where: {
        mode_stock: 'automatique'
      },
      attributes: ['id', 'nom', 'unite_stock', 'prix_defaut', 'type_catalogue'],
      order: [['nom', 'ASC']]
    });
    
    res.json({ success: true, data: produits });
  } catch (error) {
    console.error('Erreur lors de la récupération des produits auto:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// GET /api/stock-auto/:pointVenteId - Stock par point de vente
// =====================================================
router.get('/point-vente/:pointVenteId', requireAuth, async (req, res) => {
  try {
    const { pointVenteId } = req.params;
    
    const stocks = await StockAuto.findAll({
      where: { point_vente_id: pointVenteId },
      include: [
        {
          model: Produit,
          as: 'produit',
          attributes: ['id', 'nom', 'mode_stock', 'unite_stock', 'prix_defaut']
        }
      ],
      order: [['produit', 'nom', 'ASC']]
    });
    
    res.json({ success: true, data: stocks });
  } catch (error) {
    console.error('Erreur lors de la récupération des stocks par point de vente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// POST /api/stock-auto/initialiser - Initialiser le stock d'un produit
// =====================================================
router.post('/initialiser', requireAuth, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { produit_id, point_vente_id, quantite, prix_unitaire, commentaire } = req.body;
    const username = req.session.user?.username || 'system';
    
    if (!produit_id || !point_vente_id) {
      return res.status(400).json({ success: false, error: 'produit_id et point_vente_id requis' });
    }
    
    // Vérifier que le produit est en mode automatique
    const produit = await Produit.findByPk(produit_id);
    if (!produit) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }
    if (produit.mode_stock !== 'automatique') {
      return res.status(400).json({ success: false, error: 'Ce produit n\'est pas en mode automatique' });
    }
    
    // Créer ou mettre à jour le stock
    const [stockAuto, created] = await StockAuto.findOrCreate({
      where: { produit_id, point_vente_id },
      defaults: {
        quantite: quantite || 0,
        prix_unitaire: prix_unitaire || produit.prix_defaut,
        dernier_ajustement_type: 'initialisation',
        dernier_ajustement_date: new Date()
      },
      transaction
    });
    
    const quantiteAvant = created ? 0 : parseFloat(stockAuto.quantite);
    const quantiteApres = parseFloat(quantite || 0);
    
    if (!created) {
      // Mettre à jour le stock existant
      await stockAuto.update({
        quantite: quantiteApres,
        prix_unitaire: prix_unitaire || produit.prix_defaut,
        dernier_ajustement_type: 'initialisation',
        dernier_ajustement_date: new Date()
      }, { transaction });
    }
    
    // Créer l'historique de l'ajustement
    await StockAjustement.create({
      stock_auto_id: stockAuto.id,
      type_ajustement: 'initialisation',
      quantite_avant: quantiteAvant,
      quantite_ajustee: quantiteApres - quantiteAvant,
      quantite_apres: quantiteApres,
      commentaire: commentaire || 'Initialisation du stock',
      effectue_par: username,
      date_ajustement: new Date()
    }, { transaction });
    
    await transaction.commit();
    
    res.json({ 
      success: true, 
      message: created ? 'Stock initialisé' : 'Stock mis à jour',
      data: stockAuto 
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Erreur lors de l\'initialisation du stock:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// POST /api/stock-auto/ajuster - Ajuster le stock manuellement
// =====================================================
router.post('/ajuster', requireAuth, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { stock_auto_id, type_ajustement, quantite, commentaire } = req.body;
    const username = req.session.user?.username || 'system';
    
    if (!stock_auto_id || !type_ajustement || quantite === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'stock_auto_id, type_ajustement et quantite requis' 
      });
    }
    
    // Types d'ajustement valides
    const typesValides = ['livraison', 'perte', 'inventaire', 'correction', 'transfert_entree', 'transfert_sortie'];
    if (!typesValides.includes(type_ajustement)) {
      return res.status(400).json({ 
        success: false, 
        error: `Type d'ajustement invalide. Valides: ${typesValides.join(', ')}` 
      });
    }
    
    // Récupérer le stock
    const stockAuto = await StockAuto.findByPk(stock_auto_id, { transaction });
    if (!stockAuto) {
      return res.status(404).json({ success: false, error: 'Stock non trouvé' });
    }
    
    const quantiteAvant = parseFloat(stockAuto.quantite);
    const quantiteAjustee = parseFloat(quantite);
    const quantiteApres = quantiteAvant + quantiteAjustee;
    
    // Mettre à jour le stock
    await stockAuto.update({
      quantite: quantiteApres,
      dernier_ajustement_type: type_ajustement,
      dernier_ajustement_date: new Date()
    }, { transaction });
    
    // Créer l'historique de l'ajustement
    await StockAjustement.create({
      stock_auto_id: stockAuto.id,
      type_ajustement,
      quantite_avant: quantiteAvant,
      quantite_ajustee: quantiteAjustee,
      quantite_apres: quantiteApres,
      commentaire: commentaire || '',
      effectue_par: username,
      date_ajustement: new Date()
    }, { transaction });
    
    await transaction.commit();
    
    res.json({ 
      success: true, 
      message: 'Stock ajusté avec succès',
      data: {
        quantite_avant: quantiteAvant,
        quantite_ajustee: quantiteAjustee,
        quantite_apres: quantiteApres
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Erreur lors de l\'ajustement du stock:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// GET /api/stock-auto/historique/:stockAutoId - Historique des ajustements
// =====================================================
router.get('/historique/:stockAutoId', requireAuth, async (req, res) => {
  try {
    const { stockAutoId } = req.params;
    const { limit = 50 } = req.query;
    
    const ajustements = await StockAjustement.findAll({
      where: { stock_auto_id: stockAutoId },
      order: [['date_ajustement', 'DESC'], ['created_at', 'DESC']],
      limit: parseInt(limit)
    });
    
    res.json({ success: true, data: ajustements });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'historique:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// POST /api/stock-auto/decrementer - Décrémenter le stock (appelé lors d'une vente)
// =====================================================
router.post('/decrementer', requireAuth, async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { produit_nom, point_vente_nom, quantite } = req.body;
    
    if (!produit_nom || !point_vente_nom || !quantite) {
      return res.status(400).json({ 
        success: false, 
        error: 'produit_nom, point_vente_nom et quantite requis' 
      });
    }
    
    // Trouver le produit par nom
    const produit = await Produit.findOne({
      where: { 
        nom: produit_nom,
        mode_stock: 'automatique'
      }
    });
    
    if (!produit) {
      // Produit non trouvé ou pas en mode automatique - pas d'erreur, on ignore
      return res.json({ 
        success: true, 
        message: 'Produit non géré en mode automatique',
        decremented: false 
      });
    }
    
    // Trouver le point de vente
    const pointVente = await PointVente.findOne({
      where: { nom: point_vente_nom, active: true }
    });
    
    if (!pointVente) {
      return res.json({ 
        success: true, 
        message: 'Point de vente non trouvé',
        decremented: false 
      });
    }
    
    // Trouver ou créer le stock
    const [stockAuto, created] = await StockAuto.findOrCreate({
      where: { 
        produit_id: produit.id, 
        point_vente_id: pointVente.id 
      },
      defaults: {
        quantite: 0,
        prix_unitaire: produit.prix_defaut
      },
      transaction
    });
    
    // Décrémenter le stock
    const nouvelleQuantite = parseFloat(stockAuto.quantite) - parseFloat(quantite);
    await stockAuto.update({
      quantite: nouvelleQuantite
    }, { transaction });
    
    await transaction.commit();
    
    res.json({ 
      success: true, 
      message: 'Stock décrémenté',
      decremented: true,
      data: {
        produit: produit.nom,
        point_vente: pointVente.nom,
        quantite_vendue: quantite,
        nouveau_stock: nouvelleQuantite
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Erreur lors du décrément du stock:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// GET /api/stock-auto/reconciliation/:date - Données pour la réconciliation
// =====================================================
router.get('/reconciliation/:date', requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    const { point_vente_id } = req.query;
    
    const where = {};
    if (point_vente_id) where.point_vente_id = point_vente_id;
    
    // Récupérer tous les stocks automatiques
    const stocks = await StockAuto.findAll({
      where,
      include: [
        {
          model: Produit,
          as: 'produit',
          where: { mode_stock: 'automatique' },
          attributes: ['id', 'nom', 'unite_stock', 'prix_defaut']
        },
        {
          model: PointVente,
          as: 'pointVente',
          attributes: ['id', 'nom']
        }
      ]
    });
    
    // Formater les données pour la réconciliation
    const donnees = stocks.map(stock => {
      const valeur = parseFloat(stock.quantite) * parseFloat(stock.prix_unitaire);
      const unite = stock.produit.unite_stock === 'kilo' ? 'kg' : 'unités';
      
      let dernierAjustement = '';
      if (stock.dernier_ajustement_type && stock.dernier_ajustement_date) {
        const dateAjust = moment(stock.dernier_ajustement_date).format('DD/MM');
        dernierAjustement = `${stock.dernier_ajustement_type} ${dateAjust}`;
      }
      
      return {
        produit_id: stock.produit.id,
        produit_nom: stock.produit.nom,
        point_vente_id: stock.pointVente.id,
        point_vente_nom: stock.pointVente.nom,
        quantite: parseFloat(stock.quantite),
        unite: unite,
        prix_unitaire: parseFloat(stock.prix_unitaire),
        valeur: valeur,
        dernier_ajustement: dernierAjustement,
        stock_negatif: parseFloat(stock.quantite) < 0
      };
    });
    
    res.json({ success: true, data: donnees });
  } catch (error) {
    console.error('Erreur lors de la récupération des données de réconciliation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

