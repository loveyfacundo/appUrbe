const crypto = require('node:crypto');
const { DependenciaNoDisponible } = require('../../dominio/errores/errores');

const LIBERAR_BLOQUEO = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

class BloqueadorRedis {
  constructor({ client, tiempoVidaMs = 10000, intentos = 10, esperaMs = 50 }) {
    this.client = client;
    this.tiempoVidaMs = tiempoVidaMs;
    this.intentos = intentos;
    this.esperaMs = esperaMs;
    this.conexion = null;
  }

  async conectar() {
    if (this.client.isReady) return;
    if (!this.conexion) {
      this.conexion = this.client.connect().catch(() => {
        this.conexion = null;
        throw new DependenciaNoDisponible('Redis no está disponible para adquirir el bloqueo');
      });
    }
    await this.conexion;
  }

  async verificar() {
    await this.conectar();
    await this.client.ping();
  }

  async ejecutar(clave, trabajo) {
    await this.conectar();
    const valor = crypto.randomUUID();
    let adquirido = false;
    for (let intento = 0; intento < this.intentos; intento += 1) {
      try {
        adquirido = await this.client.set(clave, valor, {
          NX: true,
          PX: this.tiempoVidaMs
        }) === 'OK';
      } catch {
        throw new DependenciaNoDisponible('Redis no pudo adquirir el bloqueo');
      }
      if (adquirido) break;
      if (intento + 1 < this.intentos) {
        await new Promise((resolve) => setTimeout(resolve, this.esperaMs));
      }
    }
    if (!adquirido) {
      throw new DependenciaNoDisponible('La operación ya está siendo procesada');
    }

    try {
      return await trabajo();
    } finally {
      try {
        await this.client.eval(LIBERAR_BLOQUEO, {
          keys: [clave],
          arguments: [valor]
        });
      } catch {
        throw new DependenciaNoDisponible('Redis no pudo liberar el bloqueo');
      }
    }
  }
}

module.exports = { BloqueadorRedis };
