# Versionado y compatibilidad

## REST

- La versión mayor forma parte de la ruta (`/api/v1`).
- Cambios compatibles: agregar propiedades opcionales, nuevos valores solo
  cuando el consumidor los tolere, y agregar endpoints.
- Cambios incompatibles: eliminar o renombrar campos, cambiar tipos, hacer
  obligatorio un campo existente o alterar el significado de un estado.
- Un cambio incompatible requiere `/api/v2`, documentación de migración y un
  período de coexistencia mínimo de 30 días desde TP2.
- Los clientes deben ignorar campos desconocidos y el servidor debe conservar
  los campos existentes durante toda la versión.

## Eventos

- `eventType` identifica el nombre estable y `eventVersion` la versión del
  payload.
- Los consumidores de `v1` deben continuar funcionando cuando se agreguen
  propiedades opcionales a `v1`.
- Un cambio incompatible publica `eventVersion: 2` y routing key `*.v2`; no se
  modifica el significado de `*.v1`.
- El productor mantiene `v1` mientras exista un consumidor registrado de esa
  versión. La migración se registra en este archivo antes de retirar una
  versión.

## Reglas comunes desde TP2

Cada request HTTP y cada evento debe transportar `X-Correlation-Id` /
`correlationId`. Las respuestas de error usan el esquema `Error` del OpenAPI y
no revelan stack traces, tokens ni datos de pago. Las claves de idempotencia se
guardan por 24 horas como mínimo y se rechaza su reutilización con un payload
distinto.

## Registro de cambios

| Fecha | Contrato | Cambio | Compatibilidad |
|---|---|---|---|
| 2026-11-02 | REST v1 y eventos v1 | Contrato inicial | Inicial |
