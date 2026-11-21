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

## Persistencia de Identidad y Conductores

Cuando la aplicación se ejecuta con `DATABASE_URL`, Identidad persiste las
cuentas en `usuarios`, y Conductores persiste perfiles, vehículos y
ubicaciones en `conductores`, `vehiculos` y `ubicaciones`. La aplicación
comparte el pool PostgreSQL existente, pero cada módulo escribe únicamente sus
propios datos. Las migraciones `002-esquema-plataforma.sql` y
`006-identidad-flota-ubicacion.sql` preparan esas tablas y los roles.

Sin `DATABASE_URL`, los módulos usan repositorios en memoria para pruebas
aisladas; esos datos son temporales y se pierden al reiniciar. Docker Compose
configura `DATABASE_URL` para el servicio de la aplicación.

Para ejecutar la aplicación con persistencia y poder iniciar sesión, también
se debe configurar `JWT_SECRET` en el entorno de Docker Compose. No debe
quedar vacío ni usarse un secreto público de ejemplo.

### Alta inicial segura de administrador

Para instrucciones reproducibles de bootstrap, consultar la
[guía de alta inicial de administrador](./guia-alta-inicial-administrador.md).

El registro público solo acepta pasajeros y choferes. Para crear el primer
administrador, definir `JWT_SECRET` y `IDENTITY_BOOTSTRAP_TOKEN` en el archivo
`.env` local (no versionarlo) y recrear la aplicación:

```powershell
$jwtSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$bootstrapToken = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up -d --build app
```

Guardar esos valores en el `.env` ignorado por Git y seguir la guía enlazada
arriba para llamar al endpoint y retirar el token de bootstrap tras el alta.

Enviar una sola vez `POST /api/v1/identidad/bootstrap/administrador` con
`X-Bootstrap-Token`, `X-Correlation-Id` (UUID) y el JSON
`{"name":"Administrador","email":"admin@example.com","password":"..."}`
. La respuesta incluye el token Bearer para iniciar sesión. La base serializa
el alta y rechaza intentos posteriores; conservar `JWT_SECRET` para que los
tokens emitidos sigan siendo verificables y eliminar el token de bootstrap del
entorno después de usarlo. La lista de conductores disponibles requiere rol de
administrador/operador o el permiso `drivers:read:available`; un chofer puede
consultar únicamente su propio estado de habilitación.

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
