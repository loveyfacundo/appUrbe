const { RepositorioViajesMemoria } = require('./infra/memoria/repositorio-viajes-memoria');
const { RepositorioIdempotenciaMemoria } = require('./infra/memoria/repositorio-idempotencia-memoria');
const { PublicadorEventosSimulado } = require('./infra/mensajeria/publicador-eventos-simulado');
const { SolicitarViaje } = require('./dominio/casos-uso/solicitar-viaje');
const { ObtenerViaje } = require('./dominio/casos-uso/obtener-viaje');
const { CancelarViaje } = require('./dominio/casos-uso/cancelar-viaje');

function crearModuloViajes(dependencias = {}) {
  const repositorio = dependencias.repositorio || new RepositorioViajesMemoria();
  const idempotencia = dependencias.idempotencia || new RepositorioIdempotenciaMemoria();
  const publicador = dependencias.publicador || new PublicadorEventosSimulado();
  return {
    repositorio,
    idempotencia,
    publicador,
    casosUso: {
      solicitar: new SolicitarViaje({ repositorio, idempotencia, publicador }),
      obtener: new ObtenerViaje({ repositorio }),
      cancelar: new CancelarViaje({ repositorio, idempotencia, publicador })
    }
  };
}

module.exports = { crearModuloViajes };
