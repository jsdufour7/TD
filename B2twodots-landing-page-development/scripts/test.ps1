#Requires -Version 5.1
<#
.SYNOPSIS
  Tests de fumée (smoke tests) pour TwoDots.ca.
.DESCRIPTION
  Vérifie que le site et l'API fonctionnent : landing FR/EN, authentification,
  garde d'accès au dashboard et aux API, formulaire de contact.
.EXAMPLE
  .\scripts\test.ps1
  .\scripts\test.ps1 -BaseUrl http://localhost:3000
#>
param(
  [string]$BaseUrl = 'http://localhost:3000'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$results = @()
function Test-Case {
  param([string]$Name, [scriptblock]$Block)
  try {
    & $Block
    $script:results += [pscustomobject]@{ Test = $Name; Resultat = 'PASS' }
    Write-Host "  [PASS] $Name" -ForegroundColor Green
  }
  catch {
    $script:results += [pscustomobject]@{ Test = $Name; Resultat = 'FAIL' }
    Write-Host "  [FAIL] $Name — $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Assert($condition, $message) {
  if (-not $condition) { throw $message }
}

Write-Host "`nTwoDots.ca — smoke tests sur $BaseUrl`n" -ForegroundColor Cyan

# 1. Santé ------------------------------------------------------------------
Test-Case "API /api/health répond ok" {
  $r = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 10
  Assert ($r.ok -eq $true) "health ok != true"
}

# 2. Landing FR -------------------------------------------------------------
Test-Case "Landing FR affiche le slogan officiel" {
  $r = Invoke-WebRequest -Uri "$BaseUrl/fr" -UseBasicParsing -TimeoutSec 15
  Assert ($r.StatusCode -eq 200) "status $($r.StatusCode)"
  Assert ($r.Content -match 'Nous transformons les idées en entreprises') "slogan FR introuvable"
}

# 3. Landing EN -------------------------------------------------------------
Test-Case "Landing EN affiche le slogan officiel" {
  $r = Invoke-WebRequest -Uri "$BaseUrl/en" -UseBasicParsing -TimeoutSec 15
  Assert ($r.Content -match 'We transform ideas into businesses') "slogan EN introuvable"
}

# 4. Garde d'accès API ------------------------------------------------------
Test-Case "API protégée refuse sans session (401)" {
  try {
    Invoke-WebRequest -Uri "$BaseUrl/api/ventures" -UseBasicParsing -TimeoutSec 10
    throw "réponse 200 inattendue"
  }
  catch {
    $code = $_.Exception.Response.StatusCode.value__
    Assert ($code -eq 401) "code $code au lieu de 401"
  }
}

# 5. Connexion démo ---------------------------------------------------------
$session = $null
Test-Case "Connexion avec le compte démo" {
  $body = @{ action = 'login'; email = 'demo@twodots.ca'; password = 'demo1234' } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/auth" -Method Post -Body $body `
    -ContentType 'application/json' -SessionVariable session -UseBasicParsing -TimeoutSec 15
  Assert ($r.StatusCode -eq 200) "status $($r.StatusCode)"
  $json = $r.Content | ConvertFrom-Json
  Assert ($json.user.email -eq 'demo@twodots.ca') "utilisateur inattendu"
  $script:session = $session
}

# 6. Dashboard avec session -------------------------------------------------
Test-Case "Dashboard accessible avec session" {
  Assert ($null -ne $session) "pas de session"
  $r = Invoke-WebRequest -Uri "$BaseUrl/dashboard" -WebSession $session -UseBasicParsing -TimeoutSec 15
  Assert ($r.StatusCode -eq 200) "status $($r.StatusCode)"
  Assert ($r.Content -match 'Espace studio') "contenu du dashboard introuvable"
}

# 7. API avec session -------------------------------------------------------
Test-Case "API /api/ventures répond avec session" {
  $r = Invoke-RestMethod -Uri "$BaseUrl/api/ventures" -WebSession $session -TimeoutSec 10
  Assert ($r.ventures.Count -ge 1) "aucune entreprise retournée"
}

# 8. Formulaire de contact --------------------------------------------------
Test-Case "Formulaire de contact accepte un message" {
  $body = @{ name = 'Smoke Test'; email = 'smoke@test.ca'; subject = 'Test'; body = 'Message automatisé.' } | ConvertTo-Json
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/contact" -Method Post -Body $body `
    -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
  Assert ($r.StatusCode -eq 201) "status $($r.StatusCode)"
}

# 9. Déconnexion ------------------------------------------------------------
Test-Case "Déconnexion invalide la session" {
  $body = '{"action":"logout"}'
  $null = Invoke-WebRequest -Uri "$BaseUrl/api/auth" -Method Post -Body $body `
    -ContentType 'application/json' -WebSession $session -UseBasicParsing -TimeoutSec 10
  try {
    $null = Invoke-WebRequest -Uri "$BaseUrl/api/ventures" -WebSession $session -UseBasicParsing -TimeoutSec 10
    throw "API accessible après déconnexion"
  }
  catch {
    if ($_.Exception.Message -eq 'API accessible après déconnexion') { throw $_ }
  }
}

# --- Résumé ----------------------------------------------------------------
$passed = @($results | Where-Object Resultat -eq 'PASS').Count
$failed = @($results | Where-Object Resultat -eq 'FAIL').Count
Write-Host "`n----------------------------------------" -ForegroundColor Cyan
Write-Host "  $passed réussi(s) · $failed échoué(s) sur $($results.Count)" -ForegroundColor $(if ($failed) { 'Red' } else { 'Green' })
Write-Host "----------------------------------------`n" -ForegroundColor Cyan

if ($failed -gt 0) { exit 1 }
