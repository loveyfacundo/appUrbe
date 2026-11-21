const express = require('express');
const crypto = require('node:crypto');
const { exigirRol } = require('./servicio-identidad');
const {
  ErrorDeDominio,
  OperacionNoPermitida
} = require('../../viajes/src/dominio/errores/errores');

function compararSecreto(recibido, esperado) {
  if (typeof recibido !== 'string' || typeof esperado !== 'string') return false;
  const recibidoHash = crypto.createHash('sha256').update(recibido).digest();
  const esperadoHash = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(recibidoHash, esperadoHash);
}

function crearRutasIdentidad({ servicio, autenticar, tokenAltaInicial = process.env.IDENTITY_BOOTSTRAP_TOKEN }) {
  const router = express.Router();

  router.post('/bootstrap/administrador', async (req, res, next) => {
    try {
      if (!tokenAltaInicial) {
        throw new ErrorDeDominio('SERVICE_UNAVAILABLE', 'El alta inicial de administrador no está configurada', 503);
      }
      if (!compararSecreto(req.get('x-bootstrap-token'), tokenAltaInicial)) {
        throw new ErrorDeDominio('UNAUTHORIZED', 'Token de alta inicial inválido', 401);
      }
      const sesion = await servicio.registrarAdministradorInicial({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password
      });
      res.status(201).json(sesion);
    } catch (error) {
      next(error);
    }
  });

  router.post(['/registro', '/registrar', '/auth/register'], async (req, res, next) => {
    try {
      const role = req.body.role || 'pasajero';
      if (['administrador', 'operador'].includes(role)) {
        throw new OperacionNoPermitida('El alta de roles privilegiados requiere autenticación de administrador');
      }
      const sesion = await servicio.registrar({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
        role
      });
      res.status(201).json(sesion);
    } catch (error) {
      next(error);
    }
  });

  router.post(['/login', '/auth/login'], async (req, res, next) => {
    try {
      res.status(200).json(await servicio.login({
        email: req.body.email,
        password: req.body.password
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/usuarios', autenticar, async (req, res, next) => {
    try {
      exigirRol(req.actor, ['administrador']);
      const sesion = await servicio.registrar({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
        role: req.body.role
      });
      res.status(201).json(sesion);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasIdentidad };
