const {
  ErrorDeValidacion,
  OperacionNoPermitida
} = require('../errores/errores');
const { ESTADOS } = require('../entidades/viaje');
const {
  validarClaveYCorrelacion,
  verificarIdempotencia,
  metadataIdempotenciaOutbox,
  publicarYGuardar
} = require('./idempotencia-helper');

const ESTADOS_OPERATIVOS = new Set([
  ESTADOS.EN_ORIGEN,
  ESTADOS.EN_CURSO,
  ESTADOS.FINALIZADO
]);

function crearEventoEstado(publicador, estado, identificadorViaje, actorId, idCorrelacion) {
  if (estado !== ESTADOS.EN_CURSO && estado !== ESTADOS.FINALIZADO) return undefined;
  const tipoEvento = estado === ESTADOS.FINALIZADO ? 'TripCompleted' : 'TripStarted';
  return publicador.crearEvento(tipoEvento, {
    tripId: identificadorViaje,
    driverId: actorId,
    status: estado
  }, { idCorrelacion });
}

function actualizarFechasEvento(evento, estado, viaje) {
  if (!evento) return;
  evento.payload.status = viaje.estado;
  if (estado === ESTADOS.EN_CURSO) evento.payload.startedAt = viaje.actualizadoEn;
  if (estado === ESTADOS.FINALIZADO) evento.payload.completedAt = viaje.actualizadoEn;
}

class ActualizarEstadoViaje {
  constructor({ repositorio, publicador, idempotencia, bloqueador }) {
    this.repositorio = repositorio;
    this.publicador = publicador;
    this.idempotencia = idempotencia;
    this.bloqueador = bloqueador;
  }

  async ejecutar({
    identificadorViaje,
    actor,
    estado,
    claveIdempotencia,
    idCorrelacion
  }) {
    if (!ESTADOS_OPERATIVOS.has(estado)) {
      throw new ErrorDeValidacion('estado no es una transición operativa válida');
    }
    if (!actor || !actor.roles?.includes('conductor')) {
      throw new OperacionNoPermitida('Solo el conductor asignado puede actualizar el estado');
    }
    validarClaveYCorrelacion(claveIdempotencia, idCorrelacion);

    const clave = `${actor.identificador}:${claveIdempotencia}`;
    const huella = JSON.stringify({ identificadorViaje, estado });

    return this.bloqueador.ejecutar(`viaje:${identificadorViaje}`, async () => {
      const idempotente = await verificarIdempotencia(this.idempotencia, clave, huella);
      if (idempotente.procesado) return idempotente.respuesta;

      const evento = crearEventoEstado(this.publicador, estado, identificadorViaje, actor.identificador, idCorrelacion);
      const viaje = await this.repositorio.actualizarEstadoOperativo({
        identificadorViaje,
        actorId: actor.identificador,
        estado,
        evento: this.repositorio.persisteOutbox ? evento : undefined,
        idempotencia: metadataIdempotenciaOutbox(this.repositorio, this.idempotencia, clave, huella)
      });

      actualizarFechasEvento(evento, estado, viaje);

      return publicarYGuardar({
        repositorio: this.repositorio,
        publicador: this.publicador,
        idempotencia: this.idempotencia,
        evento,
        clave,
        huella,
        respuesta: viaje.toJSON()
      });
    });
  }
}

module.exports = { ActualizarEstadoViaje };
