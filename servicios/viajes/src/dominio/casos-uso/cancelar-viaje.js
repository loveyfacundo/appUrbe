const { ErrorDeValidacion } = require('../errores/errores');
const {
  validarClaveYCorrelacion,
  verificarIdempotencia,
  metadataIdempotenciaOutbox,
  publicarYGuardar
} = require('./idempotencia-helper');

class CancelarViaje {
  constructor({ repositorio, idempotencia, publicador, bloqueador, politicaCancelaciones }) {
    this.repositorio = repositorio;
    this.idempotencia = idempotencia;
    this.publicador = publicador;
    this.bloqueador = bloqueador;
    this.politicaCancelaciones = politicaCancelaciones;
  }

  async ejecutar({ identificadorViaje, motivo, claveIdempotencia, idCorrelacion, actor }) {
    validarClaveYCorrelacion(claveIdempotencia, idCorrelacion);
    if (!actor || typeof actor.identificador !== 'string') {
      throw new ErrorDeValidacion('actor.identificador es obligatorio');
    }
    if (typeof motivo !== 'string' || motivo.trim().length < 3 || motivo.length > 500) {
      throw new ErrorDeValidacion('motivo debe tener entre 3 y 500 caracteres');
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
      const viaje = await this.repositorio.cancelarViaje({
        identificadorViaje,
        actor,
        motivo,
        politicaCancelaciones: this.politicaCancelaciones,
        evento: this.repositorio.persisteOutbox ? evento : undefined,
        idempotencia: metadataIdempotenciaOutbox(this.repositorio, this.idempotencia, clave, huella)
      });
      if (viaje.cancelacion) {
        Object.assign(evento.payload, {
          status: viaje.estado,
          actorType: viaje.cancelacion.actorTipo,
          previousStatus: viaje.cancelacion.estadoAnterior,
          penaltyAmount: viaje.cancelacion.penalidadArs,
          currency: viaje.cancelacion.moneda
        });
      }
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
