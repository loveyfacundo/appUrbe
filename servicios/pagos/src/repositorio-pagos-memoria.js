class RepositorioPagosMemoria {
  constructor() {
    this.cobros = new Map();
  }

  async guardar(cobro) {
    this.cobros.set(cobro.tripId, cobro);
  }

  async buscarPorViaje(tripId) {
    return this.cobros.get(tripId) || null;
  }
}

module.exports = { RepositorioPagosMemoria };
