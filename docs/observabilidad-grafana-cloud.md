# Grafana Cloud

La API del proyecto se ejecuta como un único proceso Node.js en el servicio
`app` de Docker Compose. OpenTelemetry instrumenta HTTP/Express, PostgreSQL
(`pg`) y RabbitMQ (`amqplib`), y registra métricas del runtime de Node.js
(`nodejs.eventloop.delay.p99`, `nodejs.eventloop.delay.max`,
`process.memory.rss` y `process.memory.heap_used`). Exporta trazas y métricas
mediante OTLP/HTTP; el envío permanece desactivado hasta que se configure una
credencial local. Redis usa la versión 6 del cliente, fuera del rango que
soporta la instrumentación automática disponible para Redis.

## Preparación

1. En Grafana Cloud, crea una access policy limitada al stack de desarrollo con
   permiso `Write` para `metrics` y `traces`. No se requieren permisos de
   `Read`, `Delete`, `alerts` ni `rules` para exportar esas señales.
2. Crea un token para esa política. No lo guardes en `.env.example` ni lo
   compartas en capturas o mensajes.
3. Si `.env` todavía no existe, copia `.env.example` desde PowerShell en la raíz
   del proyecto:

   ```powershell
   Copy-Item .env.example .env
   ```

   `.env` está excluido de Git.
4. En `.env`, reemplaza el marcador de `OTEL_EXPORTER_OTLP_HEADERS` por el
   encabezado de autorización que entrega Grafana y cambia `OTEL_ENABLED=false`
   a `OTEL_ENABLED=true`.
5. Inicia o recrea la aplicación con `docker compose up -d --build app`.
   Compose pasa la configuración al contenedor. Cada instancia se identifica
   como `appurbe-api`; el ambiente local se registra como `development`.

El entorno de ejemplo mantiene `OTEL_ENABLED=false`; así la app funciona sin
credenciales y no intenta exportar datos. Cuando está habilitada, las consultas
de ubicación (`latitude`, `longitude`) y otros parámetros sensibles (`token`,
`access_token`, `authorization`, `password` y los defaults de OpenTelemetry) se
excluyen tanto de los spans entrantes del servidor (`redactedQueryParamsServer`)
como de los salientes (`redactedQueryParams`). Los logs actuales de `console`
permanecen en la salida del contenedor; no se envían a Cloud.

## Dashboard

En [observabilidad/grafana-dashboard.json](./../observabilidad/grafana-dashboard.json)
hay un dashboard listo para importar en Grafana Cloud (*Dashboards -> New ->
Import*) con paneles para:

- Requests HTTP/s por método.
- Latencia HTTP p50, p95 y p99.
- Tasa de respuestas 4xx y 5xx.
- Lag del event loop (p99 y máximo).
- Memoria RSS y heap usado del proceso Node.js.

## Verificación

Después de generar tráfico HTTP, consulta en Grafana Cloud Explore las señales
de `appurbe-api` (trazas en Tempo y métricas en Prometheus) e importa el
dashboard para monitorear latencia, errores, lag y memoria. Si no aparecen
señales, revisa `docker compose logs app` y confirma que el token tenga acceso
de escritura para el stack y los tipos de señal habilitados.
