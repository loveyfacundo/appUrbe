const {
  RecursoNoEncontrado,
  OperacionNoPermitida,
  ErrorDeValidacion,
  ConflictoDeEstado
} = require('../errores/errores');

class CancelarViaje {
  constructor({ repositorio, publicador, idempotencia }) {
    this.repositorio = repositorio;
    this.publicador = publicador;
    this.idempotencia = idempotencia;
  }

  async ejecutar({ identificadorViaje, actor, motivo, claveIdempotencia, idCorrelacion }) {
    if (typeof motivo !== 'string' || motivo.trim().length < 3 || motivo.length > 500) {
      throw new ErrorDeValidacion('motivo debe tener entre 3 y 500 caracteres');
    }
    if (!claveIdempotencia || !idCorrelacion) {
      throw new ErrorDeValidacion('claveIdempotencia e idCorrelacion son obligatorios');
    }
    if (!actor || typeof actor.identificador !== 'string') {
      throw new ErrorDeValidacion('actor.identificador es obligatorio');
    }
    const clave = `${actor.identificador}:${claveIdempotencia}`;
    const anterior = await this.idempotencia.buscar(clave);
    const huella = JSON.stringify({ identificadorViaje, motivo });
    if (anterior) {
      if (anterior.huella !== huella) {
        throw new ConflictoDeEstado('La clave de idempotencia fue reutilizada con otro request');
      }
      return anterior.respuesta;
    }
    const viaje = await this.repositorio.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    const autorizado = actor.identificador === viaje.pasajeroId ||
      actor.roles?.includes('operador') && actor.permisos?.includes('trips:cancel');
    if (!autorizado) throw new OperacionNoPermitida();
    viaje.cancelar();
    const evento = this.publicador.crearEvento('TripCancelled', {
      tripId: viaje.identificador,
      cancelledBy: actor.identificador,
      reason: motivo
    }, { idCorrelacion });
    await this.repositorio.guardar(
      viaje,
      this.repositorio.persisteOutbox ? evento : undefined,
      this.repositorio.persisteOutbox ? {
        clave,
        huella,
        tiempoVidaMs: this.idempotencia.tiempoVidaMs
      } : undefined
    );
    if (!this.repositorio.persisteOutbox) await this.publicador.publicar(evento);
    const respuesta = viaje.toJSON();
    await this.idempotencia.guardar(clave, huella, respuesta);
    return respuesta;
  }
}

module.exports = { CancelarViaje };
