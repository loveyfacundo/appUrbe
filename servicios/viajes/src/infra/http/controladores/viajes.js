const { validarUuid } = require('../../../dominio/entidades/viaje');
const {
  validarClaveIdempotencia,
  validarSolicitudViaje,
  validarCancelacion,
  validarActualizacionEstado
} = require('../validadores/viajes');

function aContrato(viaje) {
  return {
    id: viaje.identificador,
    passengerId: viaje.pasajeroId,
    driverId: viaje.conductorId,
    origin: {
      latitude: viaje.origen.latitud,
      longitude: viaje.origen.longitud,
      address: viaje.origen.direccion
    },
    destination: {
      latitude: viaje.destino.latitud,
      longitude: viaje.destino.longitud,
      address: viaje.destino.direccion
    },
    status: viaje.estado,
    scheduledAt: viaje.fechaProgramada,
    createdAt: viaje.creadoEn,
    updatedAt: viaje.actualizadoEn
  };
}

function crearControladorViajes(casosUso) {
  return {
    solicitar: async (req, res) => {
      validarClaveIdempotencia(req.get('idempotency-key'));
      validarSolicitudViaje(req.body);
      const viaje = await casosUso.solicitar.ejecutar({
        pasajeroId: req.actor.identificador,
        origen: {
          latitud: req.body.origin.latitude,
          longitud: req.body.origin.longitude,
          direccion: req.body.origin.address
        },
        destino: {
          latitud: req.body.destination.latitude,
          longitud: req.body.destination.longitude,
          direccion: req.body.destination.address
        },
        fechaProgramada: req.body.scheduledAt ?? null,
        claveIdempotencia: req.get('idempotency-key'),
        idCorrelacion: req.idCorrelacion
      });
      return res.status(201).json(aContrato(viaje));
    },

    obtener: async (req, res) => {
      validarUuid(req.params.tripId, 'tripId');
      const viaje = await casosUso.obtener.ejecutar({
        identificadorViaje: req.params.tripId,
        actor: req.actor
      });
      return res.status(200).json(aContrato(viaje));
    },

    cancelar: async (req, res) => {
      validarUuid(req.params.tripId, 'tripId');
      validarClaveIdempotencia(req.get('idempotency-key'));
      validarCancelacion(req.body);
      const viaje = await casosUso.cancelar.ejecutar({
        identificadorViaje: req.params.tripId,
        actor: req.actor,
        motivo: req.body.reason,
        claveIdempotencia: req.get('idempotency-key'),
        idCorrelacion: req.idCorrelacion
      });
      return res.status(200).json(aContrato(viaje));
    },

    actualizarEstado: async (req, res) => {
      validarUuid(req.params.tripId, 'tripId');
      validarActualizacionEstado(req.body);
      const viaje = await casosUso.actualizarEstado.ejecutar({
        identificadorViaje: req.params.tripId,
        actor: req.actor,
        estado: req.body.status,
        idCorrelacion: req.idCorrelacion
      });
      return res.status(200).json(aContrato(viaje));
    }
  };
}

module.exports = { crearControladorViajes };
