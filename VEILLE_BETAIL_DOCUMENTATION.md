# 📰 Veille Actualités Bétail - Documentation

## Vue d'ensemble

Le module **Veille Actualités Bétail** permet de monitorer automatiquement les actualités du Mali et de la Mauritanie pour détecter les facteurs pouvant affecter l'approvisionnement en bovins au Sénégal.

### 🎯 Objectif

90% des bovins du Sénégal proviennent du Mali et de la Mauritanie. Cette veille automatisée permet d':
- **Anticiper** les hausses de prix
- **Détecter** les pénuries potentielles
- **Identifier** les risques géopolitiques et sanitaires
- **Optimiser** les décisions d'achat

---

## 🏗️ Architecture Technique

### Backend API

**Endpoint** : `GET /api/veille-betail`

**Authentication** : Requiert une session authentifiée (via checkAuth middleware)

**Méthode** : Option A (Simple & Efficace)
- Collecte d'actualités via **Google News RSS**
- Analyse par **OpenAI GPT-4o-mini**
- Cache de **12 heures** pour optimiser les coûts

### Sources d'Information

**Mots-clés de recherche** :
- `Mali bétail`
- `Mali boeuf élevage`
- `Mauritanie bétail`
- `Mauritanie boeuf élevage`
- `Mali Mauritanie export bétail Sénégal`

**Nombre d'articles analysés** : ~25 articles les plus récents (5 par requête)

---

## 🔑 Configuration

### Variables d'Environnement

Ajouter dans `start_matix.ps1` ou `.env.local` :

```powershell
$env:OPENAI_API_KEY = "sk-proj-..."
$env:OPENAI_MODEL = "gpt-4o-mini"
```

⚠️ **Sécurité** : Ces clés ne doivent JAMAIS être committées dans Git

### Dépendances NPM

```bash
npm install openai rss-parser axios
```

---

## 📊 Structure de la Réponse API

### JSON Response

```json
{
  "success": true,
  "cached": false,
  "timestamp": "2025-01-11T15:30:00.000Z",
  "articles_count": 25,
  "articles_sources": ["MaliWeb", "AMI", "Maliweb.net"],
  
  "contexte": "Résumé général de la situation en 2-3 phrases",
  
  "alertes": [
    {
      "niveau": "critique|warning|info",
      "titre": "Titre de l'alerte",
      "description": "Description détaillée",
      "impact": "Impact sur l'approvisionnement"
    }
  ],
  
  "tendances": [
    {
      "type": "prix|climat|reglementation|autre",
      "description": "Description de la tendance",
      "impact_previsionnel": "Impact prévu sur le marché"
    }
  ],
  
  "recommandations": [
    "Recommandation 1",
    "Recommandation 2"
  ]
}
```

---

## 💰 Coûts Estimés

### OpenAI GPT-4o-mini

**Tarification** :
- Input : ~$0.15 / 1M tokens
- Output : ~$0.60 / 1M tokens

**Utilisation typique** :
- ~5,000 tokens input par analyse
- ~1,500 tokens output
- **Coût par analyse** : ~$0.0015 (moins de 1 centime)

**Avec cache de 12h** :
- Maximum 2 analyses/jour
- **Coût mensuel** : ~**$0.10** 💸

---

## 🎨 Interface Utilisateur

### Bouton

Situé en haut de la page `performanceAchat.html`, à côté de "Retour au menu"

```html
<button class="btn btn-info mr-2" id="veilleBetailBtn">
    <i class="fas fa-newspaper"></i> Veille Actualités Bétail
</button>
```

### Modal

**Sections affichées** :
1. **Contexte Général** : Résumé de la situation
2. **Alertes** : Par niveau de criticité (critique, warning, info)
3. **Tendances du Marché** : Prix, climat, réglementation
4. **Recommandations** : Actions suggérées
5. **Métadonnées** : Nombre d'articles, sources, date de mise à jour

### Codes Couleur

- 🔴 **Alerte critique** : Rouge (danger)
- 🟡 **Avertissement** : Jaune (warning)
- 🔵 **Information** : Bleu (info)
- 🟢 **Pas d'alerte** : Vert (success)

---

## 🔒 Sécurité

### Protection des Clés API

✅ **Bonnes pratiques** :
- Clés stockées uniquement en variables d'environnement
- Jamais dans le code source
- Exclues du Git (via `.gitignore`)

### Contrôle d'Accès

- Endpoint protégé par `checkAuth` et `checkReadAccess` middlewares
- Seuls les utilisateurs connectés avec droits de lecture peuvent accéder

### Rate Limiting

- Cache de 12h évite les appels répétés
- Économise les coûts OpenAI
- Réduit la charge serveur

---

## 🧪 Tests

### Test Manuel

1. Démarrer le serveur : `.\start_matix.ps1`
2. Se connecter à l'application
3. Aller sur http://localhost:3000/performanceAchat.html
4. Cliquer sur "Veille Actualités Bétail"
5. Vérifier l'affichage du modal avec analyse

### Test API Direct

```powershell
# Avec authentification
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
# ... (après login)

$response = Invoke-RestMethod -Uri "http://localhost:3000/api/veille-betail" `
    -Method GET -WebSession $session

$response | ConvertTo-Json -Depth 5
```

---

## 🔧 Maintenance

### Vider le Cache

Pour forcer une nouvelle analyse :

```javascript
// Dans server.js, réinitialiser le cache
veilleCache = {
    data: null,
    timestamp: null,
    cacheDuration: 12 * 60 * 60 * 1000
};
```

Ou redémarrer le serveur.

### Modifier la Durée du Cache

Dans `server.js`, ligne ~4745 :

```javascript
cacheDuration: 12 * 60 * 60 * 1000 // Modifier ici (en millisecondes)
```

Options :
- **6h** : `6 * 60 * 60 * 1000`
- **24h** : `24 * 60 * 60 * 1000`

### Ajouter des Sources

Dans `server.js`, ligne ~4784, ajouter des requêtes :

```javascript
const searchQueries = [
    'Mali bétail',
    'Mauritanie bétail',
    'Votre nouvelle requête ici'
];
```

---

## 📈 Évolutions Futures (Phase 2)

### Améliorations Possibles

1. **Scraping Avancé**
   - Intégrer Jina AI Reader ou Firecrawl
   - Analyser le contenu complet des articles

2. **Alertes Automatiques**
   - Email/SMS en cas d'alerte critique
   - Notifications push dans l'app

3. **Historique**
   - Stocker les analyses en base de données
   - Graphiques d'évolution des tendances

4. **Sources Additionnelles**
   - API gouvernementales Mali/Mauritanie
   - Données météo (sécheresse)
   - Prix des marchés à bétail

5. **Multi-langues**
   - Analyser sources en arabe/bambara
   - Traduction automatique

---

## 🐛 Dépannage

### Erreur : "OpenAI API key not configured"

**Solution** : Vérifier que `OPENAI_API_KEY` est défini dans les variables d'environnement

```powershell
echo $env:OPENAI_API_KEY
```

### Erreur : "Failed to fetch RSS"

**Causes possibles** :
- Problème de connexion internet
- Google News temporairement inaccessible
- Firewall/proxy bloquant les requêtes

**Solution** : Vérifier la connexion et réessayer

### Modal affiche "Aucune actualité disponible"

**Causes** :
- Aucun article trouvé pour les mots-clés
- RSS feeds vides

**Solution** : Modifier les requêtes de recherche ou attendre quelques heures

### Coûts OpenAI trop élevés

**Solutions** :
- Augmenter la durée du cache (24h+)
- Réduire le nombre de requêtes RSS
- Limiter `max_tokens` dans l'appel OpenAI

---

## 📚 Ressources

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [RSS Parser NPM](https://www.npmjs.com/package/rss-parser)
- [Google News RSS](https://news.google.com/rss)

---

**Version** : 1.0  
**Date** : Janvier 2025  
**Auteur** : Équipe MATA

