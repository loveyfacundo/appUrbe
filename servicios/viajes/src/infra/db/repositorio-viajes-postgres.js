const { RepositorioViajes } = require('../../dominio/puertos/repositorio-viajes');
const { Viaje } = require('../../dominio/entidades/viaje');
const { ejecutarEnTransaccion } = require('./transaccion');
const {
  ConflictoDeEstado,
  RecursoNoEncontrado,
  OperacionNoPermitida
} = require('../../dominio/errores/errores');
const { ESTADOS } = require('../../dominio/entidades/viaje');
const { agregarEventoOutbox } = require('./outbox');

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
    actualizadoEn: new Date(fila.actualizado_en).toISOString()
  });
}

class RepositorioViajesPostgres extends RepositorioViajes {
  constructor({ pool }) {
    super();
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new TypeError('RepositorioViajesPostgres requiere un pool PostgreSQL');
    }
    this.pool = pool;
    this.persisteOutbox = true;
  }

  async guardar(viaje, evento, idempotencia) {
    await ejecutarEnTransaccion(this.pool, async (cliente) => {
      const anterior = await cliente.query(
        'SELECT estado FROM viajes WHERE id = $1 FOR UPDATE',
        [viaje.identificador]
      );
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
        await cliente.query(
          `INSERT INTO historial_estados_viaje (viaje_id, estado, ocurrido_en)
           VALUES ($1, $2, $3)`,
          [viaje.identificador, viaje.estado, viaje.actualizadoEn]
        );
      }
      await agregarEventoOutbox(cliente, evento);
      if (idempotencia) {
        await guardarIdempotenciaTransaccional(
          cliente,
          idempotencia,
          viaje.toJSON()
        );
      }
    });
    return viaje;
  }

  async buscarPorId(id) {
    const resultado = await this.pool.query(
      `SELECT id, pasajero_id, conductor_id, origen, destino, fecha_programada,
              estado, creado_en, actualizado_en
         FROM viajes
        WHERE id = $1`,
      [id]
    );
    return convertirFila(resultado.rows[0]);
  }

  async asignarConductor({ identificadorViaje, conductorId, evento, idempotencia }) {
    return ejecutarEnTransaccion(this.pool, async (cliente) => {
      const resultado = await cliente.query(
        `UPDATE viajes
            SET conductor_id = $2, estado = 'ASSIGNED', actualizado_en = NOW()
          WHERE id = $1
            AND conductor_id IS NULL
            AND estado IN ('REQUESTED', 'DISPATCHING')
        RETURNING id, pasajero_id, conductor_id, origen, destino, fecha_programada,
                  estado, creado_en, actualizado_en`,
        [identificadorViaje, conductorId]
      );
      if (resultado.rowCount === 0) {
        const existente = await cliente.query(
          'SELECT id, estado FROM viajes WHERE id = $1',
          [identificadorViaje]
        );
        if (existente.rowCount === 0) throw new RecursoNoEncontrado();
        throw new ConflictoDeEstado('El viaje ya fue asignado o no admite asignaciones');
      }

      const fila = resultado.rows[0];
      await cliente.query(
        `INSERT INTO historial_estados_viaje (viaje_id, estado, actor_id, ocurrido_en)
         VALUES ($1, $2, $3, $4)`,
        [fila.id, fila.estado, conductorId, fila.actualizado_en]
      );
      await agregarEventoOutbox(cliente, evento);
      const viaje = convertirFila(fila);
      await guardarIdempotenciaTransaccional(cliente, idempotencia, viaje.toJSON());
      return viaje;
    });
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
        `SELECT id, pasajero_id, conductor_id, origen, destino, fecha_programada,
                estado, creado_en, actualizado_en
           FROM viajes
          WHERE id = $1
          FOR UPDATE`,
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
        RETURNING id, pasajero_id, conductor_id, origen, destino, fecha_programada,
                  estado, creado_en, actualizado_en`,
        [identificadorViaje, viaje.estado, viaje.actualizadoEn]
      );
      await cliente.query(
        `INSERT INTO historial_estados_viaje (viaje_id, estado, actor_id, ocurrido_en)
         VALUES ($1, $2, $3, $4)`,
        [identificadorViaje, viaje.estado, actorId, viaje.actualizadoEn]
      );
      if (evento) {
        evento.payload.status = viaje.estado;
        if (estado === ESTADOS.EN_CURSO) evento.payload.startedAt = viaje.actualizadoEn;
        if (estado === ESTADOS.FINALIZADO) evento.payload.completedAt = viaje.actualizadoEn;
      }
      await agregarEventoOutbox(cliente, evento);
      const viajeActualizado = convertirFila(actualizado.rows[0]);
      await guardarIdempotenciaTransaccional(
        cliente,
        idempotencia,
        viajeActualizado.toJSON()
      );
      return viajeActualizado;
    });
  }

  async procesarAsignacionEvento({ eventId, identificadorViaje, conductorId }) {
    return ejecutarEnTransaccion(this.pool, async (cliente) => {
      const registrado = await cliente.query(
        `INSERT INTO eventos_procesados (event_id, tipo_evento)
         VALUES ($1, 'DriverAssigned')
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId]
      );
      if (registrado.rowCount === 0) return { duplicado: true };

      const asignado = await cliente.query(
        `UPDATE viajes
            SET conductor_id = $2, estado = 'ASSIGNED', actualizado_en = NOW()
          WHERE id = $1
            AND conductor_id IS NULL
            AND estado IN ('REQUESTED', 'DISPATCHING')
        RETURNING id, estado, actualizado_en`,
        [identificadorViaje, conductorId]
      );
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

      await cliente.query(
        `INSERT INTO historial_estados_viaje (viaje_id, estado, actor_id, ocurrido_en)
         VALUES ($1, 'ASSIGNED', $2, $3)`,
        [identificadorViaje, conductorId, asignado.rows[0].actualizado_en]
      );
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
}

module.exports = { RepositorioViajesPostgres, convertirFila };
