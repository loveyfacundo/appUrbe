# Entorno Docker de AppUrbe

## Servicios incluidos

`docker-compose.yml` levanta:

- `app`: API Node.js 22 + Express en `http://localhost:3000`.
- `postgres`: PostgreSQL 16 para persistencia.
- `rabbitmq`: RabbitMQ 3.13; panel en `http://localhost:15672`.
- `redis`: Redis 7 para caché, TTL, locks e idempotencia.

PostgreSQL, RabbitMQ y Redis utilizan volúmenes Docker para conservar sus
datos entre reinicios.

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

## Health check

La aplicación expone `GET /health`. Compose y el propio `Dockerfile` lo usan
para verificar que la API está disponible antes de considerarla saludable.
