const { monitorEventLoopDelay } = require('node:perf_hooks');
const { Pool } = require('pg');
const { crearModuloViajes } = require('../../servicios/viajes/src/composicion');
const { crearServidor } = require('../../servicios/viajes/src/servidor');
const { BloqueadorMemoria } = require('../../servicios/viajes/src/infra/memoria/bloqueador-memoria');
const { PublicadorEventosSimulado } = require('../../servicios/viajes/src/infra/mensajeria/publicador-eventos-simulado');
const { RepositorioFlotaPostgres } = require('../../servicios/conductores/src/repositorio-flota');
const { RepositorioFlotaPostgresIngenuo } = require('./repositorio-flota-ingenuo');

const histogramaLag = monitorEventLoopDelay({ resolution: 10 });
let servidor;
let modulo;
let muestreadorMemoria;
let memoriaMaxima = { rss: 0, heapUsed: 0 };
let cerrando = false;

function muestrearMemoria() {
  const memoria = process.memoryUsage();
  memoriaMaxima.rss = Math.max(memoriaMaxima.rss, memoria.rss);
  memoriaMaxima.heapUsed = Math.max(memoriaMaxima.heapUsed, memoria.heapUsed);
}

function leerMetricas() {
  muestrearMemoria();
  return {
    eventLoopLagP99Ms: histogramaLag.percentile(99) / 1e6,
    eventLoopLagMaxMs: histogramaLag.max / 1e6,
    maxRssMiB: memoriaMaxima.rss / (1024 * 1024),
    maxHeapUsedMiB: memoriaMaxima.heapUsed / (1024 * 1024),
    currentRssMiB: process.memoryUsage().rss / (1024 * 1024),
    currentHeapUsedMiB: process.memoryUsage().heapUsed / (1024 * 1024)
  };
}

async function cerrar() {
  if (cerrando) return;
  cerrando = true;
  clearInterval(muestreadorMemoria);
  histogramaLag.disable();
  if (servidor) {
    await new Promise((resolve, reject) => {
      servidor.close((error) => error ? reject(error) : resolve());
    });
  }
  if (modulo) await modulo.cerrar();
  process.send({ type: 'stopped' });
}

async function iniciar() {
  const esquema = process.env.BENCH_SCHEMA;
  const estrategia = process.env.BENCH_STRATEGY;
  if (!/^[a-z0-9_]+$/.test(esquema || '')) {
    throw new Error('BENCH_SCHEMA no es válido');
  }
  if (!['naive', 'postgis'].includes(estrategia)) {
    throw new Error('BENCH_STRATEGY debe ser naive o postgis');
  }
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL es obligatorio');
  }

  process.env.REDIS_URL = '';
  process.env.RABBITMQ_URL = '';
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${esquema},public`
  });
  const dependenciaPasiva = {
    iniciar: async () => {},
    verificar: async () => {},
    cerrar: async () => {}
  };
  modulo = crearModuloViajes({
    pool,
    publicador: new PublicadorEventosSimulado(),
    bloqueador: new BloqueadorMemoria(),
    consumidor: dependenciaPasiva,
    despachadorOutbox: dependenciaPasiva
  });
  await modulo.iniciar();

  const repositorioFlota = estrategia === 'naive'
    ? new RepositorioFlotaPostgresIngenuo({ pool })
    : new RepositorioFlotaPostgres({ pool });
  const app = crearServidor({
    modulo,
    secret: process.env.BENCH_JWT_SECRET,
    identityBootstrapToken: process.env.BENCH_BOOTSTRAP_TOKEN,
    repositorioFlota,
    verificadorPostgres: { verificar: () => pool.query('SELECT 1') }
  });

  histogramaLag.enable();
  muestreadorMemoria = setInterval(muestrearMemoria, 1000);
  muestreadorMemoria.unref();
  servidor = app.listen(0, '0.0.0.0', 2048);
  await new Promise((resolve, reject) => {
    servidor.once('listening', resolve);
    servidor.once('error', reject);
  });
  process.send({ type: 'ready', port: servidor.address().port });
}

process.on('message', async (mensaje) => {
  try {
    if (mensaje.type === 'reset-metrics') {
      histogramaLag.reset();
      const memoria = process.memoryUsage();
      memoriaMaxima = { rss: memoria.rss, heapUsed: memoria.heapUsed };
      process.send({ type: 'metrics-reset' });
    } else if (mensaje.type === 'read-metrics') {
      process.send({ type: 'metrics', data: leerMetricas() });
    } else if (mensaje.type === 'stop') {
      await cerrar();
    }
  } catch (error) {
    process.send({ type: 'error', message: error.message, stack: error.stack });
  }
});

iniciar().catch((error) => {
  if (process.send) process.send({ type: 'error', message: error.message, stack: error.stack });
  cerrar()
    .catch((errorAlCerrar) => {
      if (process.send) {
        process.send({
          type: 'error',
          message: errorAlCerrar.message,
          stack: errorAlCerrar.stack
        });
      }
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
