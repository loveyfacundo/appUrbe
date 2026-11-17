const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PublicadorEventosRabbitMQ,
  EXCHANGE_EVENTOS
} = require('../src/infra/mensajeria/publicador-eventos-rabbitmq');
const {
  validarEvento
} = require('../src/infra/mensajeria/consumidor-driver-assigned');
const {
  ConsumidorDriverAssigned,
  COLA_REINTENTOS,
  COLA_ERRORES
} = require('../src/infra/mensajeria/consumidor-driver-assigned');

const evento = {
  eventId: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
  eventType: 'DriverAssigned',
  eventVersion: 1,
  occurredAt: '2026-11-14T20:00:00.000Z',
  correlationId: '8d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
  causationId: null,
  producer: 'asignacion',
  payload: {
    tripId: '9d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    driverId: '6d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a'
  }
};

test('publica un evento persistente y espera confirmación del broker', async () => {
  const publicaciones = [];
  const topologia = [];
  const canal = {
    async assertExchange(...argumentos) {
      topologia.push(argumentos);
    },
    async assertQueue(...argumentos) {
      topologia.push(argumentos);
    },
    async bindQueue(...argumentos) {
      topologia.push(argumentos);
    },
    publish(exchange, routingKey, body, opciones, confirmar) {
      publicaciones.push({
        exchange,
        routingKey,
        evento: JSON.parse(body.toString('utf8')),
        opciones
      });
      setImmediate(() => confirmar(null));
      return true;
    },
    async close() {}
  };
  const conexion = {
    on() {},
    async createConfirmChannel() {
      return canal;
    },
    async close() {}
  };
  const publicador = new PublicadorEventosRabbitMQ({
    url: 'amqp://localhost',
    amqp: { connect: async () => conexion }
  });
  const resultado = await publicador.publicar('DriverAssigned', evento.payload, {
    idCorrelacion: evento.correlationId
  });
  assert.equal(publicaciones[0].exchange, EXCHANGE_EVENTOS);
  assert.equal(publicaciones[0].routingKey, 'trip.driver-assigned.v1');
  assert.equal(publicaciones[0].opciones.persistent, true);
  assert.equal(publicaciones[0].opciones.messageId, resultado.eventId);
  assert.equal(publicaciones[0].evento.correlationId, evento.correlationId);
  assert.ok(topologia.some(([nombre, tipo, opciones]) =>
    nombre === EXCHANGE_EVENTOS && tipo === 'topic' && opciones.durable));
});

test('RabbitMQ real enruta un evento persistente al suscriptor', {
  skip: !process.env.TEST_RABBITMQ_URL
}, async () => {
  const amqp = require('amqplib');
  const conexion = await amqp.connect(process.env.TEST_RABBITMQ_URL);
  const canal = await conexion.createChannel();
  const cola = await canal.assertQueue('', { exclusive: true, autoDelete: true });
  const publicador = new PublicadorEventosRabbitMQ({
    url: process.env.TEST_RABBITMQ_URL,
    amqp
  });
  const tipoEvento = 'TripRequested';
  const routingKey = 'trip.requested.v1';
  let consumidor;
  try {
    await publicador.verificar();
    await canal.bindQueue(cola.queue, EXCHANGE_EVENTOS, routingKey);
    const recibido = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout esperando el evento RabbitMQ')), 5000);
      canal.consume(cola.queue, (mensaje) => {
        if (!mensaje) return;
        clearTimeout(timer);
        resolve(mensaje);
      }, { noAck: true }).then((resultado) => {
        consumidor = resultado.consumerTag;
      }, reject);
    });
    await publicador.publicar(tipoEvento, evento.payload, {
      idCorrelacion: evento.correlationId
    });
    const mensaje = await recibido;
    assert.equal(mensaje.properties.deliveryMode, 2);
    assert.equal(mensaje.properties.type, tipoEvento);
    assert.equal(JSON.parse(mensaje.content.toString('utf8')).payload.tripId, evento.payload.tripId);
  } finally {
    await publicador.cerrar();
    if (consumidor) await canal.cancel(consumidor);
    await canal.deleteQueue(cola.queue);
    await canal.close();
    await conexion.close();
  }
});

test('valida la versión y los identificadores de DriverAssigned', () => {
  assert.doesNotThrow(() => validarEvento(evento));
  assert.throws(() => validarEvento({
    ...evento,
    eventVersion: 2
  }), /versión no soportada/);
  assert.throws(() => validarEvento({
    ...evento,
    payload: { ...evento.payload, driverId: 'invalido' }
  }), /driverId debe ser un UUID válido/);
});

test('el consumidor limita reintentos y enruta fallos finales a la dead-letter queue', async () => {
  const consumidor = new ConsumidorDriverAssigned({
    url: 'amqp://localhost',
    amqp: {},
    repositorio: {}
  });
  const acciones = [];
  consumidor.canal = {
    sendToQueue(cola, contenido, opciones) {
      acciones.push({ tipo: 'retry', cola, opciones });
    },
    publish(exchange, routingKey, contenido, opciones) {
      acciones.push({ tipo: 'dlq', exchange, routingKey, opciones });
    },
    async waitForConfirms() {},
    ack() {
      acciones.push({ tipo: 'ack' });
    }
  };
  const mensaje = {
    content: Buffer.from('{'),
    properties: { headers: {} }
  };
  await consumidor.procesar(mensaje);
  assert.equal(acciones[0].cola, COLA_REINTENTOS);
  assert.equal(acciones[0].opciones.headers['x-retry-count'], 1);
  assert.equal(acciones[1].tipo, 'ack');

  acciones.length = 0;
  mensaje.properties.headers['x-retry-count'] = 3;
  await consumidor.procesar(mensaje);
  assert.equal(acciones[0].routingKey, COLA_ERRORES);
  assert.equal(acciones[0].opciones.headers['x-final-error'], 'SyntaxError');
  assert.equal(acciones[1].tipo, 'ack');
});
