# 📊 Analytics Version 1 - Documentation Technique

## Vue d'ensemble

La version 1 des analytics implémente un système de calcul de marges avec deux modes de fonctionnement distincts selon le contexte d'analyse (global vs spécifique à un point de vente). Cette approche permet une flexibilité maximale tout en maintenant la cohérence des calculs.

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
**Source :** **VALEURS FIXES** dans le code (priceConfig)
- **Boeuf :** 3,400 FCFA/kg (hardcodé)
- **Veau :** 3,500 FCFA/kg (hardcodé)
- **Note :** L'API `/api/external/achats-boeuf` existe et pourrait fournir des prix dynamiques (`avgPrixKgBoeuf`, `avgPrixKgVeau`) mais n'est pas utilisée actuellement

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
- prix d'achat = 3800 FCFA/kg (avgPrixKgBoeuf)
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
**Source :** **VALEURS FIXES** dans le code (priceConfig)
- **Boeuf :** 3,400 FCFA/kg (hardcodé)
- **Veau :** 3,500 FCFA/kg (hardcodé)
- **Note :** Même logique que le mode GLOBAL - prix fixes utilisés

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
- prix d'achat = 3400 FCFA/kg (configuration)
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

## 📋 Avantages de cette Approche

### 🌍 Mode GLOBAL
- ✅ **Précision des données d'abattage** : Utilise les vraies données d'achat
- ✅ **Vision d'ensemble** : Calculs basés sur la totalité des opérations
- ✅ **Ratios dynamiques** : Calculs en temps réel selon les données réelles

### 🎯 Mode SPÉCIFIQUE
- ✅ **Spécificités locales** : Ratios adaptés à chaque point de vente
- ✅ **Flexibilité** : Permet des analyses ciblées
- ✅ **Cohérence** : Utilise les ratios déjà calculés et validés

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

---

## 🔧 Implémentation Technique

### Endpoints Utilisés

| Mode | Endpoint | Données Récupérées |
|------|----------|-------------------|
| GLOBAL | `/api/external/achats-boeuf` | totalKgBoeuf, totalKgVeau, avgPrixKgBoeuf, avgPrixKgVeau |
| SPÉCIFIQUE | `/api/external/reconciliation/aggregated` | Ratios séparés par produit (section `details`) |
| COMMUN | Base de données ventes | Prix de vente, quantités vendues |

**⚠️ IMPORTANT :** 
- Les analytics utilisent les données de la section `details` (ratios par produit)
- La section `resume` (ratio global) n'est PAS utilisée par les analytics

### Structure de Données

```javascript
// Mode GLOBAL
{
    mode: 'global',
    qtéAbattue: 1000,      // depuis achats-boeuf
    qtéVendue: 978,        // calculé depuis ventes
    ratio: -2.2,           // calculé
    prixAchat: 3800,       // avgPrixKgBoeuf
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
            prixAchat: 3400,       // configuration
            prixVente: 3500        // moyenne pondérée filtrée
        },
        'Veau': {
            qtéVendue: 12.50,      // depuis ventes filtrées  
            ratioVeau: -2.11,      // depuis details.O.Foire.Veau
            qtéAbattue: 12.77,     // calculé avec ratioVeau
            prixAchat: 3500,       // configuration
            prixVente: 4500        // moyenne pondérée filtrée
        }
    }
}
```

---

## 🎯 Cohérence du Système

Cette logique est **parfaitement cohérente** car :

1. **Adaptabilité** : Le système utilise les meilleures données disponibles selon le contexte
2. **Complémentarité** : Les deux modes se complètent pour couvrir tous les cas d'usage
3. **Précision** : Mode GLOBAL pour la vue d'ensemble, Mode SPÉCIFIQUE pour l'analyse détaillée
4. **Flexibilité** : Permet l'analyse à différents niveaux de granularité

### Principe Directeur
> **Mode GLOBAL** : "J'ai les données d'abattage → je calcule le ratio"
> 
> **Mode SPÉCIFIQUE** : "J'ai le ratio → je calcule la quantité abattue"

---

## 📚 Notes Techniques

- Les calculs sont effectués en temps réel à chaque analyse
- Les ratios négatifs indiquent des pertes (normal dans le secteur)
- La moyenne pondérée assure une représentation fidèle des prix
- Le filtrage par point de vente garantit la précision des analyses locales

---

*Document généré le $(date) - Analytics Version 1*
