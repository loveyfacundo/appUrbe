const { RepositorioViajes } = require('../../dominio/puertos/repositorio-viajes');
const { Viaje } = require('../../dominio/entidades/viaje');
const { ejecutarEnTransaccion } = require('./transaccion');

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
  }

  async guardar(viaje) {
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
