const { PublicadorEventos } = require('../../dominio/puertos/publicador-eventos');
const { crearEvento } = require('./evento');

class PublicadorEventosSimulado extends PublicadorEventos {
  constructor() {
    super();
    this.eventos = [];
  }

  crearEvento(tipoEvento, carga, metadata) {
    return crearEvento(tipoEvento, carga, metadata);
  }

  async publicar(tipoEvento, carga, metadata) {
    const evento = typeof tipoEvento === 'object'
      ? tipoEvento
      : crearEvento(tipoEvento, carga, metadata);
    this.eventos.push(structuredClone(evento));
    return evento;
  }
}

module.exports = { PublicadorEventosSimulado };
