class DespachadorOutbox {
  constructor({ repositorio, publicador, intervaloMs = 1000 }) {
    this.repositorio = repositorio;
    this.publicador = publicador;
    this.intervaloMs = intervaloMs;
    this.timer = null;
    this.activo = false;
    this.procesando = null;
  }

  async iniciar() {
    if (this.activo) return;
    this.activo = true;
    const huboErrores = await this.drenar();
    this.programar(huboErrores ? this.intervaloMs * 5 : this.intervaloMs);
  }

  programar(esperaMs) {
    if (!this.activo || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        const huboErrores = await this.drenar();
        this.programar(huboErrores ? Math.min(this.intervaloMs * 5, 10000) : this.intervaloMs);
      } catch (error) {
        console.error('Falló el despacho del outbox', error.name);
        this.programar(Math.min(this.intervaloMs * 5, 10000));
      }
    }, esperaMs);
    this.timer.unref?.();
  }

  async drenar() {
    if (this.procesando) return this.procesando;
    this.procesando = this.procesarPendientes().finally(() => {
      this.procesando = null;
    });
    return this.procesando;
  }

  async procesarPendientes() {
    let huboErrores = false;
    while (this.activo) {
      const eventos = await this.repositorio.reclamar();
      if (eventos.length === 0) return huboErrores;
      for (const evento of eventos) {
        try {
          await this.publicador.publicar(evento);
          await this.repositorio.marcarPublicado(evento.eventId);
        } catch (error) {
          huboErrores = true;
          await this.repositorio.liberar(evento.eventId, error);
          console.error(JSON.stringify({
            component: 'outbox-dispatcher',
            eventId: evento.eventId,
            eventType: evento.eventType,
            correlationId: evento.correlationId,
            error: error.name
          }));
        }
      }
      if (huboErrores || eventos.length < 25) return huboErrores;
    }
    return huboErrores;
  }

  async verificar() {
    const total = await this.repositorio.pendientes();
    return { outboxPending: total };
  }

  async cerrar() {
    this.activo = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.procesando) await this.procesando;
  }
}

module.exports = { DespachadorOutbox };
