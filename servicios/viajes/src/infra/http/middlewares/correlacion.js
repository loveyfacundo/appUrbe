const crypto = require('node:crypto');
const { ErrorDeValidacion } = require('../../../dominio/errores/errores');
const { validarUuid } = require('../../../dominio/entidades/viaje');

function establecerCorrelacion(req, res, next) {
  req.idCorrelacion = crypto.randomUUID();
  const recibido = req.get('x-correlation-id');
  if (!recibido) {
    return next(new ErrorDeValidacion('X-Correlation-Id es obligatorio'));
  }

  try {
    validarUuid(recibido, 'X-Correlation-Id');
  } catch (error) {
    return next(error);
  }

  req.idCorrelacion = recibido;
  res.set('X-Correlation-Id', recibido);
  return next();
}

module.exports = { establecerCorrelacion };
