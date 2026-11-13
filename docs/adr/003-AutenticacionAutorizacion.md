# Usamos JWT para autenticar a los actores y verificar permisos por recurso

- **Estado:** Aceptado
- **Fecha:** 31/10/2026
- **Participantes:** Lovey Facundo y Vernengo Hipólito.

## Contexto

AppUrbe es un trabajo práctico realizado por dos estudiantes. El objetivo
principal es construir y poder defender un backend con Node.js y Express que
cumpla los requisitos de la materia: contratos REST, persistencia, pruebas,
contenedores, seguridad, concurrencia e integración con servicios auxiliares.

Para que el sistema sea seguro y pueda explicar cómo se protege el acceso a los
recursos, necesitamos definir una política clara de autenticación y autorización.
El proyecto tiene varios actores con permisos distintos: pasajero, conductor,
operador y servicios internos.

Cada tipo de usuario no puede hacer lo mismo. Por ejemplo:

- un pasajero solo puede consultar o cancelar su propio viaje
- un conductor solo puede acceder a la información del pasajero asignado
- un operador necesita permisos específicos para operaciones más sensibles

El proyecto ya avanza con una capa de autenticación y validación de acceso en el
módulo de viajes, pero necesitamos dejar documentada la decisión y sus
alternativas para que quede clara la justificación técnica.

La implementación actual está distribuida así:

- el middleware JWT está en `servicios/viajes/src/infra/http/middlewares/autenticacion-jwt.js`
- las rutas protegidas están en `servicios/viajes/src/infra/http/rutas/viajes.js`
- la autorización por recurso se verifica en `servicios/viajes/src/dominio/casos-uso/obtener-viaje.js` y `servicios/viajes/src/dominio/casos-uso/cancelar-viaje.js`
- las pruebas están en `servicios/viajes/tests/http.test.js`

## Opciones consideradas

### Opción A: JWT stateless

**Ventajas:**

- El backend no necesita mantener una sesión en memoria ni un estado global por
  usuario.
- Funciona bien con una API REST simple y con servicios desacoplados.
- Permite incluir en el token identidad, roles y permisos específicos.
- Es sencillo de validar con una firma HMAC compartida.
- Encaja con la estructura actual del proyecto y con las pruebas automatizadas.

**Desventajas:**

- Hay que manejar bien la expiración del token y la confidencialidad del secreto.
- La revocación inmediata no es tan directa como en una sesión centralizada.
- El token no decide solo por sí mismo si un usuario puede acceder a un recurso
  concreto; la validación por recurso sigue siendo responsabilidad del backend.

### Opción B: sesiones en servidor

**Ventajas:**

- El servidor tiene control explícito sobre la sesión activa.
- La invalidación de una sesión puede ser más directa.
- Es clara cuando se quiere mantener un registro centralizado del acceso.

**Desventajas:**

- Requiere almacenamiento de estado en el backend.
- Aumenta la complejidad del despliegue y la explicación del sistema.
- No encaja tan bien con una API pequeña y modular
- Hace más difícil mantener una solución simple.

### Opción C: mezclar JWT y sesiones

**Ventajas:**

- Ofrece flexibilidad en escenarios más complejos.
- Permite combinar autenticación y control de permisos dinámicos.

**Desventajas:**

- Aumenta la complejidad del diseño y de la operación.
- Genera más puntos de fallo y más decisiones que explicar.

## Decisión

Elegimos JWT firmado con HS256 para autenticar las solicitudes, porque permite validar la identidad sin mantener sesiones en el servidor y se ajusta a nuestra API REST. La autorización se verifica en los casos de uso comprobando que el actor sea dueño del recurso o tenga el permiso necesario, porque un token válido por sí solo no autoriza el acceso a todos los recursos.

## Consecuencias

### Beneficios

- Se conserva una arquitectura simple y fácil de explicar.
- No se requiere un estado de sesión en memoria ni un sistema de cache extra.
- Las pruebas pueden generar tokens firmados sin depender de una base externa.
- La diferencia entre identidad y permisos queda explícita.
- Se adapta bien al estilo del proyecto y a la forma de evaluar el TP.

### Costos y dificultades

- Debemos cuidar muy bien la expiración del token y la confidencialidad del
  secreto.
- La revocación inmediata de tokens requiere una política adicional.
- La validación por recurso sigue teniendo que hacerse en el dominio y no solo
  en el header HTTP.
- Debemos mantener un modelo claro de `roles` y `permissions` para no mezclar
  conceptos.

## Qué nos haría cambiar de decisión

- La cátedra exige explícitamente sesiones del lado del servidor.
- La aplicación requiere revocación inmediata de muchos tokens.
- El sistema necesita un modelo de permisos mucho más dinámico del que puede
  manejar un JWT simple.
- El equipo decide centralizar la autenticación en un servicio de identidad con
  una política distinta.

Si eso ocurre, haremos una nueva ADR y una migración completa, probada y
documentada.
