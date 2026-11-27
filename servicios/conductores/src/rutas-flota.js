const express = require('express');

function conManejoDeErrores(manejador) {
  return async (req, res, next) => {
    try {
      await manejador(req, res);
    } catch (error) {
      next(error);
    }
  };
}

function crearRutasFlota({ servicio, autenticar }) {
  const router = express.Router();

  router.use(autenticar);

  router.post('/perfil', conManejoDeErrores(async (req, res) => {
    res.status(201).json(await servicio.crearPerfil({
      actor: req.actor,
      licenseNumber: req.body.licenseNumber,
      licenseExpiresAt: req.body.licenseExpiresAt
    }));
  }));

  router.post(['/vehiculos', '/:conductorId/vehiculo'], conManejoDeErrores(async (req, res) => {
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
  }));

  router.patch('/:conductorId/habilitacion', conManejoDeErrores(async (req, res) => {
    res.status(200).json(await servicio.habilitar({
      actor: req.actor,
      conductorId: req.params.conductorId,
      habilitado: req.body.enabled
    }));
  }));

  router.patch('/:conductorId/disponibilidad', conManejoDeErrores(async (req, res) => {
    res.status(200).json(await servicio.cambiarDisponibilidad({
      actor: req.actor,
      conductorId: req.params.conductorId,
      disponible: req.body.available
    }));
  }));

  router.post('/:conductorId/ubicacion', conManejoDeErrores(async (req, res) => {
    res.status(200).json(await servicio.actualizarUbicacion({
      actor: req.actor,
      conductorId: req.params.conductorId,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      accuracyMeters: req.body.accuracyMeters ?? null
    }));
  }));

  router.get('/disponibles/cercanos', conManejoDeErrores(async (req, res) => {
    res.status(200).json(await servicio.listarCercanos({
      actor: req.actor,
      latitude: Number(req.query.latitude),
      longitude: Number(req.query.longitude),
      radiusMeters: req.query.radiusMeters === undefined
        ? 5000
        : Number(req.query.radiusMeters)
    }));
  }));

  router.get('/disponibles', conManejoDeErrores(async (req, res) => {
    res.status(200).json(await servicio.listarDisponibles({ actor: req.actor }));
  }));

  router.get('/:conductorId/habilitacion', conManejoDeErrores(async (req, res) => {
    res.status(200).json(await servicio.validarHabilitacion(
      req.params.conductorId,
      req.actor
    ));
  }));

  return router;
}

module.exports = { crearRutasFlota };
