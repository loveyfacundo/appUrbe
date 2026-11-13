const { RepositorioViajesMemoria } = require('./infra/memoria/repositorio-viajes-memoria');
const { RepositorioIdempotenciaMemoria } = require('./infra/memoria/repositorio-idempotencia-memoria');
const { PublicadorEventosSimulado } = require('./infra/mensajeria/publicador-eventos-simulado');
const { SolicitarViaje } = require('./dominio/casos-uso/solicitar-viaje');
const { ObtenerViaje } = require('./dominio/casos-uso/obtener-viaje');
const { CancelarViaje } = require('./dominio/casos-uso/cancelar-viaje');
const { ActualizarEstadoViaje } = require('./dominio/casos-uso/actualizar-estado-viaje');
const { Pool } = require('pg');
const { RepositorioViajesPostgres } = require('./infra/db/repositorio-viajes-postgres');
const { RepositorioIdempotenciaPostgres } = require('./infra/db/repositorio-idempotencia-postgres');

function crearModuloViajes(dependencias = {}) {
  const pool = dependencias.pool ||
    (process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null);
  const repositorio = dependencias.repositorio ||
    (pool ? new RepositorioViajesPostgres({ pool }) : new RepositorioViajesMemoria());
  const idempotencia = dependencias.idempotencia ||
    (pool ? new RepositorioIdempotenciaPostgres({ pool }) : new RepositorioIdempotenciaMemoria());
  const publicador = dependencias.publicador || new PublicadorEventosSimulado();
  return {
    repositorio,
    idempotencia,
    publicador,
    pool,
    cerrar: async () => {
      if (pool) await pool.end();
    },
    casosUso: {
      solicitar: new SolicitarViaje({ repositorio, idempotencia, publicador }),
      obtener: new ObtenerViaje({ repositorio }),
      cancelar: new CancelarViaje({ repositorio, idempotencia, publicador }),
      actualizarEstado: new ActualizarEstadoViaje({ repositorio, publicador })
    }
  };
}

module.exports = { crearModuloViajes };
