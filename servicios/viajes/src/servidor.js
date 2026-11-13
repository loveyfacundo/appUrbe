const express = require('express');
const { crearModuloViajes } = require('./composicion');
const { crearAutenticacionJwt } = require('./infra/http/middlewares/autenticacion-jwt');
const { establecerCorrelacion } = require('./infra/http/middlewares/correlacion');
const { manejarErrores } = require('./infra/http/middlewares/manejo-errores');
const { crearRutasViajes } = require('./infra/http/rutas/viajes');
const { ErrorDeDominio } = require('./dominio/errores/errores');
const { crearVerificadorPostgres } = require('./infra/db/verificador-postgres');

function crearServidor({
  modulo,
  secret = process.env.JWT_SECRET,
  verificadorPostgres
} = {}) {
  const moduloReal = modulo || crearModuloViajes();
  const verificadorReal = verificadorPostgres ||
    crearVerificadorPostgres({ pool: moduloReal.pool || undefined });
  const app = express();
  app.locals.modulo = moduloReal;
  app.locals.verificadorPostgres = verificadorReal;
  app.use((req, res, next) => {
    if (req.path === '/api/v1/viajes' || req.path.startsWith('/api/v1/viajes/')) {
      return establecerCorrelacion(req, res, next);
    }
    return next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    try {
      await verificadorReal.verificar();
      return res.status(200).json({ status: 'ok', dependencies: { postgres: 'ok' } });
    } catch (error) {
      console.error('PostgreSQL no está disponible', error);
      return res.status(503).json({
        status: 'unavailable',
        dependencies: { postgres: 'unavailable' }
      });
    }
  });
  app.use('/api/v1/viajes', crearRutasViajes({
    casosUso: moduloReal.casosUso,
    autenticar: crearAutenticacionJwt(secret)
  }));
  app.use('/api/v1/viajes', (req, res, next) => {
    next(new ErrorDeDominio('NOT_FOUND', 'La ruta solicitada no existe', 404));
  });
  app.use(manejarErrores);
  return app;
}

module.exports = { crearServidor };
