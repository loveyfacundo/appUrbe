const { RecursoNoEncontrado, OperacionNoPermitida } = require('../errores/errores');

class ObtenerViaje {
  constructor({ repositorio }) {
    this.repositorio = repositorio;
  }

  async ejecutar({ identificadorViaje, actor }) {
    const viaje = await this.repositorio.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    const autorizado = actor?.identificador === viaje.pasajeroId ||
      actor?.identificador === viaje.conductorId ||
      actor?.roles?.includes('operador');
    if (!autorizado) throw new OperacionNoPermitida();
    return viaje.toJSON();
  }
}

module.exports = { ObtenerViaje };
