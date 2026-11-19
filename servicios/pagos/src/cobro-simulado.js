const crypto = require('node:crypto');
const { ErrorDeValidacion, ConflictoDeEstado } = require('../../viajes/src/dominio/errores/errores');

class CobroSimulado {
  constructor({ repositorio } = {}) {
    this.repositorio = repositorio;
    this.cobros = new Map();
  }

  async capturar({ tripId, passengerId, amount, currency = 'ARS', claveIdempotencia }) {
    if (!tripId || !passengerId) {
      throw new ErrorDeValidacion('tripId y passengerId son obligatorios');
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ErrorDeValidacion('amount debe ser un entero positivo');
    }
    if (!claveIdempotencia) {
      throw new ErrorDeValidacion('claveIdempotencia es obligatoria');
    }
    const existente = this.cobros.get(claveIdempotencia);
    if (existente) {
      if (existente.tripId !== tripId || existente.amount !== amount) {
        throw new ConflictoDeEstado('La clave de idempotencia fue reutilizada con otro cobro');
      }
      return existente;
    }
    const cobro = {
      id: crypto.randomUUID(),
      tripId,
      passengerId,
      amount,
      currency,
      status: 'CAPTURED',
      capturedAt: new Date().toISOString()
    };
    this.cobros.set(claveIdempotencia, cobro);
    if (this.repositorio?.guardar) {
      await this.repositorio.guardar(cobro);
    }
    return cobro;
  }

  async buscarPorViaje(tripId) {
    if (this.repositorio?.buscarPorViaje) {
      return this.repositorio.buscarPorViaje(tripId);
    }
    return [...this.cobros.values()].find((cobro) => cobro.tripId === tripId) || null;
  }
}

module.exports = { CobroSimulado };
