const crypto = require('node:crypto');

function crearEvento(tipoEvento, carga, {
  idCorrelacion = null,
  idCausacion = null
} = {}) {
  return {
    eventId: crypto.randomUUID(),
    eventType: tipoEvento,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    correlationId: idCorrelacion,
    causationId: idCausacion,
    producer: 'viajes',
    payload: structuredClone(carga)
  };
}

module.exports = { crearEvento };
