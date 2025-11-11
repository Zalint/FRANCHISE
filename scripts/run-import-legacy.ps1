# Script pour importer les données legacy dans la base de données
# Configuration des variables d'environnement

Write-Host "=== Import des données legacy Performance Achat ===" -ForegroundColor Green
Write-Host ""

# Configuration des variables d'environnement de la base de données
# Note: Ces variables doivent être configurées selon votre environnement
$env:DB_HOST = "localhost"
$env:DB_PORT = "5432"
$env:DB_USER = "postgres"
$env:DB_PASSWORD = $env:DB_PASSWORD  # Doit être défini dans l'environnement système
$env:DB_NAME = "ventes_db_preprod_2"

# Vérifier que le mot de passe est défini
if (-not $env:DB_PASSWORD) {
    Write-Host "❌ ERREUR: La variable d'environnement DB_PASSWORD n'est pas définie." -ForegroundColor Red
    Write-Host "Veuillez définir DB_PASSWORD avant de lancer ce script." -ForegroundColor Yellow
    Write-Host "Exemple: `$env:DB_PASSWORD = 'votre_mot_de_passe'" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "Variables d'environnement configurées:" -ForegroundColor Yellow
Write-Host "  DB_HOST: $env:DB_HOST"
Write-Host "  DB_PORT: $env:DB_PORT"
Write-Host "  DB_USER: $env:DB_USER"
Write-Host "  DB_NAME: $env:DB_NAME"
Write-Host "  DB_PASSWORD: [MASQUÉ]"
Write-Host ""

# Vérification que le fichier CSV existe
if (Test-Path "SuiviObjectif2025.xlsx - EstimationVivant.csv") {
    Write-Host "✅ Fichier CSV trouvé" -ForegroundColor Green
} else {
    Write-Host "❌ ERREUR: Le fichier CSV n'a pas été trouvé." -ForegroundColor Red
    pause
    exit 1
}

# Vérification que le script existe
if (Test-Path "scripts\import-legacy-estimations.js") {
    Write-Host "✅ Script d'import trouvé" -ForegroundColor Green
    Write-Host ""
    Write-Host "Lancement de l'import..." -ForegroundColor Cyan
    Write-Host ""
    
    # Lancement du script Node.js
    node scripts\import-legacy-estimations.js
    
    Write-Host ""
    Write-Host "=== Fin de l'import ===" -ForegroundColor Green
} else {
    Write-Host "❌ ERREUR: Le script d'import n'a pas été trouvé." -ForegroundColor Red
    pause
    exit 1
}

