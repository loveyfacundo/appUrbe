const { validarUuid } = require('../../dominio/entidades/viaje');
const {
  DependenciaNoDisponible
} = require('../../dominio/errores/errores');
const {
  EXCHANGE_EVENTOS,
  EXCHANGE_ERRORES
} = require('./publicador-eventos-rabbitmq');

const COLA_DRIVER_ASSIGNED = 'viajes.driver-assigned';
const COLA_REINTENTOS = 'viajes.driver-assigned.retry';
const COLA_ERRORES = 'viajes.events.dlq';

function validarEvento(evento) {
  if (!evento || evento.eventType !== 'DriverAssigned' || evento.eventVersion !== 1) {
    throw new TypeError('Evento DriverAssigned inválido o versión no soportada');
  }
  validarUuid(evento.eventId, 'eventId');
  validarUuid(evento.payload?.tripId, 'tripId');
  validarUuid(evento.payload?.driverId, 'driverId');
}

class ConsumidorDriverAssigned {
  constructor({ url, amqp, repositorio, maxIntentos = 3 }) {
    this.url = url;
    this.amqp = amqp;
    this.repositorio = repositorio;
    this.maxIntentos = maxIntentos;
    this.conexion = null;
    this.canal = null;
    this.inicializando = null;
    this.consumerTag = null;
    this.timerReconexion = null;
    this.cerrado = false;
  }

  async iniciar() {
    if (this.consumerTag) return;
    this.cerrado = false;
    if (!this.inicializando) {
      this.inicializando = this.conectar().catch((error) => {
        this.programarReconexion();
        throw error;
      }).finally(() => {
        this.inicializando = null;
      });
    }
    await this.inicializando;
  }

  async conectar() {
    try {
      this.conexion = await this.amqp.connect(this.url, { timeout: 3000 });
      this.conexion.on('error', () => {
        this.consumerTag = null;
        this.programarReconexion();
      });
      this.conexion.on('close', () => {
        this.consumerTag = null;
        this.canal = null;
        this.conexion = null;
        this.programarReconexion();
      });
      this.canal = await this.conexion.createConfirmChannel();
      await this.canal.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
      await this.canal.assertExchange(EXCHANGE_ERRORES, 'direct', { durable: true });
      await this.canal.assertQueue(COLA_ERRORES, { durable: true });
      await this.canal.bindQueue(COLA_ERRORES, EXCHANGE_ERRORES, COLA_ERRORES);
      await this.canal.assertQueue(COLA_DRIVER_ASSIGNED, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXCHANGE_ERRORES,
          'x-dead-letter-routing-key': COLA_ERRORES
        }
      });
      await this.canal.assertQueue(COLA_REINTENTOS, {
        durable: true,
        arguments: {
          'x-message-ttl': 1000,
          'x-dead-letter-exchange': EXCHANGE_EVENTOS,
          'x-dead-letter-routing-key': 'trip.driver-assigned.v1'
        }
      });
      await this.canal.bindQueue(COLA_DRIVER_ASSIGNED, EXCHANGE_EVENTOS, 'trip.driver-assigned.v1');
      this.canal.prefetch(1);
      const resultado = await this.canal.consume(
        COLA_DRIVER_ASSIGNED,
        (mensaje) => this.procesar(mensaje),
        { noAck: false }
      );
      this.consumerTag = resultado.consumerTag;
    } catch {
      await this.cerrarConexion();
      throw new DependenciaNoDisponible('No se pudo iniciar el consumidor RabbitMQ');
    }
  }

  async verificar() {
    if (!this.consumerTag) await this.iniciar();
  }

  programarReconexion() {
    if (this.cerrado || this.timerReconexion) return;
    this.timerReconexion = setTimeout(() => {
      this.timerReconexion = null;
      this.iniciar().catch((error) => {
        console.error('No se pudo reconectar el consumidor RabbitMQ', error.name);
      });
    }, 5000);
    this.timerReconexion.unref?.();
  }

  async procesar(mensaje) {
    if (!mensaje) return;
    const canal = this.canal;
    if (!canal) return;
    try {
      const evento = JSON.parse(mensaje.content.toString('utf8'));
      validarEvento(evento);
      await this.repositorio.procesarAsignacionEvento({
        eventId: evento.eventId,
        identificadorViaje: evento.payload.tripId,
        conductorId: evento.payload.driverId
      });
      canal.ack(mensaje);
    } catch (error) {
      const reintentos = Number(mensaje.properties.headers?.['x-retry-count'] || 0);
      try {
        if (reintentos < this.maxIntentos) {
          canal.sendToQueue(COLA_REINTENTOS, mensaje.content, {
            persistent: true,
            contentType: 'application/json',
            headers: {
              ...mensaje.properties.headers,
              'x-retry-count': reintentos + 1
            }
          });
        } else {
          canal.publish(EXCHANGE_ERRORES, COLA_ERRORES, mensaje.content, {
            persistent: true,
            contentType: 'application/json',
            headers: {
              ...mensaje.properties.headers,
              'x-final-error': error.code || error.name
            }
          });
        }
        await canal.waitForConfirms();
        canal.ack(mensaje);
      } catch (errorPublicacion) {
        try {
          canal.nack(mensaje, false, true);
        } catch (errorRechazo) {
          console.error('El canal RabbitMQ se cerró antes de reenviar el mensaje', errorRechazo.name);
        }
        console.error('No se pudo enrutar el mensaje fallido', errorPublicacion.name);
      }
    }
  }

  async cerrarConexion() {
    const canal = this.canal;
    const conexion = this.conexion;
    this.canal = null;
    this.conexion = null;
    this.consumerTag = null;
    if (canal) await canal.close();
    if (conexion) await conexion.close();
  }

  async cerrar() {
    this.cerrado = true;
    if (this.timerReconexion) clearTimeout(this.timerReconexion);
    this.timerReconexion = null;
    if (this.canal && this.consumerTag) {
      await this.canal.cancel(this.consumerTag);
    }
    await this.cerrarConexion();
  }
}

module.exports = {
  ConsumidorDriverAssigned,
  validarEvento,
  COLA_DRIVER_ASSIGNED,
  COLA_REINTENTOS,
  COLA_ERRORES
};
