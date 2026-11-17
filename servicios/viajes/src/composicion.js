const { RepositorioViajesMemoria } = require('./infra/memoria/repositorio-viajes-memoria');
const { RepositorioIdempotenciaMemoria } = require('./infra/memoria/repositorio-idempotencia-memoria');
const { PublicadorEventosSimulado } = require('./infra/mensajeria/publicador-eventos-simulado');
const { SolicitarViaje } = require('./dominio/casos-uso/solicitar-viaje');
const { ObtenerViaje } = require('./dominio/casos-uso/obtener-viaje');
const { CancelarViaje } = require('./dominio/casos-uso/cancelar-viaje');
const { ActualizarEstadoViaje } = require('./dominio/casos-uso/actualizar-estado-viaje');
const { AceptarAsignacion } = require('./dominio/casos-uso/aceptar-asignacion');
const { Pool } = require('pg');
const { RepositorioViajesPostgres } = require('./infra/db/repositorio-viajes-postgres');
const { RepositorioIdempotenciaPostgres } = require('./infra/db/repositorio-idempotencia-postgres');
const { aplicarMigraciones } = require('./infra/db/aplicar-migraciones');
const { RepositorioOutboxPostgres } = require('./infra/db/outbox');
const { DespachadorOutbox } = require('./infra/mensajeria/despachador-outbox');
const { BloqueadorMemoria } = require('./infra/memoria/bloqueador-memoria');

function crearModuloViajes(dependencias = {}) {
  const pool = dependencias.pool ||
    (process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null);
  const repositorio = dependencias.repositorio ||
    (pool ? new RepositorioViajesPostgres({ pool }) : new RepositorioViajesMemoria());
  const idempotencia = dependencias.idempotencia ||
    (pool ? new RepositorioIdempotenciaPostgres({ pool }) : new RepositorioIdempotenciaMemoria());
  const clienteRedis = dependencias.clienteRedis ||
    (process.env.REDIS_URL
      ? require('redis').createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 1000,
          reconnectStrategy: (reintentos) => reintentos > 2 ? false : reintentos * 100
        }
      })
      : null);
  if (clienteRedis) {
    clienteRedis.on('error', (error) => {
      console.error('Error de conexión Redis', error.message);
    });
  }
  const bloqueador = dependencias.bloqueador ||
    (clienteRedis
      ? new (require('./infra/redis/bloqueador-redis').BloqueadorRedis)({ client: clienteRedis })
      : new BloqueadorMemoria());
  const publicador = dependencias.publicador ||
    (process.env.RABBITMQ_URL
      ? new (require('./infra/mensajeria/publicador-eventos-rabbitmq').PublicadorEventosRabbitMQ)({
        url: process.env.RABBITMQ_URL,
        amqp: require('amqplib')
      })
      : new PublicadorEventosSimulado());
  const consumidor = dependencias.consumidor ||
    (process.env.RABBITMQ_URL && pool
      ? new (require('./infra/mensajeria/consumidor-driver-assigned').ConsumidorDriverAssigned)({
        url: process.env.RABBITMQ_URL,
        amqp: require('amqplib'),
        repositorio
      })
      : null);
  const despachadorOutbox = dependencias.despachadorOutbox ||
    (pool
      ? new DespachadorOutbox({
        repositorio: new RepositorioOutboxPostgres({ pool }),
        publicador
      })
      : null);
  return {
    repositorio,
    idempotencia,
    publicador,
    bloqueador,
    pool,
    despachadorOutbox,
    iniciar: async () => {
      if (pool) await aplicarMigraciones(pool);
      if (consumidor) {
        try {
          await consumidor.iniciar();
        } catch (error) {
          console.error('El consumidor RabbitMQ iniciará reintentos de conexión', error.name);
        }
      }
      if (despachadorOutbox) await despachadorOutbox.iniciar();
    },
    verificar: async () => {
      const dependenciasExternas = [];
      if (clienteRedis) {
        try {
          await bloqueador.verificar();
        } catch (error) {
          error.dependencia = 'redis';
          throw error;
        }
        dependenciasExternas.push('redis');
      }
      if (publicador.verificar) {
        try {
          await publicador.verificar();
        } catch (error) {
          error.dependencia = 'rabbitmq';
          throw error;
        }
        dependenciasExternas.push('rabbitmq');
      }
      if (consumidor) {
        try {
          await consumidor.verificar();
        } catch (error) {
          error.dependencia = 'rabbitmq';
          throw error;
        }
      }
      if (despachadorOutbox) {
        try {
          await despachadorOutbox.verificar();
        } catch (error) {
          error.dependencia = 'postgres';
          throw error;
        }
      }
      return dependenciasExternas;
    },
    cerrar: async () => {
      const errores = [];
      for (const cerrar of [
        despachadorOutbox ? () => despachadorOutbox.cerrar() : null,
        consumidor ? () => consumidor.cerrar() : null,
        pool ? () => pool.end() : null,
        publicador.cerrar ? () => publicador.cerrar() : null,
        clienteRedis?.isOpen ? () => clienteRedis.quit() : null
      ].filter(Boolean)) {
        try {
          await cerrar();
        } catch (error) {
          errores.push(error);
        }
      }
      if (errores.length > 0) {
        throw new AggregateError(errores, 'No se pudieron cerrar todos los recursos del módulo');
      }
    },
    casosUso: {
      solicitar: new SolicitarViaje({ repositorio, idempotencia, publicador }),
      obtener: new ObtenerViaje({ repositorio }),
      cancelar: new CancelarViaje({ repositorio, idempotencia, publicador }),
      actualizarEstado: new ActualizarEstadoViaje({
        repositorio,
        publicador,
        idempotencia,
        bloqueador
      }),
      aceptarAsignacion: new AceptarAsignacion({
        repositorio,
        idempotencia,
        publicador,
        bloqueador
      })
    }
  };
}

module.exports = { crearModuloViajes };
