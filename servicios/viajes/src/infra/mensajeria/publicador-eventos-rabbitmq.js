const { DependenciaNoDisponible } = require('../../dominio/errores/errores');
const { crearEvento } = require('./evento');

const EXCHANGE_EVENTOS = 'appurbe.events';
const EXCHANGE_ERRORES = 'appurbe.events.dlx';
const COLA_ERRORES = 'viajes.events.dlq';

const ROUTING_KEYS = Object.freeze({
  TripRequested: 'trip.requested.v1',
  DriverAssigned: 'trip.driver-assigned.v1',
  TripStarted: 'trip.started.v1',
  TripCompleted: 'trip.completed.v1',
  TripCancelled: 'trip.cancelled.v1'
});

function esperarConfirmacion(channel, routingKey, mensaje, opciones) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout de confirmación de RabbitMQ')), opciones.timeoutMs);
    channel.publish(
      EXCHANGE_EVENTOS,
      routingKey,
      mensaje,
      {
        persistent: true,
        contentType: 'application/json',
        type: opciones.eventType,
        messageId: opciones.eventId,
        headers: {
          eventVersion: 1,
          correlationId: opciones.correlationId
        }
      },
      (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

class PublicadorEventosRabbitMQ {
  constructor({ url, amqp, timeoutMs = 3000, maxIntentos = 2 }) {
    this.url = url;
    this.amqp = amqp;
    this.timeoutMs = timeoutMs;
    this.maxIntentos = maxIntentos;
    this.conexion = null;
    this.canal = null;
    this.inicializando = null;
  }

  async conectar() {
    if (this.canal) return;
    if (!this.inicializando) {
      this.inicializando = this.crearCanal().finally(() => {
        this.inicializando = null;
      });
    }
    await this.inicializando;
  }

  async crearCanal() {
    try {
      this.conexion = await this.amqp.connect(this.url, { timeout: this.timeoutMs });
      this.conexion.on('error', () => {
        this.canal = null;
      });
      this.conexion.on('close', () => {
        this.canal = null;
        this.conexion = null;
      });
      const canal = await this.conexion.createConfirmChannel();
      await canal.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
      await canal.assertExchange(EXCHANGE_ERRORES, 'direct', { durable: true });
      await canal.assertQueue(COLA_ERRORES, { durable: true });
      await canal.bindQueue(COLA_ERRORES, EXCHANGE_ERRORES, COLA_ERRORES);
      this.canal = canal;
    } catch {
      await this.cerrarConexion();
      throw new DependenciaNoDisponible('RabbitMQ no está disponible');
    }
  }

  async verificar() {
    await this.conectar();
  }

  crearEvento(tipoEvento, carga, metadata) {
    if (!ROUTING_KEYS[tipoEvento]) throw new TypeError(`Tipo de evento no soportado: ${tipoEvento}`);
    return crearEvento(tipoEvento, carga, metadata);
  }

  async publicar(tipoEvento, carga, metadata) {
    const evento = typeof tipoEvento === 'object'
      ? tipoEvento
      : this.crearEvento(tipoEvento, carga, metadata);
    const routingKey = ROUTING_KEYS[evento.eventType];
    if (!routingKey) throw new TypeError(`Tipo de evento no soportado: ${evento.eventType}`);
    const mensaje = Buffer.from(JSON.stringify(evento));
    let ultimoError;
    for (let intento = 0; intento < this.maxIntentos; intento += 1) {
      try {
        await this.conectar();
        await esperarConfirmacion(this.canal, routingKey, mensaje, {
          timeoutMs: this.timeoutMs,
          eventType: evento.eventType,
          eventId: evento.eventId,
          correlationId: evento.correlationId
        });
        return evento;
      } catch (error) {
        ultimoError = error;
        await this.cerrarConexion();
        if (intento + 1 < this.maxIntentos) {
          await new Promise((resolve) => setTimeout(resolve, 100 * (intento + 1)));
        }
      }
    }
    console.error(JSON.stringify({
      component: 'rabbitmq-publisher',
      eventType: evento.eventType,
      correlationId: evento.correlationId,
      error: ultimoError?.name || 'Error'
    }));
    throw new DependenciaNoDisponible(`RabbitMQ no confirmó la publicación de ${evento.eventType}`);
  }

  async cerrarConexion() {
    const canal = this.canal;
    const conexion = this.conexion;
    this.canal = null;
    this.conexion = null;
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

  async cerrar() {
    await this.cerrarConexion();
  }
}

module.exports = {
  PublicadorEventosRabbitMQ,
  ROUTING_KEYS,
  EXCHANGE_EVENTOS,
  EXCHANGE_ERRORES
};
