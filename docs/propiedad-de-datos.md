# Quién es responsable de cada dato

> Este documento responde una pregunta sencilla: **¿qué módulo guarda y
> actualiza cada información?**

## Regla principal

Cada módulo es responsable de sus propios datos. Por ejemplo, el módulo de
Viajes puede guardar el identificador de un conductor, pero no debe entrar a
la base de datos de Conductores para cambiar su perfil.

Si un módulo necesita información de otro, se la pide mediante una forma de
comunicación que el equipo acuerde. Así evitamos que varios módulos cambien
los mismos datos y se contradigan.


## Tabla de responsabilidades

| Información | Quién la mantiene | Quién podría necesitarla |

| Cuenta, contraseña, rol y permisos | M1 - Identidad y Acceso | Los módulos que deben comprobar quién está haciendo una operación |

| Perfil del cliente | M2 - Clientes | Viajes, reservas, pagos y notificaciones, cuando lo necesiten |

| Perfil del conductor y su vehículo registrado | M3 - Conductores y Vehículos | Disponibilidad, despacho y viajes |

| Ubicación y disponibilidad actual del conductor | M4 - Ubicación y Disponibilidad | Despacho |

| Búsqueda de conductor e intentos de asignación | M5 - Solicitud y Despacho | Viajes y reservas |

| Origen, destino y estado del viaje | M6 - Viajes y Ciclo de Vida | Cliente, despacho, pagos y notificaciones |

| Precio y registro del pago | M7 - Tarifas, Pagos y Liquidaciones | Viajes y el cliente, según permisos |

| Avisos enviados y comprobantes | M8 - Notificaciones, Documentos y Soporte | Cliente y módulos que pidieron el 
aviso |

| Fecha y estado de la reserva | M9 - Reservas de Viajes | Cliente, despacho y notificaciones |

## Ejemplo sencillo

Supongamos que un cliente pide un viaje:

1. Viajes guarda el viaje y su estado.
2. Despacho busca un conductor disponible.
3. Disponibilidad informa cuáles conductores están disponibles.
4. Cuando un conductor acepta, Viajes guarda cuál fue asignado.
5. Viajes no modifica el perfil del conductor; ese perfil sigue siendo
   responsabilidad del módulo de Conductores.

Aunque al principio varios módulos usen la misma aplicación o la misma base
de datos, deben respetar estas responsabilidades.

## Compartir solo lo necesario

Un módulo puede compartir un identificador —por ejemplo, el ID del viaje— para
que otro sepa a qué registro se refiere. No hace falta enviar todos los datos
del cliente o del conductor si el otro módulo solo necesita ese identificador.

Por ejemplo, para informar que se asignó un conductor, podría bastar con compartir:

```text
ID del viaje
ID del conductor
Fecha y hora de la asignación
```

## Dos responsabilidades que todavía hay que confirmar

- **Asignación:** propuesta inicial: Despacho coordina la búsqueda, y Viajes
  guarda el conductor asignado como parte del viaje.
- **Comprobante de pago:** propuesta inicial: Pagos conserva el registro del
  cobro; Notificaciones puede encargarse de entregar el comprobante.

También falta acordar qué datos personales necesita cada módulo y cuánto
tiempo se conservan.
