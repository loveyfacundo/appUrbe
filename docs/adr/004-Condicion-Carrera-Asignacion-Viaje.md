# Usamos una actualización atómica para evitar la doble asignación de un viaje

- **Estado:** Aceptado
- **Fecha:** 03/11/2026
- **Participantes:** Lovey Facundo y Vernengo Hipólito

## Contexto

La condición de carrera principal del proyecto aparece cuando dos conductores
aceptan el mismo viaje casi al mismo tiempo. Si el sistema primero consulta que
el viaje está disponible y después lo actualiza sin protección, los dos
conductores podrían quedar asignados al mismo viaje.

Esto no se puede resolver solamente desde el frontend, porque las dos
solicitudes pueden llegar al servidor en paralelo. La asignación debe ser
atómica y funcionar también cuando hay varias instancias del servicio.

## Opciones consideradas

### Opción A: consultar y actualizar en dos pasos

Primero se consulta el viaje y después se actualiza con el conductor elegido.

**Ventajas:**

- Es fácil de implementar.
- Requiere poco código.

**Desventajas:**

- Dos solicitudes pueden leer el mismo estado disponible.
- No evita que se sobrescriban asignaciones.
- No sirve para garantizar la regla de un solo conductor.

### Opción B: bloqueo pesimista de la fila

Abrir una transacción, bloquear la fila del viaje con `SELECT ... FOR UPDATE`,
comprobar que siga disponible y asignar el conductor antes de confirmar la
transacción.

**Ventajas:**

- Una sola solicitud puede modificar el viaje a la vez.
- La validación y la asignación quedan dentro de la misma transacción.
- Es fácil de relacionar con la regla de negocio.

**Desventajas:**

- Las solicitudes concurrentes pueden quedar esperando el bloqueo.
- Hay que controlar los timeouts y evitar transacciones demasiado largas.
- Depende de usar correctamente la misma conexión durante toda la
  transacción.

### Opción C: actualización condicional

Actualizar el viaje solamente si todavía está disponible, por ejemplo:

```sql
UPDATE viajes
SET conductor_id = $1, estado = 'ASSIGNED'
WHERE id = $2 AND estado = 'DISPATCHING' AND conductor_id IS NULL
RETURNING *;
```

Si la consulta no devuelve ninguna fila, otro conductor ganó la asignación.

**Ventajas:**

- La operación es atómica en PostgreSQL.
- Mantiene la transacción corta.
- Es eficiente para muchas solicitudes concurrentes.
- No hace falta leer el viaje antes de intentar asignarlo.

**Desventajas:**

- Hay que interpretar correctamente el resultado vacío.
- Las reglas de asignación deben quedar reflejadas en la condición SQL.
- Si la operación también modifica otros datos, puede necesitar una
  transacción más amplia.

## Decisión

Usaremos una **actualización condicional y atómica en PostgreSQL** para asignar
un conductor: solo la primera solicitud que encuentre el viaje disponible podrá
modificarlo a `ASSIGNED`. Si otra solicitud llega después, recibirá un conflicto
de estado y no cambiará el viaje.

## Consecuencias

### Lo que ganamos

- Se evita que dos conductores queden asignados al mismo viaje.
- La regla funciona aunque las solicitudes lleguen al mismo tiempo.
- La operación es compatible con varias instancias del servicio.
- Se reduce el tiempo durante el que la base debe mantener bloqueos.
- El resultado se puede probar con dos solicitudes concurrentes.

### Lo que perdemos o queda más difícil

- El repositorio debe distinguir entre una asignación exitosa y una fila no
  actualizada.
- Hay que devolver un error de conflicto cuando otro conductor ganó.
- Si la asignación modifica más de una tabla, será necesario agregar una
  transacción.
- La prueba de concurrencia requiere una base real y no solamente el
  repositorio en memoria.

## Qué nos haría cambiar de decisión

Revisaremos esta decisión si la asignación necesita modificar varias entidades
de forma inseparable o si las pruebas de carga muestran que la actualización
condicional no alcanza la meta de rendimiento. En ese caso evaluaríamos una
transacción con bloqueo pesimista, un lock distribuido con Redis o una
estrategia equivalente, siempre manteniendo una única asignación válida.
