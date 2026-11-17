const { performance } = require('node:perf_hooks');
const {
  ErrorDeValidacion,
  OperacionNoPermitida,
  ConflictoDeEstado
} = require('../errores/errores');
const { validarUuid } = require('../entidades/viaje');

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
    validarUuid(identificadorViaje, 'tripId');
    if (!actor || !Array.isArray(actor.roles) || !actor.roles.includes('conductor')) {
      throw new OperacionNoPermitida('Solo un conductor puede aceptar una asignación');
    }
    validarUuid(actor.identificador, 'actor.identificador');
    if (!claveIdempotencia || !idCorrelacion) {
      throw new ErrorDeValidacion('claveIdempotencia e idCorrelacion son obligatorios');
    }

    const clave = `${actor.identificador}:${claveIdempotencia}`;
    const huella = JSON.stringify({ identificadorViaje, conductorId: actor.identificador });
    return this.bloqueador.ejecutar(`idempotencia:${clave}`, async () => {
      const inicio = performance.now();
      try {
        const anterior = await this.idempotencia.buscar(clave);
        if (anterior) {
          if (anterior.huella !== huella) {
            throw new ConflictoDeEstado('La clave de idempotencia fue reutilizada con otro request');
          }
          return anterior.respuesta;
        }

        const evento = this.publicador.crearEvento('DriverAssigned', {
          tripId: identificadorViaje,
          driverId: actor.identificador
        }, { idCorrelacion });
        const viaje = await this.repositorio.asignarConductor({
          identificadorViaje,
          conductorId: actor.identificador,
          evento: this.repositorio.persisteOutbox ? evento : undefined,
          idempotencia: this.repositorio.persisteOutbox ? {
            clave,
            huella,
            tiempoVidaMs: this.idempotencia.tiempoVidaMs
          } : undefined
        });
        const respuesta = viaje.toJSON();
        if (!this.repositorio.persisteOutbox) await this.publicador.publicar(evento);
        await this.idempotencia.guardar(clave, huella, respuesta);
        return respuesta;
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
