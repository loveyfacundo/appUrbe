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
const { BloqueadorRedis } = require('./infra/redis/bloqueador-redis');
const { PublicadorEventosRabbitMQ } = require('./infra/mensajeria/publicador-eventos-rabbitmq');
const { ConsumidorDriverAssigned } = require('./infra/mensajeria/consumidor-driver-assigned');
const { ConsultarHistorial } = require('./dominio/casos-uso/consultar-historial');
const { ConsultarViajesEnCurso } = require('./dominio/casos-uso/consultar-viajes-en-curso');
const { CobroSimulado } = require('../../pagos/src/cobro-simulado');
const { RepositorioPagosMemoria } = require('../../pagos/src/repositorio-pagos-memoria');

function crearPoolDb(url) {
  return url ? new Pool({ connectionString: url }) : null;
}

function crearClienteRedis(url) {
  if (!url) return null;
  const cliente = require('redis').createClient({
    url,
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: (reintentos) => (reintentos > 2 ? false : reintentos * 100)
    }
  });
  cliente.on('error', (error) => {
    console.error('Error de conexión Redis', error.message);
  });
  return cliente;
}

function inicializarPersistencia(dependencias) {
  const pool = dependencias.pool ?? crearPoolDb(process.env.DATABASE_URL);
  const repositorio = dependencias.repositorio ?? (pool ? new RepositorioViajesPostgres({ pool }) : new RepositorioViajesMemoria());
  const idempotencia = dependencias.idempotencia ?? (pool ? new RepositorioIdempotenciaPostgres({ pool }) : new RepositorioIdempotenciaMemoria());
  return { pool, repositorio, idempotencia };
}

function inicializarBloqueo(dependencias) {
  const clienteRedis = dependencias.clienteRedis ?? crearClienteRedis(process.env.REDIS_URL);
  const bloqueador = dependencias.bloqueador ?? (clienteRedis ? new BloqueadorRedis({ client: clienteRedis }) : new BloqueadorMemoria());
  return { clienteRedis, bloqueador };
}

function inicializarMensajeria(dependencias, pool, repositorio) {
  const rabbitUrl = process.env.RABBITMQ_URL;
  const amqp = rabbitUrl ? require('amqplib') : null;

  const publicador = dependencias.publicador ?? (rabbitUrl
    ? new PublicadorEventosRabbitMQ({ url: rabbitUrl, amqp })
    : new PublicadorEventosSimulado());

  const consumidor = dependencias.consumidor ?? (rabbitUrl && pool
    ? new ConsumidorDriverAssigned({ url: rabbitUrl, amqp, repositorio })
    : null);

  const despachadorOutbox = dependencias.despachadorOutbox ?? (pool
    ? new DespachadorOutbox({ repositorio: new RepositorioOutboxPostgres({ pool }), publicador })
    : null);

  return { publicador, consumidor, despachadorOutbox };
}

async function ejecutarVerificacion(nombreDependencia, fn) {
  try {
    await fn();
  } catch (error) {
    error.dependencia = nombreDependencia;
    throw error;
  }
}

async function verificarDependencias({ clienteRedis, bloqueador, publicador, consumidor, despachadorOutbox }) {
  const dependenciasExternas = [];
  if (clienteRedis) {
    await ejecutarVerificacion('redis', () => bloqueador.verificar());
    dependenciasExternas.push('redis');
  }
  if (publicador?.verificar) {
    await ejecutarVerificacion('rabbitmq', () => publicador.verificar());
    dependenciasExternas.push('rabbitmq');
  }
  if (consumidor) {
    await ejecutarVerificacion('rabbitmq', () => consumidor.verificar());
  }
  if (despachadorOutbox) {
    await ejecutarVerificacion('postgres', () => despachadorOutbox.verificar());
  }
  return dependenciasExternas;
}

async function cerrarRecursos({ despachadorOutbox, consumidor, pool, publicador, clienteRedis }) {
  const tareas = [
    despachadorOutbox && (() => despachadorOutbox.cerrar()),
    consumidor && (() => consumidor.cerrar()),
    pool && (() => pool.end()),
    publicador?.cerrar && (() => publicador.cerrar()),
    clienteRedis?.isOpen && (() => clienteRedis.quit())
  ].filter(Boolean);

  const errores = [];
  for (const cerrar of tareas) {
    try {
      await cerrar();
    } catch (error) {
      errores.push(error);
    }
  }
  if (errores.length > 0) {
    throw new AggregateError(errores, 'No se pudieron cerrar todos los recursos del módulo');
  }
}

function instanciarCasosUso({ repositorio, idempotencia, publicador, bloqueador }) {
  const cobroSimulado = new CobroSimulado({
    repositorio: new RepositorioPagosMemoria()
  });
  return {
    solicitar: new SolicitarViaje({ repositorio, idempotencia, publicador }),
    obtener: new ObtenerViaje({ repositorio }),
    cancelar: new CancelarViaje({ repositorio, idempotencia, publicador, bloqueador }),
    actualizarEstado: new ActualizarEstadoViaje({
      repositorio,
      publicador,
      idempotencia,
      bloqueador,
      cobroSimulado
    }),
    aceptarAsignacion: new AceptarAsignacion({
      repositorio,
      idempotencia,
      publicador,
      bloqueador
    }),
    consultarHistorial: new ConsultarHistorial({ repositorio }),
    consultarViajesEnCurso: new ConsultarViajesEnCurso({ repositorio })
  };
}

function crearModuloViajes(dependencias = {}) {
  const { pool, repositorio, idempotencia } = inicializarPersistencia(dependencias);
  const { clienteRedis, bloqueador } = inicializarBloqueo(dependencias);
  const { publicador, consumidor, despachadorOutbox } = inicializarMensajeria(dependencias, pool, repositorio);

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
      return verificarDependencias({
        clienteRedis,
        bloqueador,
        publicador,
        consumidor,
        despachadorOutbox
      });
    },
    cerrar: async () => {
      return cerrarRecursos({
        despachadorOutbox,
        consumidor,
        pool,
        publicador,
        clienteRedis
      });
    },
    casosUso: instanciarCasosUso({ repositorio, idempotencia, publicador, bloqueador })
  };
}

module.exports = { crearModuloViajes };
