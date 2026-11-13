const { ErrorDeValidacion } = require('../../../dominio/errores/errores');
const { validarUuid } = require('../../../dominio/entidades/viaje');

function validarClaveIdempotencia(valor) {
  if (!valor) throw new ErrorDeValidacion('Idempotency-Key es obligatorio');
  try {
    validarUuid(valor, 'Idempotency-Key');
  } catch (error) {
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
    throw new ErrorDeValidacion(`${campo} contiene propiedades no permitidas`, propiedadesDesconocidas.map((propiedad) => ({
      campo: `${campo}.${propiedad}`,
      regla: 'additionalProperties'
    })));
  }
}

function validarUbicacionHttp(ubicacion, campo) {
  validarObjeto(ubicacion, campo, ['latitude', 'longitude', 'address']);
  const { latitude, longitude, address } = ubicacion;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) ||
      latitude < -90 || latitude > 90) {
    throw new ErrorDeValidacion(`${campo}.latitude debe estar entre -90 y 90`);
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) ||
      longitude < -180 || longitude > 180) {
    throw new ErrorDeValidacion(`${campo}.longitude debe estar entre -180 y 180`);
  }
  if (typeof address !== 'string' || address.trim().length < 3 || address.length > 200) {
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
  if (body.scheduledAt !== undefined && body.scheduledAt !== null &&
      (typeof body.scheduledAt !== 'string' ||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.scheduledAt) ||
       Number.isNaN(Date.parse(body.scheduledAt)))) {
    throw new ErrorDeValidacion('scheduledAt debe ser una fecha RFC 3339 o null');
  }
}

function validarCancelacion(body) {
  validarObjeto(body, 'body', ['reason']);
  if (typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 ||
      body.reason.length > 500) {
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
