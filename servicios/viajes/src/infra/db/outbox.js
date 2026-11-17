async function agregarEventoOutbox(cliente, evento) {
  if (!evento) return;
  await cliente.query(
    `INSERT INTO eventos_outbox
      (event_id, event_type, event_version, occurred_at, correlation_id,
       causation_id, producer, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      evento.eventId,
      evento.eventType,
      evento.eventVersion,
      evento.occurredAt,
      evento.correlationId,
      evento.causationId,
      evento.producer,
      JSON.stringify(evento.payload)
    ]
  );
}

class RepositorioOutboxPostgres {
  constructor({ pool, leaseMs = 30000 }) {
    this.pool = pool;
    this.leaseMs = leaseMs;
  }

  async reclamar(limite = 25) {
    const resultado = await this.pool.query(
      `WITH pendientes AS (
         SELECT event_id
           FROM eventos_outbox
          WHERE publicado_en IS NULL
            AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= NOW())
          ORDER BY creado_en ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE eventos_outbox AS outbox
          SET bloqueado_hasta = NOW() + ($2 * INTERVAL '1 millisecond'),
              intentos = intentos + 1
         FROM pendientes
        WHERE outbox.event_id = pendientes.event_id
       RETURNING outbox.event_id, outbox.event_type, outbox.event_version,
                 outbox.occurred_at, outbox.correlation_id, outbox.causation_id,
                 outbox.producer, outbox.payload`,
      [limite, this.leaseMs]
    );
    return resultado.rows.map((fila) => ({
      eventId: fila.event_id,
      eventType: fila.event_type,
      eventVersion: fila.event_version,
      occurredAt: new Date(fila.occurred_at).toISOString(),
      correlationId: fila.correlation_id,
      causationId: fila.causation_id,
      producer: fila.producer,
      payload: fila.payload
    }));
  }

  async marcarPublicado(eventId) {
    await this.pool.query(
      `UPDATE eventos_outbox
          SET publicado_en = NOW(), bloqueado_hasta = NULL, ultimo_error = NULL
        WHERE event_id = $1 AND publicado_en IS NULL`,
      [eventId]
    );
  }

  async liberar(eventId, error) {
    await this.pool.query(
      `UPDATE eventos_outbox
          SET bloqueado_hasta = NULL, ultimo_error = $2
        WHERE event_id = $1 AND publicado_en IS NULL`,
      [eventId, error.name || 'Error']
    );
  }

  async pendientes() {
    const resultado = await this.pool.query(
      `SELECT count(*)::integer AS total
         FROM eventos_outbox
        WHERE publicado_en IS NULL`
    );
    return resultado.rows[0].total;
  }
}

module.exports = { agregarEventoOutbox, RepositorioOutboxPostgres };
