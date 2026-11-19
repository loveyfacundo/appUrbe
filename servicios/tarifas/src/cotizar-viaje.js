const crypto = require('node:crypto');
const { ErrorDeValidacion } = require('../../viajes/src/dominio/errores/errores');
const { calcularTarifa, haversineKm } = require('./calcular-tarifa');

class CotizarViaje {
  constructor({ tiempoEstimadoMinutos = 30, vigenciaMs = 5 * 60 * 1000, ahora = () => new Date() } = {}) {
    this.tiempoEstimadoMinutos = tiempoEstimadoMinutos;
    this.vigenciaMs = vigenciaMs;
    this.ahora = ahora;
  }

  ejecutar({ origin, destination }) {
    if (!origin || !destination) {
      throw new ErrorDeValidacion('origin y destination son obligatorios');
    }
    const distanciaKm = haversineKm(origin, destination);
    const tarifa = calcularTarifa({
      distanciaKm,
      tiempoMinutos: this.tiempoEstimadoMinutos
    });
    const emitidaEn = this.ahora();
    return {
      quoteId: crypto.randomUUID(),
      origin,
      destination,
      distanceKm: Number(distanciaKm.toFixed(3)),
      estimatedMinutes: this.tiempoEstimadoMinutos,
      amount: tarifa.amount,
      currency: tarifa.currency,
      issuedAt: emitidaEn.toISOString(),
      expiresAt: new Date(emitidaEn.getTime() + this.vigenciaMs).toISOString()
    };
  }
}

module.exports = { CotizarViaje };
