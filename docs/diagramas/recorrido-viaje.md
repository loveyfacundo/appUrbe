# Recorrido completo de un viaje inmediato

El pasajero primero consulta cuánto costaría el viaje. Solo si acepta la estimación se crea el viaje y empieza la búsqueda de conductor.

## El recorrido, paso a paso

| Paso | ¿Qué pasa? | Quién participa |

| 1 | El pasajero inicia sesión e indica origen y destino. | M1 - Identidad y Acceso |
| 2 | Solicita una estimación del precio. El servidor calcula el monto usando la distancia, el tiempo estimado y los parámetros tarifarios configurados. | M7 - Tarifas y Pagos |
| 3 | AppUrbe muestra la estimación. Si el pasajero no la acepta, no se crea el viaje. | AppUrbe / pasajero |
| 4 | El pasajero acepta y confirma; entonces se registra el viaje. | M5 - Solicitud y Despacho / M6 - Viajes |
| 5 | Empieza la búsqueda de conductores disponibles. Se ofrece el viaje a un candidato por vez. | M4 - Ubicación y Disponibilidad / M5 - Solicitud y Despacho |
| 6 | Cada oferta tiene un tiempo límite de aceptación. Si vence sin respuesta, se ofrece al siguiente candidato. | M5 - Solicitud y Despacho |
| 7 | Si un conductor acepta a tiempo, queda asignado al viaje. | Conductor / M5 - Solicitud y Despacho / M6 - Viajes |
| 8 | El pasajero recibe en tiempo real los cambios de estado y la posición del conductor. | M4 / M6 |
| 9 | El conductor inicia y termina el viaje. El servidor vuelve a calcular la tarifa con la misma función usada para la estimación, esta vez con distancia y tiempo reales. | M6 - Viajes / M7 - Tarifas y Pagos |
| 10 | Se informa el monto final y se explica cualquier diferencia con la estimación; después se procesa el pago. | M7 - Tarifas y Pagos |
| 11 | Se informa el resultado del pago y el pasajero puede calificar el viaje. | M8 - Notificaciones / módulo de calificaciones por definir |

```text
Iniciar sesión e indicar origen/destino
        ↓
Calcular y mostrar estimación
        ↓
El pasajero acepta
        ↓
Crear viaje y empezar a buscar conductor
        ↓
Ofrecer al siguiente candidato si una oferta vence
        ↓
Asignar conductor
        ↓
Compartir estado y posición en tiempo real
        ↓
Realizar y finalizar el viaje
        ↓
Calcular monto final, explicar diferencias y procesar pago
        ↓
Informar resultado y permitir calificar
```

## Cómo se calcula la tarifa

La tarifa se calcula en el servidor, a partir de:

- La distancia.
- El tiempo.
- Los parámetros tarifarios configurados.

La estimación previa y el cálculo final usan la misma función de cálculo.
Para la estimación se usan la distancia y el tiempo previstos; al finalizar se
usan los datos reales del recorrido. Si el monto final cambia, el sistema debe
explicar la diferencia (por ejemplo, porque el recorrido real fue distinto).

Los valores concretos de los parámetros y el máximo permitido deben quedar
configurados y documentados; no se fijan en este diagrama.

## Ofertas a conductores

- Cada oferta debe tener un vencimiento. El PDF sugiere un plazo de entre 15 y
  30 segundos; esta implementación usa 20 segundos.
- Si el conductor no responde antes del vencimiento, el servidor cierra esa
  oferta y la envía al siguiente candidato.
- El vencimiento debe ocurrir aunque el conductor haya cerrado la aplicación;
  no puede depender de que el teléfono avise que dejó de responder.
- Si se agotan los candidatos, el viaje pasa al estado `NO_DRIVERS_AVAILABLE`
  y se informa al pasajero.

## Estados propuestos para el viaje

| Estado | Significado |
|---|---|
| `REQUESTED` | El pasajero aceptó la estimación y se creó el viaje. |
| `DISPATCHING` | Se están ofreciendo viajes a conductores disponibles. |
| `ASSIGNED` | Un conductor aceptó dentro del tiempo permitido. |
| `DRIVER_ARRIVING` | El conductor está llegando al punto de encuentro. |
| `IN_PROGRESS` | El viaje está en curso. |
| `COMPLETED` | El viaje terminó. |
| `NO_DRIVERS_AVAILABLE` | Se agotaron los candidatos sin encontrar conductor. |
| `CANCELLED` | El viaje se canceló según las reglas acordadas. |

Recorrido normal:

```text
REQUESTED → DISPATCHING → ASSIGNED → DRIVER_ARRIVING → IN_PROGRESS → COMPLETED
                                  ↘ NO_DRIVERS_AVAILABLE
```

## Actualizaciones en tiempo real

**Propuesta:** usar Server-Sent Events (SSE) para enviar al pasajero cambios
de estado y posiciones del conductor. En este recorrido el pasajero
principalmente recibe actualizaciones; sus acciones (solicitar, cancelar o
consultar) pueden seguir usando HTTP. La elección final debe justificarse en
la decisión de arquitectura.

Si se corta la conexión, el cliente debe volver a conectarse y pedir al
servidor el estado actual del viaje y la última posición disponible. Así puede
ponerse al día aunque se haya perdido algún evento mientras estaba desconectado.

## Casos que deben probarse

- No se crea el viaje ni se busca conductor si el pasajero no confirma la estimación.
- Estimación y monto final usan la misma función de cálculo.
- La tarifa se calcula en el servidor con distancia, tiempo y parámetros configurados.
- Se prueba un viaje de distancia cero y uno que supera el máximo permitido.
- La diferencia entre estimación y monto final se explica cuando corresponda.
- Una oferta vence dentro del plazo configurado aunque la aplicación del
  conductor esté cerrada, y se ofrece al siguiente candidato.
- Si no quedan candidatos, el viaje queda en `NO_DRIVERS_AVAILABLE`.
- Solo un conductor queda asignado al viaje.
- Si se pierde SSE, al reconectarse el pasajero puede recuperar el estado actual y la posición más reciente.
- Solo el conductor asignado puede iniciar y terminar el viaje.
- Reintentar una operación no duplica el viaje ni el pago.
