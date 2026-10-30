# Datos principales de AppUrbe

> Este documento muestra **qué información usa el sistema y cómo se relaciona**.

## ¿Qué información necesita AppUrbe?

    Usuario --> PerfilCliente
    Usuario --> PerfilConductor
    PerfilConductor -->|registra un vehículo| Vehiculo
    PerfilConductor --> Disponibilidad
    PerfilCliente --> Solicitud
    Solicitud --> Estimacion
    Estimacion --> DistanciaEstimada
    Estimacion --> TiempoEstimado
    Estimacion --> ParametrosTarifa
    Solicitud --> Viaje
    PerfilConductor --> Viaje
    Viaje --> OfertaConductor
    Viaje --> DistanciaReal
    Viaje --> TiempoReal
    Viaje --> MontoFinal
    Viaje --> Pago
    Viaje --> Calificacion
    Viaje --> Notificacion
    Viaje --> EstadoEnTiempoReal
    PerfilConductor --> Posicion


- Una persona puede tener un perfil de cliente, de conductor o ambos.
- Cada conductor tiene sus datos y puede registrar un solo vehículo.
- Antes de crear un viaje, el cliente consulta y acepta una estimación del precio.
- El servidor calcula la tarifa usando distancia, tiempo y los parámetros tarifarios configurados. La estimación y el monto final usan la misma función; para el monto final se consideran los datos reales del viaje.
- Cuando el cliente confirma, se crea el viaje y empieza la búsqueda de conductor.
- Cada oferta a un conductor tiene un plazo de aceptación. Si vence, se ofrece el viaje al siguiente candidato; si no quedan candidatos, se informa que no hay conductores disponibles.
- Durante el viaje, el pasajero recibe el estado y la posición actual del conductor. Si pierde la conexión, puede volver a consultar el estado actual.
- Al terminar el viaje se calcula el monto final, se procesa el pago y el cliente puede calificar.
- El sistema puede enviar avisos relacionados con un viaje.

La relación conductor-vehículo queda definida así: cada conductor registra un solo vehículo. Si más adelante se permite cambiarlo, habrá que definir cómo se actualiza ese dato y si el cambio necesita aprobación.

## ¿Qué módulo guarda cada dato?

| Información | Módulo responsable |

| Cuenta, acceso y rol de cada persona | M1 - Identidad y Acceso |

Perfil del cliente | M2 - Clientes 

Perfil del conductor y su vehículo registrado | M3 - Conductores y Vehículos

Ubicación y disponibilidad del conductor | M4 - Ubicación y Disponibilidad 

Búsqueda y asignación del conductor | M5 - Solicitud y Despacho 

Datos y estado del viaje | M6 - Viajes y Ciclo de Vida

Estimación, parámetros de tarifa y pago | M7 - Tarifas, Pagos y Liquidaciones

Avisos, comprobantes y soporte | M8 - Notificaciones, Documentos y Soporte 

Calificación asociada al viaje | Módulo a confirmar; propuesta inicial: M6 - Viajes 

## Datos necesarios para el viaje y la tarifa

| Dato | Para qué se usa | Módulo responsable propuesto |
|---|---|---|
| Distancia estimada y tiempo estimado | Calcular el precio que se muestra antes de confirmar | M7 - Tarifas |
| Parámetros tarifarios configurados | Aplicar las reglas de cálculo de tarifa | M7 - Tarifas |
| Distancia real y tiempo real | Calcular el monto final con la misma función que la estimación | M6 - Viajes / M7 - Tarifas |
| Plazo de aceptación de una oferta | Saber cuándo vence una oferta al conductor | M5 - Solicitud y Despacho |
| Estado actual del viaje | Informar al pasajero y permitir recuperar el estado tras reconectarse | M6 - Viajes |
| Posición actual del conductor | Mostrar su ubicación al pasajero durante el viaje | M4 - Ubicación y Disponibilidad |

El punto 6.5 del PDF pide probar la tarifa con un viaje de distancia cero y con otro que supere la distancia máxima permitida. Los valores de los parámetros y del máximo deben quedar configurados

## Reglas importantes para el diseño

1. Cada módulo actualiza sus propios datos.
2. Si un módulo necesita información de otro, la pide mediante una comunicación acordada; no entra directamente a modificar sus datos.
3. La ubicación puede quedar vieja. Hay que considerar cuándo fue informada antes de usarla para buscar conductores.
4. Una solicitud confirmada no debe crear dos viajes por un reintento o un error.
5. Repetir el procesamiento de un pago no debe cobrar dos veces.
6. Solo se comparte la información personal necesaria para cada tarea.

## Qué falta decidir

- Qué datos exactos se guardan en cada módulo.
- Qué valores tendrán los parámetros tarifarios configurados y cuál será la distancia máxima permitida.
- Qué vigencia tiene una estimación y cuándo se debe volver a calcular.
- Cómo se explica al pasajero la diferencia entre estimación y monto final.
- Qué módulo guardará las calificaciones.
- Cómo se actualiza o reemplaza el vehículo registrado por el conductor.
- Cuánto tiempo se guardan los datos.
- Qué tecnología de tiempo real se elige y cómo se recupera el estado al
  reconectarse.

No hace falta resolver ahora cómo serán las tablas de la base de datos. Eso se define cuando empiecen a implementar el módulo asignado.
