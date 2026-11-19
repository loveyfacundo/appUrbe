const { ErrorDeValidacion } = require('../errores/errores');
const {
  validarClaveYCorrelacion,
  verificarIdempotencia,
  metadataIdempotenciaOutbox,
  publicarYGuardar
} = require('./idempotencia-helper');

class CancelarViaje {
  constructor({ repositorio, idempotencia, publicador, bloqueador }) {
    this.repositorio = repositorio;
    this.idempotencia = idempotencia;
    this.publicador = publicador;
    this.bloqueador = bloqueador;
  }

  async ejecutar({ identificadorViaje, motivo, claveIdempotencia, idCorrelacion, actor }) {
    validarClaveYCorrelacion(claveIdempotencia, idCorrelacion);
    if (!actor || typeof actor.identificador !== 'string') {
      throw new ErrorDeValidacion('actor.identificador es obligatorio');
    }
    const clave = `${actor.identificador}:${claveIdempotencia}`;
    const huella = JSON.stringify({ identificadorViaje, motivo });

    const evento = this.publicador.crearEvento('TripCancelled', {
      tripId: identificadorViaje,
      cancelledBy: actor.identificador,
      reason: motivo
    }, { idCorrelacion });

    const trabajo = async () => {
      const idempotente = await verificarIdempotencia(this.idempotencia, clave, huella);
      if (idempotente.procesado) return idempotente.respuesta;
      const operadorAutorizado = actor.roles?.includes('operador') &&
        actor.permisos?.includes('trips:cancel');
      const viaje = await this.repositorio.cancelarViaje({
        identificadorViaje,
        actorId: actor.identificador,
        operadorAutorizado,
        tipoCancelacion: actor.roles?.includes('conductor')
          ? 'CANCELLED_BY_DRIVER'
          : 'CANCELLED',
        motivo,
        evento: this.repositorio.persisteOutbox ? evento : undefined,
        idempotencia: metadataIdempotenciaOutbox(this.repositorio, this.idempotencia, clave, huella)
      });
      return publicarYGuardar({
        repositorio: this.repositorio,
        publicador: this.publicador,
        idempotencia: this.idempotencia,
        evento,
        clave,
        huella,
        respuesta: viaje.toJSON()
      });
    };
    return this.bloqueador
      ? this.bloqueador.ejecutar(`viaje:${identificadorViaje}`, trabajo)
      : trabajo();
  }
}

module.exports = { CancelarViaje };
