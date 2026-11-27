# Medición de asignación de viajes

## Escenario

`tests/performance/medir-asignacion.js` crea 100 viajes de prueba en una base
PostgreSQL dedicada y envía solicitudes HTTP concurrentes al endpoint de
aceptación. Registra la latencia observada por solicitud, el percentil 95, la
duración total y el throughput. Antes de medir, calienta el pool de conexiones
de PostgreSQL. El resultado debe guardarse como evidencia de cada ejecución y
no se debe presentar una medición local como una meta de producción.

## Meta inicial

- 100 asignaciones concurrentes.
- Percentil 95 menor o igual a 500 ms en el entorno local Docker.
- Ninguna respuesta distinta de `200` en el escenario sin competencia.
- La prueba de concurrencia separada debe demostrar que, ante dos conductores
  para el mismo viaje, exactamente una solicitud gana y la otra obtiene `409`.

La meta se revisará cuando se defina el entorno de despliegue. El escenario, la
versión de Node.js, el host y los valores medidos deben acompañar el resultado.

## Ejecución

Usar una base de pruebas dedicada; Compose crea `appurbe` por defecto, no
`appurbe_test`. Crear la base de pruebas una vez y luego ejecutar el benchmark:

```powershell
docker compose exec -T postgres createdb -U appurbe appurbe_test
$env:TEST_DATABASE_URL = "postgresql://appurbe:AppUrbe2026@localhost:55432/appurbe_test"
npm run measure:assignment
```

Opcionalmente se puede cambiar el tamaño de la carga entre 20 y 2000 requests:

```powershell
$env:BENCH_ITERATIONS = "200"
npm run measure:assignment
```

## Resultados

Cada medición debe registrar el entorno y conservar el resultado, incluso
cuando no alcance la meta:

| Fecha | Node.js | Entorno | Requests | P95 (ms) | Throughput/s | Resultado |
|---|---|---|---:|---:|---:|---|
| 2026-11-14 | 22.23.4 | Windows 11 Pro, Docker Desktop, PostgreSQL 16 | 100 | 814.91 | 112.52 | No cumple la meta de p95 ≤ 500 ms |

El escenario completó las 100 respuestas con HTTP 200. La medición es local y
no representa rendimiento de producción. La meta de latencia sigue pendiente;
el resultado se conserva como línea base y no bloquea el inicio de la Etapa 2.

## Benchmark de ubicaciones y despacho

### Hipótesis previa

Se considera razonable que el p95 desde el inicio de la solicitud hasta la
aceptación de una asignación no supere **2.000 ms** bajo la carga local descrita
abajo. Se espera que PostGIS reduzca ese p95 al menos un **20 %** respecto de la
búsqueda ingenua y que no haya respuestas fallidas. Estos son objetivos de esta
medición local, no SLO de producción; se conservan aunque la hipótesis no se
cumpla.

### Escenario y comparación

`tests/performance/benchmark-flota.js` prepara una base aislada, crea 500
choferes habilitados mediante la API y elimina el esquema al finalizar. Para
cada repetición ejecuta ambas estrategias en orden alternado y reutiliza los
mismos choferes, coordenadas, endpoints, base y máquina:

- **Ingenua:** lee todas las ubicaciones vigentes de choferes elegibles y
  calcula/ordena las distancias en JavaScript.
- **Optimizada:** filtra cercanía en PostgreSQL con PostGIS (`ST_DWithin`) e
  índice GiST.

k6 ejecuta 500 VUs de ubicación con un intervalo objetivo de 2 segundos durante
180 segundos. El primer envío de cada VU se escalona dentro de los primeros dos
segundos para evitar una ráfaga de conexiones; después cada chofer actualiza
cada dos segundos. En paralelo, un VU solicita viajes, consulta candidatos cercanos
y acepta la asignación por los endpoints públicos; dos VUs consultan `/health`.
El tiempo hasta la asignación empieza antes de crear el viaje y termina cuando
la aceptación devuelve HTTP 200. Es una medición reproducible del recorrido
solicitud-búsqueda-aceptación, no mide el vencimiento de ofertas.

Se recogen p50/p95/p99 de solicitud, `/health`, actualización de ubicación,
búsqueda de candidatos, aceptación y tiempo total de asignación; requests/s,
errores, actualizaciones de ubicación/s; lag del event loop máximo y p99, RSS
máximo y heap usado máximo del proceso servidor. La métrica de lag y memoria se
toma del proceso servidor, separado del contenedor k6.

### Ejecución reproducible

Usar una base PostgreSQL/PostGIS dedicada. El comando predeterminado ejecuta
tres repeticiones de 180 segundos por estrategia (18 minutos de carga en total);
descarga la imagen fijada de k6 y crea/elimina un esquema temporal.

```powershell
docker compose exec -T postgres createdb -U appurbe appurbe_test
$env:TEST_DATABASE_URL = "postgresql://appurbe:AppUrbe2026@localhost:55432/appurbe_test"
npm run measure:fleet
```

`createdb` se ejecuta una sola vez; si la base ya existe, no repetir ese paso.
El script no elimina la base, pero sí elimina su esquema temporal al finalizar.

Se pueden ajustar `BENCH_DRIVER_COUNT` (mínimo 500),
`BENCH_DURATION_SECONDS` y `BENCH_REPEATS`. Una ejecución corta sirve solo como
smoke test y no reemplaza la evidencia requerida de varios minutos y tres
repeticiones.

### Entorno registrado

- Sistema operativo: Windows 11 Pro 10.0.26300, 64 bits.
- Node.js: 22.23.4; k6: imagen Docker `grafana/k6:0.54.0`.
- Máquina: 12 procesadores lógicos, 31.93 GiB RAM.
- PostgreSQL 16.4; PostGIS 3.4.3.
- Docker Desktop: durante la inspección estaban activos los contenedores
  `appurbe-app`, `appurbe-postgres`, `appurbe-rabbitmq` y `appurbe-redis`. La
  carga del benchmark apunta al servidor local del script y a PostgreSQL; los
  otros contenedores son procesos concurrentes del entorno. No se registró el
  uso de CPU ni la actividad de otros procesos del host.

### Resultados

Ejecución completa: 500 choferes, 180 segundos por corrida y tres repeticiones
por estrategia. La duración medida por corrida fue de 183,24–183,45 segundos,
incluyendo el cierre del escenario. Tiempos en milisegundos, tasas por segundo
y memoria en MiB; percentiles redondeados a dos decimales.

| Estrategia | Rep. | Req/s | Solicitud p50/p95/p99 | Asignación total p50/p95/p99 | Ubicaciones/s | Errores HTTP | Viajes asignados/solicitados | Event loop p99/máx | RSS/heap máx |
|---|---:|---:|---|---|---:|---:|---:|---|---:|
| Ingenua | 1 | 257,92 | 8,75 / 15,24 / 24,03 | 22 / 34 / 72,89 | 249,91 | 0 | 174/176 | 18,48 / 25,10 | 89,25 / 30,44 |
| PostGIS | 1 | 257,93 | 8,06 / 14,53 / 42,83 | 19 / 40,35 / 115,94 | 249,92 | 0 | 174/176 | 18,07 / 24,79 | 99,27 / 35,93 |
| PostGIS | 2 | 257,93 | 8,23 / 14,22 / 27,06 | 19 / 37,25 / 40,50 | 249,91 | 0 | 176/176 | 18,97 / 25,35 | 101,60 / 36,78 |
| Ingenua | 2 | 257,97 | 7,76 / 13,48 / 18,42 | 20 / 30,25 / 38,00 | 249,93 | 0 | 176/177 | 18,22 / 24,44 | 99,56 / 35,79 |
| Ingenua | 3 | 257,94 | 8,17 / 28,18 / 40,14 | 20 / 48,25 / 70,50 | 249,91 | 0 | 176/176 | 18,83 / 22,81 | 99,26 / 31,31 |
| PostGIS | 3 | 257,95 | 7,96 / 14,75 / 18,74 | 18 / 36,20 / 48,88 | 249,91 | 0 | 177/177 | 18,94 / 24,66 | 101,10 / 35,45 |

Percentiles p50/p95/p99 de los endpoints auxiliares y aceptación:

| Estrategia | Rep. | `/health` | Actualización ubicación | Búsqueda candidatos | Aceptación |
|---|---:|---|---|---|---|
| Ingenua | 1 | 0,92 / 1,71 / 2,63 | 4,64 / 7,22 / 12,84 | 3,94 / 6,49 / 10,08 | 8,29 / 14,66 / 19,40 |
| PostGIS | 1 | 0,87 / 1,57 / 2,66 | 4,35 / 6,41 / 9,11 | 2,76 / 17,18 / 29,25 | 7,69 / 13,89 / 21,20 |
| PostGIS | 2 | 0,82 / 1,37 / 1,88 | 4,24 / 6,24 / 8,72 | 2,64 / 15,22 / 17,99 | 7,49 / 11,78 / 15,29 |
| Ingenua | 2 | 0,82 / 1,37 / 1,98 | 4,25 / 6,17 / 7,85 | 3,87 / 6,31 / 8,39 | 7,32 / 10,78 / 15,53 |
| Ingenua | 3 | 0,84 / 1,42 / 2,14 | 4,38 / 21,85 / 37,07 | 3,88 / 6,14 / 7,48 | 7,57 / 22,17 / 38,03 |
| PostGIS | 3 | 0,83 / 1,33 / 1,85 | 4,19 / 5,91 / 7,53 | 2,59 / 15,03 / 19,76 | 7,22 / 10,25 / 14,15 |

Todas las corridas tuvieron cero errores HTTP, cero fallos al actualizar
ubicaciones y cero errores al crear solicitudes. Sin embargo, hubo cinco
solicitudes cuyo chofer objetivo no apareció entre los candidatos: dos en cada
corrida de la repetición 1 y una en la repetición 2 ingenua. Por eso la tasa de
viajes asignados fue 174/176, 174/176 y 176/177 en esas tres corridas, y 100 %
en las otras. Son fallos funcionales de selección, no errores HTTP; los
percentiles de asignación describen solo viajes que sí se asignaron y no deben
interpretarse como tasa de éxito total.

### Conclusión

Se cumplió el límite de tiempo razonable: el p95 de asignación fue de 30,25 a
48,25 ms en las seis corridas, por debajo de los 2.000 ms definidos. También se
sostuvo la carga prevista de 250 actualizaciones/s: se observaron 249,91–249,93
por segundo.

No se confirmó la mejora esperada del 20 % de PostGIS. El p95 de asignación
mejoró 24,97 % solo en la repetición 3; empeoró 18,68 % en la repetición 1 y
23,14 % en la repetición 2. El promedio de los p95 fue 37,50 ms para la búsqueda
ingenua y 37,93 ms para PostGIS (1,16 % más lento). La variación entre
repeticiones y los cinco casos sin candidato impide concluir que PostGIS mejoró
el recorrido completo bajo esta carga.

El lag p99 máximo observado fue 18,97 ms (máximo absoluto 25,35 ms); el RSS
máximo fue 101,60 MiB y el heap máximo 36,78 MiB. Aunque no hubo errores HTTP,
los cinco casos sin candidato requieren investigación antes de considerar
funcionalmente impecable el despacho bajo carga. La medición es una línea base
local, no representa rendimiento ni SLO de producción.
