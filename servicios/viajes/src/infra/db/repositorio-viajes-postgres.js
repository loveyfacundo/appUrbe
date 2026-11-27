const { RepositorioViajes } = require('../../dominio/puertos/repositorio-viajes');
const {
  Viaje,
  ESTADOS,
  ESTADOS_VIAJE_ACTIVO,
  TIPO_ACTOR_POR_ESTADO_CANCELACION,
  ESTADOS_CANCELACION_CONTABILIZADOS
} = require('../../dominio/entidades/viaje');
const { ejecutarEnTransaccion } = require('./transaccion');
const {
  ConflictoDeEstado,
  RecursoNoEncontrado,
  OperacionNoPermitida
} = require('../../dominio/errores/errores');
const { agregarEventoOutbox } = require('./outbox');
const {
  crearPoliticaCancelacionesDesdeEntorno,
  bloqueoEstaActivo
} = require('../../dominio/politica-cancelaciones');

const SQL_CAMPOS_VIAJE = 'id, pasajero_id, conductor_id, origen, destino, fecha_programada, estado, creado_en, actualizado_en';

const SQL_ASIGNAR_CONDUCTOR = `
  UPDATE viajes
     SET conductor_id = $2, estado = 'ASSIGNED', actualizado_en = NOW()
   WHERE id = $1
     AND conductor_id IS NULL
     AND estado IN ('REQUESTED', 'DISPATCHING')
  RETURNING ${SQL_CAMPOS_VIAJE}
`;

async function registrarHistorial(cliente, {
  viajeId,
  estado,
  actorId = null,
  ocurridoEn,
  motivo = null,
  estadoPrevio = null,
  penalidadArs = 0
}) {
  await cliente.query(
    `INSERT INTO historial_estados_viaje
       (viaje_id, estado, actor_id, ocurrido_en, motivo, estado_previo, penalidad_ars)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [viajeId, estado, actorId, ocurridoEn, motivo, estadoPrevio, penalidadArs]
  );
}

async function bloquearFilaLimite(cliente, usuarioId) {
  await cliente.query(
    `INSERT INTO bloqueos_cancelacion (usuario_id)
     VALUES ($1)
     ON CONFLICT (usuario_id) DO NOTHING`,
    [usuarioId]
  );
  const resultado = await cliente.query(
    `SELECT bloqueado_hasta
       FROM bloqueos_cancelacion
      WHERE usuario_id = $1
      FOR UPDATE`,
    [usuarioId]
  );
  return resultado.rows[0];
}

function verificarBloqueoActivo(fila) {
  if (bloqueoEstaActivo(fila?.bloqueado_hasta)) {
    throw new ConflictoDeEstado(
      `Usuario bloqueado para nuevas operaciones hasta ${new Date(fila.bloqueado_hasta).toISOString()}`
    );
  }
}

async function bloquearSiExcedeLimite(cliente, {
  actorId,
  decision,
  filaLimite,
  politicaCancelaciones
}) {
  if (!decision.cuentaParaLimite ||
      bloqueoEstaActivo(filaLimite?.bloqueado_hasta)) return null;

  const resultado = await cliente.query(
    `SELECT COUNT(*)::integer AS cantidad
       FROM historial_estados_viaje
      WHERE actor_id = $1
        AND estado = ANY($2::varchar[])
        AND ocurrido_en > NOW() - ($3 * INTERVAL '1 millisecond')`,
    [actorId, ESTADOS_CANCELACION_CONTABILIZADOS, politicaCancelaciones.periodoCancelacionesMs]
  );
  if (resultado.rows[0].cantidad < politicaCancelaciones.limiteCancelaciones) return null;

  const bloqueadoHasta = new Date(Date.now() + politicaCancelaciones.bloqueoCancelacionesMs);
  await cliente.query(
    `UPDATE bloqueos_cancelacion
        SET bloqueado_hasta = $2,
            motivo = 'Límite de cancelaciones excedido',
            actualizado_en = NOW()
      WHERE usuario_id = $1`,
    [actorId, bloqueadoHasta]
  );
  return bloqueadoHasta;
}

async function guardarIdempotenciaTransaccional(cliente, idempotencia, respuesta) {
  if (!idempotencia) return;
  const resultado = await cliente.query(
    `INSERT INTO idempotencia (clave, huella, respuesta, expira_en)
     VALUES ($1, $2, $3::jsonb, NOW() + ($4 * INTERVAL '1 millisecond'))
     ON CONFLICT (clave) DO NOTHING`,
    [
      idempotencia.clave,
      idempotencia.huella,
      JSON.stringify(respuesta),
      idempotencia.tiempoVidaMs || 24 * 60 * 60 * 1000
    ]
  );
  if (resultado.rowCount === 0) {
    throw new ConflictoDeEstado('La clave de idempotencia ya fue utilizada por otra operación');
  }
}

async function obtenerIdempotenciaTransaccional(cliente, idempotencia) {
  if (!idempotencia) return null;
  const resultado = await cliente.query(
    `SELECT huella, respuesta
       FROM idempotencia
      WHERE clave = $1 AND expira_en > NOW()
      FOR UPDATE`,
    [idempotencia.clave]
  );
  const anterior = resultado.rows[0];
  if (!anterior) return null;
  if (anterior.huella !== idempotencia.huella) {
    throw new ConflictoDeEstado('La clave de idempotencia ya fue utilizada por otra operación');
  }
  return anterior.respuesta;
}

function convertirFila(fila) {
  if (!fila) return null;
  return new Viaje({
    identificador: fila.id,
    pasajeroId: fila.pasajero_id,
    conductorId: fila.conductor_id,
    origen: fila.origen,
    destino: fila.destino,
    fechaProgramada: fila.fecha_programada ? new Date(fila.fecha_programada).toISOString() : null,
    estado: fila.estado,
    creadoEn: new Date(fila.creado_en).toISOString(),
    actualizadoEn: new Date(fila.actualizado_en).toISOString(),
    cancelacion: fila.cancelacion ?? null
  });
}

function sincronizarEvento(evento, viaje, estado) {
  if (!evento) return;
  evento.payload.status = viaje.estado;
  if (estado === ESTADOS.EN_CURSO) evento.payload.startedAt = viaje.actualizadoEn;
  if (estado === ESTADOS.FINALIZADO) evento.payload.completedAt = viaje.actualizadoEn;
}

class RepositorioViajesPostgres extends RepositorioViajes {
  constructor({
    pool,
    politicaCancelaciones = crearPoliticaCancelacionesDesdeEntorno()
  }) {
    super();
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new TypeError('RepositorioViajesPostgres requiere un pool PostgreSQL');
    }
    this.pool = pool;
    this.politicaCancelaciones = politicaCancelaciones;
    this.persisteOutbox = true;
  }

  async guardar(viaje, evento, idempotencia) {
    await ejecutarEnTransaccion(this.pool, async (cliente) => {
      const filaLimite = await bloquearFilaLimite(cliente, viaje.pasajeroId);
      const anterior = await cliente.query(
        'SELECT estado FROM viajes WHERE id = $1 FOR UPDATE',
        [viaje.identificador]
      );
      if (!anterior.rows[0]) verificarBloqueoActivo(filaLimite);
      await cliente.query(
        `INSERT INTO viajes
          (id, pasajero_id, conductor_id, origen, destino, fecha_programada, estado, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
          conductor_id = EXCLUDED.conductor_id,
          origen = EXCLUDED.origen,
          destino = EXCLUDED.destino,
          fecha_programada = EXCLUDED.fecha_programada,
          estado = EXCLUDED.estado,
          actualizado_en = EXCLUDED.actualizado_en`,
        [
          viaje.identificador,
          viaje.pasajeroId,
          viaje.conductorId,
          JSON.stringify(viaje.origen),
          JSON.stringify(viaje.destino),
          viaje.fechaProgramada,
          viaje.estado,
          viaje.creadoEn,
          viaje.actualizadoEn
        ]
      );
      if (!anterior.rows[0] || anterior.rows[0].estado !== viaje.estado) {
        await registrarHistorial(cliente, {
          viajeId: viaje.identificador,
          estado: viaje.estado,
          ocurridoEn: viaje.actualizadoEn
        });
      }
      await agregarEventoOutbox(cliente, evento);
      if (idempotencia) {
        await guardarIdempotenciaTransaccional(cliente, idempotencia, viaje.toJSON());
      }
    });
    return viaje;
  }

  async buscarPorId(id) {
    const resultado = await this.pool.query(
      `SELECT ${SQL_CAMPOS_VIAJE} FROM viajes WHERE id = $1`,
      [id]
    );
    const viaje = convertirFila(resultado.rows[0]);
    const tipoActor = TIPO_ACTOR_POR_ESTADO_CANCELACION[viaje?.estado];
    if (viaje && tipoActor) {
      const historial = await this.pool.query(
        `SELECT actor_id, motivo, estado_previo, penalidad_ars, ocurrido_en
           FROM historial_estados_viaje
          WHERE viaje_id = $1 AND estado = $2
          ORDER BY ocurrido_en DESC, id DESC
          LIMIT 1`,
        [id, viaje.estado]
      );
      if (historial.rows[0]) {
        const cancelacion = historial.rows[0];
        viaje.cancelacion = {
          actorTipo: tipoActor,
          actorId: cancelacion.actor_id,
          estadoAnterior: cancelacion.estado_previo,
          penalidadArs: cancelacion.penalidad_ars,
          moneda: 'ARS',
          motivo: cancelacion.motivo,
          ocurridoEn: new Date(cancelacion.ocurrido_en).toISOString()
        };
      }
    }
    return viaje;
  }

  async asignarConductor({ identificadorViaje, conductorId, evento, idempotencia }) {
    return ejecutarEnTransaccion(this.pool, async (cliente) => {
      verificarBloqueoActivo(await bloquearFilaLimite(cliente, conductorId));
      let resultado;
      try {
        resultado = await cliente.query(SQL_ASIGNAR_CONDUCTOR, [identificadorViaje, conductorId]);
      } catch (error) {
        if (error.code === '23505' && error.constraint === 'viajes_un_conductor_activo_idx') {
          throw new ConflictoDeEstado('El conductor ya tiene un viaje activo');
        }
        throw error;
      }
      if (resultado.rowCount === 0) {
        const existente = await cliente.query(
          'SELECT id, estado FROM viajes WHERE id = $1',
          [identificadorViaje]
        );
        if (existente.rowCount === 0) throw new RecursoNoEncontrado();
        throw new ConflictoDeEstado('El viaje ya fue asignado o no admite asignaciones');
      }

      const fila = resultado.rows[0];
      await registrarHistorial(cliente, {
        viajeId: fila.id,
        estado: fila.estado,
        actorId: conductorId,
        ocurridoEn: fila.actualizado_en
      });
      await agregarEventoOutbox(cliente, evento);
      const viaje = convertirFila(fila);
      await guardarIdempotenciaTransaccional(cliente, idempotencia, viaje.toJSON());
      return viaje;
    });
  }

  async cancelarViaje({
    identificadorViaje,
    actor,
    motivo,
    evento,
    idempotencia,
    politicaCancelaciones = this.politicaCancelaciones
  }) {
    const actorId = actor.identificador;
    const resultado = await ejecutarEnTransaccion(this.pool, async (cliente) => {
      const filaLimite = await bloquearFilaLimite(cliente, actorId);
      const bloqueado = await cliente.query(
        `SELECT ${SQL_CAMPOS_VIAJE} FROM viajes WHERE id = $1 FOR UPDATE`,
        [identificadorViaje]
      );
      if (bloqueado.rowCount === 0) throw new RecursoNoEncontrado();
      const respuestaIdempotente = await obtenerIdempotenciaTransaccional(cliente, idempotencia);
      if (respuestaIdempotente) return { respuestaIdempotente };
      const actual = convertirFila(bloqueado.rows[0]);
      const decision = politicaCancelaciones.resolver({ viaje: actual, actor });
      const bloqueadoHasta = await bloquearSiExcedeLimite(cliente, {
        actorId,
        decision,
        filaLimite,
        politicaCancelaciones
      });
      if (bloqueadoHasta) return { bloqueadoHasta };

      const actualizado = await cliente.query(
        `UPDATE viajes
            SET estado = $2, actualizado_en = NOW()
          WHERE id = $1
            AND estado = $3
        RETURNING ${SQL_CAMPOS_VIAJE}`,
        [identificadorViaje, decision.estadoFinal, decision.estadoAnterior]
      );
      if (actualizado.rowCount === 0) {
        throw new ConflictoDeEstado('El viaje ya fue asignado o no admite cancelación');
      }
      const fila = actualizado.rows[0];
      await registrarHistorial(cliente, {
        viajeId: identificadorViaje,
        estado: fila.estado,
        actorId,
        ocurridoEn: fila.actualizado_en,
        motivo,
        estadoPrevio: decision.estadoAnterior,
        penalidadArs: decision.penalidadArs
      });
      const cancelacion = {
        actorTipo: decision.tipoActor,
        actorId,
        estadoAnterior: decision.estadoAnterior,
        penalidadArs: decision.penalidadArs,
        moneda: 'ARS',
        motivo,
        ocurridoEn: new Date(fila.actualizado_en).toISOString()
      };
      if (evento) {
        Object.assign(evento.payload, {
          status: fila.estado,
          actorType: decision.tipoActor,
          previousStatus: decision.estadoAnterior,
          penaltyAmount: decision.penalidadArs,
          currency: 'ARS'
        });
      }
      await agregarEventoOutbox(cliente, evento);
      const viaje = convertirFila(fila);
      viaje.cancelacion = cancelacion;
      await guardarIdempotenciaTransaccional(cliente, idempotencia, viaje.toJSON());
      return viaje;
    });
    if (resultado.bloqueadoHasta) {
      throw new ConflictoDeEstado(
        `Límite de cancelaciones excedido; usuario bloqueado hasta ${resultado.bloqueadoHasta.toISOString()}`
      );
    }
    return resultado.respuestaIdempotente || resultado;
  }

  async verificarSinBloqueoCancelaciones(usuarioId) {
    const resultado = await this.pool.query(
      `SELECT bloqueado_hasta FROM bloqueos_cancelacion WHERE usuario_id = $1`,
      [usuarioId]
    );
    verificarBloqueoActivo(resultado.rows[0]);
  }

  async actualizarEstadoOperativo({
    identificadorViaje,
    actorId,
    estado,
    evento,
    idempotencia
  }) {
    return ejecutarEnTransaccion(this.pool, async (cliente) => {
      const resultado = await cliente.query(
        `SELECT ${SQL_CAMPOS_VIAJE} FROM viajes WHERE id = $1 FOR UPDATE`,
        [identificadorViaje]
      );
      if (resultado.rowCount === 0) throw new RecursoNoEncontrado();
      const viaje = convertirFila(resultado.rows[0]);
      if (viaje.conductorId !== actorId) {
        throw new OperacionNoPermitida('Solo el conductor asignado puede actualizar el estado');
      }

      if (estado === ESTADOS.EN_ORIGEN) viaje.llegarAlOrigen(actorId);
      if (estado === ESTADOS.EN_CURSO) viaje.iniciarEnCurso(actorId);
      if (estado === ESTADOS.FINALIZADO) viaje.finalizar(actorId);

      const actualizado = await cliente.query(
        `UPDATE viajes
            SET estado = $2, actualizado_en = $3
          WHERE id = $1
        RETURNING ${SQL_CAMPOS_VIAJE}`,
        [identificadorViaje, viaje.estado, viaje.actualizadoEn]
      );
      await registrarHistorial(cliente, {
        viajeId: identificadorViaje,
        estado: viaje.estado,
        actorId,
        ocurridoEn: viaje.actualizadoEn
      });
      sincronizarEvento(evento, viaje, estado);
      await agregarEventoOutbox(cliente, evento);
      const viajeActualizado = convertirFila(actualizado.rows[0]);
      await guardarIdempotenciaTransaccional(cliente, idempotencia, viajeActualizado.toJSON());
      return viajeActualizado;
    });
  }

  async procesarAsignacionEvento({ eventId, identificadorViaje, conductorId }) {
    return ejecutarEnTransaccion(this.pool, async (cliente) => {
      verificarBloqueoActivo(await bloquearFilaLimite(cliente, conductorId));
      const registrado = await cliente.query(
        `INSERT INTO eventos_procesados (event_id, tipo_evento)
         VALUES ($1, 'DriverAssigned')
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId]
      );
      if (registrado.rowCount === 0) return { duplicado: true };

      const asignado = await cliente.query(SQL_ASIGNAR_CONDUCTOR, [identificadorViaje, conductorId]);
      if (asignado.rowCount === 0) {
        const existente = await cliente.query(
          'SELECT estado, conductor_id FROM viajes WHERE id = $1',
          [identificadorViaje]
        );
        if (existente.rowCount === 0) throw new RecursoNoEncontrado();
        if (existente.rows[0].estado === 'ASSIGNED' &&
            existente.rows[0].conductor_id === conductorId) {
          return { duplicado: false };
        }
        throw new ConflictoDeEstado('La asignación del evento no coincide con el estado del viaje');
      }

      await registrarHistorial(cliente, {
        viajeId: identificadorViaje,
        estado: 'ASSIGNED',
        actorId: conductorId,
        ocurridoEn: asignado.rows[0].actualizado_en
      });
      return { duplicado: false };
    });
  }

  async buscarHistorial(id) {
    const resultado = await this.pool.query(
      `SELECT estado, actor_id, motivo, ocurrido_en
         FROM historial_estados_viaje
        WHERE viaje_id = $1
        ORDER BY ocurrido_en ASC, id ASC`,
      [id]
    );
    return resultado.rows;
  }

  async buscarHistorialPasajero(pasajeroId) {
    const resultado = await this.pool.query(
      `SELECT ${SQL_CAMPOS_VIAJE} FROM viajes
       WHERE pasajero_id = $1
       ORDER BY actualizado_en DESC`,
      [pasajeroId]
    );
    return resultado.rows.map(convertirFila);
  }

  async buscarHistorialConductor(conductorId) {
    const resultado = await this.pool.query(
      `SELECT ${SQL_CAMPOS_VIAJE} FROM viajes
       WHERE conductor_id = $1
       ORDER BY actualizado_en DESC`,
      [conductorId]
    );
    return resultado.rows.map(convertirFila);
  }

  async buscarEnCurso() {
    const resultado = await this.pool.query(
      `SELECT ${SQL_CAMPOS_VIAJE} FROM viajes
       WHERE estado = ANY($1::varchar[])
       ORDER BY actualizado_en DESC`,
      [ESTADOS_VIAJE_ACTIVO]
    );
    return resultado.rows.map(convertirFila);
  }
}

module.exports = { RepositorioViajesPostgres, convertirFila };
