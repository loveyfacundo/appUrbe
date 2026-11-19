const crypto = require('node:crypto');
const { Viaje } = require('../entidades/viaje');
const {
  validarClaveYCorrelacion,
  verificarIdempotencia,
  metadataIdempotenciaOutbox,
  publicarYGuardar
} = require('./idempotencia-helper');

class SolicitarViaje {
  constructor({ repositorio, idempotencia, publicador }) {
    this.repositorio = repositorio;
    this.idempotencia = idempotencia;
    this.publicador = publicador;
  }

  async ejecutar({ pasajeroId, origen, destino, fechaProgramada = null, claveIdempotencia, idCorrelacion }) {
    validarClaveYCorrelacion(claveIdempotencia, idCorrelacion);
    const datos = { pasajeroId, origen, destino, fechaProgramada };
    const clave = `${pasajeroId}:${claveIdempotencia}`;
    const huellaActual = JSON.stringify(datos);

    const idempotente = await verificarIdempotencia(this.idempotencia, clave, huellaActual);
    if (idempotente.procesado) return idempotente.respuesta;

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
      metadataIdempotenciaOutbox(this.repositorio, this.idempotencia, clave, huellaActual)
    );

    return publicarYGuardar({
      repositorio: this.repositorio,
      publicador: this.publicador,
      idempotencia: this.idempotencia,
      evento,
      clave,
      huella: huellaActual,
      respuesta: viaje.toJSON()
    });
  }
}

module.exports = { SolicitarViaje };
