# Usamos PostgreSQL con SQL parametrizado dentro de repositorios

- **Estado:** Aceptado
- **Fecha:** 30/10/2026
- **Participantes:** Lovey Facundo y Vernengo Hipólito

## Contexto

AppUrbe necesita dejar de guardar los viajes en memoria. Si el servidor se
reinicia, no queremos perder los viajes, las claves de idempotencia ni los
datos que después van a necesitar los demás módulos.

La base elegida para el proyecto es PostgreSQL porque necesitamos guardar datos
relacionados, aplicar restricciones y trabajar con transacciones. También
necesitamos controlar casos donde dos conductores intenten aceptar el mismo
viaje o donde se repita un pago.

Además, cada servicio debe ser dueño de sus propios datos. El dominio no debe
conocer detalles de PostgreSQL y un servicio no debe consultar directamente
las tablas de otro. Por eso el acceso a la base va a quedar detrás de
repositorios y puertos, siguiendo la estructura que ya usamos en el proyecto.

La decisión que falta tomar es cómo escribir las consultas:

- SQL directo.
- Un query builder.
- Un ORM.

## Opciones consideradas

### Opción A: SQL directo con `pg`

Escribir las consultas SQL dentro de los adaptadores de infraestructura y usar
parámetros, por ejemplo `$1`, `$2` y `$3`. Los casos de uso seguirían hablando
con repositorios y no con el driver.

**Ventajas:**

- Se entiende exactamente qué consulta se ejecuta.
- Permite usar fácilmente transacciones, `SELECT ... FOR UPDATE`,
  restricciones e índices.
- Ayuda a demostrar la concurrencia y la propiedad de datos en la defensa.
- Tiene pocas capas adicionales y es adecuado para el tamaño actual del
  proyecto.
- Evita que una consulta importante dependa de cómo un ORM interpreta una
  operación.

**Desventajas:**

- Hay que escribir más código repetido.
- Tenemos que cuidar manualmente los nombres de columnas y las conversiones
  entre filas y entidades.
- Las migraciones y cambios de esquema requieren disciplina.
- Si no usamos parámetros correctamente, podríamos introducir inyección SQL.

### Opción B: query builder

Usar una biblioteca que arme consultas SQL sin escribir todo el SQL a mano,
pero manteniendo una relación bastante cercana con las tablas.

**Ventajas:**

- Reduce parte de la repetición al construir filtros, inserciones y
  actualizaciones.
- Sigue permitiendo escribir consultas complejas cuando hace falta.
- Puede ayudar a mantener consultas más consistentes entre repositorios.

**Desventajas:**

- Agrega una dependencia y otra forma de aprender la misma consulta.
- Las consultas generadas pueden no ser tan evidentes cuando hay problemas de
  rendimiento o concurrencia.
- Para un proyecto de dos personas, tenemos que acordar más convenciones.
- No elimina la necesidad de entender SQL, transacciones e índices.

### Opción C: ORM

Usar un ORM para representar tablas como modelos y hacer la mayoría de las
operaciones mediante métodos del ORM.

**Ventajas:**

- Reduce bastante el código de las operaciones CRUD.
- Puede facilitar relaciones, validaciones y migraciones en proyectos grandes.
- Permite trabajar con objetos conocidos por la aplicación.

**Desventajas:**

- Puede ocultar consultas importantes y dificultar el análisis de
  rendimiento.
- Las transacciones, locks y actualizaciones condicionales pueden ser menos
  claras.
- Agrega más configuración y conceptos para un proyecto que todavía está
  definiendo sus módulos.
- Puede llevar a que el dominio termine dependiendo de los modelos del ORM.
- Tenemos que aprender y documentar una herramienta adicional además de
  PostgreSQL.


## Decisión
Usaremos PostgreSQL con SQL directo parametrizado mediante pg, porque permite controlar claramente las consultas, transacciones y locks. El SQL quedará en los adaptadores de src/infra/db/, mientras que los casos de uso accederán mediante puertos y repositorios.

## Consecuencias

### Lo que ganamos

- Persistencia real y datos que sobreviven a los reinicios.
- Consultas transparentes y fáciles de revisar.
- Control claro sobre transacciones y concurrencia.
- Menos dependencias y menos magia en la infraestructura.
- Una separación clara entre dominio y base de datos.
- Una explicación sencilla para la defensa: el caso de uso usa un repositorio
  y el repositorio ejecuta SQL parametrizado.

### Lo que perdemos o queda más difícil

- Tenemos que escribir y mantener más SQL.
- Los cambios de esquema requieren crear y probar migraciones.
- Debemos ocuparnos manualmente de mapear filas y entidades.
- No tendremos las comodidades automáticas de un ORM.
- Si el proyecto crece mucho, habrá que extraer helpers para evitar
  duplicación en los repositorios.

La decisión no significa que todo el proyecto tenga que usar SQL desde los
casos de uso. Justamente se mantiene el puerto para que, si más adelante
necesitamos cambiar la herramienta, el dominio no tenga que ser reescrito.

## Qué nos haría cambiar de decisión

Revisaremos esta decisión si aparece una necesidad concreta y comprobable,
como alguna de estas:

- La cantidad de modelos y consultas hace que mantener SQL repetido sea un
  problema real.
- El equipo no puede mantener las migraciones y el mapeo de filas sin
  errores.
- Una integración aprobada por la cátedra exige un query builder u ORM.
- Las mediciones comparativas muestran que una herramienta diferente permite
  cumplir mejor la meta de rendimiento o productividad sin perder el control
  de las transacciones.
- El proyecto crece lo suficiente como para justificar una capa de
  abstracción adicional.

En ese caso no se cambiará solo una parte sin documentarlo: se compararán las
alternativas, se medirán las consultas críticas y se actualizará este ADR.
