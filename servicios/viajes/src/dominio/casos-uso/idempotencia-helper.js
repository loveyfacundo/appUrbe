const { ConflictoDeEstado, ErrorDeValidacion } = require('../errores/errores');

function validarClaveYCorrelacion(claveIdempotencia, idCorrelacion) {
  if (!claveIdempotencia || !idCorrelacion) {
    throw new ErrorDeValidacion('claveIdempotencia e idCorrelacion son obligatorios');
  }
}

async function verificarIdempotencia(repositorioIdempotencia, clave, huella) {
  const anterior = await repositorioIdempotencia.buscar(clave);
  if (anterior) {
    if (anterior.huella !== huella) {
      throw new ConflictoDeEstado('La clave de idempotencia fue reutilizada con otro request');
    }
    return { procesado: true, respuesta: anterior.respuesta };
  }
  return { procesado: false };
}

function metadataIdempotenciaOutbox(repositorio, idempotencia, clave, huella) {
  if (!repositorio.persisteOutbox) return undefined;
  return {
    clave,
    huella,
    tiempoVidaMs: idempotencia.tiempoVidaMs
  };
}

async function publicarYGuardar({ repositorio, publicador, idempotencia, evento, clave, huella, respuesta }) {
  if (!repositorio.persisteOutbox && evento) {
    await publicador.publicar(evento);
  }
  await idempotencia.guardar(clave, huella, respuesta);
  return respuesta;
}

module.exports = {
  validarClaveYCorrelacion,
  verificarIdempotencia,
  metadataIdempotenciaOutbox,
  publicarYGuardar
};
