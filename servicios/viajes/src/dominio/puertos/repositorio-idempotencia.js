class RepositorioIdempotencia {
  async buscar() {
    throw new Error('RepositorioIdempotencia.buscar debe ser implementado');
  }

  async guardar() {
    throw new Error('RepositorioIdempotencia.guardar debe ser implementado');
  }
}

module.exports = { RepositorioIdempotencia };
