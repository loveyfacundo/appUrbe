const express = require('express');
const { crearModuloViajes } = require('./composicion');
const { crearAutenticacionJwt } = require('./infra/http/middlewares/autenticacion-jwt');
const { establecerCorrelacion } = require('./infra/http/middlewares/correlacion');
const { manejarErrores } = require('./infra/http/middlewares/manejo-errores');
const { crearRutasViajes } = require('./infra/http/rutas/viajes');
const { ErrorDeDominio } = require('./dominio/errores/errores');

function crearServidor({ modulo = crearModuloViajes(), secret = process.env.JWT_SECRET } = {}) {
  const app = express();
  app.use((req, res, next) => {
    if (req.path === '/api/v1/viajes' || req.path.startsWith('/api/v1/viajes/')) {
      return establecerCorrelacion(req, res, next);
    }
    return next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
  app.use('/api/v1/viajes', crearRutasViajes({
    casosUso: modulo.casosUso,
    autenticar: crearAutenticacionJwt(secret)
  }));
  app.use('/api/v1/viajes', (req, res, next) => {
    next(new ErrorDeDominio('NOT_FOUND', 'La ruta solicitada no existe', 404));
  });
  app.use(manejarErrores);
  return app;
}

module.exports = { crearServidor };
