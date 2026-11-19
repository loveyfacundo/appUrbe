const { RepositorioViajes } = require('../../dominio/puertos/repositorio-viajes');
const {
  RecursoNoEncontrado,
  OperacionNoPermitida,
  ConflictoDeEstado
} = require('../../dominio/errores/errores');
const { ESTADOS } = require('../../dominio/entidades/viaje');

class RepositorioViajesMemoria extends RepositorioViajes {
  constructor() {
    super();
    this.viajes = new Map();
  }

  async guardar(viaje) {
    this.viajes.set(viaje.identificador, viaje);
    return viaje;
  }

  async buscarPorId(id) {
    return this.viajes.get(id) || null;
  }

  async asignarConductor({ identificadorViaje, conductorId }) {
    const viaje = await this.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    const ocupado = [...this.viajes.values()].some((otro) =>
      otro.conductorId === conductorId &&
      [ESTADOS.ASIGNADO, ESTADOS.EN_ORIGEN, ESTADOS.EN_CURSO].includes(otro.estado)
    );
    if (ocupado) {
      throw new ConflictoDeEstado('El conductor ya tiene un viaje activo');
    }
    viaje.asignar(conductorId);
    return this.guardar(viaje);
  }

  async cancelarViaje({ identificadorViaje, actorId, operadorAutorizado = false }) {
    const viaje = await this.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    if (viaje.pasajeroId !== actorId && !operadorAutorizado) {
      throw new OperacionNoPermitida();
    }
    if (viaje.conductorId || ![ESTADOS.SOLICITADO, ESTADOS.DESPACHANDO].includes(viaje.estado)) {
      throw new ConflictoDeEstado('El viaje ya fue asignado o no admite cancelación');
    }
    viaje.cancelar();
    return this.guardar(viaje);
  }

  async actualizarEstadoOperativo({ identificadorViaje, actorId, estado }) {
    const viaje = await this.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    if (viaje.conductorId !== actorId) {
      throw new OperacionNoPermitida('Solo el conductor asignado puede actualizar el estado');
    }
    if (estado === ESTADOS.EN_ORIGEN) viaje.llegarAlOrigen(actorId);
    if (estado === ESTADOS.EN_CURSO) viaje.iniciarEnCurso(actorId);
    if (estado === ESTADOS.FINALIZADO) viaje.finalizar(actorId);
    return this.guardar(viaje);
  }

  async limpiar() {
    this.viajes.clear();
  }
}

module.exports = { RepositorioViajesMemoria };
