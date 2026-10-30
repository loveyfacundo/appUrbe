## Actores

Cliente / pasajero : Gestionar su perfil, solicitar o reservar un viaje, consultar su estado y recibir avisos. 

Conductor: Mantener sus datos y disponibilidad, aceptar servicios y actualizar el viaje. 

Operador: Consultar y asistir operaciones según los permisos que se definan. 

Sistema: Despachar solicitudes, activar reservas, procesar pagos y emitir notificaciones. |

## Límites funcionales propuestos

| Módulo | Responsabilidad |

M1 - Identidad y Acceso: Autenticar usuarios y resolver permisos y roles. 

M2 - Clientes: Mantener el perfil y los datos propios del pasajero. 

M3 - Conductores y Vehículos : Mantener perfiles de conductores, vehículos y su estado administrativo. 

M4 - Ubicación y Disponibilidad: Mantener ubicación y disponibilidad temporal de conductores. 

M5 - Solicitud y Despacho: Recibir solicitudes y coordinar la búsqueda y asignación de un conductor. 

M6 - Viajes y Ciclo de Vida: Mantener el viaje y validar sus transiciones de estado. 

M7 - Tarifas, Pagos y Liquidaciones: Estimar/calcular tarifas y gestionar cobros y liquidaciones. 

M8 - Notificaciones, Documentos y Soporte: Enviar avisos, administrar comprobantes y atender soporte. 

M9 - Reservas de Viajes: Crear y confirmar reservas futuras y activarlas cuando corresponda. 

## Contexto general

    Cliente -->|perfil, solicitud, reserva y consultas| Plataforma
    Conductor -->|disponibilidad y acciones del viaje| Plataforma
    Operador -->|consultas y soporte autorizado| Plataforma
    Plataforma -->|estado, avisos y comprobantes| Cliente
    Plataforma -->|solicitudes y cambios de estado| Conductor
    Plataforma <-->|API o eventos acordados| Externos


## Mapa de módulos

    M1 [Identidad y Acceso]
    M2 [Clientes]
    M3 [Conductores y Vehículos]
    M4 [Ubicación y Disponibilidad]
    M5 [Solicitud y Despacho]
    M6 [Viajes y Ciclo de Vida]
    M7 [Tarifas y Pagos]
    M8 [Notificaciones, Documentos y Soporte]
    M9 [Reservas]

## Dependencias 

    M1 --> M2
    M2 --> M5
    M3 --> M4
    M4 --> M5
    M5 --> M6
    M6 --> M7
    M6 --> M8
    M9 --> M5
    M6 --> M9
```

Las flechas son dependencias o intercambio de información a nivel conceptual,
no una definición de endpoints ni una obligación de usar comunicación
síncrona. El Paso 2 debe decidir contratos, eventos y sus versiones. Cada
módulo es dueño de sus datos y los demás consultan por una interfaz acordada.

## Recorridos que debe cubrir la plataforma

1. **Viaje inmediato:** iniciar sesión → consultar estimación → confirmar y crear el viaje → buscar conductor → realizar el viaje → pagar → recibir el resultado y calificar.
2. La búsqueda de conductor empieza después de que el pasajero confirma la estimación y se registra el viaje.

