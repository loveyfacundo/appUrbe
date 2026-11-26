const { ESTADOS } = require('../../viajes/src/dominio/entidades/viaje');
const { DependenciaNoDisponible, ConflictoDeEstado } = require('../../viajes/src/dominio/errores/errores');

class GestorOfertas {
  constructor({
    repositorioViajes,
    buscadorConductores,
    ttlMs = Number(process.env.OFFER_TTL_SECONDS ?? 20) * 1000,
    temporizador = setTimeout,
    cancelarTemporizador = clearTimeout,
    reloj = () => Date.now(),
    alFallarVencimiento = (error) => console.error('No se pudo procesar el vencimiento de una oferta', error)
  }) {
    if (!Number.isInteger(ttlMs) || ttlMs < 15000 || ttlMs > 30000) {
      throw new RangeError('El plazo de oferta debe estar entre 15000 y 30000 milisegundos');
    }
    this.repositorioViajes = repositorioViajes;
    this.buscadorConductores = buscadorConductores;
    this.ttlMs = ttlMs;
    this.temporizador = temporizador;
    this.cancelarTemporizador = cancelarTemporizador;
    this.reloj = reloj;
    this.alFallarVencimiento = alFallarVencimiento;
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
    if (typeof aceptar !== 'boolean') {
      throw new ConflictoDeEstado('La respuesta a la oferta debe ser aceptar o rechazar');
    }
    const oferta = this.ofertasActivas.get(identificadorViaje);
    if (!oferta) throw new ConflictoDeEstado('No hay una oferta activa para este viaje');
    if (oferta.candidatos[oferta.indice].id !== conductorId) {
      throw new ConflictoDeEstado('La oferta no corresponde al conductor');
    }
    if (this.reloj() >= oferta.expiresAtMs) {
      await this._expirar(identificadorViaje, oferta);
      throw new ConflictoDeEstado('La oferta venció');
    }
    if (viaje.estado !== ESTADOS.DESPACHANDO) {
      this._cancelarOferta(identificadorViaje, oferta);
      throw new ConflictoDeEstado('El viaje ya no admite respuestas a ofertas');
    }

    if (aceptar) {
      this._cancelarOferta(identificadorViaje, oferta);
      viaje.asignar(conductorId);
      await this.repositorioViajes.guardar(viaje);
      return { tripId: identificadorViaje, status: viaje.estado, driverId: conductorId };
    }
    this._cancelarOferta(identificadorViaje, oferta);
    return this._ofrecerAlSiguiente(viaje, oferta.candidatos, oferta.indice + 1);
  }

  _cancelarOferta(identificadorViaje, oferta) {
    if (this.ofertasActivas.get(identificadorViaje) !== oferta) return;
    this.ofertasActivas.delete(identificadorViaje);
    if (oferta.temporizador !== undefined) {
      this.cancelarTemporizador(oferta.temporizador);
    }
  }

  _programarVencimiento(identificadorViaje, oferta) {
    oferta.temporizador = this.temporizador(() => {
      return this._expirar(identificadorViaje, oferta).catch(this.alFallarVencimiento);
    }, Math.max(0, oferta.expiresAtMs - this.reloj()));
  }

  async _expirar(identificadorViaje, oferta) {
    if (this.ofertasActivas.get(identificadorViaje) !== oferta) return;
    const restanteMs = oferta.expiresAtMs - this.reloj();
    if (restanteMs > 0) {
      this._programarVencimiento(identificadorViaje, oferta);
      return;
    }

    this._cancelarOferta(identificadorViaje, oferta);
    const viaje = await this.repositorioViajes.buscarPorId(identificadorViaje);
    if (!viaje || viaje.estado !== ESTADOS.DESPACHANDO) return;
    await this._ofrecerAlSiguiente(viaje, oferta.candidatos, oferta.indice + 1);
  }

  async _ofrecerAlSiguiente(viaje, conductores, indice) {
    if (indice >= conductores.length) {
      this.ofertasActivas.delete(viaje.identificador);
      await this._marcarSinConductores(viaje);
      return { tripId: viaje.identificador, status: ESTADOS.SIN_CONDUCTOR, offer: null };
    }
    const conductor = conductores[indice];
    const expiresAtMs = this.reloj() + this.ttlMs;
    const oferta = { candidatos: conductores, indice, expiresAtMs };
    this.ofertasActivas.set(viaje.identificador, oferta);
    this._programarVencimiento(viaje.identificador, oferta);
    return {
      tripId: viaje.identificador,
      status: ESTADOS.DESPACHANDO,
      offer: {
        driverId: conductor.id,
        expiresAt: new Date(expiresAtMs).toISOString(),
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
