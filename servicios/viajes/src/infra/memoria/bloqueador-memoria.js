class BloqueadorMemoria {
  constructor() {
    this.bloqueos = new Map();
  }

  async ejecutar(clave, trabajo) {
    const anterior = this.bloqueos.get(clave) || Promise.resolve();
    let liberar;
    const actual = new Promise((resolve) => {
      liberar = resolve;
    });
    this.bloqueos.set(clave, actual);
    await anterior;
    try {
      return await trabajo();
    } finally {
      liberar();
      if (this.bloqueos.get(clave) === actual) this.bloqueos.delete(clave);
    }
  }
}

module.exports = { BloqueadorMemoria };
