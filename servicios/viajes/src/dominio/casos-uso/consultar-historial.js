const { OperacionNoPermitida } = require('../errores/errores');
const { esChofer } = require('../actores');

class ConsultarHistorial {
  constructor({ repositorio }) {
    this.repositorio = repositorio;
  }

  async ejecutar({ actor, filtro }) {
    if (!actor?.identificador) throw new OperacionNoPermitida();
    if (filtro === 'pasajero') {
      return this.repositorio.buscarHistorialPasajero(actor.identificador);
    }
    if (filtro === 'conductor') {
      if (!esChofer(actor)) throw new OperacionNoPermitida();
      return this.repositorio.buscarHistorialConductor(actor.identificador);
    }
    throw new OperacionNoPermitida('Filtro de historial no permitido');
  }
}

module.exports = { ConsultarHistorial };
