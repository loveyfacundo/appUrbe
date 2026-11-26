Cada fila contesta cuatro preguntas:

1. ¿Qué debe poder hacer el sistema?
2. ¿Qué módulo se encarga?
3. ¿Cómo vamos a probarlo?
4. ¿Qué evidencia guardaremos?

## Funciones principales

| ID | ¿Qué debe poder hacer el sistema? | Módulo | ¿Cómo lo vamos a comprobar? | Evidencia |
|---|---|---|---|---|

| F-01 | Permitir que una persona inicie sesión y usar sus permisos. 
| M1 | Probar un acceso correcto, uno incorrecto y una operación sin permiso. | Pruebas de acceso |

| F-02 | Permitir que el cliente consulte su propio perfil. | M2 | Consultar el perfil propio y comprobar que no se pueda ver el de otra persona. | Prueba del endpoint |

| F-03 | Permitir que un conductor informe si está disponible. | M3 / M4 | Probar disponibilidad válida, inválida y vencida. | Pruebas de disponibilidad |

| F-04 | Mostrar una estimación del precio antes de crear el viaje y crearlo solo si el pasajero confirma. | M5 / M6 / M7 | Consultar una estimación; comprobar que sin confirmación no se cree el viaje y que al confirmar sí se cree. | Pruebas del recorrido y de la estimación |

| F-05 | Asignar un solo conductor a cada viaje. | M4 / M5 / M6 | Dos aceptaciones concurrentes contra PostgreSQL; solo una actualiza el viaje y la otra recibe 409. | Prueba `tests/concurrencia/postgres-asignacion.test.js`, evento `DriverAssigned` y medición de `docs/mediciones.md` |
| F-06 | Permitir que el conductor asignado inicie y termine el viaje. | M6 | Probar el orden correcto, idempotencia y rechazar acciones de otro conductor o fuera de orden. | Pruebas de estados, permisos y eventos `TripStarted` / `TripCompleted` |

| F-07 | Cancelar viajes según actor/estado, guardar motivo y penalidad, y limitar cancelaciones repetidas con bloqueo temporal. | M6 / M9 | Probar reglas por estado/actor, reintento idempotente, límites y carreras reales en PostgreSQL contra llegada e inicio. | Migración `009-cancelaciones-penalidades.sql`, pruebas de casos de uso y `tests/concurrencia/postgres-asignacion.test.js` |

| F-08 | Calcular la estimación y el monto final en el servidor, con la misma función y usando distancia, tiempo y parámetros configurados. | M7 | Probar la tarifa normal, distancia cero, máximo y máximo excedido; verificar el monto emitido al completar y documentar por qué puede diferir de la estimación. | `servicios/tarifas/tests/tarifas.test.js`, `servicios/viajes/tests/http.test.js`, [tarifas](./tarifas.md)

| F-09 | Avisar al usuario sobre cambios importantes. | M8 | Probar el envío y qué ocurre si el servicio de avisos falla. | Resultado de la prueba |

| F-10 | Empezar a buscar conductor apenas se crea el viaje confirmado. | M5 / M4 / M6 | Comprobar que la búsqueda empieza después de la confirmación, sin esperar una fecha futura. | Prueba del recorrido |

| F-11 | Informar el resultado del pago y permitir calificar un viaje terminado. | M7 / M8 / módulo de calificaciones por definir | Probar el aviso del resultado y que solo se pueda calificar un viaje terminado, según las reglas acordadas. | Pruebas de integración |
| F-12 | Vencer una oferta al conductor si no responde y ofrecer el viaje al siguiente candidato. | M5 | Probar el vencimiento dentro del plazo configurable (15–30 segundos), incluso si se cierra el cliente; probar aceptación y agotamiento de candidatos. | `servicios/asignacion/tests/ofertas.test.js`, [ofertas](./ofertas.md) |
| F-13 | Enviar al pasajero y al conductor autorizado el estado del viaje y la posición en tiempo real. | M4 / M6 | Probar autorización, actualizaciones y recuperación de una instantánea actual tras cortar y restablecer la conexión. | `servicios/viajes/tests/http.test.js`, [ADR 005](./adr/005-Seguimiento-SSE.md) |

## Requisitos generales del proyecto

| ID | ¿Qué debemos cuidar? | ¿Cómo lo vamos a comprobar? | Evidencia |

| G-01 | Cada módulo debe modificar sus propios datos. | Revisar el diseño y comprobar que ningún módulo acceda directamente a los datos de otro. 

| G-02 | Los viajes deben seguir los estados acordados. | Probar los cambios de estado permitidos y rechazar los demás. | Tabla de estados y pruebas |

| G-03 | Repetir una operación importante no debe duplicar el resultado. | Repetir solicitudes, asignaciones y pagos. | Pruebas de repetición, claves de 24 horas y deduplicación de consumidores por `eventId` |

| G-04 | Los datos que recibe el sistema deben validarse. | Probar campos faltantes o con formato incorrecto. | Pruebas de validación |

| G-05 | Los módulos deben acordar cómo intercambian información. | Revisar las especificaciones de APIs y mensajes antes de integrarlos. | Contratos y pruebas |

| G-06 | Los errores de otros servicios deben ser visibles y controlados. | Simular un servicio caído, demorado o con una respuesta incorrecta. | Pruebas y registro del resultado |

| G-07 | Debe poder seguirse una operación entre módulos. | Ejecutar un recorrido y revisar que sus registros se puedan relacionar. | Logs de prueba, sin contraseñas ni datos sensibles |

| G-08 | El programa debe poder ejecutarse y probarse siguiendo instrucciones. | Seguir el README desde un entorno limpio. | README y resultados |

| G-09 | Los dos integrantes deben participar y poder explicar el trabajo. | Revisar cambios, Pull Requests y pruebas realizados por ambos. | Historial del repositorio |
