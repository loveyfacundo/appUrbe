param(
  [string]$OutputDirectory = ".\backups"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputFile = Join-Path $OutputDirectory "appurbe-$timestamp.dump"

docker compose --env-file .env.example exec -T postgres `
  pg_dump -U appurbe -d appurbe -Fc | Set-Content -Encoding Byte $outputFile

Write-Host "Backup creado en $outputFile"
