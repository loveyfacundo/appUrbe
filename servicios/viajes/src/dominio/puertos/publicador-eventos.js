class PublicadorEventos {
  async publicar() {
    throw new Error('PublicadorEventos.publicar debe ser implementado');
  }
}

module.exports = { PublicadorEventos };
