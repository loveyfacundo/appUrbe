const { ESTADOS } = require('../../viajes/src/dominio/entidades/viaje');
const { DependenciaNoDisponible, ConflictoDeEstado } = require('../../viajes/src/dominio/errores/errores');

class GestorOfertas {
  constructor({ repositorioViajes, buscadorConductores, ttlMs = 20000, temporizador = setTimeout, reloj = () => Date.now() }) {
    this.repositorioViajes = repositorioViajes;
    this.buscadorConductores = buscadorConductores;
    this.ttlMs = ttlMs;
    this.temporizador = temporizador;
    this.reloj = reloj;
    this.ofertasActivas = new Map();
  }

  async iniciar({ identificadorViaje, candidatos = null }) {
    const viaje = await this.repositorioViajes.buscarPorId(identificadorViaje);
    if (!viaje) throw new ConflictoDeEstado('El viaje no existe');
    if (![ESTADOS.SOLICITADO, ESTADOS.DESPACHANDO].includes(viaje.estado)) {
      throw new ConflictoDeEstado('El viaje no admite despacho');
    }
    let conductores;
    try {
      conductores = candidatos || await this.buscadorConductores({ viaje });
    } catch (error) {
      throw new DependenciaNoDisponible('No se pudo consultar conductores disponibles');
    }
    if (!Array.isArray(conductores) || conductores.length === 0) {
      await this._marcarSinConductores(viaje);
      return { tripId: identificadorViaje, status: ESTADOS.SIN_CONDUCTOR, offer: null };
    }
    if (viaje.estado === ESTADOS.SOLICITADO) {
      viaje.despachar();
      await this.repositorioViajes.guardar(viaje);
    }
    return this._ofrecerAlSiguiente(viaje, conductores, 0);
  }

  async responder({ identificadorViaje, conductorId, aceptar }) {
    const viaje = await this.repositorioViajes.buscarPorId(identificadorViaje);
    if (!viaje) throw new ConflictoDeEstado('El viaje no existe');
    if (aceptar) {
      const oferta = this.ofertasActivas.get(identificadorViaje);
      if (!oferta) throw new ConflictoDeEstado('No hay una oferta activa para este viaje');
      if (oferta.candidatos[oferta.indice].id !== conductorId) {
        throw new ConflictoDeEstado('La oferta no corresponde al conductor');
      }
      this.ofertasActivas.delete(identificadorViaje);
      viaje.asignar(conductorId);
      await this.repositorioViajes.guardar(viaje);
      return { tripId: identificadorViaje, status: viaje.estado, driverId: conductorId };
    }
    const oferta = this.ofertasActivas.get(identificadorViaje);
    this.ofertasActivas.delete(identificadorViaje);
    if (!oferta) {
      throw new ConflictoDeEstado('No hay una oferta activa para este viaje');
    }
    viaje.despachar();
    await this.repositorioViajes.guardar(viaje);
    return this._ofrecerAlSiguiente(viaje, oferta.candidatos, oferta.indice + 1);
  }

  async _ofrecerAlSiguiente(viaje, conductores, indice) {
    if (indice >= conductores.length) {
      this.ofertasActivas.delete(viaje.identificador);
      await this._marcarSinConductores(viaje);
      return { tripId: viaje.identificador, status: ESTADOS.SIN_CONDUCTOR, offer: null };
    }
    const conductor = conductores[indice];
    const expiresAt = new Date(this.reloj() + this.ttlMs).toISOString();
    const oferta = { candidatos: conductores, indice };
    this.ofertasActivas.set(viaje.identificador, oferta);
    this.temporizador(() => {
      const activa = this.ofertasActivas.get(viaje.identificador);
      if (!activa || activa.indice !== indice) return;
      this.ofertasActivas.delete(viaje.identificador);
      this._ofrecerAlSiguiente(viaje, conductores, indice + 1).catch(() => {});
    }, this.ttlMs);
    return {
      tripId: viaje.identificador,
      status: ESTADOS.DESPACHANDO,
      offer: {
        driverId: conductor.id,
        expiresAt,
        ttlSeconds: Math.ceil(this.ttlMs / 1000)
      }
    };
  }

  async _marcarSinConductores(viaje) {
    if (viaje.estado === ESTADOS.SOLICITADO) viaje.despachar();
    viaje.marcarSinConductor();
    await this.repositorioViajes.guardar(viaje);
  }
}

module.exports = { GestorOfertas };
