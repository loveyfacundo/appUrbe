const express = require('express');
const { crearModuloViajes } = require('./composicion');
const { crearAutenticacionJwt } = require('./infra/http/middlewares/autenticacion-jwt');
const { establecerCorrelacion } = require('./infra/http/middlewares/correlacion');
const { manejarErrores } = require('./infra/http/middlewares/manejo-errores');
const { crearRutasViajes } = require('./infra/http/rutas/viajes');
const { ErrorDeDominio } = require('./dominio/errores/errores');
const { crearVerificadorPostgres } = require('./infra/db/verificador-postgres');
const { CotizarViaje } = require('../../tarifas/src/cotizar-viaje');
const { crearRutasTarifas } = require('../../tarifas/src/rutas-tarifas');
const { ServicioIdentidad } = require('../../identidad/src/servicio-identidad');
const { crearRutasIdentidad } = require('../../identidad/src/rutas-identidad');
const { ServicioFlota } = require('../../conductores/src/servicio-flota');
const { crearRutasFlota } = require('../../conductores/src/rutas-flota');
const { RepositorioIdentidadPostgres } = require('../../identidad/src/repositorio-identidad');
const {
  RepositorioFlotaMemoria,
  RepositorioFlotaPostgres
} = require('../../conductores/src/repositorio-flota');
const { ConsultarSeguimientoViaje } = require('./dominio/casos-uso/consultar-seguimiento-viaje');

function crearServidor({
  modulo,
  secret = process.env.JWT_SECRET,
  identityBootstrapToken = process.env.IDENTITY_BOOTSTRAP_TOKEN,
  intervaloSeguimientoMs = 1000,
  verificadorPostgres,
  repositorioFlota: repositorioFlotaInyectado
} = {}) {
  const moduloReal = modulo || crearModuloViajes();
  const verificadorReal = verificadorPostgres ||
    crearVerificadorPostgres({ pool: moduloReal.pool || undefined });
  const app = express();
  const repositorioFlota = repositorioFlotaInyectado || (moduloReal.pool
    ? new RepositorioFlotaPostgres({ pool: moduloReal.pool })
    : new RepositorioFlotaMemoria());
  const servicioFlota = new ServicioFlota({ repositorio: repositorioFlota });
  const consultarSeguimiento = new ConsultarSeguimientoViaje({
    repositorioViajes: moduloReal.repositorio,
    repositorioUbicaciones: repositorioFlota
  });
  app.locals.modulo = moduloReal;
  app.locals.servicioFlota = servicioFlota;
  app.locals.repositorioFlota = repositorioFlota;
  app.locals.verificadorPostgres = verificadorReal;
  app.use((req, res, next) => {
    if (req.path === '/api/v1/viajes' ||
        req.path.startsWith('/api/v1/viajes/') ||
        req.path === '/api/v1/tarifas' ||
        req.path.startsWith('/api/v1/tarifas/') ||
        req.path.startsWith('/api/v1/identidad') ||
        req.path.startsWith('/api/v1/conductores') ||
        req.path.startsWith('/api/v1/flota')) {
      return establecerCorrelacion(req, res, next);
    }
    return next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    const dependencies = {};
    try {
      await verificadorReal.verificar();
      dependencies.postgres = 'ok';
      for (const dependency of await moduloReal.verificar?.() || []) {
        dependencies[dependency] = 'ok';
      }
      return res.status(200).json({ status: 'ok', dependencies });
    } catch (error) {
      dependencies[error.dependencia || 'postgres'] = 'unavailable';
      console.error('Una dependencia no está disponible', error);
      return res.status(503).json({
        status: 'unavailable',
        dependencies
      });
    }
  });
  app.use('/api/v1/viajes', crearRutasViajes({
    casosUso: {
      ...moduloReal.casosUso,
      consultarSeguimiento
    },
    autenticar: crearAutenticacionJwt(secret),
    intervaloSeguimientoMs
  }));
  app.use('/api/v1/tarifas', crearRutasTarifas({
    cotizador: new CotizarViaje(),
    autenticar: crearAutenticacionJwt(secret)
  }));
  const autenticarIdentidad = crearAutenticacionJwt(secret);
  app.use('/api/v1/identidad', crearRutasIdentidad({
    servicio: new ServicioIdentidad({
      secret,
      repositorio: moduloReal.pool
        ? new RepositorioIdentidadPostgres({ pool: moduloReal.pool })
        : undefined
    }),
    autenticar: autenticarIdentidad,
    tokenAltaInicial: identityBootstrapToken
  }));
  app.use(['/api/v1/conductores', '/api/v1/flota'], crearRutasFlota({
    servicio: servicioFlota,
    autenticar: autenticarIdentidad
  }));
  app.use('/api/v1/viajes', (req, res, next) => {
    next(new ErrorDeDominio('NOT_FOUND', 'La ruta solicitada no existe', 404));
  });
  app.use(manejarErrores);
  return app;
}

module.exports = { crearServidor };
