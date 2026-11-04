const { PublicadorEventos } = require('../../dominio/puertos/publicador-eventos');

class PublicadorEventosSimulado extends PublicadorEventos {
  constructor() {
    super();
    this.eventos = [];
  }

  async publicar(tipoEvento, carga, { idCorrelacion = null, idCausacion = null } = {}) {
    const evento = {
      eventId: crypto.randomUUID(),
      eventType: tipoEvento,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      correlationId: idCorrelacion,
      causationId: idCausacion,
      producer: 'viajes',
      payload: structuredClone(carga)
    };
    this.eventos.push(evento);
    return evento;
  }
}

const crypto = require('node:crypto');

module.exports = { PublicadorEventosSimulado };
