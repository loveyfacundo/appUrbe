const { RepositorioIdempotencia } = require('../../dominio/puertos/repositorio-idempotencia');

class RepositorioIdempotenciaMemoria extends RepositorioIdempotencia {
  constructor({ tiempoVidaMs = 24 * 60 * 60 * 1000 } = {}) {
    super();
    this.tiempoVidaMs = tiempoVidaMs;
    this.operaciones = new Map();
  }

  async buscar(clave) {
    const operacion = this.operaciones.get(clave);
    if (!operacion || operacion.expiraEn <= Date.now()) {
      this.operaciones.delete(clave);
      return null;
    }
    return operacion;
  }

  async guardar(clave, huella, respuesta) {
    this.operaciones.set(clave, {
      huella,
      respuesta,
      expiraEn: Date.now() + this.tiempoVidaMs
    });
  }
}

module.exports = { RepositorioIdempotenciaMemoria };
