const { validarUuid, ESTADOS } = require('../../../dominio/entidades/viaje');
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

function extraerParamsEjecucion(req) {
  validarUuid(req.params.tripId, 'tripId');
  validarClaveIdempotencia(req.get('idempotency-key'));
  return {
    identificadorViaje: req.params.tripId,
    actor: req.actor,
    claveIdempotencia: req.get('idempotency-key'),
    idCorrelacion: req.idCorrelacion
  };
}

const ESTADOS_TERMINALES = new Set([
  ESTADOS.FINALIZADO,
  ESTADOS.CANCELADO,
  ESTADOS.CANCELADO_PASAJERO,
  ESTADOS.CANCELADO_CHOFER,
  ESTADOS.SIN_CONDUCTOR
]);

function formatearEventoSse(tipo, identificador, datos) {
  return `id: ${identificador}\nevent: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`;
}

function crearControladorViajes(casosUso, { intervaloSeguimientoMs = 1000 } = {}) {
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

    ubicacionChofer: async (req, res) => {
      validarUuid(req.params.tripId, 'tripId');
      const seguimiento = await casosUso.consultarSeguimiento.consultarUbicacion({
        identificadorViaje: req.params.tripId,
        actor: req.actor
      });
      return res.status(200).json(seguimiento);
    },

    seguimientoConductor: async (req, res) => {
      validarUuid(req.params.tripId, 'tripId');
      const viaje = await casosUso.consultarSeguimiento.consultarSeguimiento({
        identificadorViaje: req.params.tripId,
        actor: req.actor
      });
      return res.status(200).json(aContrato(viaje));
    },

    eventosSeguimiento: async (req, res) => {
      validarUuid(req.params.tripId, 'tripId');
      const consultarInstantanea = () => casosUso.consultarSeguimiento.obtenerInstantanea({
        identificadorViaje: req.params.tripId,
        actor: req.actor
      });
      const inicial = await consultarInstantanea();
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      let numeroEvento = 1;
      let ultimaInstantanea = JSON.stringify(inicial);
      res.write(`retry: 1000\n${formatearEventoSse('snapshot', numeroEvento, inicial)}`);

      if (ESTADOS_TERMINALES.has(inicial.status)) {
        return res.end();
      }

      let consultando = false;
      const temporizador = setInterval(async () => {
        if (consultando || res.writableNeedDrain || res.writableEnded) return;
        consultando = true;
        try {
          const actual = await consultarInstantanea();
          const serializada = JSON.stringify(actual);
          if (serializada !== ultimaInstantanea) {
            ultimaInstantanea = serializada;
            numeroEvento += 1;
            res.write(formatearEventoSse('update', numeroEvento, actual));
            if (ESTADOS_TERMINALES.has(actual.status)) {
              clearInterval(temporizador);
              res.end();
            }
          }
        } catch (error) {
          console.error('No se pudo actualizar el seguimiento SSE', error);
          clearInterval(temporizador);
          if (!res.writableEnded) {
            res.write(formatearEventoSse('error', numeroEvento + 1, {
              message: 'El seguimiento dejó de estar disponible'
            }));
            res.end();
          }
        } finally {
          consultando = false;
        }
      }, intervaloSeguimientoMs);
      res.on('close', () => clearInterval(temporizador));
    },

    cancelar: async (req, res) => {
      validarCancelacion(req.body);
      const viaje = await casosUso.cancelar.ejecutar({
        ...extraerParamsEjecucion(req),
        motivo: req.body.reason
      });
      return res.status(200).json(aContrato(viaje));
    },

    actualizarEstado: async (req, res) => {
      validarActualizacionEstado(req.body);
      const viaje = await casosUso.actualizarEstado.ejecutar({
        ...extraerParamsEjecucion(req),
        estado: req.body.status,
        distanciaRealKm: req.body.distanceKm,
        tiempoRealMin: req.body.durationMinutes
      });
      return res.status(200).json(aContrato(viaje));
    },

    aceptarAsignacion: async (req, res) => {
      const viaje = await casosUso.aceptarAsignacion.ejecutar(extraerParamsEjecucion(req));
      return res.status(200).json(aContrato(viaje));
    },

    historialPasajero: async (req, res) => {
      const viajes = await casosUso.consultarHistorial.ejecutar({
        actor: req.actor,
        filtro: 'pasajero'
      });
      return res.status(200).json(viajes.map(aContrato));
    },

    historialConductor: async (req, res) => {
      const viajes = await casosUso.consultarHistorial.ejecutar({
        actor: req.actor,
        filtro: 'conductor'
      });
      return res.status(200).json(viajes.map(aContrato));
    },

    viajesEnCurso: async (req, res) => {
      const viajes = await casosUso.consultarViajesEnCurso.ejecutar({
        actor: req.actor
      });
      return res.status(200).json(viajes.map(aContrato));
    }
  };
}

module.exports = { crearControladorViajes };
