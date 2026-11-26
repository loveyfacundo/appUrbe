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

const ROLES_CONDUCTOR = ['conductor', 'chofer'];

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

  async obtenerInstantanea({ identificadorViaje, actor }) {
    const viaje = await this.repositorioViajes.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();

    const esPasajero = actor?.identificador === viaje.pasajeroId;
    const esConductorAsignado = actor?.identificador === viaje.conductorId &&
      actor.roles?.some((rol) => ROLES_CONDUCTOR.includes(rol));
    if (!esPasajero && !esConductorAsignado) {
      throw new OperacionNoPermitida('Solo el pasajero y el conductor asignado pueden seguir este viaje');
    }

    return {
      tripId: viaje.identificador,
      status: viaje.estado,
      driverId: viaje.conductorId,
      location: viaje.conductorId
        ? await this.repositorioUbicaciones.buscarUbicacion(viaje.conductorId)
        : null,
      updatedAt: viaje.actualizadoEn
    };
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
