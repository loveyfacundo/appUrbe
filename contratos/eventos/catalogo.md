# Catálogo de eventos AppUrbe

## Envoltorio común

Todos los mensajes se publican en JSON con este envoltorio:

```json
{
  "eventId": "c0a80101-0000-4000-8000-000000000001",
  "eventType": "TripRequested",
  "eventVersion": 1,
  "occurredAt": "2026-11-02T21:00:00.000Z",
  "correlationId": "c0a80101-0000-4000-8000-000000000002",
  "causationId": "c0a80101-0000-4000-8000-000000000003",
  "producer": "viajes",
  "payload": {}
}
```

`eventId` permite deduplicar, `correlationId` rastrea una operación completa y
`causationId` enlaza el evento con el mensaje que lo originó. Los consumidores
deben ser idempotentes, confirmar el mensaje solo después de procesarlo y enviar
los fallos no recuperables a la dead-letter queue.

## Catálogo

| Evento | Productor | Routing key | Consumidores | Payload |
|---|---|---|---|---|
| `TripRequested` | viajes | `trip.requested.v1` | asignacion, notificaciones | [TripRequested.json](./schemas/TripRequested.json) |
| `DriverAssigned` | asignacion | `trip.driver-assigned.v1` | viajes, notificaciones | [DriverAssigned.json](./schemas/DriverAssigned.json) |
| `TripStarted` | viajes | `trip.started.v1` | pagos, notificaciones | [TripStarted.json](./schemas/TripStarted.json) |
| `TripCompleted` | viajes | `trip.completed.v1` | pagos, notificaciones | [TripCompleted.json](./schemas/TripCompleted.json) |
| `TripCancelled` | viajes | `trip.cancelled.v1` | pagos, notificaciones, asignacion | [TripCancelled.json](./schemas/TripCancelled.json) |
| `ReservationCreated` | reservas | `reservation.created.v1` | viajes, notificaciones | [ReservationCreated.json](./schemas/ReservationCreated.json) |
| `ReservationActivated` | reservas | `reservation.activated.v1` | viajes, notificaciones | [ReservationActivated.json](./schemas/ReservationActivated.json) |
| `PaymentRequested` | pagos | `payment.requested.v1` | proveedor de pagos, notificaciones | [PaymentRequested.json](./schemas/PaymentRequested.json) |
| `PaymentCaptured` | pagos | `payment.captured.v1` | viajes, notificaciones | [PaymentCaptured.json](./schemas/PaymentCaptured.json) |
| `NotificationRequested` | notificaciones | `notification.requested.v1` | proveedor de notificaciones | [NotificationRequested.json](./schemas/NotificationRequested.json) |

El transporte acordado es RabbitMQ. Cada consumidor tiene su propia cola
durable; las publicaciones usan confirmación del broker y mensajes
persistent. Un evento puede procesarse fuera de orden: el consumidor debe
validar el estado actual y no retroceder una transición ya aplicada.
