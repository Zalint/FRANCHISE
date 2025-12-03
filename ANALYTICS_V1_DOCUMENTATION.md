# 📊 Analytics Version 1 - Documentation Technique Complète

## Vue d'ensemble

La version 1 des analytics implémente un système de calcul de marges avec deux modes de fonctionnement distincts selon le contexte d'analyse (global vs spécifique à un point de vente). Cette approche permet une flexibilité maximale tout en maintenant la cohérence des calculs.

**Dernière mise à jour :** 2025-10-03

---

## 🎯 Principe Fondamental

Le système utilise une **logique adaptative** basée sur la disponibilité des données :

- **Mode GLOBAL** : Quand les données d'abattage sont disponibles → Calcul du ratio
- **Mode SPÉCIFIQUE** : Quand le ratio est connu pour un point de vente → Calcul de la quantité abattue

---

## 🌍 Mode GLOBAL

### Conditions d'activation
- Point de vente sélectionné : **"Sélectionner un point de vente"**
- Analyse sur **tous les points de vente**

### Sources de données

#### 📈 Quantités Abattues
**Source :** `/api/external/achats-boeuf`
- **Boeuf :** `totalKgBoeuf` pour la période concernée
- **Veau :** `totalKgVeau` pour la période concernée

#### 💰 Prix d'Achat

**Source :** `/api/external/achats-boeuf` avec **logique de retry automatique**

##### 🔄 Système de Retry (Nouvelle Fonctionnalité - 2025-10-03)

**Problématique :** Quand une période demandée ne contient aucun achat, l'API ne peut pas fournir de prix moyen pondéré.

**Solution :** Logique de retry automatique avec décalage de startDate :

1. Si l'appel initial ne retourne pas de données (ou prix = 0)
2. **Décaler startDate de -1 jour** (reculer dans le temps)
3. **Refaire l'appel** à `/api/external/achats-boeuf`
4. **Répéter** jusqu'à trouver des données (maximum 30 tentatives)
5. Une fois trouvé, **utiliser les prix** de cette période

**Exemple de Retry :**
```
Appel initial: startDate=01-10-2025, endDate=03-10-2025
→ Aucune donnée trouvée

Appel 2: startDate=30-09-2025, endDate=03-10-2025  (startDate -1 jour)
→ Aucune donnée trouvée

Appel 3: startDate=29-09-2025, endDate=03-10-2025  (startDate -1 jour)
→ ✅ Données trouvées! 
   - Prix Boeuf: 3450 FCFA
   - Prix Veau: 3550 FCFA
```

**Fonction Implémentée :**
```javascript
async function fetchAchatsBoeufWithRetry(initialStartDate, endDate, maxRetries = 30) {
    let currentStartDate = initialStartDate;
    let attempts = 0;
    
    while (attempts < maxRetries) {
        attempts++;
        
        // Call achats-boeuf API
        const achatsResponse = await fetch(achatsUrl, ...);
        
        // Check if we have valid data
        if (avgPrixKgBoeuf > 0 || avgPrixKgVeau > 0) {
            return {
                success: true,
                avgPrixKgBoeuf,
                avgPrixKgVeau,
                effectiveStartDate: currentStartDate,
                attempts
            };
        }
        
        // No data found, shift startDate -1 day and retry
        currentStartDate = decrementDate(currentStartDate, 1);
    }
    
    return { success: false };
}
```

**Avantages :**
- ✅ **Robustesse** : L'API trouve toujours des prix même si la période demandée n'a pas d'achats
- ✅ **Transparence** : Le debug info montre exactement quelle date a été utilisée
- ✅ **Traçabilité** : On sait combien de tentatives ont été nécessaires
- ✅ **Précision** : Utilise les derniers prix d'achat disponibles

**Prix Utilisés :**
- **Boeuf :** `avgPrixKgBoeuf` (depuis API avec retry)
- **Veau :** `avgPrixKgVeau` (depuis API avec retry)
- **Note :** Des valeurs fixes (3400/3500 FCFA) peuvent être utilisées comme fallback si aucune donnée n'est trouvée après 30 tentatives

#### 💵 Prix de Vente
**Source :** Base de données des ventes
- **Méthode :** Moyenne pondérée du prix unitaire (PU) sur la période
- **Calcul :** `SUM(PU * Quantité) / SUM(Quantité)`

#### 📦 Quantités Vendues
**Source :** Base de données des ventes
- **Méthode :** Somme totale des quantités vendues sur la période

### Formule de calcul du ratio

```javascript
ratio = ((qtéVendue / qtéAbattue) - 1) * 100
```

### Exemple de calcul (Mode GLOBAL)

```
Période : 01/08/2025 - 31/08/2025
Produit : Boeuf

Données récupérées :
- qtéAbattue = 1000 kg (depuis /api/external/achats-boeuf)
- qtéVendue = 978 kg (depuis ventes)
- prix d'achat = 3800 FCFA/kg (avgPrixKgBoeuf avec retry si nécessaire)
- prix de vente = 3604 FCFA/kg (moyenne pondérée des ventes)

Calcul :
ratio = ((978 / 1000) - 1) * 100 = -2.2%
```

---

## 🎯 Mode SPÉCIFIQUE

### Conditions d'activation
- Point de vente spécifique sélectionné (ex: "O.Foire", "Sacré Cœur")
- Analyse ciblée sur **un point de vente**

### Sources de données

#### 📊 Ratio
**Source :** `/api/external/reconciliation/aggregated`
- **Méthode :** Ratio spécifique calculé pour le point de vente concerné
- **Avantage :** Prise en compte des spécificités locales

**Exemple d'appel :**
```
GET /api/external/reconciliation/aggregated?startDate=01-08-2025&endDate=31-08-2025&pointVente=O.Foire
Headers: X-API-Key: your-api-key
```

**Exemple de réponse :**
```json
{
  "success": true,
  "data": {
    "period": {
      "startDate": "01/08/2025",
      "endDate": "31/08/2025",
      "totalDays": 31
    },
    "details": {
      "O.Foire": {
        "Boeuf": {
          "ventesNombre": -40.60,
          "ventesTheoriquesNombre": -41.49,
          "ventesValeur": -146323.45,
          "ventesTheoriquesValeur": -149540.96,
          "ecartNombre": 0.89,
          "ecartValeur": 3217.51,
          "stockInitial": 0,
          "stockFinal": 0,
          "stockMatinNombre": 0,
          "stockSoirNombre": 0
        },
        "Veau": {
          "ventesNombre": 12.50,
          "ventesTheoriquesNombre": 12.77,
          "ventesValeur": 56250.00,
          "ventesTheoriquesValeur": 57465.00,
          "ecartNombre": -0.27,
          "ecartValeur": -1215.00,
          "stockInitial": 0,
          "stockFinal": 0,
          "stockMatinNombre": 0,
          "stockSoirNombre": 0
        }
      }
    },
    "resume": [
      {
        "pointVente": "O.Foire",
        "totalVentesValeur": "-90073.45",
        "totalVentesTheoriquesValeur": "-92075.96",
        "totalEcartValeur": "2002.51",
        "pourcentageEcart": "-2.15"
      }
    ],
    "metadata": {
      "recordsProcessed": 28,
      "pointsDeVente": 1
    }
  }
}
```

**Explication des champs :**
- **`period`** : Informations sur la période analysée
- **`details`** : Données détaillées par point de vente et par produit
  - `ventesNombre` : Quantité réelle vendue (kg)
  - `ventesTheoriquesNombre` : Quantité théorique basée sur les stocks (kg)
  - `ventesValeur` : Valeur des ventes réelles (FCFA)
  - `ventesTheoriquesValeur` : Valeur théorique des ventes (FCFA)
  - `ecartNombre` : Écart en quantité (théorique - réel)
  - `ecartValeur` : Écart en valeur (théorique - réel)
- **`resume`** : Résumé agrégé par point de vente
  - `pourcentageEcart` : Ratio global (mixe tous les produits) - **NON utilisé par les analytics** (-2.15% dans cet exemple)
- **`metadata`** : Métadonnées sur le traitement des données

**🧮 Calcul détaillé du ratio (pourcentageEcart) :**

**⚠️ DISTINCTION IMPORTANTE :**
L'API `/api/external/reconciliation/aggregated` calcule DEUX types de ratios :

1. **Section `details`** : Ratios séparés par produit → **UTILISÉS par les analytics**
2. **Section `resume`** : Ratio global qui mixe tous les produits → **NON utilisé par les analytics**

Le ratio global de -2.15% de la section `resume` est calculé selon cette formule :

```javascript
ratio = (totalEcartValeur / totalVentesTheoriquesValeur) × 100
```

### 📊 **Étape 1 : Calcul des valeurs individuelles par produit**

Pour chaque produit (Boeuf, Veau, etc.) et chaque point de vente, l'API `/api/external/reconciliation` calcule :

```javascript
// 1. Ventes réelles (FCFA)
ventesValeur = ventesSaisies  // Montant total des ventes saisies dans la base

// 2. Ventes théoriques (FCFA) 
ventesTheoriquesValeur = stockMatin - stockSoir + transferts  // Calcul des mouvements de stock

// 3. Écart (FCFA)
ecartValeur = ventesTheoriquesValeur - ventesValeur  // Différence théorique vs réel
```

### 📈 **Étape 2 : Agrégation sur la période**

L'API `/api/external/reconciliation/aggregated` agrège ces valeurs jour par jour :

```javascript
// Pour chaque produit sur toute la période
currentProduct.ventesValeur += parseFloat(productData.ventesValeur || 0);
currentProduct.ventesTheoriquesValeur += parseFloat(productData.ventesTheoriquesValeur || 0);
currentProduct.ecartValeur += parseFloat(productData.ecartValeur || 0);
```

### 🎯 **Étape 3 : Calcul du ratio total**

```javascript
// Pour chaque point de vente
Object.values(pointData).forEach(productData => {
    totalVentesValeur += productData.ventesValeur;
    totalVentesTheoriquesValeur += productData.ventesTheoriquesValeur;
    totalEcartValeur += productData.ecartValeur;
});

// Calcul final du ratio
ratio = (totalEcartValeur / totalVentesTheoriquesValeur) × 100
```

**📋 Exemple de calcul détaillé avec les données ci-dessus :**

**Point de vente: O.Foire**

### **Calculs par produit individuel:**

**🥩 Produit : Boeuf**
```javascript
// Données agrégées sur la période (01/08 - 31/08/2025)
ventesValeur = -146323.45 FCFA        // Ventes réelles saisies
ventesTheoriquesValeur = -149540.96 FCFA  // Calculé par mouvements de stock
ecartValeur = -149540.96 - (-146323.45) = -3217.51 FCFA
```

**🐄 Produit : Veau**
```javascript
// Données agrégées sur la période (01/08 - 31/08/2025)
ventesValeur = 56250.00 FCFA           // Ventes réelles saisies
ventesTheoriquesValeur = 57465.00 FCFA // Calculé par mouvements de stock
ecartValeur = 57465.00 - 56250.00 = 1215.00 FCFA
```

### **⚠️ ATTENTION : Calculs séparés par produit dans les analytics**

**🚨 CORRECTION IMPORTANTE :** 
Les analytics **N'utilisent PAS** le ratio global qui mixe boeuf et veau. 
À la place, ils calculent des **ratios séparés par produit** :

**🥩 Ratio Boeuf (utilisé par les analytics) :**
```javascript
// Données du point de vente O.Foire - Produit Boeuf uniquement
ventesNombre = -40.60 kg              // Quantité réelle vendue
ventesTheoriquesNombre = -41.49 kg    // Quantité théorique

// Calcul du ratio Boeuf
ratioBoeuf = (ventesNombre / ventesTheoriquesNombre) - 1
ratioBoeuf = (-40.60 / -41.49) - 1 = 0.9785 - 1 = -0.0215 = -2.15%
```

**🐄 Ratio Veau (utilisé par les analytics) :**
```javascript
// Données du point de vente O.Foire - Produit Veau uniquement  
ventesNombre = 12.50 kg               // Quantité réelle vendue
ventesTheoriquesNombre = 12.77 kg     // Quantité théorique

// Calcul du ratio Veau
ratioVeau = (ventesNombre / ventesTheoriquesNombre) - 1
ratioVeau = (12.50 / 12.77) - 1 = 0.9789 - 1 = -0.0211 = -2.11%
```

**✅ COHÉRENCE MATHÉMATIQUE CONFIRMÉE :**

Les analytics appliquent le ratio de manière mathématiquement correcte :

```javascript
// ✅ COHÉRENT : Le ratio est calculé entre ventes réelles et ventes théoriques
ratioBoeuf = (ventesNombre / ventesTheoriquesNombre) - 1

// ✅ COHÉRENT : Et utilisé pour "calculer" la quantité abattue 
quantiteAbattueBoeuf = quantiteVendueBoeuf / (1 + ratioBoeuf)
```

**🎯 Réalité :**
- `ventesTheoriquesNombre` = stockMatin + transferts - stockSoir (mouvements de stock)
- `quantiteAbattue` = **IDENTIQUE à `ventesTheoriquesNombre`** (hypothèse du système)

**💡 Stratégie du code :**
Le système fait l'hypothèse simplificatrice que les mouvements de stock (`ventesTheoriquesNombre`) représentent fidèlement la quantité abattue. Cette approche est pragmatique et mathématiquement cohérente.

**💡 Source des ratios pour les analytics :** 
Ces ratios séparés par produit sont extraits de la section `details` de l'API `/api/external/reconciliation/aggregated` par la fonction `calculerRatiosPerteOptimise()` :

```javascript
// Code réel des analytics (script.js lignes 14045-14064)
if (pointData.Boeuf) {
    const ventesNombre = parseFloat(pointData.Boeuf.ventesNombre) || 0;
    const ventesTheoriquesNombre = parseFloat(pointData.Boeuf.ventesTheoriquesNombre) || 0;
    
    if (ventesTheoriquesNombre > 0) {
        ratioBoeuf = (ventesNombre / ventesTheoriquesNombre) - 1;
    }
}

if (pointData.Veau) {
    const ventesNombre = parseFloat(pointData.Veau.ventesNombre) || 0;
    const ventesTheoriquesNombre = parseFloat(pointData.Veau.ventesTheoriquesNombre) || 0;
    
    if (ventesTheoriquesNombre > 0) {
        ratioVeau = (ventesNombre / ventesTheoriquesNombre) - 1;
    }
}
```

**📊 La section `resume` avec le ratio global n'est PAS utilisée par les analytics.**

#### 💰 Prix d'Achat
**Source :** `/api/external/achats-boeuf` avec **logique de retry automatique**
- **Boeuf :** `avgPrixKgBoeuf` (depuis API avec retry)
- **Veau :** `avgPrixKgVeau` (depuis API avec retry)
- **Note :** Même logique de retry que le mode GLOBAL

#### 💵 Prix de Vente
**Source :** Base de données des ventes (filtrées par point de vente)
- **Méthode :** Moyenne pondérée du prix unitaire pour le point de vente spécifique
- **Calcul :** `SUM(PU * Quantité) / SUM(Quantité)` WHERE `point_vente = 'Point de vente spécifique'`

#### 📦 Quantités Vendues
**Source :** Base de données des ventes (filtrées par point de vente)
- **Méthode :** Somme des quantités vendues pour le point de vente spécifique

### Formule de calcul des quantités abattues

```javascript
qtéAbattue = qtéVendue / (1 + ratio)
```

### Exemple de calcul (Mode SPÉCIFIQUE)

```
Période : 01/08/2025 - 31/08/2025
Produit : Boeuf
Point de vente : O.Foire

Données récupérées :
- ratioBoeuf = -2.15% (depuis details.O.Foire.Boeuf dans l'API aggregated)
- qtéVendueBoeuf = -40.60 kg (depuis ventes O.Foire)
- prix d'achat = 3400 FCFA/kg (depuis API avec retry)
- prix de vente = 3604 FCFA/kg (moyenne O.Foire)

Calcul des quantités abattues pour le Boeuf :
qtéAbattueBoeuf = qtéVendueBoeuf / (1 + ratioBoeuf)
qtéAbattueBoeuf = -40.60 / (1 + (-0.0215))
qtéAbattueBoeuf = -40.60 / 0.9785 = -41.49 kg

**🎯 RÉVÉLATION :** Le résultat (-41.49 kg) est exactement identique à `ventesTheoriquesNombre` !

**🧮 Vérification mathématique :**

Sachant que :
- `quantiteVendueBoeuf` = `ventesNombre` = -40.60 kg
- `quantiteAbattueBoeuf` = `ventesTheoriquesNombre` = -41.49 kg

La formule devient :
```javascript
ventesTheoriquesNombre = ventesNombre / (1 + ratioBoeuf)

Où ratioBoeuf = (ventesNombre / ventesTheoriquesNombre) - 1
```

**Preuve de cohérence :**
```javascript
1 + ratioBoeuf = 1 + (ventesNombre / ventesTheoriquesNombre) - 1
1 + ratioBoeuf = ventesNombre / ventesTheoriquesNombre

Donc : ventesNombre / (1 + ratioBoeuf) = ventesNombre / (ventesNombre / ventesTheoriquesNombre) 
                                       = ventesTheoriquesNombre
```

**✅ CONCLUSION :** La formule est mathématiquement cohérente ! 
Le système utilise simplement `ventesTheoriquesNombre` comme proxy pour la `quantiteAbattue`.

**🔍 Preuve mathématique complète :**
```javascript
// Formule utilisée
quantiteAbattue = quantiteVendue / (1 + ratio)

// Avec ratio = (ventesNombre / ventesTheoriquesNombre) - 1
// Devient : quantiteAbattue = ventesNombre / (ventesNombre / ventesTheoriquesNombre)
//          = ventesTheoriquesNombre

// ✅ CQFD : Le système retourne simplement ventesTheoriquesNombre !
```

---

## 💡 ANALYSE CLARIFIÉE : Hypothèse Simplificatrice

### 🎯 **Vraie Nature du Système**

Le système n'est **pas incohérent**, il fait une **hypothèse simplificatrice claire** :

**💡 Hypothèse fondamentale :**
```
quantiteAbattue = ventesTheoriquesNombre = stockMatin + transferts - stockSoir
```

### 📊 **Chaîne Logique Réelle**
```
ventesTheoriquesNombre = stockMatin + transferts - stockSoir
                ↓ [Hypothèse: = quantiteAbattue]
quantiteAbattue = ventesTheoriquesNombre
                ↓ [Ratio de perte appliqué]
quantiteVendue = quantiteAbattue × (1 + ratio)
```

### ✅ **Avantages de cette approche**
- **Mathématiquement cohérente** : Les calculs sont justes
- **Basée sur les données disponibles** : Utilise les mouvements de stock réels
- **Automatique** : Pas besoin de saisie manuelle des quantités abattues

### ⚠️ **Limitations**
- **Hypothèse forte** : Assume que les mouvements de stock reflètent parfaitement l'abattage
- **Dépendance** : Qualité des résultats liée à la précision de la gestion des stocks
- **Simplification** : Ne distingue pas les pertes à l'abattage des pertes de stockage

### 🎯 **Évaluation**
Cette approche est **pragmatique et valide** pour un système de gestion intégré où les stocks sont bien maîtrisés.

---

## 🔄 Logique de Sélection Automatique

Le système détermine automatiquement le mode à utiliser :

```javascript
if (pointVente === 'Sélectionner un point de vente') {
    // Mode GLOBAL
    // Utiliser les données d'abattage pour calculer le ratio
    ratio = calculerRatioDepuisAbattage(qtéVendue, qtéAbattue);
} else {
    // Mode SPÉCIFIQUE  
    // Utiliser le ratio pour calculer les quantités abattues
    qtéAbattue = qtéVendue / (1 + ratio);
}
```

---

## 📊 Totaux : Avec et Sans Stock Soir (Nouvelle Fonctionnalité - 2025-10-03)

### Contexte Métier

#### Le Problème
Stock Soir représente **la variation d'inventaire** (changement de valeur de stock), pas le chiffre d'affaires réel. Quand le stock diminue significativement, la valeur négative de Stock Soir peut faire apparaître le `totalChiffreAffaires` proche de zéro ou négatif, même quand les ventes réelles sont substantielles.

**Exemple - Dahra :**
- Ventes Poulet : 108,700 FCFA (revenu réel)
- Stock Soir : -108,718 FCFA (diminution d'inventaire)
- Total CA (avec Stock) : -18 FCFA (apparaît comme aucun revenu !)

#### La Solution
Fournir **deux métriques** dans la réponse API :
1. **Totaux originaux** (avec Stock Soir) - pour l'analyse financière complète incluant l'inventaire
2. **Nouveaux totaux** (sans Stock Soir) - pour l'analyse pure des revenus de ventes

### Structure de Réponse

#### Objet `totaux` par Point de Vente (6 champs)
```javascript
totaux: {
    // Champs originaux (avec Stock Soir)
    totalChiffreAffaires: totalChiffreAffaires,
    totalCout: totalCout,
    totalMarge: totalMarge,
    
    // ✅ NOUVEAUX CHAMPS (sans Stock Soir)
    totalChiffreAffairesSansStockSoir: totalChiffreAffairesSansStockSoir,
    totalCoutSansStockSoir: totalCoutSansStockSoir,
    totalMargeSansStockSoir: totalMargeSansStockSoir
}
```

#### Objet `totauxGeneraux` (6 champs)
```javascript
totauxGeneraux: {
    // Avec Stock Soir
    totalChiffreAffaires: 0,
    totalCout: 0,
    totalMarge: 0,
    
    // Sans Stock Soir
    totalChiffreAffairesSansStockSoir: 0,
    totalCoutSansStockSoir: 0,
    totalMargeSansStockSoir: 0
}
```

### Exemple de Réponse API

```json
{
  "analytics": {
    "proxyMarges": {
      "Dahra": {
        "poulet": { "chiffreAffaires": 108700, ... },
        "stockSoir": { "chiffreAffaires": -108718, ... },
        "totaux": {
          "totalChiffreAffaires": -18,
          "totalCout": 0,
          "totalMarge": -18,
          "totalChiffreAffairesSansStockSoir": 108700,
          "totalCoutSansStockSoir": 94100,
          "totalMargeSansStockSoir": 14600
        },
        "debug": {
          "achatsBoeuf": {
            "requestedStartDate": "01-10-2025",
            "effectiveStartDate": "25-09-2025",
            "attemptsRequired": 6,
            "prixBoeufUtilise": 3450,
            "prixVeauUtilise": 3550,
            "comment": "Aucune donnée trouvée pour la période initiale. Données trouvées à partir du 25-09-2025 après 6 tentative(s)."
          }
        }
      }
    },
    "totauxGeneraux": {
      "totalChiffreAffaires": 4236689,
      "totalCout": 3675596,
      "totalMarge": 561094,
      "totalChiffreAffairesSansStockSoir": 5445890,
      "totalCoutSansStockSoir": 4894100,
      "totalMargeSansStockSoir": 551790
    }
  }
}
```

### Cas d'Usage

#### Utiliser `totalChiffreAffaires` (avec Stock Soir) pour :
- Analyse financière complète incluant l'inventaire
- Compréhension des opérations totales du business
- Comptabilité nécessitant de factoriser les changements de stock

#### Utiliser `totalChiffreAffairesSansStockSoir` (sans Stock Soir) pour :
- Analyse pure des revenus de ventes
- Métriques de performance focalisées sur l'activité de vente
- Rapports de revenus excluant les ajustements d'inventaire
- Comparaison des ventes réelles entre périodes

---

## 🐛 Debug Information

### Nouveau Champ `debug.achatsBoeuf` (2025-10-03)

Chaque point de vente dans la réponse API inclut maintenant des informations de debug sur le processus de récupération des prix d'achat :

```json
{
  "debug": {
    "achatsBoeuf": {
      "requestedStartDate": "01-10-2025",
      "effectiveStartDate": "25-09-2025",
      "attemptsRequired": 6,
      "prixBoeufUtilise": 3450,
      "prixVeauUtilise": 3550,
      "comment": "Aucune donnée trouvée pour la période initiale. Données trouvées à partir du 25-09-2025 après 6 tentative(s)."
    }
  }
}
```

### Champs du Debug Info

| Champ | Type | Description |
|-------|------|-------------|
| `requestedStartDate` | string | Date de début demandée initialement |
| `effectiveStartDate` | string | Date de début effective où des données ont été trouvées |
| `attemptsRequired` | number | Nombre de tentatives nécessaires |
| `prixBoeufUtilise` | number | Prix d'achat moyen pondéré du boeuf utilisé (FCFA/kg) |
| `prixVeauUtilise` | number | Prix d'achat moyen pondéré du veau utilisé (FCFA/kg) |
| `comment` | string | Message explicatif sur le processus de recherche |

### Scénarios de Debug

#### Cas 1 : Données Trouvées Immédiatement
```json
{
  "debug": {
    "achatsBoeuf": {
      "requestedStartDate": "15-09-2025",
      "effectiveStartDate": "15-09-2025",
      "attemptsRequired": 1,
      "prixBoeufUtilise": 3420,
      "prixVeauUtilise": 3530,
      "comment": "Données trouvées pour la période demandée."
    }
  }
}
```

#### Cas 2 : Retry Nécessaire
```json
{
  "debug": {
    "achatsBoeuf": {
      "requestedStartDate": "01-10-2025",
      "effectiveStartDate": "25-09-2025",
      "attemptsRequired": 6,
      "prixBoeufUtilise": 3450,
      "prixVeauUtilise": null,
      "comment": "Aucune donnée trouvée pour la période initiale. Données trouvées à partir du 25-09-2025 après 6 tentative(s)."
    }
  }
}
```

#### Cas 3 : Aucune Donnée Trouvée
```json
{
  "debug": {
    "achatsBoeuf": {
      "requestedStartDate": "01-10-2025",
      "effectiveStartDate": null,
      "attemptsRequired": 30,
      "prixBoeufUtilise": null,
      "prixVeauUtilise": null,
      "comment": "Aucune donnée d'achat trouvée après 30 tentatives. Prix par défaut utilisés."
    }
  }
}
```

---

## 📋 Avantages de cette Approche

### 🌍 Mode GLOBAL
- ✅ **Précision des données d'abattage** : Utilise les vraies données d'achat
- ✅ **Vision d'ensemble** : Calculs basés sur la totalité des opérations
- ✅ **Ratios dynamiques** : Calculs en temps réel selon les données réelles
- ✅ **Robustesse des prix** : Retry automatique pour trouver des prix d'achat

### 🎯 Mode SPÉCIFIQUE
- ✅ **Spécificités locales** : Ratios adaptés à chaque point de vente
- ✅ **Flexibilité** : Permet des analyses ciblées
- ✅ **Cohérence** : Utilise les ratios déjà calculés et validés
- ✅ **Robustesse des prix** : Retry automatique pour trouver des prix d'achat

### 📊 Totaux Multiples
- ✅ **Flexibilité d'analyse** : Deux perspectives sur les performances
- ✅ **Compatibilité arrière** : Les champs originaux restent inchangés
- ✅ **Transparence** : Les deux calculs sont visibles dans la même réponse
- ✅ **Pas de breaking changes** : Les intégrations existantes continuent de fonctionner

### 🔄 Retry Logic
- ✅ **Robustesse** : Trouve toujours des prix même si la période demandée n'a pas d'achats
- ✅ **Transparence** : Le debug info montre exactement quelle date a été utilisée
- ✅ **Traçabilité** : On sait combien de tentatives ont été nécessaires
- ✅ **Précision** : Utilise les derniers prix d'achat disponibles
- ✅ **Pas de valeurs par défaut arbitraires** : Les prix reflètent les vrais achats

---

## 🔍 Formules Clés

### Ratio de Perte
```
Ratio = ((Quantité Vendue / Quantité Abattue) - 1) × 100
```

### Quantité Abattue (calcul inverse)
```
Quantité Abattue = Quantité Vendue / (1 + Ratio)
```

### Prix Moyen de Vente
```
Prix Moyen = SUM(Prix Unitaire × Quantité) / SUM(Quantité)
```

### Marge
```
Marge = (Quantité Vendue × Prix Vente) - (Quantité Abattue × Prix Achat)
```

### Totaux Sans Stock Soir
```
Total CA Sans Stock = Σ(CA par produit) - CA Stock Soir
Total Coût Sans Stock = Σ(Coût par produit) - Coût Stock Soir
Total Marge Sans Stock = Σ(Marge par produit) - Marge Stock Soir
```

---

## 🔧 Implémentation Technique

### Endpoints Utilisés

| Mode | Endpoint | Données Récupérées |
|------|----------|-------------------|
| GLOBAL | `/api/external/achats-boeuf` | totalKgBoeuf, totalKgVeau, avgPrixKgBoeuf (avec retry), avgPrixKgVeau (avec retry) |
| SPÉCIFIQUE | `/api/external/reconciliation/aggregated` | Ratios séparés par produit (section `details`) |
| COMMUN | Base de données ventes | Prix de vente, quantités vendues |

**⚠️ IMPORTANT :** 
- Les analytics utilisent les données de la section `details` (ratios par produit)
- La section `resume` (ratio global) n'est PAS utilisée par les analytics
- Le retry automatique s'applique à tous les appels à `/api/external/achats-boeuf`

### Structure de Données

```javascript
// Mode GLOBAL
{
    mode: 'global',
    qtéAbattue: 1000,      // depuis achats-boeuf
    qtéVendue: 978,        // calculé depuis ventes
    ratio: -2.2,           // calculé
    prixAchat: 3800,       // avgPrixKgBoeuf (avec retry)
    prixVente: 3604        // moyenne pondérée
}

// Mode SPÉCIFIQUE
{
    mode: 'spécifique',
    pointVente: 'O.Foire',
    produits: {
        'Boeuf': {
            qtéVendue: -40.60,     // depuis ventes filtrées
            ratioBoeuf: -2.15,     // depuis details.O.Foire.Boeuf
            qtéAbattue: -41.49,    // calculé avec ratioBoeuf
            prixAchat: 3400,       // depuis API avec retry
            prixVente: 3500        // moyenne pondérée filtrée
        },
        'Veau': {
            qtéVendue: 12.50,      // depuis ventes filtrées  
            ratioVeau: -2.11,      // depuis details.O.Foire.Veau
            qtéAbattue: 12.77,     // calculé avec ratioVeau
            prixAchat: 3500,       // depuis API avec retry
            prixVente: 4500        // moyenne pondérée filtrée
        }
    },
    totaux: {
        // Avec Stock Soir
        totalChiffreAffaires: 100000,
        totalCout: 80000,
        totalMarge: 20000,
        // Sans Stock Soir
        totalChiffreAffairesSansStockSoir: 120000,
        totalCoutSansStockSoir: 95000,
        totalMargeSansStockSoir: 25000
    },
    debug: {
        achatsBoeuf: {
            requestedStartDate: '01-10-2025',
            effectiveStartDate: '25-09-2025',
            attemptsRequired: 6,
            prixBoeufUtilise: 3450,
            prixVeauUtilise: 3550,
            comment: 'Aucune donnée trouvée pour la période initiale...'
        }
    }
}
```

### Fichiers Modifiés

| Fichier | Fonction | Lignes | Description |
|---------|----------|--------|-------------|
| `server.js` | `fetchAchatsBoeufWithRetry()` | ~9597-9683 | Nouvelle fonction de retry avec décalage de date |
| `server.js` | `getProxyMargesViaAPI()` | ~9872-9919 | Utilise la fonction de retry |
| `server.js` | `getProxyMargesViaAPI()` | ~9904-9956 | Calcul des totaux avec et sans Stock Soir |
| `server.js` | Analytics API endpoint | ~9530-9565 | Initialisation et accumulation des totauxGeneraux |
| `server.js` | `getProxyMargesViaAPI()` | ~10058-10061 | Ajout du debug info dans la réponse |

---

## 🎯 Cohérence du Système

Cette logique est **parfaitement cohérente** car :

1. **Adaptabilité** : Le système utilise les meilleures données disponibles selon le contexte
2. **Complémentarité** : Les deux modes se complètent pour couvrir tous les cas d'usage
3. **Précision** : Mode GLOBAL pour la vue d'ensemble, Mode SPÉCIFIQUE pour l'analyse détaillée
4. **Flexibilité** : Permet l'analyse à différents niveaux de granularité
5. **Robustesse** : Le retry automatique garantit la disponibilité des prix d'achat
6. **Transparence** : Les informations de debug permettent de tracer l'origine des données
7. **Polyvalence** : Les totaux avec/sans Stock Soir offrent deux perspectives analytiques

### Principe Directeur
> **Mode GLOBAL** : "J'ai les données d'abattage → je calcule le ratio"
> 
> **Mode SPÉCIFIQUE** : "J'ai le ratio → je calcule la quantité abattue"
>
> **Retry Logic** : "Pas de données ? → je recule dans le temps jusqu'à en trouver"
>
> **Totaux Multiples** : "Stock Soir = inventaire, pas revenu → je fournis les deux visions"

---

## 📚 Notes Techniques

- Les calculs sont effectués en temps réel à chaque analyse
- Les ratios négatifs indiquent des pertes (normal dans le secteur)
- La moyenne pondérée assure une représentation fidèle des prix
- Le filtrage par point de vente garantit la précision des analyses locales
- Le retry automatique peut effectuer jusqu'à 30 tentatives avec décalage de -1 jour
- Les totaux sans Stock Soir excluent uniquement le produit "Stock Soir"
- Le debug info est inclus dans chaque réponse pour traçabilité
- Tous les formats de date supportés : DD-MM-YYYY, YYYY-MM-DD, DD/MM/YYYY, DD/MM/YY

---

## 🚀 Exemple d'Utilisation Complète

```javascript
// Appel API
const response = await fetch(
  'https://keur-bali.onrender.com/api/external/analytics?pointVente=Dahra&startDate=01-10-2025&endDate=03-10-2025',
  { headers: { 'X-API-Key': 'your-api-key' } }
);

const data = await response.json();
const dahraData = data.data.analytics.proxyMarges.Dahra;

// Accéder aux totaux (avec Stock Soir)
console.log('CA Total avec Stock:', dahraData.totaux.totalChiffreAffaires);
console.log('Marge avec Stock:', dahraData.totaux.totalMarge);

// Accéder aux totaux (sans Stock Soir) - NOUVEAU
console.log('CA Ventes Pures:', dahraData.totaux.totalChiffreAffairesSansStockSoir);
console.log('Marge Ventes Pures:', dahraData.totaux.totalMargeSansStockSoir);

// Analyser l'impact du Stock Soir
const stockImpact = dahraData.stockSoir.chiffreAffaires;
console.log('Impact Stock Soir:', stockImpact);

// Vérifier le debug info - NOUVEAU
const debugInfo = dahraData.debug.achatsBoeuf;
console.log('Date effective utilisée:', debugInfo.effectiveStartDate);
console.log('Tentatives nécessaires:', debugInfo.attemptsRequired);
console.log('Prix Boeuf utilisé:', debugInfo.prixBoeufUtilise);
console.log('Commentaire:', debugInfo.comment);

// Accéder aux totaux généraux
const totauxGen = data.data.analytics.totauxGeneraux;
console.log('Total Global avec Stock:', totauxGen.totalChiffreAffaires);
console.log('Total Global sans Stock:', totauxGen.totalChiffreAffairesSansStockSoir);
```

---

## 📅 Gestion des Dates par Défaut

### Comportement Standard

Quand aucune date n'est fournie à l'API `/api/external/analytics`, le système applique des dates par défaut :

```javascript
// Comportement normal
startDate par défaut = Premier jour du mois en cours
endDate par défaut = Hier
```

**Exemple** (15 janvier 2025) :
```
Appel: GET /api/external/analytics
Résultat: Période du 01/01/2025 au 14/01/2025
```

### 🎯 Règle Spéciale : Premier Jour du Mois

**Nouvelle fonctionnalité** (2025-10-03) : Pour éviter une période vide le premier jour du mois, une règle spéciale s'applique.

#### Conditions d'Activation

```javascript
SI:
  - Aucun startDate fourni ET
  - Aucun endDate fourni ET  
  - Aujourd'hui = 1er du mois

ALORS:
  startDate = Aujourd'hui (1er du mois)
  endDate = Aujourd'hui (1er du mois)
```

#### Exemples de Scénarios

**Scénario 1 : Appel le 1er janvier SANS arguments**
```javascript
Date actuelle: 01/01/2025
Appel: GET /api/external/analytics

✅ Règle spéciale activée
Période: 01/01/2025 à 01/01/2025 (seulement le 1er janvier)
```

**Scénario 2 : Appel le 15 janvier SANS arguments**
```javascript
Date actuelle: 15/01/2025
Appel: GET /api/external/analytics

📆 Comportement normal
Période: 01/01/2025 à 14/01/2025 (du 1er au 14)
```

**Scénario 3 : Appel le 1er janvier AVEC arguments**
```javascript
Date actuelle: 01/01/2025
Appel: GET /api/external/analytics?startDate=15-12-2024&endDate=31-12-2024

📆 Arguments utilisateur prioritaires
Période: 15/12/2024 à 31/12/2024 (dates fournies)
```

**Scénario 4 : Appel le 1er octobre SANS arguments**
```javascript
Date actuelle: 01/10/2025
Appel: GET /api/external/analytics

✅ Règle spéciale activée
Période: 01/10/2025 à 01/10/2025 (seulement le 1er octobre)
```

#### Objectif de cette Règle

**Problème résolu** : Sans cette règle, le premier jour du mois donnerait :
```
startDate = 01/01/2025 (premier du mois)
endDate = 31/12/2024 (hier)
→ Période invalide (endDate < startDate)
```

**Solution** : La règle spéciale assure qu'une période valide d'un jour est utilisée.

#### Implémentation Technique

```javascript
// Code dans server.js (lignes ~9486-9516)

const isFirstDayOfMonth = () => {
    const today = new Date();
    return today.getDate() === 1;
};

const getToday = () => {
    const today = new Date();
    const day = today.getDate().toString().padStart(2, '0');
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const year = today.getFullYear();
    return `${day}/${month}/${year}`;
};

// Logique de sélection des dates
if (!startDate && !endDate && isFirstDayOfMonth()) {
    // 🎯 RÈGLE SPÉCIALE
    finalStartDate = getToday();
    finalEndDate = getToday();
    console.log('🗓️  Premier jour du mois détecté - période limitée à aujourd\'hui uniquement');
} else {
    // 📆 COMPORTEMENT NORMAL
    finalStartDate = startDate ? normalizeDate(startDate) : getFirstDayOfMonth();
    finalEndDate = endDate ? normalizeDate(endDate) : getYesterday();
}
```

#### Console Logs

Le système log clairement quel comportement est appliqué :

```bash
# Premier jour du mois sans arguments
🗓️  Premier jour du mois détecté - période limitée à aujourd'hui uniquement
📅 Final dates: 01/10/2025 to 01/10/2025

# Autre jour du mois sans arguments
📅 Final dates: 01/10/2025 to 14/10/2025
```

---

## 📝 Changelog

### Version 1.3 - 2025-10-03
- ✅ **Ajout** : Règle spéciale pour le premier jour du mois (dates par défaut)
- ✅ **Amélioration** : Évite les périodes invalides le 1er du mois
- ✅ **Documentation** : Section complète sur la gestion des dates par défaut

### Version 1.2 - 2025-10-03
- ✅ **Ajout** : Totaux sans Stock Soir (`totalChiffreAffairesSansStockSoir`, `totalCoutSansStockSoir`, `totalMargeSansStockSoir`)
- ✅ **Ajout** : Logique de retry automatique pour `/api/external/achats-boeuf`
- ✅ **Ajout** : Section `debug.achatsBoeuf` avec informations de traçabilité
- ✅ **Amélioration** : Robustesse du système face aux périodes sans données d'achat
- ✅ **Amélioration** : Flexibilité d'analyse avec deux perspectives (avec/sans Stock Soir)

### Version 1.1
- Documentation initiale du système analytics
- Mode GLOBAL et Mode SPÉCIFIQUE
- Calculs de ratios et marges

---

*Document généré et mis à jour le 2025-10-03 - Analytics Version 1.3*
