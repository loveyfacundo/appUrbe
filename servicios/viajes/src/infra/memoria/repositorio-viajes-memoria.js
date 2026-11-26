const { RepositorioViajes } = require('../../dominio/puertos/repositorio-viajes');
const {
  RecursoNoEncontrado,
  OperacionNoPermitida,
  ConflictoDeEstado
} = require('../../dominio/errores/errores');
const { ESTADOS } = require('../../dominio/entidades/viaje');
const { crearPoliticaCancelacionesDesdeEntorno } = require('../../dominio/politica-cancelaciones');

class RepositorioViajesMemoria extends RepositorioViajes {
  constructor({ politicaCancelaciones = crearPoliticaCancelacionesDesdeEntorno() } = {}) {
    super();
    this.viajes = new Map();
    this.politicaCancelaciones = politicaCancelaciones;
    this.cancelacionesPorUsuario = new Map();
    this.bloqueosCancelacion = new Map();
  }

  async guardar(viaje) {
    if (!this.viajes.has(viaje.identificador)) {
      this.verificarSinBloqueoCancelaciones(viaje.pasajeroId);
    }
    this.viajes.set(viaje.identificador, viaje);
    return viaje;
  }

  async buscarPorId(id) {
    return this.viajes.get(id) || null;
  }

  async asignarConductor({ identificadorViaje, conductorId }) {
    this.verificarSinBloqueoCancelaciones(conductorId);
    const viaje = this.viajes.get(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    const ocupado = [...this.viajes.values()].some((otro) =>
      otro.conductorId === conductorId &&
      [ESTADOS.ASIGNADO, ESTADOS.EN_ORIGEN, ESTADOS.EN_CURSO].includes(otro.estado)
    );
    if (ocupado) {
      throw new ConflictoDeEstado('El conductor ya tiene un viaje activo');
    }
    viaje.asignar(conductorId);
    return this.guardar(viaje);
  }

  verificarSinBloqueoCancelaciones(usuarioId) {
    const bloqueadoHasta = this.bloqueosCancelacion.get(usuarioId);
    if (bloqueadoHasta && bloqueadoHasta > Date.now()) {
      throw new ConflictoDeEstado(
        `Usuario bloqueado para nuevas operaciones hasta ${new Date(bloqueadoHasta).toISOString()}`
      );
    }
  }

  async cancelarViaje({
    identificadorViaje,
    actor,
    motivo,
    politicaCancelaciones = this.politicaCancelaciones
  }) {
    const actorId = actor.identificador;
    const viaje = this.viajes.get(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    const decision = politicaCancelaciones.resolver({ viaje, actor });
    const ahora = Date.now();
    const bloqueadoHasta = this.bloqueosCancelacion.get(actorId);
    if (decision.cuentaParaLimite &&
        (!bloqueadoHasta || bloqueadoHasta <= ahora)) {
      const cancelaciones = (this.cancelacionesPorUsuario.get(actorId) || [])
        .filter((timestamp) => timestamp > ahora - politicaCancelaciones.periodoCancelacionesMs);
      if (cancelaciones.length >= politicaCancelaciones.limiteCancelaciones) {
        const bloqueadoHasta = ahora + politicaCancelaciones.bloqueoCancelacionesMs;
        this.bloqueosCancelacion.set(actorId, bloqueadoHasta);
        throw new ConflictoDeEstado(
          `Límite de cancelaciones excedido; usuario bloqueado hasta ${new Date(bloqueadoHasta).toISOString()}`
        );
      }
    }
    if (decision.estadoFinal === ESTADOS.CANCELADO_CHOFER) viaje.cancelarPorChofer();
    else if (decision.estadoFinal === ESTADOS.CANCELADO_PASAJERO) viaje.cancelarPorPasajero();
    else viaje.cancelarPorOperador();
    viaje.cancelacion = {
      actorTipo: decision.tipoActor,
      actorId,
      estadoAnterior: decision.estadoAnterior,
      penalidadArs: decision.penalidadArs,
      moneda: 'ARS',
      motivo,
      ocurridoEn: viaje.actualizadoEn
    };
    if (decision.cuentaParaLimite) {
      const cancelaciones = this.cancelacionesPorUsuario.get(actorId) || [];
      cancelaciones.push(ahora);
      this.cancelacionesPorUsuario.set(actorId, cancelaciones);
    }
    this.viajes.set(viaje.identificador, viaje);
    return viaje;
  }

  async actualizarEstadoOperativo({ identificadorViaje, actorId, estado }) {
    const viaje = await this.buscarPorId(identificadorViaje);
    if (!viaje) throw new RecursoNoEncontrado();
    if (viaje.conductorId !== actorId) {
      throw new OperacionNoPermitida('Solo el conductor asignado puede actualizar el estado');
    }
    if (estado === ESTADOS.EN_ORIGEN) viaje.llegarAlOrigen(actorId);
    if (estado === ESTADOS.EN_CURSO) viaje.iniciarEnCurso(actorId);
    if (estado === ESTADOS.FINALIZADO) viaje.finalizar(actorId);
    return this.guardar(viaje);
  }

  async limpiar() {
    this.viajes.clear();
    this.cancelacionesPorUsuario.clear();
    this.bloqueosCancelacion.clear();
  }

  async buscarHistorialPasajero(pasajeroId) {
    return [...this.viajes.values()].filter((viaje) => viaje.pasajeroId === pasajeroId);
  }

  async buscarHistorialConductor(conductorId) {
    return [...this.viajes.values()].filter((viaje) => viaje.conductorId === conductorId);
  }

  async buscarEnCurso() {
    return [...this.viajes.values()].filter((viaje) =>
      [ESTADOS.ASIGNADO, ESTADOS.EN_ORIGEN, ESTADOS.EN_CURSO].includes(viaje.estado)
    );
  }
}

module.exports = { RepositorioViajesMemoria };
