# 🧪 Guide des Tests Analytics

## 🎯 Objectif

Les tests unitaires analytics ont été créés pour **prévenir les régressions** lors de futures modifications du code. Ils garantissent que les fonctionnalités critiques continuent de fonctionner correctement.

## ✅ Couverture Complète: 36 Tests

### 📊 Répartition des Tests

| Section | Nombre de Tests | Description |
|---------|-----------------|-------------|
| **Date Helpers** | 7 tests | Gestion et normalisation des formats de date |
| **Premier Jour du Mois** | 3 tests | Logique spéciale pour éviter les périodes invalides |
| **Retry Logic** | 5 tests | Système de retry pour récupération des prix d'achat |
| **Totaux avec/sans Stock** | 4 tests | Calculs des totaux incluant/excluant Stock Soir |
| **Ratios & Marges** | 8 tests | Calculs mathématiques et cohérence bidirectionnelle |
| **Edge Cases** | 6 tests | Gestion des cas limites et valeurs invalides |
| **Structure API** | 3 tests | Validation de la structure de réponse |

## 🚀 Commandes Rapides

### Lancer tous les tests analytics
```bash
npm run test:analytics
```

### Lancer en mode watch (re-run automatique)
```bash
npm run test:analytics:watch
```

### Lancer avec couverture de code
```bash
npm test -- --coverage tests/analytics.test.js
```

### Nettoyer le cache Jest (si problème)
```bash
npx jest --clearCache
```

## 📋 Résultats Attendus

```
PASS tests/analytics.test.js
  Analytics API - Tests Unitaires
    Date Helper Functions
      ✓ normalizeDate - format DD/MM/YYYY reste inchangé
      ✓ normalizeDate - YYYY-MM-DD vers DD/MM/YYYY
      ✓ normalizeDate - DD-MM-YYYY vers DD/MM/YYYY
      ✓ isFirstDayOfMonth - retourne true pour le 1er
      ✓ isFirstDayOfMonth - retourne false pour autres jours
      ✓ decrementDate - recule d'un jour correctement
      ✓ decrementDate - gère le changement de mois
    Default Date Logic - Premier Jour du Mois
      ✓ Premier jour du mois SANS arguments → startDate = endDate = aujourd'hui
      ✓ 15e jour du mois SANS arguments → startDate = 1er, endDate = hier
      ✓ Premier jour AVEC arguments → utilise les arguments
    Retry Logic - fetchAchatsBoeufWithRetry
      ✓ Simulation: Données trouvées au 1er essai
      ✓ Simulation: Données trouvées après 6 tentatives
      ✓ Simulation: Aucune donnée après 30 tentatives
      ✓ Debug info - Commentaire pour retry réussi
      ✓ Debug info - Commentaire pour 1ère tentative réussie
    Calculs - Totaux avec et sans Stock Soir
      ✓ Calcul totalChiffreAffaires AVEC Stock Soir
      ✓ Calcul totalChiffreAffairesSansStockSoir
      ✓ Cohérence: Total AVEC = Total SANS + Stock Soir
      ✓ Totaux généraux - Accumulation de plusieurs points
    Calculs - Ratios et Marges
      ✓ Mode GLOBAL - Calcul du ratio
      ✓ Mode SPÉCIFIQUE - Calcul quantité abattue depuis ratio
      ✓ Cohérence mathématique - Ratio bidirectionnel
      ✓ Calcul de la marge
      ✓ Calcul prix moyen de vente pondéré
      ✓ Ratio négatif indique des pertes
      ✓ Ratio positif serait impossible (ventes > abattage)
    Edge Cases et Validations
      ✓ Division par zéro - qtéAbattue = 0
      ✓ Valeurs négatives - Retours/ajustements
      ✓ Valeurs nulles - Produit non vendu
      ✓ Grandes valeurs - Totaux sur plusieurs points
      ✓ Précision des arrondis - Math.round
      ✓ Format de date invalide - Gestion null
    Structure de Réponse API
      ✓ Réponse doit contenir tous les champs obligatoires
      ✓ Totaux doit avoir 6 champs (3 avec Stock + 3 sans Stock)
      ✓ Debug info doit avoir tous les champs requis

Test Suites: 1 passed, 1 total
Tests:       36 passed, 36 total
Time:        ~3 seconds
```

## 🛡️ Quand Lancer les Tests?

### ✅ TOUJOURS lancer les tests avant:
1. **Commit de code** touchant les analytics
2. **Pull Request** vers la branche main
3. **Déploiement en production**
4. **Modification des calculs** de marges/ratios
5. **Ajout de nouvelles fonctionnalités** analytics

### 🔍 Lancer les tests après:
1. **Mise à jour de dépendances** (npm update)
2. **Modification de la structure** de réponse API
3. **Changement de logique métier** (calculs, dates, etc.)

## 🚨 Si un Test Échoue

### ❌ NE PAS:
- Désactiver le test
- Commenter le test
- Ignorer l'échec

### ✅ À FAIRE:
1. **Lire attentivement** le message d'erreur
2. **Comprendre pourquoi** le test échoue
3. **Vérifier si** c'est une régression ou un test obsolète
4. **Corriger le code** ou mettre à jour le test si nécessaire
5. **Relancer tous les tests** pour s'assurer de la non-régression

### Exemple de Débogage

```bash
# 1. Lancer le test qui échoue en mode verbose
npm run test:analytics

# 2. Si besoin, nettoyer le cache
npx jest --clearCache

# 3. Relancer avec plus de détails
npx jest tests/analytics.test.js --verbose --no-cache

# 4. Après correction, relancer tous les tests
npm test
```

## 📝 Ajouter de Nouveaux Tests

Quand vous ajoutez une nouvelle fonctionnalité analytics, **ajoutez aussi un test**:

```javascript
test('Description de la nouvelle fonctionnalité', () => {
    // Arrange - Préparer les données
    const input = { ... };
    
    // Act - Exécuter la fonction
    const result = calculerNouvelleFonctionnalité(input);
    
    // Assert - Vérifier le résultat
    expect(result).toBe(expectedValue);
});
```

### Structure du Fichier de Test

Le fichier `tests/analytics.test.js` est organisé en **7 sections**:

1. **Date Helper Functions** - Gestion des dates
2. **Default Date Logic** - Règle du 1er jour du mois
3. **Retry Logic** - Système de retry
4. **Calculs de Totaux** - Avec/sans Stock Soir
5. **Ratios et Marges** - Calculs mathématiques
6. **Edge Cases** - Cas limites
7. **Structure API** - Validation de réponse

### Bonnes Pratiques

- ✅ **Noms descriptifs** : `test('Le calcul de X produit Y quand Z')`
- ✅ **Tests atomiques** : Un test = une fonctionnalité
- ✅ **Données réalistes** : Utiliser des valeurs proches de la production
- ✅ **Isolation** : Chaque test doit être indépendant
- ✅ **Assertions claires** : `expect(result).toBe(expected)`

## 🔧 Maintenance

### Mise à Jour Régulière

Les tests doivent évoluer avec le code:

1. **Nouvelle fonctionnalité** → Ajouter des tests
2. **Bug corrigé** → Ajouter un test de non-régression
3. **Changement de logique** → Mettre à jour les tests existants
4. **Deprecated feature** → Supprimer les tests obsolètes

### Vérification de Couverture

```bash
# Générer un rapport de couverture
npm test -- --coverage tests/analytics.test.js

# Ouvrir le rapport HTML
open coverage/lcov-report/index.html
```

## 📚 Documentation Associée

- **`tests/analytics.test.js`** - Fichier de tests (36 tests)
- **`tests/README_ANALYTICS_TESTS.md`** - Documentation technique détaillée
- **`ANALYTICS_V1_DOCUMENTATION.md`** - Documentation fonctionnelle complète
- **`server.js`** - Implémentation des endpoints analytics
- **`jest.config.js`** - Configuration Jest

## 🎓 Ressources

### Jest Documentation
- [Getting Started](https://jestjs.io/docs/getting-started)
- [Expect API](https://jestjs.io/docs/expect)
- [Best Practices](https://jestjs.io/docs/testing-best-practices)

### Tests Patterns
- **AAA Pattern** (Arrange-Act-Assert)
- **Test Isolation** (Chaque test indépendant)
- **Mocking** (Pour les dépendances externes)

## ✨ Avantages des Tests

1. **🛡️ Prévention des Régressions** - Détecte les bugs avant la prod
2. **📝 Documentation Vivante** - Les tests montrent comment le code fonctionne
3. **🚀 Refactoring Sécurisé** - Permet de modifier le code en confiance
4. **⚡ Feedback Rapide** - Tests en ~3 secondes
5. **🎯 Couverture Complète** - 36 tests couvrent les scénarios critiques

## 🎯 Objectif Final

**Maintenir une suite de tests robuste qui garantit la stabilité des analytics tout en permettant l'évolution du code en toute confiance.**

---

*Guide créé le 2025-10-03 - Version 1.0*

**💡 Questions?** Consultez `tests/README_ANALYTICS_TESTS.md` pour plus de détails techniques.

