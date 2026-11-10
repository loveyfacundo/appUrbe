const { ErrorDeDominio } = require('../../../dominio/errores/errores');

function manejarErrores(error, req, res, next) {
  if (res.headersSent) return next(error);

  const esErrorDominio = error instanceof ErrorDeDominio;
  const estado = esErrorDominio
    ? error.estado
    : Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  const codigo = esErrorDominio
    ? error.codigo
    : estado === 400
      ? 'BAD_REQUEST'
      : 'INTERNAL_ERROR';
  const mensaje = esErrorDominio
    ? error.message
    : estado === 400
      ? 'La solicitud está mal formada'
      : 'Ocurrió un error interno';

  if (estado >= 500) console.error(error);
  const idCorrelacion = req.idCorrelacion || null;
  if (idCorrelacion) res.set('X-Correlation-Id', idCorrelacion);
  return res.status(estado).json({
    code: codigo,
    message: mensaje,
    correlationId: idCorrelacion,
    details: esErrorDominio ? error.detalles : []
  });
}

module.exports = { manejarErrores };
