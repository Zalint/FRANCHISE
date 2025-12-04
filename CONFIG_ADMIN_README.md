# 📋 Configuration Centralisée - Guide de Migration

Ce document explique comment migrer les fichiers de configuration (utilisateurs, produits, points de vente) vers la base de données PostgreSQL.

## 🎯 Objectif

Remplacer les fichiers statiques suivants par des tables en base de données :

| Fichier | Nouvelle Table |
|---------|----------------|
| `users.json` | `users` + `user_points_vente` |
| `points-vente.js` | `points_vente` |
| `produits.js` | `produits` + `prix_point_vente` |
| `produitsAbonnement.js` | `produits` (type: abonnement) |
| `produitsInventaire.js` | `produits` (type: inventaire) |
| `paymentRefMapping.js` | Fusionné dans `points_vente` |

## 📊 Nouvelles Tables

### 1. `users` - Utilisateurs
```sql
- id (PK)
- username (UNIQUE)
- password (hash bcrypt)
- role (admin, superutilisateur, superviseur, user)
- acces_tous_points (BOOLEAN)
- active (BOOLEAN)
- created_at, updated_at
```

### 2. `points_vente` - Points de Vente
```sql
- id (PK)
- nom (UNIQUE)
- active (BOOLEAN)
- created_at, updated_at
```

### 3. `user_points_vente` - Association Users/Points de Vente
```sql
- id (PK)
- user_id (FK -> users)
- point_vente_id (FK -> points_vente)
```

### 4. `categories` - Catégories de Produits
```sql
- id (PK)
- nom (UNIQUE)
- ordre (pour l'affichage)
- created_at, updated_at
```

### 5. `produits` - Catalogue de Produits
```sql
- id (PK)
- nom
- categorie_id (FK -> categories, nullable)
- type_catalogue (vente, abonnement, inventaire)
- prix_defaut (DECIMAL)
- prix_alternatifs (ARRAY)
- created_at, updated_at
```

### 6. `prix_point_vente` - Prix Spécifiques
```sql
- id (PK)
- produit_id (FK -> produits)
- point_vente_id (FK -> points_vente)
- prix (DECIMAL)
- created_at, updated_at
```

### 7. `prix_historique` - Historique des Prix
```sql
- id (PK)
- produit_id (FK -> produits)
- point_vente_id (FK, nullable)
- ancien_prix (nullable si création)
- nouveau_prix
- type_modification (creation, modification, suppression)
- modifie_par (username)
- commentaire
- created_at
```

## 🚀 Guide de Migration

### Étape 1 : Vérifier la connexion à la base

```bash
npm run db:view
```

### Étape 2 : Exécuter la migration

```bash
# Mode normal (préserve les données existantes)
npm run db:migrate-config

# Mode force (recrée les tables - ATTENTION: perte de données!)
npm run db:migrate-config:force
```

### Étape 3 : Vérifier les données migrées

Accéder à l'interface d'administration : `http://localhost:3000/config-admin.html`

## 🔧 Utilisation dans le Code

### Service de Configuration

Le service `db/config-service.js` fournit une interface compatible avec les anciens fichiers :

```javascript
const configService = require('./db/config-service');

// Récupérer les produits au format legacy (compatible avec l'ancien code)
const produits = await configService.getProduitsAsLegacy('vente');
const produitsAbo = await configService.getProduitsAsLegacy('abonnement');
const produitsInv = await configService.getProduitsAsLegacy('inventaire');

// Récupérer les points de vente
const pointsVente = await configService.getPointsVenteAsLegacy();

// Récupérer les utilisateurs
const users = await configService.getUsersAsLegacy();

// Récupérer un utilisateur par username
const user = await configService.getUserByUsername('ADMIN');

// Vérifier l'accès d'un utilisateur à un point de vente
const hasAccess = await configService.userHasAccessToPointVente(userId, 'Keur Bali');

// Obtenir le prix d'un produit
const prix = await configService.getPrixProduit('Boeuf en détail', 'vente', 'Sacre Coeur');

// Mettre à jour un prix (enregistré dans l'historique)
await configService.updatePrixProduit(produitId, 4000, pointVenteId, 'ADMIN');
```

### Accès Direct aux Modèles

Pour des cas avancés, vous pouvez accéder directement aux modèles Sequelize :

```javascript
const { User, PointVente, Produit, PrixHistorique } = require('./db/models');

// Requêtes Sequelize standard
const users = await User.findAll({ where: { active: true } });
```

## 🖥️ Interface d'Administration

Accès : `/config-admin.html` (réservé aux administrateurs)

### Fonctionnalités

1. **Gestion des Utilisateurs**
   - Créer/Modifier/Supprimer des utilisateurs
   - Attribuer des rôles (admin, superutilisateur, superviseur, user)
   - Définir les accès aux points de vente
   - Activer/Désactiver des comptes

2. **Gestion des Points de Vente**
   - Créer/Modifier/Supprimer des points de vente
   - Activer/Désactiver

3. **Gestion des Produits**
   - Vue séparée par catalogue (Vente, Abonnement, Inventaire)
   - Modifier les prix par défaut
   - Définir des prix alternatifs
   - Prix spécifiques par point de vente

4. **Historique des Prix**
   - Suivi de toutes les modifications de prix
   - Date, utilisateur, ancien/nouveau prix

## 📡 API REST

### Points de Vente

```
GET    /api/admin/config/points-vente         # Liste tous
POST   /api/admin/config/points-vente         # Créer
PUT    /api/admin/config/points-vente/:id     # Modifier
DELETE /api/admin/config/points-vente/:id     # Supprimer
```

### Utilisateurs

```
GET    /api/admin/config/users                # Liste tous
POST   /api/admin/config/users                # Créer
PUT    /api/admin/config/users/:id            # Modifier
DELETE /api/admin/config/users/:id            # Supprimer
```

### Catégories

```
GET    /api/admin/config/categories           # Liste toutes
POST   /api/admin/config/categories           # Créer
PUT    /api/admin/config/categories/:id       # Modifier
```

### Produits

```
GET    /api/admin/config/produits                      # Liste tous (filtre: type_catalogue, categorie_id)
GET    /api/admin/config/produits/:id                  # Détail + historique
POST   /api/admin/config/produits                      # Créer
PUT    /api/admin/config/produits/:id                  # Modifier
DELETE /api/admin/config/produits/:id                  # Supprimer
POST   /api/admin/config/produits/:id/prix             # Ajouter prix point de vente
DELETE /api/admin/config/produits/:id/prix/:pvId       # Supprimer prix point de vente
```

### Historique

```
GET    /api/admin/config/historique           # Historique global (params: limit, offset, startDate, endDate)
```

## 🔄 Compatibilité avec l'Ancien Code

Le système est conçu pour une transition progressive :

1. **Les anciens fichiers restent fonctionnels** - Ils ne sont pas supprimés
2. **Le service de configuration** retourne les données au même format que les anciens fichiers
3. **Invalidation du cache** automatique lors des modifications via l'interface admin

### Période de Transition Recommandée

1. Exécuter la migration pour créer les tables et importer les données
2. Tester l'interface admin et les API
3. Progressivement remplacer les `require('./produits')` par `configService.getProduitsAsLegacy('vente')`
4. Une fois tout migré, archiver les anciens fichiers

## ⚠️ Notes Importantes

- **L'utilisateur ADMIN** est toujours créé automatiquement (mot de passe par défaut: `Mata@2024` si nouveau)
- **Le cache** a une durée de vie de 5 minutes. Utilisez `configService.invalidateCache()` pour forcer le rechargement
- **L'historique des prix** est conservé indéfiniment pour audit
- **Impossible de supprimer le dernier admin** - Protection contre le verrouillage

## 🐛 Dépannage

### La migration échoue

Vérifiez la connexion à la base de données :
```bash
npm run db:view
```

### Les produits n'apparaissent pas

Vérifiez que la migration a bien importé les données :
```bash
node -r dotenv/config -e "
  const models = require('./db/models');
  models.Produit.count().then(c => console.log('Produits:', c));
"
```

### L'interface admin affiche des erreurs

1. Vérifiez que vous êtes connecté en tant qu'admin
2. Vérifiez les logs du serveur pour plus de détails
3. Inspectez la console du navigateur

---

*Créé le 04/12/2024 - Migration Configuration → Base de Données*

