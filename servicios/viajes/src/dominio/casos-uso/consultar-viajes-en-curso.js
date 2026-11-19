const { OperacionNoPermitida } = require('../errores/errores');

class ConsultarViajesEnCurso {
  constructor({ repositorio }) {
    this.repositorio = repositorio;
  }

  async ejecutar({ actor }) {
    if (!actor?.roles?.includes('operador')) throw new OperacionNoPermitida();
    return this.repositorio.buscarEnCurso();
  }
}

module.exports = { ConsultarViajesEnCurso };
