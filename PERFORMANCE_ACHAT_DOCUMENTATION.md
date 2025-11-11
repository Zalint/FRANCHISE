# 📊 Module Performance Achat - Documentation Technique

## Vue d'ensemble

Le module **Performance Achat** permet de mesurer et d'auditer la performance des acheteurs de bétail (boeuf/veau) en comparant leurs estimations de poids avec les poids réels après abattage.

**Date de création :** 2025-01-11

---

## 🎯 Objectifs

1. **Mesurer la précision** des estimations des acheteurs
2. **Détecter les fraudes** grâce aux timestamps et contrôles
3. **Vérifier la cohérence** avec les données du module Suivi Achat
4. **Classer les acheteurs** selon leur performance (surestimation pénalisée x2)

---

## 📁 Structure des Fichiers

### Base de données
- `db/models/PerformanceAchat.js` - Modèle Sequelize
- `migrations/20250111_create_performance_achat_table.js` - Migration de la table

### Backend
- `server.js` (lignes 4319-4719) - Routes API

### Frontend
- `public/performanceAchat.html` - Interface utilisateur
- `public/js/performanceAchat.js` - Logique côté client

### Configuration
- `acheteur.json` - Liste des acheteurs

---

## 🗄️ Schéma de Base de Données

### Table: `performance_achat`

```sql
CREATE TABLE performance_achat (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,                     -- Format YYYY-MM-DD
  id_acheteur VARCHAR(50) NOT NULL,       -- Référence à acheteur.json
  bete VARCHAR(20) NOT NULL,              -- 'boeuf' ou 'veau'
  
  -- Estimation
  poids_estime FLOAT,                     -- Poids estimé (kg)
  poids_estime_timestamp TIMESTAMP,       -- Dernière modification
  poids_estime_updated_by VARCHAR(100),   -- Utilisateur
  
  -- Réalité
  poids_reel FLOAT,                       -- Poids réel (kg)
  poids_reel_timestamp TIMESTAMP,         -- Dernière modification
  poids_reel_updated_by VARCHAR(100),     -- Utilisateur
  
  -- Métadonnées
  locked BOOLEAN DEFAULT FALSE,           -- Verrouillage
  commentaire TEXT,                       -- Notes
  created_by VARCHAR(100),                -- Créateur
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Index
- `idx_performance_achat_date_bete` sur `(date, bete)`
- `idx_performance_achat_acheteur` sur `id_acheteur`
- `idx_performance_achat_date` sur `date`

---

## 🔐 Règles de Sécurité

### 1. **Modification du Poids Estimé**
- **< 24h** : Acheteur peut modifier librement
- **> 24h** : Seul l'Admin peut modifier
- **Message d'erreur** : "Impossible de modifier le poids estimé après 24h. Contactez un administrateur."

### 2. **Entrées Verrouillées**
- Si `locked = true`, seul l'Admin peut modifier/supprimer
- **Message d'erreur** : "Entrée verrouillée. Seul un administrateur peut la modifier."

### 3. **Validation Acheteur**
- L'ID acheteur doit exister dans `acheteur.json`
- Seuls les acheteurs actifs (`actif: true`) sont proposés

---

## 📐 Formules de Calcul

### 1. Écart (kg)
```javascript
ecart = poids_estime - poids_reel
```

### 2. Performance (%)
```javascript
performance = ((poids_estime - poids_reel) / poids_reel) × 100
```

**Interprétation :**
- `performance > 0` → **Surestimation**
- `performance < 0` → **Sous-estimation**
- `performance = 0` → **Parfait** ✓

### 3. Score Pénalisé (pour classement)
```javascript
if (performance > 0) {
  score_penalite = Math.abs(performance) × 2  // Surestimation pénalisée x2
} else {
  score_penalite = Math.abs(performance)      // Sous-estimation normale
}
```

**Note :** Plus le score est bas, meilleur est l'acheteur.

### 4. Cohérence avec Suivi Achat
```javascript
somme_achats_kg = SUM(achats_boeuf.nbr_kg WHERE date = X AND bete = Y)
difference = Math.abs(poids_reel - somme_achats_kg)

if (difference <= 0.5 kg) {
  coherence = 'COHÉRENT' (badge vert 🟢)
} else {
  coherence = 'INCOHÉRENT' (badge rouge 🔴)
}
```

---

## 🔌 API Endpoints

### 1. GET `/api/acheteurs`
Récupère la liste des acheteurs actifs depuis `acheteur.json`

**Réponse :**
```json
{
  "success": true,
  "acheteurs": [
    { "id": "ACH001", "nom": "Diallo", "prenom": "Mamadou", "actif": true }
  ]
}
```

---

### 2. GET `/api/performance-achat`
Récupère les performances avec filtres optionnels

**Paramètres de requête :**
- `startDate` (YYYY-MM-DD)
- `endDate` (YYYY-MM-DD)
- `idAcheteur` (ex: ACH001)
- `bete` (boeuf/veau)

**Réponse enrichie :**
```json
{
  "success": true,
  "performances": [
    {
      "id": 1,
      "date": "2025-01-11",
      "id_acheteur": "ACH001",
      "acheteur_nom": "Mamadou Diallo",
      "bete": "boeuf",
      "poids_estime": 155,
      "poids_reel": 150,
      "ecart": 5,
      "performance": 3.33,
      "type_estimation": "Surestimation",
      "score_penalite": 6.66,
      "coherence": "COHÉRENT",
      "somme_achats_kg": 150,
      "coherence_difference": 0,
      ...
    }
  ]
}
```

---

### 3. POST `/api/performance-achat`
Crée une nouvelle entrée

**Body :**
```json
{
  "date": "2025-01-11",
  "id_acheteur": "ACH001",
  "bete": "boeuf",
  "poids_estime": 155,
  "poids_reel": 150,
  "commentaire": "Estimation initiale"
}
```

---

### 4. PUT `/api/performance-achat/:id`
Met à jour une entrée existante

**Contrôles :**
- Règle des 24h pour `poids_estime`
- Vérification du verrouillage
- Mise à jour automatique des timestamps

---

### 5. DELETE `/api/performance-achat/:id`
Supprime une entrée (si non verrouillée ou Admin)

---

### 6. GET `/api/performance-achat/stats`
Récupère le classement des acheteurs

**Réponse :**
```json
{
  "success": true,
  "rankings": [
    {
      "id_acheteur": "ACH001",
      "nom": "Mamadou Diallo",
      "total_estimations": 25,
      "total_surestimations": 5,
      "total_sous_estimations": 18,
      "total_parfait": 2,
      "score_moyen": 2.45
    }
  ],
  "total_performances": 25
}
```

**Tri :** Par `score_moyen` croissant (meilleur = plus bas)

---

## 🖥️ Interface Utilisateur

### Sections principales

1. **Filtres**
   - Date de début / Date de fin (Flatpickr, format YYYY-MM-DD)
   - Acheteur (dropdown)
   - Type de bête (boeuf/veau)

2. **Formulaire de saisie**
   - Date (obligatoire)
   - Acheteur (obligatoire)
   - Type (obligatoire)
   - Poids Estimé (optionnel)
   - Poids Réel (optionnel)
   - Commentaire (optionnel)
   - Affichage des timestamps au survol

3. **Tableau des performances**
   - Colonnes : Date | Acheteur | Type | P. Estimé | P. Réel | Écart | Performance | Type | Cohérence | Actions
   - Badges colorés selon performance :
     - **Vert** : ≤ 2%
     - **Jaune** : 2-5%
     - **Rouge** : > 5%
   - Bouton Export Excel

4. **Classement des acheteurs**
   - Card avec dégradé violet
   - Top 3 avec couleurs spéciales :
     - 🥇 Or (1er)
     - 🥈 Argent (2e)
     - 🥉 Bronze (3e)
   - Score moyen + statistiques détaillées

5. **Modal de détails**
   - Informations complètes sur une performance
   - Historique des modifications
   - Données de cohérence

---

## 📦 Fichier `acheteur.json`

```json
[
  {
    "id": "ACH001",
    "nom": "Diallo",
    "prenom": "Mamadou",
    "actif": true
  },
  {
    "id": "ACH002",
    "nom": "Ndiaye",
    "prenom": "Cheikh",
    "actif": true
  }
]
```

**Structure :**
- `id` : Identifiant unique (ex: ACH001)
- `nom` : Nom de famille
- `prenom` : Prénom
- `actif` : Boolean (seuls les actifs sont affichés)

---

## 🚀 Installation & Déploiement

### 1. Exécuter la migration
```bash
# Depuis le répertoire racine
node migrations/20250111_create_performance_achat_table.js
```

### 2. Vérifier le fichier acheteur.json
```bash
cat acheteur.json
```

### 3. Redémarrer le serveur
```bash
npm start
```

### 4. Accéder au module
- Via menu : **Suivi Achat** → Bouton "Performance Achat"
- Direct : `http://localhost:PORT/performanceAchat.html`

---

## 🔍 Vérification de Cohérence

### Principe
Le module vérifie que le **Poids Réel** saisi correspond à la **somme des Nbr kg** dans le module Suivi Achat pour la même date et le même type de bête.

### Calcul
```sql
SELECT SUM(nbr_kg) 
FROM achats_boeuf 
WHERE date = '2025-01-11' AND bete = 'boeuf'
```

### Tolérance
- **±0.5 kg** → Cohérent ✅
- **> 0.5 kg** → Incohérent ❌

### Utilité
- Détecte les erreurs de saisie
- Identifie les tentatives de fraude
- Assure la cohérence des données

---

## 📊 Export Excel

### Colonnes exportées
1. Date
2. Acheteur
3. Type (Boeuf/Veau)
4. Poids Estimé (kg)
5. Poids Réel (kg)
6. Écart (kg)
7. Performance (%)
8. Type Estimation
9. Cohérence
10. Somme Achats (kg)
11. Commentaire

### Format de fichier
`performance_achat_YYYY-MM-DD.xlsx`

---

## ⚙️ Configuration Technique

### Dépendances JavaScript
- **Flatpickr** : Sélection de dates
- **Bootstrap 4** : Interface utilisateur
- **Font Awesome** : Icônes
- **XLSX** : Export Excel

### Gestion des dates
- **Format base de données** : `YYYY-MM-DD` (DATEONLY)
- **Format affichage** : `YYYY-MM-DD` (conforme à la règle utilisateur)
- **Timestamps** : `TIMESTAMP WITH TIME ZONE`

---

## 🎨 Code Couleur des Performances

### Badges Performance
- 🟢 **Vert** : Excellent (≤ 2%)
- 🟡 **Jaune** : Acceptable (2-5%)
- 🔴 **Rouge** : Mauvais (> 5%)

### Badges Type d'Estimation
- 🟡 **Jaune** : Surestimation
- 🔵 **Bleu** : Sous-estimation
- 🟢 **Vert** : Parfait

### Badges Cohérence
- 🟢 **Vert** : COHÉRENT
- 🔴 **Rouge** : INCOHÉRENT

---

## 🐛 Gestion des Erreurs

### Messages côté client
- "Impossible de modifier le poids estimé après 24h"
- "Entrée verrouillée. Seul un administrateur peut la modifier"
- "Acheteur non trouvé"
- "Champs requis manquants (date, id_acheteur, bete)"

### Logs serveur
Tous les appels API sont loggés avec :
- Timestamp
- Utilisateur
- Action
- Résultat

---

## 📝 Changelog

### Version 1.0 - 2025-01-11
- ✅ Création du module Performance Achat
- ✅ Implémentation des contrôles de sécurité (24h, Admin)
- ✅ Calcul automatique des métriques et cohérence
- ✅ Système de classement avec pénalité surestimation x2
- ✅ Interface complète avec filtres, graphiques et export Excel
- ✅ Intégration avec le module Suivi Achat

---

## 🔮 Évolutions Futures

- [ ] Graphiques d'évolution temporelle de performance par acheteur
- [ ] Notifications automatiques pour incohérences
- [ ] Export PDF du classement
- [ ] Historique des modifications (table audit)
- [ ] Dashboard analytique avancé
- [ ] Prédiction de performance basée sur ML

---

*Document généré le 2025-01-11 - Module Performance Achat v1.0*

