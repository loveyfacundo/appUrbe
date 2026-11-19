const { ErrorDeValidacion } = require('../../../dominio/errores/errores');
const { validarUuid } = require('../../../dominio/entidades/viaje');

function esNumeroEnRango(valor, min, max) {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= min && valor <= max;
}

function esTextoValido(valor, min, max) {
  return typeof valor === 'string' && valor.trim().length >= min && valor.length <= max;
}

function esFechaIsoValida(fecha) {
  if (fecha === undefined || fecha === null) return true;
  return typeof fecha === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fecha) &&
    !Number.isNaN(Date.parse(fecha));
}

function validarClaveIdempotencia(valor) {
  if (!valor) throw new ErrorDeValidacion('Idempotency-Key es obligatorio');
  try {
    validarUuid(valor, 'Idempotency-Key');
  } catch {
    throw new ErrorDeValidacion('Idempotency-Key debe ser un UUID válido');
  }
}

function validarObjeto(valor, campo, propiedadesPermitidas) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErrorDeValidacion(`${campo} debe ser un objeto`);
  }
  const propiedadesDesconocidas = Object.keys(valor)
    .filter((propiedad) => !propiedadesPermitidas.includes(propiedad));
  if (propiedadesDesconocidas.length > 0) {
    throw new ErrorDeValidacion(
      `${campo} contiene propiedades no permitidas`,
      propiedadesDesconocidas.map((propiedad) => ({
        campo: `${campo}.${propiedad}`,
        regla: 'additionalProperties'
      }))
    );
  }
}

function validarUbicacionHttp(ubicacion, campo) {
  validarObjeto(ubicacion, campo, ['latitude', 'longitude', 'address']);
  const { latitude, longitude, address } = ubicacion;
  if (!esNumeroEnRango(latitude, -90, 90)) {
    throw new ErrorDeValidacion(`${campo}.latitude debe estar entre -90 y 90`);
  }
  if (!esNumeroEnRango(longitude, -180, 180)) {
    throw new ErrorDeValidacion(`${campo}.longitude debe estar entre -180 y 180`);
  }
  if (!esTextoValido(address, 3, 200)) {
    throw new ErrorDeValidacion(`${campo}.address debe tener entre 3 y 200 caracteres`);
  }
}

function validarSolicitudViaje(body) {
  validarObjeto(body, 'body', ['origin', 'destination', 'scheduledAt']);
  if (!Object.hasOwn(body, 'origin') || !Object.hasOwn(body, 'destination')) {
    throw new ErrorDeValidacion('origin y destination son obligatorios');
  }
  validarUbicacionHttp(body.origin, 'origin');
  validarUbicacionHttp(body.destination, 'destination');
  if (!esFechaIsoValida(body.scheduledAt)) {
    throw new ErrorDeValidacion('scheduledAt debe ser una fecha RFC 3339 o null');
  }
}

function validarCancelacion(body) {
  validarObjeto(body, 'body', ['reason']);
  if (!esTextoValido(body.reason, 3, 500)) {
    throw new ErrorDeValidacion('reason debe tener entre 3 y 500 caracteres');
  }
}

function validarActualizacionEstado(body) {
  validarObjeto(body, 'body', ['status']);
  if (typeof body.status !== 'string') {
    throw new ErrorDeValidacion('status es obligatorio');
  }
}

module.exports = {
  validarClaveIdempotencia,
  validarSolicitudViaje,
  validarCancelacion,
  validarActualizacionEstado
};
