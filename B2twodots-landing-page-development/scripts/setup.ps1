#Requires -Version 5.1
<#
.SYNOPSIS
  Prépare et lance TwoDots.ca en local (Node.js + PostgreSQL).
.DESCRIPTION
  - Installe les dépendances npm
  - Démarre PostgreSQL via Docker si disponible (sinon utilise un PostgreSQL local)
  - Applique le schéma Drizzle et seed les données de démonstration
  - Build puis démarre le serveur de production (ou dev avec -Dev)
.EXAMPLE
  .\scripts\setup.ps1            # build production + démarrage
  .\scripts\setup.ps1 -Dev       # serveur de développement
  .\scripts\setup.ps1 -SkipDb    # ne touche pas à la base de données
#>
param(
  [switch]$Dev,
  [switch]$SkipDb,
  [switch]$ForceSeed
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

try {
  # --- Prérequis -----------------------------------------------------------
  Write-Step "Vérification des prérequis"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js introuvable. Installez Node.js 20+ : https://nodejs.org"
  }
  $nodeVersion = [int]((node -v) -replace 'v(\d+)\..*', '$1')
  Write-Host "    Node.js $(node -v)" -ForegroundColor Gray
  if ($nodeVersion -lt 18) { throw "Node.js 18+ requis (version actuelle : $(node -v))." }

  # --- .env ----------------------------------------------------------------
  if (-not (Test-Path .env)) {
    Write-Step "Création de .env à partir de .env.example"
    Copy-Item .env.example .env
  }

  # --- Dépendances ---------------------------------------------------------
  Write-Step "Installation des dépendances npm"
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install a échoué." }

  # --- Base de données -----------------------------------------------------
  if (-not $SkipDb) {
    $hasDocker = [bool](Get-Command docker -ErrorAction SilentlyContinue)
    if ($hasDocker) {
      Write-Step "Démarrage de PostgreSQL via Docker Compose"
      docker compose up -d db 2>$null
      if ($LASTEXITCODE -ne 0) {
        Write-Host "    Docker Compose indisponible (port 5432 occupé ?) — j'utilise le PostgreSQL local." -ForegroundColor Yellow
      }
      else {
        Write-Host "    Attente de PostgreSQL..." -ForegroundColor Gray
        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
          docker compose exec -T db pg_isready -U postgres -d app_db *>$null
          if ($LASTEXITCODE -eq 0) { $ready = $true; break }
          Start-Sleep -Seconds 1
        }
        if (-not $ready) { throw "PostgreSQL n'est pas prêt dans Docker." }
        Write-Host "    PostgreSQL est prêt." -ForegroundColor Green
      }
    }
    else {
      Write-Host "    Docker introuvable — assurez-vous qu'un PostgreSQL local tourne sur $($env:DATABASE_URL)" -ForegroundColor Yellow
    }

    Write-Step "Application du schéma (drizzle-kit push)"
    npx drizzle-kit push
    if ($LASTEXITCODE -ne 0) { throw "drizzle-kit push a échoué." }

    Write-Step "Seed des données de démonstration"
    if ($ForceSeed) { $env:SEED_FORCE = '1' }
    node scripts/seed.mjs
    if ($LASTEXITCODE -ne 0) { throw "Le seed a échoué." }
  }

  # --- Lancement -----------------------------------------------------------
  if ($Dev) {
    Write-Step "Démarrage du serveur de développement sur http://localhost:3000"
    npm run dev
  }
  else {
    Write-Step "Build de production"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Le build a échoué." }
    Write-Step "Démarrage du serveur de production sur http://localhost:3000"
    Write-Host "    Compte démo : demo@twodots.ca / demo1234" -ForegroundColor Green
    npm start
  }
}
catch {
  Write-Host "`nERREUR : $($_.Exception.Message)" -ForegroundColor Red
  Pop-Location
  exit 1
}
