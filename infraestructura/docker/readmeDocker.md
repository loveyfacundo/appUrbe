# Entorno Docker de AppUrbe

## Servicios incluidos

`docker-compose.yml` levanta:

- `app`: API Node.js 22 + Express en `http://localhost:3000`.
- `postgres`: PostgreSQL 16 para persistencia.
- `rabbitmq`: RabbitMQ 3.13; el servicio publica eventos persistentes en un exchange durable y el panel está en `http://localhost:15672`.
- `redis`: Redis 7 para bloqueos distribuidos con vencimiento y operaciones idempotentes.

PostgreSQL, RabbitMQ y Redis utilizan volúmenes Docker para conservar sus
datos entre reinicios.

Las migraciones SQL de viajes se montan en
`/docker-entrypoint-initdb.d` y PostgreSQL las ejecuta automáticamente al crear
un volumen nuevo. La aplicación también registra y aplica las migraciones
pendientes al iniciar, por lo que un volumen existente recibe las migraciones
nuevas sin borrar sus datos. Para volver a crear todo desde cero en desarrollo:

```powershell
docker compose down -v
docker compose --env-file .env.example up --build
```

## Uso local

Copiar `.env.example` como `.env` si se desean personalizar puertos o
credenciales. Los valores incluidos son solo para desarrollo:

```powershell
docker compose --env-file .env.example up --build
```

`JWT_SECRET` firma los tokens Bearer usados por la API de viajes. El valor de
`.env.example` es únicamente para desarrollo; reemplazarlo por un secreto
aleatorio antes de cualquier despliegue compartido o productivo.

Para ejecutar en segundo plano:

```powershell
docker compose --env-file .env.example up --build -d
```

Comprobar el estado:

```powershell
docker compose ps
Invoke-WebRequest http://localhost:3000/health
```

La prueba concurrente usa una base PostgreSQL de prueba dedicada y aplica las
migraciones automáticamente. Configurar `TEST_DATABASE_URL` para ejecutarla;
sin esa variable la prueba queda omitida:

```powershell
$env:TEST_DATABASE_URL = "postgresql://appurbe:AppUrbe2026@localhost:55432/appurbe_test"
npm test
```

Para registrar latencia y throughput del endpoint de asignación en el entorno
local:

```powershell
$env:TEST_DATABASE_URL = "postgresql://appurbe:AppUrbe2026@localhost:55432/appurbe_test"
npm run measure:assignment
```

El escenario, la meta y el espacio para registrar resultados están en
[`docs/mediciones.md`](../../docs/mediciones.md).

Detener los contenedores sin borrar datos:

```powershell
docker compose down
```

Para eliminar también los volúmenes locales:

```powershell
docker compose down -v
```

## Imagen de Docker Hub

El servicio `app` está configurado con la imagen:

```text
loveyfacundo/appurbe:latest
```

Construir y publicar manualmente:

```powershell
docker build -t loveyfacundo/appurbe:latest .
docker login
docker push loveyfacundo/appurbe:latest
```

Para una versión identificable, usar una etiqueta adicional:

```powershell
docker build -t loveyfacundo/appurbe:1.0.0 .
docker push loveyfacundo/appurbe:1.0.0
```

No se incluyen credenciales en el repositorio. El login debe hacerse con la
cuenta de Docker Hub que tenga permisos sobre el repositorio
`loveyfacundo/appurbe`.

## Publicación automática desde `main`

El workflow [docker-publish.yml](../../.github/workflows/docker-publish.yml)
se ejecuta en cada push a la rama `main`. Construye el `Dockerfile` y publica
dos etiquetas:

- `loveyfacundo/appurbe:latest`
- `loveyfacundo/appurbe:sha-<commit>`

Antes de hacer el primer push, configurar en GitHub los siguientes **Actions
secrets** del repositorio:

- `DOCKERHUB_USERNAME`: usuario de Docker Hub.
- `DOCKERHUB_TOKEN`: access token de Docker Hub, no la contraseña personal.

El token debe tener permisos para escribir en el repositorio
`loveyfacundo/appurbe`. No se deben agregar estos valores a `.env`,
`docker-compose.yml` ni a ningún archivo versionado.

## Health checks

La aplicación expone dos endpoints:

- `GET /health`: liveness; verifica que el proceso HTTP está activo.
- `GET /health/ready`: readiness; ejecuta `SELECT 1` contra PostgreSQL.
- La readiness también verifica RabbitMQ y Redis cuando están configurados.

Compose y el `Dockerfile` usan `/health/ready`, por lo que la aplicación no se
considera saludable hasta que PostgreSQL acepta consultas.
