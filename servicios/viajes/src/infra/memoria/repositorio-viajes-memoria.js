const { RepositorioViajes } = require('../../dominio/puertos/repositorio-viajes');
const {
  RecursoNoEncontrado,
  OperacionNoPermitida
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
    viaje.asignar(conductorId);
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
