const { RepositorioViajes } = require('../../dominio/puertos/repositorio-viajes');

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

  async limpiar() {
    this.viajes.clear();
  }
}

module.exports = { RepositorioViajesMemoria };
