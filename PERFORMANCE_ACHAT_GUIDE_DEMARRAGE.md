# 🚀 Guide de Démarrage - Module Performance Achat

## ✅ Étapes d'Installation

### 1. Exécuter la Migration de la Base de Données

**Option A : Via Node.js directement**
```bash
node migrations/20250111_create_performance_achat_table.js
```

**Option B : Via votre système de migration existant**
Si vous avez un système de migration automatique, il détectera et exécutera automatiquement le nouveau fichier.

**Vérification :**
```sql
-- Dans PostgreSQL
\dt performance_achat
SELECT * FROM performance_achat LIMIT 1;
```

---

### 2. Vérifier le Fichier `acheteur.json`

Le fichier `acheteur.json` doit être à la racine du projet :

```bash
cat acheteur.json
```

**Contenu par défaut :**
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
  },
  {
    "id": "ACH003",
    "nom": "Sow",
    "prenom": "Abdoulaye",
    "actif": true
  },
  {
    "id": "ACH004",
    "nom": "Ba",
    "prenom": "Thierno",
    "actif": false
  }
]
```

**💡 Personnalisation :**
- Modifiez les noms selon vos vrais acheteurs
- Ajoutez autant d'acheteurs que nécessaire
- Utilisez `"actif": false` pour désactiver un acheteur sans le supprimer

---

### 3. Redémarrer le Serveur

```bash
# Arrêter le serveur (Ctrl+C)
# Redémarrer
npm start
```

---

## 🧪 Tests à Effectuer

### Test 1 : Accès au Module

1. Connectez-vous à l'application
2. Naviguez vers **Suivi Achat Boeuf**
3. Cliquez sur le bouton vert **"Performance Achat"** en haut à droite
4. ✅ **Résultat attendu :** Une nouvelle page s'ouvre avec le module Performance Achat

---

### Test 2 : Création d'une Entrée Simple

1. Dans le formulaire de gauche :
   - **Date :** Sélectionnez aujourd'hui (2025-01-11)
   - **Acheteur :** Sélectionnez "Mamadou Diallo"
   - **Type :** Sélectionnez "boeuf"
   - **Poids Estimé :** 155
   - **Poids Réel :** Laissez vide pour l'instant
2. Cliquez sur **Enregistrer**
3. ✅ **Résultat attendu :** Message "Performance créée avec succès"
4. ✅ **Vérification :** L'entrée apparaît dans le tableau avec un tiret (-) pour Performance

---

### Test 3 : Compléter avec Poids Réel

1. Cliquez sur le bouton **Modifier** (icône crayon) de l'entrée créée
2. Le formulaire se remplit automatiquement
3. Ajoutez **Poids Réel :** 150
4. Cliquez sur **Mettre à jour**
5. ✅ **Résultat attendu :**
   - Écart : +5.00 kg
   - Performance : +3.33% (en jaune)
   - Type : Badge "Surestimation"

---

### Test 4 : Vérification de Cohérence

**Prérequis :** Avoir des données dans le module Suivi Achat pour la date 2025-01-11

1. Dans **Suivi Achat Boeuf**, ajoutez quelques entrées pour aujourd'hui :
   - Date : 2025-01-11
   - Bête : boeuf
   - Nbr kg : 75 kg (1ère entrée)
   - Nbr kg : 75 kg (2ème entrée)
   - **Total :** 150 kg

2. Retournez dans **Performance Achat**
3. Créez une nouvelle entrée :
   - Date : 2025-01-11
   - Acheteur : Cheikh Ndiaye
   - Type : boeuf
   - Poids Estimé : 152
   - Poids Réel : 150

4. ✅ **Résultat attendu :**
   - Cohérence : Badge **VERT** "COHÉRENT"
   - Au survol : "Somme achats: 150 kg | Différence: 0 kg"

5. **Test négatif :** Créez une entrée avec Poids Réel = 160
   - ✅ Cohérence : Badge **ROUGE** "INCOHÉRENT"

---

### Test 5 : Classement des Acheteurs

1. Créez plusieurs entrées pour différents acheteurs :
   
   **Mamadou Diallo :**
   - Date : 2025-01-10 | Estimé : 155 | Réel : 150 (surestimation)
   - Date : 2025-01-11 | Estimé : 140 | Réel : 145 (sous-estimation)
   
   **Cheikh Ndiaye :**
   - Date : 2025-01-10 | Estimé : 130 | Réel : 128 (surestimation)
   - Date : 2025-01-11 | Estimé : 150 | Réel : 150 (parfait)

2. Regardez la section **Classement des Acheteurs** (en bas à droite)

3. ✅ **Résultat attendu :**
   - Cheikh Ndiaye en tête (meilleur score)
   - Position #1 en OR
   - Statistiques : X estimations | Y sur | Z sous

---

### Test 6 : Contrôle 24h (Admin uniquement)

**⚠️ Ce test nécessite un compte Admin et de manipuler les timestamps**

1. Créez une entrée avec Poids Estimé = 155
2. Dans la base de données, modifiez manuellement le timestamp :
   ```sql
   UPDATE performance_achat 
   SET poids_estime_timestamp = NOW() - INTERVAL '25 hours'
   WHERE id = 1;
   ```
3. Essayez de modifier le Poids Estimé depuis l'interface (avec un compte non-admin)
4. ✅ **Résultat attendu :** Message d'erreur "Impossible de modifier le poids estimé après 24h"
5. Connectez-vous avec un compte Admin
6. ✅ **Résultat attendu :** La modification fonctionne

---

### Test 7 : Filtres

1. Créez plusieurs entrées sur différentes dates et pour différents acheteurs
2. Utilisez les filtres en haut :
   - **Date de début :** 2025-01-01
   - **Date de fin :** 2025-01-15
   - **Acheteur :** Mamadou Diallo
   - **Type :** boeuf
3. Cliquez sur **Filtrer**
4. ✅ **Résultat attendu :** Seules les entrées correspondantes s'affichent

---

### Test 8 : Export Excel

1. Créez plusieurs entrées de test
2. Cliquez sur **Export Excel** (bouton vert en haut du tableau)
3. ✅ **Résultat attendu :**
   - Fichier `performance_achat_2025-01-11.xlsx` téléchargé
   - Contient toutes les colonnes avec les données
   - Formatage correct

---

### Test 9 : Modal de Détails

1. Cliquez sur n'importe quelle ligne du tableau (pas sur les boutons)
2. ✅ **Résultat attendu :**
   - Modal s'ouvre avec tous les détails
   - 4 sections : Informations | Poids | Performance | Cohérence
   - Timestamps visibles
   - Commentaire affiché si présent

---

### Test 10 : Suppression

1. Créez une entrée de test
2. Cliquez sur le bouton **Supprimer** (icône poubelle rouge)
3. Confirmez la suppression
4. ✅ **Résultat attendu :**
   - Message "Performance supprimée avec succès"
   - L'entrée disparaît du tableau
   - Le classement se met à jour

---

## 🔍 Vérifications Techniques

### Vérifier les Logs Serveur
```bash
# Les logs doivent afficher :
GET /api/acheteurs - 200 OK
GET /api/performance-achat - 200 OK
POST /api/performance-achat - 201 Created
```

### Vérifier la Base de Données
```sql
-- Voir toutes les entrées
SELECT * FROM performance_achat ORDER BY date DESC;

-- Vérifier les index
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'performance_achat';

-- Compter les entrées
SELECT COUNT(*) FROM performance_achat;
```

### Vérifier les Permissions
```sql
-- Vérifier que la table existe
\dt performance_achat

-- Vérifier les colonnes
\d performance_achat
```

---

## 🐛 Résolution de Problèmes

### Problème : "Module PerformanceAchat not found"
**Solution :**
```bash
# Vérifier que le modèle est bien exporté
cat db/models/index.js | grep PerformanceAchat

# Redémarrer le serveur
npm start
```

---

### Problème : "Acheteur non trouvé"
**Solution :**
```bash
# Vérifier le fichier acheteur.json
cat acheteur.json

# Vérifier qu'il est bien à la racine du projet
ls -la acheteur.json
```

---

### Problème : "Failed to fetch performance data"
**Solution :**
```bash
# Vérifier que la table existe
psql -U votre_user -d votre_db -c "\dt performance_achat"

# Exécuter la migration si nécessaire
node migrations/20250111_create_performance_achat_table.js
```

---

### Problème : Cohérence toujours "INCOHÉRENT"
**Solution :**
1. Vérifier que les données dans Suivi Achat utilisent le même format de date (YYYY-MM-DD)
2. Vérifier que le type de bête est bien en minuscules ('boeuf' ou 'veau')
3. Exécuter cette requête pour diagnostiquer :
```sql
SELECT date, bete, SUM(nbr_kg) as total_kg
FROM achats_boeuf
WHERE date = '2025-01-11' AND bete = 'boeuf'
GROUP BY date, bete;
```

---

## 📞 Support

En cas de problème :
1. Consultez `PERFORMANCE_ACHAT_DOCUMENTATION.md` pour la documentation technique complète
2. Vérifiez les logs serveur pour les erreurs
3. Utilisez la console développeur du navigateur (F12) pour les erreurs JavaScript

---

## ✨ Fonctionnalités Avancées à Tester

### Verrouillage d'Entrée (Admin uniquement)
```sql
-- Verrouiller une entrée
UPDATE performance_achat SET locked = true WHERE id = 1;

-- Essayer de la modifier → Erreur attendue pour non-admin
```

### Commentaires Longs
Ajoutez un commentaire de plusieurs lignes pour vérifier l'affichage dans le modal.

### Performance Parfaite
Créez une entrée avec Poids Estimé = Poids Réel pour voir le badge "Parfait" vert.

---

## 🎯 Checklist Finale

- [ ] Migration exécutée avec succès
- [ ] Fichier `acheteur.json` configuré
- [ ] Bouton "Performance Achat" visible dans Suivi Achat
- [ ] Création d'entrées fonctionne
- [ ] Modification d'entrées fonctionne
- [ ] Suppression d'entrées fonctionne
- [ ] Calculs automatiques corrects (écart, performance, cohérence)
- [ ] Classement des acheteurs affiché correctement
- [ ] Filtres fonctionnent
- [ ] Export Excel fonctionne
- [ ] Modal de détails s'affiche correctement
- [ ] Contrôle 24h opérationnel (test avec Admin)
- [ ] Timestamps affichés au survol

---

**🎉 Une fois tous les tests passés, le module est prêt pour la production !**

---

*Guide de démarrage - Module Performance Achat v1.0 - 2025-01-11*

