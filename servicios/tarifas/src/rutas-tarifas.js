const express = require('express');
const { validarSolicitudViaje } = require('../../viajes/src/infra/http/validadores/viajes');

function crearRutasTarifas({ cotizador, autenticar }) {
  const router = express.Router();
  router.use(autenticar);
  router.post('/estimacion', (req, res) => {
    validarSolicitudViaje({
      origin: req.body.origin,
      destination: req.body.destination,
      scheduledAt: req.body.scheduledAt ?? null
    });
    const cotizacion = cotizador.ejecutar({
      origin: req.body.origin,
      destination: req.body.destination
    });
    res.status(200).json(cotizacion);
  });
  return router;
}

module.exports = { crearRutasTarifas };
