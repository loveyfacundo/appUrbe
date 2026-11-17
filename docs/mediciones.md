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

Usar una base de pruebas dedicada; el script crea y elimina filas de prueba y
aplica las migraciones al iniciar:

```powershell
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
