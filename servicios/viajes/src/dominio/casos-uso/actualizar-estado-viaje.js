const {
  ErrorDeValidacion,
  OperacionNoPermitida,
  RecursoNoEncontrado
} = require('../errores/errores');
const { ESTADOS } = require('../entidades/viaje');

const ESTADOS_OPERATIVOS = new Set([
  ESTADOS.EN_ORIGEN,
  ESTADOS.EN_CURSO,
  ESTADOS.FINALIZADO
]);

class ActualizarEstadoViaje {
  constructor({ repositorio, publicador }) {
    this.repositorio = repositorio;
    this.publicador = publicador;
  }

  async ejecutar({ identificadorViaje, actor, estado, idCorrelacion }) {
    if (!ESTADOS_OPERATIVOS.has(estado)) {
      throw new ErrorDeValidacion('estado no es una transición operativa válida');
    }
    const viaje = await this.repositorio.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    if (viaje.conductorId !== actor?.identificador) {
      throw new OperacionNoPermitida('Solo el conductor asignado puede actualizar el estado');
    }

    if (estado === ESTADOS.EN_ORIGEN) viaje.llegarAlOrigen(actor.identificador);
    if (estado === ESTADOS.EN_CURSO) viaje.iniciarEnCurso(actor.identificador);
    if (estado === ESTADOS.FINALIZADO) viaje.finalizar(actor.identificador);
    await this.repositorio.guardar(viaje);

    const tipoEvento = estado === ESTADOS.FINALIZADO ? 'TripCompleted' : 'TripStarted';
    await this.publicador.publicar(tipoEvento, {
      tripId: viaje.identificador,
      driverId: viaje.conductorId,
      status: viaje.estado,
      ...(estado === ESTADOS.EN_CURSO ? { startedAt: viaje.actualizadoEn } : {}),
      ...(estado === ESTADOS.FINALIZADO ? { completedAt: viaje.actualizadoEn } : {})
    }, { idCorrelacion });
    return viaje.toJSON();
  }
}

module.exports = { ActualizarEstadoViaje };
