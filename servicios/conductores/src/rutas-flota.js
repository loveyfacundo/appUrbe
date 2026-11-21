const express = require('express');
const { ErrorDeValidacion } = require('../../viajes/src/dominio/errores/errores');

function crearRutasFlota({ servicio, autenticar }) {
  const router = express.Router();

  router.use(autenticar);

  router.post('/perfil', async (req, res, next) => {
    try {
      res.status(201).json(await servicio.crearPerfil({
        actor: req.actor,
        licenseNumber: req.body.licenseNumber,
        licenseExpiresAt: req.body.licenseExpiresAt
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post(['/vehiculos', '/:conductorId/vehiculo'], async (req, res, next) => {
    try {
      const actor = req.actor;
      const conductorId = req.params.conductorId || actor.identificador;
      res.status(201).json(await servicio.registrarVehiculo({
        actor,
        conductorId,
        plate: req.body.plate,
        brand: req.body.brand,
        model: req.body.model,
        year: req.body.year,
        capacity: req.body.capacity
      }));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:conductorId/habilitacion', async (req, res, next) => {
    try {
      res.status(200).json(await servicio.habilitar({
        actor: req.actor,
        conductorId: req.params.conductorId,
        habilitado: req.body.enabled
      }));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:conductorId/disponibilidad', async (req, res, next) => {
    try {
      res.status(200).json(await servicio.cambiarDisponibilidad({
        actor: req.actor,
        conductorId: req.params.conductorId,
        disponible: req.body.available
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:conductorId/ubicacion', async (req, res, next) => {
    try {
      res.status(200).json(await servicio.actualizarUbicacion({
        actor: req.actor,
        conductorId: req.params.conductorId,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        accuracyMeters: req.body.accuracyMeters ?? null
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/disponibles', async (req, res, next) => {
    try {
      res.status(200).json(await servicio.listarDisponibles({ actor: req.actor }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:conductorId/habilitacion', async (req, res, next) => {
    try {
      res.status(200).json(await servicio.validarHabilitacion(
        req.params.conductorId,
        req.actor
      ));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasFlota };
