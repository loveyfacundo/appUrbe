const {
  ErrorDeValidacion,
  ConflictoDeEstado
} = require('../errores/errores');

const ESTADOS = Object.freeze({
  SOLICITADO: 'REQUESTED',
  DESPACHANDO: 'DISPATCHING',
  ASIGNADO: 'ASSIGNED',
  EN_ORIGEN: 'DRIVER_ARRIVING',
  EN_CURSO: 'IN_PROGRESS',
  FINALIZADO: 'COMPLETED',
  SIN_CONDUCTOR: 'NO_DRIVERS_AVAILABLE',
  INICIADO: 'IN_PROGRESS',
  COMPLETADO: 'COMPLETED',
  CANCELADO: 'CANCELLED',
  CANCELADO_PASAJERO: 'CANCELLED_BY_PASSENGER',
  CANCELADO_CHOFER: 'CANCELLED_BY_DRIVER',
  CANCELADO_OPERADOR: 'CANCELLED_BY_OPERATOR'
});

const ESTADOS_VIAJE_ACTIVO = Object.freeze([
  ESTADOS.ASIGNADO,
  ESTADOS.EN_ORIGEN,
  ESTADOS.EN_CURSO
]);

const TIPO_ACTOR_POR_ESTADO_CANCELACION = Object.freeze({
  [ESTADOS.CANCELADO_PASAJERO]: 'PASAJERO',
  [ESTADOS.CANCELADO_CHOFER]: 'CHOFER',
  [ESTADOS.CANCELADO_OPERADOR]: 'OPERADOR'
});

const ESTADOS_CANCELACION_CONTABILIZADOS = Object.freeze([
  ESTADOS.CANCELADO_PASAJERO,
  ESTADOS.CANCELADO_CHOFER
]);

const TRANSICIONES = Object.freeze({
  [ESTADOS.SOLICITADO]: [ESTADOS.DESPACHANDO, ESTADOS.ASIGNADO, ESTADOS.CANCELADO, ESTADOS.CANCELADO_PASAJERO, ESTADOS.CANCELADO_OPERADOR],
  [ESTADOS.DESPACHANDO]: [ESTADOS.ASIGNADO, ESTADOS.SIN_CONDUCTOR, ESTADOS.CANCELADO, ESTADOS.CANCELADO_PASAJERO, ESTADOS.CANCELADO_OPERADOR],
  [ESTADOS.ASIGNADO]: [ESTADOS.EN_ORIGEN, ESTADOS.INICIADO, ESTADOS.CANCELADO, ESTADOS.CANCELADO_PASAJERO, ESTADOS.CANCELADO_CHOFER, ESTADOS.CANCELADO_OPERADOR],
  [ESTADOS.EN_ORIGEN]: [ESTADOS.EN_CURSO, ESTADOS.CANCELADO, ESTADOS.CANCELADO_PASAJERO, ESTADOS.CANCELADO_CHOFER, ESTADOS.CANCELADO_OPERADOR],
  [ESTADOS.EN_CURSO]: [ESTADOS.FINALIZADO, ESTADOS.CANCELADO_CHOFER, ESTADOS.CANCELADO_OPERADOR],
  [ESTADOS.FINALIZADO]: [],
  [ESTADOS.SIN_CONDUCTOR]: [],
  [ESTADOS.CANCELADO]: [],
  [ESTADOS.CANCELADO_PASAJERO]: [],
  [ESTADOS.CANCELADO_CHOFER]: [],
  [ESTADOS.CANCELADO_OPERADOR]: []
});

function esRangoValido(val, min, max) {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;
}

function esTextoValido(val, min, max) {
  return typeof val === 'string' && val.trim().length >= min && val.length <= max;
}

function esFechaIsoValida(fecha) {
  if (fecha === null) return true;
  return typeof fecha === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fecha) &&
    !Number.isNaN(Date.parse(fecha));
}

function validarUuid(valor, campo) {
  if (typeof valor !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)) {
    throw new ErrorDeValidacion(`${campo} debe ser un UUID válido`, [{ campo, regla: 'uuid' }]);
  }
}

function validarUbicacion(ubicacion, campo) {
  if (!ubicacion || typeof ubicacion !== 'object') {
    throw new ErrorDeValidacion(`${campo} es obligatoria`, [{ campo, regla: 'required' }]);
  }
  const { latitud, longitud, direccion } = ubicacion;
  if (!esRangoValido(latitud, -90, 90)) {
    throw new ErrorDeValidacion(`${campo}.latitud debe estar entre -90 y 90`);
  }
  if (!esRangoValido(longitud, -180, 180)) {
    throw new ErrorDeValidacion(`${campo}.longitud debe estar entre -180 y 180`);
  }
  if (!esTextoValido(direccion, 3, 200)) {
    throw new ErrorDeValidacion(`${campo}.direccion debe tener entre 3 y 200 caracteres`);
  }
}

class Viaje {
  constructor({ identificador, pasajeroId, origen, destino, fechaProgramada = null, conductorId = null, estado = ESTADOS.SOLICITADO, creadoEn, actualizadoEn, cancelacion = null }) {
    validarUuid(identificador, 'identificador');
    validarUuid(pasajeroId, 'pasajeroId');
    validarUbicacion(origen, 'origen');
    validarUbicacion(destino, 'destino');
    if (!esFechaIsoValida(fechaProgramada)) {
      throw new ErrorDeValidacion('fechaProgramada debe ser una fecha RFC 3339 o null');
    }
    if (!Object.values(ESTADOS).includes(estado)) {
      throw new ErrorDeValidacion('estado no es válido');
    }
    this.identificador = identificador;
    this.pasajeroId = pasajeroId;
    this.conductorId = conductorId;
    this.origen = { ...origen };
    this.destino = { ...destino };
    this.fechaProgramada = fechaProgramada;
    this.estado = estado;
    this.creadoEn = creadoEn || new Date().toISOString();
    this.actualizadoEn = actualizadoEn || this.creadoEn;
    this.cancelacion = cancelacion;
  }

  asignar(conductorId, ahora = new Date().toISOString()) {
    validarUuid(conductorId, 'conductorId');
    this.cambiarEstado(ESTADOS.ASIGNADO, ahora);
    this.conductorId = conductorId;
    return this;
  }

  despachar(ahora = new Date().toISOString()) {
    return this.cambiarEstado(ESTADOS.DESPACHANDO, ahora);
  }

  marcarSinConductor(ahora = new Date().toISOString()) {
    return this.cambiarEstado(ESTADOS.SIN_CONDUCTOR, ahora);
  }

  llegarAlOrigen(actorId, ahora = new Date().toISOString()) {
    this.verificarConductor(actorId);
    return this.cambiarEstado(ESTADOS.EN_ORIGEN, ahora);
  }

  iniciarEnCurso(actorId, ahora = new Date().toISOString()) {
    this.verificarConductor(actorId);
    return this.cambiarEstado(ESTADOS.EN_CURSO, ahora);
  }

  finalizar(actorId, ahora = new Date().toISOString()) {
    this.verificarConductor(actorId);
    return this.cambiarEstado(ESTADOS.FINALIZADO, ahora);
  }

  iniciar(ahora = new Date().toISOString()) {
    if (!this.conductorId) {
      throw new ConflictoDeEstado('No se puede iniciar un viaje sin conductor asignado');
    }
    return this.cambiarEstado(ESTADOS.INICIADO, ahora);
  }

  completar(ahora = new Date().toISOString()) {
    return this.cambiarEstado(ESTADOS.COMPLETADO, ahora);
  }

  cancelar(ahora = new Date().toISOString()) {
    return this.cambiarEstado(ESTADOS.CANCELADO, ahora);
  }

  cancelarPorPasajero(ahora = new Date().toISOString()) {
    return this.cambiarEstado(ESTADOS.CANCELADO_PASAJERO, ahora);
  }

  cancelarPorChofer(ahora = new Date().toISOString()) {
    if (!this.conductorId) {
      throw new ConflictoDeEstado('No se puede cancelar por chofer sin una asignación');
    }
    return this.cambiarEstado(ESTADOS.CANCELADO_CHOFER, ahora);
  }

  cancelarPorOperador(ahora = new Date().toISOString()) {
    return this.cambiarEstado(ESTADOS.CANCELADO_OPERADOR, ahora);
  }

  cambiarEstado(nuevoEstado, ahora = new Date().toISOString()) {
    const transicionesPermitidas = TRANSICIONES[this.estado] || [];
    if (!transicionesPermitidas.includes(nuevoEstado)) {
      throw new ConflictoDeEstado(`Transición de estado no permitida: ${this.estado} -> ${nuevoEstado}`);
    }
    this.estado = nuevoEstado;
    this.actualizadoEn = ahora;
    return this;
  }

  verificarConductor(actorId) {
    if (this.conductorId !== actorId) {
      throw new ConflictoDeEstado('Solo el conductor asignado puede realizar esta acción');
    }
  }

  toJSON() {
    return {
      identificador: this.identificador,
      pasajeroId: this.pasajeroId,
      conductorId: this.conductorId,
      origen: { ...this.origen },
      destino: { ...this.destino },
      fechaProgramada: this.fechaProgramada,
      estado: this.estado,
      creadoEn: this.creadoEn,
      actualizadoEn: this.actualizadoEn,
      ...(this.cancelacion ? { cancelacion: { ...this.cancelacion } } : {})
    };
  }
}

module.exports = {
  Viaje,
  ESTADOS,
  ESTADOS_VIAJE_ACTIVO,
  TIPO_ACTOR_POR_ESTADO_CANCELACION,
  ESTADOS_CANCELACION_CONTABILIZADOS,
  TRANSICIONES,
  validarUuid,
  validarUbicacion
};
