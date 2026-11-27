const {
  ESTADOS
} = require('./entidades/viaje');
const {
  ErrorDeValidacion,
  OperacionNoPermitida,
  ConflictoDeEstado
} = require('./errores/errores');
const { esChofer } = require('./actores');

const ESTADOS_PASAJERO = [
  ESTADOS.SOLICITADO,
  ESTADOS.DESPACHANDO,
  ESTADOS.EN_ORIGEN
];
const ESTADOS_CHOFER = [
  ESTADOS.ASIGNADO,
  ESTADOS.EN_ORIGEN,
  ESTADOS.EN_CURSO
];
const ESTADOS_OPERADOR = [
  ESTADOS.SOLICITADO,
  ESTADOS.DESPACHANDO,
  ESTADOS.ASIGNADO,
  ESTADOS.EN_ORIGEN,
  ESTADOS.EN_CURSO
];

function esOperador(actor) {
  return actor?.roles?.includes('operador') &&
    actor.permisos?.includes('trips:cancel');
}

function resolverTipoActor(viaje, actor) {
  const opciones = [
    {
      coincide: esOperador(actor),
      tipo: 'OPERADOR',
      estadoFinal: ESTADOS.CANCELADO_OPERADOR,
      estadosPermitidos: ESTADOS_OPERADOR
    },
    {
      coincide: actor?.identificador === viaje.pasajeroId,
      tipo: 'PASAJERO',
      estadoFinal: ESTADOS.CANCELADO_PASAJERO,
      estadosPermitidos: ESTADOS_PASAJERO
    },
    {
      coincide: actor?.identificador === viaje.conductorId && esChofer(actor),
      tipo: 'CHOFER',
      estadoFinal: ESTADOS.CANCELADO_CHOFER,
      estadosPermitidos: ESTADOS_CHOFER
    }
  ];
  const opcion = opciones.find(({ coincide }) => coincide);
  if (!opcion) throw new OperacionNoPermitida();
  return opcion;
}

function bloqueoEstaActivo(bloqueadoHasta, ahora = Date.now()) {
  if (bloqueadoHasta === null || bloqueadoHasta === undefined) return false;
  const timestamp = new Date(bloqueadoHasta).getTime();
  return Number.isFinite(timestamp) && timestamp > ahora;
}

class PoliticaCancelaciones {
  constructor({
    penalidadPasajeroAlLlegarArs = 1000,
    limiteCancelaciones = 3,
    periodoCancelacionesMs = 30 * 24 * 60 * 60 * 1000,
    bloqueoCancelacionesMs = 24 * 60 * 60 * 1000
  } = {}) {
    if (!Number.isSafeInteger(penalidadPasajeroAlLlegarArs) ||
        penalidadPasajeroAlLlegarArs < 0 ||
        penalidadPasajeroAlLlegarArs > 2147483647) {
      throw new ErrorDeValidacion('La penalidad configurable debe ser un entero ARS entre 0 y 2147483647');
    }
    if (!Number.isSafeInteger(limiteCancelaciones) || limiteCancelaciones < 1) {
      throw new ErrorDeValidacion('El límite de cancelaciones debe ser un entero positivo');
    }
    if (!Number.isSafeInteger(periodoCancelacionesMs) || periodoCancelacionesMs < 1 ||
        !Number.isSafeInteger(bloqueoCancelacionesMs) || bloqueoCancelacionesMs < 1) {
      throw new ErrorDeValidacion('El período y el bloqueo deben ser duraciones positivas');
    }
    this.penalidadPasajeroAlLlegarArs = penalidadPasajeroAlLlegarArs;
    this.limiteCancelaciones = limiteCancelaciones;
    this.periodoCancelacionesMs = periodoCancelacionesMs;
    this.bloqueoCancelacionesMs = bloqueoCancelacionesMs;
  }

  resolver({ viaje, actor }) {
    const { tipo: tipoActor, estadoFinal, estadosPermitidos } =
      resolverTipoActor(viaje, actor);

    if (!estadosPermitidos.includes(viaje.estado)) {
      throw new ConflictoDeEstado(
        `El actor ${tipoActor.toLowerCase()} no puede cancelar un viaje en estado ${viaje.estado}`
      );
    }

    const penalidadArs = tipoActor === 'PASAJERO' && viaje.estado === ESTADOS.EN_ORIGEN
      ? this.penalidadPasajeroAlLlegarArs
      : 0;
    return {
      tipoActor,
      estadoAnterior: viaje.estado,
      estadoFinal,
      penalidadArs,
      cuentaParaLimite: tipoActor !== 'OPERADOR'
    };
  }
}

function enteroDesdeEntorno(entorno, nombre, valorPredeterminado, minimo = 0) {
  const valor = entorno[nombre] === undefined
    ? valorPredeterminado
    : Number(entorno[nombre]);
  if (!Number.isSafeInteger(valor) || valor < minimo) {
    throw new ErrorDeValidacion(`${nombre} debe ser un entero mayor o igual a ${minimo}`);
  }
  return valor;
}

function crearPoliticaCancelacionesDesdeEntorno(entorno = process.env) {
  const periodoDias = enteroDesdeEntorno(entorno, 'PERIODO_CANCELACIONES_DIAS', 30, 1);
  const bloqueoHoras = enteroDesdeEntorno(entorno, 'BLOQUEO_CANCELACIONES_HORAS', 24, 1);
  return new PoliticaCancelaciones({
    penalidadPasajeroAlLlegarArs: enteroDesdeEntorno(
      entorno,
      'PENALIDAD_CANCELACION_LLEGADA_ARS',
      1000
    ),
    limiteCancelaciones: enteroDesdeEntorno(entorno, 'LIMITE_CANCELACIONES', 3, 1),
    periodoCancelacionesMs: periodoDias * 24 * 60 * 60 * 1000,
    bloqueoCancelacionesMs: bloqueoHoras * 60 * 60 * 1000
  });
}

module.exports = {
  PoliticaCancelaciones,
  crearPoliticaCancelacionesDesdeEntorno,
  bloqueoEstaActivo
};
