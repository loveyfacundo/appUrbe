const {
  ErrorDeValidacion,
  OperacionNoPermitida
} = require('../errores/errores');
const {
  validarClaveYCorrelacion,
  verificarIdempotencia,
  metadataIdempotenciaOutbox,
  publicarYGuardar
} = require('./idempotencia-helper');

class AceptarAsignacion {
  constructor({ repositorio, idempotencia, publicador, bloqueador }) {
    this.repositorio = repositorio;
    this.idempotencia = idempotencia;
    this.publicador = publicador;
    this.bloqueador = bloqueador;
  }

  async ejecutar({
    identificadorViaje,
    actor,
    claveIdempotencia,
    idCorrelacion
  }) {
    if (!actor || !actor.roles?.includes('conductor')) {
      throw new OperacionNoPermitida('Solo un conductor puede aceptar viajes');
    }
    validarClaveYCorrelacion(claveIdempotencia, idCorrelacion);

    const clave = `${actor.identificador}:${claveIdempotencia}`;
    const huella = JSON.stringify({ identificadorViaje, conductorId: actor.identificador });

    return this.bloqueador.ejecutar(`viaje:${identificadorViaje}`, async () => {
      const inicio = performance.now();
      try {
        const idempotente = await verificarIdempotencia(this.idempotencia, clave, huella);
        if (idempotente.procesado) return idempotente.respuesta;

        const evento = this.publicador.crearEvento('DriverAssigned', {
          tripId: identificadorViaje,
          driverId: actor.identificador
        }, { idCorrelacion });

        const viaje = await this.repositorio.asignarConductor({
          identificadorViaje,
          conductorId: actor.identificador,
          evento: this.repositorio.persisteOutbox ? evento : undefined,
          idempotencia: metadataIdempotenciaOutbox(this.repositorio, this.idempotencia, clave, huella)
        });

        return await publicarYGuardar({
          repositorio: this.repositorio,
          publicador: this.publicador,
          idempotencia: this.idempotencia,
          evento,
          clave,
          huella,
          respuesta: viaje.toJSON()
        });
      } finally {
        console.info(JSON.stringify({
          metric: 'trip_assignment_duration_ms',
          tripId: identificadorViaje,
          correlationId: idCorrelacion,
          durationMs: Number((performance.now() - inicio).toFixed(2))
        }));
      }
    });
  }
}

module.exports = { AceptarAsignacion };
