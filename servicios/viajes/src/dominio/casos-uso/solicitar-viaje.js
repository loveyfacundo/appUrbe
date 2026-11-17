const crypto = require('node:crypto');
const { Viaje } = require('../entidades/viaje');
const { ErrorDeValidacion, ConflictoDeEstado } = require('../errores/errores');

function huella(datos) {
  return JSON.stringify(datos);
}

class SolicitarViaje {
  constructor({ repositorio, idempotencia, publicador }) {
    this.repositorio = repositorio;
    this.idempotencia = idempotencia;
    this.publicador = publicador;
  }

  async ejecutar({ pasajeroId, origen, destino, fechaProgramada = null, claveIdempotencia, idCorrelacion }) {
    if (!claveIdempotencia || !idCorrelacion) {
      throw new ErrorDeValidacion('claveIdempotencia e idCorrelacion son obligatorios');
    }
    const datos = { pasajeroId, origen, destino, fechaProgramada };
    const clave = `${pasajeroId}:${claveIdempotencia}`;
    const anterior = await this.idempotencia.buscar(clave);
    const huellaActual = huella(datos);
    if (anterior) {
      if (anterior.huella !== huellaActual) {
        throw new ConflictoDeEstado('La clave de idempotencia fue reutilizada con otro request');
      }
      return anterior.respuesta;
    }
    const viaje = new Viaje({ identificador: crypto.randomUUID(), ...datos });
    const evento = this.publicador.crearEvento('TripRequested', {
      tripId: viaje.identificador,
      passengerId: viaje.pasajeroId,
      origin: { latitude: viaje.origen.latitud, longitude: viaje.origen.longitud, address: viaje.origen.direccion },
      destination: { latitude: viaje.destino.latitud, longitude: viaje.destino.longitud, address: viaje.destino.direccion }
    }, { idCorrelacion });
    await this.repositorio.guardar(
      viaje,
      this.repositorio.persisteOutbox ? evento : undefined,
      this.repositorio.persisteOutbox ? {
        clave,
        huella: huellaActual,
        tiempoVidaMs: this.idempotencia.tiempoVidaMs
      } : undefined
    );
    if (!this.repositorio.persisteOutbox) await this.publicador.publicar(evento);
    const respuesta = viaje.toJSON();
    await this.idempotencia.guardar(clave, huellaActual, respuesta);
    return respuesta;
  }
}

module.exports = { SolicitarViaje };
