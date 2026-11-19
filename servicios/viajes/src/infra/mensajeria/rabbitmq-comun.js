const EXCHANGE_EVENTOS = 'appurbe.events';
const EXCHANGE_ERRORES = 'appurbe.events.dlx';
const COLA_ERRORES = 'viajes.events.dlq';

async function asegurarTopologiaBase(canal) {
  await canal.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
  await canal.assertExchange(EXCHANGE_ERRORES, 'direct', { durable: true });
  await canal.assertQueue(COLA_ERRORES, { durable: true });
  await canal.bindQueue(COLA_ERRORES, EXCHANGE_ERRORES, COLA_ERRORES);
}

async function cerrarRecursosAmqp(canal, conexion) {
  if (canal) {
    try {
      await canal.close();
    } catch (error) {
      if (error.code !== 'CHANNEL_CLOSED') throw error;
    }
  }
  if (conexion) {
    try {
      await conexion.close();
    } catch (error) {
      if (error.code !== 'CONNECTION_FORCED' && error.code !== 'CHANNEL_CLOSED') throw error;
    }
  }
}

module.exports = {
  EXCHANGE_EVENTOS,
  EXCHANGE_ERRORES,
  COLA_ERRORES,
  asegurarTopologiaBase,
  cerrarRecursosAmqp
};
