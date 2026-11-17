const {
  ErrorDeValidacion,
  OperacionNoPermitida,
  ConflictoDeEstado
} = require('../errores/errores');
const { ESTADOS } = require('../entidades/viaje');

const ESTADOS_OPERATIVOS = new Set([
  ESTADOS.EN_ORIGEN,
  ESTADOS.EN_CURSO,
  ESTADOS.FINALIZADO
]);

class ActualizarEstadoViaje {
  constructor({ repositorio, publicador, idempotencia, bloqueador }) {
    this.repositorio = repositorio;
    this.publicador = publicador;
    this.idempotencia = idempotencia;
    this.bloqueador = bloqueador;
  }

  async ejecutar({
    identificadorViaje,
    actor,
    estado,
    claveIdempotencia,
    idCorrelacion
  }) {
    if (!ESTADOS_OPERATIVOS.has(estado)) {
      throw new ErrorDeValidacion('estado no es una transición operativa válida');
    }
    if (!actor || !actor.roles?.includes('conductor')) {
      throw new OperacionNoPermitida('Solo el conductor asignado puede actualizar el estado');
    }
    if (!claveIdempotencia || !idCorrelacion) {
      throw new ErrorDeValidacion('claveIdempotencia e idCorrelacion son obligatorios');
    }

    const clave = `${actor.identificador}:${claveIdempotencia}`;
    const huella = JSON.stringify({ identificadorViaje, estado });
    return this.bloqueador.ejecutar(`idempotencia:${clave}`, async () => {
      const anterior = await this.idempotencia.buscar(clave);
      if (anterior) {
        if (anterior.huella !== huella) {
          throw new ConflictoDeEstado('La clave de idempotencia fue reutilizada con otro request');
        }
        return anterior.respuesta;
      }

      const datosEvento = estado === ESTADOS.EN_CURSO || estado === ESTADOS.FINALIZADO
        ? {
          tipoEvento: estado === ESTADOS.FINALIZADO ? 'TripCompleted' : 'TripStarted',
          payload: {
            tripId: identificadorViaje,
            driverId: actor.identificador,
            status: estado
          }
        }
        : null;
      const evento = datosEvento
        ? this.publicador.crearEvento(datosEvento.tipoEvento, datosEvento.payload, { idCorrelacion })
        : undefined;
      const viaje = await this.repositorio.actualizarEstadoOperativo({
        identificadorViaje,
        actorId: actor.identificador,
        estado,
        evento: this.repositorio.persisteOutbox ? evento : undefined,
        idempotencia: this.repositorio.persisteOutbox ? {
          clave,
          huella,
          tiempoVidaMs: this.idempotencia.tiempoVidaMs
        } : undefined
      });

      if (evento) {
        evento.payload.status = viaje.estado;
        if (estado === ESTADOS.EN_CURSO) evento.payload.startedAt = viaje.actualizadoEn;
        if (estado === ESTADOS.FINALIZADO) evento.payload.completedAt = viaje.actualizadoEn;
        if (!this.repositorio.persisteOutbox) await this.publicador.publicar(evento);
      }
      const respuesta = viaje.toJSON();
      await this.idempotencia.guardar(clave, huella, respuesta);
      return respuesta;
    });
  }
}

module.exports = { ActualizarEstadoViaje };
