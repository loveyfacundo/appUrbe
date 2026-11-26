const {
  ESTADOS
} = require('../entidades/viaje');
const {
  RecursoNoEncontrado,
  OperacionNoPermitida,
  ConflictoDeEstado
} = require('../errores/errores');

const ESTADOS_ACTIVOS = [
  ESTADOS.ASIGNADO,
  ESTADOS.EN_ORIGEN,
  ESTADOS.EN_CURSO
];

class ConsultarSeguimientoViaje {
  constructor({ repositorioViajes, repositorioUbicaciones }) {
    this.repositorioViajes = repositorioViajes;
    this.repositorioUbicaciones = repositorioUbicaciones;
  }

  async consultarUbicacion({ identificadorViaje, actor }) {
    const viaje = await this._buscarViajeActivo(identificadorViaje);
    if (actor?.identificador !== viaje.pasajeroId) {
      throw new OperacionNoPermitida('Solo el pasajero del viaje puede consultar la ubicación del conductor');
    }
    if (!viaje.conductorId) {
      throw new ConflictoDeEstado('El viaje todavía no tiene un conductor asignado');
    }

    return {
      tripId: viaje.identificador,
      driverId: viaje.conductorId,
      status: viaje.estado,
      location: await this.repositorioUbicaciones.buscarUbicacion(viaje.conductorId)
    };
  }

  async consultarSeguimiento({ identificadorViaje, actor }) {
    const viaje = await this._buscarViajeActivo(identificadorViaje);
    if (!actor?.roles?.includes('chofer') ||
        actor.identificador !== viaje.conductorId) {
      throw new OperacionNoPermitida('Solo el conductor asignado puede consultar el seguimiento del viaje');
    }
    return viaje.toJSON();
  }

  async _buscarViajeActivo(identificadorViaje) {
    const viaje = await this.repositorioViajes.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    if (!ESTADOS_ACTIVOS.includes(viaje.estado)) {
      throw new ConflictoDeEstado('El seguimiento solo está disponible para viajes activos');
    }
    return viaje;
  }
}

module.exports = { ConsultarSeguimientoViaje };
