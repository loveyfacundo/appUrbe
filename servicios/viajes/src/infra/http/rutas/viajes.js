const express = require('express');
const { crearControladorViajes } = require('../controladores/viajes');

function crearRutasViajes({ casosUso, autenticar }) {
  const router = express.Router();
  const controlador = crearControladorViajes(casosUso);
  router.use(autenticar);
  router.get('/historial/pasajero', controlador.historialPasajero);
  router.get('/historial/conductor', controlador.historialConductor);
  router.get('/operador/en-curso', controlador.viajesEnCurso);
  router.post('/', controlador.solicitar);
  router.get('/:tripId', controlador.obtener);
  router.post('/:tripId/cancelacion', controlador.cancelar);
  router.post('/:tripId/asignacion', controlador.aceptarAsignacion);
  router.patch('/:tripId/estado', controlador.actualizarEstado);
  return router;
}

module.exports = { crearRutasViajes };
