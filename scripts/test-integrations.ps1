$ErrorActionPreference = 'Stop'

Write-Host 'Iniciando PostgreSQL, RabbitMQ y Redis...'
docker compose up -d postgres rabbitmq redis
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$composeConfig = docker compose config --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

function Get-PublishedPort($service, $containerPort) {
  $mapping = $composeConfig.services.$service.ports |
    Where-Object { $_.target -eq $containerPort } |
    Select-Object -First 1
  if (-not $mapping) {
    throw "No hay un puerto publicado para $service`:$containerPort en docker compose."
  }
  return $mapping.published
}

$postgresUser = [Uri]::EscapeDataString($composeConfig.services.postgres.environment.POSTGRES_USER)
$postgresPassword = [Uri]::EscapeDataString($composeConfig.services.postgres.environment.POSTGRES_PASSWORD)
$postgresDatabase = [Uri]::EscapeDataString($composeConfig.services.postgres.environment.POSTGRES_DB)
$rabbitUser = [Uri]::EscapeDataString($composeConfig.services.rabbitmq.environment.RABBITMQ_DEFAULT_USER)
$rabbitPassword = [Uri]::EscapeDataString($composeConfig.services.rabbitmq.environment.RABBITMQ_DEFAULT_PASS)
$postgresPort = Get-PublishedPort 'postgres' 5432
$rabbitPort = Get-PublishedPort 'rabbitmq' 5672
$redisPort = Get-PublishedPort 'redis' 6379

$env:TEST_DATABASE_URL = "postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDatabase}"
$env:TEST_RABBITMQ_URL = "amqp://${rabbitUser}:${rabbitPassword}@127.0.0.1:${rabbitPort}"
$env:TEST_REDIS_URL = "redis://127.0.0.1:${redisPort}"

$infraestructuraLista = $false
Write-Host 'Esperando a PostgreSQL, RabbitMQ y Redis...'
for ($i = 0; $i -lt 60; $i++) {
  docker compose exec -T postgres pg_isready -U appurbe -d appurbe
  $postgresListo = $LASTEXITCODE -eq 0

  docker compose exec -T rabbitmq rabbitmq-diagnostics -q ping
  $rabbitmqListo = $LASTEXITCODE -eq 0

  docker compose exec -T redis redis-cli ping
  $redisListo = $LASTEXITCODE -eq 0

  if ($postgresListo -and $rabbitmqListo -and $redisListo) {
    $infraestructuraLista = $true
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $infraestructuraLista) {
  Write-Error 'La infraestructura no estuvo lista en 60 segundos. Revisa Docker Desktop y docker compose logs.'
  exit 1
}

Write-Host 'Ejecutando suite completa (unitarias e integración)...'
node --test `
  servicios/identidad/tests/identidad-flota.test.js `
  servicios/viajes/tests/viaje.test.js `
  servicios/viajes/tests/casos-uso.test.js `
  servicios/viajes/tests/http.test.js `
  servicios/viajes/tests/repositorios-postgres.test.js `
  servicios/viajes/tests/mensajeria-rabbitmq.test.js `
  servicios/viajes/tests/migraciones.test.js `
  servicios/viajes/tests/redis.test.js `
  servicios/viajes/tests/outbox.test.js `
  servicios/tarifas/tests/tarifas.test.js `
  servicios/pagos/tests/pagos.test.js `
  servicios/asignacion/tests/ofertas.test.js `
  tests/concurrencia/postgres-asignacion.test.js
exit $LASTEXITCODE
