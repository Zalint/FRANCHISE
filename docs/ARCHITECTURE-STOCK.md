# Architecture de Gestion du Stock

## 📋 Système 100% JSON

### 🎯 Source de Vérité: **Fichiers JSON Uniquement**

Toute la gestion du stock se base exclusivement sur les fichiers JSON organisés par date.

## 📁 Structure des Données

### Fichiers JSON (Unique source de données)
```
APP/data/by-date/
  └── YYYY-MM-DD/
      ├── stock-matin.json    ← Stock du matin
      ├── stock-soir.json     ← Stock du soir (calculé automatiquement)
      └── transferts.json     ← Transferts entre points de vente
```

**Format:**
```json
{
  "Keur Bali-Ail": {
    "quantite": 10.5,
    "prixUnitaire": 552,
    "date": "11-12-2025",
    "mode": "automatique",
    "commentaire": "Stock initial"
  },
  "Keur Bali-Tomate": {
    "quantite": -2.5,
    "prixUnitaire": 1200,
    "date": "11-12-2025",
    "mode": "automatique",
    "commentaire": ""
  }
}
```

## 🔄 Flux de Données

### Lors d'une Vente (Import OCR ou Saisie)
```
Vente créée
    ↓
Stock Soir JSON mis à jour
    Stock Soir = Stock Matin - Total Ventes du jour
    ↓
✅ Fichier stock-soir.json sauvegardé
```

### Lors d'une Sauvegarde d'Inventaire
```
Utilisateur remplit le tableau Stock Inventaire
    ↓
Clique sur "Sauvegarder"
    ↓
Données sauvegardées dans stock-matin.json ou stock-soir.json
    ↓
✅ Fichier JSON mis à jour
```

## 📊 Lecture des Données

Toutes les pages lisent directement depuis les JSON:
- ✅ **Stock Inventaire** - Lit stock-matin.json et stock-soir.json
- ✅ **Réconciliation** - Lit JSON (stock matin, stock soir, ventes)
- ✅ **Rapports** - Lit les JSON de toutes les dates

## 🔧 Mode Manuel vs Automatique

### Mode Manuel
- L'utilisateur saisit manuellement stock matin ET stock soir
- Chaque saisie est indépendante

### Mode Automatique
- L'utilisateur saisit UNIQUEMENT le stock matin
- Stock Soir calculé automatiquement: `Stock Soir = Stock Matin - Ventes`
- Mis à jour en temps réel lors d'une vente

## 🎯 Règles Importantes

1. **JSON = Seule source de vérité**
2. **Pas de base de données** pour le stock (sauf table `ventes`)
3. **Fichiers par date** - Un dossier par jour
4. **Valeurs négatives possibles** - Indiquent un manque de stock
5. **Mode automatique** - Calcul en temps réel lors des ventes

## 🚀 Avantages

✅ **Simplicité maximale** - Pas de synchronisation BDD  
✅ **Performance** - Lecture/écriture de fichiers rapide  
✅ **Traçabilité** - Fichiers versionnables (Git)  
✅ **Backup facile** - Simple copie de fichiers  
✅ **Pas de migrations** - Structure JSON flexible  
✅ **Debugging simple** - Ouvrir le fichier JSON directement

## 📝 Opérations

| Opération | Fichier Lu | Fichier Écrit |
|-----------|------------|---------------|
| Saisie Vente | - | stock-soir.json (si auto) |
| Import OCR | - | stock-soir.json (si auto) |
| Sauvegarde Stock Matin | - | stock-matin.json |
| Sauvegarde Stock Soir | - | stock-soir.json |
| Réconciliation | stock-*.json + ventes | - |
| Rapports | stock-*.json | - |

## 🔍 Exemple de Calcul Automatique

**Situation initiale (11/12/2025):**
```json
// stock-matin.json
{
  "Keur Bali-Ail": {
    "quantite": 20,
    "prixUnitaire": 552,
    "mode": "automatique"
  }
}
```

**Après vente de 10.5 kg:**
```json
// stock-soir.json (calculé automatiquement)
{
  "Keur Bali-Ail": {
    "quantite": 9.5,    // 20 - 10.5
    "prixUnitaire": 552,
    "mode": "automatique"
  }
}
```

**Si stock matin = 0 (non initialisé):**
```json
// stock-soir.json
{
  "Keur Bali-Ail": {
    "quantite": -10.5,   // 0 - 10.5 (NÉGATIF = manque)
    "prixUnitaire": 552,
    "mode": "automatique"
  }
}
```

## ⚠️ Notes

- Les valeurs négatives sont **normales** si le stock matin n'est pas initialisé
- Elles indiquent qu'il faut ajuster le stock matin
- Le système permet les valeurs négatives pour tracer les ventes même sans stock initial
