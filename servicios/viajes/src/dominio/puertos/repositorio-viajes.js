class RepositorioViajes {
  async guardar() {
    throw new Error('RepositorioViajes.guardar debe ser implementado');
  }

  async buscarPorId() {
    throw new Error('RepositorioViajes.buscarPorId debe ser implementado');
  }
}

module.exports = { RepositorioViajes };
